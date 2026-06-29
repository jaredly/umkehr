# Plan: 600-Piece Jigsaw Performance

## Decisions From Research

- The performance problem covers all major interactions: initial load, reshuffle, dragging, connected-component dragging, panning/zooming, syncing, and undo/redo.
- Per-piece keyboard focus is not important enough to constrain the high-count renderer.
- The 600-piece rectangular board should use a more balanced `30 x 20` grid instead of `60 x 10`.
- Backdrops can be dropped across all piece counts, not only at high counts.
- 600-piece Voronoi boards should be supported.
- The target includes phones, so the solution should optimize every level rather than relying on desktop-only headroom.
- Do not add a user-facing renderer switch. Move the app to the better implementation path.

## Phase 1: Remove Duplicate Piece Rendering

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/style.css`

Tasks:

1. Remove the `.jigsawPieceBackdrop` render pass from `JigsawPanel`.
   - Delete the `backdropRefs` ref.
   - Delete the `usePieceMoveAnimation` call for backdrops.
   - Delete the first `board.pieces.map(...)` that renders `jigsawPieceBackdrop`.

2. Move any essential outline/shadow treatment into the visible `PieceCanvas`.
   - Keep the current mask stroke.
   - Add only cheap canvas-drawn styling if pieces become too hard to see.
   - Avoid CSS `drop-shadow(...)` across hundreds of elements.

3. Remove unused backdrop CSS.
   - Delete `.jigsawPieceBackdrop`.
   - Delete `.jigsawPieceBackdropCanvas`.
   - Remove backdrop-specific filter rules.

4. Keep the existing visible button/canvas layer working while later phases reduce React work further.

Acceptance criteria:

- The board renders one DOM piece per puzzle piece, not a visible layer plus backdrop layer.
- Pieces remain visually distinguishable.
- Existing drag, snap, undo, redo, pan, zoom, and minimap behavior still work.

## Phase 2: Fix 600-Piece Geometry

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Change `gridForPieceCount(600)` from `60 x 10` to `30 x 20`.

2. Update rectangular board tests to include 600 pieces.
   - Confirm `generateJigsawBoard(600)` returns 600 pieces.
   - Confirm `estimatedPieceSize(board)` or max-piece-size expectations match `720 / 30` by `540 / 20`.
   - Confirm reciprocal neighbor offsets still pass for 600.

3. Verify the document creation selector still includes `600`.

Acceptance criteria:

- 600 rectangular pieces are closer to normal puzzle proportions.
- Jigsaw unit tests cover the 600 rectangular board.

## Phase 3: Make Voronoi 600 Viable

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Measure or inspect `generateJigsawBoard(600, {type: 'voronoi'})`.
   - Current Voronoi generation clips each site against every other site, so 600 may be expensive.
   - Neighbor detection may also be expensive if it compares many polygon edges pairwise.

2. If 600 Voronoi creation is too slow, optimize the generator rather than disabling the option.
   - Use the known grid locality to compare each site only against nearby cells.
   - For clipping, consider a local candidate set around each site instead of all 600 sites.
   - For neighbor detection, bucket edges spatially or derive neighbors from clipping boundaries.

3. Add 600-specific Voronoi tests that avoid excessive assertions but catch shape validity.
   - Correct piece count.
   - Positive bounds and non-empty masks.
   - Reciprocal neighbor offsets for sampled or all pieces, depending on runtime.
   - `validConnections` accepts a sampled Voronoi neighbor.

Acceptance criteria:

- Creating a 600-piece Voronoi board is feasible on normal hardware.
- The app does not hang during document creation.
- Unit tests cover the supported 600-piece Voronoi path without making the suite unreasonably slow.

## Phase 4: Reduce React Work During Interaction

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- optionally `examples/react-crdt/src/apps/jigsaw/JigsawPieceView.tsx`
- optionally `examples/react-crdt/src/apps/jigsaw/jigsawRender.ts`

Tasks:

1. Extract a memoized piece component.
   - Suggested name: `JigsawPieceView`.
   - Props should be primitive or stable where possible: piece index, position numbers, bounds numbers, placed/active/snapped flags, z-index, read-only state.
   - Use `React.memo` with either default shallow comparison or a small custom comparator.

2. Avoid passing fresh object props to every piece.
   - Avoid passing full `piece`, `component`, or style objects unless memoization can compare them cheaply.
   - Compute CSS variable strings inside the memoized component from primitive props.

3. Separate viewport state from piece rendering as much as possible.
   - Panning/zooming should update the parent `.jigsawCanvas` transform without forcing all pieces to recalculate.
   - The current CSS parent transform is good; preserve it.

4. Keep drag state updates from invalidating every piece.
   - Short-term: ensure only pieces in the active component receive changed position/active props during drag.
   - Longer-term: use imperative transform updates for active drag movement and commit React/CRDT state on pointer up.

Acceptance criteria:

- Dragging one piece does not require meaningful work from all 600 piece components.
- Pan/zoom remains smooth because it updates the canvas transform instead of each piece.
- Code remains local to the jigsaw app and does not change CRDT semantics.

## Phase 5: Add A Single-Canvas Main Renderer

This is the likely end-state if the DOM piece layer remains too slow on phones. Because keyboard focus is not a hard requirement, this can become the default renderer rather than an optional comparison mode.

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- new file, likely `examples/react-crdt/src/apps/jigsaw/JigsawCanvasBoard.tsx`
- optional helper file, likely `examples/react-crdt/src/apps/jigsaw/jigsawHitTest.ts`

Tasks:

1. Introduce a main board canvas component.
   - Draw the solved image.
   - Draw unplaced and placed pieces from `renderedPositions`.
   - Draw active/dragged pieces last for z ordering.
   - Draw snap pulse or selection feedback directly in canvas, if still needed.

2. Cache expensive piece drawing.
   - Pre-render each piece image/mask once into an `HTMLCanvasElement` or `ImageBitmap`.
   - Reuse cached piece bitmaps during board redraws.
   - Rebuild cache only when the board artifact or source image changes.

3. Add hit testing.
   - Convert pointer screen coordinates to image/canvas coordinates using the existing viewport helpers.
   - Search pieces from topmost to bottommost.
   - Prefer mask-aware hit testing for Voronoi pieces if rectangular bounds feel inaccurate.
   - A bounds-first check is acceptable as a first pass, with mask testing added for precision.

4. Reuse existing drag and snap logic.
   - Keep `buildPuzzleLayout`, `snapCandidates`, `positionPatch`, and `connectionPatch`.
   - The renderer should change input/output mechanics, not puzzle rules.

5. Use `requestAnimationFrame` for drag redraws.
   - Do not call React `setState` on every pointer move just to move pixels.
   - Store transient drag data in refs.
   - Commit final position and connections on pointer up.

6. Keep fallback DOM controls only where they are still useful.
   - Header actions remain normal buttons.
   - The minimap can remain SVG or move to canvas later if needed.

Acceptance criteria:

- The default board renderer uses one main canvas rather than hundreds of piece DOM nodes.
- Dragging, snapping, pan, zoom, reshuffle, undo, and redo still work.
- 600-piece rectangular and Voronoi boards are usable on mobile-sized viewports.

## Phase 6: Optimize Arrangement And Minimap

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`

Tasks:

1. Measure `arrangeUnplacedPieces` for 600 pieces.
   - If it is slow, add a cheaper high-density arrangement algorithm.
   - Since the plan is to optimize every level, the new algorithm should be good enough to use for all counts if it behaves well visually.

2. Prefer predictable shelf/ring placement over expensive collision search if needed.
   - Preserve the goal of spreading pieces around the solved image.
   - Avoid overlapping pieces enough for initial playability.

3. Simplify the minimap for high-density boards, ideally in a way that is acceptable for all counts.
   - Render rect approximations instead of full mask paths if path count is costly.
   - Or render minimap to canvas if SVG path updates become a measurable issue.

4. Avoid minimap updates on every drag frame if using the canvas renderer.
   - Update on drag end, or throttle to animation frames only when useful.

Acceptance criteria:

- Reshuffle does not feel like a long blocking operation.
- Minimap remains useful without becoming a major render cost.

## Phase 7: Mobile And Performance Verification

Files:

- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`
- optional new performance-oriented smoke spec under `examples/react-crdt/tests/smoke/`

Tasks:

1. Keep unit tests passing:

   ```sh
   npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts
   ```

2. Add or update Playwright smoke coverage.
   - Create a 600-piece rectangular jigsaw.
   - Create a 600-piece Voronoi jigsaw if test runtime is acceptable.
   - Verify the panel, viewport, board canvas, and minimap render.
   - Verify pan/zoom changes the viewport.
   - Verify dragging a piece changes state or visible position.
   - Verify reshuffle completes.

3. Add mobile viewport checks.
   - Use a `390px`-wide viewport.
   - Verify controls do not overlap.
   - Verify pan, zoom, and drag are still usable.

4. Manual verification on a phone or mobile simulator.
   - Initial document creation.
   - Panning and pinch/zoom behavior.
   - Dragging one piece.
   - Dragging a connected component.
   - Reshuffle.
   - Undo/redo after moves and snaps.

Acceptance criteria:

- 600-piece rectangular puzzle is usable at desktop and phone widths.
- 600-piece Voronoi puzzle is supported and does not freeze creation.
- Existing lower piece counts remain at least as usable as before.

## Suggested Implementation Order

1. Drop the backdrop layer globally.
2. Change 600 rectangular grid to `30 x 20` and add tests.
3. Measure and fix 600 Voronoi generation.
4. Extract/memoize piece rendering to reduce immediate React churn.
5. If phone performance is still weak, replace the main board with a single-canvas renderer.
6. Optimize unplaced-piece arrangement and minimap rendering based on what profiling shows.
7. Add focused desktop and mobile smoke coverage.

The first three steps are low-risk and reduce obvious cost. The single-canvas renderer is the larger architectural move, but it matches the stated product constraints better than an SVG rewrite.
