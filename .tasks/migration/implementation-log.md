# Schema Migration Implementation Log

## 2026-05-20

### Phase 1 start

- Started with the schema metadata and fingerprint hashing foundation.
- Scope for this pass: add `umkehr/migration`, introduce stable schema fingerprint hashing, thread `schemaFingerprintHash` through persisted/protocol metadata where practical, and keep old persisted data compatible.
- Explicitly not starting migration runners yet; those belong to later phases.

### Phase 1 progress

- Added `src/migration/index.ts` and the `umkehr/migration` package export.
- Added shared helpers for stable schema fingerprinting and synchronous SHA-256 hex hashes.
- Replaced the React CRDT example's local fingerprint implementation with the shared migration helpers.
- Added `schemaFingerprintHash` to local-first persisted replica metadata, local-first protocol messages, member records, connection state, import validation, and controls display.
- Kept old local-first data compatible by deriving a missing hash from the stored full fingerprint during normalization.
- Added `schemaFingerprintHash` and `schemaVersion` to server-mode client metadata and protocol messages.
- Updated the Bun server store to persist `schemaVersion` and `schemaFingerprintHash`, while normalizing legacy rows when the full fingerprint still matches.
- Added persisted wrappers for non-CRDT local history in `examples/react`, `examples/react-crdt` todo history persistence, and `examples/remix3`.
- Verified:
  - `npm run build`
  - `npm run typecheck:examples`
  - `cd examples/react-crdt-server && npm run typecheck`
  - `npm run typecheck:tests`
  - `npm test`
  - `cd examples/react-crdt-server && npm test`

### Phase 2 progress

- Extended `HLC` with an optional deterministic suffix.
- Updated `hlc.pack`/`hlc.unpack` to round-trip timestamps like `000000000000010:00002:actor~migration-1`.
- Added `hlc.tryUnpack`, `hlc.isValid`, `hlc.withSuffix`, and `hlc.withoutSuffix`.
- Kept CRDT timestamp comparison as fast lexical string comparison. The suffix format is appended to the packed timestamp so same-base suffixed timestamps sort between the base timestamp and the next normal HLC timestamp without unpacking.
- Tightened CRDT update validation so update timestamps, path parent timestamps, order timestamps, command ids, and target command ids must be valid HLC timestamps.
- Updated local-first and server protocol timestamp validation to accept suffixed HLC timestamps and reject malformed suffixes.
- Added targeted tests for HLC suffix packing, suffix derivation/removal, suffix ordering, malformed suffix rejection, CRDT validator suffix acceptance, and local-first protocol suffix acceptance.
- Verified:
  - `npm test`
  - `npm run typecheck:examples`
  - `cd examples/react-crdt-server && npm run typecheck`
  - `cd examples/react-crdt-server && npm test`
  - `npm run typecheck:tests`

### Phase 3 progress

- Added shared migration API types to `umkehr/migration`:
  - `SchemaMigration`
  - `SchemaMigrationConfig`
  - `SchemaVersionMetadata`
  - `MigrationResult`
- Added `MigrationError` with structured error codes for:
  - missing source schema
  - missing target schema
  - missing migration path
  - unsupported downgrade
  - fingerprint mismatch
  - validation failure
- Implemented `resolveMigrationPath`, keyed by schema version plus fingerprint hash.
- Implemented `migrateValue`, including source validation before migration and target validation after every migration step.
- Kept patch and CRDT update migration hooks typed on `SchemaMigration`, but did not add patch/history/CRDT runners yet.
- Added focused tests for multi-step path resolution, current-schema no-op migration, missing previous schema, downgrades, fingerprint mismatch, missing migration path, source validation failure, and target validation failure.
- Verified:
  - `npm test`
  - `npm run typecheck:examples`
  - `npm run typecheck:tests`
  - `cd examples/react-crdt-server && npm run typecheck`
  - `cd examples/react-crdt-server && npm test`

### Phase 4 progress

- Added `migrateHistory` to `umkehr/migration`.
- The runner migrates `initial`, `current`, and every `History.nodes[id].changes` patch list.
- Source patches are validated against the source schema before migration.
- Migrated patches are validated against each migration step's target schema.
- Patch migrations can emit zero, one, or many target patches through `SchemaMigration.migratePatch`.
- The runner preserves annotations, root, tip, children, and undo trail.
- The runner replays every reachable migrated history node from the migrated initial state.
- Added `replay-failed` migration errors for graph issues and tip/current replay mismatches.
- Added focused tests for:
  - migrated local history patches
  - branch/reachable node replay
  - unchanged patches for compatible schema additions
  - missing patch migration for renamed paths
  - replay mismatch detection
- Verified:
  - `npm test`
  - `npm run typecheck:examples`
  - `npm run typecheck:tests`
  - `cd examples/react-crdt-server && npm run typecheck`
  - `cd examples/react-crdt-server && npm test`

### Phase 5 progress

- Added `migrateCrdtHistory` to `umkehr/migration`.
- The runner settles pending updates on both the CRDT base and realized document before migration, and fails with `replay-failed` if any pending updates remain.
- The runner migrates the base state and realized state with the shared value migration path.
- Rebuilt the migrated base document with the current schema while preserving the source base timestamp where available.
- Added CRDT update migration through `SchemaMigration.migrateCrdtUpdate`, including support for dropping one update or expanding one update into many updates.
- Added reusable migration helpers for common patch and CRDT update rewrites:
  - object field rename/drop
  - object-valued default insertion
  - tagged-union branch/tag renames
- Validated source CRDT updates against the source schema and migrated CRDT updates against every target schema in the migration path.
- Replayed migrated updates from the migrated base using `applyCrdtUpdate`.
- Added replay verification so migrated CRDT history fails if replay leaves pending updates or if the replayed state differs from the separately migrated realized state.
- Added focused tests for:
  - CRDT field rename update migration
  - compatible schema additions with unchanged CRDT updates
  - missing CRDT update migration for renamed paths
  - replay mismatch detection
  - pending updates that can be applied before migration
  - unresolvable pending updates before migration
  - patch and CRDT rewrite helpers
- Verified:
  - `npm test -- src/migration/migration.test.ts`
  - `npm test`
  - `npm run typecheck:examples`
  - `npm run typecheck:tests`
  - `cd examples/react-crdt-server && npm run typecheck`
  - `cd examples/react-crdt-server && npm test`
