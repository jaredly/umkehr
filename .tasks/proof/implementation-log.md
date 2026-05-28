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
