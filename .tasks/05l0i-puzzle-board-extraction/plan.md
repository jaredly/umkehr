# Plan: Jigsaw Board Generation Extraction

## Scope

Extract only board generation and SVG outline serialization into `src/jigsaw`.

Do not extract gameplay/collaboration code:

- placement and snapping;
- connected-component layout;
- CRDT patch helpers;
- reshuffle/border packing;
- React pointer/rendering/minimap behavior;
- app document schema/runtime wiring.

## Decisions From Research

- `src/jigsaw` should be exported publicly as `umkehr/jigsaw`.
- The core board type should be `JigsawBoard`, not `JigsawBoardArtifact`.
- `JigsawBoard` should exclude artifact-store fields: `id`, `title`, and `image`.
- The example app wrapper should add `id`, `title`, and `image`.
- Legacy artifact normalization should stay in the example artifact loader.
- Generation should support arbitrary `{rows, cols}` in addition to the current fixed piece-count presets.
- SVG debug options have no strong preference; keep the existing CLI behavior while making reusable SVG helpers flexible enough to support it.

## Phase 1: Create `src/jigsaw` Core Types

Add:

- `src/jigsaw/types.ts`
- `src/jigsaw/index.ts`

Define core exported types:

- `Coord`
- `PathSegment`
- `PieceBounds`
- `JigsawPiece`
- `JigsawSurface`
- `JigsawGenerationType`
- `JigsawPieceCount`
- `JigsawGrid`
- `JigsawBoard`
- `JigsawBoardOptions`

Recommended shape:

```ts
export type JigsawBoard = {
    imageSize: {width: number; height: number};
    pieceCount: number;
    grid: {cols: number; rows: number};
    surface?: JigsawSurface;
    pieces: JigsawPiece[];
};
```

Keep `JigsawPieceCount = 12 | 30 | 60 | 120 | 600 | 1000` as a preset convenience type, but allow arbitrary grid generation through options.

## Phase 2: Move Pure Board Generation

Add `src/jigsaw/generate.ts`.

Move pure generation code from `examples/react-crdt/src/apps/jigsaw/artifacts.ts`:

- `generateJigsawBoard(...)`
- rectangular generation;
- Voronoi generation;
- periodic Voronoi generation;
- tab generation;
- mask/bounds helpers;
- neighbor/shared-edge helpers;
- seed/random helpers;
- `gridForPieceCount(...)`
- `isJigsawPieceCount(...)`
- `isJigsawSurface(...)`

Adjust the API so callers can generate by either preset piece count or explicit grid.

Suggested API:

```ts
export function generateJigsawBoard(options?: JigsawBoardOptions): JigsawBoard;
export function generateJigsawBoard(pieceCount: JigsawPieceCount, options?: JigsawBoardOptions): JigsawBoard;
```

`JigsawBoardOptions` should support:

- `type?: 'rectangular' | 'voronoi'`;
- `surface?: 'plane' | 'torus'`;
- `tabs?: boolean`;
- `seed?: string | number`;
- `imageSize?: {width: number; height: number}`;
- `grid?: {cols: number; rows: number}`.

The old example-facing API can be preserved in the wrapper if needed.

## Phase 3: Keep Example Artifact Wrapper

Update `examples/react-crdt/src/apps/jigsaw/artifacts.ts` so it imports from `src/jigsaw` and only owns app artifact concerns:

- artifact constants;
- `JigsawBoardArtifact` wrapper type;
- `JigsawImageArtifact` and image artifact validation;
- loaded board/image module state;
- `jigsawArtifactStore`;
- `currentJigsawBoard()`;
- `currentJigsawImage()`;
- `initialJigsawArtifacts(...)`;
- legacy artifact normalization.

The wrapper should convert `JigsawBoard` into `JigsawBoardArtifact` by adding:

- `id: JIGSAW_BOARD_ARTIFACT_ID`;
- `title`;
- `image`;
- image metadata based on uploaded image options.

Preserve current serialized behavior for existing app artifacts:

- plane boards omit `surface`;
- artifact id/kind/version stay unchanged;
- old boards without `bounds` still load through the example loader.

## Phase 4: Move SVG Serialization And CLI

Add:

- `src/jigsaw/svg.ts`
- `src/jigsaw/jigsaw-board-svg.ts`

Move reusable SVG logic from `examples/react-crdt/scripts/jigsaw-board-svg.ts` into `src/jigsaw/svg.ts`:

- mask-to-SVG path serialization;
- board-to-SVG serialization;
- number formatting;
- XML escaping.

Export:

- `svgPathForMask(mask, center?)`;
- `jigsawBoardToSvg(board, options?)`.

Keep support for current script options:

- `stroke`;
- `strokeWidth`;
- `showBounds`.

Move the CLI itself into `src/jigsaw/jigsaw-board-svg.ts`:

- preserve the current usage text;
- parse JSON options;
- validate `pieceCount`;
- call `generateJigsawBoard(...)`;
- call `jigsawBoardToSvg(...)`;
- write to an output file or stdout.

Delete `examples/react-crdt/scripts/jigsaw-board-svg.ts`, unless a temporary compatibility shim is needed. If a shim is kept, it should do no generation or SVG work itself.

## Phase 5: Public Package Export

Update `package.json` exports:

```json
"./jigsaw": {
    "types": "./dist/src/jigsaw/index.d.ts",
    "import": "./dist/src/jigsaw/index.js"
}
```

If the SVG CLI should be runnable after package install, add a `bin` entry:

```json
"bin": {
    "jigsaw-board-svg": "./dist/src/jigsaw/jigsaw-board-svg.js"
}
```

Confirm the root `tsconfig.json` already includes `src/**/*.ts`, so no tsconfig include change should be needed.

The example can import from a relative source path during development if package self-import resolution is awkward, but the published API should be `umkehr/jigsaw`.

## Phase 6: Split Tests

Create `src/jigsaw/index.test.ts` for pure generation/SVG coverage.

Move or recreate these tests from `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`:

- preset rectangular board counts and grid dimensions;
- explicit arbitrary grid generation;
- plane boards defaulting to omitted `surface`;
- rectangular torus neighbors and shortest offsets;
- tabbed rectangular geometry;
- Voronoi geometry;
- uploaded/custom `imageSize` generation without image artifact metadata;
- tabbed Voronoi geometry;
- periodic Voronoi torus geometry;
- seeded reproducibility;
- reciprocal neighbor offsets;
- `isJigsawPieceCount(...)`;
- `isJigsawSurface(...)`;
- SVG path and board serialization.
- CLI option parsing/output smoke coverage if practical; otherwise verify the CLI through a direct command in the implementation log.

Keep these in the example tests:

- artifact store manifest/serialize/load;
- image artifact validation;
- `initialJigsawArtifacts(...)`;
- `jigsawApp.documentInit` validation;
- all gameplay, placement, snapping, layout, packing, torus interaction, and UI tests.

## Phase 7: Verification

Run focused checks:

```sh
npm exec vitest -- run src/jigsaw
npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts
npm run typecheck
```

If package exports were changed, also run:

```sh
npm run build
node dist/src/jigsaw/jigsaw-board-svg.js '{"pieceCount":12,"tabs":true}' /tmp/jigsaw.svg
npm --cache /tmp/umkehr-npm-cache pack --dry-run
```

## Acceptance Criteria

- `src/jigsaw/index.ts` exports only board generation, board types, validation helpers, and SVG serialization helpers.
- `src/jigsaw` has no imports from React, typia, example app code, `umkehr`, or browser DOM APIs.
- `umkehr/jigsaw` is available through `package.json` exports.
- `JigsawBoard` excludes artifact wrapper fields: `id`, `title`, and `image`.
- The example app still serializes compatible `jigsaw-board` artifacts through its wrapper.
- The SVG generator CLI source lives in `src/jigsaw`.
- The installed package can expose `jigsaw-board-svg` via `bin` if desired.
- Arbitrary `{cols, rows}` board generation is covered by tests.
- Existing example jigsaw behavior remains unchanged.
