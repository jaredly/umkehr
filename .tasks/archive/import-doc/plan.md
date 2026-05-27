# Full-document import/export plan

## Objective

Build file-based full-document import/export into `examples/react-crdt` for every architecture:

- Solo history
- Local two-replica simulator
- PeerJS
- Server
- Local-first

Export should download a JSON file. Import should upload a JSON file. Gzip is explicitly out of scope for the first implementation.

"Full document" means preserving the architecture-specific document state, not only the current materialized state. Histories, CRDT logs, local simulator outboxes, local-first retained batches, and server branch/event state should be included where they are part of that architecture's document model.

## Decisions From Research

- Archives use one shared `DocumentArchive` wrapper with a `payload` attribute. `payload` is the tagged union. Do not duplicate shared archive metadata across union arms, and do not add a separate top-level `mode` field.
- Local simulator archives include all replicas and all outboxes.
- PeerJS import is host-only.
- Server archives are local replica exports, but importing a server archive must be able to replicate the imported document contents to the backend.
- Server should support importing into an unknown document id through an explicit server protocol path, similar to `serverMigrationUpload`.
- Archives record the exporting actor, but importing does not recreate or impersonate that actor.
- Imports should hot-swap where practical. Do not rely on full page reload as the general mechanism.
- Gzip is postponed.
- Every architecture should have a `docId`, local document storage/listing, and a document picker/dropdown. This is not only a server-mode concept.
- Server documents should carry `appId` metadata on both the server and local client replica so document lists can be app-aware and offline document switching can work.

## Archive Model

Add a shared archive module under `examples/react-crdt/src/lib/documentArchive`.

Define:

```ts
type DocumentArchive = {
    kind: 'umkehr.react-crdt.document';
    archiveVersion: 1;
    exportedAt: string;
    appId: string;
    docId: string;
    schemaVersion?: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    exportedBy?: {actor: string};
    payload: DocumentPayload;
};

type DocumentPayload =
    | {
          kind: 'solo';
          history: History<unknown, unknown>;
      }
    | {
          kind: 'local-simulator';
          replicas: Record<string, CrdtLocalHistory<unknown>>;
          transportState: TransportState;
      }
    | {
          kind: 'peerjs';
          history: CrdtLocalHistory<unknown>;
      }
    | {
          kind: 'server';
          replica: PersistedServerReplica<unknown>;
      }
    | {
          kind: 'local-first';
          replica: PersistedReplica<unknown>;
          batches: PersistedBatch[];
      };
```

`docId` is required for every payload kind. In-memory modes that currently start from a single implicit document need local document state added before archive export/import lands. `schemaVersion` is required for server and local-first payloads and optional for the simpler in-memory modes unless their adapters can provide a meaningful value.

Add helpers:

- `serializeArchive(archive): string`
- `parseArchive(json): DocumentArchive`
- `assertArchiveForApp(archive, app, expectedPayloadKind)`
- `archiveFileName({appId, docId, payloadKind, exportedAt})`
- lightweight shape guards for the shared archive wrapper and `DocumentPayload` discriminants

Validation should happen in two layers:

1. Top-level archive checks in the shared module.
2. Mode-specific deep validation in each adapter, using app schema and existing persistence/protocol validators.

Do not support cross-mode imports in the first pass. If the payload kind does not match the active architecture, reject with a clear error.

## Cross-mode Document Registry And Picker

Every architecture needs the concept of multiple documents and a dropdown for switching between them. Server mode already has the beginning of this through `?doc=...`, `/documents`, local IndexedDB replicas, and `ServerControls`; the other modes need equivalent local document registries.

Add shared local document utilities under `examples/react-crdt/src/lib/documentRegistry` or fold them into `documentArchive` if the surface stays small.

Suggested shared types:

```ts
type LocalDocumentSummary = {
    docId: string;
    appId: string;
    title: string;
    payloadKind: DocumentPayload['kind'];
    schemaVersion?: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
};
```

Suggested URL helpers:

- `readActiveDocIdFromSearch(search, fallbackDocId)`
- `urlWithActiveDocId(href, docId)`

Suggested UI:

- A reusable `DocumentPicker` component with a `select` dropdown.
- It receives summaries, the active doc id, and `onSwitchDocument(docId)`.
- If the active doc was manually typed and is not in storage/server summaries, include a manual option.
- Filter normal options to the active app id and active payload kind.

Per-mode storage responsibilities:

- Solo stores `History<T>` documents keyed by `docId`.
- Local simulator stores `{replicas, transportState}` documents keyed by `docId`.
- PeerJS host stores host `CrdtLocalHistory<T>` documents keyed by `docId`. PeerJS client can join by host invite and can export, but host-only import remains.
- Server stores `PersistedServerReplica<T>` keyed by `docId` and merges local summaries with `/documents`.
- Local-first already stores `PersistedReplica<T>` keyed by `docId`; add a document list/dropdown over existing IndexedDB replicas.

Default document ids:

- Existing runtime `docId`s remain the default document id for each app.
- Creating/importing another document writes `?doc=<docId>` and hot-switches the mode.
- Imported archives keep their archive `docId` in the first pass. "Import as new document" can be added later with explicit doc id rewriting.

Tests:

- Each mode lists at least the default document.
- Switching documents hot-swaps visible state without changing app or architecture.
- Importing an archive with a new `docId` adds it to the dropdown and selects it.
- Wrong-app or wrong-payload-kind documents do not appear as normal selectable options for the current app/mode.

## Shared File UI

Create a reusable file control component, likely `DocumentArchiveControls`.

Responsibilities:

- render compact export/import icon buttons suitable for toolbars;
- call an adapter's `exportArchive()` and download a JSON blob;
- open a hidden file input for import;
- read uploaded JSON with `File.text()`;
- call `parseArchive`;
- call the adapter's `importArchive(archive)`;
- surface parse/import errors in local UI without partially replacing state;
- reset the file input after each import attempt.

Adapter shape:

```ts
type DocumentArchiveAdapter = {
    exportArchive(): Promise<DocumentArchive>;
    importArchive(archive: DocumentArchive): Promise<void>;
};
```

Initial placement:

- Solo: near the history controls/document shell.
- Local simulator: in or beside `SyncControls`.
- PeerJS: in `PeerJsControls`, enabled for host import and export.
- Server: in `ServerControls`.
- Local-first: replace clipboard/prompt buttons in `LocalFirstControls`.

Use existing visual patterns first. If adding icons, prefer lucide if already available; otherwise keep simple text buttons consistent with current controls.

## Core Validation Helpers

Add validation helpers for CRDT histories and updates so mode adapters do not duplicate fragile checks.

Suggested helpers in `documentArchive` or a sibling `validation` file:

- `validateCrdtDocumentForApp(input, app): CrdtDocument<TState>`
- `validateCrdtLocalHistoryForApp(input, app): CrdtLocalHistory<TState>`
- `validateCrdtUpdatesForApp(updates, app): CrdtUpdate[]`
- `validateHistoryForApp(input, app): History<TState, unknown>`

For CRDT histories:

- validate `history.doc.state` with `app.validateState`;
- validate `history.base.state` if present;
- validate retained updates with `createCrdtUpdateValidator(app.schema)`;
- ensure `history.doc.schema` matches current schema context where practical.

For solo history:

- validate `history.initial` and `history.current`;
- validate stored patches with `createPatchValidator(app.schema)`;
- preserve all jump/undo metadata.

For server branch imports:

- validate all update events with `createCrdtUpdateValidator(app.schema)`;
- validate merge events reference existing branches and safe event indices;
- re-materialize each branch with `materializeServerBranch` and either verify imported branch histories match or replace imported materialized histories with the recomputed histories.

## Sequential Phases

The implementation should proceed in phases. Each phase should leave the example in a working state and should include targeted tests before moving to the next phase.

### Phase 1: Shared Archive And Document Infrastructure

Goal: establish the common primitives every mode will use.

Scope:

1. Add `examples/react-crdt/src/lib/documentArchive`.
   - Define `DocumentArchive` with required `docId`.
   - Define `DocumentPayload` as the tagged union.
   - Add parser, serializer, archive filename helper, app/payload-kind assertion, and shape guards.
2. Add shared archive validation helpers.
   - `validateCrdtDocumentForApp`
   - `validateCrdtLocalHistoryForApp`
   - `validateCrdtUpdatesForApp`
   - `validateHistoryForApp`
3. Add shared document registry/picker utilities.
   - `LocalDocumentSummary`
   - `DocumentPicker`
   - `readActiveDocIdFromSearch`
   - `urlWithActiveDocId`
4. Add shared `DocumentArchiveControls`.
   - JSON download.
   - JSON upload.
   - Error display.
   - Hidden file input reset.

Completion checks:

- Archive parser rejects malformed wrapper metadata, missing `docId`, wrong `archiveVersion`, wrong app id, and wrong payload kind.
- `DocumentPicker` can render a manual active document option.
- No mode is required to use the new controls yet.

### Phase 2: Solo Documents And Solo Archive

Goal: make the simplest architecture multi-document and import/export capable.

Scope:

1. Add solo document persistence keyed by `docId`.
2. Load active solo document from `?doc=...`, falling back to the app default.
3. Add solo document picker and switch/create behavior.
4. Make `SoloApp` use stateful `historySnapshot` loaded by `docId`.
5. Persist provider history changes.
6. Add solo archive adapter and file controls.
7. Verify or add provider support for changed `initial`.

Completion checks:

- The solo picker lists, creates, and switches documents.
- Solo export downloads a JSON archive with `payload.kind === 'solo'`.
- Solo import persists `archive.docId`, selects it, and hot-swaps the visible history.
- Tests cover solo archive round-trip and malformed/wrong-app rejection.

### Phase 3: Local Simulator Documents And Archive

Goal: preserve the full two-replica simulator state across document switching and archives.

Scope:

1. Add local simulator document persistence keyed by `docId`.
2. Store all replica histories and transport state.
3. Load active simulator document from `?doc=...`.
4. Add document picker and switch/create behavior.
5. Refactor `LocalSimulatorApp` to hold per-replica histories, not one shared initial object.
6. Add `DemoSync` snapshot/replace APIs for `TransportState`.
7. Add local simulator archive adapter and file controls.

Completion checks:

- The local simulator picker switches between independent documents.
- Export includes all replicas and all outboxes.
- Import replaces all replica histories and transport state together.
- Tests cover divergent replicas with sync paused, queued outboxes, import, and resumed sync.

### Phase 4: PeerJS Host Documents And Archive

Goal: make host documents switchable/exportable/importable while keeping client import disabled.

Scope:

1. Add PeerJS host document persistence keyed by `docId`.
2. Load active host document from `?doc=...`.
3. Add host document picker and switch/create behavior.
4. Persist host provider history changes.
5. Include active `docId` in PeerJS protocol config and invite URLs.
6. Add PeerJS archive adapter and file controls.
7. Enforce host-only import.
8. On host import, persist `archive.docId`, switch to it, replace host history, and update `sync.setSnapshotDocument`.

Completion checks:

- Host picker switches documents and updates future invite/snapshot behavior.
- Host export/import round-trips CRDT history.
- Client import is disabled or rejected with a clear error.
- A fresh client joining after host import receives the imported snapshot.

### Phase 5: Server App Metadata And Local Document Listing

Goal: make server document identity app-aware and make offline/local server document switching reliable.

Scope:

1. Add `appId` to the server `documents` table and migrate existing rows.
2. Include `appId` in server `DocumentSummary`, seed documents, debug output, and `/documents`.
3. Include `appId` in client/server `hello`, migration, import-related messages, and document parsers.
4. Update `ensureDocument` to accept and verify/backfill `appId`.
5. Add `appId` to `PersistedServerReplica` and bump/normalize IndexedDB storage.
6. Add local server replica listing helpers.
7. Merge local IndexedDB summaries with remote `/documents` summaries in `ServerApp`.
8. Filter or label picker entries by active app id.

Completion checks:

- Existing server data migrates without losing documents.
- `/documents` returns `appId`.
- Client parsing rejects malformed summaries.
- Server mode can switch to local-only replicas while offline.
- Incompatible app documents do not appear as normal options for the active app.

### Phase 6: Server Local Archive Import/Export

Goal: support server-mode local replica backup/restore before backend import protocol changes.

Scope:

1. Add server persistence helpers:
   - `listServerReplicas`
   - `replaceServerReplica`
   - test-only delete helper if useful
2. Add server archive adapter and file controls.
3. Export active `PersistedServerReplica` as `payload.kind === 'server'`.
4. Validate imported server replicas.
5. Re-materialize or verify imported branch histories.
6. Persist imported replica under `archive.docId`.
7. Hot-switch active server document and refresh local/remote summary lists.

Completion checks:

- Server archive export/import works locally.
- Wrong app id, schema, malformed branches, and malformed update events are rejected.
- Imported local replica appears in the picker and hot-switches without page reload.

### Phase 7: Server Backend Import Protocol

Goal: make imported server archives replicate to the backend when the server does not yet know the document.

Scope:

1. Add server-to-client `unknownDocument` message during `hello`.
2. Add client-to-server document import message, similar to `serverMigrationUpload` but not migration-lock based.
3. Add server store `importDocument(upload, options)`.
   - Validate app id and schema metadata.
   - Validate branches and event consistency.
   - Insert or replace document transactionally.
   - Reject replacement unless explicitly requested and confirmed.
4. Client import flow:
   - write local replica;
   - switch active doc;
   - connect;
   - respond to `unknownDocument` by uploading full imported branch/event contents;
   - mark matching events recorded after server ack;
   - refresh `/documents`.
5. Keep event origins as authored; use the current actor only for the import/upload envelope.

Completion checks:

- Importing a server archive for an unknown `docId` creates the backend document.
- `/documents` includes the imported backend document.
- Existing-document replacement is rejected or requires explicit confirmation.
- Reconnecting another client can subscribe to and materialize the imported server document.

### Phase 8: Local-first Picker And File Archive

Goal: bring existing local-first clipboard import/export into the shared file/archive system.

Scope:

1. Add local-first document picker over existing `PersistedReplica` records.
2. Load active local-first doc from `?doc=...`.
3. Support creating/opening a new local-first document for the active app.
4. Replace clipboard/prompt controls with shared file controls.
5. Wrap existing `{replica, batches}` as `payload.kind === 'local-first'`.
6. Add deep update validation for imported batches.
7. Persist imported replica under `archive.docId`, select it, and hot-swap local-first refs/state.
8. Clear pending snapshot/replay preview and resync or close peers as needed.

Completion checks:

- Local-first picker lists and switches replicas.
- Export/import round-trips retained batches.
- Imported batches are marked received.
- Malformed batch updates are rejected.
- Imported state can sync to a peer.

### Phase 9: Polish And End-to-end Verification

Goal: make the feature cohesive across all architectures.

Scope:

1. Normalize toolbar placement and styling for document picker and archive controls.
2. Add concise error/status display.
3. Add confirmations for server import/upload/replace behavior.
4. Update README or task implementation notes with manual testing steps.
5. Run package-level checks for the example and server packages.

Completion checks:

- Every mode can create/switch documents.
- Every mode can export a JSON archive.
- Every mode can import a matching JSON archive.
- Wrong app and wrong payload kind are rejected consistently.
- No import path relies on full page reload unless explicitly documented as a temporary fallback.

## Solo Mode

Files:

- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- app model files if provider behavior requires adjustment

Implementation steps:

1. Add a solo document persistence module, probably IndexedDB for consistency with the other modes.
   - Store `{docId, appId, schemaFingerprintHash, history, createdAt, updatedAt}`.
   - List summaries for the document picker.
2. Read the active `docId` from `?doc=...`, falling back to `runtime.docId` or another app-level default.
3. Change `SoloApp` from immutable `initialHistory` to stateful `historySnapshot` loaded by `docId`.
4. Add a document picker and create/switch path for solo documents.
5. Save provider history changes back to the active `docId`.
6. Add an archive adapter inside `SoloDocument` or a wrapper that can read `editor.useHistory()`.
7. Export `{kind: 'solo', history}` with required archive `docId`, `appId`, schema fingerprint, and optional `exportedBy: {actor: 'solo'}`.
8. Import only `payload.kind === 'solo'`.
9. Validate the imported history.
10. Persist the imported document under `archive.docId`, add it to the picker, and hot-switch to it.
11. Verify the history provider responds to changed `initial`; if it does not, add the equivalent initial-replacement behavior to the history React provider.

Tests:

- Round-trip a solo archive and confirm `current`, `initial`, and history nodes are preserved.
- Reject wrong app/schema and malformed patches.
- Document picker lists, creates, and switches solo documents.

## Local Simulator Mode

Files:

- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/local/useLocalDemoSync.ts`
- `examples/react-crdt/src/lib/local/model.ts`
- `examples/react-crdt/src/lib/local/SyncControls.tsx`

Implementation steps:

1. Add local simulator document persistence keyed by `docId`.
   - Store `{docId, appId, schemaFingerprintHash, replicas, transportState, createdAt, updatedAt}`.
   - List summaries for the shared document picker.
2. Read and write active `docId` through `?doc=...`.
3. Hold per-replica histories in `LocalSimulatorApp`, keyed by replica id, loaded for the active document.
4. Pass each replica's history to its provider, not the same shared initial object.
5. Ensure each replica calls back on `save` so `LocalSimulatorApp` can retain the latest full history for export and persistence.
6. Extend `DemoSync` with safe snapshot/replace methods for `TransportState`:
   - `exportTransportState()`
   - `replaceTransportState(state)`
7. Add a document picker and switch path that replaces all replica histories and transport state for the selected `docId`.
8. Export:
   - all replica histories;
   - `syncEnabled`;
   - outbox updates for every replica;
   - `exportedBy` can be omitted or use a neutral value such as `{actor: 'local-simulator'}`.
9. Import only `payload.kind === 'local-simulator'`.
10. Validate every replica history and queued update.
11. Persist the imported document under `archive.docId`.
12. Replace all replica histories and transport state in one React update path so imported replicas do not briefly sync partial state.
13. Omit status/presence stores from the archive.

Tests:

- Round-trip with sync disabled, divergent replicas, and queued outbox updates.
- After import, re-enabling sync delivers queued updates.
- Document picker switches between independent local simulator documents.

## PeerJS Mode

Files:

- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsControls.tsx`
- `examples/react-crdt/src/lib/peerjs/usePeerJsSync.ts`
- `examples/react-crdt/src/lib/peerjs/protocol.ts`

Implementation steps:

1. Add PeerJS host document persistence keyed by `docId`.
   - Store `{docId, appId, schemaFingerprintHash, history, createdAt, updatedAt}`.
   - List summaries for the document picker in host mode.
2. Read and write active `docId` through `?doc=...`.
3. Store host history in `PeerJsApp` state and update it via provider `save`.
4. Include the active `docId` in PeerJS protocol config and invite URLs.
5. Add a host document picker that switches host history and updates `sync.setSnapshotDocument`.
6. Export host history as `{kind: 'peerjs', history}` with required archive `docId`.
7. Allow client export after a snapshot is installed if it is useful, but keep import host-only.
8. Add host import flow:
   - reject when role is not `host`;
   - validate archive and CRDT history;
   - persist the imported archive under `archive.docId`;
   - switch active `docId`;
   - replace host history state;
   - call `sync.setSnapshotDocument(importedHistory.doc)`.
9. Decide whether to proactively disconnect connected clients after host import. First pass can show a message that connected clients need to reconnect, but the behavior should be explicit in UI and tests.
10. Do not include PeerJS connection state, invite URLs, or queued messages in the archive.

Tests:

- Host export/import round-trip preserves CRDT history.
- Client import is rejected.
- Host import updates the snapshot used for later clients.
- Host document picker switches between PeerJS documents and updates invite URLs/snapshots.

## Server Metadata And Document Listing

Files:

- `examples/react-crdt-server/src/types.ts`
- `examples/react-crdt-server/src/store.ts`
- `examples/react-crdt-server/src/index.ts`
- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt/src/lib/server/documents.ts`
- `examples/react-crdt/src/lib/server/persistence.ts`
- `examples/react-crdt/src/lib/server/ServerApp.tsx`

Implementation steps:

1. Add `appId` to server document storage.
   - Add `appId text not null default ''` to `documents`.
   - Migrate existing rows.
   - Include `appId` in `DocumentSummary`, `SeedDocument`, and debug output.
2. Update `ensureDocument` to accept `appId` and verify it when an existing document has an app id.
   - Existing rows with empty app id can be backfilled on first matching hello.
   - A non-empty mismatched app id should produce a clear incompatible-document error.
3. Include `appId` in client/server `hello`, migration, import, document summaries, and seed payloads.
4. Add `appId` to `PersistedServerReplica`.
   - Bump server client IndexedDB storage version.
   - Normalize older replicas by filling `appId` from active `app.id`.
5. Add client helpers to list local server replicas from IndexedDB, not only server `/documents`.
   - `listServerReplicas()` or `listServerReplicaSummaries()`.
   - Include local-only docs in the server document picker so offline switching works.
6. Merge remote `/documents` summaries and local IndexedDB summaries in `ServerApp`.
   - Prefer server metadata when both exist.
   - Preserve manual active doc behavior.
   - Filter or label by app id. Since app id now exists, the active app should avoid showing incompatible documents as normal selectable choices.

Tests:

- Store migration adds app id and preserves existing documents.
- `/documents` returns app id.
- Client document parser rejects invalid app id shape.
- Offline local replicas appear in the document picker.

## Server Import/Export

Files:

- `examples/react-crdt/src/lib/server/persistence.ts`
- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt/src/lib/server/ServerControls.tsx`
- `examples/react-crdt-server/src/protocol.ts`
- `examples/react-crdt-server/src/store.ts`
- `examples/react-crdt-server/src/index.ts`

Implementation steps:

1. Add persistence helpers:
   - `listServerReplicas()`
   - `replaceServerReplica(replica)`
   - possibly `deleteServerReplica(docId)` for test setup only.
2. Export the active local `PersistedServerReplica` as `{kind: 'server', replica}`.
   - Include `appId`, schema metadata, doc id, and `exportedBy: {actor: identity.actor}`.
3. Add a server import protocol path for unknown or replacement documents.
   - Server to client: `unknownDocument` when `hello` references a document id that does not exist and the client should decide whether to create/import.
   - Client to server: `serverDocumentImport` or similar, containing:
     - `appId`
     - `docId`
     - schema version/fingerprint/hash
     - branches
     - events
     - importedAt
     - importedBy actor/user id
   - Shape should be close to `serverMigrationUpload`, but it should not require an active migration lock.
4. Add server store method `importDocument(upload, options)`.
   - Validate branch/event consistency.
   - Create or replace the document in one transaction.
   - Set `appId`, schema metadata, branches, events, and document metadata.
   - Preserve server-assigned event indices from the archive only if they are internally consistent.
   - Reject import over an existing document unless the protocol explicitly says replace and the user confirmed.
5. On client import:
   - validate and normalize the local replica;
   - write it to IndexedDB;
   - hot-switch to the imported doc id;
   - connect to the server;
   - if the server reports unknown document, upload the full branch/event contents through the new import message;
   - after server ack/import complete, mark matching imported events as recorded and refresh branches/documents.
6. Handle importing a server archive into a different `docId`.
   - First pass can import only the archive's `docId`.
   - If "import as new document" is added, rewrite doc ids throughout replica, branch list, branches, and events before validation/upload.
7. Ensure imported archives record but do not recreate the exporting actor.
   - Event origins remain as authored in the event log.
   - The current importing actor is used for the import/upload message and any future local updates.
8. Add UI confirmation if import will create/replace a server document or upload to backend.

Tests:

- Export/import active server replica locally.
- Unknown document handshake triggers import upload and creates the backend document.
- Import rejects wrong app id/schema.
- Existing-document replacement requires explicit confirmation or is rejected.
- Imported branch events materialize the same branch state after server round-trip.

## Local-first Mode

Files:

- `examples/react-crdt/src/lib/local-first/LocalFirstControls.tsx`
- `examples/react-crdt/src/lib/local-first/useLocalFirstSync.ts`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/local-first/protocol.ts`

Implementation steps:

1. Add a local-first document picker over existing IndexedDB replicas.
   - Use current `PersistedReplica.docId` records as the source of local documents.
   - Read and write active `docId` through `?doc=...`.
   - Support creating/opening a new local-first document for the active app.
2. Replace clipboard/prompt export/import controls with the shared file controls.
3. Wrap existing `{replica, batches}` in `{kind: 'local-first', replica, batches}` with required archive `docId`.
4. Keep durable `ReplicaIdentity` out of the archive.
5. Add deep update validation to `importReplicaState` by reusing or extracting local-first batch validation logic.
6. On import, persist the imported replica under `archive.docId`, add it to the picker, and switch to it.
7. Hot-swap after import instead of reloading:
   - update `historyRef`, vector, compacted frontier, source, counts, and provider state;
   - clear pending snapshot/replay preview;
   - close or resync peers if needed.
8. If hot-swap is too risky, keep reload only as a temporary fallback and document it in the implementation log. The target behavior remains hot-swap.

Tests:

- Round-trip `{replica, batches}` through the archive wrapper.
- Imported retained batches are marked received.
- Imported state syncs to a peer after import.
- Malformed update inside a batch is rejected.
- Document picker lists and switches local-first replicas.

## Server/Local Document Switch Hot-swap

This task crosses multiple modes. The target is to avoid page reloads:

- Solo: set provider initial history state.
- Local simulator: set per-replica provider histories and transport state.
- PeerJS host: set provider history and snapshot document.
- Server: use existing `activeDocId` state and keyed `ServerReadyApp`, but import should also update local replica lists and switch active doc.
- Local-first: replace persisted state and in-memory refs, then replace provider history.

Where the current provider already responds to changed `initial`, use that. Where it does not, update provider behavior or remount the provider with a key inside the mode, not the full page.

## UI And Styling

Add import/export controls without making the toolbars noisy:

- Use a small grouped control with Export and Import.
- Disable import when a mode cannot import safely, such as PeerJS client.
- Disable or warn when server import would upload/replace backend data.
- Show concise errors near the control.
- Avoid explanatory in-app text beyond labels/tooltips and error messages.

Update CSS in `examples/react-crdt/src/style.css` for:

- archive control group;
- hidden file input;
- error/status message;
- any server import confirmation state.

## Tests And Verification

Run targeted tests first:

```sh
pnpm test -- src/lib/server/documents.test.ts
pnpm test -- src/lib/local-first/local-first.test.ts
pnpm test -- src/lib/server/protocol.test.ts src/lib/server/materialize.test.ts
```

Add or update tests for:

- shared archive parser/serializer;
- solo archive validation;
- local simulator archive round-trip;
- PeerJS host-only import guard;
- local-first import deep validation;
- server protocol parse/validation for app id, unknown document, and import upload;
- server store import transaction and app id migration.

Then run package-level checks for the example and server packages. Use the existing scripts in each `package.json`; if a script is unavailable, document the gap in the implementation log.

Manual verification:

1. Start the React CRDT example.
2. For each mode, create edits, export, reset/switch away, import, and verify visible state and history/log behavior.
3. Local simulator: pause sync, diverge replicas, export/import, resume sync.
4. PeerJS: export/import on host, connect a fresh client, verify snapshot.
5. Server: export a local replica, import into a missing doc id, verify backend creates the document and `/documents` includes it.
6. Local-first: export/import with retained batches and sync to a peer.

## Phase Order Summary

1. Shared archive, validation, registry, picker, and file UI infrastructure.
2. Solo multi-document support and solo archive import/export.
3. Local simulator multi-document support and simulator archive import/export.
4. PeerJS host multi-document support and host archive import/export.
5. Server app id metadata and local/remote document listing.
6. Server local archive import/export and hot-switching.
7. Server backend unknown-document import protocol.
8. Local-first document picker and file archive import/export.
9. UI polish, documentation, and end-to-end verification.

This order gets useful UI into simpler modes first while isolating the server protocol work, which has the largest blast radius.
