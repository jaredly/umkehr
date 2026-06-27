# Plan: React CRDT Wordsearch

## Direction

Build a new `wordsearch` app in `examples/react-crdt`.

Only finds are CRDT state:

```ts
type WordsearchState = {
    found: Record<string, Record<string, HlcTimestamp>>;
};
```

The immutable board and word locations live in an artifact with id `"puzzle"`. The app should introduce a small shared artifact API for `examples/react-crdt`, then use it from wordsearch. In-progress drag selections should use CRDT ephemeral presence events, not the whiteboard-specific `presenceSelection`/status path.

All sync modes that can introduce a peer to an existing document need artifact payload transfer. The artifact payload is not CRDT state and should not be merged as part of document updates, but server-backed and PeerJS documents both need artifact exchange so a peer that joins later can render the puzzle.

## Phase 1: Artifact API

Add a small generic artifact layer under `examples/react-crdt/src/lib/artifacts`.

Required shape:

```ts
export type Artifact = {
    id: string;
};

export type ArtifactManifestEntry = {
    id: string;
    kind: string;
    version: number;
    fingerprintHash: string;
};

export type SerializedArtifact = ArtifactManifestEntry & {
    data: unknown;
};

export type ArtifactStore<TArtifact extends Artifact = Artifact> = {
    get(id: string): TArtifact | null;
    serialize(id: string): SerializedArtifact | null;
    load(artifact: SerializedArtifact): void;
    manifest(): ArtifactManifestEntry[];
};
```

Implementation notes:

- Keep this read-only and synchronous for now.
- Add serialization and loading for JSON-sized artifacts. Do not add binary uploads, streaming, or manifest negotiation yet.
- The wordsearch app can import this type and provide its own `wordsearchArtifactStore`.
- Runtime missing-artifact fallback is still needed, but the server should persist required artifact manifests and payloads.
- The artifact fingerprint can initially be a stable hash of a canonical JSON representation of the bundled artifact.

## Phase 2: App And Server Artifact Metadata

Wire artifact manifests and payload transfer into the React CRDT app/server layer.

App definition:

- Extend `AppDefinition` with an optional artifact store or manifest provider, e.g. `artifacts?: ArtifactStore`.
- Keep this optional so existing apps do not need changes.
- Add a helper such as `artifactManifestForApp(app)` that returns `[]` for apps without artifacts.

Server persisted metadata:

- Extend `PersistedServerReplica` with `artifacts: ArtifactManifestEntry[]`.
- Add server-side artifact storage keyed by `docId + artifactId`, storing `SerializedArtifact`.
- Include artifact metadata in `ServerDocumentSummary` if useful for diagnostics, or at least retain it in the full persisted replica.
- When bootstrapping/creating a server document, upload/store `app.artifacts.serialize(id)` for each required artifact and persist the manifest.
- When connecting to an existing server document, compare the persisted artifact manifest with the current app manifest.
- If a required artifact is missing locally, download it from the server and call `app.artifacts.load(serialized)`.
- If the server lacks a required artifact payload, keep the document loadable but expose a warning/missing-artifact state to the UI.
- If fingerprint mismatches, prefer the document/server artifact payload for that document and expose a warning. Do not silently substitute a different bundled artifact.

Protocol/import/export:

- Include artifact manifests and payloads in server document import/upload paths where documents are created or replaced.
- Add protocol/API messages or HTTP endpoints for artifact upload/download. Keep them document-scoped, not branch-scoped.
- Include artifact manifest in document archive export/import if archive support is in scope for this app.
- Include artifact payloads in document archive export/import for portability.

Validation behavior:

- A manifest mismatch should not corrupt or reject CRDT state by default.
- The wordsearch panel must still handle `wordsearchArtifactStore.get('puzzle') === null`.
- The server should know the document requires `{id: 'puzzle', kind: 'wordsearch-puzzle', version: 1, fingerprintHash: ...}`.
- Peers should not rely on the bundled artifact being present. Server-backed load should hydrate the artifact store from the server payload before rendering when possible.

## Phase 3: PeerJS Artifact Transfer

Extend PeerJS sync so host snapshots include document artifacts.

Current PeerJS behavior:

- `PeerMessage` supports `hello`, `snapshot`, `updates`, and `ephemeral`.
- `snapshot` currently carries only `CrdtDocument<TState>`.
- That is not enough for document-specific artifacts.

Protocol changes:

- Add artifact manifest/payload support to PeerJS snapshot messages:

```ts
{
    kind: 'snapshot';
    document: CrdtDocument<TState>;
    artifacts: SerializedArtifact[];
}
```

- Optionally add standalone artifact messages if large payloads or late repair are needed:

```ts
{
    kind: 'artifacts';
    artifacts: SerializedArtifact[];
}
```

PeerJS behavior:

- The host should serialize required artifacts from `app.artifacts` when sending a snapshot to a client.
- A client should load snapshot artifacts before or alongside installing the CRDT document snapshot.
- If a client detects a manifest entry without local payload, it can request/resend artifacts or display the same missing-artifact fallback.
- Host rebroadcast to other clients is not necessary for immutable puzzle artifacts if all clients get a host snapshot, but standalone artifact repair messages make reconnects safer.

Validation:

- PeerJS protocol validation should validate serialized artifact shape and fingerprint before loading.
- Artifact payload size should be bounded. The current ephemeral size limit is not relevant for snapshot artifacts; add a separate conservative artifact snapshot limit.

## Phase 4: Local Simulator And Local-First Artifact Handling

Local simulator:

- Local simulator replicas can share the same app-local artifact store for this first implementation.
- Still exercise `serialize`/`load` in tests so the local path does not hide broken artifact portability.

Local-first:

- If local-first peers exchange snapshots, include artifact manifests/payloads in the same snapshot path used for CRDT document transfer.
- If local-first currently has no artifact-aware persistence, persist serialized artifacts in IndexedDB alongside the document metadata.
- On document load, hydrate app artifact stores before rendering panels when possible.

## Phase 5: Wordsearch Model And Artifacts

Create `examples/react-crdt/src/apps/wordsearch`.

Files:

- `schema.ts`
- `artifacts.ts`
- `model.ts`
- `wordsearch.ts`
- `WordsearchApp.tsx`
- `WordsearchPanel.tsx`
- optional focused tests alongside helpers

`schema.ts`:

- Define `WordsearchState`.
- Use `typia.json.schemas<[WordsearchState], '3.1'>()`.
- Use `typia.createValidate<WordsearchState>()`.
- Export `WORDSEARCH_DOC_ID`.
- Export `initialWordsearchState = {found: {}}`.
- Export a fixed `initialWordsearchTimestamp`.

`artifacts.ts`:

- Define `GridPoint`, `WordEntry`, and `WordsearchPuzzleArtifact`.
- Export `WORDSEARCH_PUZZLE_ARTIFACT_ID = 'puzzle'`.
- Export one 8x8 puzzle artifact with fixed board and words.
- Include horizontal, vertical, diagonal, and reversed-findable words.
- Export `wordsearchArtifactStore`.
- Implement `manifest()`, `serialize(id)`, and `load(serialized)` for the puzzle artifact.

`model.ts`:

- Create history and synced contexts with `createHistoryContext` and `createSyncedContext`.
- Configure typed ephemeral validation for wordsearch selection events if using a concrete `WordsearchEphemeralData` union.

## Phase 6: Wordsearch Core Logic

Create pure helpers in `wordsearch.ts`.

Required helpers:

- `cellsForSelection(selection)` returns selected grid cells for horizontal, vertical, and diagonal selections; returns empty/null for nonlinear selections.
- `samePoint(a, b)`.
- `matchingWordIndex(puzzle, selection)` matches forward or reverse.
- `firstFinder(foundForWord)` chooses the earliest HLC timestamp, then actor id as a stable tie-break.
- `isWordFound(foundForWord)`.
- `wordPath(wordIndex, actor)` or similar CRDT path helpers for `found`.

Find commit rules:

- On successful selection, re-read latest state.
- If any entry exists for that word, reject the UI action.
- Otherwise write `found[wordIndex][actor] = current HLC timestamp`.
- If `found[wordIndex]` does not exist, create the nested record first or dispatch a patch that sets the full word entry record.
- Do not clean up losing concurrent finders. Keep all actor entries and derive the visible winner with `firstFinder`.

HLC timestamp detail:

- Prefer a timestamp source already available from the CRDT/editor layer if exposed.
- If not exposed to app code, add a narrow helper/API rather than using wall-clock numbers.
- Avoid `Date.now()` for persisted `found` values.

## Phase 7: Presence Events For In-Progress Selection

Use ephemeral presence events through `editor.publishEphemeral` and `editor.useEphemeral`.

Data shape:

```ts
type WordsearchSelectionEvent = {
    type: 'selection';
    start: GridPoint;
    end: GridPoint;
    cells: GridPoint[];
};
```

Event details:

- `kind`: `wordsearch:selection`
- `id`: stable per actor, e.g. `wordsearch:selection:${actor}`
- `actor`: current actor
- `path`: `[{type: 'key', key: 'found'}]`
- `data`: current selection payload
- clear event on pointer up, pointer cancel, unmount, or read-only transition

Rendering:

- Query `editor.useEphemeral({path: foundPath, kinds: ['wordsearch:selection']})`.
- Ignore records from the local actor.
- Draw remote in-progress cells using a deterministic actor/user color.
- CRDT-backed modes should show remote presence. Solo/history mode can show only local selection or no remote presence.

Do not change the existing whiteboard `setPresenceSelection(elementId)` path for this task unless implementation pressure reveals a shared cleanup.

## Phase 8: UI

Build `WordsearchPanel.tsx`.

Layout:

- Header with title, puzzle title, found count, undo/redo.
- 8x8 grid with stable square cells.
- Word bank below the grid.
- Compact status/error area for rejected selections or missing artifact.

Interaction:

- Pointer down starts a selection at a cell.
- Pointer enter/move updates the selection while dragging.
- Pointer up attempts commit.
- Reverse selections count.
- Horizontal, vertical, and diagonal directions count.
- Nonlinear or partial selections do nothing except clear the active selection.
- Already-found words are rejected before dispatching.

Rendering states:

- Local active selection.
- Remote active selections from presence events.
- Found word cells colored by the first finder.
- Word bank entry marked found and colored by first finder.
- Missing `"puzzle"` artifact fallback instead of crashing.

Keep CSS scoped under wordsearch class names in `examples/react-crdt/src/style.css`.

## Phase 9: Registration

Create `WordsearchApp.tsx` exports:

- `wordsearchApp`
- `wordsearchCrdtRuntime`
- `wordsearchHistoryRuntime`

Register in `examples/react-crdt/src/lib/appRegistry.ts`:

- Import app/runtime exports.
- Import `WordsearchState`.
- Add `RegisteredApp<WordsearchState>` entry.
- Attach the wordsearch artifact store/manifest to the app definition.
- Confirm app picker displays `Wordsearch`.

No server schema migration is needed for a new app. Use default server/local-first schema config unless the current registry pattern requires explicit values.

## Phase 10: Tests

Unit tests:

- Artifact manifest contains `"puzzle"` with kind/version/fingerprint.
- Server/bootstrap helpers persist artifact manifests and payloads for apps that declare them.
- A peer missing the local `"puzzle"` artifact can hydrate it from a serialized/server artifact payload.
- A PeerJS client receives and loads `"puzzle"` from the host snapshot.
- PeerJS rejects malformed or oversized artifact payloads.
- Manifest mismatch or missing server artifact produces a warning/fallback, not invalid CRDT state.
- Artifact has id `"puzzle"` and valid 8x8 board.
- Artifact words match letters on the board.
- `cellsForSelection` covers horizontal, vertical, diagonal, reverse, and nonlinear cases.
- `matchingWordIndex` accepts forward and reverse exact matches.
- `firstFinder` chooses earliest HLC and stable actor tie-break.
- Already-found logic rejects subsequent local finds.

React/UI tests where practical:

- Selecting a valid word updates CRDT state and word bank.
- Selecting the same word again does not add another local find.
- Missing artifact fallback renders.

Presence tests:

- Selection event payload validates.
- Clear event clears the actor's in-progress selection.
- Local records are ignored when rendering remote overlays.

## Phase 11: Verification

Run from `examples/react-crdt`:

```sh
pnpm build
pnpm test:e2e:smoke
```

If focused tests are added under Vitest, run the specific test files first, then the full build.

Manual smoke:

- Open the React CRDT example.
- Select Wordsearch in local simulator mode.
- Pause sync, find different words on each side, resume sync.
- Confirm both finds merge.
- Try concurrent same-word finds and confirm the UI shows one first finder while retaining loser data in state.
- Confirm remote in-progress selections appear in CRDT-backed modes through presence events.
- In server mode, confirm the persisted document metadata records the `"puzzle"` artifact manifest and payload.
- In server mode, simulate a peer without the bundled artifact and confirm it hydrates `"puzzle"` from the server payload.
- In PeerJS mode, connect a client to a host and confirm the snapshot includes the `"puzzle"` artifact payload.
- In PeerJS mode, simulate a client without the bundled artifact and confirm it hydrates `"puzzle"` from the host snapshot.
