# Implementation Log: Jigsaw Board Generation Extraction

## Phase 0: Setup And Inspection

- Started from `research.md` and `plan.md`.
- Confirmed the requested scope is board generation plus SVG CLI only.
- Confirmed `examples/react-crdt/package.json` has `jigsaw:svg` pointing at `scripts/jigsaw-board-svg.ts`.
- Confirmed `examples/react-crdt/tsconfig.json` does not yet map `umkehr/jigsaw`.
- Found generation is still mixed with artifact-store state in `examples/react-crdt/src/apps/jigsaw/artifacts.ts`.

## Phase 1-5: Library Extraction And Wiring

- Added `src/jigsaw/types.ts` for pure board-generation types.
- Added `src/jigsaw/generate.ts` by moving the pure generation code out of the example artifact module.
- Added arbitrary `grid: {cols, rows}` support while keeping preset `JigsawPieceCount` generation.
- Added `src/jigsaw/svg.ts` for reusable board-to-SVG serialization.
- Moved the SVG CLI source to `src/jigsaw/jigsaw-board-svg.ts`.
- Added `src/jigsaw/index.ts` and exported it as public `umkehr/jigsaw` in `package.json`.
- Added a `jigsaw-board-svg` package `bin` entry.
- Updated `examples/react-crdt/src/apps/jigsaw/artifacts.ts` to act as an artifact wrapper around the new core generator.
- Updated `examples/react-crdt/package.json` so `jigsaw:svg` runs the library-owned CLI.
- Deleted the old `examples/react-crdt/scripts/jigsaw-board-svg.ts`.
- Added `umkehr/jigsaw` to the example TypeScript path map.

Issues/workarounds:

- The first wrapper draft accidentally kept the core `grid` field in serialized app artifacts. Fixed by explicitly stripping `grid` in `boardArtifactFromCore(...)`.
- The core library now returns pure `JigsawBoard`; the example wrapper preserves app artifact fields and legacy loading.
- Root Vitest did not resolve the new `umkehr/jigsaw` export before build, because the package export points at `dist`. Workaround: the example wrapper imports the source library through a relative path for local dev/test reliability, while `package.json` still publishes `umkehr/jigsaw`.

## Phase 6: Tests

- Added `src/jigsaw/index.test.ts`.
- Covered preset rectangular boards, arbitrary grids, torus neighbors, tabbed boards, Voronoi boards, periodic Voronoi torus boards, seeded reproducibility, piece-count validation, and SVG serialization.
- Kept existing example jigsaw tests in place for app wrapper, artifact store, document init, gameplay, packing, and UI-adjacent behavior.

## Phase 7: Verification

Commands run:

```sh
npm exec tsc -- -p tsconfig.json --noEmit
npm exec tsc -- -p examples/react-crdt/tsconfig.json --noEmit
npm exec vitest -- run src/jigsaw
npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts
bun src/jigsaw/jigsaw-board-svg.ts '{"pieceCount":12,"tabs":true,"seed":"smoke"}' /tmp/jigsaw.svg
npm run jigsaw:svg -- '{"pieceCount":12}' /tmp/jigsaw-example-script.svg # from examples/react-crdt
npm run build
node dist/src/jigsaw/jigsaw-board-svg.js '{"pieceCount":12,"tabs":true}' /tmp/jigsaw-built.svg
npm --cache /tmp/umkehr-npm-cache pack --dry-run
```

Results:

- Root typecheck passed.
- Example typecheck passed.
- `src/jigsaw` tests passed: 16 tests.
- Existing example jigsaw tests passed: 67 tests.
- Source CLI wrote `/tmp/jigsaw.svg`.
- Example `jigsaw:svg` script wrote `/tmp/jigsaw-example-script.svg`.
- Built CLI wrote `/tmp/jigsaw-built.svg`.
- Full build passed.
- Package dry-run passed and included `dist/src/jigsaw/*`.

Issues/workarounds:

- I initially ran `npm exec tsc -p tsconfig.json --noEmit`, which `npm exec` parsed incorrectly. Reran with `npm exec tsc -- -p tsconfig.json --noEmit`.
- `npm run jigsaw:svg` printed `Error connecting to agent: Operation not permitted` from the environment/Bun, but exited 0 and wrote the SVG file.
