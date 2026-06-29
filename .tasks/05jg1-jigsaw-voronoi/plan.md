# Plan: Voronoi Jigsaw Board

## Decisions From Research

- Add a board generation selector to the create-document dialog.
- Do not store board type on `JigsawBoardArtifact`; generated artifacts remain fully concrete geometry.
- Keep old rectangular artifacts loadable.
- Voronoi generation does not need to be deterministic. Use normal random generation when creating a new board.
- Use straight-edged Voronoi cells for this board type.
- Use bounding-box center as the piece center/anchor.
- Scale perturbation independently for non-square cells: x movement from `cellWidth`, y movement from `cellHeight`.
- A dependency is acceptable, but the supported piece counts are small enough that an internal half-plane clipper is also reasonable.

## Phase 1: Artifact Shape And Compatibility

Update `examples/react-crdt/src/apps/jigsaw/artifacts.ts`.

1. Add per-piece bounds:

   ```ts
   bounds: {left: number; top: number; width: number; height: number}
   ```

   Bounds should be image-space coordinates relative to the piece center, so rendering can place the piece at `position + bounds.left/top`.

2. Keep `JigsawBoardArtifact` shape-agnostic. Do not add `boardType` or any generator provenance field.

3. Update rectangular generation so every rectangular piece includes bounds matching the existing cell rectangle.

4. Preserve old artifact loading:
   - Accept existing serialized pieces that do not have `bounds`.
   - Synthesize rectangular bounds from `pieceCount`, grid position, and existing center when loading/validating old artifacts.
   - Avoid rejecting otherwise-valid v1 rectangular artifacts solely because `bounds` is missing.

5. Decide whether to keep `JIGSAW_BOARD_VERSION = 1` with compatibility normalization or bump to `2` while still loading old data. Prefer the smallest compatible change unless the artifact store expects version changes for shape changes.

## Phase 2: Voronoi Board Generation

Implement a Voronoi generation path in `artifacts.ts`.

1. Add a creation-time option:

   ```ts
   generateJigsawBoard(pieceCount, {type: 'rectangular' | 'voronoi'})
   initialJigsawArtifacts(pieceCount, {type})
   ```

   Exact parameter shape can follow local style, but the type must not be serialized into the artifact.

2. Reuse `gridForPieceCount(pieceCount)` for supported counts.

3. Generate one seed per grid cell:
   - Start at the grid cell center.
   - Perturb by random x/y offsets using independent cell dimensions.
   - Keep displacement in the requested `.25 <= d <= .5` spirit, interpreted per axis for non-square cells.
   - Clamp seeds inside the image bounds.

4. Build Voronoi polygons:
   - Use an internal half-plane polygon clipper or a small dependency if that ends up simpler.
   - Clip each cell against the board rectangle.
   - Keep polygon coordinates in image space.

5. Convert each polygon into a concrete `JigsawPiece`:
   - Compute the polygon bounding box.
   - Use bounding-box center as `piece.center`.
   - Store bounds relative to that center.
   - Convert polygon vertices to `PathSegment[]` local to the center.

6. Detect neighbors from shared polygon edges:
   - Compare polygon edges using a floating-point tolerance.
   - Treat non-trivial shared edge overlap as adjacency.
   - Add reciprocal neighbor records.
   - Compute neighbor offsets from piece centers.

## Phase 3: Rendering Variable-Size Pieces

Update `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`.

1. Stop assuming every piece uses `estimatedPieceSize(board)` for its actual canvas/button dimensions.

2. Size each rendered piece from `piece.bounds`:
   - CSS `--piece-width = piece.bounds.width`
   - CSS `--piece-height = piece.bounds.height`
   - CSS left/top from rendered center plus `piece.bounds.left/top`

3. Update `PieceCanvas` to draw from each piece's image-space bounds rather than a uniform crop around `center`.

4. Keep mask clipping as-is conceptually, but draw local mask coordinates against the piece's own width/height.

5. Keep minimap behavior center-based for now. It does not need to render polygon silhouettes.

## Phase 4: Layout Helpers

Update `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`.

1. Replace or supplement `estimatedPieceSize(board)` with helpers that work for variable-size pieces:
   - max piece width/height for board padding and reshuffle margins.
   - average or max piece size for snap threshold, whichever feels better in practice.

2. Keep connection, component, depth, snap, and patch logic unchanged unless tests expose an assumption about rectangular grids.

3. Ensure `arrangeUnplacedPieces` still spreads variable-size pieces cleanly around the board perimeter. Bounding-box centers should make this mostly compatible.

## Phase 5: Create-Document UI

Update `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`.

1. Extend document init params with a creation-time generation type, for example:

   ```ts
   type JigsawDocumentInitParams = {
       pieceCount: JigsawPieceCount;
       type: 'rectangular' | 'voronoi';
   };
   ```

2. Add a selector to `renderFields` for rectangular vs Voronoi.

3. Default conservatively:
   - Keep existing rectangular behavior as the default unless product direction changes.
   - Let users choose Voronoi explicitly.

4. Validate the new field.

5. Pass the selected type into `initialJigsawArtifacts`.

## Phase 6: Tests

Update `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`.

1. Update rectangular board tests:
   - Rectangular pieces include bounds.
   - Existing estimated-size expectations still pass or are replaced with max-piece-size expectations.
   - Reciprocal neighbor offset tests continue to pass.

2. Add Voronoi artifact tests:
   - Correct piece count for each supported count or at least representative counts.
   - Each piece has finite center, finite positive bounds, a non-empty mask, and valid neighbors.
   - Masks fit inside piece bounds.
   - Neighbor entries are reciprocal and offsets are inverse.
   - Neighbor pairs are accepted by `validConnections`; obvious non-neighbors are rejected.
   - Total polygon area approximately equals image area.

3. Add compatibility coverage:
   - A legacy rectangular artifact without `bounds` can be loaded or normalized.

4. Add document init coverage:
   - Valid rectangular and Voronoi params pass.
   - Invalid generation type fails.
   - `initialArtifacts` uses the selected generator.

## Phase 7: Visual And Interaction Verification

Run focused automated tests first, then verify the app visually.

1. Run the jigsaw unit tests.

2. Run the existing jigsaw smoke test if available and not too costly.

3. Start the React CRDT example dev server.

4. Create a Voronoi jigsaw document and verify:
   - Pieces render with straight polygon edges.
   - Image crops line up when pieces are joined.
   - Dragging and snapping still work.
   - Reshuffle does not overlap or hide pieces badly.
   - Minimap and pan/zoom still behave normally.

5. If visual issues appear, adjust piece bounds, padding, or rendering crop logic before changing CRDT/layout code.

## Suggested Implementation Order

1. Add bounds to rectangular pieces and update rendering to use bounds.
2. Add compatibility normalization for old artifacts.
3. Update tests for rectangular behavior.
4. Add Voronoi polygon generation and neighbor detection.
5. Add create-dialog selector.
6. Add Voronoi tests.
7. Run unit tests and visual verification.

This order keeps the risky rendering change separate from the Voronoi geometry work, making failures easier to diagnose.
