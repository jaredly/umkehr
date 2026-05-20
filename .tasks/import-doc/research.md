# Full-document import/export research

## Goal

Add first-class full-document import/export to `examples/react-crdt` for every runtime architecture. The user-facing behavior should be file based:

- export downloads a JSON blob for the active document;
- import uploads a JSON blob and installs it into the active mode;
- gzip or another compressed variant can be added as an optional enhancement.

This is example-level functionality, not a core `umkehr` API requirement yet. The example has enough mode-specific persistence and protocol state that the safest initial implementation is a shared package format plus per-mode adapters.

## Current architecture

### App registry and runtimes

`examples/react-crdt/src/App.tsx` selects an app and a mode from the URL hash. The registered apps are `todos` and `whiteboard` in `src/lib/appRegistry.ts`.

Each app has:

- `AppDefinition<TState>`: `id`, `title`, `tagKey`, JSON schema, state validator, initial state, optional initial timestamp, and `renderPanel`.
- `CrdtRuntime<TState>`: `docId`, `Provider`, and `useEditorContext`.
- `HistoryRuntime<TState>` for solo/non-CRDT history mode.

The shared helpers in `src/lib/crdtApp.ts` create initial documents:

- `createInitialHistory(app)` for solo history.
- `createInitialCrdtHistory(app)` for CRDT modes.

This means import/export should know both `app.id` and active mode, and should validate that an uploaded blob belongs to the selected app/schema before replacing local state.

### React CRDT provider

`src/react-crdt/react-crdt.tsx` owns in-memory `CrdtLocalHistory<T>` inside a provider. The public editor context exposes:

- `latest()`
- `previewHistory(history | null)`
- `useLocalHistory()`
- local dispatch/undo/redo methods

The provider accepts `initial`, `transport`, optional `save(history)`, and optional `statuses`. When `initial` changes identity, the provider replaces its internal history and notifies all subscribers. This is the main hook for install-after-import in most CRDT modes: parent mode state can change `initial`, or the mode can reload after writing durable storage.

`SyncedTransport` only covers durable CRDT update flow:

```ts
type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};
```

Importing a full document should generally not be implemented by publishing all imported updates through `transport.publish`, because each mode has different persistence/ack/snapshot semantics. It should replace the mode's local document state, then let that mode decide what, if anything, must be announced to peers/server.

## Existing import/export-like code

Local-first already has clipboard import/export:

- `LocalFirstSync.exportLocalState(): Promise<string>`
- `LocalFirstSync.importLocalState(json): Promise<void>`
- `LocalFirstControls` calls these from "Export JSON" and "Import JSON" buttons.

The implementation lives in `src/lib/local-first/persistence.ts`:

- `exportReplicaState(docId)` serializes `{replica, batches}`.
- `importReplicaState(...)` parses JSON, checks `docId`, storage/protocol versions, schema fingerprint/hash/version, validates retained batch `docId`s, replaces the persisted replica, appends batches, marks them received, then reloads the page.

This is a good starting point, but it is not yet the requested UX:

- it uses clipboard/prompt rather than file download/upload;
- it only covers local-first;
- it is tightly coupled to local-first storage, not a cross-mode document archive format.

Server mode has a related but separate migration dump/upload protocol in `src/lib/server/protocol.ts` and `useServerSync.ts`, but that is for server-side schema migration, not user-driven import/export.

## Mode-by-mode details

### Solo history mode

Files:

- `src/lib/solo/SoloApp.tsx`
- app-specific `HistoryRuntime` providers in `apps/todos/model.ts` and `apps/whiteboard/model.ts`

Solo mode uses non-CRDT `History<T, An>` and no durable persistence. `SoloApp` creates a single `initialHistory` with `useState` and passes it to the history provider.

Export boundary:

- The full solo document should be `History<T, An>`, not just `latest()` state, if "full-document" includes undo/jump history.
- A minimal state-only export would be simpler but would lose the history view. That would be surprising in the solo architecture.

Import boundary:

- Need a way to replace `initialHistory` from a parent state setter. Today `SoloApp` keeps only the initial value and has no import hook.
- The history provider likely already reacts to `initial` identity changes similarly to the CRDT provider, but implementation should verify this before relying on it.

Validation:

- Validate `history.current` and probably `history.initial` with `app.validateState`.
- If keeping full history, validate patches with `createPatchValidator(app.schema)` or use existing app persistence patterns from `examples/react/src/persistence.ts` / `apps/todos/persistence.ts`.

### Local simulator mode

Files:

- `src/lib/local/LocalSimulatorApp.tsx`
- `src/lib/local/useLocalDemoSync.ts`
- `src/lib/local/model.ts`

Local simulator creates two side-by-side CRDT replicas from the same initial `CrdtLocalHistory`. It uses in-memory demo transports, optional outboxes, and status stores.

Export boundary options:

- Active/all replicas: the UI shows two replicas. "Full document" could mean export both replica histories and queued outboxes, or only one selected replica.
- Since the architecture is explicitly a two-replica sync simulator, the most complete export is a mode package containing:
  - `replicas: Record<replicaId, CrdtLocalHistory<TState>>`
  - transport state: `syncEnabled` and `outbox`
  - possibly presence/status state can be omitted because it is ephemeral.

Import boundary:

- `LocalSimulatorApp` currently initializes both providers from a single `initialHistory`; there is no state for per-replica replacement.
- To preserve diverged replicas, it needs per-replica `initial` state held in `LocalSimulatorApp` and a way to replace each provider.
- If a state-only import is acceptable, both replicas could be reset to the same imported document and outboxes cleared. That is easier but less "full architecture" faithful.

Validation:

- Validate each imported `CrdtLocalHistory.doc` against the app schema and schema fingerprint.
- Validate queued outbox updates with `createCrdtUpdateValidator(app.schema)` if exporting outboxes.

### PeerJS mode

Files:

- `src/lib/peerjs/PeerJsApp.tsx`
- `src/lib/peerjs/usePeerJsSync.ts`
- `src/lib/peerjs/protocol.ts`

PeerJS mode is asymmetric:

- host starts with a local CRDT history and sends snapshots;
- client waits for a host `CrdtDocument<TState>` snapshot, wraps it in `createCrdtLocalHistory(snapshot)`, then receives durable updates.

Export boundary:

- Host can export its full `CrdtLocalHistory<TState>` from `editor.useLocalHistory()`.
- Client can also export its current local history once it has a snapshot/provider.
- Peer connection state, invite URLs, and queued transport messages are probably not document data and should not be part of full-document export.

Import boundary:

- Host import should replace host history and call `sync.setSnapshotDocument(imported.doc)` so future clients receive the new snapshot.
- Existing connected clients will not automatically reset from a host snapshot today. The protocol only sends snapshot on hello/open and then streams updates. Import semantics need a decision:
  - disconnect/reconnect clients after host import;
  - add an explicit `snapshot`/`replaceDocument` path for connected clients;
  - accept that import is local-only until peers reconnect.
- Client import is more ambiguous. If a client imports a document and then publishes edits, the host still has its own document. The safest UX may restrict import to host role, or warn that client import is local/reset-only.

Validation:

- Reuse `validatePeerSnapshot` for `CrdtDocument` validation and add/update validation for full histories.
- Include `docId`, schema version/fingerprint/hash, and app id in the archive so PeerJS rejects mismatched uploads before replacing state.

### Server mode

Files:

- `src/lib/server/ServerApp.tsx`
- `src/lib/server/useServerSync.ts`
- `src/lib/server/persistence.ts`
- `src/lib/server/types.ts`
- `examples/react-crdt-server/src/*`

Server mode persists a client replica in IndexedDB:

```ts
type PersistedServerReplica<TState> = {
    docId: string;
    storageVersion: 3;
    protocolVersion: 3;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    activeBranchId: string;
    branches: Record<string, PersistedServerBranch<TState>>;
    branchList: ServerBranch[];
    updatedAt: string;
};
```

Each branch stores a materialized `CrdtLocalHistory`, branch events, last seen event index, undo checkpoint, and mirror status. The server is authoritative for event indices and branch metadata once connected.

Export boundary options:

- Local client replica export: serialize `PersistedServerReplica<TState>`. This captures local branches, branch histories, pending local events, recorded events already seen by this browser, and the active branch.
- Server-authoritative export: add server HTTP/WebSocket API to dump all branches/events for a document. This captures remote branches/events that the browser has not mirrored locally.

For an example-local first pass, local client replica export is much cheaper and matches existing IndexedDB state. It is not a complete server document if this browser has not subscribed to every branch or has stale local state.

Import boundary options:

- Local-only import: write the imported `PersistedServerReplica` into IndexedDB via a new `replaceServerReplica` helper, reload/reinitialize, and let pending imported events flush to the server if they are unrecorded.
- Server overwrite/import: requires server protocol/API changes, conflict/authorization decisions, event index remapping, and branch replacement semantics. This is far larger and risky.

Recommended first pass for server mode:

- Support local replica archive import/export.
- Label/research docs should be clear that it is a browser replica backup, not a server-wide authoritative dump.
- On import while connected, set manual offline or close socket, install storage, then reload. This avoids mixing old refs in `useServerSync` with newly installed branch/event objects.

Validation:

- Check `storageVersion`, `protocolVersion`, `docId`, `schemaVersion`, `schemaFingerprintHash`, and full `schemaFingerprint` fallback.
- Validate every `ServerBranchEvent.update` with `createCrdtUpdateValidator(app.schema)`.
- Re-materialize branches with `materializeServerBranch` after import and compare against imported branch histories, or replace imported histories with re-materialized histories to avoid trusting stale/corrupt materialized documents.

Open server-specific issue:

- Importing recorded events into a different server/document can collide with server event indices and ack state. A local backup restore into the same `docId` is straightforward; importing as a new server document needs a new `docId` and probably all events marked unrecorded or uploaded through a dedicated server import endpoint.

### Local-first mode

Files:

- `src/lib/local-first/LocalFirstApp.tsx`
- `src/lib/local-first/useLocalFirstSync.ts`
- `src/lib/local-first/persistence.ts`
- `src/lib/local-first/types.ts`

Local-first persists:

- one `PersistedReplica<TState>`;
- retained `PersistedBatch[]`;
- received-batch markers, derived during import;
- a separate durable `ReplicaIdentity`.

The existing archive is `{replica, batches}`. This is close to the desired "full document" for local-first because batches are the retained log needed to sync with peers after import.

Export boundary:

- Keep `{replica, batches}` as the local-first payload.
- Do not include `identity` by default unless the product decision is "move this replica identity to another browser". Duplicating a replica id across browsers can confuse vector-clock semantics if both copies later sync.

Import boundary:

- Existing `importReplicaState` replaces the persisted replica and retained batches, marks each imported batch as received, then reloads.
- This is acceptable as the local-first install path.
- File upload/download should wrap these functions.

Validation:

- Existing checks cover `docId`, storage/protocol version, schema fingerprint/hash/version, batch list shape, and batch `docId`.
- It currently does not deeply validate every imported batch update in `importReplicaState`; protocol parsing validates batches elsewhere. Import should add equivalent `createCrdtUpdateValidator` validation or reuse `validateBatch` logic if made exportable.

## Recommended package format

Use a top-level discriminated archive, versioned independently from per-mode storage:

```ts
type ReactCrdtDocumentArchive<TPayload> = {
    kind: 'umkehr.react-crdt.document';
    archiveVersion: 1;
    exportedAt: string;
    appId: string;
    mode: 'solo' | 'local' | 'peerjs' | 'server' | 'local-first';
    docId?: string;
    schemaVersion?: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    payload: TPayload;
};
```

Mode payloads can initially mirror each mode's natural persistence boundary:

- `solo`: `{history}`
- `local`: `{replicas, transportState}`
- `peerjs`: `{history}`
- `server`: `{replica}`
- `local-first`: `{replica, batches}`

This keeps import/export adapters small and avoids forcing unlike modes into one lowest-common-denominator state-only shape.

For cross-mode imports, start strict: archive mode must match current mode. Cross-mode conversion can be added later, probably from any CRDT mode's `history.doc` into a fresh `CrdtLocalHistory`, but it will necessarily discard mode-specific logs, branches, vectors, outboxes, and server ack state.

## UI architecture

A shared `DocumentArchiveControls` component could live under `src/lib/import-export` or `src/lib/documentArchive` and be rendered by each mode's controls/shell.

Suggested props:

```ts
type DocumentArchiveAdapter = {
    mode: Mode;
    exportArchive(): Promise<ReactCrdtDocumentArchive<unknown>>;
    importArchive(archive: ReactCrdtDocumentArchive<unknown>): Promise<void>;
};
```

The component should:

- create a `Blob` from JSON;
- download via `URL.createObjectURL` and an `<a download>`;
- use a hidden `<input type="file" accept=".json,application/json,.gz,application/gzip">`;
- read text with `file.text()` for JSON;
- optionally decompress gzip before parsing;
- show import errors without partially replacing state.

Each mode owns the adapter because each mode knows how to snapshot and install its state.

## Compression option

Browser-native `CompressionStream('gzip')` and `DecompressionStream('gzip')` are the lowest-dependency option for gzip support in modern browsers. A pragmatic implementation can:

- always export `.json` first;
- add "Export gzip" only when `globalThis.CompressionStream` exists;
- accept `.json.gz` only when `DecompressionStream` exists;
- fall back to plain JSON with a clear error if gzip is unsupported.

No project dependency currently handles gzip, and adding one just for an example may not be worth it unless browser support is a concern.

## Testing strategy

Unit tests should cover archive validation and adapters without requiring browser downloads:

- parse rejects wrong `kind`, unsupported `archiveVersion`, wrong `appId`, wrong `docId`, and schema mismatch;
- local-first import/export round-trips existing `{replica, batches}`;
- server import validation rejects malformed events and re-materializes imported branches;
- local simulator round-trip preserves divergent replicas and queued outboxes if that is the chosen payload;
- solo round-trip preserves history current state and undo/jump metadata.

End-to-end/manual checks should cover:

- export downloads a file in every mode;
- importing the downloaded file restores the visible document after reset/reload;
- importing the wrong app/mode shows an error and leaves current state intact;
- local-first imported retained batches still sync to a peer;
- server imported local pending events do not double-apply when reconnecting.

## Open questions

- Does "full-document" require mode-specific history/logs/branches/vectors, or is current materialized state enough? The architecture strongly suggests mode-specific full exports, but the UX copy should make that explicit.
- Should local simulator export both replicas and outboxes, or only a selected/current replica?
- Should PeerJS import be host-only? If client import is allowed, what should happen when the host has a different document?
- In server mode, is local browser replica backup sufficient, or is the desired feature an authoritative server document dump/restore API?
- Should server import into a different `docId` be supported? If yes, recorded event indices and branch metadata need remapping or a server import endpoint.
- Should archives include durable identity (`ReplicaIdentity` or server user/session)? Default should probably be no, to avoid duplicated actors, but backup/restore semantics may argue for an explicit advanced option.
- Should imports reload the page in every durable mode for consistency, or should modes hot-swap provider state where possible?
- Should gzip be exposed as a separate button, automatic based on file extension, or postponed until JSON import/export is complete?
