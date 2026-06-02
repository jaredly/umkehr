# Local-first schema migration research

This document looks at schema migration options for the `examples/react-crdt` local-first mode.

The current implementation is intentionally conservative: it computes a schema fingerprint from the app schema root, components, and `tagKey`; persists that fingerprint with the local replica; and refuses to load a persisted document when the current app fingerprint differs. That protects the CRDT runtime from interpreting old metadata with a new schema, but it means any schema change currently requires reset or manual recovery.

The question is how to evolve that into a credible local-first migration story without making the example much larger than the thing it is meant to teach.

## Current Shape

Relevant files:

- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/local-first/schemaFingerprint.ts`
- `examples/react-crdt/src/lib/local-first/protocol.ts`
- `examples/react-crdt/src/lib/local-first/types.ts`

Persisted replica records currently look like:

```ts
type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    updatedAt: string;
};
```

The local-first mode also persists:

- retained CRDT batches;
- received batch ids;
- durable replica identity.

On load, if `persisted.schemaFingerprint !== schemaFingerprint(app)`, the app throws:

```ts
Persisted document schema does not match this app version.
```

There is no stored application schema version, migration chain, or compatibility policy today. The fingerprint tells us "same exact schema" versus "not same exact schema"; it does not tell us how to migrate.

## What Makes This Hard

Schema migration in a local-first CRDT app is harder than normal client persistence migration because there are several layers that can become incompatible independently.

### App State Shape

The visible state type can change:

- add optional field;
- add required field with default;
- rename field;
- delete field;
- split one field into several;
- change a primitive type;
- change an array item shape;
- change a tagged-union discriminator or variant.

Plain state migration can handle many of these.

### CRDT Metadata Shape

`CrdtDocument<T>` is not just `{state: T}`. It also stores CRDT metadata for every value:

- object field metadata;
- record entry metadata;
- array item ids and order metadata;
- tagged union metadata;
- primitive timestamps;
- tombstones;
- pending updates.

If a migration changes `state` without rebuilding matching metadata, the document can become internally inconsistent. If it rebuilds all metadata from the migrated state, it may lose important CRDT causality and undo/redo semantics.

### Retained Operation Log

Retained batches contain old `CrdtUpdate` objects. A batch generated against schema version `1` may refer to fields or tagged-union variants that do not exist in schema version `2`.

That creates questions:

- Can old batches still be applied after migration?
- Should old batches be rewritten?
- Should migration force log compaction into a snapshot?
- How should a migrated peer sync with an unmigrated peer?

### Multi-Replica Upgrade Timing

Local-first replicas do not upgrade together. One browser can run the new app while another still has the old app open or offline.

That means a useful migration story needs an answer for mixed-version sync:

- reject old peers;
- support a compatibility window;
- negotiate schema version per connection;
- migrate remote snapshots before accepting them;
- require all peers to upgrade through snapshots.

## Option 1: Keep Strict Fingerprint Rejection

This is the current behavior.

Behavior:

- exact schema fingerprint match loads normally;
- mismatch blocks load;
- user can reset local replica or accept a compatible peer snapshot manually if we add such UI.

Pros:

- very safe;
- simple to reason about;
- prevents silent corruption;
- appropriate for an example that is not promising production migration.

Cons:

- every schema change is destructive unless the user exports data first;
- poor local-first UX because offline local data can get stranded;
- does not demonstrate how production local-first apps evolve.

Best fit:

- early development;
- examples;
- apps where schema rarely changes or data can be thrown away.

Assessment:

Keep this as the fallback behavior even if we add migrations. "Unknown fingerprint" should never silently load as current schema.

## Option 2: In-Place State Migration With Metadata Rebuild

Store an explicit app schema version and a migration chain for plain state:

```ts
type SchemaVersion = number;

type StateMigration<From, To> = {
    from: SchemaVersion;
    to: SchemaVersion;
    migrateState(state: From): To;
};
```

Load flow:

1. Load persisted `CrdtLocalHistory<OldState>`.
2. Validate or best-effort read `history.doc.state`.
3. Run state migrations from old schema version to current.
4. Rebuild a fresh `CrdtDocument<NewState>` with `createCrdtDocument(migratedState, newSchema, timestamp)`.
5. Create a new local history from that document.
6. Set `compactedThrough` to the old vector.
7. Drop or archive retained batches from before the migration.
8. Save the migrated document back under the same `docId`.

Pros:

- simple implementation;
- handles common app shape changes;
- resulting document is internally consistent with the new schema;
- old retained log does not need to be understood after migration.

Cons:

- loses undo/redo stacks unless we explicitly discard or migrate them;
- rebuilds CRDT metadata, so all fields get fresh migration timestamps;
- old peers cannot apply new snapshot/logs unless they also upgrade;
- local retained batches before migration cannot be replayed after the migration;
- concurrent offline edits on old schema need snapshot recovery, not operation-level merge.

Important detail:

This option should be modeled as snapshot compaction. The migration creates a new base snapshot and declares that the old log has been compacted through the previous vector. Peers behind that frontier need the migrated snapshot.

Best fit:

- most practical first implementation;
- examples;
- app-level changes like adding fields, renaming fields, and deleting fields.

Recommendation:

This is the smallest automatic migration mechanism, but it is not always the best product behavior. It overwrites the local current document slot, so the old document is no longer directly available unless we also archive it.

## Option 3: Migrate Into A New Document

This is similar to Option 2 in that it migrates plain state and rebuilds CRDT metadata, but it does not replace the old document. The old document remains stored under its old schema version, and the migrated state is used to create a new document.

Behavior:

1. Load the old persisted document.
2. Run state migrations from the old schema version to the new schema version.
3. Create a new `CrdtDocument<NewState>` from the migrated state and current schema.
4. Persist that as a different document identity.
5. Preserve the old document, retained batches, received-batch index, and schema metadata.
6. Optionally record a link between the old and new documents.

Example data shape:

```ts
type DocumentLineage = {
    sourceDocId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprint: string;
    migratedAt: string;
    migrationId: string;
};

type PersistedReplica<TState> = {
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    lineage?: DocumentLineage;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    updatedAt: string;
};
```

The new `docId` could be:

- a new explicit app document id, such as `todos-v2`;
- the old document id plus schema suffix, such as `todos@2`;
- a generated document id linked to the old one through `lineage`.

Pros:

- preserves the old local-first document and all of its sync metadata;
- avoids destructive upgrade behavior;
- easier to explain: migration creates a new document, not a rewritten history;
- avoids pretending old and new operation logs are compatible;
- lets users keep accessing or exporting the old document;
- supports rollback by switching back to the old app/schema/document.

Cons:

- creates document fragmentation;
- peers on old schema and peers on new schema are no longer editing the same logical document unless the app defines a lineage relationship;
- local invite links and peer discovery must make the active `docId` clear;
- users can edit old and new documents independently after migration, creating divergent histories;
- cross-document dedupe/version vectors do not compose naturally;
- the app needs UI for selecting, archiving, or deleting old migrated-from documents.

Important detail:

This option should not reuse the old `docId` unless the storage layer can keep multiple schema-versioned replicas under one logical id. The local-first protocol currently uses `docId` as a hard compatibility boundary, so a new migrated document should normally have a new protocol `docId`.

Sync implications:

- Old-schema peers continue syncing the old document with old-schema peers.
- New-schema peers sync the new document with new-schema peers.
- A peer cannot sync old updates into the new document unless we add explicit cross-document migration logic.
- The migration event itself is better modeled as document creation from an old snapshot, not as a CRDT update in the old document.

UX implications:

- On mismatch, the app can offer "Create migrated document" instead of "Upgrade this document".
- After migration, show "created from `<old doc>` at `<time>`".
- Keep an affordance to export or open the old document.
- Warn that edits made to the old document after migration will not automatically appear in the new document.

Best fit:

- major schema changes;
- products where preserving original local data matters more than seamless continuity;
- migrations where old and new operation logs cannot be safely reconciled;
- example-level implementation because the model is honest and relatively safe.

Assessment:

This is a strong option for the example. It avoids the most dangerous part of Option 2: silently replacing the old document and calling the result the same document. It does require a clearer document identity model, but that is a useful local-first lesson.

## Option 4: CRDT Document Migrations That Preserve Metadata

Instead of rebuilding the whole document, write migrations that transform both `state` and `meta`.

Examples:

- adding a field adds a corresponding CRDT meta field with a migration timestamp;
- renaming a field moves the existing field metadata to the new key;
- deleting a field preserves a tombstone or removes metadata according to policy;
- changing array item shape recursively migrates each item metadata;
- changing tagged unions updates tagged metadata carefully.

Pros:

- preserves more causality than a full rebuild;
- can preserve undo/redo in some cases;
- may allow retained batches that target unchanged paths to keep working;
- closer to what a production CRDT system would eventually want.

Cons:

- much more complex;
- tightly coupled to internal CRDT metadata representation;
- easy to create subtly invalid documents;
- every schema change needs a bespoke metadata-aware migration;
- old retained operations may still be invalid if paths changed.

Best fit:

- library-level migration APIs after the CRDT metadata format stabilizes;
- high-value apps that need minimal data loss across complex migrations.

Assessment:

Not a good first target for the example. It is worth documenting as a future production direction, but adding it now would make the example more about metadata migration than local-first sync.

## Option 5: Operation-Log Migrations

Rewrite retained `CrdtUpdate` batches from old schema paths to new schema paths.

Example:

- field rename from `title` to `name` rewrites CRDT update paths;
- variant rename rewrites tagged-union metadata and update payloads;
- removed fields drop corresponding updates.

Pros:

- preserves operation history;
- can allow incremental sync after migration instead of forcing snapshots;
- useful for long-lived logs.

Cons:

- hardest option to implement correctly;
- CRDT updates include schema-shaped paths and timestamps;
- not every state migration has an operation-log equivalent;
- rewritten updates may no longer match original validation rules;
- peers can disagree if they run different rewrite logic.

Best fit:

- specialized migrations for simple path renames;
- production systems with strong migration tooling and test fixtures.

Assessment:

Avoid for now. If we do this later, it should be opt-in per migration, with snapshot fallback.

## Option 6: Dual-Schema Compatibility Window

Let the app understand two adjacent schema versions at once.

Behavior:

- current app can validate/load both `v1` and `v2`;
- incoming messages include schema version or fingerprint;
- old-schema snapshots are migrated on receipt;
- old-schema batches are either rejected, translated, or accepted only until a cutoff;
- outgoing messages use current schema.

Pros:

- smoother rolling upgrade;
- offline old peers can reconnect and be migrated;
- better user experience than hard rejection.

Cons:

- doubles protocol complexity;
- requires the app to validate old and new schemas;
- still needs policy for old operation logs;
- can keep legacy compatibility code around longer than intended.

Best fit:

- production apps where users may have multiple tabs/devices on different app builds.

Assessment:

Useful as a future capability, but probably too much for the example unless we scope it to snapshot migration only.

## Option 7: User-Mediated Export/Import Migration

On mismatch, offer export/import:

- export old local state as JSON;
- run an import migration into current schema;
- create a new local replica document from migrated state;
- discard old retained batches;
- keep old raw export available for debugging.

Pros:

- simple and explicit;
- avoids automatic data loss;
- useful even when automatic migration fails;
- good for examples and debugging.

Cons:

- manual;
- not seamless local-first;
- does not solve multi-peer upgrade automatically.

Best fit:

- recovery UI;
- examples;
- debugging local IndexedDB data.

Assessment:

This pairs well with Options 2 and 3. Even if automatic migrations exist, export/import is a good escape hatch.

## Recommended Direction

Use a three-layer policy:

1. Keep strict fingerprint rejection as the default safety net.
2. Add explicit app schema versions and state-only migration functions.
3. Prefer "migrate into a new document" for major schema changes; use in-place snapshot migration only when the app author explicitly wants continuity under the same `docId`.

Avoid CRDT metadata and operation-log migrations initially.

The result should be:

- safe by default;
- understandable in the example;
- enough to demonstrate a real local-first migration approach;
- extensible if the core library later grows metadata-aware migration APIs.

## Proposed Data Model Changes

Add explicit schema metadata to persisted replicas:

```ts
type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaVersion: number;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    lineage?: {
        sourceDocId: string;
        sourceSchemaVersion: number;
        sourceSchemaFingerprint: string;
        migratedAt: string;
        migrationId: string;
    };
    migratedFrom?: {
        schemaVersion: number;
        schemaFingerprint: string;
        migratedAt: string;
        compactedThrough: VersionVector;
    };
    updatedAt: string;
};
```

Add schema version to app definitions or local-first configuration:

```ts
type LocalFirstSchemaConfig<TState> = {
    version: number;
    fingerprint: string;
    migrations: StateMigration<unknown, unknown>[];
};
```

The current `AppDefinition<TState>` does not expose a version. We can either:

- add `schemaVersion` to `AppDefinition`;
- add a local-first-only wrapper config;
- derive a version from the app module manually for the example.

For the example, adding `schemaVersion` to `AppDefinition` may be too broad. A local-first-only config is less invasive.

## Proposed Migration API

For a first pass:

```ts
type LocalFirstMigration = {
    fromVersion: number;
    toVersion: number;
    fromFingerprint?: string;
    mode: 'in-place' | 'new-document';
    migrateState(input: unknown): unknown;
    nextDocId?(oldDocId: string): string;
};
```

In-place load algorithm:

```ts
if (persisted.schemaFingerprint === currentFingerprint) {
    loadNormally();
} else if (canMigrate(persisted.schemaVersion, currentSchemaVersion)) {
    const migratedState = runMigrations(persisted.history.doc.state);
    const migratedHistory = createCrdtLocalHistory(
        createCrdtDocument(migratedState, currentSchema, {
            timestamp: migrationTimestamp,
            tagKey,
        }),
    );
    saveReplica({
        ...persisted,
        schemaVersion: currentSchemaVersion,
        schemaFingerprint: currentFingerprint,
        history: migratedHistory,
        compactedThrough: persisted.vector,
        migratedFrom: {
            schemaVersion: persisted.schemaVersion,
            schemaFingerprint: persisted.schemaFingerprint,
            migratedAt: now,
            compactedThrough: persisted.vector,
        },
    });
    deleteRetainedBatchesDominatedBy(persisted.vector);
} else {
    blockLoadWithRecoveryOptions();
}
```

Important choices:

- Use a timestamp from the local replica actor for the rebuilt document.
- Keep `vector` as the knowledge frontier from the old document.
- Set `compactedThrough` to the old vector, because pre-migration batches are no longer useful in current schema.
- Clear undo/redo stacks unless we later add explicit command migration.
- Keep `receivedBatches` entries so duplicates from old peers do not get reprocessed.

New-document algorithm:

```ts
if (persisted.schemaFingerprint === currentFingerprint) {
    loadNormally();
} else if (canMigrateIntoNewDocument(persisted.schemaVersion, currentSchemaVersion)) {
    const migratedState = runMigrations(persisted.history.doc.state);
    const nextDocId = migration.nextDocId?.(persisted.docId) ?? `${persisted.docId}@${currentSchemaVersion}`;
    const migratedHistory = createCrdtLocalHistory(
        createCrdtDocument(migratedState, currentSchema, {
            timestamp: migrationTimestamp,
            tagKey,
        }),
    );
    saveReplica({
        docId: nextDocId,
        schemaVersion: currentSchemaVersion,
        schemaFingerprint: currentFingerprint,
        replicaId: persisted.replicaId,
        history: migratedHistory,
        vector: {},
        compactedThrough: undefined,
        lineage: {
            sourceDocId: persisted.docId,
            sourceSchemaVersion: persisted.schemaVersion,
            sourceSchemaFingerprint: persisted.schemaFingerprint,
            migratedAt: now,
            migrationId,
        },
    });
    keepOldReplicaUnchanged();
} else {
    blockLoadWithRecoveryOptions();
}
```

Important choices:

- The new document can start with an empty vector because it is a fresh CRDT document.
- The lineage record preserves the relationship to the old document without claiming causal continuity.
- The old document should remain available for export, rollback, or old-schema peers.
- The UI needs to switch the active document to the new `docId` after migration.

## Protocol Implications

Local-first messages should eventually include schema metadata:

```ts
type SchemaHeader = {
    schemaVersion: number;
    schemaFingerprint: string;
};
```

Add it to:

- `hello`;
- `snapshot`;
- maybe `syncRequest` and `syncResponse`.

Policy:

- If peer fingerprint matches, sync normally.
- If peer `docId` differs because migration created a new document, treat it as a different document and do not sync batches.
- If peer schema is older and migratable, prefer sending a current snapshot.
- If peer schema is newer, show an incompatible-peer status and do not apply its batches.
- Do not accept `updates` batches from a different schema fingerprint unless an explicit operation-log migration exists.

For the first implementation, schema mismatch over the network should produce a clear status and require snapshot migration/reset. It should not attempt to translate live batches.

## Compaction Implications

In-place schema migration should be treated as an irreversible compaction frontier.

After in-place migration:

- pre-migration retained batches should be deleted or marked archived;
- `compactedThrough` should be advanced to the pre-migration vector;
- peers whose vectors do not dominate that frontier need a snapshot;
- UI should say the document was migrated and old peers may need a snapshot.

This fits the compaction UX already added to local-first mode.

For "migrate into a new document", compaction is less central:

- the old document keeps its own retained batches and compaction frontier;
- the new document starts with its own retained log;
- no peer is "behind" the new document because it is newly created;
- old peers must explicitly join or migrate to the new document instead of catching up by log replay.

## Recovery UI

On schema mismatch, the local-first mode should eventually offer:

- current app schema version/fingerprint;
- persisted schema version/fingerprint;
- "Reset local replica";
- "Export old local state";
- "Upgrade this document" for in-place migrations when a migration path exists;
- "Create migrated document" for new-document migrations when a migration path exists;
- "Import migrated state" for manual recovery.

If migration succeeds, show:

- migrated-from version;
- migration timestamp;
- retained batches compacted or archived;
- new document id when migration created a new document;
- whether connected peers need snapshots.

## Testing Strategy

Start with pure tests:

- migration chain selection;
- missing migration path rejection;
- state migration output validation against current schema;
- migrated document has current schema context;
- `compactedThrough` becomes the old vector;
- retained batches before the old vector are deleted or ignored.
- new-document migration preserves the old replica unchanged;
- new-document migration stores lineage and uses the new `docId`.

Then add protocol/session tests:

- mismatched schema in `hello` records incompatible peer status;
- mismatched `updates` are rejected;
- mismatched `snapshot` is accepted only if migratable;
- current peer sends snapshot when old peer requests batches behind a migration frontier.

Finally add one browser smoke test:

1. Create `v1` persisted document.
2. Load `v2` app with migration.
3. Verify state is migrated and persisted.
4. Connect a fresh `v2` peer.
5. Verify it receives migrated snapshot.

For new-document migration, also test:

1. Create `v1` persisted document.
2. Load `v2` app and create a migrated `v2` document.
3. Verify the `v1` document is still present.
4. Verify a `v1` peer does not sync into the `v2` document.
5. Verify a fresh `v2` peer joins the new document.

## Open Questions

- Should schema version live in `AppDefinition`, or should local-first mode maintain its own app-specific migration registry?
- Should migration preserve undo/redo stacks by default, or clear them unless a command migration is provided?
- Should migrated replicas keep archived old batches for export/debugging, or delete them immediately?
- For new-document migration, what should the new `docId` be, and how should invite links expose it?
- Should the old and new documents share the same replica identity, or should document creation allocate a new actor id?
- How should the app prevent users from unknowingly continuing to edit both old and new documents?
- How should the UI explain "your old offline peer needs a snapshot" in a way that is useful for an example?
- Is `schemaFingerprint` enough for protocol compatibility, or do we also need a human-authored compatibility key?

## Near-Term Recommendation

For this example, implement this order if we choose to proceed:

1. Add schema version metadata and keep strict fingerprint rejection.
2. Add export of old local state on mismatch.
3. Add state-only migration registry.
4. Add "migrate into new document" first for major schema changes.
5. Add in-place snapshot migration only as an explicit migration mode.
6. Add protocol schema headers and reject mismatched live batches.
7. Add UI that shows lineage, migrated-from metadata, and snapshot requirements.

This keeps the first implementation understandable while leaving room for deeper CRDT metadata migrations later.
