# Implementation Log: Block Parent Ancestry Paths

## Progress

- Started implementation from `.tasks/04vvl-block-path/plan.md`.
- Inventory found direct `order.parent` usage in:
  - core block apply/cache/split helpers,
  - block CRDT tests and local command test helpers,
  - `examples/block-rich-text/src/blockCommands.ts`,
  - example command tests.
- Implemented path-shaped `Block.order` with `order.id`, root-omitted `order.path`, and materialized parent helpers.
- Updated `initialState`, block creation, split-created blocks, block moves, and block-rich-text commands to emit path-shaped orders.
- Implemented rebuild-based `organizeState` materialization from normalized paths.
- Added focused tests for:
  - malformed path validation,
  - missing path dependencies returning `false`,
  - reciprocal and three-block cycle breaking,
  - 5-block suffix preservation after an ancestor cycle break,
  - equivalent timestamp tie-breaking with lower `order.id`.
- Focused tests passed:
  - `npm exec vitest -- src/block-crdt/index.test.ts examples/block-rich-text/src/blockCommands.test.ts`
- Type checks passed:
  - `npm run typecheck`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm run typecheck:tests`

## Issues / Notes

- Initial implementation will use full block-cache rebuilds for correctness. The incremental cache phase is tracked separately because it requires additional cache dependency metadata and oracle tests.
- Materialization uses a raw parent graph pass to reject the lowest `order.id` edge in each detected cycle, then normalizes paths recursively. This was simpler and more deterministic than trying to resolve cycles during recursive path expansion directly.
- `npm run typecheck:examples` did not complete because `examples/react/src/persistence.ts` cannot resolve `umkehr/migration`. The affected block-rich-text example typecheck passes when run directly.
- Full `npm exec vitest -- run` did not pass because existing React example tests fail with invalid hook call / `useState` on null dispatcher:
  - `examples/react-crdt/src/apps/todos/TodoItem.test.tsx`
  - `examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx`
  - `examples/react-crdt/src/lib/solo/solo-render.test.tsx`
- Phase 7's production incremental block-cache algorithm is not implemented yet. Current block insert/move apply paths rebuild the block cache via `organizeState`, which is correct and covered by tests but does not satisfy the production performance requirement from the plan.
