# Plan: Wrapping Jigsaw Board Surface

## Decisions

- Add `surface?: 'torus' | 'plane'` to the board artifact. Missing means `plane`.
- Do not serialize `surface: 'plane'` for newly generated plane boards.
- Add a user-facing `Surface` selector in the jigsaw document creation form.
- Support torus for both rectangular and Voronoi boards in this task.
- Use shortest wrapped neighbor offsets, not planar artifact offsets.
- It is acceptable for solved/connected torus components to unwrap past the image bounds.
- Snapping across seams must work.
- Tabbed torus boards should put tabs/sockets on wrap seams.
- Normal, non-seamless uploaded images are acceptable; visible image seams are fine.
- Add wrap-aware image sampling because torus tabs and Voronoi seam cuts can place source regions
  outside a single image tile.

## Phase 1: Surface Model And Creation UI

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/model.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/scripts/jigsaw-board-svg.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Add:

   ```ts
   export type JigsawSurface = 'plane' | 'torus';
   ```

2. Extend `JigsawBoardArtifact` with `surface?: JigsawSurface`.
3. Extend `JigsawBoardOptions` with `surface?: JigsawSurface`.
4. Add `isJigsawSurface(input)` validation.
5. Update `normalizeJigsawBoardArtifact`:
   - accept missing surface,
   - accept explicit `plane` and `torus`,
   - reject invalid surface values,
   - omit `surface` from normalized plane boards unless preserving an explicitly loaded `plane`
     value is simpler locally.
6. Update board generation so:
   - `surface: 'torus'` is emitted for torus boards,
   - plane boards omit `surface`.
7. Export the new type through `model.ts`.
8. Extend `JigsawDocumentInitParams` with `surface?: JigsawSurface`.
9. Add a `Surface` selector to document creation with `Plane` and `Torus`.
10. Default to `surface: 'plane'` in creation params, but keep generated plane artifacts without
    the field.
11. Pass `surface` through validation and `initialArtifacts`.
12. Update `jigsaw-board-svg.ts` option typing/help text so scripts can generate torus boards.

Acceptance criteria:

- Existing board artifacts without `surface` still load.
- New plane boards preserve existing artifact shape except for unrelated current worktree changes.
- New torus boards serialize with `surface: 'torus'`.
- The create-document UI can create both plane and torus puzzles.

## Phase 2: Shared Wrap Geometry Primitives

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Introduce internal helpers for surface behavior:
   - `surfaceForOptions(options): JigsawSurface`
   - `surfaceForBoard(board): JigsawSurface`
   - `wrappedDelta(from, to, imageSize): Coord`
   - `wrapShiftForDelta(from, to, imageSize): Coord` if useful for seam metadata.
2. Use shortest wrapped offsets for torus neighbor offsets:
   - choose the x delta in `[-width / 2, width / 2]`,
   - choose the y delta in `[-height / 2, height / 2]`,
   - keep existing center difference for plane boards.
3. Extend internal `SharedEdge` records with optional wrap metadata:

   ```ts
   type SharedEdge = {
       a: number;
       b: number;
       start: Coord;
       end: Coord;
       wrap?: Coord;
   };
   ```

   The exact shape can differ, but the generator needs to know when an edge crosses a seam and which
   periodic copy it represents.

4. Update `neighborsFromSharedEdges` to use wrapped offsets for torus boards.
5. Keep reciprocal offsets exact inverses.

Acceptance criteria:

- Unit tests can assert shortest seam offsets without involving the renderer.
- Plane boards keep current offset behavior.
- Torus wrap neighbor offsets are small local displacements.

## Phase 3: Rectangular Torus Generation

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Keep existing rectangular cell polygons and internal shared edges for plane behavior.
2. For `surface === 'torus'`, add wrap shared edges:
   - right edge of each row connects last column to first column,
   - bottom edge of each column connects last row to first row.
3. Represent wrap edges in an unwrapped coordinate space so tab generation can build a real edge
   path:
   - the right seam can use the first-column piece shifted by `+imageSize.width`,
   - the bottom seam can use the top-row piece shifted by `+imageSize.height`.
4. For non-tabbed rectangular torus boards:
   - keep rectangular masks,
   - include wrap neighbors,
   - use shortest wrapped offsets.
5. For tabbed rectangular torus boards:
   - include wrap shared edges in tab spec generation,
   - generate complementary tab/socket masks on seam edges,
   - allow bounds to extend outside `[0, imageSize]`.

Acceptance criteria:

- Every rectangular torus piece has four logical neighbors.
- First/last columns are reciprocal neighbors with x offsets of one piece width.
- First/last rows are reciprocal neighbors with y offsets of one piece height.
- Tabbed rectangular torus boards have curved seam edges instead of flat outer edges.

## Phase 4: Periodic Voronoi Torus Generation

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Keep plane Voronoi generation unchanged except for shared helpers and option plumbing.
2. Add a torus Voronoi path that computes cells against periodic site copies:
   - generate original sites in the base image rectangle,
   - build periodic copies shifted by `-width`, `0`, `+width` and `-height`, `0`, `+height`,
   - clip each source site against nearby periodic copies,
   - record the original neighbor piece id plus the periodic shift for each shared edge.
3. Store each cell mask in a local unwrapped coordinate system around the source piece center.
4. Keep piece centers in base image coordinates for image reference and minimap coloring.
5. Use shortest wrapped offsets for neighbor offsets.
6. Include periodic shared edges in tab generation when `tabs === true`.
7. Keep radius and short-edge skipping conservative so periodic edge tabs do not self-intersect
   badly.
8. If a periodic cell crosses the chosen image cut, allow its mask/bounds to extend outside the base
   image rectangle.

Acceptance criteria:

- Voronoi torus boards have no boundary-induced edge pieces.
- Neighbor relationships are reciprocal, including seam neighbors.
- Sample 12, 30, 60, and at least one large supported count produce finite centers, masks, bounds,
  and reciprocal offsets.
- Tabbed Voronoi torus boards include curved segments on ordinary and seam edges where geometry
  permits.

## Phase 5: Wrap-Aware Piece Rendering

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Replace direct single-rectangle source sampling in `PieceCanvas` with a helper like:

   ```ts
   drawWrappedImageRegion(context, source, sourceX, sourceY, width, height)
   ```

2. Split requested source regions at image boundaries and draw each chunk from modular source
   coordinates.
3. Support wrapping on x, y, and both axes.
4. Keep image smoothing behavior consistent with the current renderer.
5. Use the helper for all boards, or only when `surface === 'torus'`; using it universally is simpler
   if it preserves current plane output.
6. Keep `SolvedImageCanvas` as a single image tile for now.
7. Keep `JigsawMinimap` planar and simple, but ensure it can display pieces whose bounds/masks extend
   outside the base image rectangle.

Acceptance criteria:

- Torus seam tabs and Voronoi pieces do not render transparent gaps solely because their crop crosses
  an image boundary.
- Uploaded images and the stock hue image both wrap correctly.
- Plane rendering does not regress.

## Phase 6: Snapping, Layout, And Viewport Behavior

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Verify `positionsForComponent` works with shortest wrapped offsets as an unwrapped planar
   embedding.
2. Add tests for components that cross one seam and both seams.
3. Verify `snapCandidates` detects seam snaps using shortest wrapped offsets.
4. Confirm cycles do not cause crashes or infinite loops:
   - `positionsForComponent` should continue to assign each piece once,
   - revisits through a different wrap cycle can be ignored for now.
5. Review initial viewport fitting:
   - the board image can remain the first viewport anchor,
   - connected components may later extend outside it.
6. Review minimap content bounds so unwrapped components outside the image remain visible.
7. Do not canonicalize solved torus components back into one image rectangle in this task.

Acceptance criteria:

- Dragging a seam-adjacent piece close to its wrapped neighbor creates a snap candidate.
- Connected seam components render as unwrapped components that may cross image bounds.
- The UI remains navigable through pan/zoom/minimap when pieces cross image bounds.

## Phase 7: Tests

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- Optional focused tests for rendering helpers if the local test setup can exercise canvas logic.

Tasks:

1. Artifact compatibility:
   - missing `surface` loads as plane,
   - invalid `surface` is rejected,
   - torus board serializes and reloads,
   - plane board generation omits `surface`.
2. Creation validation:
   - accepts `surface: 'plane'`,
   - accepts `surface: 'torus'`,
   - rejects invalid surface values,
   - passes surface into initial artifacts.
3. Rectangular torus:
   - every piece has four neighbors,
   - first/last columns are reciprocal seam neighbors,
   - first/last rows are reciprocal seam neighbors,
   - seam offsets use shortest wrapped displacement,
   - `validConnections` accepts seam connections.
4. Rectangular torus with tabs:
   - has curved seam masks,
   - finite positive bounds,
   - masks fit bounds,
   - reciprocal neighbors remain valid.
5. Voronoi torus:
   - finite centers, masks, and bounds,
   - no boundary pieces caused by clipping to a plane rectangle,
   - reciprocal seam neighbors and offsets,
   - representative `validConnections` accepts seam and ordinary neighbors.
6. Voronoi torus with tabs:
   - at least one curved segment,
   - finite positive bounds,
   - masks fit bounds,
   - reciprocal neighbors remain valid.
7. Snapping/layout:
   - seam snap candidates are generated when pieces are placed at wrapped offsets,
   - `buildPuzzleLayout` can lay out a component crossing a seam,
   - solved connection totals reflect torus adjacency.
8. Rendering helper:
   - source region crossing left/right samples from both sides,
   - source region crossing top/bottom samples from both sides,
   - source region crossing both axes samples all required tiles.

Acceptance criteria:

- Focused unit tests cover artifact, geometry, snapping, and layout behavior.
- Rendering helper tests cover the image wrapping math even if browser visual QA remains manual.

## Phase 8: Manual Verification

Commands:

```sh
npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts
npm run dev
```

Run commands from `examples/react-crdt` unless the repo script conventions change.

Manual cases:

- Rectangular plane, no tabs.
- Rectangular torus, no tabs.
- Rectangular torus, tabs.
- Voronoi plane, no tabs.
- Voronoi torus, no tabs.
- Voronoi torus, tabs.
- Repeat at 12 and 30 pieces; sample at least one larger count.
- Repeat one torus case with an uploaded image.

Check:

- document creation fields validate and persist,
- pieces render without clipped/transparent seam artifacts,
- seam pieces can snap,
- connected components may unwrap beyond the image and remain draggable,
- reshuffle still keeps unplaced pieces usable,
- preview image, minimap, pan, zoom, undo, and redo still behave.

## Risks

- Periodic Voronoi is the largest geometry risk. Shared edge detection must preserve the periodic
  neighbor id and shift, not only the clipped polygon shape.
- Wrap seam tabs can create out-of-image bounds, so rendering must be updated before relying on
  tabbed torus visuals.
- A single absolute position per piece is acceptable for unwrapped layout, but it means closed torus
  cycles will not draw duplicate piece copies. This should be documented in code/tests where
  relevant.
- Existing area tests for plane Voronoi may not translate directly to periodic masks that cross the
  image cut.
- Large tabbed periodic Voronoi boards may increase render cost because masks can be more complex.
