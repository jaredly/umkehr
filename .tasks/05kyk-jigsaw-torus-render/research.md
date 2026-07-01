# Research: Jigsaw Torus Rendering

## Goal

Improve `examples/react-crdt` torus jigsaw boards so they render as an actual wrapped play surface instead of the current unwrapped planar embedding.

Desired behavior:

- A torus board has a sub-canvas with its own independent panning state.
- The sub-canvas wraps visually: a piece partly off the top edge is also rendered along the bottom edge, and similarly for left/right edges and corners.
- Unplaced pieces render outside that sub-canvas.
- Dropping a piece outside the sub-canvas deletes its placed position, if any, so it joins the unplaced pieces.

This research assumes the existing torus artifact generation should remain valid. The task is mainly a rendering and interaction change in the jigsaw panel.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`
- `examples/react-crdt/src/style.css`

The app already supports torus board artifacts:

- `JigsawSurface` is `'plane' | 'torus'`.
- Document creation has a `Surface` select.
- Torus boards store `surface: 'torus'`.
- Rectangular and Voronoi torus generation add wrapped neighbors.
- `neighborsFromSharedEdges` uses `shortestWrappedDelta(...)` for torus neighbor offsets.
- `PieceCanvas` already samples wrapped image pixels with `drawWrappedImageRegion(...)`, so piece imagery itself can cross the source-image boundary.

The current missing piece is the main board renderer. `JigsawPanel` renders one `.jigsawCanvas` inside `.jigsawViewport`:

```tsx
<div
    className="jigsawCanvas"
    style={{
        width: boardGeometry.boardSpace.width,
        height: boardGeometry.boardSpace.height,
        transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
    }}
>
    {showPreviewImage ? <SolvedImageCanvas ... /> : null}
    {board.pieces.map(... <JigsawPieceView />)}
</div>
```

That canvas is an unwrapped plane. The existing tests even lock in this behavior:

```ts
it('lays out rectangular torus seam components as an unwrapped embedding', () => {
    const board = generateJigsawBoard(12, {surface: 'torus'});
    // piece 0 appears to the right of piece 3 at x: 810, past the 720-wide image
});
```

Current coordinate systems:

- CRDT positions are piece-center positions in source-image coordinates.
- `board.imageSize` is the fundamental image domain, typically `720 x 540`.
- `boardSpaceFor(...)` adds padding around the image for the current single pan/zoom canvas.
- `imageOffset` maps source-image coordinates into the padded visual canvas.
- Unplaced pieces are local-only positions from `arrangeLocalUnplacedPieces(...)`.
- `buildPuzzleLayout(...)` computes placed connected-component positions from stored anchor positions and connection offsets.
- `renderedPositions` merges local unplaced positions and CRDT placed positions, plus drag deltas.

State shape is simple:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

There is no explicit placed/unplaced field. A piece is placed when `layout.positions.has(piece)` is true, which comes from `state.positions` anchors plus connected components.

## Key Existing Mechanics

### Drag

`startDrag(...)` chooses the piece's connected component, stores initial positions, and records the pointer in image coordinates via `pointerToBoard(...)`.

`updateDrag(...)` converts the current pointer into image coordinates and applies a delta:

```ts
setDrag({...drag, delta: subtract(pointer, drag.startPointer)});
```

`finishDrag(...)` currently always writes a position for `drag.anchor`:

```ts
const patches = [
    positionPatch(latest, drag.anchor, anchorPosition),
    ...newConnections.map(connectionPatch),
];
editor.dispatch(patches);
```

For the new requirement, `finishDrag(...)` needs to branch:

- drop inside torus sub-canvas: write a canonicalized wrapped position and snap candidates;
- drop outside torus sub-canvas: remove the anchor position if present, and probably skip new connections;
- plane boards: keep current behavior unless we intentionally adopt the same outside-drop behavior there.

### Unplaced Pieces

Unplaced pieces are not in CRDT state. They live in `localLayout.positions`, generated around `board.imageSize`:

```ts
const arranged = arrangeUnplacedPieces(board, pieces, board.imageSize, seed);
```

Currently these unplaced pieces are rendered in the same transformed `.jigsawCanvas` as placed pieces. For the requested UX, they should render outside the torus sub-canvas, not inside its clipped/wrapped surface.

The existing local arrangement helpers are still useful. They already position pieces outside a stage rectangle, with the stage passed as `{width, height}`. The likely change is to render the unplaced layer in the parent board space around the torus viewport, while placed pieces render inside the torus viewport.

### Snapping

`snapCandidates(...)` compares each dragged piece's current position with `neighborPosition - neighbor.offset`:

```ts
const expected = add(fromPosition, neighbor.offset);
if (distance(expected, neighborPosition) > snapThreshold) continue;
```

For torus rendering, this needs careful treatment. If a placed piece is visually duplicated at a wrap edge, there can be several equivalent visual positions for the same logical piece:

- `{x, y}`
- `{x +/- imageWidth, y}`
- `{x, y +/- imageHeight}`
- `{x +/- imageWidth, y +/- imageHeight}`

The current helper only sees one position per piece. For torus boards, `finishDrag(...)` should provide positions in a common local lift around the dragged drop before calling `snapCandidates(...)`, or a torus-specific snapping helper should compare wrapped deltas.

The simplest robust helper is:

```ts
wrappedDelta(a, b, imageSize) // shortest vector from a to b on the torus
wrappedDistance(a, b, imageSize)
```

Then snap check becomes conceptually:

```ts
distanceOnTorus(add(fromPosition, neighbor.offset), neighborPosition, imageSize) <= threshold
```

That avoids depending on whichever DOM duplicate was hit.

## Recommended Direction

Use two visual regions for torus boards:

1. An outer jigsaw board area that keeps the existing viewport/pan/zoom for the overall workspace and unplaced pieces.
2. A nested `.jigsawTorusViewport` placed at `imageOffset`, sized exactly to `board.imageSize`, with `overflow: hidden`, its own torus pan state, and repeated piece render copies.

Plane boards can keep the current single-canvas renderer.

For torus boards, render layers roughly like:

```tsx
<div className="jigsawViewport" ...outer pan/zoom...>
    <div className="jigsawCanvas" ...outer transform...>
        <div
            className="jigsawTorusViewport"
            style={{
                left: imageOffset.x,
                top: imageOffset.y,
                width: board.imageSize.width,
                height: board.imageSize.height,
            }}
            ...torus pan events...
        >
            <div className="jigsawTorusCanvas" style={torusTransform}>
                {preview copies}
                {placed piece copies}
            </div>
        </div>
        {unplaced piece views}
    </div>
    <JigsawMinimap ... />
</div>
```

The outer viewport remains useful because it gives room around the torus surface for unplaced pieces and existing minimap navigation. The torus viewport is the finite fundamental domain. The torus pan state shifts the repeated content inside that domain without moving the unplaced pieces.

Suggested local state:

```ts
type TorusViewport = {
    panX: number;
    panY: number;
};
```

No independent torus zoom is necessary unless desired. The existing outer `viewport.zoom` can scale the whole board area, including the torus sub-canvas and unplaced pieces. "Independent panning state" can be satisfied by a separate pan offset for the torus content.

## Torus Coordinate Model

Store CRDT positions canonically in source-image coordinates:

```ts
canonical.x = positiveModulo(position.x, board.imageSize.width)
canonical.y = positiveModulo(position.y, board.imageSize.height)
```

Reasons:

- The source image domain is the torus fundamental domain.
- It avoids unbounded position drift from repeated drags across seams.
- It makes drop-inside checks and persistence easier to reason about.
- Existing piece image rendering already wraps source pixels.

Rendering should create visual copies. For each placed piece, compute the base position with torus pan:

```ts
base = {
    x: positiveModulo(position.x + torusPanX, imageWidth),
    y: positiveModulo(position.y + torusPanY, imageHeight),
};
```

Then render enough tile offsets around it to cover edge overlap:

```ts
for dx of [-imageWidth, 0, imageWidth]
for dy of [-imageHeight, 0, imageHeight]
    render at base + {dx, dy}
```

This 3x3 copy set is simple and handles corners. For performance, filter copies by intersection with the torus viewport plus piece bounds before rendering. The largest board is 1000 pieces, so blindly rendering 9000 DOM buttons/canvases would be expensive. A helper can calculate `rectForPiece(...)` for each copy and render only copies whose rect overlaps `{left: 0, top: 0, right: imageWidth, bottom: imageHeight}`.

Important: only one copy of a logical piece should own the stable React ref used by `usePieceMoveAnimation(...)`. If every copy receives the same `elementRef`, the ref map will point at whichever copy mounted last. Options:

- Disable `usePieceMoveAnimation` for torus placed copies initially.
- Keep a primary hidden/visible copy with the ref and leave duplicate copies unrefed.
- Refactor animation to accept rendered copy keys.

The safest first implementation is to skip move animation while dragging or for torus duplicate rendering, and keep correctness/interaction first.

## Pointer Mapping

Current `pointerToBoard(...)` maps screen to outer canvas to image coordinates:

```ts
screenToCanvas(...) - imageOffset
```

For torus placed-piece dragging, pointer mapping should account for both transforms:

1. Convert screen to outer canvas coordinates with the outer viewport transform.
2. Subtract `imageOffset` to get torus viewport coordinates.
3. Subtract torus pan, then wrap into image coordinates.

Conceptually:

```ts
const canvas = screenToCanvas(clientX, clientY, outerRect, viewport);
const torusLocal = subtract(canvas, imageOffset);
const image = {
    x: positiveModulo(torusLocal.x - torusPanX, imageWidth),
    y: positiveModulo(torusLocal.y - torusPanY, imageHeight),
};
```

However, drag deltas across a seam cannot just subtract wrapped coordinates. Moving from `y = 2` to `y = 538` after crossing the top edge should mean `-4`, not `+536`. Track the pointer in an unwrapped torus coordinate during drag:

- At drag start, choose the visual copy the user actually pressed.
- Store its unwrapped image-space position.
- On pointer move, choose the equivalent current pointer coordinate nearest to the previous/starting pointer.

A helper like this is useful:

```ts
nearestEquivalentPoint(point, reference, imageSize)
```

It returns `point + n * imageWidth/height` for small `n` such that the result is closest to `reference`.

For drop-inside detection, use the unwrapped outer canvas coordinate before torus wrapping:

```ts
torusLocal.x >= 0 &&
torusLocal.x <= imageWidth &&
torusLocal.y >= 0 &&
torusLocal.y <= imageHeight
```

If false on pointer up, the piece was dropped outside the sub-canvas.

## Drop Outside Behavior

Add a remove-position helper:

```ts
export function removePositionPatch(piece: number): DraftPatch<JigsawState> {
    return {
        op: 'remove',
        path: [
            {type: 'key', key: 'positions'},
            {type: 'key', key: pieceKey(piece)},
        ],
    };
}
```

In `finishDrag(...)`, when a torus drop ends outside the sub-canvas:

- remove `state.positions[pieceKey(drag.anchor)]` if present;
- clear `drag`;
- do not add snap connections;
- probably do not remove existing `connections` in this first pass.

There is a semantic edge case for connected components: if dragging a connected component outside removes only the anchor position, the entire component becomes unplaced only if no other piece in the component has a stored position. That matches the current layout model, where one placed anchor can place an entire component. If any other component piece has its own stored position, `anchorPieceForComponent(...)` may choose that other piece and the component remains placed.

Possible implementation choices:

1. Remove only `drag.anchor`.
2. Remove stored positions for every piece in `drag.component`.

The user said "its placed position (if any) gets deleted, and it joins the unplaced pieces." For connected-component dragging, option 2 better matches what the user sees: the dragged group should leave the board. It also avoids surprising re-anchoring by another stored position in the same component.

Connections should likely stay intact. That lets a joined group remain joined while unplaced, and when one piece is placed later the whole group can reappear. Removing connections would be a stronger "break apart" behavior the task did not request.

## Minimap

`JigsawMinimap` currently includes all rendered positions, including unplaced pieces, and computes content bounds from those positions. For torus boards:

- The minimap should probably keep showing the outer board space and unplaced pieces, since the outer viewport still pans/zooms.
- It should draw the torus sub-canvas as the image rectangle.
- It should avoid drawing all 3x3 torus duplicates; one canonical placed copy inside the image rectangle is enough.
- The viewport rectangle remains the outer viewport rectangle, not the torus sub-canvas pan. If torus pan should be visible, add a subtle image-domain offset indicator later.

This can probably be handled by passing minimap canonical `renderedPositions` rather than duplicate render copies.

## Tests

Unit tests to add or update in `jigsaw.test.ts`:

- `positiveModulo` / canonical position helper handles negative and oversized coordinates.
- Render-copy helper returns bottom copy for a piece crossing the top edge and corner copies for corner overlap.
- Drop-outside patch generation removes stored positions for all dragged component pieces that have positions.
- Torus snap helper recognizes neighbors across wrapped visual positions.
- Existing "lays out rectangular torus seam components as an unwrapped embedding" should either be renamed to describe model layout only or adjusted if canonicalization changes expectations.

Playwright smoke coverage in `tests/smoke/jigsaw-solo.spec.ts`:

- Create a torus jigsaw document via creation options.
- Verify a torus sub-canvas exists and is clipped.
- Place or seed a piece so it straddles an edge; verify more than one visible `.jigsawPiece`/copy exists for that logical piece, or verify hit/render boxes on both sides.
- Drag a placed torus piece outside the sub-canvas and verify its CRDT position is removed indirectly by the piece appearing in the unplaced layer.
- Verify panning the torus sub-canvas changes placed-piece copy positions without moving unplaced pieces.

Potential test hooks:

- `data-testid="jigsaw-torus-viewport"`
- `data-testid="jigsaw-torus-canvas"`
- `data-piece-copy="canonical-or-offset"`
- Keep `data-piece` as the logical piece id for all copies.

## Risks

- Rendering too many duplicate piece canvases can hurt 600/1000-piece boards. Filter copies aggressively.
- Pointer deltas across seams are easy to get wrong if drag state stores only wrapped coordinates.
- The current `pieceRefs` and movement animation assume one DOM element per piece.
- Snapping on a torus should use wrapped distance, not the current planar `distance(...)`.
- Existing CSS and smoke tests assume all pieces are clipped by `.jigsawViewport`; the new unplaced-outside-sub-canvas behavior is still clipped by the outer viewport, which is probably right.
- If a connected component has multiple stored positions, removing only the dragged anchor may not make it unplaced.

## Open Questions

- Should this behavior apply only when `board.surface === 'torus'`, or should plane boards also delete a placed position when dropped outside the solved-image rectangle?
    - only for the torus surface
- When dropping a connected group outside the torus sub-canvas, should we remove stored positions for the whole dragged component or only the pointer-down piece/anchor? I recommend removing all stored positions in the dragged component.
    - let's just prevent dropping a connected group outside
- Should existing connections remain when a group is moved to unplaced? I recommend keeping them unless the desired behavior is to break the group apart.
    - let's prevent making a group unplaced
- Should the torus sub-canvas have independent zoom too, or only independent pan? The request only calls out independent panning state.
    - no independent zoom
- Should dragging a placed piece across a torus edge preserve continuous motion by wrapping live, or is it acceptable for the duplicate copies to make the wrap visible only during/after drop?
    - live wrapping
- Should the minimap visualize torus pan, or is showing canonical piece locations plus the outer viewport enough for now?
    - yes please
- For read-only/history views, should torus panning remain enabled? Existing precedent says viewport navigation should stay enabled while state-changing piece drag is disabled.
    - yes
