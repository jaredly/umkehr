# Seed Everything Implementation Plan

## Goal

Make seeded React CRDT documents available as real database-backed documents across the example architectures.

The target behavior is:

- keep the existing server SQLite seed workflow working;
- use one canonical seed fixture generator for todos and whiteboard;
- use `?doc=<docId>` consistently for seeded documents;
- when a user selects a seed document, create or overwrite the corresponding browser/server document storage for the active architecture;
- give solo, local simulator, PeerJS host, local-first, and server client scenarios real persisted seed state rather than ephemeral in-memory startup state;
- support deterministic seed identities and deterministic generation with `--date`;
- reject seed imports for architectures that cannot represent a fixture shape instead of silently flattening important semantics.

There are unrelated worktree changes in this repo, including the archived `.tasks/seed-dbs` move. Implementation should inspect diffs before editing shared files and avoid reverting user work.

## Decisions

- The existing client seed generator should become the canonical fixture catalog.
- The server seed JSON should remain an adapter output for SQLite server import.
- Use `?doc=<id>` everywhere. Do not add a separate `?seed=` mode.
- Selecting a seed document should create the document in the appropriate database if it does not exist.
- If the seed document's `docId` already exists, seed import should overwrite that document.
- Browser-backed non-server modes need real persisted document storage, not in-memory seed startup.
- Local-first seeds should write to the normal local-first IndexedDB database; multiple documents are already selected by `?doc=`.
- Local-first imports must reject fixtures that contain multiple branches or merge events.
- Branch-heavy server fixtures should get branch-free variants or should be excluded from local/local-first imports.
- Local-first retained batches should use one update event per batch.
- Seeded users/actors should be shared across modes.
- Seeded browser identities should be deterministic.
- PeerJS clients have no persistence and no seed selection. The PeerJS host selects/opens the current persisted document.
- Server authoritative SQLite seeding is mostly complete, but server client IndexedDB must also be seedable for offline/stale/pending-client-state testing.

## Phase 1: Refactor Seed Fixtures Into a Catalog

Likely files:

- `examples/react-crdt/src/lib/seed/generate.ts`
- `examples/react-crdt/src/lib/seed/generate.test.ts`
- new files under `examples/react-crdt/src/lib/seed/`

Work:

- Split the current generator into:
  - fixture construction;
  - server payload projection;
  - branch-free browser document projection;
  - CLI argument parsing/output.
- Add explicit seed catalog types, roughly:

```ts
type SeedFixture<TState> = {
    docId: string;
    appId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    createdAt: string;
    lastAccessedAt: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    users: SeedUser[];
    branches: SeedFixtureBranch<TState>[];
};

type SeedFixtureBranch<TState> = {
    branchId: string;
    name: string;
    sourceBranchId?: string;
    forkEventIndex?: number;
    tipEventIndex: number;
    history: CrdtLocalHistory<TState>;
    events: ServerBranchEvent[];
};
```

- Keep existing server fixture ids unchanged for server mode.
- Add or expose a branch-free fixture set for browser document modes:
  - include baseline, large-state, and many-event fixtures;
  - exclude or reject branch/merge fixtures for modes without branch storage.
- Preserve deterministic output for `--date`.
- Keep `generateSeedDatabasePayload(...)` available as the server adapter.
- Add helper APIs:
  - `generateSeedCatalog(options)`
  - `listSeedDocumentSummaries(options)`
  - `seedFixtureForDocId(catalog, docId)`
  - `assertBranchFreeFixture(fixture)`
  - `mainBranchHistory(fixture)`
  - `mainBranchEvents(fixture)`
  - `mainBranchState(fixture)`

Acceptance:

- Existing server seed generator tests still pass.
- The server payload emitted by `seed:server` remains compatible with `examples/react-crdt-server`.
- Tests prove catalog generation is deterministic with a fixed `--date`.
- Tests prove branch-free projection rejects multi-branch or merge-event fixtures.
- Tests prove server payload projection preserves document ids, metadata, branches, and events.

## Phase 2: Browser Seed Document Store

Likely files:

- new `examples/react-crdt/src/lib/seed/browserPersistence.ts`
- new `examples/react-crdt/src/lib/seed/browserDocuments.ts`
- `examples/react-crdt/src/lib/crdtApp.ts`
- seed tests

Work:

- Add a browser IndexedDB database for non-server seed/opened documents.
- Store app-compatible persisted CRDT documents by `docId`.
- Persist enough metadata to render a picker:
  - `docId`
  - `appId`
  - `title`
  - `sizeLabel`
  - `sizeRank`
  - schema version/fingerprint/hash
  - updated/seeded timestamps
- Store the current branch-free `CrdtLocalHistory`.
- Store retained one-event batches if useful for local/local simulator/PeerJS history inspection, but the first requirement is a persisted current document.
- Add deterministic seed identity data:
  - seeded users from the catalog;
  - deterministic actors shared across modes.
- Add APIs:

```ts
listBrowserDocuments(appId?: string): Promise<BrowserDocumentSummary[]>;
loadBrowserDocument<TState>(docId: string): Promise<BrowserSeedDocument<TState> | null>;
saveBrowserDocument<TState>(document: BrowserSeedDocument<TState>): Promise<void>;
importBrowserSeedFixture<TState>(fixture: SeedFixture<TState>): Promise<BrowserSeedDocument<TState>>;
```

- `importBrowserSeedFixture` should overwrite any existing browser document with the fixture `docId`.
- Validate schema hash and app id before writing.

Acceptance:

- Importing a branch-free seed writes a real IndexedDB document.
- Re-importing the same `docId` overwrites the existing document.
- Listing documents returns metadata sorted by `sizeRank`/title/doc id.
- Loading a document after refresh returns the seeded `CrdtLocalHistory`.
- Multi-branch or merge fixtures are rejected for browser document import.

## Phase 3: Shared `?doc=` Selection UI

Likely files:

- `examples/react-crdt/src/App.tsx`
- `examples/react-crdt/src/lib/seed/`
- `examples/react-crdt/src/lib/useHashMode.ts`
- `examples/react-crdt/src/style.css`

Work:

- Add query helpers for:
  - `readActiveDocId()`
  - `writeActiveDocId(docId)`
  - preserving existing `peer` and hash mode/app params.
- Add a document picker/importer for browser-backed modes.
- The picker should:
  - show persisted browser documents for the active app;
  - show available branch-free seed fixtures for the active app;
  - import/create the selected seed document if missing;
  - overwrite if the seed `docId` exists;
  - update `?doc=<docId>`.
- Keep the server `/documents` picker separate because it reflects the running server DB.
- Local-first can share fixture listing but imports into its own IndexedDB schema.

Acceptance:

- Selecting a seed updates `?doc=<docId>` while preserving mode/app hash selection.
- Selecting a missing seed creates it in the active architecture's database.
- Selecting an existing seed overwrites the document for that architecture.
- Switching app filters incompatible documents and seeds.
- Existing server `?doc=` behavior remains unchanged.

## Phase 4: Solo Mode Database-Backed Documents

Likely files:

- `examples/react-crdt/src/lib/solo/SoloApp.tsx`
- `examples/react-crdt/src/lib/crdtApp.ts`
- browser seed document store files

Work:

- Load the active `?doc=` from the browser seed document store.
- If missing and the `docId` matches a branch-free seed fixture for the app, import it first.
- Initialize solo from the persisted document's final state.
- Save solo edits back to the browser document store as final state.
  - Solo uses non-CRDT history, so persistence can store the resulting state in a fresh CRDT history or a mode-specific solo persisted shape.
  - Prefer a shape that keeps the browser document usable by local and PeerJS modes.
- Key/remount the provider when app id or doc id changes.

Acceptance:

- `?doc=todos-many-items#mode=solo` creates/opens a persisted seeded solo document.
- Refresh keeps the seeded/edited solo document.
- Solo undo/redo starts from the loaded document as base history.
- Solo edits can be reopened in another browser-backed mode when schema-compatible.

## Phase 5: Local Simulator Database-Backed Documents

Likely files:

- `examples/react-crdt/src/lib/local/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/lib/local/model.ts`
- browser seed document store files

Work:

- Load the active `?doc=` from the browser seed document store.
- If missing and the `docId` matches a branch-free seed fixture for the app, import it first.
- Initialize both replicas from the persisted `CrdtLocalHistory`.
- Save the authoritative latest local document back to the browser document store.
  - The simplest policy is save from Replica A and treat Replica B as the paired simulator.
  - If both replicas can edit, decide whether to save on every provider `save` callback after CRDT sync settles.
- Use shared seeded actors where possible instead of inventing mode-only actor ids.
- Keep durable update queue behavior unchanged.

Acceptance:

- `?doc=todos-many-events` opens both local simulator replicas from the persisted seeded document.
- Editing either replica still syncs to the other replica.
- Refresh reopens the latest saved state.
- Disabling/re-enabling local sync still works with seeded histories.
- Existing local simulator tests still pass.

## Phase 6: PeerJS Host Database-Backed Documents

Likely files:

- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`
- `examples/react-crdt/src/lib/peerjs/PeerJsControls.tsx`
- browser seed document store files

Work:

- Host mode loads/creates the active `?doc=` from the browser seed document store.
- PeerJS clients do not import/select seed documents; they wait for the host snapshot.
- Host edits save back to the browser document store.
- Client edits flow to the host through the existing update path; host persistence then records the resulting document.
- If a client URL includes `?doc=`, treat it as informational only unless it is used to connect to a host invite.
- Do not live-switch host documents while clients are connected in the first pass; require disconnect/reopen.

Acceptance:

- Opening PeerJS as host with `?doc=todos-small#mode=peerjs` creates/opens that persisted document.
- A client joining the host receives the seeded state through the existing snapshot flow.
- Host edits persist across refresh.
- PeerJS clients have no seed/import UI.

## Phase 7: Local-First Seed Projection

Likely files:

- `examples/react-crdt/src/lib/seed/`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/local-first/vector.ts`
- `examples/react-crdt/src/lib/local-first/types.ts`
- `examples/react-crdt/src/lib/local-first/local-first.test.ts`

Work:

- Add a seed adapter that converts a branch-free catalog fixture into:
  - deterministic `ReplicaIdentity`;
  - `PersistedReplica<TState>`;
  - `PersistedBatch[]`;
  - derived vector metadata.
- Reject any fixture with:
  - more than one branch;
  - any merge event;
  - schema/app mismatch.
- Use the fixture `docId` as the local-first `docId`.
- Convert update events into retained batches:
  - one update event per batch;
  - use event origin as batch origin;
  - derive `minTs`, `maxTs`, and `vectorAfter` with existing vector helpers.
- Add helper:

```ts
createLocalFirstSeedReplica({
    fixture,
    identity,
}): {replica: PersistedReplica<TState>; batches: PersistedBatch[]}
```

- Deterministic identity should come from seed metadata, not the browser's existing random identity.

Acceptance:

- Unit tests create a local-first seed replica from a branch-free many-events fixture.
- Multi-branch and merge-event fixtures are rejected.
- The produced replica has deterministic identity, valid doc id, history, schema metadata, vector, and retained batches.
- Retained batch count equals included update event count.

## Phase 8: Local-First Import and Picker UI

Likely files:

- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstControls.tsx`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- seed helper files
- `examples/react-crdt/src/style.css`

Work:

- Add local-first seed import that writes directly to the normal local-first IndexedDB database:
  - deterministic identity;
  - `replaceReplicaState(replica, batches)`;
  - open `?doc=<fixture.docId>#mode=local-first`.
- Add local-first controls for:
  - choosing a branch-free seed fixture for the active app;
  - importing/opening the fixture;
  - indicating when a persisted replica with that doc id already exists.
- Overwrite existing local-first document with the same seed `docId`.
- Add a persisted document list using `listReplicas()` if cheap.
- Ensure tab locks do not block seed import unnecessarily. If overwriting the active doc, import and reload/remount.

Acceptance:

- Importing `todos-many-events` creates/opens a local-first document at `?doc=todos-many-events#mode=local-first`.
- Importing the same seed again overwrites that local-first document.
- Refresh loads the seeded replica from IndexedDB.
- Local-first sync, export/import, compaction stats, and reset controls still work after seed import.
- Branch-heavy fixtures cannot be selected/imported into local-first.

## Phase 9: Server Client IndexedDB Seed Scenarios

Likely files:

- `examples/react-crdt/src/lib/server/persistence.ts`
- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/server/ServerControls.tsx`
- seed helper files

Work:

- Keep server SQLite seed database as the authoritative server seed path.
- Add explicit server-client replica seed scenarios for browser IndexedDB:
  - cached replica behind server;
  - pending local upload(s);
  - stale schema metadata/client migration required;
  - offline local branch/event cache if supported by current types.
- Add a seed adapter that writes `PersistedServerReplica<TState>` values into `umkehr-react-crdt-server-sync`.
- Use shared seeded actors/users where the server client type permits it.
- Expose these as dev/test seed actions, not automatic normal server document selection.
- Make sure seeded server client docs still reconcile through the production WebSocket sync path when the server is running.

Acceptance:

- A seeded server client replica can be loaded from IndexedDB before connecting.
- Pending-upload scenario shows pending uploads and can sync to a compatible seeded server DB.
- Stale/cached scenario exercises client/server reconciliation without manual IndexedDB editing.
- Existing normal server seed workflow remains unchanged.

## Phase 10: Tests and Verification

Client unit tests:

- seed catalog determinism and fixture ids;
- server payload adapter compatibility;
- branch-free projection rejection for multi-branch/merge fixtures;
- browser seed document store import/load/list/overwrite;
- solo/local/PeerJS load persisted browser documents;
- local-first deterministic replica/batch projection;
- local-first import rejection for branch-heavy fixtures;
- server client IndexedDB seed scenario builders;
- `?doc=` URL helper behavior.

Server tests:

- Existing server seed tests should continue to pass unchanged.
- Add no server test changes unless the payload adapter changes server-facing JSON.

Manual/browser checks:

- create/open seeded todos in solo mode and refresh;
- create/open seeded whiteboard in solo mode and refresh;
- create/open seeded todos in local simulator, edit both replicas, and refresh;
- create/open seeded PeerJS host, join with a client, edit, and refresh host;
- import/open seeded local-first todos and refresh;
- import/open seeded local-first whiteboard and refresh;
- seed a server client pending/offline scenario and reconcile with server;
- run the existing server seed flow as a regression.

Suggested commands:

```sh
cd examples/react-crdt
npx vitest run src/lib/seed/generate.test.ts src/lib/useHashMode.test.ts src/lib/local-first/local-first.test.ts
pnpm build

cd ../react-crdt-server
bun test ./src/store.bun.ts ./src/cli.bun.ts
bun run typecheck
bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-seed-everything.sqlite
```

Acceptance:

- All touched client tests pass.
- Client build/typecheck passes.
- Server seed workflow still imports seven documents and four users.
- No existing seed server behavior regresses.

## Follow-Ups

- Add divergent branch startup scenarios for local simulator only after a branch-capable local storage model exists.
- Add PeerJS invite links that optionally carry doc id if that becomes useful.
- Add separate browser seed database-name plumbing if overwriting normal browser document data becomes a problem.
- Add Playwright smoke tests that create/open one seeded document in each mode.
