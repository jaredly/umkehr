# Research: Jigsaw Tabs Board Mode

## Goal

Add a board-generation option for `examples/react-crdt` jigsaw puzzles that looks more like physical jigsaw pieces. The proposed geometry starts from the existing perturbed grid / Voronoi construction, computes straight Voronoi cell edges, places a tab center dot at each shared edge midpoint, assigns each dot the largest non-overlapping circle radius possible, and replaces the shared straight edge with a simple `line -> semicircle -> line` profile. The tab direction is randomized per shared edge so one neighboring piece gets an outward tab and the other gets the matching inward socket.

The task also raises the possibility that tabs should be a board creation checkbox, not a separate board layout, so the same tab-generation pass can apply to both rectangular and Voronoi layouts.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

The jigsaw app stores board geometry as an artifact. `generateJigsawBoard(pieceCount, options)` currently supports two generation types:

- `rectangular`
- `voronoi`

`JigsawGenerationType` is currently:

```ts
export type JigsawGenerationType = 'rectangular' | 'voronoi';
```

Board creation exposes this as a `Board type` select in `JigsawApp.tsx`.

Each generated piece has:

```ts
export type JigsawPiece = {
    center: Coord;
    bounds: PieceBounds;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};
```

The `mask` is in piece-local coordinates relative to `center`. `bounds` is also in piece-local coordinates and is used for DOM placement, canvas size, collision estimates, and source-image cropping. Neighbor offsets are center-to-center offsets used for snapping and connected-component layout. The visual shape is currently only the `mask`; snap logic does not need actual edge curves as long as `neighbors` and offsets remain correct.

The renderer already supports curved path segments:

```ts
export type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};
```

`JigsawPanel.tsx` clips each piece canvas with `drawMaskPath`, which supports `Line`, `Quadratic`, and `Cubic`. `JigsawMinimap.tsx` also converts these same mask segment types to SVG paths. This means tabbed pieces can be implemented by generating better masks; the rendering pipeline should not need a new primitive.

## Existing Geometry

Rectangular boards:

- `generateRectangularJigsawBoard` derives a regular grid from `gridForPieceCount`.
- Each piece center is the rectangle center.
- Each mask is a four-segment rectangle from `rectangleMask`.
- Neighbors are the four grid-adjacent cells with center offsets.

Voronoi boards:

- `generateVoronoiJigsawBoard` starts from the same grid dimensions.
- It creates one perturbed site per grid cell using `signedPerturbation`.
- `voronoiCell` clips the image rectangle against nearby sites.
- `neighborsForPolygons` finds shared edges by checking segment overlap.
- Each piece mask is currently just the straight polygon via `polygonToMask`.

Important implementation detail: Voronoi neighbor detection currently throws away exact edge metadata. It only records `{piece, offset}` after `polygonsShareEdge` returns true. A tab-generation pass needs the actual shared edge endpoints, so the Voronoi builder should likely compute reusable edge records instead of rediscovering edges later.

## Proposed Model

The least disruptive path is to keep the artifact schema shape unchanged and generate tabbed `mask`/`bounds` values during board creation. No CRDT state migration is needed if board artifacts remain version 1-compatible at the TypeScript shape level. Existing artifact validation already permits `Line`, `Quadratic`, and `Cubic` segments.

Suggested internal geometry types:

```ts
type PiecePolygon = Coord[];

type SharedEdge = {
    a: number;
    b: number;
    start: Coord;
    end: Coord;
};

type TabSpec = {
    edgeKey: string;
    center: Coord;
    radius: number;
    outwardPiece: number;
};
```

`SharedEdge.start/end` should be image-space points on the original straight edge. The same edge must be used when building both pieces so the tab and socket are exact complements.

## Tab Geometry Approach

For each shared edge:

1. Compute midpoint `m = (start + end) / 2`.
2. Compute edge length `L`.
3. Compute radius as the largest circle around `m` that does not overlap any other tab-center dot, minus a small margin.
4. Clamp the radius so it also fits along the edge, for example `radius <= L * 0.32` or similar. This avoids a semicircle that consumes nearly the whole edge.
5. Skip tabs for very short edges when the resulting radius is below a visual minimum.
6. Randomly choose which side is outward using a deterministic RNG keyed by board seed / edge key.
7. Replace the edge section from `m - r * tangent` to `m + r * tangent` with a semicircle whose bulge is along the edge normal.

For the path representation, use two cubic Beziers for the semicircle. A true semicircle can be approximated with kappa:

```ts
const k = 0.5522847498307936;
```

For an edge traversed from `p0` to `p1`:

- `tangent = normalize(p1 - p0)`
- `normal = perpendicular(tangent)`
- `tabStart = m - tangent * r`
- `tabEnd = m + tangent * r`
- `apex = m + normal * direction * r`

The segment sequence can be:

- line to `tabStart`
- cubic from `tabStart` to `apex`
- cubic from `apex` to `tabEnd`
- line to the original edge end

The control points for the two cubic arcs should be based on tangent and normal. The sibling piece traverses the same edge in reverse and should use the opposite `direction`, producing the complementary socket/tab.

## Radius Computation

The task description says "largest circle possible from each dot, without it overlapping any other dots (with some small margin)." A practical implementation:

```ts
radius(edge) = min(
    edge.length * edgeRadiusCap,
    ...otherEdges.map(other => distance(edge.center, other.center) / 2 - margin),
)
```

Then clamp:

```ts
radius = Math.max(0, Math.min(radius, maxReasonableRadius));
if (radius < minTabRadius) render the edge straight.
```

This avoids tab centers colliding with each other, but does not mathematically guarantee a tab will not leave the image boundary or intrude into non-neighbor cells on highly irregular Voronoi cells. For this first version, that may be acceptable if radius caps and minimum edge length filtering are conservative.

Potential constants should scale from the average piece size:

- dot margin: maybe `min(avgWidth, avgHeight) * 0.04`
- minimum tab radius: maybe `min(avgWidth, avgHeight) * 0.06`
- edge cap: maybe `edge.length * 0.28` to `0.34`

## Rectangular Boards

The same tab pass can apply to rectangles if rectangular generation first emits polygon cells and shared edge records:

- Each rectangular cell polygon is four image-space corners.
- Shared edges are the grid-internal vertical and horizontal boundaries.
- Border edges should remain straight.
- Centers and neighbor offsets remain the same as today unless bounds expansion changes `center`; preferably keep centers unchanged.

This supports the task’s "tabs checkbox" idea without creating a separate `rectangular-tabs` board type.

## UI Options

Two likely UI designs:

1. Add a third board type, e.g. `Jigsaw` or `Tabbed Voronoi`.
2. Add a `Tabs` checkbox that applies to the selected board type.

The checkbox is probably more flexible and matches the task note. It requires extending document-init params:

```ts
type JigsawDocumentInitParams = {
    pieceCount: JigsawPieceCount;
    type: JigsawGenerationType;
    tabs?: boolean;
    image?: JigsawImageArtifact;
    imageStatus?: JigsawImageStatus;
    imageError?: string;
};
```

`JigsawBoardOptions` can then include `tabs?: boolean`.

Potential title naming:

- `30 piece tabbed hue puzzle`
- `30 piece tabbed Voronoi hue puzzle`

## Bounds And Cropping

Tabbed pieces can extend beyond their original polygon or rectangle. `boundsForPolygon` must therefore run over the final path geometry, not only the original polygon vertices. For cubic masks, bounds can be conservatively computed from all path endpoints and controls, or simpler: include the original polygon plus `center +/- radius` for each tab touching the piece.

This matters because `PieceCanvas` crops the source image with:

```ts
sourceX = pieceCenter.x + bounds.left;
sourceY = pieceCenter.y + bounds.top;
context.drawImage(source, sourceX, sourceY, bounds.width, bounds.height, ...)
```

If tabs extend outside the original image rectangle, cropping from negative source coordinates can occur on border tabs. Border edges should remain straight, so the only expected extension is into neighboring piece space inside the image bounds. Still, Voronoi edge tabs near the outside border may cause a piece's bounds to include negative `left/top` only if an internal edge tab points toward the image boundary close to the outer border. Canvas `drawImage` may handle this poorly in some browsers, so tests and visual QA should check edge pieces.

## Determinism Concern

Current Voronoi board generation uses `Math.random()` inside `signedPerturbation`, so geometry is not deterministic across board creation runs. That is already true today, but tab direction coin flips should not add additional accidental instability within a single board generation path.

Best option: introduce a small deterministic PRNG used for both site perturbation and tab direction, seeded from `pieceCount`, `type`, image size, and maybe a generated creation seed. If changing existing Voronoi determinism is out of scope, at least use the same `Math.random()` generation pass consistently and store only the final artifact.

## Test Targets

Add focused tests in `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`:

- Generates tabbed Voronoi board geometry with at least one `Cubic` or `Quadratic` segment.
- Generates tabbed rectangular board geometry if the checkbox approach is chosen.
- Every piece has finite center/bounds, positive bounds, and valid masks.
- Neighbor relationships remain reciprocal.
- Total mask area for a tabbed board remains close to image area. This should still hold if every tab and socket are exact complements.
- Board creation validation accepts `tabs: true` and defaults it predictably when omitted.
- Artifact load/serialize still accepts tabbed masks.
- Unplaced-piece arrangement works for tabbed boards without bounding-box overlap for at least 30 pieces.

The existing `totalMaskArea` helper only handles straight polygon endpoints and will be wrong for cubic semicircles. It either needs to be skipped for curved masks or replaced with approximate path sampling for curved segments.

## Implementation Plan

1. Refactor board generation in `artifacts.ts` so rectangular and Voronoi builders can emit image-space polygons plus shared edge records.
2. Add `tabs?: boolean` to board options and document-init params.
3. Add a `Tabs` checkbox in the create-document fields, disabled during image processing like the other inputs.
4. Build tab specs from shared edges: midpoint, radius, direction, and outward piece.
5. Convert each piece polygon into a mask by walking edges and inserting line/semicircle/line segments for edges with tab specs.
6. Compute final bounds from the generated path geometry.
7. Preserve existing centers and neighbor offsets so snapping and connected-component layout continue to work.
8. Update tests for tabbed board generation, validation, serialization, and layout.
9. Run unit tests for the jigsaw app and do a browser smoke check of rectangular-tabs and Voronoi-tabs boards.

## Open Questions

- Should `tabs` be a checkbox that applies to both rectangular and Voronoi boards, or should this ship first as a separate `jigsaw` / `tabbed-voronoi` board type?
    - yeah let's have it apply to both
- Should tab generation use deterministic seeded randomness, or is storing the final generated artifact enough for this example?
    - definitely not deterministic
- What margin and radius caps look best across 12, 30, 60, 120, and 600 piece boards?
    - let's go with min(board width / grid width, board height / grid height) / 10
- Should very short Voronoi edges remain straight, or should every shared edge get some tab even if tiny?
    - yeah they can remain straight
- Should tab direction be purely random, or should it avoid visually awkward patterns such as one piece having all tabs outward?
    - random
- Is exact area preservation important enough to implement curved-path area sampling in tests, or is geometry validity plus visual QA enough?
    - geometric validity is fine
- Should the minimap show the exact tabbed curves, or would a simplified polygon preview be acceptable if performance becomes a problem on 600-piece boards?
    - we can do simplified polygon for preview
