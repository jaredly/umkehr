# Research: RGA+Blocks CRDT Test Suite

## Goal

Build a comprehensive Vitest suite for `src/block-crdt` that exercises the RGA+blocks CRDT mostly through user-shaped operations: insert text, split blocks, join blocks, move blocks, delete text, and apply concurrent operations in different delivery orders. Assertions should prefer serialized document text/blocks over inspecting internals, while still checking cache invariants after each operation because `CachedState.cache` is part of the implementation's correctness boundary.

## Current Implementation Surface

The CRDT currently exposes these operations and helpers from `src/block-crdt/index.ts`:

- `apply` handles atomic ops:
  - `char`
  - `block`
  - `char:move`
  - `char:delete`
  - `block:move`
  - `block:status`
  - `block:meta`
- `applyMany` applies a batch and throws if any op is causally pending.
- `addChars` inserts grapheme segments after a Lamport position.
- `split` creates a following sibling block and reparents the split-point character plus later sibling subtrees.
- `stateToString`, `blockContents`, and `charToString` serialize visible text.
- `organizeState` rebuilds `cache`; useful as an invariant oracle.
- `selPos` maps a visible block offset to a Lamport char id.

Important behavior from the implementation:

- Character ordering is RGA/causal-tree style: children are sorted by descending Lamport string.
- `char:move` is last-writer-wins by `parent.ts`, except split incidental moves use tuple timestamps `[fromTs, ancestryPath, splitTs]`.
- `split` handles non-linear character trees by walking ancestors and moving later siblings under the new block's tail.
- `split` currently throws for `at.char === at.block`; Enter-at-start / empty previous sibling is explicitly unimplemented.
- There is no exported high-level `join` or `merge` helper. The existing join test manually emits `char:move` and `block:status` ops.
- `applyMany` does not queue causal dependencies; missing referenced records return `false` from `apply` and cause `applyMany` to throw.

## Existing Coverage

`src/block-crdt/index.test.ts` already covers:

- Basic character insertion and serialized text output.
- Inserting chunks and single chars at visible positions.
- `selPos` over both linear text and tree-shaped text.
- Simple split.
- Split across tree-shaped text at multiple positions.
- Manual split/move/join scenario.
- Concurrent split/split with delivery-order convergence in one case.
- Concurrent split over tree-shaped text with delivery-order convergence in one case.
- Concurrent edit and split convergence in one case.
- Block metadata LWW behavior.
- Block move LWW behavior and cache updates.
- Missing-record behavior for most op types.
- Idempotent char delete.
- Char move timestamp conflict behavior and stale duplicate char insert behavior.
- Duplicate block insert field-wise merge behavior.
- Block archive/restore by status timestamp.
- Cache consistency checks in many, but not all, scenarios.

This is a good start, but it is still example-driven and leaves several CRDT properties untested.

## Recommended Test Strategy

### 1. Test Through a Black-Box Editing Harness

Add a small test-local harness that exposes user-level operations:

- `insert(blockIndex, offset, text)`
- `split(blockIndex, offset)`
- `join(leftBlockIndex)` or `join(leftBlockIndex, rightBlockIndex)`
- `deleteRange(blockIndex, start, end)`
- `moveBlock(fromIndex, toIndex, parent?)`
- `lines()` returning visible block text only
- `serialized()` returning `stateToString`
- `expectCache()` comparing `state.cache` to `organizeState(...)`

The harness should hide Lamport ids except where tests intentionally exercise lower-level op conflict resolution. This keeps most assertions in terms of visible document behavior.

### 2. Deterministic Example Tests

Add explicit black-box cases for normal editing:

- Insert at start, middle, and end of a block.
- Insert multi-codepoint grapheme clusters and assert visible text, since `addChars` uses `Intl.Segmenter`.
- Split at middle, before first visible char, and after last visible char.
- Split repeatedly to create three or more sibling blocks.
- Join adjacent blocks after simple linear splits.
- Join blocks containing tree-shaped text.
- Join empty-left, empty-right, and both-empty blocks if empty blocks become supported.
- Delete first, middle, last, whole block text, and deleted chars with descendants.
- Move blocks before/after siblings and into nested parents.
- Archive/restore visible output using `stateToString`.

### 3. Concurrent Operation Matrix

For each scenario, generate ops from the same base state, then apply them in both orders and assert identical visible output plus cache consistency:

- insert vs insert at same position
- insert before split point vs split
- insert at split point vs split
- insert after split point vs split
- delete before split point vs split
- delete split-point char vs split
- delete after split point vs split
- split vs split at same position
- split vs split at adjacent positions
- split vs split across different branches of the causal tree
- join vs insert into left block
- join vs insert into right block
- join vs split of left block
- join vs split of right block
- join vs join over overlapping block pairs
- block move vs split inside moved block
- block move vs join involving moved block
- block status archive vs insert/split/join
- block meta change vs split, confirming new split block inherits the expected metadata

For high confidence, also apply each op batch in several interleavings, not just `[a, b]` and `[b, a]`, especially for `split` because it emits multiple ops.

### 4. Convergence and Idempotency Properties

Use `fast-check` for bounded randomized tests. The repo already depends on `fast-check`.

Recommended properties:

- Replaying the same op twice is idempotent where the CRDT claims it should be.
- Any permutation that preserves causal dependencies converges to the same serialized text.
- Incremental cache stays equal to `organizeState` after every applied op.
- `stateToString` should be stable after rebuilding cache with `cachedState(state.state)`.
- Visible character count equals the count of non-deleted chars reachable from visible blocks.
- No visible character appears more than once after split/join/move sequences.
- Every non-archived root block appears once in root order.

Start with small bounds: 1-3 actors, 1-4 blocks, 1-20 visible chars, 1-20 operations. That should find ordering bugs without making failures impossible to minimize.

### 5. Causal Delivery Tests

Because `apply` returns `false` for missing dependencies, tests should document current delivery assumptions:

- Applying a `char` before its parent exists returns `false`.
- Applying a `char:move` before the char exists returns `false`.
- Applying a `char:move` before the new parent exists currently does not appear to validate parent existence directly; this should be tested and either accepted or fixed.
- Applying split ops out of order should either fail predictably or converge after causal ordering is restored.

If the intended system has an op queue elsewhere, keep these as unit tests for `block-crdt`'s local contract rather than trying to test eventual delivery here.

## Join/Merge Coverage Gap

The task asks for split, merge, and concurrent edit scenarios. In the current codebase, "merge/join" exists only as a manual composition in the test:

1. Move the right block's first char under the left block's tail.
2. Move any intermediate block contents as needed.
3. Archive merged-away blocks with `block:status`.

There is no exported `join` helper equivalent to `split`. A comprehensive black-box test suite would benefit from adding a small public or test-local `join` operation builder. Without that, tests can still cover join behavior, but they will be more white-box because they must construct `char:move` and `block:status` directly.

## Suggested File Layout

- Keep focused unit/example tests in `src/block-crdt/index.test.ts`, or split into:
  - `src/block-crdt/apply.test.ts`
  - `src/block-crdt/editing.test.ts`
  - `src/block-crdt/convergence.test.ts`
- Put the black-box editing harness in the test file first. Extract it only if it becomes shared.
- Avoid snapshot tests for full state. Prefer `lines()`, `stateToString()`, and invariant helpers.

## Open Questions

- Should `split` at offset `0` create an empty previous sibling, an empty current block before existing text, or remain unsupported?
    - let's create an empty previous sibling block
- Should splitting at the end of a block create an empty following block?
    - yes
- What is the intended high-level API for join/merge? Should implementation add `join(...) => Op[]`, or should tests keep building joins manually?
    - Let's make a `join` helper similar to the `split` helper. It should take two block ids and return the ops that would affect the join operation. Note that siblings of the first character child of the block should be brought along during the join using a similar strategy to the `split` helper; with causal ancestors being recorded in the timestamp, just that a concurrent join & split of the same block is handled correctly.
- When joining, should the surviving block keep the left block's metadata/status/order, or should metadata merge by timestamps?
    - left block wins
- How should concurrent join and split resolve when they target the same boundary?
    - LWW
- Should `applyCharMove` reject moves whose new parent id does not exist yet, or is dangling-parent acceptance intentional for later causal repair?
    - let's allow them
- Are actor ids in `addChars` intentionally hardcoded to `'self'`, or should the test harness support multi-actor local insertion without manual `charOp` construction?
    - let's support multi-actor
- Should block children support arbitrary nesting as part of this suite, or is the near-term scope root-level blocks only?
    - arbitrary nesting shouldn't impact the correctness of the crdt, so let's stay single-level for simplicity
- What exact serialized form should empty blocks have in `stateToString`?
    - the block id followed by nothing
- Are deleted chars with visible descendants valid and expected, or should deletion cascade/normalization exist at a higher layer?
    - yes, they are valid

## Next Step

Before implementing the suite, decide the expected behavior for start/end splits and whether to add a real `join` op builder. Those choices affect a large fraction of the black-box tests and determine whether merge scenarios can stay user-level instead of op-level.
