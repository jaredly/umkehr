# Plan: Jigsaw Tabs Board Mode

## Decisions

- Add tabs as a board-creation checkbox that applies to both `rectangular` and `voronoi` boards.
- Do not introduce deterministic seeded generation. Existing `Math.random()` behavior is acceptable for this example.
- Use tab radius based on grid cell size: `min(boardWidth / grid.cols, boardHeight / grid.rows) / 10`, further constrained by edge length and neighboring tab-dot spacing.
- Very short Voronoi edges can remain straight.
- Tab direction is a plain random coin flip per shared edge.
- Tests only need geometry validity, not exact curved area preservation.
- The minimap may use a simplified polygon preview if exact curved rendering becomes expensive.

## Phase 1: Board Options And Creation UI

Update the board creation data flow so `tabs` is an explicit creation option.

- Extend `JigsawDocumentInitParams` in `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx` with `tabs?: boolean`.
- Update `documentInit.defaultParams()` to include a default, likely `tabs: false`.
- Add a `Tabs` checkbox to `renderFields`.
- Include `tabs` in `validate(input)` results, preserving the current default behavior when old callers omit it.
- Pass `tabs` through `initialArtifacts(params)`.
- Extend `JigsawBoardOptions` in `examples/react-crdt/src/apps/jigsaw/artifacts.ts` with `tabs?: boolean`.
- Update title generation so tabbed boards are recognizable, for example `30 piece tabbed hue puzzle` and `30 piece tabbed Voronoi hue puzzle`.

## Phase 2: Refactor Geometry Inputs

Make rectangular and Voronoi generation expose the same internal geometry shape: image-space piece polygons plus shared edge records.

- Add internal types in `artifacts.ts` for generated polygons and shared edges.
- For rectangular boards:
  - Build one image-space four-corner polygon per cell.
  - Build shared edge records for internal horizontal and vertical grid boundaries.
  - Keep border edges out of shared edge records so border edges stay straight.
- For Voronoi boards:
  - Keep the current perturbed-site and cell clipping flow.
  - Replace or augment `neighborsForPolygons` so it returns exact shared edge endpoints in addition to neighbor offsets.
  - Reuse shared edge records for both neighbor creation and tab generation.
- Preserve current centers and neighbor offsets so snapping and connected-component layout remain stable.

## Phase 3: Tab Spec Generation

Generate tab data from shared edges before converting polygons to masks.

- Compute the tab dot for each shared edge at the edge midpoint.
- Compute a base radius from grid cell size: `min(imageSize.width / grid.cols, imageSize.height / grid.rows) / 10`.
- Constrain radius by:
  - half the distance to every other tab dot minus a small margin,
  - a fraction of the shared edge length,
  - a minimum usable radius threshold.
- If the constrained radius is too small, omit the tab and leave that edge straight.
- Assign `outwardPiece` by `Math.random() < 0.5 ? edge.a : edge.b`.
- Store tab specs in a map keyed by unordered piece pair plus canonical edge endpoints, or another key that both pieces can resolve consistently.

## Phase 4: Mask Generation With Semicircle Edges

Convert each image-space polygon into a piece-local mask, inserting `line -> semicircle -> line` segments on tabbed shared edges.

- Replace `polygonToMask` for tabbed boards with a path builder that walks the original polygon edge order.
- For each polygon edge:
  - Find a matching tab spec if this edge is shared and not skipped.
  - Emit a line to the tab start point.
  - Emit two `Cubic` segments approximating the semicircle.
  - Emit a line to the original edge end.
- Ensure neighboring pieces produce complementary geometry:
  - If the current piece is `outwardPiece`, bulge outward from that piece.
  - If not, bulge inward to form the matching socket.
  - Account for reversed traversal of the same shared edge.
- Keep border and skipped short edges as straight `Line` segments.
- Continue emitting existing rectangular and Voronoi straight masks when `tabs` is false.

## Phase 5: Bounds And Rendering Compatibility

Ensure tabbed masks produce correct canvases and do not break existing layout behavior.

- Compute `bounds` from the final mask geometry, not only the original polygon.
- Include cubic control points in the bounds calculation for a conservative result.
- Verify that expanded bounds still work with `PieceCanvas` source-image cropping.
- Leave `JigsawPanel.tsx` rendering mostly unchanged because `drawMaskPath` already supports `Cubic`.
- Review `JigsawMinimap.tsx` performance for 600-piece tabbed boards.
- If exact minimap curves are too costly or visually noisy, simplify minimap masks to straight-line polygon outlines while keeping full tabbed masks for piece canvases.

## Phase 6: Tests

Update `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts` with focused coverage.

- Creation validation:
  - accepts `tabs: true`,
  - defaults missing `tabs` predictably,
  - passes `tabs` into generated artifacts.
- Rectangular tabbed generation:
  - produces the requested piece count,
  - has at least one curved mask segment,
  - keeps reciprocal neighbors,
  - has finite positive bounds for every piece.
- Voronoi tabbed generation:
  - produces the requested piece count,
  - has at least one curved mask segment,
  - allows short edges to remain straight,
  - keeps reciprocal neighbors,
  - has finite positive bounds for every piece.
- Serialization/loading:
  - tabbed boards serialize and reload through `jigsawArtifactStore`,
  - artifact validation accepts masks containing `Cubic` segments.
- Placement:
  - `arrangeUnplacedPieces` works for at least one tabbed rectangular and one tabbed Voronoi board without bounding-box overlap.
- Avoid using the existing polygon-area helper for tabbed curved masks unless it is replaced with a curved path sampler.

## Phase 7: Manual Verification

Run automated checks first, then do a visual browser pass.

- Run the jigsaw unit tests, for example:

```sh
npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts
```

from `examples/react-crdt` if that is the established package context.

- Start the React example app.
- Create and inspect:
  - rectangular board without tabs,
  - rectangular board with tabs,
  - Voronoi board without tabs,
  - Voronoi board with tabs.
- Check 12, 30, and at least one larger board size.
- Verify pieces drag, snap, reshuffle, undo, redo, preview image, and minimap behavior.
- Pay special attention to edge pieces and tabs near image borders.

## Risks

- Shared-edge matching for Voronoi polygons may be the trickiest part because current code only detects overlap and discards endpoints.
- Bounds that are too tight will visibly clip tabs; bounds that are too loose will hurt arrangement density and may cause confusing click targets.
- Curved masks can make the existing total-area tests invalid unless tests avoid polygon-only area math.
- Large 600-piece tabbed boards may increase render cost because each piece can have several cubic segments.
