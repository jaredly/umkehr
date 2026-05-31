# Todos V1 To V3 Implementation Log

## Phase 1: Fixture Migration Exports

- Started adding a v2 -> v3 migration and a v3-current migration config while preserving the existing v2-current `todoFixtureMigrationConfig`.
- Added `todoFixtureV2ToV3Migration`, a compatibility alias for the existing v1 -> v2 migration, and `todoFixtureV3MigrationConfig`.

## Phase 2: V2 To V3 State Migration

- Added state/todo helpers that copy v2 fields, default `view` to `'all'`, and default todo `notes` to `''`.

## Phase 3: Patch Migration

- Added v2 -> v3 patch value migration that preserves paths and defaults full state/todo object values.

## Phase 4: CRDT Update Migration

- Added v2 -> v3 CRDT update migration that preserves paths/orders and defaults inserted/set object values.

## Phase 5: App Registry Wiring

- Started wiring `todos@3` to the new v3 migration config.
- Wired the `todos@3` server schema config to the new v3 migration config.
- Updated the `todos@3` app initial state to the v3 shape produced by migrating the v1 initial fixture, which keeps server branch rematerialization coherent during v1 -> v3 upgrades.

## Phase 6: Tests

- Started extending migration fixture tests for v1 -> v3 history, local-first, server replica, and server dump paths.
- Added v1 -> v3 migration fixture tests for non-CRDT history, local-first retained batches, server client branch data, and server migration upload generation.

## Phase 7: Verification

- `npx vitest run examples/react-crdt/src/apps/todos/migrationFixture.test.ts` passed.
- `npx vitest run examples/react-crdt/src/lib/appRegistry.test.ts examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx` passed.
- `npm run build` passed.
- `npm run typecheck:examples` failed on an existing `examples/react-crdt/src/lib/server/materialize.ts` CRDT union narrowing error at line 419, outside this task's edited files.
