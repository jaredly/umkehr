# Implementation Log: Voronoi Jigsaw Board

## 2026-06-29

- Started implementation from `plan.md`.
- Phase 1 direction: add concrete per-piece bounds while keeping artifacts shape-agnostic and preserving legacy rectangular artifacts that do not have bounds.
- Implemented initial artifact, rendering, creation-UI, and test changes.
- Issue: TypeScript did not retain the `JigsawPieceCount` narrowing for `input.pieceCount` inside artifact normalization. Workaround: assign the narrowed value to a local `pieceCount` constant before mapping pieces.
- Phase 1 complete: rectangular pieces now include concrete bounds; legacy artifacts without bounds are accepted and normalized during load.
- Phase 2 complete: added a straight-edged Voronoi generator using an internal half-plane polygon clipper, random per-axis perturbation, bounding-box centers, local masks, and neighbor detection from shared edges. No generator type is serialized onto the artifact.
- Phase 3/4 complete: rendering now uses each piece's bounds for button/canvas size, image crop, and mask placement; board padding and reshuffle margins use max piece size, while snap threshold uses average piece size.
- Phase 5 complete: create-document UI now has a board type selector. Missing type remains compatible and defaults to rectangular.
- Phase 6 complete: added tests for Voronoi geometry, reciprocal neighbors, connection validation, legacy artifact loading, and document-init validation.
- Phase 7 verification:
  - `pnpm exec tsc -p tsconfig.json --noEmit` passed.
  - `pnpm exec vitest run src/apps/jigsaw/jigsaw.test.ts` passed: 17 tests.
  - `pnpm exec playwright test -c playwright.config.ts tests/smoke/jigsaw-solo.spec.ts` passed: 4 tests, including a new Voronoi creation/opening smoke test.
- Non-blocking issue: test/typecheck commands print `Error connecting to agent: Operation not permitted` in this environment, but they exit successfully. Playwright also prints existing `NO_COLOR`/`FORCE_COLOR` warnings.
- Follow-up issue: the jigsaw viewport minimum zoom of `0.35` was too conservative for larger/variable-size boards, causing the initial fit to clamp too high. Lowered the minimum zoom to `0.1` so the fit-to-board calculation can actually fit the full board.
- Follow-up issue: random shuffle placement was too far from the board because unplaced pieces were arranged around the padded canvas border and then pushed outward by an additional margin. Changed local unplaced placement to arrange around the image rectangle in image coordinates, leaving the existing board padding only as render room.
- Follow-up issue: non-rectangular Voronoi pieces inherited rectangular button outlines and `box-shadow`, making the rendering look boxy. Removed wrapper outline/shadow styling and kept only the polygon stroke in canvas. A temporary alpha-shaped `drop-shadow()` was also removed after review; jigsaw pieces now render without shadows.
