# Plan: Static PeerJS Wordsearch Demo Build

## Decisions From Research

- Build output goes to a separate directory, not the normal `dist`.
- The dedicated demo should not render the existing app/mode top bar.
- Use PeerJS public defaults by leaving `VITE_UMKEHR_PEERJS_*` unset for this build.
- Do not include the document manager/import/export UI.
- Include a `New game` action that discards the current local document and creates a fresh one.
- Invite URLs only need to carry the host peer id.
- Build-only verification is enough for now.

## Phase 1: Add Dedicated Static Build Entrypoint

Create a new entrypoint under `examples/react-crdt/src`, for example:

- `src/wordsearch-peerjs-main.tsx`

This entrypoint should:

- import `createRoot`
- import global `style.css`
- import `wordsearchApp` and `wordsearchCrdtRuntime`
- render a dedicated PeerJS Wordsearch shell component
- avoid importing `src/App.tsx` and `src/lib/appRegistry.ts`

Create a dedicated HTML input, for example:

- `wordsearch-peerjs.html`

This file should mirror `index.html` structurally, but use:

- a title such as `Umkehr Wordsearch`
- `<script type="module" src="/src/wordsearch-peerjs-main.tsx"></script>`

## Phase 2: Build a Slim PeerJS Wordsearch Shell

Implement a new shell component, likely near the entrypoint or under `src/apps/wordsearch`, for example:

- `src/apps/wordsearch/WordsearchPeerJsDemo.tsx`

The shell should reuse the core PeerJS and CRDT pieces already in the app:

- `usePeerJsSync`
- `PeerJsControls`
- `wordsearchApp`
- `wordsearchCrdtRuntime.Provider`
- `wordsearchCrdtRuntime.useEditorContext`
- `createInitialCrdtHistory`
- `schemaFingerprintHash` if local persistence remains schema-tagged
- artifact helpers if needed by the Wordsearch app

The shell should not use:

- `PeerJsApp`, if avoiding document manager and top bar would require too much conditional behavior
- `DemoTopBar`
- `DocumentManagerModal`
- `appRegistry`
- full-mode URL selection

Expected behavior:

- Default role is `host` unless `?peer=<id>` is present.
- If `?peer=<id>` is present, default role is `client` and auto-connect when PeerJS is ready.
- Host renders `Host Wordsearch`.
- Client renders `Client Wordsearch` after receiving a snapshot.
- Client shows a waiting panel before the snapshot arrives.
- Host and client both keep the existing `PeerJsControls` unless a smaller control surface is needed later.
- Invite URLs generated in this dedicated build include only the peer id, for example `?peer=<hostPeerId>`.

Implementation note: `PeerJsControls` currently owns invite URL creation and writes `doc` plus `hash = 'peerjs'`. To satisfy the dedicated URL requirement cleanly, update `PeerJsControls` to accept an optional invite URL factory or invite URL override:

```ts
createInviteUrl?: (peerId: string, docId: string) => string;
```

The existing full demo can keep the current behavior as the default. The dedicated shell can pass a factory that returns the current path with only `peer`.

## Phase 3: Local Document Lifecycle and New Game

The dedicated build should not expose document management. It still needs a host-side document lifecycle so refreshes and live edits work predictably.

Use one of these implementation options:

1. Simplest: keep the current document only in React state. `New game` replaces host history with `createInitialCrdtHistory(wordsearchApp)` and calls `sync.setSnapshotDocument(next.doc)`.

2. Slightly more durable: persist one dedicated Wordsearch PeerJS document in IndexedDB using the existing peer persistence helpers, but do not expose a picker/import/export UI. `New game` overwrites that one document.

Prefer option 1 unless refresh persistence is considered necessary. The user asked for static build and a `New game` reset, not document storage.

`New game` should:

- be visible to hosts
- create a fresh CRDT local history
- reset any Wordsearch artifacts if the app uses them
- update the host snapshot document
- cause future clients to receive the new snapshot
- preferably make existing connected clients receive the reset as a normal sync event or reconnect/snapshot path

Important check: `usePeerJsSync` sends snapshots to newly opened connections, but `setSnapshotDocument` alone does not broadcast a fresh snapshot to existing clients. If `New game` must reset already-connected clients immediately, the shell may need either:

- a remount/key reset of the provider plus a reconnect instruction, or
- an explicit reset operation represented as CRDT updates, if the model supports replacing state through the runtime, or
- a small extension to PeerJS sync to broadcast a new snapshot to current connections.

Document this choice in the implementation log when coding.

## Phase 4: Add Alternate Vite Config and Script

Add:

- `examples/react-crdt/vite.wordsearch-peerjs.config.ts`

Use the same Typia plugin as the main config. Configure:

- `build.outDir`, likely `dist-wordsearch-peerjs`
- `build.rollupOptions.input` pointing at `wordsearch-peerjs.html`
- no PeerJS env overrides, so public PeerJS defaults are used

Add a script to `examples/react-crdt/package.json`:

```json
"build:wordsearch-peerjs": "tsc -p tsconfig.json --noEmit && vite build --configLoader runner --config vite.wordsearch-peerjs.config.ts"
```

Do not change the existing `build`, `dev`, or e2e scripts.

## Phase 5: Style the Dedicated Shell

Reuse existing CSS where practical, especially:

- `.peerShell`
- `.peerControls`
- Wordsearch panel styles
- waiting panel styles

Add only targeted styles if the absence of `DemoTopBar` leaves awkward spacing. The first screen should be the usable Wordsearch PeerJS demo, not a landing page or explanation page.

The dedicated shell should include concise controls only:

- PeerJS role/connect/status controls
- host-only `New game` button
- Wordsearch board

Avoid adding large instructional copy.

## Phase 6: Build Verification

Run:

```sh
cd examples/react-crdt
pnpm build:wordsearch-peerjs
```

Expected result:

- TypeScript passes.
- Vite writes the dedicated static build to `dist-wordsearch-peerjs`.
- Build succeeds without PeerJS environment variables.

Optional sanity checks after build:

```sh
rg "Todos|Whiteboard|Rich Notes|Block Notes" dist-wordsearch-peerjs
```

The ideal result is no obvious references to unrelated demos. Some shared CSS class names may still appear if the global stylesheet is bundled wholesale; that is acceptable for this phase as long as app code is isolated.

## Phase 7: Documentation Notes

Update docs only if there is an existing natural place, likely `examples/react-crdt/README.md`.

Mention:

- `pnpm build:wordsearch-peerjs`
- output directory: `dist-wordsearch-peerjs`
- the build uses PeerJS public defaults unless environment variables are supplied

Keep this brief. The core deliverable is the static build path, not new user-facing documentation.
