# Research: Voronoi Jigsaw Board Type

## Goal

Add a `voronoi` board type to `examples/react-crdt`'s jigsaw app. The new board should be more visually interesting than the current rectangular grid by:

- Generating a grid of seed points.
- Randomly perturbing each point by a distance between `0.25 * d` and `0.5 * d`, where `d` is the grid cell size.
- Building puzzle tiles from the Voronoi partition of the image board.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/model.ts`
- `examples/react-crdt/src/style.css`

The jigsaw board is stored as an artifact, not as CRDT document state. The CRDT state only stores:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

The current artifact type is:

```ts
export type JigsawPiece = {
    center: Coord;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: 'stock:hue';
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    pieces: JigsawPiece[];
};
```

`generateJigsawBoard(pieceCount)` currently uses `gridForPieceCount(pieceCount)`, creates one rectangular piece per grid cell, and uses four-way grid adjacency for neighbors. Each piece has:

- `center`: the piece's solved image-space center.
- `mask`: a local path centered around `center`.
- `neighbors`: physical neighbors plus the solved offset from this center to the neighbor's center.

Most placement logic is already shape-agnostic. `validConnections`, `positionsForComponent`, `buildPuzzleLayout`, and `snapCandidates` only need neighbor lists and offsets. A Voronoi board can fit the current runtime if each generated cell provides a center, polygon mask, and reciprocal neighbors.

## Rendering Constraints

`JigsawPanel.tsx` renders every piece as a fixed-size button containing a canvas. `PieceCanvas` clips with `piece.mask`, then draws a rectangular crop from the stock hue image:

```ts
const sourceX = pieceCenter.x - pieceSize.width / 2;
const sourceY = pieceCenter.y - pieceSize.height / 2;
context.drawImage(source, sourceX, sourceY, pieceSize.width, pieceSize.height, 0, 0, canvas.width, canvas.height);
```

`pieceSize` is currently estimated from `pieceCount` grid dimensions, and CSS sets `.jigsawPiece { overflow: hidden; }`.

This works for rectangles because every mask fits exactly inside the inferred grid-cell-sized canvas. Voronoi cells will have variable bounding boxes and can extend beyond a uniform cell box after point perturbation. If the existing fixed-size crop remains unchanged, edge cells may be clipped incorrectly or show the wrong image crop.

The cleanest compatible artifact shape is to add per-piece bounds:

```ts
export type JigsawPiece = {
    center: Coord;
    bounds: {left: number; top: number; width: number; height: number};
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};
```

Then rendering can size each button and canvas from `piece.bounds`, position the button at `position + bounds.left/top` relative to the center, and draw the image from the piece's image-space bounding rectangle. For backward compatibility, rectangular artifacts can either include bounds during generation or `PieceCanvas` can fall back to `estimatedPieceSize`.

## Voronoi Generation Approach

Because the requested seed points are still grid-based and the existing supported counts are modest (`12`, `30`, `60`, `120`), this can be implemented without adding a dependency.

Recommended algorithm:

1. Reuse `gridForPieceCount(pieceCount)` to determine rows and columns.
2. Compute `cellWidth = imageWidth / cols`, `cellHeight = imageHeight / rows`, and `d = Math.min(cellWidth, cellHeight)`.
3. For each grid cell, start from its center.
4. Perturb each point by a deterministic pseudo-random vector:
   - distance `r = lerp(0.25 * d, 0.5 * d, random())`
   - angle `theta = random() * Math.PI * 2`
   - point becomes `{x: center.x + cos(theta) * r, y: center.y + sin(theta) * r}`
5. Clamp points inside the image bounds with a small epsilon, so edge-cell sites do not leave the board.
6. For each site, compute its Voronoi cell by clipping the board rectangle against the half-plane between this site and every other site.
7. Convert the resulting polygon to a local mask by subtracting the site's chosen piece center.
8. Detect neighboring cells by matching shared polygon edges.
9. Use the piece center delta as the neighbor offset.

The half-plane clipping method is simple and deterministic:

- Start with the board rectangle polygon.
- For site `a`, iterate all other sites `b`.
- Keep the side of the perpendicular bisector closer to `a`:
  - A point `p` is inside when `dist2(p, a) <= dist2(p, b) + epsilon`.
- Clip the current polygon with that line.
- The final polygon is `a`'s Voronoi cell.

This is `O(n^3)` in the worst case when considering polygon growth, but at `n <= 120` it should be fine for artifact generation and tests.

## Generation Option Integration

The current app creation UI only asks for piece count. A board type can be added as a generation option in document init without touching `JigsawState` or storing the type on the artifact.

The artifact should stay concrete and shape-agnostic: once generated, `pieces` are the board. Runtime code should not need to know whether those pieces came from rectangles, Voronoi cells, or a future generator. That keeps validation and rendering focused on the geometry they actually consume.

Suggested types:

```ts
export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: 'stock:hue';
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    pieces: JigsawPiece[];
};
```

Possible function shape:

```ts
export function generateJigsawBoard(
    pieceCount: JigsawPieceCount,
    options?: {type?: 'rectangular' | 'voronoi'},
): JigsawBoardArtifact
```

`initialJigsawArtifacts` and `JigsawApp.documentInit` can accept `{pieceCount, type}` or a similarly named creation parameter. To preserve existing behavior, default to `rectangular` unless the desired product behavior is to make Voronoi the default.

The artifact version may need to move from `1` to `2` if `bounds` becomes required. If backward compatibility for old serialized artifacts matters, `isJigsawBoardArtifact` can synthesize missing bounds for rectangular pieces during load, but this code currently rejects unexpected artifact shapes rather than migrating them.

## Neighbor Detection

For Voronoi cells, neighbor relationships should come from shared cell boundaries, not original grid adjacency. Two pieces are neighbors if their clipped polygons share a non-trivial edge segment.

Implementation options:

- Track neighbors during clipping by noting which other site produced each retained boundary edge.
- Or compute after all polygons are generated by comparing polygon edges geometrically.

The first option is less brute-force but more bookkeeping. The second option is simpler for this codebase:

1. For every pair of polygons, compare each segment in polygon A to each segment in polygon B.
2. Treat segments as shared when they are collinear and their overlap length is greater than an epsilon.
3. Add reciprocal neighbor entries with offsets based on centers.

Use a tolerance because clipping creates floating-point coordinates.

## Center Choice

The current code assumes `center` is the solved image-space anchor for a piece. For a Voronoi cell, possible choices are:

- The perturbed site point.
- The polygon centroid.
- The polygon bounding-box center.

The site point is easiest and matches the geometry that generated the Voronoi cell. The polygon centroid will usually feel more visually centered and may improve dragging because the button anchor is closer to the visible mass. Either works as long as mask coordinates, bounds, and neighbor offsets use the same center consistently.

Recommended: use polygon centroid for `piece.center`, keep the perturbed sites internal to generation only, and compute neighbor offsets from centroids.

## Tests To Add Or Update

Existing tests in `jigsaw.test.ts` should be extended rather than replaced.

Useful coverage:

- `generateJigsawBoard(30, {type: 'voronoi'})` returns the requested piece count plus valid centers, masks, bounds, and neighbors.
- Perturbed sites are deterministic for the same piece count and generation options.
- Every Voronoi piece has at least two neighbors, except possibly pathological edge cases that should not occur with the supported grids.
- Neighbor entries are reciprocal and offsets are inverse, like the current rectangular test.
- Voronoi masks stay inside their piece bounds.
- Total polygon area is approximately the image area, within floating-point tolerance, to catch gaps or overlaps.
- `validConnections` accepts Voronoi neighbor connections and rejects non-neighbor pairs.
- Document init validates the board generation option if it becomes user-selectable.

The current rectangular test name, `"generates a %s-piece %sx%s rectangular board"`, should remain for rectangular generation and a separate Voronoi case should be added.

## Likely Code Changes

- `artifacts.ts`
  - Add a creation-time generation option/type if useful, without storing it on `JigsawBoardArtifact`.
  - Add optional or required piece `bounds`.
  - Split `generateJigsawBoard` into rectangular and Voronoi generation paths.
  - Add deterministic random helper reuse or move from `jigsaw.ts`.
  - Add polygon clipping, centroid, bounds, and neighbor detection helpers.
  - Update artifact validation and serialization.

- `jigsaw.ts`
  - Update `estimatedPieceSize` or replace it with a max-piece-size helper for board padding, reshuffle margins, and snap threshold.
  - Keep placement and connection logic mostly unchanged.

- `JigsawPanel.tsx`
  - Render piece dimensions from per-piece bounds.
  - Draw each piece canvas using `bounds` instead of a uniform crop around `center`.
  - Position buttons using the piece center plus bounds offset.
  - Keep minimap behavior based on piece centers; no shape rendering is currently needed there.

- `JigsawApp.tsx`
  - Add a generation type field if user selection is desired.
  - Pass that creation-time option into `initialJigsawArtifacts`.

- `jigsaw.test.ts`
  - Add Voronoi artifact tests.
  - Update rectangular tests for any new required artifact fields.

## Open Questions

1. Should `voronoi` become the default board type, or should the create-document dialog expose a board type selector while keeping `rectangular` as default?
    - dialog should have a selector
2. Should old serialized rectangular artifacts remain loadable after adding `boardType` and `bounds`, or is it acceptable to bump the artifact version and only load new artifacts?
    - definitely
3. Should the perturbation be deterministic only by `pieceCount` and generation type, or should document creation accept/store a seed so two 30-piece Voronoi puzzles can differ?
    - no need for determinism. go full random
4. Should perturbation distance use `d = min(cellWidth, cellHeight)`, or should x/y perturbation scale independently for non-square cells?
    - sure
5. Should piece centers be the Voronoi sites, polygon centroids, or bounding-box centers? Centroids are recommended for interaction, but sites are closer to the requested generation model.
    - it shouldn't matter. users should have no insight into where the piece center is. bounding box center is probably easiest for the random shuffle function
6. How visually exact do pieces need to be? Straight-edged Voronoi polygons are simplest; adding curved or jigsaw-like borders later would require a different mask generation step while preserving the same neighbor graph.
    - this board type will be straight edged, but the architecture is such that changing the generation algorithm should have no impact, because the artifacts are fully concrete
7. Is a dependency acceptable for Voronoi generation, or should this remain a small internal deterministic polygon clipper? Given the current constraints, an internal clipper is probably enough.
    - whatever you want
