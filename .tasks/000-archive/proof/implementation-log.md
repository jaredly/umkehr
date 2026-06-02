# CRDT proof confidence implementation log

## 2026-05-27

- Started Phase 1 from `plan.md`: reusable proof/invariant test helpers.
- Added `src/crdt/proofTestHelpers.ts` with schedule application, deterministic shuffling, duplicate injection, bounded permutations, canonical document/metadata comparison, pending readiness checks, and validation assertion helpers.
- Kept helpers free of Vitest imports so they remain plain TypeScript utilities and do not push schema validation into `applyCrdtUpdate`.
- Added `src/crdt/proof.test.ts` smoke coverage for convergence across reordered/duplicated delivery, external CRDT update validation, materialized state validation, and pending readiness behavior.
- Verification:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 2 targeted invariant regressions

- Expanded `src/crdt/proof.test.ts` from the Phase 1 smoke schema to a representative proof schema covering primitives, nested objects, records, arrays, and tagged unions.
- Added targeted convergence/idempotence tests for:
  - primitive LWW set delivery with older/newer/duplicate updates;
  - record entry create/delete/recreate plus delayed child updates;
  - record child updates delivered before parent creation;
  - nested object updates for older object incarnations;
  - array item edits and reorders delivered before item creation;
  - duplicate array values moved by CRDT item identity;
  - reordered `setOrder` updates for existing items;
  - tagged-union old-branch field updates after branch replacement;
  - tagged-union branch field updates before branch creation;
  - HLC suffix ordering and validation outside `applyCrdtUpdate`.
- Each targeted case now checks materialized state convergence, canonical metadata convergence, no ready pending updates, CRDT update validation, and materialized state validation.
- Verification so far:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 3 property-based tests

- Added `fast-check` as a dev dependency for deterministic property-based CRDT invariant testing.
- Added a generated-history property test over the representative proof schema.
- The generator now creates small valid initial states and short author-side command histories covering primitive edits, nested object edits, record create/delete/child edits, array append/delete/move/reorder/edit operations, and tagged-union replacement/field edits.
- Generated commands are converted through the real `createCrdtUpdates` path while applying against an author document, so emitted updates are valid for their authoring state.
- Each generated history is replayed against fresh replicas with:
  - original delivery order;
  - reversed delivery order;
  - deterministic shuffled delivery;
  - deterministic shuffled delivery with duplicate updates.
- The property asserts materialized state convergence, canonical metadata convergence, idempotent replay, no ready pending updates, CRDT update validation, and materialized state validation.
- Verification so far:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 4 bounded exhaustive tests

- Added bounded exhaustive convergence tests for small record, array, and tagged-union update spaces.
- The record case exhausts create, child set, delete, and recreate delivery permutations plus duplicate-injected schedules.
- The array case exhausts insert, item edit, order change, and delete delivery permutations plus duplicate-injected schedules.
- The tagged-union case exhausts branch replacement, branch field edit, and branch replacement delivery permutations plus duplicate-injected schedules.
- The array exhaustive case exposed a metadata convergence bug for array-item deletes delivered before inserts/order changes: the receiver could synthesize a tombstone item with a fallback order instead of the authored item order.
- Fixed array CRDT delete translation so a leaf array-item delete carries the item's current order metadata. If a delete for a not-yet-seen array item creates a tombstone, it can now preserve the authored item order and converge with replicas that saw the insert/order first.
- Kept non-delete array item updates unchanged so whole-item replacements and child updates still wait for the item creation instead of creating missing array items from an order-bearing path segment.
- Verification so far:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 5 differential reference model

- Added a test-only executable reference model inside `src/crdt/proof.test.ts`.
- The reference model intentionally does not import production `apply`, `path`, `metadata`, or `materialize` helpers. It defines its own small proof-schema descriptors, metadata tree, parent-incarnation checks, pending retry loop, LWW application rules, array order handling, tagged-union branch checks, and materialization.
- Added generated-history differential tests that compare production materialized state against the reference model across original, reversed, shuffled, and duplicated delivery schedules.
- Added targeted differential histories covering primitive fields, records, arrays, and tagged unions.
- The first differential run caught a model bug: it used locale string comparison for order keys, while production uses raw lexical comparison. The model now uses a local raw string comparator.
- Verification so far:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 6 migration invariant tests

- Added CRDT migration invariant coverage to `src/migration/migration.test.ts`.
- Added shared replay/convergence checks for migrated CRDT histories using the proof helpers from `src/crdt/proofTestHelpers.ts`.
- Covered migrated-history replay across original, reversed, bounded-permutation, and duplicate-injected delivery schedules.
- Added invariant tests for:
  - existing object field rename migration;
  - helper-driven field drops that remove obsolete updates;
  - helper-driven defaults on object-valued CRDT set updates;
  - one source CRDT update expanding into multiple target updates while preserving replay;
  - tagged-union branch rewrite preserving branch path identity.
- Added small migration schema fixtures for drop/default/expand/tagged-union cases.
- Verification so far:
  - `npm test -- src/migration/migration.test.ts`
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## Phase 7 documentation

- Updated `Readme.md` with the precise CRDT behavior claim:
  - valid updates from honest replicas;
  - same initial document and schema;
  - duplicate/reordered eventual delivery;
  - convergence in materialized state and canonical metadata;
  - permanently missing causal parents may leave non-ready updates pending.
- Documented non-claims: root tombstones, Byzantine/malicious updates, tombstone garbage collection, and fractional-order rebalancing.
- Documented that CRDT validation belongs at network/storage boundaries and is intentionally not performed inside `applyCrdtUpdate`.
- Added `src/crdt/proof.md` summarizing the invariant suite and the scope of its proof-confidence claim.
- Verification:
  - `npm test -- src/crdt/proof.test.ts`
  - `npm test -- src/migration/migration.test.ts`
  - `npm test -- src/crdt`
  - `npm run typecheck`

## 2026-05-28 array tombstone follow-up

- Replaced the Phase 4 array delete workaround with a cleaner array item lifecycle model.
- Array inserts now use a dedicated `op: 'insert'` CRDT update carrying the target array path, item
  id, initial order, value, and timestamp.
- Array item CRDT path segments no longer carry `order`, so `crdtPathForExisting` no longer needs an
  `includeLeafArrayOrder` option.
- Array item metadata is now a live/deleted union:
  - live items carry order and value metadata;
  - deleted items carry only a deletion timestamp.
- Delete-before-insert for an array item can remain pending until the insert arrives. This matches
  the existing proof claim that permanently missing causal parents may leave non-ready updates
  pending.
- Renamed update-level edit/undo/redo grouping metadata from `meta` to `command` to avoid confusion
  with CRDT document metadata.
- Updated the independent reference model and migration fixtures for `insert`, `command`, and
  order-free array tombstones.
- Verification:
  - `npm run typecheck`
  - `npm test -- src/crdt`
  - `npm test -- src/migration/migration.test.ts`
  - `npm test`
