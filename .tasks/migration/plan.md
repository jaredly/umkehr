# Schema Migration Plan

## Goal

Add optional schema migration support across local history, CRDT/local-first history, PeerJS sync, and the server-backed example.

The core invariant is:

> After migration, every retained operation validates against the current schema, and replaying the migrated operation log from the migrated base produces the migrated realized state.

Migration must remain opt-in. Apps without a migration config should keep the current behavior: exact schema metadata match or incompatible.

## Decisions

- Put migration APIs behind a separate `umkehr/migration` entrypoint because they depend on typia schema/validation types.
- Store schema metadata in persisted wrappers, not in core `History` or `CrdtLocalHistory`.
- Require source schemas for every previous version.
- Support only monotonic upgrades. No downgrade or inverse migration support.
- Use both `schemaVersion` and `schemaFingerprintHash` in persisted metadata and protocols.
- Generate schema fingerprint hashes at build time where possible.
- Keep full unhashed schema fingerprints available for debugging and local migration lookup.
- Allow one source update or patch to migrate to zero, one, or many target operations.
- Allow dropped updates without recording a drop audit trail.
- Before migrating a CRDT history, first apply pending CRDT updates so the migration works from a settled history.
- For local-first, retained batches are the source of truth. Reconstruct `history.updates` from migrated batches.
- For server mode, archive pre-migration data and transactionally replace the active server data with migrated data.
- Server data should be keyed by schema hash. After migration, old-schema data remains archived but is not accessible to normal clients.
- Once a client has migrated its own local data, it can discard old local data.
- Extend HLC timestamp support so deterministic neighboring timestamps can be produced with an additional suffix.

## Non-Goals

- Live protocol translation between schema versions.
- Mixed-version collaboration during migration.
- Server-owned app schema execution.
- Automatic schema diffing as the primary migration mechanism.
- Downgrades.

## Phase 1: Schema Metadata And Fingerprint Hashing

Add a build-time friendly schema metadata shape.

Proposed types:

```ts
type VersionedSchema<TState> = {
    version: number;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    fingerprint: string;
    fingerprintHash: string;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
};

type SchemaMigrationConfig<TCurrent> = {
    current: VersionedSchema<TCurrent>;
    previous: VersionedSchema<unknown>[];
    migrations: SchemaMigration<unknown, unknown>[];
};
```

Work:

- Add a stable SHA-256 fingerprint-hash helper to the migration entrypoint or a shared schema utility module.
- Keep the existing stable schema fingerprint behavior, but introduce `schemaFingerprintHash` everywhere persisted/protocol metadata is compared.
- Add a small build-time helper or documented pattern for generated hashes in examples.
- Update the React examples so local, local-first, PeerJS, and server modes know both `schemaVersion` and `schemaFingerprintHash`.
- Preserve compatibility for existing persisted data that has only `schemaFingerprint`, treating missing schema version as version 1.

Tests:

- Same schema produces stable hash across object key order differences.
- Different root schema, components, or tag key produce different hashes.
- Existing v1 persisted data can be normalized to schema version 1.

## Phase 2: HLC Neighboring Timestamp Support

Migrations need deterministic timestamps for newly introduced CRDT metadata that do not accidentally dominate or get dominated by unrelated updates.

Work:

- Extend the HLC timestamp format/parser to allow an additional deterministic suffix.
- Add helpers for deriving neighboring migration timestamps from an existing timestamp.
- Ensure `compareTimestamps`, `newer`, validation, and protocol parsing all understand the extended format.
- Update CRDT update validators and local-first/server protocol HLC validation.

Tests:

- Existing timestamps still parse, pack, compare, and validate.
- Suffixed timestamps compare deterministically.
- Migration-derived timestamps sort predictably near their source timestamp.
- Protocol validators reject malformed suffixes.

## Phase 3: Migration Entry Point And Core Runners

Create `src/migration` and export it as `umkehr/migration`.

Proposed migration type:

```ts
type SchemaMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprintHash: string;
    toFingerprintHash: string;
    migrateState(input: TFrom): TTo;
    migratePatch?(input: Patch<TFrom>): Patch<TTo> | Patch<TTo>[] | null;
    migrateCrdtUpdate?(input: CrdtUpdate): CrdtUpdate | CrdtUpdate[] | null;
};
```

Work:

- Implement migration path resolution by `schemaVersion` plus fingerprint hash.
- Validate every source value against its declared source schema before migration.
- Validate every migrated value against its target schema after migration.
- Allow each migration step to emit zero, one, or many patches/updates.
- Return structured migration results with migration ids and source/target metadata.
- Throw specific migration errors for missing source schema, missing migration path, validation failure, replay failure, and unsupported downgrade.

Tests:

- Finds multi-step migration paths.
- Refuses missing previous schemas.
- Refuses downgrades.
- Refuses migration when fingerprints do not match the declared source.
- Propagates useful errors for validation failures.

## Phase 4: Non-CRDT Local History Migration

Add persisted wrapper migration for `History<T, An>`.

Proposed wrapper:

```ts
type PersistedHistory<T, An> = {
    storageVersion: 1;
    schemaVersion: number;
    schemaFingerprintHash: string;
    schemaFingerprint?: string;
    history: History<T, An>;
};
```

Work:

- Add `migrateHistory` in `umkehr/migration`.
- Migrate `initial`, `current`, and every `nodes[id].changes` patch.
- Preserve annotations, root, tip, children, and undo trail.
- Verify every reachable history node by replaying migrated patches from migrated `initial`.
- Verify the migrated `tip` state equals migrated `current`.
- Update `examples/react/src/persistence.ts` to persist schema metadata and run migrations before accepting stored history.
- Keep old no-wrapper data compatible by normalizing it as v1 when possible.

Tests:

- Optional field addition succeeds with unchanged patches.
- Required field with default migrates state and object-valued patches.
- Deleted field drops relevant patches.
- Field rename rewrites patch paths.
- A replay mismatch fails migration.
- Branch/jump history materializes correctly after migration.

## Phase 5: CRDT History Migration

Add `migrateCrdtHistory` for `CrdtLocalHistory<T>`.

Work:

- Before migration, apply all `doc.pending` updates if possible. Fail if pending updates remain.
- Migrate the settled base state and realized state.
- Rebuild or derive migrated base metadata using the target schema and timestamp-preservation rules.
- Migrate every CRDT update in order, allowing zero, one, or many target updates.
- Validate migrated updates against the target schema.
- Replay migrated updates from the migrated base with `applyCrdtUpdate`.
- Validate replayed state and migrated realized state against the target schema.
- Fail if replayed state does not deep-equal migrated realized state.
- Recreate the final `CrdtLocalHistory` with migrated `base`, replayed `doc`, and migrated `updates`.

Path/update helper work:

- Provide reusable utilities for object field renames.
- Provide utilities for deleted paths.
- Provide utilities for moved values.
- Provide utilities for defaulting required fields in object-valued `set` updates.
- Provide utilities for tagged-union branch/tag rewrites.
- Reuse the same logical path helper concepts for `Patch` and `CrdtUpdate` where possible.

Tests:

- Deleted field update history drops without replay mismatch.
- Required default is applied to realized state, base state, and old object-set updates.
- Field rename rewrites CRDT path segments and set values.
- Nested move emits multiple updates when needed.
- Tagged-union branch rename validates against the target schema.
- Array item update migration preserves item ids.
- Pending updates are applied before migration.
- Remaining pending updates fail migration.
- Replay mismatch fails migration.

## Phase 6: Local-First And PeerJS Integration

Replace the current state-only local-first migration with history-preserving migration.

Work:

- Update `LocalFirstSchemaConfig` to use the shared migration config shape or adapt to it.
- Update persisted replica metadata to include `schemaFingerprintHash`.
- On startup, load retained batches first and treat them as the source of truth.
- Apply pending updates before migration.
- Migrate retained batches in order.
- Reconstruct `history.updates` from the migrated batches.
- Rebuild/migrate `history.base` and replay migrated batches to produce `history.doc`.
- Recompute local vector metadata from migrated batches when timestamps are unchanged.
- Save migrated replica transactionally.
- Preserve lineage metadata.
- Keep a state-only fork/reset migration path as an explicit fallback, not the default.
- In PeerJS/local-first protocol parsing, reject mismatched schema version/hash and surface a user-facing “update your app” message.

Tests:

- Startup migrates a v1 replica and retained batches to v2.
- Migrated retained batches reconstruct the same `history.updates`.
- Migrated replay result matches migrated realized state.
- A PeerJS/local-first peer with old schema metadata is rejected.
- A migrated client can send migrated pending updates normally.
- Existing v1 replicas without hash normalize correctly.

## Phase 7: Server Client Local Migration

Update the browser-side server mode so each client can migrate its own persisted replica before connecting.

Work:

- Add `schemaVersion` and `schemaFingerprintHash` to `PersistedServerReplica`.
- On startup, migrate local server-mode branches before opening a websocket.
- Migrate every branch event update payload.
- Keep merge events structurally unchanged.
- Re-materialize every branch after event migration.
- Reconstruct branch histories from migrated events where possible.
- Preserve pending local events by migrating them before upload.
- Discard old local data after successful migration.

Tests:

- Server client replica migrates branches and pending events.
- Merge events continue to materialize correctly after update migration.
- Pending old-schema updates migrate and upload after app upgrade.
- Failed local server migration prevents websocket connection and shows an error state.

## Phase 8: Server Protocol Migration Flow

Add server-side coordination for schema upgrades while keeping the server schema-agnostic.

Protocol additions:

- `serverMigrationRequired`
- `serverMigrationRequest`
- `serverMigrationDump`
- `serverMigrationUpload`
- `serverMigrationComplete`
- `waitForMigration`
- `migrationCancelled`
- `clientMigrationRequired`
- `schemaMismatch`

Work:

- Store documents keyed by `docId` plus active `schemaFingerprintHash`.
- Keep archived data for old schema hashes.
- Track a per-document migration lock with owner actor/session and last activity timestamp.
- Expire migration locks after one minute of inactivity.
- When a newer client connects and no lock exists, respond with `serverMigrationRequired`.
- Let the user choose whether to execute migration.
- On `serverMigrationRequest`, grant the lock and send a full dump of all branches/events for the old active schema.
- Broadcast `waitForMigration` to other connected clients for the document.
- Reject non-owner messages for the locked document; clients retain updates as pending.
- Client migrates the server dump locally and uploads the full migrated package.
- Server validates the package structurally, archives the old active data, and transactionally writes the migrated data as the new active schema.
- Release the lock and let the migration owner reconnect normally.
- Send `clientMigrationRequired` to old-schema clients after completion.
- Send `migrationCancelled` to waiting clients if the lock expires.
- Ensure old active data remains archived but inaccessible through normal client sync.

Tests:

- Newer client receives `serverMigrationRequired`.
- Competing client receives `waitForMigration`.
- Migration lock blocks other writes.
- Lock expires after inactivity and broadcasts `migrationCancelled`.
- Upload transaction archives old data and activates new schema data atomically.
- Old clients receive `clientMigrationRequired` after migration.
- Migrated server data can be read by a current client and validates locally.

## Phase 9: Server Data Migration Package

Define the dump/upload format used by server migration.

Work:

- Include document id, source schema version/hash, target schema version/hash, all branches, all branch events, and migration metadata.
- Require the upload to target the currently locked document and source schema hash.
- Preserve event indexes or define a deterministic reindexing rule.
- Preserve update HLC timestamps unless a migration explicitly emits new updates.
- Verify migrated branch event ordering.
- Add a debug/admin view that shows active schema hash, archived schema hashes, and migration lock status.

Tests:

- Dump contains all branches and events.
- Upload with wrong source hash is rejected.
- Upload with stale or missing lock is rejected.
- Branch event indexes remain coherent after migration.

## Phase 10: Example Migration Fixture

Add a concrete sample schema evolution in the React CRDT example.

Candidate migration:

- Rename a todo field.
- Add a required field with a default.
- Delete an obsolete optional field.

Work:

- Add v1 and v2 schemas for one example app.
- Add generated schema hashes.
- Add migration functions for state, patch, and CRDT updates.
- Add a manual/dev fixture that seeds v1 local, local-first, and server data.
- Use the fixture to exercise all migration paths in tests.

Tests:

- Non-CRDT local example migrates fixture data.
- Local-first fixture migrates retained batches.
- Server client fixture migrates local branch data.
- Server migration flow migrates server dump transactionally.

## Phase 11: User-Facing States And Errors

Migration failures need to be understandable without exposing implementation details.

Work:

- Add incompatible/migration-required/migration-running states for local-first and server modes.
- Show “update your app” for old clients connecting to newer data.
- Show “document migration required” for the newer client that can initiate server migration.
- Show “migration in progress” while another client owns the server lock.
- Show “migration cancelled” after lock expiry.
- Include detailed developer logs for validation/replay errors.

Tests:

- UI state transitions match protocol messages.
- Migration failure does not discard old data.
- Server waiting clients resume after cancellation.

## Verification Checklist

Before considering the feature complete:

- `umkehr/migration` is optional and unused apps keep current simple setup.
- Local non-CRDT history migrates and verifies replay.
- CRDT history migrates base, realized state, retained updates, and verifies replay.
- Local-first uses retained batches as source of truth.
- PeerJS/local-first rejects schema mismatches with a useful message.
- Server-mode local replicas migrate before connection.
- Server migration lock/dump/upload/transaction flow works.
- Old server data is archived but not normally accessible.
- Schema version and fingerprint hash are present in local, local-first, PeerJS, and server modes.
- All previous schemas are required by migration configs.
- No downgrade path is exposed.
