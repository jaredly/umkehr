# Research: Wrapping Jigsaw Board Surface

## Goal

Add a jigsaw board surface mode for `examples/react-crdt` where the puzzle is logically on a
torus. In this mode the left/right and top/bottom sides of the image connect to each other, so
there are no true edge pieces. The board artifact should record the surface as:

```ts
surface?: 'torus' | 'plane'
```

Missing `surface` means the existing default, `plane`.

The task says future rendering differences are possible but not required now, so the first pass
should focus on the board artifact and logical puzzle geometry while keeping the current jigsaw
renderer shape intact as much as possible.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/scripts/jigsaw-board-svg.ts`

The board artifact is currently:

```ts
export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: JigsawImageRef;
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    pieces: JigsawPiece[];
};
```

Each piece stores local geometry and logical neighbors:

```ts
export type JigsawPiece = {
    center: Coord;
    bounds: PieceBounds;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};
```

Important current assumptions:

- `generateJigsawBoard(pieceCount, options)` dispatches to rectangular or Voronoi generation.
- `JigsawBoardOptions` already carries generation options: `type`, `tabs`, `seed`, `image`,
  `imageSize`, and `imageName`.
- `normalizeJigsawBoardArtifact` validates and normalizes persisted board artifacts.
- The artifact store accepts either the original artifact hash or the normalized hash, which is
  useful for loading legacy artifacts after adding a defaulted optional field.
- `validConnections` only accepts connection keys where the target piece appears in
  `board.pieces[from].neighbors`.
- `positionsForComponent` lays out a connected component by walking neighbor offsets from an anchor.
- `snapCandidates` expects dragged pieces to be near `fromPosition + neighbor.offset`.
- `PieceCanvas` draws each piece by clipping to the mask and sampling one rectangular crop from the
  source canvas:

```ts
sourceX = pieceCenter.x + bounds.left;
sourceY = pieceCenter.y + bounds.top;
```

That crop is not currently wrap-aware.

## Artifact Model

Add a type and option:

```ts
export type JigsawSurface = 'plane' | 'torus';

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: JigsawImageRef;
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    surface?: JigsawSurface;
    pieces: JigsawPiece[];
};

export type JigsawBoardOptions = {
    type?: JigsawGenerationType;
    surface?: JigsawSurface;
    // existing fields...
};
```

Normalization should accept:

- missing `surface` as `plane`
- explicit `surface: 'plane'`
- explicit `surface: 'torus'`

The least disruptive serialization behavior is:

- Generated plane boards may omit `surface`.
- Generated torus boards must include `surface: 'torus'`.
- Normalized loaded legacy boards may either keep `surface` omitted or normalize to `'plane'`.

If preserving legacy artifact byte shape matters, omit `surface` for plane boards when serializing.
If internal code simplicity matters more, normalize to `surface: 'plane'` in memory and rely on the
existing dual fingerprint check during load. Either approach is compatible with the task statement.

The artifact version can probably remain `1` because this is a compatible optional extension and
legacy artifacts still load. A version bump would create extra migration work without a clear
benefit.

## Creation Flow

`JigsawApp.tsx` currently exposes:

- piece count
- board generation type: rectangular or Voronoi
- tabs checkbox
- optional image upload

There are two possible scopes:

1. Only add the artifact field and generation option, leaving UI selection for a later task.
2. Add a `Surface` select to document creation with `Plane` and `Torus`.

If a UI control is added, extend `JigsawDocumentInitParams` and validation:

```ts
type JigsawDocumentInitParams = {
    pieceCount: JigsawPieceCount;
    type: JigsawGenerationType;
    surface?: JigsawSurface;
    tabs?: boolean;
    image?: JigsawImageArtifact;
    imageStatus?: JigsawImageStatus;
    imageError?: string;
};
```

Then pass `surface: params.surface` through `initialJigsawArtifacts` into `generateJigsawBoard`.

## Plane Vs Torus Geometry

For `plane`, keep current behavior.

For `torus`, pieces on opposite sides of the image are logical neighbors:

- first column connects to last column in the same row
- first row connects to last row in the same column

For a rectangular board this is straightforward to generate from the grid. Existing internal shared
edges are unchanged. Additional wrap shared edges are added across the image boundary.

The main design choice is the neighbor offset stored for wrap connections.

### Offset Option A: Planar Artifact Coordinates

Use the current center difference:

```ts
offset = centers[to] - centers[from]
```

For a last-column piece connecting to the first-column piece, this is a large negative x offset.
For a bottom-row piece connecting to the top-row piece, this is a large negative y offset.

Pros:

- Compatible with the current component layout, because all offsets remain globally consistent in
  the displayed rectangle.
- A fully solved board can still render as one rectangle.
- No new layout math is needed.

Cons:

- A wrap neighbor is logically adjacent on the torus but visually far apart in the current planar
  rendering.
- Snapping across the seam only happens when pieces are positioned in the same rectangular solved
  layout, not when they appear adjacent across a repeated/tiled view.
- This is the smallest "logical torus, current renderer" implementation, but it does not make the
  seam feel physically adjacent.

### Offset Option B: Shortest Wrapped Offsets

Use the local torus displacement, for example `+pieceWidth` from the last column to the first column
when crossing the right seam.

Pros:

- Wrap neighbors snap when they are physically near each other in an unwrapped plane.
- Better matches the mental model of a board with no edge.
- Works with the current "position = anchor + neighbor offsets" layout model if we accept that a
  solved component may be displayed as an unwrapped copy that extends past one image width/height.

Caveats:

- A full cycle around the torus accumulates one image width/height in the unwrapped embedding. That
  is not necessarily wrong, but it means the current layout represents one chosen lift of the torus
  into the plane, not a closed loop inside the original image rectangle.
- `positionsForComponent` gives each piece one absolute position and ignores revisits. That is fine
  for an unwrapped embedding, but it will not render duplicate copies of a piece where the same
  logical piece would also appear at `x +/- imageWidth` or `y +/- imageHeight`.
- Some future niceties, like showing both sides of a seam at once or canonicalizing a completed
  component back into one image-sized fundamental domain, would need richer rendering/layout support.

For the first pass, Option B may be the better interaction model if "unwrapped solved positions are
acceptable." The implementation should document that a torus solve can extend beyond the preview
image rectangle until a future renderer chooses how to show repeated copies or canonicalize the
component.

## Rectangular Torus Generation

Recommended first implementation target:

1. Add `surface` to generation options.
2. Let existing rectangular generation create normal cell polygons and internal shared edges.
3. If `surface === 'torus'`, add wrap shared edges:
   - `row * cols + (cols - 1)` connected to `row * cols`
   - `(rows - 1) * cols + col` connected to `col`
4. Build `neighbors` from all shared edges.
5. Keep masks as the current rectangles when `tabs !== true`.
6. When `tabs === true`, allow tab specs on wrap shared edges only if rendering/cropping is handled
   well enough for out-of-image bounds.

For non-tabbed rectangular pieces, this immediately removes logical edge pieces because every piece
has four neighbors.

For tabbed rectangular torus pieces, wrap edges should get complementary tab/socket profiles so
outer edges no longer look like flat edges. This can make piece bounds extend outside the image
rectangle and exposes the current crop limitation.

## Voronoi Torus Generation

Voronoi torus support is meaningfully harder than rectangular torus support.

Current Voronoi generation:

- creates one site per grid cell inside the image rectangle
- clips each cell against nearby sites inside a bounded rectangle
- finds shared edges by segment overlap in that bounded rectangle

A true toroidal Voronoi board should compute adjacency against periodic copies of sites. The common
approach is:

1. Generate the original sites in `[0, width) x [0, height)`.
2. For each site, consider neighboring site copies shifted by `-width`, `0`, `+width` and
   `-height`, `0`, `+height`.
3. Clip a local cell around the source site against the nearest periodic copies.
4. Record shared edges with both the neighbor piece id and the wrap shift used by that periodic
   neighbor.
5. Convert the local unwrapped cell to a mask relative to the piece center.

Open complication: a toroidal Voronoi cell may cross the chosen image cut. In the current artifact
shape, each piece has one mask path and one rectangular source crop. That can still work if masks
are stored in local unwrapped coordinates and the renderer samples the source image with modular
coordinates. It is not a good fit for the current single `drawImage(source, sourceX, sourceY, ...)`
crop.

Pragmatic options:

- Implement torus only for rectangular boards first and reject or silently map Voronoi torus back to
  plane until a follow-up.
- Implement Voronoi torus logically by adding wrap neighbors around the bounded cells, but keep
  bounded-cell masks. This gives no edge pieces in connection logic but not in shape quality.
- Implement full periodic Voronoi plus wrap-aware rendering. This is the most correct but largest
  change.

## Rendering And Image Sampling

The task says a normal image is acceptable; the image does not have to be seamless. That means
sampling should wrap around the image, even if a visible seam remains.

Current `PieceCanvas` does not wrap source sampling. If a torus piece mask or bounds extends beyond
the source canvas, the out-of-bounds part can render transparent/blank depending on browser canvas
behavior.

Potential low-risk helper:

```ts
drawWrappedImageRegion(context, source, sourceX, sourceY, width, height)
```

It can draw one or more source sub-rectangles into the destination by splitting the requested region
at image boundaries and applying modular coordinates. For small pieces, at most four chunks are
needed for normal rectangular bounds, though tabbed or Voronoi pieces near corners may need both x
and y wrapping.

If the first implementation keeps masks and bounds inside the image rectangle, this helper can wait.
If torus tabs or true periodic Voronoi are implemented, wrap-aware sampling is likely required.

`SolvedImageCanvas` can remain unchanged for now because it is just the preview of one image
fundamental domain.

`JigsawMinimap` can also remain mostly unchanged. It draws piece masks in planar coordinates and
colors pieces by center. It may not communicate torus adjacency, but the task explicitly allows
future rendering work.

## Snapping And Solved Counts

`totalConnections` is computed as:

```ts
board.pieces.reduce((sum, piece) => sum + piece.neighbors.length, 0) / 2
```

For a rectangular torus board, every piece has four neighbors, so total undirected joins should be:

```ts
pieceCount * 2
```

instead of the plane-grid count:

```ts
(cols - 1) * rows + (rows - 1) * cols
```

Tests should assert this difference.

`validConnections`, `connectedComponents`, `pieceDepths`, and `snapCandidates` should work with
additional neighbors for either offset model. With shortest wrapped offsets, the resulting component
positions should be understood as an unwrapped planar embedding of the torus rather than a layout
constrained to the original image rectangle.

## Tests To Add

Focused unit coverage in `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`:

- `generateJigsawBoard(12)` either omits `surface` or resolves to plane by helper/default.
- `generateJigsawBoard(12, {surface: 'plane'})` behaves like the current plane board.
- `generateJigsawBoard(12, {surface: 'torus'})` includes `surface: 'torus'`.
- Rectangular torus board has no logical edge pieces:
  - every piece has four neighbors
  - neighbor relationships are reciprocal
  - first/last columns are neighbors
  - first/last rows are neighbors
- `validConnections` accepts wrap-edge connection keys for torus and rejects the same non-neighbor
  edge on plane.
- Serialization, manifest, and load accept torus artifacts.
- Legacy board artifacts without `surface` still load.
- Invalid `surface` values are ignored/rejected by normalization.
- Document creation validation accepts a torus surface if a UI/init-param option is added.

If torus tabs are implemented:

- tabbed torus boards have curved segments on wrap edges.
- bounds remain finite and masks fit bounds.
- rendering helper tests should cover source regions crossing left/right, top/bottom, and both axes.

If Voronoi torus is implemented:

- generated pieces have reciprocal wrap neighbors.
- sample high-count boards remain finite and have enough neighbors.
- masks and bounds remain finite after periodic clipping.

## Suggested Implementation Order

1. Add `JigsawSurface` and `surface?: JigsawSurface` to the artifact and options types.
2. Update board normalization to default missing surface to plane and validate explicit values.
3. Pass `surface` through `initialJigsawArtifacts` and `generateJigsawBoard`.
4. Add rectangular torus neighbor generation using the chosen offset model. Shortest wrapped offsets
   are reasonable if unwrapped component positions are acceptable.
5. Add tests for artifact compatibility and rectangular torus adjacency.
6. Decide whether document creation needs a `Surface` field in this task.
7. Only then decide whether torus tabs, Voronoi torus, and wrap-aware source sampling are in scope.

## Open Questions

- Should this task add a user-facing `Surface` selector in the document creation form, or only add
  artifact/model support for now?
    - yeah surface selector
- For generated plane boards, should `surface: 'plane'` be serialized explicitly, or should plane
  continue to omit the optional field?
    - no need
- Should the initial torus implementation support both rectangular and Voronoi generation, or is
  rectangular torus enough for the first pass?
    - definitely both
- Should tabbed torus boards put tabs/sockets on wrap seams immediately? If yes, wrap-aware image
  sampling is probably needed now.
    - yes
- Which neighbor offset semantics do we want for wrap edges: planar artifact coordinates for current
  layout compatibility, or shortest wrapped offsets for better torus interaction?
    - option B
- What should a solved torus look like in the current planar renderer? A single fundamental image
  rectangle, a component that can cross outside the image bounds, or something deferred to future
  rendering work?
    - it can definitely cross outside image bounds
- Should snapping across the seam be discoverable/visible in the current UI, or is logical
  connection validation sufficient for this task?
    - snapping should definitely work
- If a normal non-seamless uploaded image is used, is the visible seam between wrapped neighbors
  acceptable as-is?
    - yes. for the voronoi board (and for tabs on rects), the seams might be within a single tile
