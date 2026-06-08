# Implementation Log: `organizeState` Optimization Candidates

## Progress

- Started implementation from `.tasks/04w33-optimize-block-crdt-organize/plan.md`.
- Current goal: keep the baseline as an oracle, add side-by-side parent-derivation strategies, stress-test them, then choose the production strategy.
- Extracted block parent derivation strategies:
  - `baseline`: current full-path materialization algorithm.
  - `linear`: linear cycle detection with full validation and parent-map output.
  - `string-cached`: linear parent-map strategy retaining path string arrays from validation.
  - `summary`: linear parent-map strategy retaining only raw parent summaries after validation.
- Refactored `organizeState` to build `blockChildren` from materialized parent ids rather than full materialized paths.
- Reworked `materializedBlockPath(s)` / `materializedBlockParent` to derive full paths on demand from parent maps.
- Refactored the stress harness to run all strategies side-by-side and assert candidate `blockChildren` output matches baseline.
- Initial side-by-side stress run:
  - `BLOCK_CRDT_STRESS=1 BLOCK_CRDT_STRESS_ITERATIONS=5 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose`
- A first 5-sample run suggested `string-cached` was the most consistent winner.
- The fuller default 11-sample run showed a more nuanced result:
  - `string-cached` was best on full-path and capped-chain path-heavy cases.
  - `summary` was close or faster on flat, many shallow/balanced cases, and cycle fixtures.
  - `summary` also retains less per-block allocation because it does not keep full `pathIds` arrays after validation.
- Selected `summary` as the production strategy because the expected common document shape is shallow and mostly balanced, and the plan's tie-breaker favored `summary` when close to `string-cached`.
- Verification passed:
  - `npm exec vitest -- src/block-crdt/index.test.ts examples/block-rich-text/src/blockCommands.test.ts`
  - `npm run typecheck`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm run typecheck:tests`
- Stress comparison passed:
  - `BLOCK_CRDT_STRESS=1 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose`

## Issues / Notes

- Full validation remains required in `organizeState`.
- `organizeState` must remain non-incremental and cache-independent.
- Variant 1 was useful as a foundation but not competitive enough as a production choice by itself, matching the concern that most blocks already have full materialized paths in ordinary documents.
- Sorting fast-path work was not implemented because the side-by-side runs moved flat/root-heavy cases comfortably under 10ms and the remaining wins were algorithmic/path-validation related.
