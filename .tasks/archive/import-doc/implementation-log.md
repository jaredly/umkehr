# Import/export implementation log

## 2026-05-25

Started implementation across `plan-1.md` through `plan-9.md`.

### Phase 1

- Added `examples/react-crdt/src/lib/documentArchive/index.tsx`.
  - Defines `DocumentArchive` with required `docId`.
  - Defines tagged `DocumentPayload` union.
  - Adds JSON parse/serialize, archive filename helper, app/payload assertions, document picker helpers, and file import/export controls.
  - Adds shared history/CRDT validation helpers.

### Phase 2

- Added solo document persistence in `examples/react-crdt/src/lib/solo/persistence.ts`.
- Updated `SoloApp` to:
  - load/save histories by `docId`;
  - read/write `?doc=`;
  - render a document picker;
  - export/import `payload.kind === "solo"` archives;
  - hot-swap imported history.
- Updated the core history React provider so changed `initial` clears preview state and notifies history subscribers.

### Phase 3

- Added local simulator document persistence in `examples/react-crdt/src/lib/local/persistence.ts`.
- Extended `DemoSync` with `exportTransportState()` and `replaceTransportState()`.
- Updated `LocalSimulatorApp` to:
  - load/save simulator documents by `docId`;
  - persist all replica histories plus transport outboxes;
  - render a document picker;
  - export/import `payload.kind === "local-simulator"` archives;
  - replace all replica histories and transport state together.

### Phase 4

- Added PeerJS host document persistence in `examples/react-crdt/src/lib/peerjs/persistence.ts`.
- Updated `PeerJsApp` and `PeerJsControls` to:
  - load/save host documents by `docId`;
  - include `docId` in invite URLs and protocol config;
  - render a host document picker;
  - export/import `payload.kind === "peerjs"` archives on the host only;
  - update the host snapshot after document switch/import.

### Phase 5

- Added server document `appId` metadata across client and server types.
- Updated server SQLite schema migration and document summaries to include `appId`.
- Updated server `ensureDocument` to backfill or verify app id.
- Added `appId` to client/server hello and update messages.
- Added client local server replica listing and merged it with remote `/documents` summaries.
- Bumped client `PersistedServerReplica.storageVersion` to `4` and normalized older replicas.

### Phase 6

- Added server client persistence helpers for listing and replacing replicas.
- Extended `ServerSync` with `exportReplica()` and `replaceReplica()`.
- Added server-mode archive controls that export/import `payload.kind === "server"` local replicas.
- Server local imports validate app/schema and CRDT update events before replacing the active replica.

### Phase 7

- Added server-side `serverDocumentImport` protocol and store import transaction.
- Added `unknownDocument` protocol shape and client handling that uploads the current local replica when the server requests a document import.
- Server import preserves authored event origins and uses the current actor only for the import envelope.

### Phase 8

- Added a local-first document picker over existing `PersistedReplica` records.
- Replaced local-first clipboard/prompt JSON controls with shared file archive controls.
- Wrapped local-first `{replica, batches}` state as `payload.kind === "local-first"` archives.
- Current local-first import still uses the existing `importLocalState` reload path as a fallback.

### Phase 9

- Added shared toolbar/control CSS for document picker and archive controls.
- Updated tests/fixtures for server `appId` metadata.

## Verification

- `npm run typecheck:examples`: passed.
- `bun run typecheck` in `examples/react-crdt-server`: passed.
- `bun run test` in `examples/react-crdt-server`: passed.
- `npm test`: passed.

## Notes

- Local-first document switching/import still falls back to the existing reload path after updating `?doc=` or importing state.
- Manual browser verification is still outstanding; validation so far is typecheck and automated tests.
