# Implementation Log: Jigsaw Torus Border Placement

## 2026-06-30 23:02 CDT

- Started implementation from `plan.md`.
- Confirmed the jigsaw worktree already includes prior torus-render changes:
  - torus surface panning moved from wheel to click-drag;
  - first-time torus drops after sub-canvas pan use logical torus coordinates for snapping;
  - smoke tests include a helper for selecting a hit-testable torus copy.
- I will build on those changes and avoid reverting them.

## 2026-06-30 23:08 CDT

- Implemented Phase 1/2 model groundwork:
  - extended `Coord` with `outer?: boolean`;
  - added placement helpers for plane/surface/outer interpretation;
  - added `componentSpaces` and `pieceSpaces` to `PuzzleLayout`;
  - stripped `outer` metadata before geometry derivation.
- Added unit coverage for planar ignore semantics, torus surface/outer classification, and torus outer component layout.

## 2026-06-30 23:11 CDT

- Implemented Phase 3/4/5 runtime behavior in `JigsawPanel.tsx`:
  - split torus rendering into surface placed, outer placed, and local unplaced maps;
  - replaced fixed drag mode/delta with pointer-to-anchor offsets and a live preview space;
  - outside torus drops now persist `{outer: true}` instead of removing/cancelling placement;
  - inside torus drops replace the stored position with a plain canonical `{x, y}`;
  - surface snapping only considers surface pieces and uses wrapped distance;
  - outer snapping uses ordinary distance and excludes surface pieces.
- Removed the obsolete outside-drop removal helper and updated unit tests around persisted outer positions.
- Verification:
  - `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes (`67` tests).
  - `npm exec tsc -- -p tsconfig.json --noEmit` exits successfully.
- Issue observed: shell startup printed `Error connecting to agent: Operation not permitted` during `tsc`, but the command exited `0`.

## 2026-06-30 23:16 CDT

- Implemented Phase 6 smoke coverage updates:
  - unplaced torus pieces can be dropped onto the outer border and become persisted placed pieces;
  - torus surface pieces dragged outside become outer placed pieces instead of local unplaced pieces;
  - outer placed pieces can be dragged back into the torus and render wrapped copies again.
- Verification:
  - `npm exec vitest -- src/apps/jigsaw/jigsaw.test.ts` passes (`67` tests).
  - `npm exec tsc -- -p tsconfig.json --noEmit` exits successfully.
  - `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` passes (`5` tests).
- Issues/workarounds:
  - `tsc` still prints `Error connecting to agent: Operation not permitted` from shell startup, but exits `0`.
  - Playwright prints `NO_COLOR` / `FORCE_COLOR` warnings; tests still pass.
