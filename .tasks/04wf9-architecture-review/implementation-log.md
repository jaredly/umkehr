# Implementation Log

## 2026-06-08

- Started phased implementation for the `src/block-crdt` architecture review plan.
- Confirmed the working tree was clean before edits.
- Initial approach: keep changes small and verifiable, beginning with Phase 1 tests and the Phase 2 apply-result API those tests require.
- Added `applyRemote` with explicit `applied`/`ignored`/`pending`/`invalid` statuses while preserving the existing strict `apply`/`applyMany` shape.
- Changed missing-parent `char:move` and `char` insert behavior to return pending/`false` instead of accepting unresolved parent links into state.
- Fixed semantic Lamport ordering for char child lists so counters above `9999` sort by Lamport values instead of encoded string order.
- Added tests for pending missing dependencies and Lamport counters above the old 4-digit padding width.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts`.
- Added `applyStrict`, `applyManyStrict`, and `applyRemoteMany` helpers.
- Added actor/Lamport validation that rejects actor ids containing `-`.
- Added tests for retryable pending remote batches, strict local apply helpers, and actor id validation.
- Verified again with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts`.
- Added `maxLamportCounterForOp` and wired apply handlers through it so all Lamports in op payloads contribute to future local id allocation.
- Added coverage for Lamports embedded in incidental char parent timestamps.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts`.
- Added named version comparators (`compareCharParentVersions`, `charParentVersionWins`, `compareBlockOrderVersions`, `blockOrderVersionWins`) and routed existing conflict checks through them.
- Added direct comparator tests for intentional and incidental char/block versions.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts`.
- Extracted Lamport/actor id helpers into `src/block-crdt/ids.ts`, with compatibility re-exports from `utils.ts`.
- Updated core imports to use `ids.ts` directly where appropriate.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` and `npm run typecheck`.
- Extracted version/conflict comparators into `src/block-crdt/versions.ts`.
- Moved Lamport comparison helpers into `ids.ts` and preserved their `index.ts` export.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` and `npm run typecheck`.
- Added public change creation functions: `insertTextOps`, `deleteRangeOps`, `splitBlockOps`, `joinBlocksOps`, `setBlockMetaOps`, and `markRangeOp`.
- Added `src/block-crdt/changes.ts` as a focused re-export module for those functions.
- Added tests that use the public change functions to produce and apply related `Op[]` batches.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` and `npm run typecheck`.
- Made block/state/cache/op types generic over timestamped block metadata, with the existing metadata union as the default.
- Added `initialStateWithMeta` for custom metadata initialization.
- Added coverage for applying a custom typed `block:meta` op.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` and `npm run typecheck`.
- Ran the full unit test suite with `npm exec vitest -- run`. The block-crdt tests passed, but the broader suite failed in existing React example tests with invalid hook call errors from the todo UI tests (`examples/react-crdt/...`). This appears unrelated to the block-crdt changes.
- Verified shipped source with `npm run build`.
- Verified the main block-crdt consumer with `npm exec vitest -- run examples/block-rich-text/src`.
- Added `validateOp` and `assertCacheConsistent` helpers.
- Kept op shape validation separate from dependency readiness: structurally valid ops can still return `pending` from `applyRemote`.
- Added tests for validation and cache consistency assertion behavior.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` and `npm run typecheck`.
- Final focused verification for this batch:
  - `npm run build`
  - `npm exec vitest -- run examples/block-rich-text/src`

## Continued Module Decomposition

- Extracted block parent/path derivation, cycle handling, block path validation, materialized block path helpers, and stress strategies into `src/block-crdt/blocks.ts`.
- Extracted active join selection and joined block lookup helpers into `src/block-crdt/joins.ts`.
- Extracted full cache derivation into `src/block-crdt/cache.ts`.
- Preserved barrel exports from `index.ts` while removing duplicate local implementations.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/organizeState.stress.test.ts` and `npm run typecheck`.
- Moved the `Op` type into `types.ts` and kept it re-exported from `index.ts`.
- Extracted op validation and Lamport counter accounting into `src/block-crdt/ops.ts`.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src` and `npm run typecheck`.
- Extracted shared traversal/materialization primitives into `src/block-crdt/traversal.ts`.
- Extracted mark creation, split-aware mark traversal, and formatted block materialization into `src/block-crdt/marks.ts`.
- Extracted apply result helpers and op handlers into `src/block-crdt/apply.ts`.
- Reduced `src/block-crdt/index.ts` from 1,760 lines at the start of this task to 417 lines; it now mostly holds split/join/change creation and barrel exports.
- Verified with `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src` and `npm run typecheck`.
- Verified build with `npm run build`.
- Moved split/join/change creation into `src/block-crdt/changes.ts`.
- Moved `cachedState` into `src/block-crdt/cache.ts`.
- Converted `src/block-crdt/index.ts` into a barrel export file; it is now 103 lines.
- Hardened mark traversal by replacing heuristic step limits with explicit cycle detection in split scans, mark coverage, and split-tail traversal.
- Verified with:
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm run build`

## Public API And Metadata Tightening

- Propagated generic block metadata through cache, block path, traversal, formatting, op validation, apply, and change-creation APIs instead of only typing the state container generically.
- Strengthened custom metadata coverage so generated `insertTextOps`/`splitBlockOps` batches preserve application-specific metadata.
- Added public `moveBlockOps` for explicit visible outline moves with adjacent sibling anchors and descendant-cycle validation.
- Updated `examples/block-rich-text` to use public change-creation helpers for text insertion/deletion, split/join, mark creation, and ordinary explicit block moves.
- Corrected visible move semantics so deleted/joined hidden parents are not public move targets; their visible descendants are treated as logical children of the nearest visible ancestor.
- Removed the example-local raw `block:move` fallback for moving through hidden parents after `visibleBlockChildren`/`visibleBlockOutline` were updated to flatten hidden descendants into logical visible sibling lists.
- Added public integration contract documentation to `src/block-crdt/Readme.md`, covering data model, apply results, change helpers, metadata generics, formatting/join behavior, identity validation, and performance expectations.
- Verified incremental changes with:
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src`
  - `npm run typecheck`
- Final verification for this batch:
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm run build`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
- `npm run typecheck:examples` still fails before block-rich-text because `examples/react/src/persistence.ts` cannot resolve `umkehr/migration`; this appears unrelated to the block-crdt work.
