# Research: Block Parent Ancestry Paths

## Goal

Explore whether `block:move` and `Block.order.parent` can store a full target ancestry path instead of only the immediate parent, so block parent cycles can be detected and resolved without retaining an immutable log of every historical block move.

The motivating alternative to `.tasks/04vi3-prevent-block-cycle/plan.md` is:

- keep the current "one winning order per block" shape,
- include enough parent-path context in each order value to reconstruct the move's intended ancestry,
- normalize/rebase those paths at cache/materialization time,
- detect cycles during that normalization and break them deterministically.

## Current State

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`
- `examples/block-rich-text/src/blockCommands.ts`

Today `Block.order` stores an immediate parent only:

```ts
type Block = {
    id: Lamport;
    order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
    deleted: boolean;
    // ...
};
```

`block:move` has the same order payload:

```ts
{type: 'block:move'; id: Lamport; order: Block['order']}
```

`applyBlockMove` is a per-block LWW-ish register update:

1. find the moved block by `op.id`,
2. ignore the op unless `laterBlockOrderTs(op.order.ts, current.order.ts)` wins,
3. replace `current.order`,
4. update `cache.blockChildren` by removing the block from its old parent and inserting it under `op.order.parent`.

`applyBlock` also merges a reinserted block by taking the later order timestamp. `cachedState(state.state)` rebuilds `cache.blockChildren` directly from each block's stored `order.parent`.

Traversal has defensive cycle guards:

- `visibleBlockChildren(state, parent)` throws on recursive parent traversal cycles.
- `visibleBlockOutline(state)` has the same style of guard.
- `rootBlockIds(state)` delegates to `visibleBlockChildren`.

There is no raw parent-graph invariant that prevents cycles before traversal.

## Path Model

Replace the immediate parent field with, or supplement it by, a target path:

```ts
type BlockOrderPath = Lamport[]; // root omitted; includes ancestors and the block itself

type BlockOrder = {
    path: BlockOrderPath;
    index: LseqId;
    ts: BlockOrderTs;
};
```

Examples:

- Root block `A`: `[A]`
- `B` under `A`: `[A, B]`
- `C` under `B`: `[A, B, C]`

The block's materialized parent is the path element before the block. A single-element path means root.

For compatibility during migration or implementation, the shape could be:

```ts
type BlockOrder = {
    parent: Lamport; // derived or legacy immediate parent
    path: Lamport[];
    index: LseqId;
    ts: BlockOrderTs;
};
```

But the conceptual source of truth should be `path`, otherwise the cycle-prevention work stays split between two fields that can disagree.

## Command Semantics

Commands can construct paths from current materialized state:

- move to root: `[moved]`
- indent `B` under previous sibling `A`: `path(A) + [B]`
- unindent `B` from `A/B` to `A`'s parent: `path(parent(A)) + [B]`
- incidental following-sibling move under `B`: `path(B) + [sibling]`

This makes local and non-interleaved remote cases trivial. If user 1 indents `B` under `A`, the winning order for `B` stores `[A, B]`. If user 2 later indents `C` under `B` after seeing that move, `C` stores `[A, B, C]`.

The interesting case is concurrent path mismatch. Starting with root siblings:

```text
A
B
C
```

If user 1 indents `B` under `A` and user 2 concurrently indents `C` under `B`, the stored winning paths may be:

```text
B: [A, B]
C: [B, C]
```

At materialization, `C`'s path can be normalized to `[A, B, C]` because `B` has a stronger/current materialized path.

## Materialization Algorithm

Build `cache.blockChildren` from normalized paths, not directly from stored immediate parents.

A conservative algorithm:

1. Select one raw order per block using existing `laterBlockOrderTs` behavior. This stays close to the current single-register model.
2. Validate each raw path:
   - it must be non-empty,
   - it must end with the block id,
   - it must not contain duplicate ids,
   - every non-root path segment should refer to an existing block, unless missing-parent pending behavior is still required at apply time.
3. Normalize each block's path by recursively normalizing its declared immediate parent path:
   - raw path `[A, B, C]` declares immediate parent `B`,
   - materialized path becomes `normalizedPath(B) + [C]`,
   - if the declared parent is missing, archived, joined, or invalid, use a deterministic fallback.
4. During recursive normalization, detect whether the current block is already on the stack.
5. If a cycle is found, break it with a deterministic winner rule, then re-run or continue normalization with the losing edge treated as invalid.
6. Populate `cache.blockChildren` from the final normalized immediate parent for every block.
7. Sort siblings by each block's winning order `index`, preserving the current `compareLseqIds` behavior.

The simplest fallback is root:

```text
if B's parent edge is rejected, materialized path(B) = [B]
```

The more semantically faithful fallback is "use the longest valid prefix of the raw path":

```text
raw [A, B, C], but B cannot be accepted under A
=> normalize B first, then C follows normalized B
```

For cycles, the user-suggested example works:

```text
raw A: [B, A]
raw B: [A, B]
```

If `A` wins the cycle break, reject `A`'s edge to `B` and materialize:

```text
A: [A]
B: [A, B]
```

If `B` wins instead, materialize:

```text
B: [B]
A: [B, A]
```

The deterministic winner rule matters for convergence. Candidate rules:

- lower block Lamport id becomes the root of the broken cycle,
- lower winning order timestamp becomes the root,
- lower actor-created move id, if a move id is added,
- lower block id plus `BlockOrderTs` as a tie-breaker.

Without immutable move records, there is no independent move id unless `block:move` gains one. If the goal is to avoid a move log but not necessarily avoid move ids, adding `order.id` would improve tie-breaking and debugging.

## Comparison With Move-Record Plan

The move-record plan in `.tasks/04vi3-prevent-block-cycle/plan.md` provides a stronger historical model:

- every valid move is retained,
- active order is derived from all candidates,
- if the strongest candidate creates a cycle, the block can fall back to its previous viable order record.

Path storage can avoid the immutable move log, but it changes what "fallback" means:

- Each block keeps only its current winning path.
- If that path's parent edge is rejected during normalization, there may be no previous order for that same block to fall back to.
- The fallback must be root, longest-valid-prefix, or another derived rule based only on current winning paths.

That tradeoff is probably acceptable if the desired invariant is "materialized block tree is convergent and cycle-free" rather than "rejected move reveals the previous viable user move for that block."

The path model also gives better context than immediate parents:

- Adjacent concurrent indents can reconcile naturally.
- A block can follow its declared parent after that parent's own path changes.
- Cycle detection happens over intended ancestry, not just local immediate edges.

But it does not preserve all move history. If a block's latest path is rejected, the system cannot recover that block's older path unless it is stored somewhere else.

## Apply-Time Semantics

`applyBlockMove` can stay close to current behavior:

- require the moved block to exist, otherwise return `false`,
- require path ids to parse and path to end in the moved block id,
- probably require every path segment except root to exist, otherwise return `false`,
- ignore if `order.ts` does not beat the current order,
- store the new `order.path`,
- rebuild cache through `organizeState` instead of incrementally moving one child between parent buckets.

Incremental cache updates become fragile because a move to one block can change the normalized parent of descendants whose own raw path references that block. For example:

```text
B raw path changes from [B] to [A, B]
C raw path remains [B, C]
```

`C`'s materialized parent is still `B`, but its materialized depth/path changes. Other cases can change fallback decisions for descendants. Rebuilding `blockChildren` in `organizeState` is simpler and more reliable.

`applyBlock` should merge block creation/reinsertion the same way it does today, but with `order.path` replacing `order.parent` as the winning value.

## Handling Deleted And Joined Blocks

The current traversal treats deleted/joined blocks as hidden parents and splices their children upward. The path model can preserve that:

- deleted blocks may still appear in raw and normalized paths,
- joined blocks may still appear in raw and normalized paths,
- cycle detection should include hidden blocks,
- visible traversal can continue to splice children through hidden parents.

This matches the move-record plan's recommendation that deleted and joined blocks still participate in raw parent structure.

One subtlety: if a path contains a joined block whose active join points it into another block's text flow, the block-parent tree should still treat it as a block id. Joins should not rewrite block ancestry paths unless a separate product decision says joined blocks cannot parent visible descendants.

## Migration And Compatibility

If no backwards compatibility layer is needed, `Block.order.parent` can be replaced with `Block.order.path`.

If existing serialized fixtures or examples need a gentler transition:

- accept legacy `parent`,
- synthesize `path` during `cachedState` or migration by walking current parent links,
- write new ops with `path`,
- eventually remove direct reads of `order.parent`.

Affected direct reads include:

- `applyBlockMove`
- `applyBlock`
- `organizeState`
- `stateToString`
- block traversal helpers through `cache.blockChildren`
- `split` / `join` helpers near the lower half of `src/block-crdt/index.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- tests that assert `state.blocks[id].order.parent`

Command helpers should use an `activeBlockPath(state, blockId)` or `materializedBlockPath(state, blockId)` helper rather than rebuilding paths ad hoc from raw stored orders.

## Test Cases

Add focused tests in `src/block-crdt/index.test.ts`.

Core path normalization:

- root block path `[A]` materializes under root,
- nested path `[A, B, C]` materializes `C` under `B`,
- path with wrong final block id throws or returns pending according to chosen validation policy,
- path with duplicate ids is rejected or normalized deterministically.

Concurrent reconciliation:

- user 1 stores `B: [A, B]`, user 2 stores `C: [B, C]`; materialized outline converges to `A / B / C`.
- same ops delivered in both orders produce identical `cache.blockChildren`, `visibleBlockOutline`, and `stateToString`.

Cycle breaking:

- reciprocal paths `A: [B, A]` and `B: [A, B]` converge and reject exactly one edge.
- three-block cycle `A: [C, A]`, `B: [A, B]`, `C: [B, C]` converges and remains fully reachable.
- cycle involving a deleted or joined hidden block does not throw in visible traversal.

Fallback behavior:

- rejected edge falls to root if root fallback is chosen.
- descendant paths follow the normalized parent after that fallback.
- sibling ordering remains stable by `order.index` after normalization.

Cache consistency:

- `cachedState(state.state)` reproduces the same cache and materialized outline.
- no visible block id appears twice in `visibleBlockOutline`.
- every visible non-joined block is reachable from root.

## Recommendation

The ancestry-path approach is viable as a simpler alternative if the accepted invariant is:

```text
the materialized block tree is deterministic, convergent, cycle-free, and keeps blocks reachable
```

It is not equivalent to the immutable move-record plan if the desired invariant includes:

```text
when the latest move is rejected, restore the block's previous viable move
```

Without a move log, that previous viable move is unavailable. The path model should therefore define an explicit fallback policy, probably "cycle loser becomes root" or "cycle loser uses longest valid prefix." I would prefer "cycle loser becomes root" for implementation clarity and testability, unless preserving apparent nesting through partial prefixes is product-critical.

The most important implementation detail is to make `organizeState` the authoritative normalization point. Storing paths but continuing to incrementally maintain `cache.blockChildren` from immediate parent fields would keep most of the current cycle/reconciliation risk.

## Open Questions

- Should `Block.order.path` include the moved block id, or store only ancestor ids? Including the block id makes validation easier and examples clearer.
    - including the block id
- Is root represented by an omitted root, a leading `[0, 'root']`, or a single-element block path? Omitting root avoids mixing sentinel ids with real block ids.
    - omitted
- What is the deterministic cycle winner rule? Lower block Lamport id is simplest; lower move/order id is more semantically tied to the operation but requires adding an id.
    - let's add a lamport order id
- Is adding an `order.id` acceptable even if we do not store a move log?
    - yes
- When a raw path references a missing parent, should `applyBlockMove` return `false` as pending, or should materialization fall back? Current CRDT apply behavior returns pending for missing moved blocks and other missing dependencies in several paths.
    - return false
- What should happen when the latest path for a block is rejected and there is no previous path? Root fallback, longest valid prefix, or hidden "initial path" fallback?
    - the first path for a block will be valid by construction
- Should rejected/normalized paths be exposed for debugging, like `rejectedBlockMoveRecords` in the move-record plan?
    - no
- Do deleted and joined blocks remain valid path ancestors forever? This matches current hidden-parent traversal, but should be confirmed.
    - yes
- Should direct malformed paths be invariant errors, pending ops, or silently normalized?
    - a direct path with multiple instances of an ID should be rejected as an invariant error
- Does path normalization need to preserve all visible blocks as reachable from root, even when every edge in a cycle has the same priority?
    - every visible block should end up with a valid path. This should fall out naturally from the algorithm. If it doesn't, stop and tell me about it

## Comments

> If a block's latest path is rejected, the system cannot recover that block's older path unless it is stored somewhere else.

That's not really true; if a block's latest path is rejected, it's because some other path for that block one. (or for a parent of that block).

> Rebuilding `blockChildren` in `organizeState` is simpler and more reliable.

It's also unacceptably expensive to do for production code. We can have it for an initial implementation, and to verify correctness in tests, but we do need to come up with an incremental algorithm that is rock-solid.

> Test Cases

Let's make sure we have some test cases for a path with 5+ items where a parent or grandparent is invalid/cycle-broken. We'll want to test that the remaining path items are preserved after reconciliation.
