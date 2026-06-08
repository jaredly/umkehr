# Plan: Fix Join Losing Concurrent Start-of-Block Inserts

## Chosen Direction

Implement the sentinel-char variant from `ideas.md`.

When a block is joined into its previous sibling, create a tombstoned `Char` whose id is the joined block id. That char becomes the durable inline parent for the joined block's children. The block itself becomes irreversibly deleted, replacing the current reversible `status.archived` model with a `deleted: boolean`.

Because no migration or backwards compatibility is required, this can be implemented as a direct shape change to the block CRDT state and operation model.

## Target Semantics

- A block can be created once and deleted once.
- Block deletion is irreversible, like `char:delete`.
- A deleted block is omitted from block lists and formatted block output.
- Joining `rightBlock` into `leftBlock` creates a tombstoned sentinel char with `id = rightBlock.id`.
- The sentinel char is parented at the left block's current tail, or directly under the left block if the left block is empty.
- Existing and future direct children of `rightBlock.id` naturally render through the sentinel char's subtree without being reparented.
- The sentinel char never renders its own `text`, because it is tombstoned.
- Concurrent inserts at offset `0` in the joined block remain parented to `rightBlock.id`, but now `rightBlock.id` is also a char in the surviving block's character tree, so those inserts stay visible.

## Phase 1: Replace Block Status With Irreversible Deletion

Files:

- `src/block-crdt/types.ts`
- `src/block-crdt/initialState.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `examples/block-rich-text` files that inspect block archive state, if any

Steps:

1. Change `Block` from:

   ```ts
   status: {archived: boolean; ts: HLC};
   ```

   to:

   ```ts
   deleted: boolean;
   ```

2. Replace `block:status` with an irreversible delete op:

   ```ts
   | {type: 'block:delete'; id: Lamport}
   ```

3. Rename `applyBlockStatus` to `applyBlockDelete`.

4. Make `applyBlockDelete` idempotent:

   - return `false` if the block is missing, matching current pending behavior
   - return unchanged state if `deleted` is already true
   - otherwise set `deleted: true`

5. Update `applyBlock` conflict handling:

   - if a block already exists, preserve `deleted: current.deleted || block.deleted`
   - remove all status timestamp comparisons

6. Update block creation sites to use `deleted: false`.

7. Update `stateToString`, `rootBlockIds`, formatting helpers, and tests to filter by `!block.deleted`.

8. Delete or rewrite tests that assert reversible archive/restore behavior. The replacement test should assert:

   - deleting a block hides it
   - repeated delete is idempotent
   - applying a later duplicate `block` op cannot undelete it

## Phase 2: Add Sentinel Char Creation to Join

Files:

- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`

Steps:

1. In `join`, compute where the right block sentinel should be inserted into the left block's character tree:

   - if `leftRoots` is non-empty, use the tail of the left block's last root
   - otherwise use `leftBlock`

2. Emit a tombstoned char op before deleting the right block:

   ```ts
   char: {
       id: right,
       text: '',
       deleted: true,
       parent: {id: tail, ts}
   }
   ```

3. Make sure `applyChar` accepts a char whose id is the same Lamport as a block id. The char and block maps are separate, so the id collision is intentional.

4. Remove the current explicit `char:move` ops for the right block's children.

   The point of the sentinel is that existing children already parented to `rightBlock.id`, and future offset-0 insertions parented to `rightBlock.id`, are now reachable through the surviving left block's character tree:

   ```text
   left tail -> rightBlock sentinel/rightBlock id -> existing and future rightBlock roots
   ```

5. Emit `block:delete` for `rightBlock` after the sentinel char op.

6. Confirm `charToString` and `orderedCharIdsForBlock` already handle this shape:

   - deleted sentinel contributes no text
   - sentinel children are still traversed
   - `visibleOnly` excludes the sentinel id itself but still visits its descendants

7. Add an explicit unit test that inspects the post-join state:

   - `state.state.chars[rightBlockId]` exists
   - it is deleted
   - its parent is in the left block's character tree
   - `state.state.blocks[rightBlockId].deleted` is true

## Phase 3: Fix and Expand Join Convergence Coverage

Files:

- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`

Steps:

1. Keep the existing failing repro:

   ```ts
   join(left, right) || insert(right, 0, 'X') => ['abXcd']
   ```

2. Add the reverse order explicitly, even if `expectConverges` already covers both:

   - insert at offset `0` of right block
   - then apply join
   - expect `abXcd`

3. Add multi-character insertion at the start of the joined block:

   - `insert(right, 0, 'XY')`
   - expect `abXYcd`

4. Add empty-right-block coverage:

   - split or create an empty right block
   - concurrently insert at offset `0`
   - join should retain the concurrent text

5. Add left-empty coverage:

   - join an empty left block with a non-empty right block
   - ensure the sentinel can be parented directly under the left block id

6. Add chained join coverage:

   - blocks A, B, C
   - join B into A
   - join C into A or into the visible successor after B is deleted
   - concurrent insert at the start of B or C remains visible

7. Run:

   ```sh
   npm exec vitest -- src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts
   ```

## Phase 4: Audit Formatting, Marks, Splits, and Selection Helpers

Files:

- `src/block-crdt/index.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/utils.ts`
- `examples/block-rich-text/src/*.ts`

Steps:

1. Review `orderedCharIdsForBlock` with `visibleOnly: true`.

   The current traversal should skip the deleted sentinel itself while still walking children. Preserve that behavior.

2. Review `allCharIds`, `coveredCharIdsForMark`, `crossedSplitsBetween`, and `tailAfterSplitLeft`.

   These functions may see the sentinel id when `visibleOnly` is false. Decide whether that is desirable:

   - for structural traversal, including the sentinel may be useful
   - for user-visible mark coverage, deleted sentinels should not produce visible formatting runs

3. Confirm `hasJoinStyleParent` still means what it says.

   After this change, join-style structure is represented by a deleted sentinel char with a normal parent timestamp. The existing heuristic may need to detect deleted block-sentinel chars explicitly instead of relying only on parent timestamp shape.

4. Review `selPos` in `src/block-crdt/utils.ts`.

   Offset `0` in a joined/deleted block should still map to the block id. That remains useful because the block id is now a sentinel char after join.

5. Run the block-rich-text test suite after core tests pass:

   ```sh
   npm exec vitest -- examples/block-rich-text/src
   ```

## Phase 5: Remove Archive Terminology and Dead Paths

Files:

- `src/block-crdt/*`
- `examples/block-rich-text/*`
- task docs/tests as needed

Steps:

1. Rename local helper arguments from `includeArchived` to `includeDeleted`.

2. Update test names and assertions from "archive" to "delete" where they refer to block CRDT blocks.

3. Remove status timestamp logic that only existed to support reversible archive/restore.

4. Keep user-facing names outside the block CRDT alone unless they are directly tied to this model. Other apps use "archived" for unrelated domain data and should not be touched.

5. Run a focused grep before finishing:

   ```sh
   rg -n "block:status|status\\.archived|archived" src/block-crdt examples/block-rich-text
   ```

   Any remaining hits should be either unrelated app-level language or intentionally renamed later.

## Phase 6: Full Verification

Run the targeted and broader checks:

```sh
npm exec vitest -- src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts
npm exec vitest -- examples/block-rich-text/src
npm exec vitest
```

If the full suite is too slow or exposes unrelated failures, capture the focused passing results and note the broader-suite status separately.

## Implementation Notes

- Do not try to preserve old state shapes. Initial state, tests, and fixtures can move directly to `deleted: false`.
- Be careful with id ordering: `organizeState` sorts `charContents` by id string descending. The sentinel id is usually lower than later concurrent inserted chars, so offset-0 concurrent insertions under the sentinel should appear before existing right-block content.
- The sentinel char's `text` should be `''` to avoid accidental output if a future bug renders deleted text.
- The sentinel char should be emitted by `join` even if the right block is empty. That is what makes later offset-0 inserts into the deleted right block resolvable.
- The join batch should not reparent the right block's children. If the sentinel char has the right block id, those children are already under the correct parent for traversal.
- Joining an already-deleted block should probably be rejected at command construction time or produce no meaningful ops. Add a guard if current callers can reach that case.
- This plan intentionally changes block delete semantics globally. Tests that currently exercise restore-by-newer-status should be replaced, not preserved.
