# Umkehr Examples

Run these examples from the repository root after building the package:

```sh
pnpm run build
node --experimental-strip-types examples/basic/index.ts
node --experimental-strip-types examples/history/index.ts
node --experimental-strip-types examples/tagged-union/index.ts
```

The React example is a small Vite app:

```sh
cd examples/react
pnpm install
pnpm dev
```

The Remix 3 example is an experimental Remix beta app and currently requires Node `>=24.3.0`:

```sh
cd examples/remix3
pnpm install
pnpm dev
```

## Examples

| Example | Shows |
| --- | --- |
| `basic` | Draft patches, realized patches, applying and inverting changes |
| `history` | History dispatch, undo, redo, branching, and jump |
| `react` | `createHistoryContext`, `useValue`, preview updates, undo, and redo |
| `react-crdt` | CRDT-backed React demo apps, including todos, whiteboard, and rich-text shared notes |
| `remix3` | Remix 3 beta client components with `umkehr/remix`, path watches, preview updates, undo, and redo |
| `tagged-union` | `$variant` with direct and callback forms |
