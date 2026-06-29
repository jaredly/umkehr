# Plan: Collaborative Jigsaw Puzzle

## Phase 1: App Skeleton And Registry

Create a new app module at `examples/react-crdt/src/apps/jigsaw`.

Files to add:

- `JigsawApp.tsx`
- `JigsawPanel.tsx`
- `artifacts.ts`
- `jigsaw.ts`
- `model.ts`
- `schema.ts`
- `jigsaw.test.ts`

Wire it into `examples/react-crdt/src/lib/appRegistry.ts` with `jigsawApp`, `jigsawCrdtRuntime`, and `jigsawHistoryRuntime`.

The initial app definition should use:

- app id: `jigsaw`
- title: `Jigsaw`
- schema version: `1`
- document id: `umkehr-react-crdt-jigsaw-v1`
- initial CRDT state: `{positions: {}, connections: {}}`

Do not add remote drag previews in this pass.

## Phase 2: State, Schema, And Artifact Model

Define shared model types:

```ts
type Coord = {x: number; y: number};

type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};

type JigsawPiece = {
    center: Coord;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: 'stock:hue';
    imageSize: {width: number; height: number};
    pieceCount: 12 | 30 | 60 | 120;
    pieces: JigsawPiece[];
};

type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};
```

Use `Record<string, ...>` for CRDT state even though the conceptual keys are piece indexes.

Create a jigsaw artifact store using the existing `ArtifactStore` contract:

- artifact id: `board`
- kind: `jigsaw-board`
- version: `1`
- default piece count: `12`
- image value: fixed `"stock:hue"`

For now, do not build piece-count document options. The store's `createInitial()` should generate a default 12-piece board.

## Phase 3: Board Generation

Implement rectangular board generation in `artifacts.ts`.

For the first version:

- support all target counts in the generator, but use `12` by default
- grids:
  - `12`: `4 x 3`
  - `30`: `6 x 5`
  - `60`: `10 x 6`
  - `120`: `15 x 8`
- image size can be a stable fixed size, for example `720 x 540`
- each piece center is image-local
- each mask is a rectangle path so the model is ready for shaped pieces later
- neighbors are only up/down/left/right
- neighbor offsets are `neighbor.center - piece.center`

Implement artifact validation, serialization, loading, manifest generation, and fingerprint checking following the wordsearch artifact store.

## Phase 4: Pure Placement Logic

Implement `jigsaw.ts` as pure, tested logic before building the UI.

Core helpers:

- parse connection keys of the form `${from}:${to}`
- validate connections against `board.pieces[from].neighbors`
- reject invalid indexes, self-connections, non-neighbor pairs, and non-positive/non-finite strengths
- build physical connected components from valid connections, treating edges as undirected for grouping
- compute weighted directed depths from valid connections
- choose anchor pieces by greatest depth among pieces with `state.positions`, tie-breaking by largest piece index
- derive absolute positions for every piece in anchored components using board neighbor offsets
- return unplaced piece indexes
- compute snap candidates using only correct declared neighbors
- compute connection strength for a snap so an already-positioned destination component becomes authoritative over the dragged component

Depth algorithm:

1. Build SCCs from valid directed edges.
2. Collapse SCCs into a DAG.
3. Roots have depth `0`.
4. Propagate depth by `max(parentDepth + strength)`.
5. Assign every piece in an SCC the SCC depth.

Snap strength rule:

```ts
const strength = Math.max(1, draggedMaxDepth - draggedEndpointDepth + 1);
```

The connection key should be from the moved piece in the dragged component to the destination neighbor piece. If the destination component already has a positioned piece, the new weighted depth should make that destination placement authoritative. If the destination component has no position, the dragged component's newly written anchor position remains authoritative.

## Phase 5: Local Layout And Z-Order

Implement local-only layout helpers for unplaced pieces.

Requirements:

- unplaced pieces are arranged uniformly around the panel/screen border
- a `Reshuffle unplaced pieces` button regenerates only local layout
- local layout is not persisted or broadcast
- stable local positions should be preserved across CRDT updates where possible

Implement z-order rules:

- positioned components render above non-positioned/unplaced pieces
- all pieces in the same component share one z-index
- positioned components with more recent anchor positions render above older positioned components
- recency should come from CRDT metadata/HLC for the anchor position, using `editor.useCrdtMeta` where available in synced modes
- history/solo fallback can use deterministic local ordering if metadata is unavailable
- actively dragged component renders above everything locally

## Phase 6: Jigsaw Panel UI

Build `JigsawPanel.tsx`.

UI elements:

- header with title, progress, Undo, Redo
- puzzle stage that fills the available panel space
- `Reshuffle unplaced pieces` button
- rectangular draggable pieces rendered absolutely

Rendering details:

- use the fixed `"stock:hue"` image as a procedural visual: X maps to hue `0-360`, Y maps to lightness `30-70%`
- for rectangular pieces, render a per-piece gradient/background matching its source rectangle
- keep coordinates in image-local space and scale into stage space
- draw subtle borders so piece boundaries are visible
- avoid storing transient drag positions in CRDT

Drag behavior:

1. Pointer down on any piece.
2. Determine its component from valid connections.
3. Determine the dragged component's current anchor piece.
4. Capture current positions for all component pieces.
5. During drag, move all component pieces locally by the pointer delta.
6. On drop, dispatch a position patch for `positions[anchorPiece]`.
7. Detect all eligible snaps to correct declared neighbors outside the dragged component.
8. Dispatch connection patches for all eligible snaps with computed strengths.

Snapping must not do arbitrary border proximity detection. It should only compare each moved piece to its declared neighbors by checking whether:

```ts
movedPiecePosition + neighbor.offset
```

is within threshold of the neighbor's current board position.

## Phase 7: Tests

Add focused unit tests in `src/apps/jigsaw/jigsaw.test.ts`.

Cover:

- 12/30/60/120 board generation counts and rectangular grids
- generated neighbor offsets are reciprocal and correct
- artifact manifest/serialize/load/fingerprint behavior
- invalid connection keys and non-neighbor connections are discarded
- physical components are built from valid connections
- weighted depth handles roots, max-depth merges, and cycles
- anchor selection uses greatest weighted depth and largest-index tie-break
- derived positions ignore stale non-anchor position records
- dragged-component anchor position is the drop write target
- snap detection checks only correct declared neighbors
- all eligible snaps are returned
- snap strengths let an already-positioned destination component win
- if destination has no positioned piece, dragged component anchor remains authoritative
- unplaced layout is local/deterministic with a fixed seed/container

Add a small render smoke test only if the existing test setup makes it cheap. Prioritize pure logic coverage because the graph and weighted depth rules carry most of the risk.

## Phase 8: Styling And Verification

Add jigsaw-specific styles to `examples/react-crdt/src/style.css` or colocate styles consistently with the existing app conventions.

Verification commands:

```sh
cd examples/react-crdt
npm exec vitest -- run src/apps/jigsaw
npm run build
```

Manual verification:

- open the app in local simulator or solo mode
- confirm a 12-piece puzzle appears with the hue/lightness gradient
- unplaced pieces start around the border
- reshuffle changes only local unplaced positions
- dragging a single piece writes its position
- dragging a connected component moves all pieces locally
- dropping near all correct neighbors creates all eligible connections
- connected pieces derive positions from the selected anchor
- snapping onto an already-positioned component makes that destination component's placement authoritative
- Undo/Redo still works for position and connection patches

## Deferrals

Do not include these in the first implementation:

- user-selectable piece count at document creation
- remote drag previews
- separate image artifacts
- non-rectangular jigsaw tabs/holes
- connection removal or piece separation UI
