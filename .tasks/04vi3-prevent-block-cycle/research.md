# Research: Prevent Block Parenting Cycles

## Goal

Architect `src/block-crdt` so block parenting cycles cannot become part of the materialized block tree.

The desired direction is similar to the join-cycle work: store structural intent as first-class records, then derive the active acyclic structure deterministically during cache/materialization. The CRDT should preserve all received facts, but public traversal should only see a cycle-free block parent graph.

## Current State

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/initialState.ts`
- `src/block-crdt/index.test.ts`
- `examples/block-rich-text/src/blockCommands.ts`

Blocks currently store their active parent directly on the block:

```ts
type Block = {
    id: Lamport;
    order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
    deleted: boolean;
    // ...
};
```

`block:move` is an LWW-style assignment for one block's `order`:

```ts
| {type: 'block:move'; id: Lamport; order: Block['order']}
```

`applyBlockMove` checks only that the target block exists and that the incoming `order.ts` wins over the current `order.ts`. If it wins, the block's parent is replaced and `cache.blockChildren` is updated incrementally.

There is no apply-time check that the new parent is not the moved block itself or a descendant of the moved block. There is also no global conflict resolution among multiple block parent edges.

Traversal has defensive cycle checks:

- `visibleBlockChildren(state, parent)` throws `block traversal cycle at ...` if recursion revisits a parent id.
- `visibleBlockOutline(state)` has the same visited-set guard.
- `rootBlockIds(state)` delegates to `visibleBlockChildren`.

Recent tests cover editor-command-shaped concurrent reparenting and show those scenarios are traversal-safe, but they do not make raw `state.blocks[*].order.parent` cycle-free by construction.

## Existing Join-Cycle Architecture

The join-cycle work has already moved joins in the right direction:

- joins are stored as `JoinRecord`s in `state.joins`
- `applyJoinRecord` is idempotent and does not mutate char parents or delete blocks directly
- `activeJoinRecords` sorts join records deterministically and accepts only edges that do not create cycles
- join sentinels and joined block visibility are derived in `organizeState`
- traversal reads from the derived cache, not from unconditional join side effects

That pattern is directly applicable to block parenting. The equivalent shift is: stop treating `Block.order.parent` as the already-resolved truth, and instead derive the active parent edge for each block from a set of block order/move records.

## Why Parent Cycles Are Still Possible

A block parent edge is directed from child to parent. A cycle exists when following parents from a block eventually returns to that same block.

Direct concurrent moves can encode a cycle because each move targets a different child, so there is no LWW conflict on a single register:

```text
A parent = C
B parent = A
C parent = B
```

Each individual assignment can be the latest assignment for its own child. `laterBlockOrderTs` never compares `A`'s parent assignment against `B`'s or `C`'s parent assignment, so the raw graph can become cyclic.

A simple local guard in `applyBlockMove` helps only for moves that are locally invalid against the current state, such as moving a block under its current descendant. It does not solve concurrent cycles because each replica may create a locally valid move from the same base tree, and the cycle only appears after merge.

This is the same shape as reciprocal joins before `JoinRecord`: each local operation is reasonable, but the merged graph needs deterministic global arbitration.

## Design Options

### Option A: Apply-Time Descendant Rejection Only

Before accepting a `block:move`, check whether `op.order.parent` is the moved block or is currently reachable as a descendant of the moved block. If so, ignore or reject the move.

Benefits:

- Small change.
- Prevents obvious local cycles.
- Useful command/API hygiene even if a stronger architecture is added later.

Limitations:

- Does not prevent cycles formed only after concurrent delivery.
- Can be order-sensitive if the decision depends on the partial local cache at apply time.
- Does not provide a deterministic loser for multi-edge cycles.

This is worth doing as a defensive local validation layer, but it is not enough for the stated goal.

### Option B: Store Block Move Records and Derive Active Parents

Introduce first-class block parent/order records, similar to join records:

```ts
type BlockOrderRecord = {
    id: Lamport;
    block: Lamport;
    parent: Lamport;
    index: LseqId;
    ts: BlockOrderTs;
};
```

Add a map to `State`:

```ts
blockOrders: Record<string, BlockOrderRecord>;
```

Then derive each block's active order during cache construction. The derivation should accept at most one parent edge per block and reject any edge that would create a parent cycle.

A deterministic derivation algorithm:

1. Build candidate order records for every block:
   - the block creation order as the baseline candidate,
   - all later `BlockOrderRecord`s for that block.
2. Sort candidates by block-order priority from strongest to weakest:
   - current `laterBlockOrderTs` semantics for `ts`,
   - deterministic tie-breaker by record id,
   - baseline creation order last for that block.
3. Maintain accepted edges `child -> parent`.
4. For each candidate:
   - skip if this child already has an accepted edge,
   - skip if the parent block is missing, unless the parent is root,
   - skip if adding `child -> parent` would create a cycle, i.e. parent already reaches child through accepted edges,
   - otherwise accept it.
5. After all candidates, every block should have either an accepted edge or a fallback root edge.

This preserves normal LWW behavior when the winning edges are acyclic. When the LWW winners would create a cycle, the lowest-priority cycle-completing edge loses and that block falls back to its next-best historical order candidate.

This is the recommended architectural direction.

### Option C: Keep `Block.order` as a Register but Repair in Cache

Leave `state.blocks[id].order` as the LWW register, but make `organizeState` derive an acyclic `blockChildren` cache by ignoring cycle-completing parent edges and splicing rejected blocks to root or to their previous known parent.

Benefits:

- Smaller state-shape change than Option B.
- Public traversal becomes cycle-free.

Limitations:

- The rejected edge still looks active in `state.blocks[id].order`.
- There may be no previous parent available, because overwritten orders are not retained.
- Repair-to-root is deterministic but loses semantic intent and makes raw state disagree with materialized state.
- Selection, formatting, examples, and future code may accidentally read raw `block.order.parent` and reintroduce the cycle.

This can be a migration bridge, but it is weaker than explicit order records.

### Option D: Make `block:move` Ops Immutable and Keep `Block.order` Derived

Take Option B further: make `Block` contain creation/static data only, and expose active order through helpers rather than `block.order` directly.

Possible shape:

```ts
type Block = {
    id: Lamport;
    initialOrder: {index: LseqId; ts: HLC; parent: Lamport};
    meta: ...;
    deleted: boolean;
};
```

`block:move` would insert a `BlockOrderRecord`; cache/materialization would expose `activeBlockOrders` and `blockChildren`.

This is the cleanest long-term model, but it has the largest call-site churn because current code reads `block.order.parent`, `block.order.index`, and `block.order.ts` directly in many places.

## Recommended Direction

Use explicit block order records and derive active acyclic parent edges during cache construction.

Concretely:

1. Add `BlockOrderRecord` to `src/block-crdt/types.ts`.
2. Add `blockOrders: Record<string, BlockOrderRecord>` to `State`.
3. Add an op variant:

```ts
| {type: 'block:order'; order: BlockOrderRecord}
```

4. Keep `block:move` temporarily as a compatibility op, but have it normalize to or apply as a block order record. Longer term, replace emitted `block:move` ops with `block:order` ops that have their own Lamport id.
5. Change `organizeState` to derive active block orders from block creation orders plus `state.blockOrders`.
6. Build `cache.blockChildren` from active orders only.
7. Add cache metadata for active/rejected order records if useful for debugging:

```ts
type Cache = {
    blockChildren: Record<string, string[]>;
    activeBlockOrders: Record<string, BlockOrderRecord>;
    rejectedBlockOrders: Record<string, BlockOrderRecord>;
    // existing char/join cache fields...
};
```

8. Update traversal and command code to use derived helpers for active parent/index instead of reading raw `block.order` directly.
9. Keep traversal visited-set checks as defensive protection for corrupted or legacy states.
10. Add a local apply/command guard that refuses self-parent and known-descendant moves, even though cache derivation remains the authoritative concurrency fix.

## Derivation Details

The key helper should be deterministic and independent of operation delivery order:

```ts
export const activeBlockOrderRecords = (state: State): Record<string, BlockOrderRecord> => ...
```

Cycle test for candidate `child -> parent`:

```text
adding child -> parent creates a cycle if parent already reaches child through accepted parent edges
```

Unlike joins, block order derivation needs fallback candidates. A skipped join simply becomes inactive. A skipped block parent edge still leaves the child needing a parent so it remains reachable. The baseline block creation order can serve as the guaranteed fallback.

Sorting choice should mirror existing block order semantics:

- A later `BlockOrderTs` is preferred over an earlier one.
- Incidental tuple timestamps should continue to compare with `laterBlockOrderTs` semantics.
- If two records have equivalent order priority, use the block order record id as a total deterministic tie-breaker.
- Creation baseline records should sort below move records unless their timestamp legitimately wins under the existing comparator.

The active order for each block should include both parent and LSEQ index, because moving a block changes both. If a parent edge is rejected, its index should be rejected with it; the fallback candidate supplies both parent and index.

## Migration Strategy

A low-risk migration path:

1. Add `blockOrders` to state while retaining `Block.order`.
2. Treat every existing `Block.order` as the baseline candidate for that block when no explicit records exist.
3. New `block:order` records are preferred according to the same timestamp rules.
4. During cache construction, compute active orders and `blockChildren` from the derived result.
5. Gradually move call sites from `block.order` to helper APIs:

```ts
activeBlockOrder(state, blockId)
activeBlockParentId(state, blockId)
visibleBlockChildren(state, parentId)
visibleBlockOutline(state)
```

6. Once call sites no longer depend on raw `block.order`, consider renaming it to `initialOrder` or removing mutable order from `Block` entirely.

This avoids requiring an immediate persisted-document migration while still preventing cycles in newly materialized caches.

## Affected Code

Likely affected areas:

- `State`, `Cache`, and `Op` types in `src/block-crdt/types.ts` and `src/block-crdt/index.ts`
- `initialState`
- `applyBlock`, `applyBlockMove`, and new `applyBlockOrderRecord`
- `cachedState` and `organizeState`
- `visibleBlockChildren`, `visibleBlockOutline`, `rootBlockIds`, `stateToString`, and `materializeFormattedBlocks`
- split helpers that create or move blocks
- example commands:
  - `moveBlock`
  - `indentBlock`
  - `unindentBlock`
  - any code that uses `current.order.parent` or `current.order.index`
- tests that assert raw `state.blocks[id].order.parent`

## Tests To Add

Start in `src/block-crdt/index.test.ts`.

Core derivation tests:

- direct reciprocal block order records `A -> B` and `B -> A` converge in both delivery orders and materialize one rejected edge
- three-block cycle `A -> B`, `B -> C`, `C -> A` deterministically rejects the lowest-priority cycle-completing edge
- a rejected cycle edge falls back to the block's previous/baseline order, keeping the block reachable from root
- acyclic concurrent moves retain existing LWW behavior
- incidental `BlockOrderTs` tuple ordering still determines the active record for a single block
- `cachedState(state.state)` reproduces the same derived cache and serialization

Command-shaped tests:

- concurrent adjacent indents remain acyclic
- concurrent unindents with incidental following-sibling reparenting remain acyclic
- concurrent move-to-root versus nested move remains acyclic
- local attempt to move a block under its descendant is ignored/rejected
- direct raw hand-authored cycle cannot surface through `rootBlockIds`, `visibleBlockChildren`, or `visibleBlockOutline`

Property coverage:

- generated editing scripts including split, join, delete, reorder, indent, and unindent always preserve cache consistency
- small concurrent batches of valid editor-command moves from the same base converge to the same visible outline and active parent map

Useful assertions:

```ts
expectNoActiveBlockParentCycles(state)
expectEveryVisibleBlockReachableFromRoot(state)
expectCache(state)
expect(stateToString(state)).toBe(stateToString(cachedState(state.state)))
```

## Open Questions

1. Should the new public op be named `block:order`, `block:move-record`, or should `block:move` be kept as the public wire format with an added record id?
    - block:move seems like the right name for it. No need for backwards compatibility.

2. What should the block order record id be for existing `block:move` callers: a new actor-created Lamport id, or should the moved block id plus `order.ts` be normalized into a deterministic synthetic id?
    - lamport id sounds right

3. When a cycle edge is rejected, should the child fall back to its previous active order, its creation order, or root? Retaining all order records enables previous-active fallback; legacy states may only have creation/current order available.
    - no need for backwards compatibility. previous order sounds good

4. Should missing-parent moves be pending, rejected, or accepted but inactive until the parent block arrives?
    - leave as pending (return false from the apply)

5. Should explicitly deleted or joined blocks be allowed as active parents? Current visible traversal splices hidden parents' children upward, but the active parent graph still needs a cycle-free rule that includes hidden blocks.
    - deleted blocks can be parents, yes

6. Should `Block.order` remain as a compatibility field long-term, or should it become `initialOrder` once active order is derived?
    - no need for backwards compatibility. 

7. What deterministic tie-break should be used when two block order records have equivalent `BlockOrderTs` priority? Lower Lamport id would match join's lower-id preference; higher Lamport id may feel more like LWW.
    - lower lamport id

8. Should self-parenting be treated as an invalid op that returns `false`, an ignored inactive record, or a thrown invariant violation?
    - invariant violation

9. Do we need a debug/public API to inspect rejected block order records, similar to how active joins are inspectable through `activeJoinRecords` and `joinedBlockIds`?
    - sure
