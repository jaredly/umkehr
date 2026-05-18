# Umkehr React Example

This is a Vite app showing two CRDT-backed TODO replicas side by side. Use the center control to
pause sync, make independent edits on either side, then resume sync to exchange queued CRDT updates.

Each replica host has its own CRDT document, HLC clock, and local undo/redo stack. The center
transport only routes or queues CRDT updates; it does not know how edits are produced or applied.
Remote updates sync into the document but do not enter local history.

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
