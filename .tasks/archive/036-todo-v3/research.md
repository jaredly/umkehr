# Todos V1 To V3 Migration Research

## Task

There is currently no upgrade path from the todos v1 schema to the todos v3 schema. Figure out what is missing and capture open questions.

## Findings

The migration framework already supports multi-step upgrades. `resolveMigrationPath(...)` walks from the source version to the current version by repeatedly finding a migration whose `fromVersion` and `fromFingerprintHash` match the current step, then validates that each target schema is registered. The core tests already cover a v1 -> v2 -> v3 path.

The todo fixture only registers one migration today:

- `todos-fixture-v1-to-v2`
- `fromVersion: 1`
- `toVersion: 2`
- `fromFingerprintHash: todoFixtureV1FingerprintHash`
- `toFingerprintHash: todoFixtureV2FingerprintHash`

The exported `todoFixtureMigrationConfig` is also v2-only:

```ts
export const todoFixtureMigrationConfig: SchemaMigrationConfig<TodoFixtureStateV2> = {
    current: todoFixtureV2Metadata,
    previous: [todoFixtureV1Metadata],
    migrations: [todoFixtureMigration],
};
```

That means a v1 document can be upgraded to v2, but there is no registered edge from v2 to v3 and no config whose `current` schema is `todoFixtureV3Metadata`.

## Schema Differences

Relevant fixture shapes in `examples/migration-fixtures/todos.ts`:

- v1 state: `{bgcolor, todos, legacyFilter?}`
- v1 todo: `{id, text, done, archived?}`
- v2 state: `{bgcolor, todos}`
- v2 todo: `{id, title, done, priority}`
- v3 state: `{bgcolor, todos, view}`
- v3 todo: `{id, title, done, priority, notes}`

The existing v1 -> v2 migration:

- keeps `bgcolor`;
- drops `legacyFilter`;
- maps `todo.text` to `todo.title`;
- drops `todo.archived`;
- defaults `priority` to `'normal'`;
- drops patches/CRDT updates that touch `legacyFilter` or `archived`;
- rewrites patch/update paths from `text` to `title`;
- defaults full todo object values through the same v1 -> v2 shape conversion.

The missing v2 -> v3 migration should probably:

- keep `bgcolor`;
- add `view`, likely defaulting to `'all'`;
- keep each todo's `id`, `title`, `done`, and `priority`;
- add `notes`, likely defaulting to `''`;
- for patches, preserve existing paths but add `notes: ''` to any patch value that is a todo object and add `view: 'all'` to any full-state value;
- for CRDT updates, preserve existing paths but add `notes: ''` to inserted/set todo objects and `view: 'all'` to full-state object values;
- handle existing v2 updates without synthesizing a separate root `view` update, unless replay validation requires that extra update.

## App Wiring Gaps

`examples/react-crdt/src/lib/appRegistry.ts` currently wires:

- the default `todoApp` to the v2 migration config;
- `todos@1` to a v1 server config with no migrations;
- `todos@3` to a v3 server config with no migrations.

So even though `todoV3App` exists, server/local migration code has no v1 -> v3 path for that app. To make v1 documents upgrade to v3, the v3 registered app needs a schema config like:

- `version: 3`
- `previous: [todoFixtureV1Metadata, todoFixtureV2Metadata]`
- `migrations: [todoFixtureV1ToV2Migration, todoFixtureV2ToV3Migration]`

For local-first migrations, each migration entry also needs `toDocId`. The v1 -> v2 entry can keep targeting `TODO_FIXTURE_DOC_ID_V2` for v2 current configs, but a v1 -> v3 flow should end at `TODO_FIXTURE_DOC_ID_V3`. There are two plausible options:

- keep v1 -> v2's intermediate `toDocId` as v2 and set v2 -> v3's `toDocId` to v3, relying on the final migration's `toDocId`;
- provide a v3-specific local-first config whose final migration points to v3 and test that `findMigrationCandidate(...)` returns `targetDocId: TODO_FIXTURE_DOC_ID_V3`.

The local-first path chooses the target doc id from the final migration in the path, so the second option should work without a direct v1 -> v3 edge.

## Recommended Implementation

Add explicit v2 -> v3 exports in `examples/migration-fixtures/todos.ts`:

- `todoFixtureV1ToV2Migration` or keep the existing export as an alias for compatibility.
- `todoFixtureV2ToV3Migration`.
- `todoFixtureV2MigrationConfig` for current v2, if the existing config name should stay stable.
- `todoFixtureV3MigrationConfig` with current v3, previous v1 and v2, and both migrations.

Add migration helper functions:

- `migrateTodoFixtureStateV2ToV3(input: TodoFixtureStateV2): TodoFixtureStateV3`.
- `migrateTodoFixtureTodoV2ToV3(input: TodoFixtureV2): TodoFixtureV3`.
- v2 -> v3 patch value defaulting.
- v2 -> v3 CRDT set/insert value defaulting.

Update app registration:

- Keep the default v2 todo app pointed at the v2 config unless the product intent is to make v3 the default.
- Point `todos@3` server schema config at the v3 migration config.
- If local-first app mode is expected to migrate `todos-fixture-v1` to `todos-fixture-v3`, add the matching local-first schema config where that mode is configured, not only the server config.

Add tests in `examples/react-crdt/src/apps/todos/migrationFixture.test.ts`:

- non-CRDT history migrates v1 -> v3 with migration ids `['todos-fixture-v1-to-v2', 'todos-fixture-v2-to-v3']`;
- migrated current state includes `view: 'all'` and todo `notes: ''`;
- v1 archived/legacyFilter patches are still dropped while title/add patches survive through v3;
- local-first retained batches migrate v1 -> v3 and target `TODO_FIXTURE_DOC_ID_V3`;
- server replica migration v1 -> v3 rematerializes branch history as v3;
- server dump migration v1 -> v3 uploads target schema version 3 and both migration ids.

## Open Questions

- Should v3's default `view` be `'all'`, or should it derive from v1 `legacyFilter` when present?
  - view:all is fine
- Should dropped v1 `archived` state stay dropped, or should archived todos become v3 notes/priority/view metadata?
  - stay dropped. the way migrations are implemetned, the v2->v3 migration shouldn't have any knowledge of v1 data
- Should the default `notes` for migrated todos be `''`, or should it include provenance such as `"Migrated from v2"`?
  - empty is good
- Should v3 become the default todos app now, or should it remain available only as `todos@3` while the default stays v2?
  - default stays v2
- Should the existing `todoFixtureMigrationConfig` name continue to mean "current v2" for compatibility, or should it be renamed/split to avoid ambiguity once a v3 config exists?
  - it remains, and the new config specifies V3
