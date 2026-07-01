# Plan: Jigsaw Torus Rendering

## Decisions

- Apply the new wrapped sub-canvas behavior only when `board.surface === 'torus'`.
- Keep plane boards on the current single-canvas rendering path unless shared helpers naturally apply.
- The torus sub-canvas has independent pan only. It does not have independent zoom.
- Existing outer viewport pan/zoom remains available for navigating the whole jigsaw workspace.
- Unplaced pieces render outside the torus sub-canvas, in the outer workspace.
- Dropping a single placed piece outside the torus sub-canvas removes its stored position and makes it unplaced.
- Do not allow connected groups to be made unplaced. If a connected group is dropped outside the torus sub-canvas, cancel the drop and leave state unchanged.
- Existing connections remain intact; this task does not break connected groups apart.
- Dragging across torus edges should wrap live, not only after drop.
- The minimap should visualize torus pan.
- Torus panning remains enabled in read-only/history views.

## Phase 1: Torus Geometry Helpers

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- optional new helper file, for example `examples/react-crdt/src/apps/jigsaw/torus.ts`

Tasks:

1. Add reusable helpers for torus coordinate handling:
   - positive modulo for one axis,
   - canonicalize a point into `[0, width) x [0, height)`,
   - shortest wrapped delta between two points,
   - wrapped distance,
   - nearest equivalent point to preserve continuous drag deltas across seams.
2. Add rectangle/copy helpers:
   - compute render copies for a piece from canonical position plus torus pan,
   - include x/y/corner copies when bounds cross an edge,
   - filter copies to those intersecting the torus viewport.
3. Add helpers for torus drop classification:
   - screen/outer-canvas point to torus-local coordinates,
   - `isInsideTorusViewport(point, imageSize)`.
4. Add a remove-position patch helper for jigsaw positions:

   ```ts
   removePositionPatch(piece: number): DraftPatch<JigsawState>
   ```

5. Add a helper for outside-drop patches:
   - if dragging one piece, remove that piece's stored position if it exists;
   - if dragging a connected group, return no patches and report that the drop should be cancelled.

Tests:

- Canonicalization handles negative and oversized coordinates.
- `nearestEquivalentPoint(...)` keeps deltas small across all four seams.
- Render-copy generation emits a bottom copy for top-edge overlap and corner copies for corner overlap.
- Copy filtering avoids emitting all nine copies when a piece is fully inside the torus viewport.
- Outside-drop helper removes a single stored position.
- Outside-drop helper cancels a connected group drop.

Acceptance criteria:

- Torus math is covered before changing the panel interaction code.
- Existing jigsaw placement tests still pass.

## Phase 2: Split Torus Rendering Layers

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/style.css`
- optional small component file if `JigsawPanel.tsx` gets too large

Tasks:

1. Keep the existing outer `.jigsawViewport` and `.jigsawCanvas` for the whole workspace.
2. For torus boards, render a nested `.jigsawTorusViewport` inside `.jigsawCanvas`:
   - positioned at `imageOffset`,
   - sized to `board.imageSize`,
   - clipped with `overflow: hidden`,
   - marked with `data-testid="jigsaw-torus-viewport"`.
3. Add a `.jigsawTorusCanvas` layer inside the torus viewport:
   - shifted by local torus pan,
   - marked with `data-testid="jigsaw-torus-canvas"`.
4. Render placed torus pieces inside the torus viewport as filtered wrapped copies.
5. Render unplaced pieces outside the torus viewport in the outer canvas.
6. Keep plane rendering close to the current path.
7. Add copy metadata:
   - keep `data-piece` as the logical piece id,
   - add `data-piece-copy` for tile/copy identity,
   - ensure duplicate copies have stable React keys.
8. Avoid assigning the same DOM ref to every copy of a piece:
   - use a single primary copy for `pieceRefs`, or
   - skip move animation for torus duplicate rendering until animation is refactored.

Acceptance criteria:

- Torus boards visibly have a finite clipped image-domain sub-canvas.
- Pieces crossing an edge render on the opposite edge too.
- Unplaced pieces remain outside the torus sub-canvas but inside the outer workspace.
- Plane boards do not visually regress.

## Phase 3: Torus Pan And Pointer Mapping

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/style.css`

Tasks:

1. Add local torus pan state:

   ```ts
   type TorusViewport = {panX: number; panY: number};
   ```

2. Pan behavior:
   - empty-space drag inside the torus sub-canvas pans the torus layer;
   - empty-space drag outside the torus sub-canvas keeps using outer viewport pan;
   - normal wheel over the torus sub-canvas pans torus content;
   - modifier-wheel keeps using the existing outer zoom around the pointer;
   - torus pan wraps/modulos so values do not grow without bound.
3. Keep torus pan enabled when `readOnly` is true.
4. Update pointer conversion for torus pieces:
   - screen to outer canvas via existing outer viewport transform,
   - subtract `imageOffset`,
   - subtract torus pan,
   - canonicalize for stored positions,
   - use nearest-equivalent coordinates for drag deltas.
5. Track enough drag state to support live wrapping:
   - whether the drag started from a torus copy,
   - the copy offset or unwrapped pointer start,
   - the previous unwrapped pointer point, if needed.

Acceptance criteria:

- Panning the torus changes placed-piece copies without moving unplaced pieces.
- Outer viewport pan/zoom still works.
- Dragging across a torus edge is continuous and visually wraps live.
- Read-only/history panels allow torus panning but not piece placement changes.

## Phase 4: Drop And Snap Semantics

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. In `finishDrag(...)`, branch for torus boards.
2. On torus drop outside the sub-canvas:
   - if `drag.component.length === 1`, dispatch `removePositionPatch(...)` only when a stored position exists;
   - if `drag.component.length > 1`, cancel the drop and dispatch nothing;
   - do not create snap connections.
3. On torus drop inside the sub-canvas:
   - canonicalize the anchor position into the image domain before writing it,
   - keep connected components placed,
   - keep existing connections.
4. Make torus snap detection wrap-aware:
   - either add `torusSnapCandidates(...)`, or
   - extend `snapCandidates(...)` with an optional distance function/image size for torus boards.
5. Use wrapped distance when comparing `expected` and `neighborPosition` for torus boards.
6. Keep plane snap behavior unchanged.
7. Confirm live-drag rendered positions are canonicalized only at persistence boundaries; while dragging, keep the unwrapped value needed for smooth motion.

Tests:

- Torus seam snapping works when two logical neighbors are visually adjacent across an edge.
- Single-piece outside drop removes its position and does not add connections.
- Connected-group outside drop dispatches nothing and leaves positions unchanged.
- Inside drop canonicalizes negative/oversized positions.
- Plane board drag/drop behavior is unchanged.

Acceptance criteria:

- A single placed torus piece can be moved back to the unplaced area by dropping outside the torus sub-canvas.
- A connected group cannot be made unplaced by dropping outside.
- Snapping still works across torus seams.

## Phase 5: Minimap Torus Pan Visualization

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/style.css`

Tasks:

1. Extend `JigsawMinimap` props with optional torus state:

   ```ts
   torus?: {
       imageSize: {width: number; height: number};
       panX: number;
       panY: number;
   }
   ```

2. Keep the minimap's main view rectangle tied to the outer viewport.
3. Draw canonical placed piece positions inside the image rectangle; do not draw every torus duplicate.
4. Add a subtle torus pan indicator:
   - for example, offset/repeated image-domain grid lines,
   - or a small translated outline/marker that shows the current torus phase.
5. Ensure minimap recentering still controls the outer viewport, not torus pan.
6. Keep minimap interaction accessible and avoid blocking core piece interactions.

Acceptance criteria:

- The minimap shows both outer viewport position and torus pan phase.
- Minimap click/drag still recenters the outer viewport.
- Torus pan changes are visible in the minimap.

## Phase 6: Styling And Responsiveness

Files:

- `examples/react-crdt/src/style.css`

Tasks:

1. Add styles for:
   - `.jigsawTorusViewport`,
   - `.jigsawTorusCanvas`,
   - torus edge/border treatment,
   - optional torus pan indicator styling in the minimap.
2. Make the torus sub-canvas visually distinct from the outer unplaced-piece workspace.
3. Keep all text/buttons/minimap from overlapping at desktop and mobile widths.
4. Ensure duplicate piece copies do not create unexpected focus outlines or layout shifts.
5. If every duplicate remains a button, verify keyboard/focus behavior is not confusing. If needed, make non-primary copies `aria-hidden` and non-tabbable while still pointer-interactive only where required.

Acceptance criteria:

- The torus surface reads as the actual puzzle board.
- Unplaced pieces clearly live outside the torus surface.
- No visible overlap or clipped controls on mobile or desktop.

## Phase 7: Automated And Manual Verification

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`
- possibly `examples/react-crdt/tests/helpers/documents.ts` if torus creation helpers need extension

Tasks:

1. Add unit tests from Phases 1 and 4.
2. Add Playwright smoke coverage:
   - create a torus jigsaw document,
   - verify `jigsaw-torus-viewport` and `jigsaw-torus-canvas` exist,
   - verify a near-edge piece has multiple rendered copies,
   - verify torus pan changes placed-piece copy positions without moving unplaced pieces,
   - verify a single placed piece dropped outside becomes unplaced,
   - verify a connected group dropped outside does not become unplaced.
3. Keep existing jigsaw smoke coverage passing for plane boards.
4. Run focused commands from `examples/react-crdt`:

   ```sh
   npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts
   pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts
   ```

5. Manual verification checklist:
   - rectangular torus board,
   - Voronoi torus board,
   - tabbed torus board,
   - custom uploaded image torus board,
   - local sync two-panel jigsaw,
   - read-only/history preview,
   - mobile viewport around `390px`.

Acceptance criteria:

- Focused unit and smoke tests pass.
- Live wrapping, torus panning, minimap pan visualization, and outside-drop behavior work in-browser.

## Implementation Notes

- Keep CRDT positions in source-image coordinates and canonicalize persisted torus positions.
- Keep local unplaced positions local-only, as today.
- Prefer small pure helpers for torus math so the panel does not absorb all complexity.
- Avoid rendering all 3x3 copies for every piece on large boards; copy filtering is required.
- Preserve user/worktree changes before editing files that are already modified.
