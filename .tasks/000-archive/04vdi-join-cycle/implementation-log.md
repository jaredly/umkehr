# Implementation Log: Join Records and Cycle-Free Materialization

## Phase 1: Types and State Shape

- Started by auditing `src/block-crdt` and `examples/block-rich-text` for direct assumptions about `State`, `Cache`, `Block.deleted`, and stored join sentinel chars.
- Noted that tests and examples often compare `state.cache` to `organizeState(state.state.blocks, state.state.chars)`. The implementation should keep `organizeState` backward-compatible, but callers that need join-aware caches must pass `state.state.joins`.
- Decided to keep `Block.deleted: boolean` for now. Explicit deletion timestamping is separable from join-cycle prevention, and changing it would add broad test/type churn before the join record model is proven.

## Phase 2: Join Records and Active Join Derivation

- Added `JoinRecord`, `State.joins`, `Cache.joinSentinels`, and `Cache.joinedBlocks`.
- Added `join-record` ops and idempotent `applyJoinRecord`.
- Fixed existing apply paths that destructured state so they preserve `joins`.
- Added active join derivation sorted by lower Lamport join id. A candidate join is skipped if its right block already has an accepted join or if adding its `right -> left` edge would create a cycle.
- Added derived join sentinels in `organizeState(blocks, chars, joins)`. The old two-argument form remains valid and returns empty join metadata.
- Changed `join()` to emit a single `join-record` op instead of a stored sentinel `char` plus `block:delete`.

Issues/workarounds:

- Kept explicit block deletion as a boolean for this pass. Joins no longer use it, which is enough to prevent losing joins from irreversibly hiding blocks.
- Added defensive cycle checks to `findTail` and visible block traversal while working through derived graph behavior.

## Phase 3: Traversal, Tests, and Example Follow-Through

- Updated char traversal helpers to treat derived join sentinels as deleted empty chars.
- Updated `rootBlockIds`, `stateToString`, and formatted materialization to use derived visibility instead of only checking `Block.deleted`.
- Added regression tests for reciprocal two-block joins and three-block join cycles. Both resolve by lower Lamport join id and preserve visible text.
- Updated block-rich-text cache assertions to include `state.state.joins`.
- Fixed retained selection resolution over joined content.

Issues/workarounds:

- `selPos` initially crashed when traversing a derived sentinel because the sentinel id exists in `cache.charContents` but not in `state.chars`. The fix is to traverse through missing/deleted char records without counting them as visible text.
- Retained selection initially resolved one offset too far inside joined content for the same reason: missing sentinel ids were counted as visible by an optional-chain check. The example now counts only stored, non-deleted chars.

## Verification

- `npm exec vitest src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` passed.
- `npm exec vitest src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/retainedSelection.test.ts` passed.
- `npm run typecheck` passed.
- `npm exec vitest` still fails in unrelated `examples/react-crdt` React rendering tests with `Invalid hook call` / `Cannot read properties of null (reading 'useState')`.
  - Failing files: `examples/react-crdt/src/apps/todos/TodoItem.test.tsx`, `examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx`, and `examples/react-crdt/src/lib/solo/solo-render.test.tsx`.
  - The rerun had no remaining `src/block-crdt` or `examples/block-rich-text` failures.
