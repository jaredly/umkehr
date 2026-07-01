# Implementation Log: Jigsaw Shuffle Collision Avoidance

## Phase 1: Worktree Inspection

- Started by checking file-specific diffs for jigsaw implementation files.
- No implementation diffs were present in `examples/react-crdt/src/apps/jigsaw/*` from this view, though there are untracked task files.
- Noted an unrelated untracked `.tasks/05jg1-jigsaw-voronoi/implementation-log.md`; left it untouched.

## Phase 2: Collision Geometry Helpers

- Added `PieceRect`, `rectForPiece`, `rectsOverlap`, `overlapArea`, and `pieceCollisionPadding` in `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`.
- Collision checks use each piece's actual `bounds`, which keeps the implementation compatible with rectangular and Voronoi pieces.

## Phase 3: Deterministic Shuffle Packing

- Replaced the previous equal-perimeter-spacing plus jitter in `arrangeUnplacedPieces`.
- New placement uses deterministic perimeter lanes and outer rings, checking padded bounding boxes before accepting each candidate.
- Removed jitter so the collision guarantee is not undermined by random offsets.
- Kept the public `arrangeUnplacedPieces(board, pieces, stage, seed)` signature and image-coordinate output unchanged.
- The seed now rotates lane/slot selection deterministically instead of generating visual jitter.

## Phase 4: Panel Wiring

- No `JigsawPanel` changes were needed. The existing `arrangeLocalUnplacedPieces` path continues to call `arrangeUnplacedPieces`.
- Reshuffle remains local UI state and does not dispatch CRDT updates.

## Phase 5: Unit Tests

- Added rectangle helper coverage for overlap, edge-touching, and overlap area.
- Added non-overlap coverage for rectangular boards with 12, 30, 60, and 120 pieces.
- Added non-overlap coverage for a 30-piece Voronoi board.
- Added invalid-stage and empty-input coverage.

## Verification

- `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passed: 24 tests.
- `npm run build` passed for `examples/react-crdt`.
  - Issue encountered: the command printed `Error connecting to agent: Operation not permitted` before the npm script output, but the TypeScript check and Vite build completed with exit code 0.
- Initial `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts` failed in the first smoke test's final drag assertion.
  - Issue encountered: after the test pans/zooms/recenters the viewport, `.jigsawPiece.first()` can be clipped by the viewport with the new packed-ring layout. Its bounding-box center was not a reliable hit target, so the mouse drag did not start.
  - Workaround/fix: updated the smoke test to choose the first jigsaw piece whose bounding-box center is inside the viewport and hit-testable via `elementsFromPoint`.
- Re-ran `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts`; all 4 tests passed.
- Re-ran `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` after the smoke-test update; 24 tests passed.

## Follow-up: Corner Gaps

- Issue encountered: the first packing implementation centered slots within each lane using `(slot + 0.5) / slots`, which left the perimeter lane endpoints unused and made the shuffle look like it was intentionally keeping corners clear.
- Fix: changed lane slot placement to include endpoints when a lane has more than one slot, while retaining center placement for single-slot lanes.
- Added a regression test that verifies the 12-piece shuffle uses all corner bands.
- Re-ran `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts`; 25 tests passed.
- Re-ran `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts`; all 4 tests passed.

## Follow-up: Outer Ring Corner Voids

- Issue encountered: even after endpoint placement, farther-out lanes were still based on the original image edges. For example, the top lane ran from `x=0..width` at `y=-offset`, while the right lane ran from `y=0..height` at `x=width+offset`, leaving open diagonal corner space between lanes.
- Fix: changed lane geometry so each ring follows an expanded rectangle. Horizontal lanes now run from `-offset` to `width + offset`, and vertical lanes now run from `-offset` to `height + offset`.
- Tightened the corner regression test to require pieces in the four expanded outside corner quadrants.
- Re-ran `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts`; 25 tests passed.
- Re-ran `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts`; all 4 tests passed.
