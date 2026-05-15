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

## Examples

| Example | Shows |
| --- | --- |
| `basic` | Draft patches, realized patches, applying and inverting changes |
| `history` | History dispatch, undo, redo, branching, and jump |
| `react` | `createHistoryContext`, `useValue`, preview updates, undo, and redo |
| `tagged-union` | `$variant` with direct and callback forms |
