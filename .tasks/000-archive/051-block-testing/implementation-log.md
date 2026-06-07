# Implementation Log: RGA+Blocks CRDT Testing

## 2026-06-05

- Started implementation from `plan.md`.
- Phase 1/2 in progress:
  - Add a test-local editing harness.
  - Add split boundary behavior for empty previous/following sibling blocks.
  - Add a `join` helper so merge scenarios can be tested through user-level operations.
- Added `Op` export for test/helper typing.
- Added optional actor support to `addChars`.
- Implemented split boundary behavior:
  - Offset `0` creates an empty previous sibling.
  - End-of-block split creates an empty following sibling.
- Implemented `join(left, right, ts, actor)`:
  - Left block survives.
  - Right block contents move under the left tail.
  - Later right-root siblings are moved along with tuple timestamps.
  - Right block is archived.
- Added a test-local `EditorHarness` and deterministic tests for multi-actor insertion, grapheme insertion, boundary splits, joins, tree-shaped joins, range deletes, and dangling move parents.
- Verification checkpoint: `npm exec vitest run src/block-crdt/index.test.ts` passed with 26 tests.
- Added concurrent convergence tests for:
  - concurrent inserts at the same position
  - insert before/after split point vs split
  - join vs insert into left/right block
  - join vs split of left/right block
- Added a bounded `fast-check` generated editing script test for cache and serialization rebuild invariants.
- Verification checkpoint: `npm exec vitest run src/block-crdt/index.test.ts` passed with 31 tests.
- Verification checkpoint: `npm run typecheck` passed.
- Full-suite verification: `npm exec vitest run` failed outside `src/block-crdt` in existing `examples/react-crdt` React tests with invalid-hook-call / `useState` null dispatcher errors.

Issues encountered:

- Targeted test run exposed one incorrect expected value in the new concurrent join/right-split test. The implementation produced `abcde` / `f`, which is correct for a concurrent join of `ef` into `abcd` and split-before-`f`; updated the expectation.
- Full-suite Vitest is currently blocked by unrelated example React test failures:
  - `examples/react-crdt/src/apps/todos/TodoItem.test.tsx`
  - `examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx`
  - `examples/react-crdt/src/lib/solo/solo-render.test.tsx`
