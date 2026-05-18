# Local-first new-document migration plan

This plan implements schema migration for the `examples/react-crdt` local-first mode using only the "migrate into a new document" flow.

We are intentionally not building in-place migration. A schema migration creates a new local-first document from the old document's materialized state. The old document remains preserved under its original schema version, document id, retained batches, and sync metadata.

## Goals

- Preserve old local-first documents exactly as they are.
- Let an app author define state-only migrations from old state shape to new state shape.
- Create a new CRDT document with current schema metadata from migrated state.
- Make the new document a distinct sync target with its own `docId`.
- Keep PeerJS synchronization simple: peers sync only when `docId` and schema metadata match.
- Provide UI that makes document lineage and migration consequences explicit.

## Non-Goals

- No in-place schema migration.
- No CRDT metadata-preserving migration.
- No operation-log migration.
- No cross-document reconciliation.
- No automatic syncing of old-schema edits into the new document after migration.
- No support for accepting live update batches from a different schema fingerprint.

## Current Baseline

Today local-first persistence stores one replica per `docId`:

- durable `replicaId`;
- `PersistedReplica<TState>` keyed by `docId`;
- retained batches keyed by `{docId, origin, batchId}`;
- received batch ids keyed by `{docId, origin, batchId}`;
- exact `schemaFingerprint`;
- no explicit app schema version;
- schema mismatch blocks load.

That means the first implementation needs to add versioned document identity before it can add migration behavior.

## Design Decisions

### Migration Creates A New `docId`

The migrated document must have a protocol-level `docId` different from the source document.

Example:

```ts
source docId: umkehr-react-crdt-todos-v1
target docId: umkehr-react-crdt-todos-v2
```

This keeps PeerJS sync and IndexedDB records honest:

- old peers continue syncing the old document;
- new peers sync the new document;
- no peer attempts to replay old-schema update batches into the new document.

### Replica Identity Is Reused

The browser replica identity should remain the same across migrated documents.

Rationale:

- `replicaId` identifies the browser/profile, not a single document;
- preserving it makes lineage and diagnostics easier;
- the new document starts with a fresh vector, so reusing the actor id does not imply old causal history is part of the new document.

If this later causes confusing diagnostics, we can add a document-local actor alias. Do not start there.

### New Document Starts With Fresh Sync State

The migrated document should start with:

- `vector: {}`;
- `compactedThrough: undefined`;
- no retained batches;
- no received batch ids;
- a fresh `CrdtLocalHistory` created from migrated state and current schema.

The migration is document creation, not log continuation.

### Old Document Remains Loadable

The storage layer should retain the source document and its logs. The UI should allow export at minimum; a later document picker can allow opening it when the app still has a compatible schema/migration config.

## Data Model Changes

Update `examples/react-crdt/src/lib/local-first/types.ts`.

Add schema and lineage metadata:

```ts
export type LocalFirstSchemaMetadata = {
    version: number;
    fingerprint: string;
};

export type DocumentLineage = {
    sourceDocId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprint: string;
    migratedAt: string;
    migrationId: string;
};
```

Extend `PersistedReplica`:

```ts
export type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaVersion: number;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    lineage?: DocumentLineage;
    updatedAt: string;
};
```

Backward compatibility:

- existing persisted replicas have no `schemaVersion`;
- treat missing version as `1`;
- keep exact fingerprint checks for normal load;
- only migrate if a configured migration path matches the source version/fingerprint.

Add migration state to the UI-facing persistence model:

```ts
export type LocalFirstPersistenceState =
    | {kind: 'loading'}
    | {kind: 'ready'; source: 'created' | 'loaded' | 'migrated'; savedAt?: string}
    | {kind: 'saving'; source: 'created' | 'loaded' | 'migrated'; savedAt?: string}
    | {kind: 'incompatible'; message: string; migration?: AvailableMigration}
    | {kind: 'error'; message: string};
```

Keep this minimal if TypeScript churn gets large. The important user-visible piece is: schema mismatch can expose an available migration action.

## App Migration Configuration

Do not add migration fields directly to `AppDefinition` in the first pass. That type is shared by non-local-first examples.

Create local-first-only migration config:

```ts
export type LocalFirstMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprint?: string;
    toDocId: string | ((sourceDocId: string) => string);
    migrateState(input: TFrom): TTo;
};

export type LocalFirstSchemaConfig<TState> = {
    version: number;
    migrations: LocalFirstMigration<unknown, TState>[];
};
```

For the current todos app, initially configure:

```ts
const localFirstTodosSchema = {
    version: 1,
    migrations: [],
};
```

When a real schema change happens, add a `version: 2` config and a migration from `1 -> 2`.

Where to pass it:

- keep `AppDefinition` unchanged;
- add an optional `localFirstSchema` registry next to app registration, or
- pass a default `{version: 1, migrations: []}` from `LocalFirstApp` until the example has multiple schema versions.

Recommended first step: add a small helper in `lib/local-first/schemaConfig.ts` that returns default config for any app. App-specific overrides can come later.

## Persistence Changes

Update `examples/react-crdt/src/lib/local-first/persistence.ts`.

Add helpers:

```ts
export async function listReplicas(): Promise<PersistedReplica<unknown>[]>;
export async function hasReplica(docId: string): Promise<boolean>;
export async function exportReplicaBundle(docId: string): Promise<...>;
```

For migration creation, add a transaction-oriented helper if practical:

```ts
export async function createMigratedReplica<TState>(
    replica: PersistedReplica<TState>,
): Promise<void>;
```

This can start as `saveReplica(migrated)` because the source document is intentionally unchanged. There is no need to delete old batches or received ids.

Indexes:

- existing `replicas` keyed by `docId` is enough;
- consider adding an index on `schemaFingerprint` or `lineage.sourceDocId` later, but not required for the first pass.

## Migration Engine

Create `examples/react-crdt/src/lib/local-first/migration.ts`.

Responsibilities:

- normalize old persisted metadata;
- find a migration path from persisted schema version/fingerprint to current config;
- run migrations in order;
- validate migrated state with current `app.validateState`;
- create a new `CrdtLocalHistory` using current schema;
- build the target `PersistedReplica`;
- refuse to overwrite an existing target document unless the user explicitly confirms reset/replace.

Suggested API:

```ts
export type MigrationCandidate<TState> = {
    sourceDocId: string;
    targetDocId: string;
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    sourceSchemaFingerprint: string;
    migrationIds: string[];
};

export function findMigrationCandidate<TState>(...): MigrationCandidate<TState> | null;

export function createMigratedReplica<TState>(...): PersistedReplica<TState>;
```

Timestamp policy:

- use `hlc.pack(hlc.init(identity.replicaId, Date.now()))` for the rebuilt document;
- the new document vector remains `{}` because no retained CRDT batches exist yet;
- the first local edit will advance the vector normally.

Validation policy:

- if `migrateState` output fails current `validateState`, block migration and show an error;
- do not save partially migrated replicas.

## LocalFirstApp Flow

Update `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`.

Current flow:

1. load identity;
2. acquire tab lock for `runtime.docId`;
3. load replica for `runtime.docId`;
4. reject fingerprint mismatch.

New flow:

1. compute current `schemaFingerprint`;
2. read current `LocalFirstSchemaConfig`;
3. load identity;
4. acquire tab lock for the current `runtime.docId`;
5. load replica for current `runtime.docId`;
6. if missing, create current-schema replica as today;
7. if fingerprint matches, load as today;
8. if fingerprint mismatches, look for a new-document migration candidate;
9. if candidate exists, show migration screen;
10. if no candidate exists, show incompatible screen with reset/export options.

Migration screen actions:

- "Create migrated document";
- "Export old document";
- "Reset current document" only if the user wants to discard.

After "Create migrated document":

1. run migration;
2. save new replica under target `docId`;
3. switch app to the target document.

Switching app to target document needs one of these:

- update the route/query to carry `docId`;
- update runtime selection to use target `docId`;
- reload into `#local-first&doc=...` or equivalent.

Recommended route shape:

```txt
#local-first?doc=umkehr-react-crdt-todos-v2
```

The current app already uses `window.location.search` for `peer`; because hash routing currently carries only mode, prefer search params for `doc` as well:

```txt
?doc=umkehr-react-crdt-todos-v2#local-first
```

Then `LocalFirstApp` can resolve active doc id:

```ts
const activeDocId = readDocId() ?? runtime.docId;
```

Acceptance criteria:

- default local-first URL still uses `runtime.docId`;
- migrated documents can be opened by `?doc=target#local-first`;
- invite links include both `peer` and `doc`.

## Runtime Doc Identity

`CrdtRuntime<TState>` currently has a fixed `docId`. For migrated documents, local-first needs an active document id separate from the runtime default.

Do not change `CrdtRuntime` globally unless necessary.

Instead:

- in `LocalFirstApp`, compute `activeDocId`;
- pass `activeDocId` into `useLocalFirstSync`;
- pass `activeDocId` into `LocalFirstControls`;
- use `activeDocId` for persistence, tab lock, PeerJS protocol, batches, and invite links.

The CRDT provider does not need to know the doc id directly.

## Protocol Changes

Update `examples/react-crdt/src/lib/local-first/protocol.ts` and `session.ts`.

Add schema metadata to messages:

```ts
type SchemaHeader = {
    schemaVersion: number;
    schemaFingerprint: string;
};
```

At minimum add to:

- `hello`;
- `snapshot`;
- `members`.

Optionally add to every message for easier validation:

- `updates`;
- `syncRequest`;
- `syncResponse`.

Recommended: add to every message. It makes invalid cross-schema delivery easy to reject at the protocol boundary.

Parser policy:

- reject messages with mismatched `docId`;
- reject messages with mismatched `schemaFingerprint`;
- reject messages with unsupported `schemaVersion`;
- record a clear connection error for schema mismatch.

Do not auto-migrate remote snapshots in this pass. Migration is a local action from a locally stored source document into a new document.

Member gossip:

- include current `docId`, schema version, and fingerprint in member entries;
- only auto-connect to members advertising the same `docId` and schema metadata;
- surface incompatible discovered members in diagnostics later if useful.

## Invite Links

Update `LocalFirstControls`.

Invite URLs must include:

- `peer`;
- active `doc`;
- `#local-first`.

Example:

```txt
http://localhost:5177/?peer=abc&doc=umkehr-react-crdt-todos-v2#local-first
```

This prevents a migrated document invite from accidentally connecting someone to the default old document id.

## UI Changes

### Incompatible/Migratable Screen

Replace the current generic error for schema mismatch with a dedicated local-first screen.

Show:

- current document id;
- current schema version/fingerprint;
- persisted schema version/fingerprint;
- target migrated document id when available;
- warning that the old document will be preserved and the new document will not receive future old-document edits automatically.

Actions:

- Create migrated document;
- Export old state;
- Reset local document.

### Loaded Migrated Document

In `LocalFirstControls`, show lineage when present:

- source doc id;
- source schema version;
- migration id;
- migrated at timestamp.

Also show active doc id prominently. This matters once `runtime.docId` and active doc id can differ.

### Document Picker

Do not build a full document picker in the first pass.

A minimal follow-up can list local replicas and let the user open old migrated-from documents by URL. For the first pass, export plus direct URL is enough.

## Sync Semantics

For new-document migration:

- source document sync continues independently;
- target document sync starts fresh;
- old peers are not behind the target document;
- target peers need the target `docId` invite link;
- no retained batches are copied from source to target;
- no received-batch ids are copied from source to target.

If a peer sends a message for the old doc id to a target-doc connection, reject it.

If a peer advertises the old schema fingerprint for the target doc id, reject it.

This keeps synchronization simple and avoids ambiguous "same logical document, different schema" behavior.

## Testing Plan

### Pure Migration Tests

Add tests in `examples/react-crdt/src/lib/local-first/local-first.test.ts` or split into `migration.test.ts`.

Cover:

- missing `schemaVersion` normalizes to `1`;
- exact fingerprint match does not produce migration candidate;
- fingerprint mismatch with no migration path produces no candidate;
- migration path creates expected target doc id;
- migrated state validates against current schema;
- invalid migrated state fails without saving;
- created migrated replica has:
  - target `docId`;
  - target schema version/fingerprint;
  - same `replicaId`;
  - empty `vector`;
  - no `compactedThrough`;
  - `lineage` pointing to source;
  - current schema context in `history.doc.schema`.

### Persistence Tests

Use pure helpers where possible. IndexedDB tests may require browser-ish test setup, so do not start there unless existing tooling supports it cleanly.

At minimum test that migration helper does not mutate the input persisted replica.

### Protocol Tests

Extend existing local-first protocol/session tests:

- valid messages include schema metadata;
- mismatched schema fingerprint is rejected;
- mismatched schema version is rejected;
- mismatched `docId` remains rejected;
- member gossip for another doc/schema does not produce `connect` effects;
- invite/session state includes active doc id.

### Example Build Checks

Run:

```sh
npm run typecheck:examples
npm test
npm run build
```

For the example build, run from `examples/react-crdt`.

### Manual Smoke

1. Create local-first document at old/default doc id.
2. Simulate schema version bump with migration config.
3. Load app.
4. Verify migration screen appears.
5. Create migrated document.
6. Verify URL changes to target doc id.
7. Verify old replica remains in IndexedDB.
8. Open second browser profile with target invite link.
9. Verify target document syncs.
10. Verify old-doc invite does not sync into target doc.

## Implementation Phases

### Phase 1: Schema Metadata Plumbing

- Add `schemaVersion` and `lineage` fields to persisted types.
- Add default local-first schema config with version `1`.
- Normalize old persisted replicas missing `schemaVersion`.
- Keep exact fingerprint load behavior.
- Show active doc id in controls.

Acceptance:

- existing local-first state still loads;
- no migration behavior yet;
- tests pass.

### Phase 2: Active Doc ID Routing

- Add `?doc=` support for local-first.
- Use active doc id for persistence, tab lock, sync protocol, retained batches, and invite links.
- Keep default behavior when no `doc` param exists.

Acceptance:

- `#local-first` still works;
- `?doc=some-doc#local-first` creates/loads a separate replica;
- invite links include `doc`.

### Phase 3: Migration Engine

- Add `migration.ts`.
- Implement candidate discovery and migrated replica construction.
- Add pure tests.
- Do not wire UI yet except maybe developer-only logs.

Acceptance:

- migration helper creates a new persisted replica object with correct lineage;
- old replica object remains unchanged.

### Phase 4: Migration UI Flow

- Replace schema mismatch error with migratable/incompatible state.
- Add "Create migrated document" action.
- Save target replica.
- Navigate to `?doc=targetDocId#local-first`.
- Add export old state if straightforward.

Acceptance:

- schema mismatch with migration path can create/open target doc;
- schema mismatch without path still blocks safely;
- old source doc remains stored.

### Phase 5: Protocol Schema Headers

- Add schema metadata to local-first messages.
- Reject mismatched schema at parse/session boundary.
- Include schema metadata in member gossip.
- Update tests.

Acceptance:

- same doc id but different schema cannot exchange updates;
- migrated target peers sync only with target peers.

### Phase 6: Diagnostics Polish

- Show lineage in local-first status.
- Show incompatible peer/member diagnostics if discovered.
- Add clearer reset/export language for old documents.

Acceptance:

- user can tell which document they are editing;
- user can tell when it came from a migration.

## Risks

- Active `docId` routing may expose assumptions that the rest of the example treats `runtime.docId` as immutable.
- Adding schema metadata to every protocol message creates broad test churn.
- Without a document picker, old documents are preserved but not very discoverable.
- Reusing the same `replicaId` across source and target documents is conceptually reasonable, but diagnostics must avoid implying shared vector history.
- If the migration target doc id already exists, we need a clear conflict policy.

## Conflict Policy For Existing Target Doc

If `targetDocId` already exists:

- do not overwrite automatically;
- offer "Open existing migrated document";
- optionally offer "Replace target document" behind a confirmation;
- preserve the source document regardless.

First pass can simply block and instruct the user to open the existing target document.

## Open Questions

- Should `?doc=` be accepted for all modes or only local-first?
- Should migration configs be registered per `app.id`, per `runtime.docId`, or both?
- What should the default target doc id convention be: explicit only, `${source}@${version}`, or app-provided?
- Do we need a storage index for lineage, or is listing all replicas enough?
- Should export include retained batches and received ids, or only materialized state?

## Recommended First PR Shape

Keep the first implementation narrow:

1. Add schema metadata and active doc id routing.
2. Add migration engine and tests.
3. Add migration UI for creating a new document.
4. Add protocol schema headers.

Avoid document picker, operation-log migration, and remote snapshot migration until the core flow is working.
