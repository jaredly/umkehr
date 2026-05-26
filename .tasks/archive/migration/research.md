# Schema Migration Research

## Goal

Umkehr currently treats a schema fingerprint mismatch as a hard incompatibility. That is a good guardrail, but it forces users to fork or discard documents for schema changes that can be migrated safely.

The goal should be an optional migration API that can upgrade:

- realized state
- CRDT base state
- retained CRDT update history
- non-CRDT local history patches
- server branch/event logs

and then verify that replaying migrated history from the migrated base produces the migrated realized state.

This should remain opt-in. A prototype app with only `schema` and `initialState` should keep today’s behavior: exact fingerprint match or incompatible.

## Current Architecture

### Core Patch History

The non-CRDT `History<T, An>` format stores:

- `initial: T`
- `current: T`
- `nodes[id].changes: Patch<T>[]`
- undo/jump metadata

Patch application is schema-agnostic. Validation is available through `createPatchValidator`, but persistence in the React example only validates the current state and each stored patch against the current schema. There is no schema metadata inside `History` itself, so the example persistence layer owns compatibility decisions.

### CRDT Documents And Updates

`CrdtDocument<T>` stores:

- `state: T`
- `meta: CrdtMeta`
- `pending: PendingUpdate[]`
- `schema: CrdtSchemaContext`

`CrdtLocalHistory<T>` stores:

- `base: CrdtDocument<T>`
- `doc: CrdtDocument<T>`
- `updates: CrdtUpdate[]`

CRDT updates are schema-shaped in two places:

- `set.value`
- CRDT path segments, because object fields, tagged union branches, record entries, and array items are schema-dependent

CRDT update validation already walks an update path through the app schema and validates `set.value` against the schema at that path. This is the right machinery to reuse after migration.

### Local-First And PeerJS

`examples/react-crdt/src/lib/local-first` persists:

- one `PersistedReplica`
- retained `PersistedBatch[]`
- received-batch markers

The protocol includes `schemaVersion` and `schemaFingerprint` on every message and currently rejects mismatches in `parseLocalFirstMessage`. Batch and snapshot payloads are also validated against the current schema.

There is already a narrow migration layer in `local-first/migration.ts`. It finds a version path and migrates only `source.history.doc.state`, then creates a new CRDT document/history with an empty vector and no retained log. That means it intentionally loses history and does not prove replay equivalence.

### Server Mode

The server stores one `schemaFingerprint` per document and rejects future clients with a different fingerprint. Server event payloads contain branch update events and merge events. The client persists branch-local `CrdtLocalHistory` plus branch event lists.

The server does not know the app schema today; it only compares fingerprints. The browser validates events when parsing server messages by using the current app schema.

## Recommended Architecture

### 1. Introduce A Versioned Schema Manifest

Add a shared migration description that app authors may provide:

```ts
type VersionedSchema<TState> = {
    version: number;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    fingerprint: string;
    fingerprintHash: string;
    tagKey?: string;
    validateState(input: unknown): IValidation<TState>;
};

type SchemaMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprintHash?: string;
    migrateState(input: TFrom): TTo;
    migratePatch?(input: Patch<TFrom>): Patch<TTo> | Patch<TTo>[] | null;
    migrateCrdtUpdate?(input: CrdtUpdate): CrdtUpdate | CrdtUpdate[] | null;
};

type SchemaMigrationConfig<TCurrent> = {
    current: VersionedSchema<TCurrent>;
    previous?: VersionedSchema<unknown>[];
    migrations?: SchemaMigration<unknown, unknown>[];
};
```

The public API should accept no migration config. When absent, existing exact schema checks remain in force.

The migration path should be explicit and ordered by versions. Fingerprints should still be checked so that version numbers do not accidentally accept a different old schema. Use the hash for protocol/storage comparison, while retaining the full fingerprint locally for debugging and migration lookup.

### 2. Add Shared Migration Runners

The most important design choice is to make migration replayable, not just transform the final state.

Recommended core helpers:

```ts
type MigrationResult<T> = {
    value: T;
    migrationIds: string[];
    fromVersion: number;
    toVersion: number;
    fromFingerprintHash: string;
    toFingerprintHash: string;
};

function migrateValue<T>(config, value: unknown, from): MigrationResult<T>;
function migratePatchHistory<T>(config, history: unknown, from): MigrationResult<History<T, unknown>>;
function migrateCrdtHistory<T>(config, history: unknown, from): MigrationResult<CrdtLocalHistory<T>>;
function migrateCrdtUpdates(config, updates: CrdtUpdate[], from): CrdtUpdate[];
```

For CRDT history, the runner should:

1. Validate the old base and old realized state against the old schema, when available.
2. Migrate `base.state` and rebuild the base document metadata with the old base timestamp or a controlled migration timestamp.
3. Migrate every retained update in order.
4. Validate migrated updates against the target schema.
5. Replay migrated updates from migrated base with `applyCrdtUpdate`.
6. Migrate the old realized state separately.
7. Validate the migrated realized state.
8. Compare replay result against migrated realized state.

If replay differs, the migration must fail loudly. This catches accidental state-only migrations that do not correctly preserve the history semantics.

### 3. Treat CRDT Metadata As Rebuildable, Not Migratable

Do not require app authors to migrate `CrdtMeta` directly.

`CrdtMeta` encodes schema-dependent structure, path parent timestamps, array item identities, and tagged-union incarnation data. Letting application code edit it is high-risk and hard to type. Instead:

- migrate state values
- migrate update paths and values
- rebuild migrated base metadata from the migrated base state and target schema
- replay the migrated updates to produce target metadata

This keeps the app API focused on domain transformations.

One caveat: if the migrated base is rebuilt with fresh timestamps, old updates with older timestamps may be discarded. The migration runner must preserve or derive compatible timestamps. The best default is to rebuild base metadata using the original base metadata versions where paths still map one-to-one, and require a migration timestamp only for newly introduced fields. This likely needs a helper such as `migrateCrdtMetaFromState(oldMeta, oldState, newState, mapping, schema)`.

### 4. Make Update Migration Path-Aware

Raw `CrdtUpdate` migration is possible but too low-level for common cases. Provide utilities that operate on logical paths:

- drop updates whose path was deleted
- rename object fields
- move a field value from one path to another
- add defaults when a set writes an object that now requires a new field
- rewrite tagged union discriminator values and branch field paths
- rewrite normal `Patch` paths in the same way

The API can still allow arbitrary `migrateCrdtUpdate`, but examples should encourage small reusable transformers.

Important rule: dropping an update is only valid if the independently migrated realized state no longer depends on it, and replay verification must prove that.

### 5. Fingerprint Hashing

Today `schemaFingerprint` is a stable JSON string of root schema, components, and tag key. For network protocols and persisted headers, add:

```ts
schemaFingerprintHash = sha256(stableStringify({root, components, tagKey}))
```

Use the hash for handshake comparison. Keep the unhashed fingerprint as optional debug metadata or for migration manifests. This reduces bandwidth and makes protocol messages less noisy.

For browsers, `crypto.subtle.digest` is async. Since fingerprinting is part of app setup, either:

- compute hashes async during runtime initialization, or
- use a tiny sync SHA-256 dependency / build-time generated hash

For the examples, async runtime computation is acceptable. For library ergonomics, a sync helper may be worth the dependency.

## Integration Points

### Non-CRDT Local History

Add schema metadata to persisted local history wrappers, not necessarily to core `History` immediately:

```ts
type PersistedHistory<T, An> = {
    storageVersion: 1;
    schemaVersion: number;
    schemaFingerprintHash: string;
    history: History<T, An>;
};
```

Migration should transform:

- `initial`
- `current`
- every `nodes[id].changes`

Then verify each reachable node by replaying patches from `initial`. At minimum, verify `tip` replay equals `current`; stronger verification should materialize all nodes because branches and jump targets are user-visible history.

### Local-First And PeerJS

For `PersistedReplica`, migrate in place only when the migration is deterministic and replay verification passes. The upgraded replica should retain:

- same `docId`, unless the migration explicitly requests a fork
- same `replicaId`
- migrated `history.base`
- migrated `history.doc`
- migrated `history.updates`
- migrated retained batches
- migrated vector metadata where timestamps are unchanged
- lineage metadata

The existing “create a new empty migrated document” behavior should become an alternative/fallback, not the primary serious migration path.

PeerJS messages already carry schema metadata, so old peers should be rejected. That is the correct default. A mixed-version mesh should not attempt live protocol translation unless there is a strong reason; require peers to update before syncing.

### Server Client

The browser client can migrate its local persisted `PersistedServerReplica` just like local-first:

- migrate each branch history
- migrate each branch event update payload
- keep merge events structurally unchanged
- replay/materialize every branch to verify branch histories

The server itself stores only event JSON and document fingerprint. There are two viable directions:

1. Client-driven migration: a new client connects with an explicit migration request, downloads old events, migrates them locally, and uploads a new document or migration event stream.
2. Server-aware migration: server has access to a migration bundle and rewrites stored document events transactionally.

Given the current example server is schema-agnostic, client-driven migration is the better fit. It avoids shipping app schemas/migration code to the Bun server.

The server protocol should distinguish “you are outdated” from generic invalid messages. A server error such as `schemaMismatch` should include the server’s `schemaFingerprintHash` and, optionally, `schemaVersion`. The client can show “update your app to connect” instead of a generic connection error.

## Verification Strategy

Migration should fail unless all of these hold:

- every source state/update/patch validates against its declared source schema, when the source schema exists
- every migrated state/update/patch validates against the target schema
- migrated updates replay cleanly from migrated base
- replay result deep-equals migrated realized state
- pending CRDT updates are either migrated and remain pending for a known reason, or are cleared only by an explicit migration decision
- local-first retained batches produce the same migrated update sequence as `history.updates`
- server branches materialize consistently after event migration

Tests should include:

- deleted field: state and update history drop the field
- optional field added: no update changes required
- required field with default: state defaults and object-set updates receive defaults
- field rename: paths and values migrate
- nested move: old path updates become new path updates
- tagged union branch rename
- array item update migration without changing item ids
- failed migration where replayed state differs from migrated realized state
- local-first retained batch migration
- server branch migration with merge events

## Alternative Solutions

### State-Only Migration

This is the current local-first approach. It migrates realized state and creates a fresh document.

Pros:

- simple
- robust for prototypes
- avoids CRDT path/meta complexity

Cons:

- loses retained history
- loses undo/redo provenance
- cannot satisfy replay verification
- does not support server branches/event logs well

This should remain as an explicit “fork/reset history” mode.

### Schema Compatibility Rules Without Migrations

The library could compare old/new schemas and allow known-safe changes automatically.

Pros:

- less application code for simple optional-field additions or removed fields
- useful diagnostics

Cons:

- “safe” depends on stored history, not just final schema
- moving fields and defaults still require domain logic
- CRDT paths make purely structural inference brittle

This is a good future enhancement for warnings and helper generation, but not enough as the migration mechanism.

### Protocol-Level Translation Between Versions

Peers or servers could translate updates between schema versions live.

Pros:

- enables mixed-version collaboration
- avoids forcing all clients to update at once

Cons:

- complex bidirectional migration semantics
- hard to preserve CRDT convergence if migrations are not invertible
- server currently does not own app schemas

Reject this for now. Migrate persisted documents/logs at rest and reject mismatched live clients.

### Store One Snapshot Per Schema Version

Keep old event logs untouched and add a new migrated snapshot/log at the latest version.

Pros:

- avoids rewriting old data
- preserves auditability
- simpler rollback story

Cons:

- requires storage and UI decisions around multiple lineages
- old branches/events still need translation for inspection
- not enough if the app wants all current logs to be replayable under the current schema

This is useful for server migrations where destructive rewrites are risky.

## Open Questions

- Should migration live in core `umkehr` exports, CRDT exports, example-app helpers, or a separate `umkehr/migration` entrypoint?
  - separate entrypoint, as it will depend on typia
- Do we add schema metadata to core `History` and `CrdtLocalHistory`, or only persisted wrappers?
  - let's try wrappers
- How should newly introduced CRDT metadata timestamps be chosen so old updates are not accidentally discarded?
  - add a deterministic suffix to the previous timestamp.
- Should source schemas be required for every prior version, or can migrations opt into “trust source shape” mode?
  - required for every prior version
- Should migration functions be allowed to emit multiple CRDT updates for one source update?
  - seems like this might be important
- Should migration functions be allowed to drop updates, and should dropped update ids be recorded for audit/debugging?
  - yes, allowed to drop updates, and no recording necessary
- How should pending CRDT updates be handled during migration?
  - they should first be applied, and then the migration can happen
- Should retained local-first batches be the source of truth, or should `history.updates` be the source of truth with batches regenerated?
  - batches should probably be the source of truth with history.updates reconstructed from the batches
- In server mode, should migration create a new document id, append migration events, or rewrite event payloads transactionally?
  - it should (1) archive a backup of the unmigrated state, and then (2) rewrite the whole state with the migrated data transactionally
- Do we want a protocol-level `schemaVersion`, or is `schemaFingerprintHash` sufficient for server mode?
  - schemaVersion and schemaFingerprintHash would be good
- Can schema fingerprints be generated at build time to avoid async SHA-256 setup in React?
  - yes let's generate at build time
- Should migration configs support downgrade/inverse migrations, or only monotonic upgrades?
  - no downgrades

## Additional notes

- non-crdt (local) needs fingerprint hasing too, not just crdt-mode
- we'll want our HLC timestamp format to allow an additional suffix, so we can easily produce neighboring update timestamps

## Notes about the server case

Server migrations require additional care, as the server itself is schema-agnostic. Here's the proposed flow:

1. client (A) starts up with a new version. the first thing it does is upgrade its own data, including any pending updates
1. a client (A) connects to the server, with a newer schema version than the server has seen for this document
2. server first checks for any other clients that are already migrating that document. if someone else has gotten to it first, it responds with 'wait-for-migration'. otherwise it responds to client A with a 'server-migration-required' message
3. the user is notified that the given document requires a migration, which they can choose to execute or leave
4. if they choose to execute the migration, the client sends 'server-migration-request'. the server then gives client A a 'migration lock', and responds with a full dump of all branches. It also sends a 'wait-for-migration' message to all other connected clients.
5. client A performs the migration of server data locally & sends the full data package back to the server
6. while a migration lock is in place, the server rejects all messages from other clients for that document (those clients retain any updates as 'pending')
7. once the migration has completed, migration lock is released, and client A is able to connect normally. All other clients are given a 'client-migration-required' message, and they should show a message to the user that they need to update their app.
8. client B, having upgraded their app, might have some pending updates from the previous schema. It should migrate those updates and then send them to the server normally.

- migration lock should expire after 1 minute of inactivity. if it expires, then clients that were waiting on 'wait-for-migration' should get a 'migration-cancelled' message, indicating they can resume operation
- server should store its data keyed by schemaHash. migrated data should not overwrite the old data. but once a migration has taken place, the old data should not be accessible by clients.
- once a client has migrated its data, it can discard the old data

## Suggested Direction

Implement this in layers:

1. Add fingerprint hashing and keep exact mismatch rejection.
2. Add shared versioned schema/migration config types.
3. Build non-CRDT `History` migration and replay verification first.
4. Build CRDT history migration with state/update migration and replay verification.
5. Replace local-first state-only migration with history-preserving migration, keeping state-only fork as fallback.
6. Add server-client persisted replica migration.
7. Only then consider server-side document migration workflows.

The core invariant should be simple: after migration, the current schema validates every retained operation, and replaying the migrated operation log produces the migrated state.
