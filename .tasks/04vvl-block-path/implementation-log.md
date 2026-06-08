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
- Added opt-in organizeState stress tests in `src/block-crdt/organizeState.stress.test.ts`.
- Stress command:
  - `BLOCK_CRDT_STRESS=1 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose`
- Stress result on this machine:
  - flat graph crosses the 10ms p95 threshold around 4,000 blocks; median stayed under 10ms at 4,000 but p95 hit ~27ms.
  - balanced fanout-4 tree crosses 10ms around 4,000 blocks; median ~16ms.
  - compressed deep chain crosses 10ms between 500 and 1,000 blocks; 500 median ~7ms, 1,000 median ~27ms.
  - full ancestry deep chain crosses 10ms between 250 and 500 blocks; 250 p95 ~13ms, 500 median ~25ms.
  - many small reciprocal cycles with short tails remained under 10ms through 2,500 blocks in the default matrix.
- Added capped-depth path stress cases for max path depths 10, 25, and 50.
- Capped-depth stress result on this machine:
  - capped deep chains still cross 10ms between 500 and 1,000 blocks for depth 10; depth 25/50 are already around or over 10ms at 500 blocks.
  - capped balanced fanout-4 trees cross 10ms around 2,000 to 4,000 blocks by p95, depending on depth and run noise.
  - key takeaway: capping stored path length reduces validation/path-entry volume for full ancestry paths, but it does not fix the current deep-chain cost because normalization still walks the raw parent chain.

## Issues / Notes

- Initial implementation will use full block-cache rebuilds for correctness. The incremental cache phase is tracked separately because it requires additional cache dependency metadata and oracle tests.
- Materialization uses a raw parent graph pass to reject the lowest `order.id` edge in each detected cycle, then normalizes paths recursively. This was simpler and more deterministic than trying to resolve cycles during recursive path expansion directly.
- `npm run typecheck:examples` did not complete because `examples/react/src/persistence.ts` cannot resolve `umkehr/migration`. The affected block-rich-text example typecheck passes when run directly.
- Full `npm exec vitest -- run` did not pass because existing React example tests fail with invalid hook call / `useState` on null dispatcher:
  - `examples/react-crdt/src/apps/todos/TodoItem.test.tsx`
  - `examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx`
  - `examples/react-crdt/src/lib/solo/solo-render.test.tsx`
- Phase 7's production incremental block-cache algorithm is not implemented yet. Current block insert/move apply paths rebuild the block cache via `organizeState`, which is correct and covered by tests but does not satisfy the production performance requirement from the plan.
- First stress run used a deep matrix with 25 samples and took ~107s. I reduced the default matrix and added knobs:
  - `BLOCK_CRDT_STRESS_LEVEL=deep` for the larger exploratory matrix.
  - `BLOCK_CRDT_STRESS_ITERATIONS=<n>` for sample count.
