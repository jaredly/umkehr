# Plan: Block Parent Ancestry Paths

## Decisions From Research

- Replace `Block.order.parent` with `Block.order.path`.
- `Block.order.path` omits the root sentinel and includes the block id as its final element.
- A root block has path `[blockId]`.
- Add a Lamport `order.id` so order values have a deterministic identity without storing a move log.
- Keep one winning order per block using existing `laterBlockOrderTs` semantics.
- Missing path dependencies return `false` from apply.
- A path with duplicate ids is an invariant error.
- Deleted and joined blocks remain valid path ancestors forever.
- Do not add public rejected/normalized-path debug APIs for now.
- No backwards compatibility or migration layer is required.
- Every visible block must materialize with a valid root-reachable path. If the algorithm cannot guarantee this, stop and revisit the model.
- Initial implementation may rebuild `blockChildren` in `organizeState`, but production code needs a rock-solid incremental cache update algorithm.

## Phase 1: Type Model

Update `src/block-crdt/types.ts`.

Replace block order with:

```ts
export type BlockOrder = {
    id: Lamport;
    path: Lamport[];
    index: LseqId;
    ts: BlockOrderTs;
};
```

Then update `Block`:

```ts
export type Block = {
    id: Lamport;
    meta: ...;
    order: BlockOrder;
    deleted: boolean;
};
```

Update `Op` in `src/block-crdt/index.ts`:

```ts
| {type: 'block:move'; id: Lamport; order: Block['order']}
```

The op can keep top-level `id` as the moved block id. `order.id` is the order value id. For new move ops, these will often differ:

```ts
{
    type: 'block:move',
    id: movedBlock.id,
    order: {
        id: [state.state.maxSeenCount + 1, actor],
        path: [...targetPath, movedBlock.id],
        index,
        ts,
    },
}
```

For initial block creation, `order.id` may be the same Lamport as `block.id`; the creation op is the first order fact for that block. For later `block:move` ops, `order.id` must be a fresh Lamport id for the order value.

Update max-seen tracking to include:

- moved block id,
- order id,
- every Lamport in `order.path`.

## Phase 2: Path Validation Helpers

Add small helpers in `src/block-crdt/index.ts` or a local block-order helper module.

Suggested helpers:

```ts
const ROOT_ID = lamportToString([0, 'root']);

const blockOrderPathIds = (order: Block['order']) =>
    order.path.map(lamportToString);

const validateBlockOrderPath = (
    blocks: Record<string, Block>,
    blockId: string,
    order: Block['order'],
): false | void => ...
```

Validation rules:

- `order.path.length > 0`.
- `order.path.at(-1)` must equal the moved block id.
- `order.path` must not include `[0, 'root']`.
- no duplicate ids in the path; throw an invariant error if duplicated.
- every path id must exist in `state.blocks`; if any are missing, return `false`.

Self-parenting falls out of duplicate validation for paths like `[A, A]`.

Malformed paths should throw when they represent an invariant violation rather than missing dependencies:

- empty path,
- final id does not match the moved block,
- duplicate id,
- root sentinel in the path.

## Phase 3: Materialized Path Derivation

Make materialized paths the authoritative source for `cache.blockChildren`.

Add helper APIs:

```ts
export const materializedBlockPaths = (
    state: State | CachedState,
): Record<string, Lamport[]>;

export const materializedBlockPath = (
    state: State | CachedState,
    blockId: string,
): Lamport[];

export const materializedBlockParent = (
    state: State | CachedState,
    blockId: string,
): Lamport;
```

Derivation algorithm:

1. Start with the current winning `block.order.path` for every block.
2. Normalize each block recursively by normalizing the path's declared immediate parent:
   - raw `[A, B, C]` declares parent `B`,
   - normalized `C` path is `normalize(B) + [C]`.
3. If a raw path has a single item, it is root: `[block]`.
4. While normalizing, maintain a stack of block ids.
5. If normalizing a parent would re-enter a block already on the stack, resolve the cycle deterministically.

Cycle-breaking rule:

- Use the lowest `order.id` Lamport among the blocks participating in the detected cycle as the winner.
- The winner's parent edge is rejected for this cycle, so the winner materializes at root as `[winner]`.
- Other cycle participants normalize through the winner and preserve their remaining suffixes.

For the reciprocal case:

```text
A raw [B, A]
B raw [A, B]
```

If `A.order.id` is lower, materialize:

```text
A [A]
B [A, B]
```

For longer paths, preserve remaining path items after the cycle break. Example shape to cover in tests:

```text
E raw [A, B, C, D, E]
cycle break makes B root
=> B [B]
=> C [B, C]
=> D [B, C, D]
=> E [B, C, D, E]
```

Implementation note: a direct recursive implementation can memoize normalized paths by block id. The cycle resolver needs to identify the cycle slice from the recursion stack, select the lowest `order.id`, memoize that winner as root, then unwind so descendants append themselves to the winner-derived path.

If this algorithm cannot preserve all non-cycle suffix items while keeping every visible block root-reachable, stop and revisit before implementing a weaker fallback.

## Phase 4: Cache Construction, Rebuild Version

First implement correctness through `organizeState`.

Update:

```ts
organizeState(blocks, chars, joins)
```

so block children are derived from normalized paths:

1. call `materializedBlockPaths({state-like blocks, chars, joins})` or a lower-level helper that only needs blocks,
2. for each block, derive parent:
   - path length 1 means root,
   - otherwise parent is `path[path.length - 2]`,
3. insert block id under that parent in `blockChildren`,
4. sort children by `blocks[id].order.index`.

Keep traversal visited-set guards as defensive checks, but valid materialized block caches should not trip them.

Update `cachedState(state.state)` expectations so cache rebuild uses the same normalization path.

## Phase 5: Apply Semantics

Update `applyBlockMove`.

Rules:

- moved block must exist, otherwise return `false`.
- path validation must pass; missing path records return `false`.
- if `order.ts` does not beat `current.order.ts`, ignore the op.
- if timestamps are equivalent and a tie-break is needed, use lower `order.id` as the winning order value.
- store the winning order on the block.
- rebuild `cache.blockChildren` through `organizeState` for the initial implementation.
- update `maxSeenCount` from moved id, `order.id`, and all path ids.

Update `applyBlock`.

Rules:

- block creation order must include `id`, `path`, `index`, and `ts`.
- validate `block.order.path` against the candidate block map that already includes the inserted block, since the path must end with the new block id.
- reinserted blocks merge metadata/deletion as today.
- order merging uses `laterBlockOrderTs`; equivalent priority ties use lower `order.id`.
- cache is rebuilt through `organizeState` for the initial implementation.

Add or update a helper for order priority:

```ts
const blockOrderWins = (incoming: Block['order'], current: Block['order']) => {
    if (laterBlockOrderTs(incoming.ts, current.ts)) return true;
    if (laterBlockOrderTs(current.ts, incoming.ts)) return false;
    return compareLamports(incoming.id, current.id) < 0;
};
```

Be careful with existing incidental `BlockOrderTs` behavior. The tuple timestamp comparison remains the first-order priority; `order.id` only breaks equivalent-priority ties.

## Phase 6: Block Creation And Editing Helpers

Update all block creation sites to create path orders.

Likely affected functions:

- `initialState`
- `blockBetween`
- `split`
- test helper `block(...)`
- example/test command helpers that create blocks directly.

Add command-facing helpers:

```ts
export const activeBlockPath = (state: CachedState, blockId: string): Lamport[] => ...
export const activeBlockParentId = (state: CachedState, blockId: string): string => ...
export const activeBlockSiblings = (state: CachedState, blockId: string): string[] => ...
export const activeBlockOrder = (state: CachedState, blockId: string): Block['order'] => ...
```

Naming can be `materialized*` instead of `active*`; use one convention consistently.

Update direct reads of `order.parent`.

In `src/block-crdt/index.ts`:

- `split` should find siblings from the materialized parent.
- new split-created blocks should use `currentMaterializedParentPath + [newBlock]`.
- split-created block order should get a fresh `order.id`.
- any helper that creates a block between siblings should accept a parent path rather than an immediate parent.

In `examples/block-rich-text/src/blockCommands.ts`:

- root moves write `[moved]`.
- indent writes `materializedBlockPath(previous) + [moved]`.
- unindent writes `materializedBlockPath(grandparent or root target) + [moved]`.
- incidental following-sibling moves write `materializedBlockPath(current) + [sibling]`.
- sibling index reads still use `order.index`.

Update test harness helpers in `src/block-crdt/index.test.ts` similarly.

## Phase 7: Incremental Cache Algorithm

After the rebuild implementation is correct, replace broad block-cache rebuilds on block insert/move with an incremental algorithm.

Required invariant:

```text
incremental cache after each op equals organizeState(state.blocks, state.chars, state.joins)
```

The challenge is that changing one block's raw path can change normalized paths for descendants whose raw paths reference that block. The affected set is not just the moved block's old and new materialized parents.

Suggested approach:

1. Maintain a reverse dependency map in cache:

```ts
rawPathChildren: Record<string, string[]>;
materializedBlockPaths: Record<string, Lamport[]>;
```

`rawPathChildren[parent]` contains blocks whose raw path declares `parent` as immediate parent.

2. On a block order change, compute an affected closure:
   - moved block,
   - blocks that raw-depend on the moved block,
   - recursively, blocks that raw-depend on those blocks.
3. Remove affected blocks from their old materialized parents in `blockChildren`.
4. Recompute normalized paths for only the affected closure, with access to unchanged memoized paths outside the closure.
5. Reinsert affected blocks under their new materialized parents and sort affected sibling arrays.
6. Update `rawPathChildren` for any changed raw immediate parent.

For cycle breaks, the affected closure may need to expand to every block in the detected cycle and all raw descendants of those blocks. If this becomes hard to reason about, use a conservative fallback for that op: rebuild the block cache and assert equality in tests.

Keep a development/test helper that compares incremental cache output to full `organizeState` after every generated operation.

## Phase 8: Tests

Update existing tests that assert immediate parents.

Replace:

```ts
lamportToString(block.order.parent)
```

with materialized parent helpers.

Add focused tests in `src/block-crdt/index.test.ts`.

Core path validation:

- root block path `[A]` materializes under root.
- nested path `[A, B, C]` materializes `C` under `B`.
- path with final id not matching moved block throws.
- path containing `[0, 'root']` throws.
- path with duplicate ids throws.
- missing moved block returns `false`.
- missing path ancestor returns `false`.

Order priority:

- later `BlockOrderTs` wins for same block.
- equivalent timestamp tie chooses lower `order.id`.
- incidental tuple timestamp ordering remains unchanged.

Concurrent reconciliation:

- `B: [A, B]` and `C: [B, C]` converge to `A / B / C` in both delivery orders.
- same test with 5+ blocks where the middle parent path changes and descendants preserve their suffixes.

Cycle breaking:

- reciprocal paths `A: [B, A]`, `B: [A, B]` converge with the lower `order.id` winner at root.
- three-block cycle converges and preserves reachability.
- 5+ item path where a parent or grandparent is cycle-broken still preserves remaining path items after reconciliation.
- cycle involving deleted or joined hidden ancestors remains traversal-safe.

Cache consistency:

- `cachedState(state.state)` reproduces the same cache.
- every visible non-joined block is reachable from root.
- no visible id appears twice in `visibleBlockOutline`.
- `stateToString(cachedState(editor.state.state))` remains stable in property tests.
- once incremental cache is implemented, every relevant unit/property test compares incremental cache to a full rebuild oracle.

Command-shaped tests:

- concurrent adjacent indents.
- concurrent unindents with incidental following-sibling reparenting.
- concurrent move-to-root versus nested reparenting.
- command helpers emit `order.id` values that are unique enough for deterministic ties.
- examples/block-rich-text block command tests pass with path-shaped move ops.

## Phase 9: Property Coverage

Extend existing block CRDT property tests so generated scripts include path-shaped block reparenting:

- move root block among root siblings,
- indent visible block under previous sibling,
- unindent visible block,
- unindent with incidental following-sibling reparenting.

After every script:

- assert visible traversal does not throw,
- assert every visible block is reachable,
- assert cache equals the full rebuild oracle,
- assert serialization via `cachedState(state.state)` matches the live state.

Add a smaller concurrent property/table if practical:

- generate two valid command batches from the same base state,
- apply left/right and right/left,
- assert materialized outline and parent maps converge.

## Phase 10: Public Surface Cleanup

Remove all production references to `order.parent`.

Search targets:

```sh
rg "order\\.parent|parent: \\[0, 'root'\\]|parent: ROOT|Block\\['order'\\]"
```

Expected remaining uses should be only:

- comments in task notes,
- tests intentionally documenting old behavior, if any remain during transition.

Update exports/imports if new helper functions become public API from `umkehr/block-crdt`.

Do not keep legacy parent compatibility code.
