# Document Modal Research

## Task

Replace the top-bar document selector dropdown with a fuller document modal. The modal should make clear which entries are persisted documents and which are unrealized seed fixtures, should expose server-mode source state (client-only, server-only, both), and should support deleting locally persisted documents.

## Current UI Shape

- The document selector is injected through `TopBarContext` and rendered by `DemoTopBar`.
- `examples/react-crdt/src/lib/documentArchive/index.tsx` owns the generic `DocumentPicker`.
- Server mode has its own `ServerDocumentPicker` inside `examples/react-crdt/src/lib/server/ServerApp.tsx`.
- Both implementations are plain `<select>` controls, so they cannot show rich per-document metadata, grouped sections, destructive actions, or explanations without overloading option labels.
- Import/export controls are separate top-bar controls and can remain separate, though the modal may eventually be a better home for them.

## Current Document Sources

### Solo

- `SoloApp` reads IndexedDB summaries via `listSoloDocumentSummaries()`.
- It displays `mergeDocumentSummariesWithSeeds(documents, app.id, 'solo')`.
- `loadOrCreateSoloDocument(...)` creates a persisted document immediately when the active `docId` matches a seed fixture.
- Persistence module has `loadSoloDocument`, `saveSoloDocument`, and `listSoloDocumentSummaries`; it does not have delete.

### Local Simulator

- `LocalSimulatorApp` follows the same pattern as solo, using `listLocalSimulatorDocumentSummaries()` and `mergeDocumentSummariesWithSeeds(...)`.
- `loadOrCreateLocalSimulatorDocument(...)` realizes a seed by creating a persisted multi-replica document when selected.
- Persistence module has load/save/list only; no delete.

### PeerJS

- Only host mode shows document controls. Clients show a status message because they follow the host document.
- Host mode uses `listPeerJsDocumentSummaries()` plus `mergeDocumentSummariesWithSeeds(...)`.
- `loadOrCreatePeerJsDocument(...)` realizes seeds when selected.
- Persistence module has load/save/list only; no delete.

### Local-First

- `LocalFirstReadyApp` lists persisted replicas via `listReplicas()` and maps them to `LocalDocumentSummary`.
- It also merges branch-free seeds into the list.
- `loadInitialState(...)` can load, create, migrate, or reject a replica. Selecting a seed currently causes the app to load/reload against that doc id, then persistence realizes it.
- `local-first/persistence.ts` already has `clearReplica(docId)`, deleting the replica plus retained/received batches.

### Server

- `ServerApp` fetches remote documents from `GET /documents` and local client replicas from IndexedDB via `listServerReplicas()`.
- `mergeServerDocuments(remoteDocuments, localDocuments)` keys by `docId`, starts with local rows, then overwrites with remote rows.
- After that, server seed summaries are merged into the same list and `documentsForActiveDoc(...)` adds a manual active row if needed.
- This means the UI cannot distinguish:
  - client-only local replica,
  - server-only remote document,
  - document present in both places,
  - unrealized seed fixture,
  - manually typed/new document id.
- The synthetic active-row behavior is a workaround for the dropdown and should be removed. If `activeDocId` does not correspond to a real document or unrealized seed, it should not appear in the document listing.
- `server/persistence.ts` has load/save/list and user identity clearing, but no local replica delete.
- The Bun server exposes `GET /documents`; there is no HTTP delete endpoint, and the task only asks for deleting local persistence.
- Server store has internal deletion during import/migration flows, but not a public document delete route.

## Seed Model

- Seed summaries come from `branchFreeSeedSummariesForApp(...)` in `examples/react-crdt/src/lib/seed/documents.ts`.
- `mergeDocumentSummariesWithSeeds(...)` filters out seed ids that already exist in the persisted document list, then appends remaining seeds.
- The current "not realized" concept is implicit: if a seed doc id is absent from persisted summaries, it is listed as though it were a document.
- Selecting a seed generally realizes it by flowing through each mode's load-or-create path.
- Server mode also has `ServerClientSeedControls`, which applies a client-side server replica scenario (`cached`, `pending-uploads`, `stale-schema`) to the currently selected seed doc. This is separate from the picker and may become confusing once seeds have a first-class modal action.

## Deletion Surface

Deletion needed for local persistence:

- Add `deleteSoloDocument(docId)` in `solo/persistence.ts`.
- Add `deleteLocalSimulatorDocument(docId)` in `local/persistence.ts`.
- Add `deletePeerJsDocument(docId)` in `peerjs/persistence.ts`.
- Reuse or wrap `clearReplica(docId)` in `local-first/persistence.ts`.
- Add `deleteServerReplica(docId)` in `server/persistence.ts`.

Important behavior:

- Deleting local-first must keep existing `clearReplica` semantics so batches and received-batch markers are removed too.
- Deleting server local persistence should delete only the browser replica, not the server document.
- Deleting the active document needs a deterministic next selection. Likely choose another persisted doc for the current app/mode, otherwise the mode default doc id.
- If deleting an active server doc that exists on the server too, switching/reloading may recreate a local replica from the remote sync path. That is probably correct if the row is "server + client"; the action label should say "Delete local copy".

## Recommended Implementation Direction

Create a reusable modal component in `documentArchive`, then adapt each architecture to pass a richer model instead of flattening documents and seeds into select options.

Suggested model:

```ts
type DocumentModalItem = {
    docId: string;
    title: string;
    appId: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt?: string;
    updatedAt?: string;
    payloadKind: DocumentPayloadKind;
    source: 'local' | 'server' | 'local-and-server';
    metrics?: {sizeLabel?: string; branchCount?: number; eventCount?: number};
    canDeleteLocal: boolean;
};

type SeedModalItem = {
    docId: string;
    title: string;
    appId: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion?: number;
    schemaFingerprintHash?: string;
    sizeLabel: string;
    createLabel?: string;
};
```

Modal layout:

- Top-bar trigger button: current document title/id plus compact source badge.
- Section 1: "Documents" with rows for persisted/real documents.
- Section 2: "Seed fixtures" with unrealized seeds and a "Create" action.
- Row badges: local, server, local + server, current, schema version, event/branch counts where available.
- Local delete action per row, with confirmation for the active document and for rows with unsynced/pending local state if detectable.
- Do not include a synthetic active/manual row in the list. If manual document-id creation remains supported, make it an explicit action or input, not a fake list item.

Schema metadata requirement:

- `DocumentModalItem` should always have `schemaVersion` and `schemaFingerprintHash`.
- Server and local-first already have this metadata on persisted rows.
- Solo, local simulator, and PeerJS currently list `schemaFingerprintHash` but not `schemaVersion`; their persistence records/summaries should grow `schemaVersion`, or the modal adapter must fill it from the current app schema version while preserving persisted `schemaFingerprintHash`.
- Synthetic helpers such as `documentsForActiveDocument(...)` and `documentsForActiveDoc(...)` should be removed from the modal path because they create rows without real document metadata.

For non-server modes, source can be simpler: persisted rows are `local`; unrealized seeds are `seed`.

For server mode, keep local and remote summaries separate long enough to classify rows:

```ts
const localById = new Map(localDocuments.map((doc) => [doc.docId, doc]));
const remoteById = new Map(remoteDocuments.map((doc) => [doc.docId, doc]));
const ids = new Set([...localById.keys(), ...remoteById.keys()]);
```

Then build one row per id with source:

- `local-and-server` when both maps have the id.
- `local` when only local exists.
- `server` when only remote exists.

Filter seed rows against the union of local and remote ids so seeds only appear when not realized anywhere relevant.

## Testing Notes

Useful unit tests:

- Seed filtering keeps unrealized seeds separate and hides seeds once a persisted/remote doc with the same id exists.
- Server source classification handles client-only, server-only, and both.
- Local delete helpers remove the expected IndexedDB records.
- Active deletion selects/reloads a valid fallback.

Useful browser/E2E checks:

- Open the modal in each architecture and verify current document, persisted docs, and seeds are visibly distinct.
- Server mode with a seeded server DB and a seeded local client replica shows correct source badges.
- Delete local server replica leaves the remote document row visible as server-only.
- Delete local-first replica removes batches and the row disappears.

## Open Questions

- Should "Create" for a seed immediately switch to it and realize it, or create it in the background while leaving the current document open?
  - create & add it to the list, without closing the modal. The user can then select it if they want
- In server mode, should seed creation mean local client replica only, server import/upload, or both? Current `ServerClientSeedControls` only creates client-side seeded state.
  - only create client-side. we might have a separate UI for managing server state, but that can come later
- Should the old `ServerClientSeedControls` remain in the top bar, move into the seed row, or be removed once seed rows have create actions?
  - I assume it will be redundant, so let's remove it
- Should deleting an active local document prompt before choosing a fallback, or is a simple confirm enough for this example app?
  - simple confirm
- Should local delete be available for schema-incompatible/migratable documents before they can load?
  - definitely
- Should the modal include manual "New document id" creation, or should arbitrary `?doc=` URLs remain the only way to create custom ids?
  - Sure let's have a 'new document' form where you give a title and the id is a uuid generated for you
- Should server remote deletion be intentionally out of scope and hidden, or should the UI mention that only local browser persistence is deletable?
  - it should be clear from the UI that only local dbs are deletable
- Do we want one generic modal implementation shared by all modes, or a server-specialized modal plus a simpler local modal first?
  - use your judgement
