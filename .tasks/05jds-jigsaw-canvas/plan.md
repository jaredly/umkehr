# Plan: Self-Contained Jigsaw Canvas

## Decisions From Research

- Empty-space drag pans the board.
- Touchpad wheel/scroll should pan the board. Modifier-wheel or pinch-style zoom can zoom.
- Viewport pan/zoom is local UI state only.
- No auto-pan while dragging pieces near the viewport edge.
- Read-only/history panels may still reshuffle local unplaced-piece layout.
- Main rendering should prioritize performance for scaling to many hundred pieces.
- Minimap can show authoritative CRDT positions only; it does not need to mirror local unplaced layout or in-progress drags.

## Phase 1: Canvas Model And Coordinate Helpers

Create a jigsaw-specific logical board space that is larger than the source image, without changing stored CRDT coordinates.

Tasks:

- Add small viewport/geometry helpers, either in `JigsawPanel.tsx` initially or a new `jigsawViewport.ts` if the code becomes bulky.
- Define `Viewport = {panX: number; panY: number; zoom: number}`.
- Define constants for min/max zoom and wheel behavior.
- Compute `boardPadding`, `boardSpace`, and `imageOffset` from `board.imageSize` and `estimatedPieceSize(board)`.
- Keep all persisted positions and snap logic in image coordinates.
- Add conversion helpers:
  - image coordinate to canvas coordinate: `image + imageOffset`
  - canvas coordinate to image coordinate: `canvas - imageOffset`
  - screen coordinate to canvas coordinate through pan/zoom
  - screen coordinate to image coordinate for existing drag/snap code

Acceptance criteria:

- Existing jigsaw unit tests still pass.
- No stored schema or artifact migration is needed.
- The conversion boundary is explicit enough that drag logic does not mix image-space and canvas-space values.

## Phase 2: Bounded Viewport Layout

Replace the current `.jigsawStage` overflow-visible layout with a clipped viewport and transformed logical canvas.

Tasks:

- In `JigsawPanel.tsx`, replace the stage wrapper with:
  - `.jigsawViewport`, a fixed/bounded interactive area with `overflow: hidden`.
  - `.jigsawCanvas`, an absolutely positioned child transformed by `translate(panX, panY) scale(zoom)`.
- Add `data-testid="jigsaw-viewport"` and `data-testid="jigsaw-canvas"` for Playwright coverage.
- Position the solved image at `imageOffset` inside the canvas.
- Render piece buttons in canvas pixels instead of stage percentages.
- Remove or retire CSS variables that depend on source-image percentages.
- Keep each piece as a `<button>` for now, with its existing internal `<canvas>` rendering.
- Ensure `readOnly` still disables state-changing piece drag, while local pan/zoom and reshuffle remain available.

Performance note:

- The first implementation can keep the current per-piece button/canvas rendering because it minimizes risk and preserves accessibility.
- To scale to many hundred pieces, avoid expensive rerender paths:
  - memoize piece rendering inputs,
  - avoid regenerating the stock source canvas except when image size changes,
  - keep transforms on the parent canvas rather than updating every piece on pan/zoom,
  - consider a later virtualization or single-canvas rendering pass only if profiling shows per-piece DOM/canvas nodes are the bottleneck.

Acceptance criteria:

- Pieces cannot visually overlap the header, action buttons, adjacent panels, or app chrome.
- Initial unplaced pieces remain reachable by panning.
- Dragging pieces still starts from the correct pointer position after pan/zoom.

## Phase 3: Pan And Zoom Interaction

Add local viewport controls optimized for touchpad use.

Tasks:

- Track viewport size with `ResizeObserver`, following the whiteboard pattern.
- Initialize pan/zoom so the logical board is centered and mostly visible in the viewport.
- Add empty-space pointer drag to pan:
  - only start pan when the pointer down target is the viewport/canvas background, not a piece button.
  - do not pan while piece drag is active.
- Add wheel handling:
  - normal wheel deltas pan the viewport for touchpad scrolling.
  - Ctrl/Cmd wheel or browser pinch-style wheel zooms around the cursor.
  - clamp zoom to the configured min/max.
- Add optional zoom buttons only if the existing jigsaw header/actions need explicit controls; otherwise minimap plus wheel/pinch can be enough.
- Keep pan/zoom local component state and do not publish it through CRDT or ephemeral presence.

Acceptance criteria:

- Empty-space drag pans smoothly.
- Touchpad scroll pans in both axes.
- Pinch or modifier-wheel zooms around the pointer.
- Piece drag remains a piece drag, not a pan gesture.
- Pan/zoom continues to work in read-only panels.

## Phase 4: Minimap

Add a jigsaw-specific minimap overlay.

Tasks:

- Create `JigsawMinimap` in `examples/react-crdt/src/apps/jigsaw/`.
- Render the minimap as SVG inside a button or pointer-interactive container, following the whiteboard minimap interaction style.
- Render:
  - board-space background,
  - solved image bounds at `imageOffset`,
  - authoritative placed pieces from `layout.positions`,
  - viewport rectangle from current `panX`, `panY`, `zoom`, and viewport size.
- Do not render local unplaced positions or in-progress drag positions in the minimap.
- Support click/drag recentering with pointer capture.
- Add `data-testid="jigsaw-minimap"`.
- Compute minimap scale from both board-space width and height so non-matching aspect ratios letterbox correctly.

Acceptance criteria:

- Minimap is visible inside the clipped jigsaw viewport.
- Minimap click recenters the main viewport.
- Minimap drag continuously recenters.
- The viewport rectangle matches the visible main viewport well enough for navigation.

## Phase 5: Styling And Responsive Polish

Update CSS in `examples/react-crdt/src/style.css`.

Tasks:

- Replace `.jigsawStage` rules with `.jigsawViewport` and `.jigsawCanvas`.
- Give the viewport a stable responsive height, similar to whiteboard:
  - desktop: something like `height: min(70vh, 720px)` and `min-height: 420px`
  - mobile: smaller minimums so the header/actions remain usable
- Use `overflow: hidden`, `touch-action: none`, `user-select: none`.
- Add a neutral board background that visually distinguishes the clipped canvas area.
- Update `.jigsawSolvedImage` for pixel positioning.
- Update `.jigsawPiece` for pixel positioning and keep touch-action disabled.
- Add minimap styling consistent with the whiteboard minimap, but scoped to jigsaw classes.
- Ensure action buttons do not wrap into overlapping or cramped layouts on narrow viewports.

Acceptance criteria:

- The first viewport shows the jigsaw app itself, not a marketing/empty state.
- No visible overlap between text, buttons, minimap, and pieces on desktop or mobile.
- The minimap does not block core interactions more than necessary.

## Phase 6: Tests

Add focused coverage for the new containment and navigation behavior.

Tasks:

- Keep existing `jigsaw.test.ts` unit coverage passing.
- Add a Playwright smoke spec for jigsaw, likely under `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`.
- Test initial render:
  - jigsaw panel visible,
  - jigsaw viewport visible,
  - jigsaw minimap visible,
  - viewport CSS overflow is hidden.
- Test containment:
  - after initial render, piece bounding boxes are contained by the viewport bounding box,
  - after `Reshuffle`, piece bounding boxes remain contained.
- Test navigation:
  - wheel scroll changes the canvas transform pan values,
  - modifier-wheel or pinch-equivalent changes zoom,
  - minimap click changes the canvas transform.
- Test piece drag still works:
  - drag a piece by screen coordinates,
  - verify its transform/position changes or a relevant state change occurs.

Acceptance criteria:

- `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes from `examples/react-crdt`.
- The new jigsaw Playwright smoke spec passes.
- Existing smoke tests that exercise app routing still pass.

## Phase 7: Manual Verification

Run visual checks after automated tests.

Checklist:

- Solo jigsaw at desktop width.
- Jigsaw in two-panel local sync layout.
- Jigsaw at mobile width around `390px`.
- Read-only/history view if the jigsaw app is available there.
- Pan with touchpad scroll.
- Zoom with pinch or modifier-wheel.
- Drag a single unplaced piece after panning and zooming.
- Drag a connected component after pieces have snapped.
- Reshuffle while zoomed or panned.

## Future Work

These are intentionally out of scope for the first pass unless implementation exposes a clear need:

- Single-canvas renderer for all pieces.
- Virtualized piece rendering for very large puzzles.
- OffscreenCanvas/image bitmap cache for piece masks.
- Keyboard-accessible pan/zoom controls.
- Auto-pan near viewport edge during piece drag.
- Collaborative viewport presence.
