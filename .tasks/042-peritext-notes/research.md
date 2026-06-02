# Peritext performance research

## Scope

This note reviews the feedback in `task.md` against the current peritext implementation under `src/peritext`.

The main finding is that the current code is correct-looking for small documents, but it repeatedly rebuilds derived views and full state arrays in paths that will be hot for editing. The likely fix is not one isolated micro-optimization; the state shape probably needs a small amount of cached/indexed metadata so operations can avoid full scans.

## Confirmed issues

### `sequence.ts`

- `applyInsert` returns `cloneState(state)` for duplicate inserts. This makes idempotent/no-op replay O(n) in document size and also clones mark op arrays. Returning the existing state should be enough if the public API treats states as immutable.
  - Code: `src/peritext/sequence.ts:23`

- `applyInsert` validates `afterId` with a full scan, clones every char, appends one char, then calls `sortChars` over the whole document. A single-character insert is therefore O(n log siblings + n) plus recursion, even when appending after the previous local insert.
  - Code: `src/peritext/sequence.ts:24`, `src/peritext/sequence.ts:27`, `src/peritext/sequence.ts:87`

- `sortChars` reconstructs a parent-to-children map, validates all parent IDs, sorts every sibling list, and traverses the whole graph. That is useful as an import/repair/canonicalization helper, but too expensive for every incremental insert.
  - Code: `src/peritext/sequence.ts:87`

- `applyRemove` clones the entire char array before it even knows whether the remove changes anything. Replayed removes of already-deleted chars return `cloneState(state)`, so the idempotent path is also O(n).
  - Code: `src/peritext/sequence.ts:40`

- `insertionAfterIdForIndex` materializes all visible chars to resolve one index. It only needs the visible char immediately before the target index and a visible-length bounds check.
  - Code: `src/peritext/sequence.ts:63`

- `charIdsForVisibleRange` materializes all visible chars, slices, and maps. It only needs a single pass collecting IDs in `[start, end)`, plus bounds validation.
  - Code: `src/peritext/sequence.ts:71`

- There is no optimized path for sequential insert runs. `src/crdt/updates.ts` creates one insert update per character for normal text insertion, so applying a pasted string or imported paragraph pays the full per-character insertion cost.
  - Code: `src/crdt/updates.ts:83`

### `apply.ts`

- Rich-text-level `pending` exists and is exercised by tests for out-of-order insert dependencies, but it appears partially redundant with CRDT document-level pending.
  - Peritext pending: `src/peritext/apply.ts:11`, `src/peritext/apply.ts:60`
  - CRDT rich-text apply copies nested pending back onto the meta object: `src/crdt/apply.ts:92`

- `applyOne` uses thrown exceptions as control flow for missing dependencies. That amplifies the cost of expected out-of-order updates and couples pending detection to error message regex matching.
  - Code: `src/peritext/apply.ts:36`, `src/peritext/apply.ts:106`

- `retryPending` clones the state up front and retries pending operations in a loop. If peritext pending is kept, it should use explicit dependency checks/indexes so retrying is proportional to newly satisfied operations rather than repeated failed application attempts.
  - Code: `src/peritext/apply.ts:60`

### `boundaries.ts`

- `anchorsForMarkRange` computes `visibleChars(state)` and then calls `charIdsForVisibleRange`, which computes `visibleChars(state)` again. For mark/unmark patch creation this is two full visible-array materializations before any mark op is applied.
  - Code: `src/peritext/boundaries.ts:17`

- `insertionAfterIdForIndexPreservingBoundary` materializes all visible chars, then uses `findIndex` for previous and next visible IDs, then slices and filters tombstones. This can become multiple O(n) passes for a single insertion point lookup.
  - Code: `src/peritext/boundaries.ts:39`

### `ids.ts`

- `tryParseOpId` uses `parseOpId` plus try/catch for invalid IDs. That is fine for validation edges, but should not be used in hot paths.
  - Code: `src/peritext/ids.ts:22`

- `compareOpIds` reparses both IDs on every comparison. Since `sortChars` sorts sibling lists on every insert and mark operations sort op sets, this causes repeated regex parsing in hot paths.
  - Code: `src/peritext/ids.ts:42`

- `maxOpCounter` scans every char, every mark boundary op, and nested pending every time an ID is allocated. Normal patch creation calls `allocateOpIds` for insert/delete/mark/unmark, and history undo/redo also calls `maxOpCounter`.
  - Code: `src/peritext/ids.ts:50`, `src/crdt/updates.ts:85`, `src/crdt/history.ts:794`

## Suggested implementation direction

### 1. Add state indexes/caches

Consider extending `RichTextState` with internal metadata:

- `charsById: Map<RichTextOpId, number>` or a plain object mapping op ID to array index.
- `visibleCount` or a Fenwick tree/order-stat index if index lookup needs to be fast in large documents.
- `maxOpCounter` cached on state.
- Possibly parsed op ID cache by op ID string, either global module cache or stored in char metadata.

Open design point: exported snapshots probably should not include these caches, so either they are optional/internal fields or `RichTextState` gets a documented normalization/hydration step.

### 2. Make no-op paths return the same state

If `RichTextState` is immutable by convention, duplicate insert and already-applied remove can return `state`. This is the smallest safe win.

If callers rely on defensive cloning, that should be made explicit, because the current implementation is paying a large cost to protect against mutation without doing so consistently across all callers.

### 3. Replace full sort-on-insert with incremental insertion

The existing order is a tree traversal:

- Children are grouped by `afterId`.
- Siblings at the same parent are sorted by descending op ID.
- Each child is emitted before recursively emitting its descendants.

An incremental insert should place the new char into the existing linear `chars` array at the correct position for that tree order. The tricky case is inserting a new sibling before/after existing siblings while keeping each sibling's descendant subtree attached.

Likely approach:

- Maintain children lists by parent ID, sorted by the same sibling comparator.
- On insert, update the one parent child list.
- Compute the new node's linear insertion point from the previous sibling subtree or parent position.
- Insert into `chars` at that point and update affected indexes.

For a first pass, a less invasive helper can find the insertion point by scanning around the parent/sibling region, which still avoids global graph rebuild and global sorting.

### 4. Add `insertMany`

Text insertion already creates runs of sequential inserts where each new op follows the previous op. An `insertMany`/`applyInsertRun` helper can:

- Validate the initial `afterId` once.
- Allocate/build all `RichTextCharMeta` entries.
- Insert the run as one contiguous block when there is no concurrent sibling interleaving.
- Update `maxOpCounter` once.
- Avoid repeated pending retry and repeated array cloning.

This could be used by import/export and by CRDT update application when a batch contains a sequential insert run.

### 5. Replace exception-driven dependency checks

Before applying an operation, check dependencies directly:

- Insert needs `afterId === null || charsById.has(afterId)`.
- Remove needs `charsById.has(removedId)`.
- Mark needs all referenced anchor IDs present.

Then `applyOne` can return `pending` without throwing and parsing error messages. Actual thrown errors can be reserved for malformed operations and impossible invariants.

### 6. Decide whether nested rich-text `pending` should exist

There are two plausible models:

- Keep nested peritext pending because rich-text operations can become ready after other rich-text operations on the same field even when the CRDT document update itself reached the field.
- Remove nested pending and let document-level pending retain the whole CRDT update until the rich-text dependencies are ready.

The current code mixes both: document-level rich-text apply can return applied while storing `meta.pending`. This avoids blocking the entire CRDT update queue, but it also means pending behavior lives inside field metadata and has its own retry loop.

This needs an explicit choice before optimizing because the best indexing strategy differs.

## Open questions

- Is `RichTextState` intended to be a public serializable data structure, or can it contain non-JSON indexes/caches such as `Map`?
  - ok so actually I think I want to change our representation. Currently we have a "sentinal type" in the user-visible side of things, and the actual data in the "crdt metadata". I think I want the "actual data" (`RichTextState`) to be in the "user-visible json", and the "crdt metadata" to contain indexes & caches. Note that these indexes/caches should still be json serializeable, so no `Map`.
- Do callers depend on no-op application returning a fresh cloned object, or is referential equality acceptable for no-ops?
  - don't clone, referential equality is acceptable
- Should operation application mutate internal state during CRDT materialization, or must every helper remain persistent/immutable?
  - let's keep persistent/immutable for now
- Are operation batches always available when applying text input, or do we only see one CRDT update at a time after creation? This determines how useful `insertMany` can be at apply time.
  - paste, as well as 'undo/redo' might well do an insertMany
- Should rich-text pending live inside `RichTextState`, or should missing rich-text dependencies keep the parent CRDT update in document-level `pending`?
  - ok it should live in RichTextState
- What document sizes and edit patterns should guide optimization: small notes, pasted long documents, collaborative concurrent edits, or import/migration workloads?
  - we should be able to scale easily to thousands of characters with collaborative concurrent edits
- Should op IDs stay string-only, or should parsed `{counter, actorId}` be stored alongside operations/chars after validation?
  - whatever you think will be better for performance

## Suggested verification

- Add microbenchmarks for:
  - appending N chars locally,
  - replaying duplicate inserts/removes,
  - deleting a large visible range with tombstones present,
  - mark/unmark over large ranges,
  - applying out-of-order insert batches.
- Preserve existing behavioral tests around concurrent sibling ordering and descendant subtree ordering before replacing `sortChars`.
- Add tests that assert no-op duplicate insert/remove return the same state if that becomes the intended contract.
