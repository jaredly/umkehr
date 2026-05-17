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

The example depends on the repository root through `file:../..`, so build the package first when
you are running it from a fresh checkout:

```sh
cd ../..
pnpm run build
```
