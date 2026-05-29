# Todos V1 To V3 Migration Plan

## Goal

Add an upgrade path from todos v1 schema data to todos v3 schema data while keeping the default todos app on v2.

The intended path is chained:

1. `todos-fixture-v1-to-v2`
2. `todos-fixture-v2-to-v3`

The v2 -> v3 migration should not know about v1-only fields. Existing v1-only data loss remains owned by the v1 -> v2 migration.

## Decisions

- Default v3 `view` is `'all'`.
- Default v3 todo `notes` is `''`.
- v1 `archived` and `legacyFilter` remain dropped by the v1 -> v2 migration.
- The default todos app stays v2.
- Existing `todoFixtureMigrationConfig` remains the v2-current config.
- Add a new v3-specific migration config instead of repurposing the existing name.

## Phase 1: Fixture Migration Exports

Update `examples/migration-fixtures/todos.ts`.

- Keep the existing `todoFixtureMigration` export as the v1 -> v2 migration for compatibility.
- Add a clearer alias if useful, such as `todoFixtureV1ToV2Migration = todoFixtureMigration`.
- Add `todoFixtureV2ToV3Migration`.
- Add `todoFixtureV3MigrationConfig`:
  - `current: todoFixtureV3Metadata`
  - `previous: [todoFixtureV1Metadata, todoFixtureV2Metadata]`
  - `migrations: [todoFixtureMigration, todoFixtureV2ToV3Migration]`

## Phase 2: V2 To V3 State Migration

Add v2 -> v3 state helpers in `examples/migration-fixtures/todos.ts`.

- `migrateTodoFixtureStateV2ToV3(input: TodoFixtureStateV2): TodoFixtureStateV3`
  - copy `bgcolor`
  - set `view: 'all'`
  - map `todos` through the todo helper
- `migrateTodoFixtureTodoV2ToV3(input: TodoFixtureV2): TodoFixtureV3`
  - copy `id`, `title`, `done`, `priority`
  - set `notes: ''`

Avoid referencing v1 fields in these helpers.

## Phase 3: Patch Migration

Add a v2 -> v3 patch migrator.

- Preserve patch paths because existing v2 fields still exist in v3.
- For patch values:
  - if a value is a full v2 state object, add `view: 'all'` and default todos' `notes`.
  - if a value is a v2 todo object, add `notes: ''`.
  - recurse through arrays/objects so add/remove/replace patches containing nested todos are valid after migration.
- Do not synthesize a separate patch for `view` unless replay validation proves it is required.

Expected behavior for the existing v1 fixture history:

- v1 title replace becomes v3 title replace through both migrations.
- v1 archived replace is dropped by v1 -> v2.
- v1 legacyFilter replace is dropped by v1 -> v2.
- v1 add todo becomes a v3 add todo with `priority: 'normal'` and `notes: ''`.

## Phase 4: CRDT Update Migration

Add a v2 -> v3 CRDT update migrator.

- Preserve update paths because v2 paths are still valid in v3.
- For `insert` updates, default inserted todo object values with `notes: ''`.
- For `set` updates, default object values:
  - full state gets `view: 'all'` and todo notes.
  - todo objects get `notes: ''`.
- Leave scalar field updates unchanged.
- Leave `setOrder` unchanged.
- Do not add v1-specific handling here.

If replay validation fails because the base document gains `view` during state migration but the update log lacks an equivalent operation, reassess whether a synthetic root/default update is needed. Start without synthesis because the current migration core migrates base and realized states independently before replaying migrated updates.

## Phase 5: App Registry Wiring

Update `examples/react-crdt/src/lib/appRegistry.ts`.

- Keep `todoMigrationServerSchemaConfig` as the v2 config for the default app.
- Replace `todoV3ServerSchemaConfig`'s empty migrations with the v3 migration config:
  - version 3
  - previous v1 and v2 metadata
  - v1 -> v2 and v2 -> v3 migrations
- Keep `todoV1ServerSchemaConfig` migration-free.

If there is a local-first schema config for app registration, add the v3 config there too. The final migration in the local-first path should target `TODO_FIXTURE_DOC_ID_V3`.

## Phase 6: Tests

Extend `examples/react-crdt/src/apps/todos/migrationFixture.test.ts`.

- Add expected v3 migrated state:
  - `bgcolor: '#fff'`
  - `view: 'all'`
  - todos with `title`, `done`, `priority: 'normal'`, and `notes: ''`
- Add a non-CRDT history test for v1 -> v3:
  - migration ids are `['todos-fixture-v1-to-v2', 'todos-fixture-v2-to-v3']`
  - current state equals expected v3 state
  - dropped v1 patches remain dropped
  - surviving add/title patches validate as v3
- Add local-first retained batch coverage for v1 -> v3:
  - candidate target doc id is `TODO_FIXTURE_DOC_ID_V3`
  - migrated replica schema version is 3
  - migrated history state equals expected v3 state
  - migrated retained updates replay and vector matches retained updates
- Add server replica coverage for v1 -> v3:
  - schema fingerprint hash is v3
  - branch history rematerializes to expected v3 state
  - dropped update events are still omitted
- Add server dump coverage for v1 -> v3:
  - target schema version is 3
  - migration ids include both steps
  - uploaded events contain only surviving migrated updates

## Phase 7: Verification

Run targeted tests first:

```sh
pnpm --dir examples/react-crdt test -- migrationFixture.test.ts
```

If that command is not available or does not select the test file correctly, run the package test command used by the repo for `examples/react-crdt`.

Then run broader checks if time allows:

```sh
pnpm --dir examples/react-crdt test
pnpm --dir examples/react-crdt build
```

## Risks

- Patch/update value migration must distinguish full state objects from todo objects without incorrectly adding `notes` to unrelated objects.
- Multi-step migration requires v2 metadata to be registered as a previous schema for the v3 config; otherwise path resolution will fail at the v2 target step.
- Server dump upload currently reports `schemaConfig.migrations.map(...)`; confirm this is still correct for a v1 -> v3 path and does not over-report in any future partial migration scenario.
- Local-first doc id selection comes from the final migration. Tests should lock in that v1 -> v3 ends at `TODO_FIXTURE_DOC_ID_V3`.
