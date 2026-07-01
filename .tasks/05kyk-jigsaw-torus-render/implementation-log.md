# Implementation Log: Jigsaw Torus Rendering

## 2026-06-30 22:03 CDT

- Started implementation from `plan.md`.
- Confirmed current code already has torus artifact generation, wrapped piece-image sampling, and a single unwrapped jigsaw canvas.
- Beginning with Phase 1 helpers and tests in `examples/react-crdt/src/apps/jigsaw/jigsaw.ts` / `jigsaw.test.ts`.

## 2026-06-30 22:05 CDT

- Added torus coordinate helpers, render-copy filtering, wrapped-distance support for snap candidate checks, and outside-drop decision helpers.
- Added unit coverage for canonicalization, nearest equivalent points, copy filtering, single-piece outside removal, connected-group outside cancellation, and wrapped seam snapping.
- Verification: `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes (`63` tests).

## 2026-06-30 22:09 CDT

- Added a torus-only nested viewport/canvas in `JigsawPanel.tsx`.
- Split torus rendering so placed pieces render as filtered wrapped copies inside the clipped torus surface, while unplaced pieces remain in the outer workspace.
- Added torus pan state, wheel/pointer panning for the torus surface, live wrapped drag coordinate tracking, canonicalized inside drops, and outside-drop removal/cancellation semantics.
- Workaround: disabled existing DOM move animation for torus boards because duplicate rendered copies do not fit the current one-ref-per-piece animation model.
- Verification: `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` still passes (`63` tests).

## 2026-06-30 22:13 CDT

- Added minimap torus-pan visualization with dashed cut lines inside the image rectangle.
- Extended Playwright document creation helper with the `surface` option.
- Added a torus smoke test covering sub-canvas presence, edge duplicate rendering, torus pan that does not move unplaced pieces, and outside-drop removal for a single placed piece.
- Fixed an existing smoke-test selector ambiguity by making the `Piece N` role lookup exact; otherwise `Piece 1` also matched `Piece 10`, `Piece 11`, and `Piece 12`.
- Verification:
  - `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes (`63` tests).
  - `npm exec tsc -- -p tsconfig.json --noEmit` passes.
  - `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` passes (`5` tests).
  - `npm run build` passes.
- Issue observed: shell startup prints `Error connecting to agent: Operation not permitted` during some commands, but the affected commands exited successfully.
- Vite build warning observed: some chunks exceed 500 kB after minification. This appears unrelated to the torus work and did not fail the build.

## 2026-06-30 22:24 CDT

- Fixed a placement bug found during manual testing: dropping an unplaced piece into a panned torus sub-canvas stored the visual sub-canvas coordinate instead of subtracting torus pan first, so the piece jumped after drop.
- Added `torusLogicalDropPosition(...)` and use it only for outer-layer drags that finish inside the torus surface. Placed-piece torus drags already track logical torus coordinates and still only need canonicalization.
- Added unit coverage for visual-drop-to-logical-position conversion, including wrapped negative results.
- Verification:
  - `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes (`64` tests).
  - `npm exec tsc -- -p tsconfig.json --noEmit` passes.
  - `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` passes (`5` tests).
