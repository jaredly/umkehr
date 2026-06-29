# Research: React CRDT Jigsaw Puzzle App

## Goal

Add a collaborative jigsaw puzzle app to `examples/react-crdt`.

The puzzle board should be immutable artifact data. CRDT state should contain only collaborative puzzle progress:

```ts
type State = {
    positions: Record<string, Coord>;
    connections: Record<string, true>;
};
```

The initial implementation can render rectangular pieces, but the artifact model should leave room for shaped masks and richer edge geometry later.

## Relevant Existing Structure

`examples/react-crdt/src/App.tsx` is only the shell. It selects an app from `examples/react-crdt/src/lib/appRegistry.ts` and renders it through one of the supported runtime wrappers:

- solo history
- local simulator
- local-first
- server
- PeerJS

The new jigsaw app should follow the existing app pattern under `examples/react-crdt/src/apps/*`:

- app definition and runtime exports in `JigsawApp.tsx`
- state/schema/context setup in `model.ts` and `schema.ts`
- immutable board artifact setup in `artifacts.ts`
- rendering in `JigsawPanel.tsx`
- pure puzzle layout/graph helpers in `jigsaw.ts`
- helper tests in `jigsaw.test.ts` and model/artifact tests as needed

Good reference files:

- `examples/react-crdt/src/apps/wordsearch/*`: app-local artifact store, ephemeral data validation, simple artifact-backed UI.
- `examples/react-crdt/src/lib/artifacts/index.ts`: shared artifact store shape, serialization, manifest, fingerprinting, initial artifact creation.
- `examples/react-crdt/src/lib/crdtApp.ts`: `AppDefinition`, `CrdtRuntime`, `HistoryRuntime`, and editor/panel contracts.
- `examples/react-crdt/src/apps/whiteboard/*`: drag interaction patterns and local-only transient pointer state.

Register the app in `examples/react-crdt/src/lib/appRegistry.ts` by importing `jigsawApp`, `jigsawCrdtRuntime`, and `jigsawHistoryRuntime`, then adding it to `registeredApps`.

## Existing Artifact Support

Wordsearch already created a generic artifact layer:

```ts
type ArtifactStore<TArtifact extends {id: string}> = {
    get(id: string): TArtifact | null;
    serialize(id: string): SerializedArtifact | null;
    load(artifact: SerializedArtifact): void;
    manifest(): ArtifactManifestEntry[];
    createInitial?(): SerializedArtifact[];
};
```

The jigsaw board should use this rather than adding another artifact mechanism.

Recommended artifact constants:

```ts
export const JIGSAW_BOARD_ARTIFACT_ID = 'board';
export const JIGSAW_BOARD_KIND = 'jigsaw-board';
export const JIGSAW_BOARD_VERSION = 1;
```

The store can mirror wordsearch:

- `get('board')` returns the loaded board.
- `serialize('board')` includes manifest metadata plus board data.
- `load(serialized)` validates kind/version/id/shape and checks `fingerprintHash`.
- `manifest()` returns the current board manifest.
- `createInitial()` generates a new board using the selected piece count.

The unresolved part is how the user selects piece count before `createInitial()` runs. See Open Questions.

## Recommended Types

Use string keys for state records because JSON object keys are strings and the CRDT patch paths use key segments.

```ts
export type Coord = {
    x: number;
    y: number;
};

export type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};

export type JigsawPiece = {
    center: Coord;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: string;
    imageSize: {width: number; height: number};
    pieceCount: 12 | 30 | 60 | 120;
    pieces: JigsawPiece[];
};

export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, true>;
};
```

I would make `image` an artifact-local string initially: a bundled image URL, generated data URL, or CSS-rendered test image identifier. The task sketch says `image: artifactId`; that is a better long-term direction, but it implies nested or related artifacts. For the first app, embedding the image reference in the board artifact keeps the CRDT state clean and avoids broad artifact API work.

Initial state:

```ts
export const initialJigsawState: JigsawState = {
    positions: {},
    connections: {},
};
```

## Board Generation

Start with rectangular pieces but generate the board with the future shape fields populated.

For piece counts `12`, `30`, `60`, and `120`, pick rectangular grids with reasonable aspect ratios:

- 12: `4 x 3`
- 30: `6 x 5`
- 60: `10 x 6`
- 120: `15 x 8`

Given image dimensions `W x H` and grid `cols x rows`:

- piece index is `row * cols + col`
- `center` is `{x: (col + 0.5) * W / cols, y: (row + 0.5) * H / rows}`
- `mask` is the rectangular path around the piece in image-local coordinates, relative to the piece center if that is easiest for rendering
- neighbors include left/right/up/down pieces only
- `offset` is `neighbor.center - piece.center`

For a rectangular first version, this gives enough data for all snap detection and component placement without border geometry detection.

## CRDT Schema And Runtime

Add `examples/react-crdt/src/apps/jigsaw/schema.ts` with Typia schema generation, matching wordsearch/rich-notes:

```ts
export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, true>;
};

export const JIGSAW_DOC_ID = 'umkehr-react-crdt-jigsaw-v1';
export const jigsawSchema = typia.json.schemas<[JigsawState], '3.1'>();
export const validateJigsawState = typia.createValidate<JigsawState>();
```

Add `model.ts` contexts:

```ts
export const [ProvideJigsawHistory, useJigsawHistory] =
    createHistoryContext<JigsawState, never, 'type'>('type');

export const [ProvideJigsaw, useJigsaw] =
    createSyncedContext<JigsawState, 'type', JigsawEphemeralData>('type', undefined, {
        validateEphemeralData: isJigsawEphemeralData,
        maxEphemeralBytes: 4096,
    });
```

Ephemeral data is not required for correctness. It is useful for remote drag previews later, but the task only requires drag state to be local-only. The first version can use `never` or define a small future-proof union and not publish it.

## Placement And Connection Helpers

Put the core logic in pure helpers so it can be tested independently of React:

- `validConnections(board, state.connections)` filters connection keys to edges that exist in `board.pieces[a].neighbors`.
- `connectedComponents(board, connections)` builds undirected components from valid directed edges.
- `pieceDepths(board, connections)` computes traversal depth with cycle condensation.
- `anchorPieceForComponent(board, state, component, depths)` chooses the placed node with greatest depth, tie-breaking by largest piece index.
- `relativeOffset(board, from, to, connections)` resolves the offset between any two pieces in the same valid component.
- `placedPiecePositions(board, state)` returns derived absolute positions for every piece in anchored components.
- `unplacedPieces(board, placedPositions)` returns pieces that still need local layout.
- `connectionPatchesForDrop(board, derivedPositions, droppedComponent, state)` creates valid new connection patches when pieces are within snap distance.

The task describes connections as directed edges (`A:B`) and says anchor depth is based on directed traversal. Placement itself should treat the connected component as an undirected set after invalid connections are discarded, because a connection `A:B` still means `A` and `B` are physically attached and both should move together.

## Anchor Depth Algorithm

The depth rule is specific enough that it should be treated as model logic, not UI code.

Recommended implementation:

1. Parse valid directed edges into adjacency and reverse-adjacency maps.
2. Build strongly connected components with Tarjan or Kosaraju.
3. Build a DAG of SCCs from valid directed edges.
4. SCC roots are components with no incoming SCC edges and start at depth `0`.
5. Propagate depth through the DAG, using `max(parentDepth + 1)`.
6. Assign each piece the depth of its SCC.
7. For each connected physical component, choose the piece with a CRDT `position` and the greatest depth; tie-break by largest piece index.

This matches the task's cycle requirement: all nodes in a cycle get the same depth, one greater than the highest-depth node that points into the cycle.

If a connected component has no positioned pieces, it is not globally placed. Its pieces should be included in the local unplaced layout unless they are currently being dragged locally.

## Position Derivation

The board's neighbor offsets are enough to derive all positions in a component.

For a component with anchor piece `A` at absolute position `P`:

- run BFS/DFS over valid physical neighbor edges inside the component
- if traversing from `i` to neighbor `j`, then `pos[j] = pos[i] + offset(i, j)`
- if traversing from `j` back to `i`, then `pos[i] = pos[j] - offset(i, j)`

Do not trust `state.positions` for every piece in a connected component. Only the anchor's CRDT position should determine the component. Other position records may be stale from earlier drags before connections formed.

When the user drags a connected component and drops it, only write the dropped/dragged piece's `position`. The anchor rule will decide whether that piece becomes authoritative. If this produces surprising behavior, the alternative is to write the selected anchor's position adjusted by the drag delta, but that slightly diverges from the task's "state.position is added" wording.

## Local Unplaced Layout

Unplaced pieces are local/transient presentation state. They should not be broadcast.

Recommended panel state:

```ts
type LocalPieceLayout = Record<string, Coord>;
```

On render:

- derive placed positions from CRDT state and board connections
- calculate which pieces are unplaced
- for unplaced pieces missing a local layout entry, assign positions around the viewport border
- keep existing local positions stable across CRDT updates where possible
- `Reshuffle unplaced pieces` regenerates only local positions for currently unplaced pieces

The helper can place pieces uniformly around the board/panel border by dividing unplaced pieces across four sides and spacing them by side length. Add a little deterministic jitter from a local seed if the first layout feels too regular.

Do not store this layout in CRDT state.

## Drag And Snap Flow

Interaction flow:

1. Pointer down on any piece.
2. Determine its current component from valid connections.
3. Capture the component's current derived/local positions.
4. During pointer move, apply local delta to every piece in that component.
5. On pointer up:
   - write a `positions[pieceIndex]` patch for the dragged piece's final center
   - detect snaps between every piece in the dragged component and its correct declared board neighbors outside the component
   - for each close correct-neighbor pair, add `connections["draggedPiece:neighborPiece"] = true` where the first index is the moved piece in that pair

Snap check:

```ts
const expectedNeighborPosition = movedPiecePosition + neighbor.offset;
const distance = hypot(actualNeighborPosition.x - expected.x, actualNeighborPosition.y - expected.y);
if (distance <= snapThreshold) connect;
```

Only correct neighbors declared in `board.pieces[piece].neighbors` should be checked. No arbitrary piece-pair matching, shape proximity, or border-to-border detection is needed. This means a connection represents solved/correct puzzle progress, not a temporary grouping that users need to break apart later.

Use a threshold in board/image coordinates, for example `8` to `16` pixels depending on image size. This should probably scale from piece size:

```ts
const snapThreshold = Math.max(8, Math.min(pieceWidth, pieceHeight) * 0.12);
```

## Rendering

For rectangular first version, rendering can be simple:

- a puzzle stage with absolute-positioned piece buttons/divs
- each piece uses the board image as a CSS background
- each piece clips to a rectangle initially
- piece dimensions come from the grid
- z-index raises active dragged component

For future shaped pieces, switch each piece to SVG:

- `<clipPath>` or `<mask>` from `PathSegment[]`
- `<image>` positioned so the correct source image area shows through the piece mask
- optional path stroke for piece borders

Even if the first version uses rectangular CSS clipping, keep helpers and artifact types in image-local coordinates so the SVG transition does not require state migration.

## Document Creation

The app currently relies on `app.artifacts?.createInitial()` when creating/exporting/importing app documents. Wordsearch generates a new puzzle in `createInitial()` with no user configuration.

Jigsaw needs a piece-count choice before board generation. Minimal options:

1. Add a local module-level setting in `jigsaw/artifacts.ts`, defaulting to `30`, and expose `setNextJigsawPieceCount(count)`. The panel's "New puzzle" or setup UI sets it before the runtime calls `createInitial()`.
2. Add an app-level `createInitialArtifacts(options)` API to `AppDefinition`. This is cleaner but touches shared document creation flows.
3. Generate a default `30` piece board first, then add a "New game" button inside the jigsaw panel that creates a replacement local document/artifact with the selected count. This depends on whether panel code can reach the document reset flow cleanly.

Recommended first pass: default to `30` in `createInitial()` and add the piece-count selection as a small follow-up unless the current document creation UI already has an easy hook for app-specific options.

## Tests

High-value unit tests:

- board generation creates exactly `12`, `30`, `60`, or `120` pieces with valid reciprocal neighbor offsets
- artifact serialize/load validates kind/version/fingerprint
- invalid connection keys are discarded
- components are built from valid physical neighbor connections
- depth calculation handles roots, multiple roots, max-depth merge, and cycles
- anchor selection uses greatest depth with largest index tie-break
- derived positions follow board offsets from the chosen anchor
- stale non-anchor `positions` do not distort a connected component
- snap detection only checks correct declared neighbors and emits directed connection keys from moved piece to neighbor
- unplaced layout is deterministic enough for tests when given a fixed container size/seed

Useful commands:

```sh
cd examples/react-crdt
npm exec vitest -- run src/apps/jigsaw
npm run build
```

The repo uses `pnpm` scripts too, but this package already has local dependencies installed. Match the command style used by nearby tasks when implementing.

## Open Questions

1. How should the user choose piece count at document creation time?

The current app contract exposes `artifacts.createInitial()` but does not pass app-specific options. Supporting 12/30/60/120 cleanly may require either a small shared API extension or a jigsaw-specific "new game" flow.

2. What image should the initial board use?

Options are a bundled static image, a generated SVG/data URL, or a CSS/color test image. A real bitmap is better for a jigsaw, but it adds asset handling and copyright/source decisions.

3. Should `image` inside `JigsawBoardArtifact` be an artifact id immediately?

The task sketch uses `image: artifactId`. Implementing that literally implies an image artifact plus a board artifact. That is architecturally nice, but the existing artifact store is flat and app-local. The first version can keep the image reference inside the board artifact and migrate later if binary/image persistence becomes a shared requirement.

4. When dragging a connected component, which position should be written on drop?

The task says the clicked/dragged piece gets a `state.position`. With the anchor-depth rule, dropping a lower-depth piece in a component may not visibly move the component if a deeper placed piece remains anchor. A more ergonomic behavior may be to write the current anchor's adjusted position instead.

5. Should snapping create one connection or all eligible connections?

When a component is dropped near multiple neighbors, creating all valid close connections feels natural and helps lock larger solved areas. Creating only the nearest connection is simpler and may avoid accidental multi-snaps.

6. How should z-order be represented?

No z-order exists in CRDT state. A local z-order based on recent drag is enough initially, but concurrent users may see different stacking for overlapping unconnected pieces.

7. Should remote drag previews be shown?

The task says drag state is local-only and not broadcast. That keeps implementation simple. If remote previews are desired later, add jigsaw ephemeral messages rather than CRDT state.
