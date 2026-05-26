# Seed Everything Research

## Goal

The previous seed work added curated server SQLite databases for the React CRDT server architecture. The next step is to make the same seeded document states available across the other React CRDT demo architectures so they can be used for manual testing, performance checks, migration exploration, and regression-oriented E2E flows.

The important nuance is that not every architecture has a literal database today. Server mode has SQLite, server client replicas and local-first use IndexedDB, and solo/local/PeerJS are mostly in-memory demos. A good implementation should therefore treat the existing seeded documents as a shared fixture catalog, then adapt that catalog into each architecture's native startup or persistence model.

## Existing Server Seed Work

The archived seed database task implemented a complete server pipeline:

- `examples/react-crdt/src/lib/seed/generate.ts` generates deterministic fixture payloads from the real todo and whiteboard schemas.
- `examples/react-crdt-server/src/types.ts` defines `SeedDatabasePayload`, `SeedDocument`, users, branches, and branch events.
- `examples/react-crdt-server/src/store.ts` imports seed payloads into SQLite with document metadata, branches, events, and users.
- `examples/react-crdt-server/src/seed.ts` imports JSON into a chosen DB path.
- `examples/react-crdt-server/src/seedTest.ts` runs the client generator and imports the output into `test-server-sync.sqlite`.
- `GET /documents` and the client server document picker expose seeded server documents in the UI.

The generated fixtures already cover both registered apps:

- `todos-small`
- `todos-many-items`
- `todos-many-events`
- `todos-branches`
- `todos-merge-review`
- `whiteboard-many-elements`
- `whiteboard-branches`

This generator is the best canonical source for fixture content because it shares the real app schemas and uses CRDT update generation rather than hand-written storage rows.

## Current App Architecture

`examples/react-crdt/src/App.tsx` selects an app and a mode from the URL hash. Registered apps live in `src/lib/appRegistry.ts`, currently todos and whiteboard. Shared app/runtime types and initial history helpers live in `src/lib/crdtApp.ts`.

Modes:

- `solo`: non-CRDT local history via `HistoryRuntime`.
- `local`: two in-memory CRDT replicas connected by a simulated transport.
- `peerjs`: one host and one or more clients over PeerJS, with host snapshot handoff.
- `local-first`: durable browser IndexedDB replicas with retained batches, vectors, PeerJS mesh sync, snapshots, and migration behavior.
- `server`: durable browser IndexedDB client replica synced to the Bun/SQLite server.

The existing seed payload format is server-shaped: document metadata plus server branches and branch events. For non-server modes, the useful underlying data is the CRDT histories and update logs implied by those branches/events, not the SQLite storage itself.

## Mode-by-Mode Findings

### Solo

`src/lib/solo/SoloApp.tsx` creates `createInitialHistory(app)` once and renders the app panel plus a non-CRDT `HistoryView`.

There is no persistence and no CRDT update log in this mode. A seeded solo document cannot directly use server branch events because solo history stores ordinary umkehr history entries, not CRDT branch events.

Recommended seed approach:

- Support only final-state seeds at first.
- Add a shared seed picker that can provide an app-compatible final `state`.
- Initialize solo with `blankHistory(seed.state)` instead of `blankHistory(app.initialState)`.

This makes solo useful for testing UI rendering against large/interesting states, but not for CRDT history, branch, or merge behavior.

Open issue:

- If solo should test undo/redo history for seeded scenarios, the generator needs a separate non-CRDT history representation or replayable plain draft patches.

### Local Simulator

`src/lib/local/LocalSimulatorApp.tsx` creates one initial CRDT history and passes it to both replicas. `src/lib/local/useLocalDemoSync.ts` keeps sync state in memory with a simple outbox when sync is disabled.

There is no durable local database. Seeded local mode can be implemented by changing the initial CRDT history used by both replicas.

Recommended seed approach:

- Convert a seed fixture's `main` branch into a `CrdtLocalHistory`.
- Initialize both replicas from that same history.
- Add optional scenarios that start replicas from different branches or with sync disabled and queued updates.

The current seed payload includes branch topology, so local mode could use `todos-branches` and `whiteboard-branches` to start Replica A on `main` and Replica B on a branch for conflict/merge-like visual testing. The local simulator transport does not understand named branches, so this would be a demo scenario, not a faithful server branch model.

Open issue:

- Decide whether local simulator seeds should always start both replicas at the same branch tip, or whether some fixtures should intentionally start replicas diverged.

### PeerJS

`src/lib/peerjs/PeerJsApp.tsx` creates the host document from `createInitialCrdtHistory(app)`. Clients do not create local documents; they wait for a host snapshot. `src/lib/peerjs/usePeerJsSync.ts` sends snapshots and CRDT updates over PeerJS.

There is no durable peer database. The host initial document is the seed point.

Recommended seed approach:

- Let the host choose a seed fixture before or during initialization.
- Build the host initial `CrdtLocalHistory` from the selected fixture's `main` branch.
- Existing snapshot delivery will carry the seeded state to clients.

PeerJS should not need its own seed persistence format unless we want repeatable multi-peer retained logs. For the current architecture, seed selection belongs at the host app level.

Open issues:

- If a host switches seed after clients joined, should it disconnect/recreate the room, or broadcast a full replacement snapshot? Current PeerJS logic only applies the first client snapshot.
- Should invite URLs include the seed id, or is seed choice intentionally host-local?

### Local-First

`src/lib/local-first/LocalFirstApp.tsx` reads `?doc=<id>` or falls back to `runtime.docId`, then loads or creates a durable IndexedDB replica through `src/lib/local-first/persistence.ts`.

IndexedDB shape:

- DB name: `umkehr-react-crdt-local-first`
- stores: `identity`, `replicas`, `batches`, `receivedBatches`
- `PersistedReplica<TState>` stores one retained `CrdtLocalHistory`, schema metadata, vector, optional compaction frontier, and optional migration lineage.
- `PersistedBatch` stores retained CRDT update batches with vector metadata.

This is the main "other architecture" that really needs seed databases. The current persistence module already has `exportReplicaState()` and `importReplicaState()`, but the UI import path is clipboard/prompt-oriented and requires a current mounted sync session.

Recommended seed approach:

- Add a client-side local-first seed generator/importer that writes directly to IndexedDB using `replaceReplicaState(...)`.
- Reuse the existing server fixture generator's CRDT update events to create:
  - a `PersistedReplica` for the selected final branch state;
  - retained `PersistedBatch[]` derived from update events;
  - `receivedBatches` entries via `replaceReplicaState`.
- Use the fixture doc id as the local-first `docId`, so `?doc=todos-many-events#mode=local-first&app=todos` opens the seeded replica.
- Add local-first document discovery/picker for persisted replicas, or reuse a broader seed picker that can write/open a fixture.

Local-first cannot represent server merge events directly as retained batches because `PersistedBatch` stores CRDT updates, while server branch merge events reference another branch and event index. For first pass, materialize a selected branch, retain only update batches that are meaningful for replay/vector testing, and treat merge-heavy fixtures as final-state seeds unless a local-first-specific fixture is added.

Useful local-first seed scenarios:

- final state only: large todo list or whiteboard for startup/rendering.
- retained log: many batches from multiple actors for vector, compaction, and replay UI.
- behind snapshot: one seeded replica compacted beyond another actor's vector.
- migration candidate: old-schema persisted replica plus current app schema to exercise local-first migration.

Open issues:

- Should local-first seeds live in the normal IndexedDB database or a separate seed database name? Normal DB matches production behavior but can overwrite developer data. A separate DB would require database-name plumbing through persistence.
  - we already support multiple 'documents' via url query param
- Should seeding overwrite a document by default? `replaceReplicaState` overwrites one doc safely, but a UI seed action needs clear semantics.
  - each seed should have an associated docId; if a document with that id exists, then it shuold overwrite that
- How much branch/merge information should be preserved, given local-first has no branch model?
  - let's actually reject imports/seeds that contain multiple branches or merge events
- Should seeded identity be deterministic, or should seeds use the browser's existing `identity` store?
  - let's go deterministic

### Server Client Replica

Server mode has two databases:

- server-side SQLite in `examples/react-crdt-server`;
- browser-side IndexedDB in `src/lib/server/persistence.ts`.

The previous task seeded the server SQLite side. Browser replicas are still created lazily per `docId` and cached in IndexedDB under `umkehr-react-crdt-server-sync`.

This is probably fine for normal seeded server testing: the browser should connect to seeded SQLite and build its local replica through the production sync path. Directly seeding the server client IndexedDB would mainly be useful for testing offline pending uploads or stale client state.

Recommended seed approach:

- Keep server SQLite as the canonical server seed database.
- Add optional E2E-only helpers for server client IndexedDB states such as pending local events, stale schema metadata, or cached old branches.

Open issue:

- Whether "seed everything" includes browser-side server replica seeds, or whether server mode is considered complete because its authoritative SQLite database is seeded.
  - server mode is mostly complete, but I do want to be able to test different client states

## Shared Fixture Catalog Direction

The existing `SeedDatabasePayload` is close to a useful shared fixture catalog, but it is still named and typed around server storage. Rather than duplicate fixture construction for every mode, introduce a client-owned fixture layer that can emit several projections.

Suggested shape:

```ts
type SeedFixture<TState> = {
    id: string;
    appId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    branches: SeedBranch<TState>[];
};

type SeedBranch<TState> = {
    branchId: string;
    name: string;
    history: CrdtLocalHistory<TState>;
    updateEvents: SeedUpdateEvent[];
    mergeEvents: SeedMergeEvent[];
};
```

Then adapters can produce:

- server `SeedDatabasePayload`;
- solo initial `History`;
- local/PeerJS initial `CrdtLocalHistory`;
- local-first `PersistedReplica` plus `PersistedBatch[]`;
- E2E browser storage setup data.

This avoids treating the server import format as the internal source of truth forever. The current generator's `BranchBuilder` already maintains `histories` while generating branches; the main change is to expose those histories before dropping down to server-only JSON.

## UI/URL Considerations

Server mode already uses `?doc=<docId>` and a document picker. Local-first also reads `?doc=<docId>`, but it does not currently discover seed fixtures or list persisted replicas in a picker. Solo/local/PeerJS do not currently read a seed id.

Recommended URL model:

- Keep hash `mode` and `app` selection as-is.
- Use `?doc=<fixture-or-document-id>` for durable document ids in server and local-first.
- Consider `?seed=<fixture-id>` for in-memory modes where no durable document is being opened.

Alternative:

- Use `?doc=<id>` everywhere and treat in-memory modes as "open this seeded doc id."

The alternative is simpler for users, but it blurs durable document ids and ephemeral seed choices. The decision should be explicit before wiring UI.

## Testing Implications

Existing tests cover server seed payload generation and server import. New tests should focus on projection correctness:

- fixture catalog emits expected ids, apps, sizes, and deterministic timestamps;
- server adapter remains byte-for-byte compatible enough for current importer tests;
- local/PeerJS adapter materializes the same final state as server branch replay;
- local-first adapter writes a valid `PersistedReplica` and retained batches;
- local-first import rejects schema mismatches and wrong app ids;
- URL helpers preserve app/mode/hash/query behavior.

For E2E, Playwright can seed IndexedDB using app-exposed helpers or page scripts. Direct browser IndexedDB writes are acceptable for E2E setup, but production/dev seed actions should use the real persistence APIs.

## Recommended Implementation Path

1. Refactor `src/lib/seed/generate.ts` so fixture construction exposes an app-agnostic catalog with branch histories and update/merge events.
2. Keep the existing server JSON output as an adapter over that catalog; preserve `seed:server` and `seed:test`.
3. Add in-memory seed selection for solo, local, and PeerJS host mode.
4. Add a local-first seed importer that writes selected fixtures to IndexedDB and opens them by `?doc=...#mode=local-first`.
5. Add local-first-specific stress fixtures for retained batches, compaction, replay, and migration after the basic shared fixtures are available.
6. Add tests around each adapter and one browser smoke test that opens a seeded fixture in each mode.

## Open Questions

- Does "seed databases" require literal IndexedDB fixture files/exports for browser modes, or is a checked-in generator/importer sufficient?
  - let's deal in real db-backed documents
- Should local-first seeds overwrite documents automatically, require confirmation in the UI, or write under namespaced ids such as `seed/todos-small`?
  - if the corresponding docId already exists, overwrite it
- Should in-memory modes use `?seed=` while durable modes use `?doc=`, or should the UI use `?doc=` consistently?
  - let's not have in-memory modes. selecting a 'seed document' should create it in the database if it doesn't yet exist
- Should branch-heavy server fixtures be flattened for local/local-first modes, or should those modes get separate branch-free fixture variants?
  - branch-free
- Should local-first retained batches preserve one event per batch, group by actor, or group by generated scenario step?
  - one event per batch
- Should seeded users/actors stay shared across all modes, or should each mode use its existing actor names (`replica-a`, `host-*`, local-first replica ids)?
  - shared across all modes
- How should seed selection interact with PeerJS clients that have already accepted an initial host snapshot?
  - PeerJS clients have no persistence, and so have no seed selection. the peerjs host is the one to select the current document
- Should server client IndexedDB be seeded for offline/stale-client scenarios, or should those remain E2E-only setup helpers?
  - yes I do want to be able to test that please
