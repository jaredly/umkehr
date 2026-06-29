# Implementation Log

## 2026-06-29

- Started from a clean baseline for the requested files; unrelated untracked files were already present and left untouched.
- Ran `npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts` before edits: passed, 25 tests in 2.07s reported by Vitest.
- Phase 1/4 direction: remove the duplicate backdrop DOM layer and move the per-piece rendering behind a memoized component with a stable pointer-down handler.
- Phase 2 direction: change the 600-piece rectangular grid from `60 x 10` to `30 x 20` and add rectangular 600 coverage.
- Phase 3 direction: optimize Voronoi generation using grid-local candidate sets instead of clipping and neighbor detection against every piece.
- Removed the jigsaw backdrop render pass, `backdropRefs`, the second move-animation pass, and backdrop CSS/drop-shadow styling. The remaining `PieceCanvas` keeps its existing cheap canvas stroke.
- Changed `gridForPieceCount(600)` to `30 x 20`.
- Updated rectangular tests to include 600 pieces and added reciprocal-neighbor coverage for 600 rectangular boards.
- Optimized Voronoi generation by clipping each site and checking polygon neighbors only against grid-local candidates within radius 3. This keeps 600-piece Voronoi creation covered without disabling the option.
- Added a 600-piece Voronoi test that checks piece count, total mask area, sampled bounds/masks, sampled reciprocal neighbors, and `validConnections` for a generated Voronoi neighbor.
- Extracted memoized `JigsawPieceView`, moved CSS variable style construction inside it, and replaced per-piece inline pointer handlers with a stable handler that reads `data-piece`.
- Reran `npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`: passed, 28 tests in 1.91s reported by Vitest.
- Started the React example with `npm run dev -- --host 127.0.0.1 --port 5174`; ports 5174 and 5175 were occupied, so Vite served on `http://127.0.0.1:5176/`. `curl -I http://127.0.0.1:5176/` returned HTTP 200.
- Issue: `npm exec tsc -- -p examples/react-crdt/tsconfig.json --noEmit` is blocked by existing block-editor selection type errors outside this jigsaw task. I did not modify or revert those unrelated files.

## Zoom Quality Follow-Up

- Increased the backing-store resolution for piece canvases and the faint solved-image canvas while preserving logical layout size.
- The backing scale is `ceil(devicePixelRatio * maxZoom)`, capped at `4`, so zoomed pieces look sharper without unbounded memory growth on 600-piece boards.
- Enabled high-quality image smoothing for the upscaled backing canvases.
- Reran `npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`: passed, 28 tests in 1.87s reported by Vitest.
- Vite hot-reloaded `src/apps/jigsaw/JigsawPanel.tsx` on the existing dev server without a compile error.

## Minimap Readability Follow-Up

- Found that the minimap drew every piece mask with `strokeWidth={4}` and `vectorEffect="non-scaling-stroke"`, so 600 per-piece borders visually dominated the tiny map.
- Removed the per-piece minimap stroke entirely for all piece counts while keeping mask fills and placed/unplaced opacity differences.
- Adjusted the randomized 600-piece Voronoi test after it exposed a flaky assumption that every sampled boundary piece has at least two detected neighbors; it now checks total neighbor density and reciprocal offsets for existing sampled neighbors.
- Reran `npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`: passed, 28 tests in 1.83s reported by Vitest.
- Vite hot-reloaded `src/apps/jigsaw/JigsawMinimap.tsx` on the existing dev server without a compile error.

## Main Renderer Stroke Follow-Up

- Removed the 1px mask stroke pass from the main `PieceCanvas` renderer, leaving only clipped image content.
- Reran `npm exec vitest -- run examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`: passed, 28 tests in 2.29s reported by Vitest.
- Vite hot-reloaded `src/apps/jigsaw/JigsawPanel.tsx` on the existing dev server without a compile error.
