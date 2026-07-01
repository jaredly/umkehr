# Research: Jigsaw Torus Border Placement

## Goal

Update `examples/react-crdt` jigsaw so torus boards allow:

- unplaced pieces to be manually positioned around the torus sub-canvas border;
- already connected pieces/components to be dragged out of the torus sub-canvas and left around the border;
- normal planar boards to stay simple and avoid inheriting torus-only complexity.

The core design question is how to distinguish a torus sub-canvas position from an outer-canvas/border position.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/schema.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`

`JigsawState` is currently:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

The existing interpretation is implicit:

- a piece/component with a stored entry in `positions` is placed;
- a piece/component with no stored position is unplaced and receives a local-only generated shelf position;
- connected component positions are derived from one persisted anchor plus `connections`;
- stale non-anchor positions can exist but are ignored by `anchorPieceForComponent(...)` / `buildPuzzleLayout(...)`.

For torus boards, `JigsawPanel` now renders two layers:

- placed pieces render inside `.jigsawTorusViewport` as wrapped copies, using `torusPieceCopies(...)`;
- unplaced pieces render directly on the outer `.jigsawCanvas`, using local-only `localLayout.positions`.

The current drop rule is intentionally restrictive:

```ts
if (isTorusBoard && !torusDropInside) {
    const outsideDrop = outsideTorusDropPatches(latest, drag.component);
    ...
    return;
}
```

`outsideTorusDropPatches(...)` only removes a stored position for a singleton placed piece. It cancels connected components:

```ts
if (component.length !== 1) return {type: 'cancel'};
```

This explains the annoying behavior:

- dragging an unplaced piece around the border never commits its new local position, so it snaps back;
- dragging a connected component out of the torus is cancelled;
- dragging a placed singleton out removes it from CRDT state, but it reappears wherever local auto-arrangement puts it, not where the user dropped it.

## Coordinate Spaces

There are now three practical coordinate spaces:

- `plane`: the normal board/image coordinate space used by planar boards.
- `torus-surface`: logical torus coordinates modulo `board.imageSize`, rendered through the clipped sub-canvas and duplicate wrapped copies.
- `outer`: the outer jigsaw canvas coordinate space around the sub-canvas, using the same image-relative coordinates as planar shelves, where coordinates commonly sit outside `[0, width] x [0, height]`.

For torus boards, a stored position needs to say whether it belongs to `torus-surface` or `outer`. The same numeric coordinate can otherwise mean different things after panning and wrapping.

## Design Options

### Option 1: Infer Space From Coordinate Bounds

Keep `positions: Record<string, Coord>`. On torus boards, treat an anchor inside the image rectangle as `torus-surface` and an anchor outside it as `outer`.

Pros:

- no schema change;
- least code churn in the model;
- likely enough for a fast prototype.

Cons:

- geometric overloading is brittle at the border;
- a piece can overlap the border while its anchor/center is inside;
- connected torus components already use unwrapped coordinates where non-anchor pieces can be outside the image while the anchor is still logically on the torus;
- the meaning of a stored coordinate becomes dependent on board surface and anchor choice;
- concurrent edits cannot distinguish "put this same point on the torus" from "put this same point on the outer canvas."

This is the shortest implementation but the weakest model. I would avoid it unless this is meant to be throwaway/demo-only.

### Option 2: Add A Separate `outerPositions` Map

Keep existing `positions` for plane and torus-surface placements, and add a torus-only map:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    outerPositions?: Record<string, Coord>;
    connections: Record<string, number>;
};
```

Pros:

- planar boards can continue using `positions` unchanged;
- torus-specific behavior is explicit and mostly isolated;
- existing persisted positions retain their meaning.

Cons:

- changing schema still changes the app schema fingerprint;
- concurrent moves can leave both `positions[piece]` and `outerPositions[piece]` present unless every reader has a deterministic conflict rule;
- layout code now has to choose between two anchor maps.

If this option is used, define a hard precedence rule for conflicted components. For example, surface wins over outer, or highest-depth anchor wins with a fixed tiebreaker. That will be deterministic, but not necessarily what the latest user action intended under concurrency.

### Option 3: Add An Optional `outer` Bit To Positions

Extend the existing position shape:

```ts
export type Coord = {
    x: number;
    y: number;
    outer?: boolean;
};

export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

For planar boards, `outer` is ignored. For torus boards, `outer === true` means the position belongs to the outer canvas; anything else means logical torus-surface placement.

Reads should go through small helpers such as:

```ts
function isOuterPosition(board: JigsawBoardArtifact, position: Coord) {
    return board.surface === 'torus' && position.outer === true;
}

function positionPoint(position: Coord): Coord {
    return {x: position.x, y: position.y};
}
```

Pros:

- the torus distinction is explicit and travels with the coordinate;
- conflicting moves target the same `positions[piece]` path, which is cleaner than two maps;
- existing plain `{x, y}` documents continue to fit the shape;
- planar boards can keep writing and reading positions exactly as before;
- `positionPatch(...)` can stay mostly unchanged and only include `outer: true` for torus outside drops.

Cons:

- `outer?: boolean` is less self-documenting than a full `{space: ...}` tag;
- helper code must consistently ignore `outer` for planar boards;
- weird but harmless values such as `outer: false` can appear;
- tests need to cover legacy `{x, y}` and `{x, y, outer: true}` values.

This is the best pragmatic model for the current request. It gives the code an explicit torus outside/surface distinction without introducing a larger tagged union or a second position map.

### Option 4: Store A Full Placement Tag

A fuller version of Option 3 would be:

```ts
type StoredPiecePosition =
    | Coord
    | {space: 'surface'; point: Coord}
    | {space: 'outer'; point: Coord};
```

This is more explicit and more extensible if more placement spaces are expected later. It is also more invasive: most direct coordinate reads/writes need to unwrap the value, and planar code has to account for a different shape. I do not think that tradeoff is needed for the current torus border placement change.

## Recommended Architecture

Use `Coord & {outer?: boolean}` as the stored position shape.

Concrete shape:

```ts
export type Coord = {
    x: number;
    y: number;
    outer?: boolean;
};

export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

Rules:

- Plane boards:
  - keep writing plain `{x, y}`;
  - ignore `outer` if it appears in loaded or concurrent state;
  - treat all positions as `plane`;
  - do not render a split inner/outer layer.
- Torus boards:
  - `outer === true` means image-relative outer canvas coordinates, not modulo-wrapped;
  - `outer !== true` means logical torus coordinates, canonicalized modulo image size;
  - legacy plain `{x, y}` should normalize to torus-surface placement to preserve current documents.
- Connected components:
  - choose the component anchor from positions in the same interpreted placement space;
  - derive all component piece positions from the selected anchor plus connection offsets;
  - a connected component can be `surface` or `outer`, but not both in the rendered layout.

Suggested derived layout additions:

```ts
type ComponentPlacementSpace = 'plane' | 'surface' | 'outer';

type PuzzleLayout = {
    connections: ValidConnection[];
    components: number[][];
    pieceToComponent: Map<number, number>;
    depths: Map<number, number>;
    anchors: Map<number, number>;
    positions: Map<number, Coord>;
    componentSpaces: Map<number, ComponentPlacementSpace>;
};
```

For non-torus boards, `componentSpaces` can either be omitted or filled with `plane`. The UI can keep using the existing planar render branch.

For torus boards:

- render components with `componentSpaces[component] === 'surface'` inside `.jigsawTorusViewport`;
- render components with `componentSpaces[component] === 'outer'` directly in `.jigsawCanvas`;
- render local-only unplaced pieces in `.jigsawCanvas` until the user manually drops them somewhere.

This keeps the branch point at `isTorusBoard`, rather than making every planar board understand torus semantics.

## Interaction Changes

Current `DragState.mode` is fixed at drag start:

```ts
mode: 'outer' | 'torus';
```

That is no longer sufficient once pieces can cross between spaces during a drag.

Recommended drag model:

```ts
type DragSpace = 'outer' | 'surface';

type DragState = {
    originSpace: DragSpace;
    previewSpace: DragSpace;
    ...
};
```

During pointer move:

- compute whether the pointer is inside the torus viewport;
- if inside, preview in `surface` coordinates;
- if outside, preview in `outer` coordinates;
- render the active component in the matching layer so dragging a connected component out of the clipped torus remains visible under the pointer.

On drop:

- outside torus:
  - write `{x: outerAnchorPosition.x, y: outerAnchorPosition.y, outer: true}`;
  - preserve `connections`;
  - if this was an auto-arranged unplaced singleton, it now becomes a persisted outer placement.
- inside torus:
  - write `{x, y}` from `canonicalTorusPoint(logicalAnchorPosition, board.imageSize)`, without `outer: true`;
  - preserve new snap connections;
  - use wrapped-distance snapping.

`outsideTorusDropPatches(...)` should be replaced with a helper that creates a placement patch instead of removing/cancelling:

```ts
torusPlacementPatch(state, piece, {
    x: outerAnchorPosition.x,
    y: outerAnchorPosition.y,
    outer: true,
});
```

The old "remove singleton position" behavior should go away for this workflow. If we still want a way to return to local auto-arranged state, that should be a separate explicit command, not the default outside drop.

## Snapping Implications

Torus surface snapping should keep using logical torus coordinates plus `wrappedDistance(...)`.

Outer placements should use ordinary Euclidean distance, even on torus boards, because pieces outside the sub-canvas are visually arranged on the outer canvas and should not snap through torus seams while shelved.

When dragging from outer into the torus, only compare against surface-placed components for torus snapping. Outer shelved pieces should not accidentally participate in wrapped seam snapping unless the dragged piece is also being dropped into the surface.

## Minimap Implications

Current minimap canonicalizes torus placed pieces:

```ts
result.set(piece, canonicalTorusPoint(position, board.imageSize));
```

With outer placements:

- surface components should still show canonicalized positions inside the image rectangle;
- outer components should be shown at their outer canvas positions;
- local-only generated unplaced pieces should continue to show as today;
- minimap content bounds already expands around `renderedPositions`, so outer placements should remain visible if `renderedPositions` carries the correct space-derived positions.

## Schema And Migration Notes

Changing `JigsawState` changes the generated typia schema and schema fingerprint.

Current `jigsawApp` has `schemaVersion: 1`, and `registeredApps` does not provide jigsaw migrations. Existing local/solo documents may still load if the new type accepts legacy `Coord` values, but server/local-first schema handling can still notice fingerprint/version differences depending on mode.

Implementation should decide whether to:

- keep `schemaVersion: 1` and rely on the backward-compatible optional property; or
- bump to `schemaVersion: 2` and add explicit migration config for jigsaw.

Given this is an example app, the minimal likely path is the optional `outer` property plus tests that old `{positions: {'0': {x, y}}}` states validate and render. If jigsaw server/local-first compatibility matters, add a proper migration entry.

## Test Plan

Unit tests in `jigsaw.test.ts`:

- legacy plain torus coordinates normalize to `surface`;
- `{x, y}` torus positions render/canonicalize as torus-surface positions;
- `{x, y, outer: true}` torus positions render as outer positions and are not modulo-wrapped;
- `{x, y, outer: true}` planar positions are treated as normal planar positions;
- dropping an unplaced torus piece outside creates a persisted outer placement;
- dropping a connected torus component outside preserves connections and stores the component anchor as outer;
- dropping an outer component into the torus stores a canonical surface placement;
- wrapped snap candidates only use surface placements;
- outer placements use non-wrapped distance.

Smoke tests in `tests/smoke/jigsaw-solo.spec.ts`:

- drag an unplaced piece to a border position and verify it stays there;
- drag a connected two-piece component out of the torus and verify both pieces remain connected and visible outside;
- drag that component back into the torus and verify wrapped copies render inside the sub-canvas;
- update the existing test that currently expects outside drop to remove torus copies and return a singleton to unplaced auto-layout.

## Open Questions

- Should manually shelved outer positions be collaborative/persisted? I assume yes, because connected components must remain where the user dropped them and local-only layout would not be enough.
    - yes
- Should an outer connected component still count as "solved" if its `connections` are intact but it is outside the torus sub-canvas? The current progress count is connection-based, so it would count unless we add surface-space requirements.
    - yes
- Should dropping outside ever remove a placement and return a piece to auto-arranged local layout? If yes, this needs a separate gesture or command.
    - no
- How should concurrent moves between surface and outer resolve? Keeping `outer` on the same `positions[piece]` object gives the cleanest conflict target, but the exact CRDT winner should be confirmed.
    - we can just do LWW as usual
- What should happen when only part of a large piece overlaps the torus sub-canvas at drop time? I recommend using pointer/drop target for deciding space, not piece bounds.
    - yes use pointer
- Should outer placements be allowed to overlap the torus sub-canvas visually, or should final outer positions be nudged so the component remains fully outside the image rectangle?
    - yes they can overlap
- Should torus surface writes actively remove `outer` by replacing the whole position object, or is writing `{x, y, outer: false}` acceptable? I recommend replacing with plain `{x, y}`.
    - replacing
