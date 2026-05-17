# Umkehr Remix 3 Example

This is an experimental Remix 3 beta app showing `umkehr/remix` with Remix client components,
setup-phase `.watch(...)` subscriptions, preview updates, localStorage persistence, undo, and redo.

From the repository root, build the package first:

```sh
pnpm run build
```

Then run the example:

```sh
cd examples/remix3
pnpm install
pnpm dev
```

Remix 3 beta currently requires Node `>=24.3.0`. The first pass intentionally omits the history tree
visualizer from `examples/react`; it focuses on the client component update model.
