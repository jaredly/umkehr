# Umkehr React CRDT Example

This is a Vite app showing CRDT-backed example apps, including todos, a whiteboard, and a
rich-text shared notes app. Use the app picker to switch examples. In the local simulator mode,
use the center control to pause sync, make independent edits on either side, then resume sync to
exchange queued CRDT updates.

Each replica host has its own CRDT document, HLC clock, and retained CRDT update log. Local undo/redo
is derived from command metadata on the retained updates. The center transport only routes or queues
CRDT updates; it does not know how edits are produced or applied.

From this directory:

```sh
pnpm install
pnpm dev
```

The server-backed offline-first mode also needs the Bun server in a second
terminal:

```sh
cd ../react-crdt-server
bun install
bun run dev
```

Then open the React example and choose the Server tab. The client connects to
`ws://localhost:8787/sync`, asks for a nickname login backed by the example
server, persists the returned user id and local changes in IndexedDB, and can
be toggled offline from the demo controls. Logging out clears only the local
user id; the document replica remains in browser storage.

The example depends on the repository root through `file:../..`, so build the package first when
you are running it from a fresh checkout:

```sh
cd ../..
pnpm run build
```

## Playwright E2E

From `examples/react-crdt`:

```sh
pnpm test:e2e:smoke
pnpm test:e2e:server
pnpm test:e2e:peerjs
pnpm test:e2e:local-first
pnpm test:e2e:demo
```

`test:e2e:smoke` is the critical local UI subset. The server, PeerJS, and
local-first scripts cover heavier sync paths. `test:e2e:demo` uses
`playwright.demo.config.ts`, records videos, and writes artifacts under
`test-results`.

Recent local runtimes on this machine:

- smoke: about 1.1m
- server: about 2.5m
- PeerJS: about 20s
- local-first: about 29s
- demo: about 32s
