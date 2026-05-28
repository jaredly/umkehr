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
