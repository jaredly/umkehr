# Research: remove `cloneMeta` from `applyCrdtUpdate`

## Task

`src/crdt/apply.ts` currently calls `cloneMeta(doc.meta)` at the start of every
`applyCrdtUpdate`. That is a full `structuredClone` of the CRDT metadata tree,
even when the incoming update is discarded or only touches one primitive leaf.
For large documents this makes update replay and sync O(document size) per
update before any useful work happens.

## Current flow

- `applyCrdtUpdate(doc, update)` creates `next` with:
  - shallow-spread document fields,
  - `meta: cloneMeta(doc.meta)`,
  - `pending: doc.pending.slice()`.
- `applyOne(next, update)` mutates `next.meta` in place.
- If the update becomes pending, `next.pending.push(...)`.
- If the update applies, `retryPending(next)` repeatedly calls `applyOne` and
  mutates the same cloned metadata tree.
- `next.state = materialize(next.meta, next.state)` rematerializes the document.

This is simple but costly because it always clones the entire metadata tree
up front. The code only needs mutable ownership of a narrow path plus the
modified container maps.

## Metadata mutation sites

All metadata writes in `src/crdt/apply.ts` are local and enumerable:

- Root delete: `doc.meta = {kind: 'tombstone', deleted: update.ts}`.
- Root set: `doc.meta = buildMeta(update.value, ...)`.
- Leaf delete/set through `setChild(parent, segment, value)`.
- Array insert: `meta.items[update.id] = ...`.
- Array item delete: `parent.items[segment.id] = ...`.
- Array reorder: `item.order = order` for one or more live array items.
- Rich text: `meta.maxOpCounter = ...`; actual rich-text content is updated in
  `doc.state` via `setValueAtPath`.

Every non-root metadata mutation either happens at the target container or at
the target rich-text node. That makes path-copying a good fit.

## Recommended approach

Replace eager whole-tree cloning with copy-on-write metadata helpers used by
`applyCrdtUpdate`.

The desired shape:

1. Run the same readiness/version checks against the original metadata.
2. If the update is discarded, return a document that preserves observable
   immutability without cloning the metadata tree. Ideally return `doc` itself
   when `pending` does not change; otherwise only clone `pending`.
3. If the update is pending, append to a copied `pending` array and leave
   `meta`/`state` shared.
4. If the update applies, clone only the ancestors from the root to the
   mutation point, clone the modified container map or array item object, write
   the new child/order/counter, then materialize from the new metadata.
5. Retry pending updates against the new metadata using the same copy-on-write
   primitive for each applied pending update.

Concrete helper candidates:

- `cloneMetaNode(meta: CrdtMeta): CrdtMeta`
  - Shallow-clones one node and its directly owned mutable records:
    - object/tagged: clone `fields`,
    - record: clone `entries`,
    - array: clone `items`,
    - primitive/tombstone/richText: shallow object clone.
- `clonePath(root, path): {root, parent, target, segment} | pending/discard`
  - Equivalent to `walkToLeaf`, but returns cloned ancestors and cloned parent.
  - For array paths, clone the live `ArrayItemMeta` object before replacing
    `item.value` or `item.order`.
- Operation-specific copy helpers may be clearer than one generic helper:
  - `setChildImmutable(root, path, value)`
  - `updateArrayImmutable(root, arrayPath, fn)`
  - `updateRichTextMetaImmutable(root, path, fn)`

The important rule is that no object reachable from `doc.meta` may be mutated
after `applyCrdtUpdate` returns a different document.

## Rich text considerations

`applyRichText` is special because metadata and state both change:

- It looks up metadata with `getMetaAtPath`.
- It translates the CRDT path to a normal materialized path using
  `normalPathForCrdtPath`.
- It applies the rich-text operation to `doc.state`.
- It increments `meta.maxOpCounter`.

The copy-on-write version should update the rich-text metadata node and state
path together. `setValueAtPath` already clones the materialized state path, so
the missing piece is cloning the metadata path before changing
`maxOpCounter`.

One subtlety: `materialize(meta, previous)` preserves an existing rich-text
state when the metadata node is `kind: 'richText'`. After a rich-text operation,
the previous state passed to `materialize` must be the state that already
contains the rich-text operation, otherwise materialization would keep the old
rich-text payload. The current code does this by updating `doc.state` before
the final `materialize(next.meta, next.state)`. The refactor must preserve that
ordering.

## Pending retry considerations

`retryPending` currently mutates the already-cloned `doc` in place. With
copy-on-write, there are two viable strategies:

- Keep an internal mutable working document whose `meta` is updated by
  copy-on-write on each successful pending update.
- Make `applyOne` return a patch result like
  `{status, meta?, state?, appliedUpdate?}` and let `retryPending` thread the
  current document value through the loop.

The second option is more explicit and avoids hidden mutation. It also makes it
easier to return the original document on discarded updates. The first option
is a smaller local rewrite but requires discipline to avoid mutating shared
metadata while retrying.

Pending queue semantics to preserve:

- Updates that remain pending stay in original queue order.
- An applied update can unblock later pending updates; the retry loop repeats
  until no more pending update applies.
- Pending reason calculation should inspect the post-update metadata when an
  incoming update is queued, matching current behavior.

## Test coverage to add

Existing convergence tests should catch many semantic regressions, but they do
not directly protect the immutability contract. Add focused tests in
`src/crdt/crdt.test.ts` or a new apply-specific test file:

- Applying a leaf set does not mutate `before.meta`.
- Applying an array insert/delete/reorder does not mutate `before.meta`.
- Applying a rich-text update does not mutate `before.meta` and does not mutate
  unrelated materialized state branches.
- A discarded stale update returns state/meta equivalent to the input and does
  not clone or mutate metadata unnecessarily. If we intentionally return `doc`
  for discarded updates, assert identity.
- A pending update does not clone/mutate metadata, only appends to a new pending
  array.
- A parent update that unblocks pending children still converges and leaves the
  original pre-apply document unchanged.

The existing broad suites to run afterward:

- `pnpm test src/crdt/crdt.test.ts`
- `pnpm test src/crdt/proof.test.ts`
- `pnpm test src/crdt/richtext.test.ts`
- `pnpm test src/crdt/history.test.ts`
- `pnpm test src/migration/migration.test.ts`

## Risks

- Array item updates are easy to accidentally mutate because `ArrayMeta.items`
  contains nested live item objects. Replacing `items[id]` is safe only if the
  `items` record is cloned first; changing `item.order` or `item.value` also
  requires cloning the live item object.
- `normalPathForCrdtPath` computes array indexes by sorting live items. For
  rich text and reorder paths, calculate paths against the correct before/after
  metadata depending on the operation.
- Returning `doc` for discarded updates is probably correct but may be a
  behavior change if callers assume every call returns a fresh object. I did not
  find tests asserting fresh identity, and returning the same object is the best
  performance result for no-op updates.
- `materialize` still walks the whole metadata tree. Removing `cloneMeta` fixes
  the largest avoidable clone, but full rematerialization may remain a separate
  performance ceiling for very large documents.

## Open questions

- Should `applyCrdtUpdate` be allowed to return the exact same document object
  for discarded no-op updates, or should it keep returning a fresh wrapper for
  compatibility with existing React/state callers?
  - exact same is fine
- Is it acceptable for successfully applied updates to share unchanged metadata
  subtrees with previous documents? That is the usual persistent-data-structure
  contract, but it means external code must not mutate `doc.meta`.
  - yes please, structural sharing
- Do we want to keep `cloneMeta` exported for history/migration helper code, or
  should those call sites be audited separately after `applyCrdtUpdate` is fixed?
  - we can leave it
- Should this task also address full `materialize` cost, or is the scope only
  removing the `structuredClone` metadata copy?
  - any other perf improvements would be great
