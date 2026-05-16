# Umkehr React Example

This is a Vite app showing two CRDT-backed TODO replicas side by side. Use the center control to
pause sync, make independent edits on either side, then resume sync to exchange queued CRDT updates.

This example intentionally ignores undo/redo so the collaborative editing behavior is easier to
inspect.

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
