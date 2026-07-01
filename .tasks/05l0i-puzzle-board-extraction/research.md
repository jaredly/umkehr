# Research: Jigsaw Board Generation Extraction

## Goal

Extract only the jigsaw board and piece generation code from `examples/react-crdt` into a standalone library under `src/jigsaw`, along with the SVG board-outline generator script.

This should not include gameplay or collaboration logic. Placement, snapping, connected components, CRDT patches, reshuffle packing, torus drag behavior, React rendering, and minimap behavior should stay in `examples/react-crdt`.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/scripts/jigsaw-board-svg.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `package.json`

The board generation code currently lives inside `artifacts.ts`, mixed with example-specific artifact store state. The SVG generator script imports generation directly from that example file:

```ts
import {
    generateJigsawBoard,
    isJigsawPieceCount,
    type JigsawBoardOptions,
    type JigsawPieceCount,
    type PathSegment,
} from '../src/apps/jigsaw/artifacts';
```

The extraction target is the pure part of `artifacts.ts`: board types, board options, board generation, board validation/normalization helpers that are intrinsic to generated boards, and SVG serialization helpers currently embedded in `jigsaw-board-svg.ts`.

## Board Generation Surface

The core serializable board model in `artifacts.ts` is:

```ts
export type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};

export type JigsawPieceCount = 12 | 30 | 60 | 120 | 600 | 1000;
export type JigsawGenerationType = 'rectangular' | 'voronoi';
export type JigsawSurface = 'plane' | 'torus';

export type JigsawPiece = {
    center: Coord;
    bounds: PieceBounds;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: JigsawImageRef;
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    surface?: JigsawSurface;
    pieces: JigsawPiece[];
};
```

The generation path supports:

- fixed piece counts: `12`, `30`, `60`, `120`, `600`, `1000`;
- rectangular grids through `generateRectangularJigsawBoard(...)`;
- perturbed-site Voronoi boards through `generateVoronoiJigsawBoard(...)`;
- optional tabs/holes for rectangular and Voronoi boards;
- deterministic seeded randomness;
- plane boards by default;
- torus boards, including rectangular seam neighbors and periodic Voronoi cells;
- custom image size/name options for uploaded-image boards;
- board normalization for legacy pieces without `bounds`.

## What Should Move To `src/jigsaw`

Recommended files:

- `src/jigsaw/types.ts`
- `src/jigsaw/generate.ts`
- `src/jigsaw/svg.ts`
- `src/jigsaw/jigsaw-board-svg.ts`
- `src/jigsaw/index.ts`
- `src/jigsaw/index.test.ts`

Core exports:

- `Coord`
- `PathSegment`
- `PieceBounds`
- `JigsawPiece`
- `JigsawPieceCount`
- `JigsawGenerationType`
- `JigsawSurface`
- `JigsawBoardOptions`
- `JigsawBoard`
- `generateJigsawBoard(...)`
- `gridForPieceCount(...)`
- `isJigsawPieceCount(...)`
- `isJigsawSurface(...)`
- `svgPathForMask(...)`
- `jigsawBoardToSvg(...)`

The pure generator should not import React, typia, `umkehr`, CRDT app types, or browser DOM APIs.

## What Should Stay In `examples/react-crdt`

Keep the example-specific artifact and app wiring in place:

- `JIGSAW_BOARD_ARTIFACT_ID`, `JIGSAW_BOARD_KIND`, `JIGSAW_BOARD_VERSION`;
- `JIGSAW_IMAGE_ARTIFACT_ID`, `JIGSAW_IMAGE_KIND`, `JIGSAW_IMAGE_VERSION`;
- `JIGSAW_ARTIFACT_IMAGE_REF` if it remains tied to example artifact storage;
- `jigsawArtifactStore`;
- `currentJigsawBoard()` and `currentJigsawImage()`;
- `initialJigsawArtifacts(...)` returning `SerializedArtifact[]`;
- uploaded image artifact validation and serialization;
- document creation UI in `JigsawApp.tsx`;
- all gameplay/layout code in `jigsaw.ts` and `jigsawPacking.ts`;
- all rendering and pointer interaction code in `JigsawPanel.tsx` and `JigsawMinimap.tsx`;
- `schema.ts` app document state and typia validation.

The example `artifacts.ts` can become a thin wrapper around `src/jigsaw` generation plus example artifact-store behavior.

## SVG Generator

`examples/react-crdt/scripts/jigsaw-board-svg.ts` currently contains both CLI handling and reusable SVG conversion:

- CLI argument parsing;
- output file/stdout handling;
- `boardToSvg(...)`;
- `svgPathForMask(...)`;
- `point(...)`;
- number formatting;
- XML escaping.

Move the reusable conversion pieces into `src/jigsaw/svg.ts`. Move the CLI itself into `src/jigsaw/jigsaw-board-svg.ts`, so the script is part of the library source rather than the example app.

The library-owned CLI should import from local jigsaw modules:

```ts
import {
    generateJigsawBoard,
    isJigsawPieceCount,
    jigsawBoardToSvg,
    type JigsawBoardOptions,
    type JigsawPieceCount,
} from './index.js';
```

The old `examples/react-crdt/scripts/jigsaw-board-svg.ts` can be deleted, or replaced with a tiny compatibility shim only if existing local workflows still call that path.

## Proposed Migration Plan

1. Create `src/jigsaw/types.ts` and move `Coord` plus board-generation types into it.
2. Create `src/jigsaw/generate.ts` and move the pure generation implementation from `artifacts.ts`.
3. Create `src/jigsaw/svg.ts` and move reusable SVG serialization from `jigsaw-board-svg.ts`.
4. Move the SVG CLI to `src/jigsaw/jigsaw-board-svg.ts`.
5. Delete `examples/react-crdt/scripts/jigsaw-board-svg.ts`, or leave only a compatibility shim.
6. Create `src/jigsaw/index.ts` that re-exports generation and SVG helpers.
7. Update `examples/react-crdt/src/apps/jigsaw/artifacts.ts` to import the generator/types from `src/jigsaw`.
8. Move board-generation tests out of `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts` into `src/jigsaw/index.test.ts`.
9. Leave app artifact-store and document-init tests in the example test file.
10. Add `./jigsaw` to `package.json` exports.
11. Add a package `bin` entry for the generated SVG CLI if this should be runnable from installed packages.

## Tests To Move Or Keep

Move to `src/jigsaw/index.test.ts`:

- rectangular board count/grid tests;
- plane/torus board generation tests;
- rectangular and Voronoi uploaded image-size generation tests;
- tabbed rectangular and tabbed Voronoi geometry tests;
- periodic Voronoi torus generation tests;
- seeded reproducibility tests;
- reciprocal neighbor offset tests;
- `isJigsawPieceCount(...)` and `isJigsawSurface(...)` tests;
- SVG path/board serialization tests added for the extracted SVG helpers.

Keep in the example test file:

- `jigsawArtifactStore` manifest/serialize/load tests;
- uploaded image artifact tests;
- `initialJigsawArtifacts(...)` tests;
- document creation validation tests through `jigsawApp.documentInit`;
- all placement, snapping, layout, packing, torus interaction, and app UI tests.

## Compatibility Notes

- Existing serialized app artifacts use `id: 'board'`, `kind: 'jigsaw-board'`, and `version: 1`. These are example artifact-store concerns, not necessarily core generator concerns.
- `JigsawBoardArtifact.image` currently uses `'stock:hue' | 'artifact:image'`. The core generator can either keep a generic `image` field for compatibility or expose a pure board geometry type and let the example add image metadata.
- Plane boards currently omit `surface` when serialized. If artifact fingerprints need to remain stable, preserve that behavior in the example wrapper.
- Legacy board normalization without `bounds` is currently in `artifacts.ts`. Decide whether that remains example artifact compatibility or moves into `src/jigsaw` as `normalizeJigsawBoard(...)`.

## Open Questions

1. Should `src/jigsaw` be exported as public `umkehr/jigsaw`, or should it initially be internal source used by the example and script?
    - yes
2. Should the core type be named `JigsawBoard` and exclude artifact-store fields, or should it keep the current `JigsawBoardArtifact` shape for minimal churn?
    - let's exclude artifact fields
3. Should `image`, `id`, and `title` be generated by the core library or added by the example wrapper?
    - added by the wrapper
4. Should legacy artifact normalization move into `src/jigsaw`, or stay in the example artifact loader?
    - stay in the loader
5. Should `jigsawBoardToSvg(...)` support debug options such as `showBounds`, stroke color, and stroke width, or should those remain CLI-only options?
    - no opinion
6. Should generation support arbitrary rows/cols later, or is the fixed `JigsawPieceCount` union part of the library API?
    - yes, arbitrary rows/cols

## Suggested First Acceptance Criteria

- `src/jigsaw/index.ts` exports board generation and SVG helpers only.
- `src/jigsaw` has no imports from React, typia, app code, `umkehr`, or browser DOM APIs.
- The SVG generator CLI lives under `src/jigsaw`.
- The example jigsaw app behavior is unchanged.
- Root jigsaw generation tests pass with `npm exec vitest -- run src/jigsaw`.
- Existing example jigsaw tests still pass for app-specific behavior.
