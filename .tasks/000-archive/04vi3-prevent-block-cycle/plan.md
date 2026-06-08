# Plan: Cycle-Free Block Parenting

## Decisions From Research

- Use explicit block move records, following the join-record architecture.
- Keep the public op name as `block:move`; no backwards compatibility layer is needed.
- Each block move record gets its own actor-created Lamport id.
- `Block.order` should not remain as mutable active state. Replace it with an initial/static order field and derive the active order from block creation plus move records.
- Missing-parent moves remain pending by returning `false` from apply.
- Deleted and joined blocks may still be active parents in the raw parent graph. Visible traversal can continue to splice hidden parents' children upward.
- Self-parenting is an invariant violation, not an inactive record.
- If a cycle-completing move is rejected during derivation, the block falls back to its previous viable order record.
- Equivalent block-order priority ties are broken by lower Lamport move id.
- Expose debug/public helpers for active and rejected block move records.

## Phase 1: State and Type Model

Update `src/block-crdt/types.ts`.

Add a block move record type:

```ts
export type BlockMoveRecord = {
    id: Lamport;
    block: Lamport;
    parent: Lamport;
    index: LseqId;
    ts: BlockOrderTs;
};
```

Add block move storage to `State`:

```ts
blockMoves: Record<string, BlockMoveRecord>;
```

Replace mutable block order with an initial order:

```ts
export type Block = {
    id: Lamport;
    meta: ...;
    initialOrder: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
    deleted: boolean;
};
```

Update `Cache` with derived order metadata:

```ts
type Cache = {
    blockChildren: Record<string, string[]>;
    activeBlockMoves: Record<string, BlockMoveRecord>;
    rejectedBlockMoves: Record<string, BlockMoveRecord>;
    // existing char/join fields...
};
```

Use `activeBlockMoves` keyed by block id. Use `rejectedBlockMoves` keyed by move record id so all rejected facts can be inspected.

## Phase 2: Op Shape and Apply Semantics

Update `Op` in `src/block-crdt/index.ts` so `block:move` carries a full record:

```ts
| {type: 'block:move'; move: BlockMoveRecord}
```

Remove the old shape:

```ts
| {type: 'block:move'; id: Lamport; order: Block['order']}
```

Implement `applyBlockMoveRecord`.

Rules:

- Require `move.block` to exist. If not, return `false`.
- Require `move.parent` to exist unless it is `[0, 'root']`. If not, return `false`.
- Throw on self-parenting: `move.block === move.parent`.
- Be idempotent by move id.
- If the same move id is inserted with a different payload, throw, matching marks/splits/joins.
- Store every valid move record in `state.blockMoves`; do not mutate `state.blocks[blockId].initialOrder`.
- Update `maxSeenCount` from `move.id`, `move.block`, and `move.parent`.
- Rebuild the cache through `organizeState` after storing the record.

Update `applyBlock` so block creation stores only the block's initial order and does not LWW-merge order. Metadata and deletion behavior can remain as currently implemented.

## Phase 3: Active Block Order Derivation

Implement deterministic helpers in `src/block-crdt/index.ts`:

```ts
export const activeBlockMoveRecords = (
    state: State,
): Record<string, BlockMoveRecord> => ...

export const rejectedBlockMoveRecords = (
    state: State,
): Record<string, BlockMoveRecord> => ...

export const activeBlockOrder = (
    state: CachedState,
    blockId: string,
) => {index: LseqId; ts: BlockOrderTs; parent: Lamport};
```

Derivation algorithm:

1. For every block, create a baseline candidate from `block.initialOrder`.
2. Group all `state.blockMoves` by moved block.
3. Sort each block's candidates from strongest to weakest:
   - newer `BlockOrderTs` wins using existing `laterBlockOrderTs` semantics,
   - if equivalent, lower Lamport move id wins,
   - baseline candidates lose to explicit move records when priority is otherwise equal.
4. Build a global ordered candidate list. Preserve per-block priority while making the total order deterministic.
5. Accept at most one candidate per block.
6. Reject a candidate if adding `child -> parent` would create a cycle in the accepted parent graph.
7. When a candidate is rejected, continue to that block's next candidate so the block falls back to its previous viable order.
8. Every block must end with an active order. If no candidate can be accepted, that indicates a bug in the derivation and should throw.

Cycle test:

```text
adding child -> parent creates a cycle if parent already reaches child through accepted child -> parent edges
```

The root id `[0, 'root']` terminates traversal. Deleted and joined blocks participate normally in cycle detection because they can still be raw parents.

## Phase 4: Cache Construction and Traversal

Update `organizeState` to accept `blockMoves`:

```ts
organizeState(blocks, chars, joins, blockMoves)
```

Build `cache.blockChildren` exclusively from derived active block orders, not from raw `Block.initialOrder` alone and not from old mutable `Block.order`.

Sorting children:

- Use each child's active order index.
- Keep current `compareLseqIds` behavior.

Update callers:

- `cachedState`
- all apply paths that rebuild cache
- tests' `expectCache`

Update traversal/materialization to use active orders:

- `visibleBlockChildren`
- `visibleBlockOutline`
- `rootBlockIds`
- `stateToString`
- `materializeFormattedBlocks`

Keep visited-set cycle guards in traversal as defensive checks, but they should no longer trigger for valid states derived through the new cache.

## Phase 5: CRDT Operations That Create or Read Block Order

Update all CRDT helpers that create blocks or moves.

For block creation:

- Use `initialOrder` instead of `order`.
- Ensure initial blocks and split-created blocks get correct `initialOrder`.

For moves:

- Update split/unindent/indent/reorder helpers and test harness code to emit:

```ts
{
    type: 'block:move',
    move: {
        id: [state.state.maxSeenCount + 1, actor],
        block: current.id,
        parent,
        index,
        ts,
    },
}
```

For incidental block moves:

- Preserve the existing `BlockOrderTs = [baseTs, sourceSiblingIndex, ts]` behavior.
- When source sibling index is needed, read it from `activeBlockOrder(state, siblingId).index`.

Replace direct reads of `block.order` with helper reads:

- `activeBlockOrder(state, blockId)`
- `activeBlockParentId(state, blockId)` if useful
- `activeBlockIndex(state, blockId)` if useful

Likely affected files:

- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- any example code that reads `current.order.parent`, `current.order.index`, or `current.order.ts`

## Phase 6: Local Invariant Guards

Add direct validation before storing a block move record:

- self-parenting throws immediately
- missing parent returns `false`
- missing moved block returns `false`

Do not reject locally-descendant parent moves solely based on the current partial active graph. That check can be order-sensitive under concurrency. The authoritative cycle prevention happens in derivation.

If command-level UX wants to avoid generating obviously invalid moves, command helpers may no-op when the target parent is currently a descendant. That is an editor guard, not the CRDT invariant.

## Phase 7: Tests

Add focused tests in `src/block-crdt/index.test.ts`.

Core derivation tests:

- reciprocal moves `A -> B` and `B -> A` converge in both delivery orders
- three-block cycle `A -> B`, `B -> C`, `C -> A` rejects exactly one cycle-completing move and remains reachable
- rejected cycle move falls back to the block's previous viable move record, not always root
- acyclic concurrent moves preserve current LWW behavior
- incidental tuple timestamps still choose the same winner for one block
- equivalent-priority moves choose lower Lamport move id
- self-parenting throws an invariant error
- missing moved block returns `false`
- missing parent returns `false`
- deleted block can remain an active parent
- joined block can remain an active parent while visible traversal splices as before
- `cachedState(state.state)` reproduces the same cache, active moves, rejected moves, and serialization

Command-shaped tests:

- concurrent adjacent indents remain cycle-free
- concurrent unindents with incidental following-sibling reparenting remain cycle-free
- concurrent move-to-root versus nested move remains cycle-free
- command helpers emit `block:move` records with unique Lamport ids

Add test helpers:

```ts
expectNoActiveBlockParentCycles(state)
expectEveryVisibleBlockReachableFromRoot(state)
expectBlockMoveDerivationConverges(base, leftOps, rightOps)
blockParentIdsFromActiveOrders(state)
```

Update existing tests that assert raw `state.blocks[id].order.parent` to assert derived active parent ids instead.

## Phase 8: Property Coverage

Extend existing block CRDT property tests so generated editor scripts include:

- root reorder / move-to-root
- indent
- unindent
- split
- join
- delete
- insert

Per step, assert:

```ts
expectCache(state)
expectNoActiveBlockParentCycles(state)
expectEveryVisibleBlockReachableFromRoot(state)
expect(stateToString(state)).toBe(stateToString(cachedState(state.state)))
```

Add a smaller concurrent property/table test that:

1. Builds a base state.
2. Generates two valid editor-command move batches from that same base.
3. Applies them in both orders.
4. Asserts active parent maps, visible outlines, rejected move sets, and serialization converge.

## Phase 9: Documentation and Cleanup

Update docs/comments that describe block movement:

- `src/block-crdt/Readme.md`
- `src/block-crdt/notes.md`
- any inline comments near block move/order helpers

Rename Option D in the research doc if desired to clarify it is the end-state of the selected option:

```text
Option B2: Fully Derived Block Order
```

Remove obsolete helpers and assumptions:

- old `Block.order` reads
- old `applyBlockMove` LWW mutation path
- old cache updates that mutate `cache.blockChildren` incrementally from raw orders

## Phase 10: Validation

Run focused tests:

```sh
npm exec vitest src/block-crdt/index.test.ts
```

Run broader block CRDT tests:

```sh
npm exec vitest src/block-crdt
```

Run example tests affected by command updates:

```sh
npm exec vitest examples/block-rich-text/src
```

If package scripts provide a broader test command, run that after the focused suites pass.
