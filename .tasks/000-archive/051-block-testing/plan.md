# Plan: RGA+Blocks CRDT Test Suite

## Scope

Build out `src/block-crdt` test coverage around user-level editing behavior while adding the small implementation hooks needed for those tests to stay mostly black-box.

Primary outcomes:

- A `join` helper similar to `split`.
- `split` support for offset `0` and end-of-block empty-block cases.
- A multi-actor test harness for insert/split/join/delete/move scenarios.
- Deterministic tests for all CRDT operations.
- Convergence tests for concurrent edits, splits, joins, and block operations.
- Focused property tests for cache consistency, idempotency, and delivery-order convergence.

## Phase 1: Test Harness

Create a test-local editing harness, likely in `src/block-crdt/index.test.ts` first. Extract only if the file becomes unwieldy.

Harness responsibilities:

- Initialize a document with `initialState(actor, ts)`.
- Track deterministic timestamps per test.
- Support multiple actors for local character insertion.
- Convert visible block offsets to Lamport ids with `selPos`.
- Expose black-box operations:
  - `insert(actor, blockIndex, offset, text)`
  - `split(actor, blockIndex, offset)`
  - `join(actor, leftBlockIndex, rightBlockIndex)`
  - `deleteRange(blockIndex, start, end)`
  - `moveBlock(blockIndex, targetIndex)`
  - `setBlockMeta(blockIndex, meta)`
  - `archiveBlock(blockIndex)` / `restoreBlock(blockIndex)`
- Expose assertions:
  - `lines()` for visible root-level block text.
  - `serialized()` for `stateToString`.
  - `expectCache()` comparing incremental cache to `organizeState`.
  - `expectConverges(base, opBatchA, opBatchB, expectedLines)` for two-order and interleaved delivery checks.

Keep nesting out of scope for this suite unless a specific operation already needs it.

## Phase 2: Implement Missing Editing Helpers

### Split Boundaries

Update `split` so boundary positions are supported:

- `split(..., offset 0)` should create an empty previous sibling block.
- Splitting at the end of a block should create an empty following sibling block.
- Empty blocks should serialize as the block id followed by nothing after the colon.

Add tests before or alongside implementation so expected behavior is locked down.

### Join Helper

Add a public `join` helper next to `split`.

Expected shape:

- Takes two block ids and returns the ops needed to join them.
- Left block survives.
- Left block metadata/status/order win.
- Right block is archived.
- The first visible/root char child of the right block is moved under the tail of the left block.
- Siblings of that first child are brought along using the same conceptual strategy as `split`.
- Causal ancestor information should be recorded in move timestamps so concurrent join/split of the same block can resolve correctly.
- Concurrent join and split targeting the same boundary resolve LWW.

Keep low-level op application behavior unchanged unless tests expose a clear correctness bug. In particular, dangling move parents are allowed.

## Phase 3: Deterministic Editing Tests

Add black-box examples that assert visible serialized output and cache consistency after each user-level operation.

Insertion:

- Insert at start, middle, and end.
- Insert from different actors at the same position.
- Insert multi-codepoint grapheme clusters.

Split:

- Split in the middle of linear text.
- Split at offset `0`.
- Split at end of block.
- Split repeatedly into three or more blocks.
- Split tree-shaped text after inserting into the middle of existing text.

Join:

- Join two adjacent linear blocks.
- Join after repeated splits.
- Join a block whose contents are tree-shaped.
- Join when left block is empty.
- Join when right block is empty.
- Join when both blocks are empty.

Delete:

- Delete first, middle, and last characters.
- Delete a full block's visible text.
- Verify deleted chars with visible descendants remain valid.

Block operations:

- Move block before/after root siblings.
- Archive and restore blocks.
- Change block metadata.
- Confirm split block inherits source block metadata at split time.

## Phase 4: Concurrent Scenario Matrix

For each case, generate operation batches from the same base state and apply:

- Batch A then batch B.
- Batch B then batch A.
- A few causal interleavings for multi-op helpers like `split` and `join`.

Assert identical `lines()` / `serialized()` and cache consistency.

Cases:

- Insert vs insert at same position.
- Insert before split point vs split.
- Insert at split point vs split.
- Insert after split point vs split.
- Delete before split point vs split.
- Delete split-point char vs split.
- Delete after split point vs split.
- Split vs split at same position.
- Split vs split at adjacent positions.
- Split vs split across different branches of a character tree.
- Join vs insert into left block.
- Join vs insert into right block.
- Join vs split of left block.
- Join vs split of right block.
- Join vs join over overlapping block pairs.
- Block move vs split inside moved block.
- Block move vs join involving moved block.
- Block archive/status vs insert, split, and join.
- Block meta change vs split.

## Phase 5: Low-Level Op Contract Tests

Keep these tests small and explicit because they intentionally inspect the op layer.

Cover:

- Missing char insert parent behavior.
- Missing `char:move` char behavior.
- `char:move` with missing new parent remains allowed.
- Missing block for `block:move`, `block:status`, and `block:meta`.
- Duplicate char insert with same text is idempotent.
- Duplicate char insert with different text throws.
- Duplicate block insert merges field-by-field by timestamp.
- Stale moves/status/meta updates are ignored.
- Reapplying delete/status/move/join/split batches is idempotent where expected.

## Phase 6: Property Tests

Use `fast-check` with small bounds and deterministic seeds.

Initial properties:

- Cache invariant: after every generated operation, `state.cache` equals `organizeState(state.state.blocks, state.state.chars)`.
- Cache rebuild invariant: `stateToString(state)` equals `stateToString(cachedState(state.state))`.
- Visibility invariant: no visible character appears more than once.
- Block invariant: every non-archived root block appears once in root order.
- Convergence invariant: causal permutations of the same generated op batches produce the same serialized text.
- Idempotency invariant: replaying delivered ops does not change serialized text after first application.

Start with conservative generation:

- 1-3 actors.
- 1-4 root blocks.
- 1-20 visible characters.
- 1-20 operations.
- Operations limited to insert, split, join, delete, archive/restore, and metadata changes.

Expand only after failures are easy to diagnose.

## Phase 7: Verification

Run targeted tests first:

```sh
npm exec vitest run src/block-crdt/index.test.ts
```

Then run broader checks if the targeted suite passes:

```sh
npm exec vitest run
npm run typecheck
```

If the full suite is too slow during development, run the targeted block-crdt test on each iteration and save full-suite/typecheck for the final pass.

## Implementation Order

1. Add the harness and cache/serialization helpers.
2. Add failing tests for split boundary behavior.
3. Implement split boundary support.
4. Add failing tests for basic join behavior.
5. Implement `join`.
6. Add deterministic editing tests.
7. Add concurrent matrix tests.
8. Add low-level op contract tests.
9. Add bounded property tests.
10. Run targeted and final verification.

## Non-Goals

- Arbitrary nested block behavior beyond ensuring existing root-level behavior is not broken.
- A production op queue for pending causal dependencies.
- Rich text marks or formatting behavior.
- UI/editor integration tests.
