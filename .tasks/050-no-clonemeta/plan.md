# Plan: remove whole-tree metadata cloning from apply

## Goals

- Remove the eager `cloneMeta(doc.meta)` call from `applyCrdtUpdate`.
- Preserve caller-visible immutability with structural sharing.
- Allow discarded no-op updates to return the exact same document object.
- Keep `cloneMeta` available for other history/migration helper code.
- Take reasonable follow-on performance wins around materialization where they
  fit cleanly, without expanding into a broad CRDT rewrite.

## Phase 1: lock down behavior and immutability

Add focused regression tests before changing implementation.

- Add apply immutability tests in `src/crdt/crdt.test.ts` or a new
  `src/crdt/apply.test.ts`.
- Cover primitive/object field set:
  - applying a leaf update changes the returned document,
  - the original `doc.meta` is deeply equal to a pre-apply snapshot,
  - unrelated metadata subtrees are shared by identity where practical.
- Cover array insert/delete/reorder:
  - original array metadata and live item metadata are not mutated,
  - changed array container/item metadata is not shared,
  - unrelated branches remain shared.
- Cover pending updates:
  - missing-parent update returns a new document only because `pending` changes,
  - `meta` and `state` are shared with the input document,
  - original `pending` array is not mutated.
- Cover discarded stale updates:
  - update returns the exact same document object,
  - `meta`, `state`, and `pending` identities are unchanged.
- Cover pending retry:
  - parent arrival unblocks pending child updates,
  - original waiting document remains unchanged,
  - final state and pending queue match current behavior.
- Cover rich text:
  - metadata is not mutated in the input document,
  - rich-text state advances correctly,
  - unrelated state branches remain shared where `setValueAtPath` permits.

## Phase 2: introduce metadata copy-on-write helpers

Create small local helpers in `src/crdt/apply.ts` first. Extract later only if
they prove useful elsewhere.

- Add `cloneMetaNode(meta)` for one-level metadata cloning:
  - `object` and `tagged`: clone `fields`,
  - `record`: clone `entries`,
  - `array`: clone `items`,
  - `primitive`, `tombstone`, `richText`: shallow clone.
- Add path-copy helpers that perform the same readiness checks as `walkToLeaf`:
  - clone ancestors from root to the target parent,
  - clone the target parent before mutation,
  - for array item paths, clone the live `ArrayItemMeta` object before changing
    `value` or `order`.
- Keep existing `walkToLeaf` or replace it only once the copy helper fully
  covers pending/discard reasons.
- Make helper return types explicit, for example:
  - `{status: 'ready'; root; parent; target?; segment?}`,
  - `{status: 'pending'; reason}`,
  - `{status: 'discard'}`.

Implementation rule: no object reachable from the input `doc.meta` may be
mutated when `applyCrdtUpdate` returns a different document.

## Phase 3: refactor `applyOne` to return immutable results

Change the internal apply contract from "mutate the supplied document" to
"classify update and optionally return changed pieces".

Suggested shape:

```ts
type ApplyResult<T> =
    | {status: 'applied'; meta: CrdtMeta; state?: T}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discarded'};
```

- Root set/delete:
  - return newly built root metadata directly.
- Leaf set/delete:
  - perform version checks against original metadata,
  - return copied root metadata with the leaf replaced.
- Array insert:
  - copy the array path,
  - clone `items`,
  - assign the new live item.
- Array item delete:
  - copy the parent array path,
  - clone `items`,
  - replace `items[id]` with deleted metadata.
- Set order:
  - if all changes are stale and no deleted item is handled, return discarded,
  - otherwise copy the array path once,
  - clone each changed live item object before replacing its `order`.
- Rich text:
  - resolve metadata/path against the current document,
  - apply rich-text state with existing `setValueAtPath`,
  - copy the rich-text metadata path and update `maxOpCounter`,
  - return both `meta` and the rich-text-updated `state`.

Keep all existing timestamp and parent-readiness semantics unchanged.

## Phase 4: rebuild `applyCrdtUpdate` around result threading

Rewrite `applyCrdtUpdate` so it allocates only when needed.

- Call the new `applyOne(doc, update)` against the input document.
- If discarded:
  - return `doc` exactly.
- If pending:
  - return `{...doc, pending: [...doc.pending, pendingEntry]}`,
  - do not clone or materialize metadata.
- If applied:
  - build a working document with returned `meta`, returned `state ?? doc.state`,
    same schema, and copied pending queue,
  - retry pending updates,
  - materialize once at the end using the latest working state as `previous`.

Refactor pending retry to thread immutable results:

- Iterate pending queue in original order.
- Apply each pending update against the current working document.
- Keep still-pending updates in a fresh `remaining` array.
- Repeat while at least one pending update applied.
- Do not re-queue discarded pending updates.
- Return the final working document plus pending queue.

After retry, call `materialize(finalMeta, finalStateBeforeMaterialize)`.
For rich-text updates, this must use the state that already includes rich-text
operation changes so `materialize` preserves them.

## Phase 5: targeted materialization performance improvements

This is secondary to removing `cloneMeta`, but worthwhile if it stays small and
well tested.

First option: skip materialization for no structural state change.

- Discarded updates already return `doc`.
- Pending-only updates should not call `materialize`.

Second option: path-scoped materialization for simple applied updates.

- For root replacement/delete, materialize root as today.
- For leaf set/delete/insert/reorder, consider returning changed normal paths
  from apply and updating only those state paths.
- Reuse existing `normalPathForCrdtPath` and `setValueAtPath` style helpers
  where possible.
- Be cautious with array reorder/delete because normal array indexes can change;
  rematerializing the affected array subtree may be the right granularity.
- Keep full `materialize` as fallback for pending retry batches and ambiguous
  path cases.

Do not let this phase block the core `cloneMeta` removal. If it becomes tangled,
ship structural sharing first and record materialization as a follow-up.

## Phase 6: verification

Run focused tests first, then the broader CRDT suites.

- `pnpm test src/crdt/crdt.test.ts`
- `pnpm test src/crdt/richtext.test.ts`
- `pnpm test src/crdt/history.test.ts`
- `pnpm test src/crdt/proof.test.ts`
- `pnpm test src/migration/migration.test.ts`
- `npm run typecheck`

If the implementation touches example/server materialization or React changed
path behavior, also run:

- `pnpm test examples/react-crdt/src/lib/server/materialize.test.ts`
- `pnpm test examples/react-crdt/src/lib/local-first/local-first.test.ts`

## Completion criteria

- `src/crdt/apply.ts` no longer imports or calls `cloneMeta`.
- Discarded stale updates return the exact input document object.
- Pending-only updates share input metadata and state.
- Applied updates structurally share unchanged metadata subtrees.
- Input documents are not mutated by apply, including array item metadata and
  rich-text metadata.
- Existing CRDT convergence, history, rich-text, migration, and proof tests pass.
