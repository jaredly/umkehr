# Document Modal Plan

## Goals

- Replace the document `<select>` controls with a full document modal.
- Show real documents separately from unrealized seed fixtures.
- Make document source clear:
  - local browser persistence,
  - server,
  - local + server.
- Require `schemaVersion` and `schemaFingerprintHash` for every real document row.
- Remove synthetic active-document rows from document listings.
- Bring import/export into the modal.
- Support local persistence deletion for every architecture, including incompatible or migratable local documents.
- Add explicit new-document creation with a user-provided title and generated UUID doc id.

## Product Decisions

- Seed "Create" creates/persists the seed in the background, keeps the modal open, and adds the document to the real document list. The user can then select it.
- In server mode, seed creation creates only a local client replica. Server-side document management can be separate later.
- Remove `ServerClientSeedControls`; seed rows replace that top-bar workflow.
- Local deletion uses a simple confirmation.
- Deletion must be available even when a local document cannot currently load because of migration/schema state.
- Remote server documents are not deletable in this task. The UI should make clear that only local browser persistence can be deleted.
- Manual arbitrary active rows should not appear in the list. A new document is created through a modal form with a title and generated UUID id.

## Phase 1: Normalize Document Metadata

Update local persistence records and summaries so real documents always carry schema metadata.

Files:

- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- `examples/react-crdt/src/lib/solo/persistence.ts`
- `examples/react-crdt/src/lib/local/persistence.ts`
- `examples/react-crdt/src/lib/peerjs/persistence.ts`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/server/persistence.ts`

Steps:

1. Make `LocalDocumentSummary.schemaVersion` required.
2. Add `schemaVersion` to persisted solo, local simulator, and PeerJS document records.
3. Update all save/create/import paths in solo, local simulator, and PeerJS to write the current app schema version.
4. Add IndexedDB version upgrades for those stores if required. Existing rows should be read with a compatibility fallback, then rewritten on save with the current schema version.
5. Ensure local-first and server summary adapters already produce required `schemaVersion` and `schemaFingerprintHash`.
6. Remove modal-path dependence on `documentsForActiveDocument(...)` and `documentsForActiveDoc(...)`.

## Phase 2: Add Local Delete APIs

Add local persistence deletion primitives.

Files:

- `examples/react-crdt/src/lib/solo/persistence.ts`
- `examples/react-crdt/src/lib/local/persistence.ts`
- `examples/react-crdt/src/lib/peerjs/persistence.ts`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/server/persistence.ts`

Steps:

1. Add `deleteSoloDocument(docId)`.
2. Add `deleteLocalSimulatorDocument(docId)`.
3. Add `deletePeerJsDocument(docId)`.
4. Reuse `clearReplica(docId)` for local-first, or export a semantically named wrapper if that reads better at call sites.
5. Add `deleteServerReplica(docId)` that deletes only the local browser replica.
6. Keep server remote deletion out of scope.

## Phase 3: Build Modal Data Models

Create shared types and helpers for modal rows.

Files:

- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- Optionally split to `examples/react-crdt/src/lib/documentArchive/types.ts` if `index.tsx` gets too large.

Suggested types:

```ts
export type DocumentModalSource = 'local' | 'server' | 'local-and-server';

export type DocumentModalItem = {
    docId: string;
    title: string;
    appId: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
    source: DocumentModalSource;
    canDeleteLocal: boolean;
    metrics?: {
        sizeLabel?: string;
        branchCount?: number;
        eventCount?: number;
    };
};

export type SeedModalItem = {
    docId: string;
    title: string;
    appId: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
    sizeLabel: string;
};
```

Steps:

1. Add a helper to map local persisted summaries to `DocumentModalItem`.
2. Add a helper to map branch-free seed summaries to `SeedModalItem`.
3. Filter seed rows against real document ids.
4. Add server-specific classification that keeps local and remote summaries separate until after source classification:
   - local only -> `source: 'local'`
   - remote only -> `source: 'server'`
   - both -> `source: 'local-and-server'`
5. Sort rows predictably by title, then doc id. Keep current document visually marked but do not synthesize missing rows.

## Phase 4: Build The Modal Component

Replace `DocumentPicker` with a modal-based document manager.

Files:

- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- `examples/react-crdt/src/style.css`
- `examples/react-crdt/src/lib/chrome/DemoTopBar.tsx` if trigger layout needs adjustment.

Component responsibilities:

- Render a top-bar trigger button showing the active document title or doc id.
- Open a modal with:
  - Documents section,
  - Seed fixtures section,
  - New document form,
  - Import/export controls.
- Show source badges and schema/version metadata.
- Provide row actions:
  - Open/select,
  - Delete local copy when available,
  - Export for real documents when export is available,
  - Create for seed rows.
- Keep destructive actions behind `window.confirm(...)`.
- Keep the modal open after seed creation and import unless switching documents is explicitly requested.

Implementation notes:

- Use a native dialog or a fixed overlay. A fixed overlay is likely simpler and easier to style consistently.
- Keep keyboard basics: Escape closes, backdrop click closes, trigger has `aria-haspopup="dialog"`, modal has `role="dialog"` and an accessible label.
- Do not use visible instructional text for basic controls; rely on clear labels, headings, and button text.
- Import should use the existing archive parser/validation paths.
- Export should use the existing `DocumentArchiveAdapter.exportArchive()` and `downloadJsonArchive(...)`.

## Phase 5: Wire Non-Server Modes

Update solo, local simulator, PeerJS host, and local-first to use the modal.

Files:

- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`

Steps:

1. Replace `DocumentPicker` usage with the new modal component.
2. Pass real document rows and seed rows separately.
3. Implement `onCreateSeed(seed)` by persisting the seed document without switching, refreshing document rows, and leaving the modal open.
4. Implement `onCreateBlank({title})` by generating `crypto.randomUUID()` for `docId`, creating a blank persisted document with that title, refreshing rows, and leaving the modal open.
5. Implement `onDeleteLocal(docId)` with simple confirm, persistence delete, and row refresh.
6. If the deleted doc is active, switch to a deterministic fallback or reload to default:
   - preferred: first remaining real document for current app/mode,
   - otherwise: current architecture default doc id.
7. Keep PeerJS client behavior as-is: no document modal for clients.

Title handling:

- Current local persistence records use `docId` as title. Add an optional or required `title` field to local persisted records so new documents can preserve user-provided titles.
- Seed-created documents should use the seed title.
- Imported archives can default title to `archive.docId` unless archive metadata is expanded later.

## Phase 6: Wire Server Mode

Update server mode separately because it has local and remote sources.

Files:

- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/server/documents.ts`
- `examples/react-crdt/src/lib/server/persistence.ts`
- `examples/react-crdt/src/lib/server/ServerClientSeedControls.tsx`

Steps:

1. Remove `ServerDocumentPicker`.
2. Remove `ServerClientSeedControls` from top-bar controls.
3. Remove `seedControls` registration for server mode.
4. Keep fetched remote documents and local replicas separate in state.
5. Build classified `DocumentModalItem` rows from local + remote maps.
6. Filter seed rows against the union of local and remote ids.
7. Implement seed creation as local client replica creation only, using `createServerClientSeedReplica({scenario: 'cached'})` unless a modal row-level scenario selector is added.
8. Implement local blank creation by generating a UUID doc id and saving a local server replica with the entered title if server local records gain title metadata. Otherwise use title for row metadata only after extending persistence.
9. Implement local delete by deleting the browser replica. If a remote document with the same id exists, row remains as server-only.
10. Make remote-only rows selectable but not locally deletable.
11. Keep import/export in the modal using the existing server archive adapter.

## Phase 7: Import/Export Integration

Move import/export UI from `DocumentArchiveControls` into the modal.

Files:

- `examples/react-crdt/src/lib/documentArchive/index.tsx`
- All mode components currently passing `archiveControls`.

Steps:

1. Keep `DocumentArchiveAdapter`, `parseArchive`, and `downloadJsonArchive`.
2. Replace `DocumentArchiveControls` top-bar usage with modal props:
   - `archiveAdapter`,
   - `canImport`,
   - `canExport`,
   - `onImported`.
3. Export should export the currently active document.
4. Import should persist through the mode-specific adapter, refresh rows, and keep or switch according to existing adapter behavior. Existing adapters mostly switch to the imported doc; preserve that unless it becomes awkward.
5. Remove or deprecate `DocumentArchiveControls` after all mode call sites are moved.

## Phase 8: Styling

Update CSS for the modal and remove stale picker styles.

Files:

- `examples/react-crdt/src/style.css`

Needed styles:

- Top-bar document trigger button.
- Modal overlay and panel.
- Dense document rows with source badges.
- Seed rows with create buttons.
- New document form.
- Import/export action group.
- Compact mobile layout.

Constraints:

- Keep the modal operational and information-dense.
- Avoid nested card styling.
- Ensure long doc ids wrap or truncate cleanly without causing layout shifts.
- Keep delete actions visually secondary/destructive but not oversized.

## Phase 9: Tests

Add focused unit tests before broad browser checks.

Likely test files:

- `examples/react-crdt/src/lib/documentArchive/documentModal.test.ts`
- `examples/react-crdt/src/lib/server/documents.test.ts`
- Existing persistence tests if present, or new small tests around IndexedDB helpers.

Test cases:

- Local document rows require schema metadata.
- Seed rows are omitted once a real document with the same id exists.
- Server classification returns local-only, server-only, and local-and-server rows.
- No synthetic active row is added for a missing active doc id.
- Delete helper removes the correct local persisted document.
- Local-first delete removes replica and batch-related state.
- Seed create persists a new real document without switching active doc.

Manual/browser checks:

- Solo/local/PeerJS host/local-first/server open the modal and show separate real + seed sections.
- Import/export still work in each mode.
- Server remote-only row has no local delete button.
- Server local+remote delete local copy leaves a server-only row.
- Incompatible or migratable local documents can be deleted from the modal.

## Cleanup

- Remove `DocumentPicker` and `ServerDocumentPicker` if no longer used.
- Remove `mergeDocumentSummariesWithSeeds(...)` from picker paths if replaced by modal seed separation. Keep lower-level seed helpers.
- Remove `documentsForActiveDocument(...)` and `documentsForActiveDoc(...)` if no remaining call sites need them.
- Remove `ServerClientSeedControls.tsx` if fully unused.
- Update any README or task notes only if the UI behavior is documented there.
