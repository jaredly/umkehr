# Research: 600-Piece Jigsaw Performance

## Goal

Investigate why `examples/react-crdt` jigsaw performance struggles after adding a 600-piece version, and answer whether moving the main board to SVG would likely help.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/JigsawMinimap.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/style.css`

The app now supports `600` as a valid `JigsawPieceCount`. Rectangular 600-piece boards are generated as a `60 x 10` grid, so each rectangular piece is about `12 x 54` pixels on the fixed `720 x 540` stock image.

The main board is already a clipped canvas-like viewport:

- `.jigsawViewport` is the fixed, clipped interactive area.
- `.jigsawCanvas` is an absolutely positioned logical board transformed with `translate(...) scale(...)`.
- Each puzzle piece is an absolutely positioned `<button>`.
- Each piece button contains a `<canvas>` drawn by `PieceCanvas`.
- Each piece also has a separate `.jigsawPieceBackdrop` with another `PieceCanvas` for shadow/backdrop rendering.
- `JigsawMinimap` is SVG and renders one SVG path per rendered piece.

For 600 pieces, the main viewport therefore mounts roughly:

- 600 button elements.
- 600 visible piece canvases.
- 600 backdrop divs.
- 600 backdrop canvases.
- 600 minimap SVG paths.
- the solved-image canvas and surrounding chrome.

That is approximately 1,200 main-board canvas elements and 1,200 absolutely positioned DOM nodes before counting the minimap.

## Test Status

Focused test run:

```sh
npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts
```

Result: 1 test file passed, 25 tests passed.

## Likely Bottlenecks

### 1. Per-pointer-move React renders

Dragging updates React state:

```ts
setDrag({...drag, delta: subtract(pointer, drag.startPointer)});
```

Every drag update re-renders `JigsawPanel`. Even though `layout` is memoized and does not recompute on every drag, render still maps over `board.pieces` twice: once for backdrops and once for visible buttons. At 600 pieces this rebuilds 1,200 React element descriptions per pointer move.

`renderedPositions` also creates a new map on every drag update. That is not catastrophic by itself, but it means every child receives fresh style objects and the whole piece tree is revisited.

This is probably the biggest continuous-interaction cost.

### 2. Duplicate rendering layer

The backdrop layer doubles the number of piece canvases and positioned elements. It also applies `filter: drop-shadow(...)`, which can be expensive across hundreds of independently composited elements.

At smaller counts this is visually nice. At 600 pieces it is probably too much work for the browser.

### 3. Initial mount and reshuffle cost

`PieceCanvas` draws each piece in an effect by clipping a path, drawing a crop from the source image, and stroking the mask. With the backdrop layer, this happens twice per piece on mount.

`arrangeUnplacedPieces` also does collision-avoidance placement. It scans candidate slots and compares against already placed rects, so 600 unplaced pieces can make initial arrangement or reshuffle noticeably slower. This is not the same as drag jank, but it can make the 600-piece board feel heavy immediately.

### 4. Minimap path count

The minimap is already SVG. For 600 pieces it renders 600 paths. That is less concerning than the main board, but it still updates whenever `renderedPositions` changes during drag.

For high piece counts, the minimap could switch to cheaper rects or update less frequently while dragging.

### 5. Geometry shape for 600

The current rectangular `600` grid is `60 x 10`. That creates narrow sliver pieces. It keeps the math simple, but it may not be the intended visual or interaction shape.

More balanced grids such as `30 x 20`, `25 x 24`, or `24 x 25` would make pieces closer to normal jigsaw proportions, though at the same total count the browser still has to manage hundreds of interactive pieces.

## Would SVG Work Better?

Probably not as the primary fix.

A full SVG board would replace 600 canvas elements with 600 SVG paths or image-clipped groups. That can reduce canvas element count, but it does not remove the main scalability issue: hundreds of independently addressable pieces being reconciled and restyled through React on every drag frame.

For rectangular pieces, SVG is also not naturally cheaper than canvas:

- Each piece still needs a shape, fill/crop, stroke, z ordering, pointer behavior, and transform.
- SVG masks or clip paths for image crops can become expensive at high counts.
- The minimap is already SVG, so the current app already pays the SVG path cost for the small overview.

The better renderer direction depends on desired interaction:

- If every piece must stay a normal focusable button, keep DOM pieces but aggressively reduce updates and element count.
- If performance is more important than per-piece DOM accessibility, a single `<canvas>` renderer for the main board is more likely to scale than a full SVG board.

## Recommended Direction

### Phase 1: Keep DOM pieces, reduce obvious high-count cost

This is the lowest-risk path and should improve 600-piece usability without changing the architecture.

1. Render each piece once.
   - Remove `.jigsawPieceBackdrop` for high counts, or replace it with a cheaper shadow/stroke in the visible piece canvas.
   - A simple threshold like `board.pieces.length > 120` is likely enough.

2. Disable expensive visual effects for high counts.
   - Skip `drop-shadow(...)` backdrops.
   - Skip or simplify snap pulse filters.
   - Consider disabling move animations above 120 or 300 pieces.

3. Memoize piece components.
   - Extract a `JigsawPieceView` and wrap it in `React.memo`.
   - Avoid passing fresh object props when values did not change.
   - This helps pan/viewport/minimap state changes avoid touching every piece as much.

4. Avoid updating every piece during drag.
   - Only the dragged component needs to move per pointer frame.
   - Use `requestAnimationFrame` and imperative `style.transform` for active drag movement, then commit CRDT state on pointer up.
   - The existing model already treats drag as local transient state, so this fits the current behavior.

### Phase 2: Add a high-count canvas renderer if 600 still feels heavy

If 600 pieces must be smooth, a single main-board canvas is the more promising rendering change.

Possible shape:

- Keep the CRDT model and jigsaw geometry unchanged.
- Keep a transparent interaction hit layer or pointer hit-testing in JS.
- Draw all static pieces into one canvas.
- During drag, redraw only on `requestAnimationFrame`.
- Optionally keep DOM buttons only for selected/active pieces or for lower piece counts.

This is a larger change because keyboard/focus behavior and hit testing need replacement, but it removes the cost of hundreds of DOM elements, canvases, CSS filters, and React style updates.

### Phase 3: Revisit SVG only for specific needs

SVG may still be useful for:

- minimap rendering,
- debugging geometry,
- exporting puzzle outlines,
- rendering simple vector-only previews.

It is not the first choice for the main 600-piece interactive board unless the desired visual is pure vector shapes without image cropping and without many filters/masks.

## Specific Implementation Notes

- `buildPuzzleLayout` itself is probably not the first bottleneck. It is memoized on `positions` and `connections`, and drag changes do not change those inputs until pointer up.
- `usePieceMoveAnimation` loops over all rendered positions when positions change and runs for both visible pieces and backdrops. Keep this disabled or simplified for high piece counts.
- `arrangeUnplacedPieces` should be measured for initial 600-piece creation and reshuffle. If it is slow, add a cheaper deterministic shelf/grid scatter mode for high counts.
- `JigsawMinimap` should not receive or render full path detail on every drag frame for 600 pieces. Rect approximations are likely fine at minimap scale.
- The fixed source image size means a 600-piece puzzle creates very small pieces. Raising image resolution would make pieces more inspectable, but it also increases drawing cost.

## Open Questions

1. Is the main pain initial load/reshuffle, dragging a single piece, dragging a connected component, panning/zooming, or syncing/undoing?
    - all of the above
2. Should 600 pieces preserve per-piece keyboard focus and screen-reader labels, or is a canvas hit-test model acceptable for high-count puzzles?
    - I don't think keyboard focus is very useful.
3. Is the current `60 x 10` grid intentional, or should 600 use a more balanced grid such as `30 x 20`?
    - 30x20 is  fine
4. Should the high-count board keep visual backdrops/shadows, or is a flatter look acceptable for performance?
    - we can drop the backdrops across the board TBH
5. Does 600 need to support Voronoi boards too? The Voronoi generator and neighbor detection may need separate measurement at that count.
    - definitely
6. What is the target hardware/browser for acceptable performance?
    - I would like it to work on phones
7. Should high-count optimizations be threshold-based, or should the renderer be user-selectable for comparing DOM, SVG, and canvas approaches?
    - let's just optimize every level. no threshold, just switch to the thing that's better
