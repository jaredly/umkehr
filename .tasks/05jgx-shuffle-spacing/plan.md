# Plan: Jigsaw Shuffle Collision Avoidance

## Decisions From Research

- Collision avoidance applies to locally shuffled unplaced pieces only.
- Do not avoid overlap with authoritative placed or solved components.
- Use piece bounding boxes for collision checks. Polygon overlap would be more precise, but bounding boxes are acceptable for this pass.
- Pieces may move farther outside the solved image border to satisfy spacing.
- Remove the current jitter requirement. Deterministic clean spacing is preferred over random-looking placement.
- Account for future many-hundred-piece boards in the design. Avoid APIs or algorithms that paint the implementation into a corner.

## Phase 1: Inspect Current Worktree And Preserve Local Changes

Before editing implementation files, inspect current diffs because the jigsaw files already have unrelated modifications in the worktree.

Files to check:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`

Use the existing code as the source of truth. Do not revert or rewrite unrelated jigsaw work.

## Phase 2: Add Collision Geometry Helpers

Update `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`.

Add small pure helpers for rectangle-based placement:

```ts
type PieceRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};
```

Recommended helpers:

- `rectForPiece(board, piece, position, padding)`
- `rectsOverlap(a, b)`
- `overlapArea(a, b)` for fallback scoring
- `pieceCollisionPadding(board)` or an equivalent local calculation
- an optional spatial index helper if the simple implementation would otherwise become too slow

Keep helper visibility pragmatic:

- Export helpers only if tests need direct access.
- Otherwise test through `arrangeUnplacedPieces`.

Collision should use each piece's actual `bounds`, not only `maxPieceSize`, so Voronoi and future variable-sized pieces are handled naturally.

## Phase 3: Replace Jittered Perimeter Shuffle With Deterministic Packing

Enhance `arrangeUnplacedPieces(board, pieces, stage, seed)` in `jigsaw.ts`.

Required behavior:

- Preserve the existing public function signature.
- Return an empty map for no pieces or invalid stage dimensions.
- Preserve deterministic output for the same board, piece list, stage, and seed.
- Produce center positions in image coordinates, as it does today.
- Avoid padded bounding-box overlap among generated unplaced pieces.
- Do not consider authoritative placed positions.
- Do not add jitter that can reintroduce overlap.

Recommended algorithm:

1. Compute a placement band around the image using max piece size and collision padding.
2. Generate deterministic perimeter lanes for top, right, bottom, and left.
3. Place pieces along the lanes using each piece's projected footprint:
   - top/bottom lanes reserve piece width plus gap,
   - left/right lanes reserve piece height plus gap.
4. If one ring cannot fit all pieces, add additional outer rings.
5. For each candidate position, verify it does not overlap previously placed rectangles.
6. If a candidate collides, probe deterministic nearby candidates on the same ring/lane.
7. If still blocked, move to the next outer ring.
8. Keep a bounded fallback that chooses the least-overlapping candidate rather than failing to place a piece.

For future scale, avoid repeated full rescans if the final code becomes complex:

- Start with O(n^2) checks if the implementation remains simple.
- If adding ring probing makes checks numerous, add a grid spatial index keyed by rectangle cells.
- Keep the spatial index private to the shuffle implementation so it can be swapped later.

The `seed` can still affect deterministic ordering or lane starting offset if useful, but it should not introduce random jitter. For example, use it to rotate the starting lane or starting distance while preserving collision guarantees.

## Phase 4: Keep Jigsaw Panel Wiring Minimal

Update `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx` only if needed.

Expected outcome:

- `arrangeLocalUnplacedPieces` can keep calling `arrangeUnplacedPieces(board, pieces, board.imageSize, seed)`.
- `Reshuffle` remains local-only and does not dispatch CRDT patches.
- Existing drag, snap, and component placement behavior remains unchanged.

If the improved layout can place pieces farther out than the current board viewport comfortably shows, adjust only the local board-space/padding calculation if necessary. Do not migrate CRDT state or change stored coordinates for this task.

## Phase 5: Unit Tests

Update `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`.

Add test helpers:

- build padded rects from generated positions and piece bounds,
- assert all expected pieces received positions,
- assert no pair of padded rects overlaps.

Add coverage:

1. Determinism remains intact for a fixed seed.
2. Empty input and invalid stage dimensions return an empty map.
3. Rectangular boards with 12, 30, 60, and 120 pieces produce no overlapping unplaced piece boxes.
4. A Voronoi board, at least 30 pieces, produces no overlapping unplaced piece boxes.
5. A larger stress-style case exercises the intended scale. If supported artifacts are capped at 120 today, use repeated seeds and the largest board rather than inventing unsupported state.
6. If the implementation includes exported collision helpers, add direct tests for edge-touching, separated, and overlapping rectangles.

Use a small positive padding in tests so the guarantee is stronger than "barely not overlapping." Keep the padding aligned with the implementation's own spacing constant or helper.

## Phase 6: Optional Playwright Coverage

The unit tests should be the main coverage. Extend `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts` only if the DOM-level assertion stays stable.

Possible Playwright check:

- create/open a 12- or 30-piece jigsaw,
- click `Reshuffle`,
- collect `.jigsawPiece.unplaced` bounding boxes,
- assert no pair overlaps by more than a tiny tolerance.

Avoid making this test sensitive to zoom/pan transforms or subpixel rounding. If it becomes flaky, leave collision verification in Vitest.

## Phase 7: Verification

Run focused unit tests:

```sh
cd examples/react-crdt
npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts
```

Run the existing smoke test if practical:

```sh
cd examples/react-crdt
pnpm exec playwright test tests/smoke/jigsaw-solo.spec.ts
```

Manual verification:

- Open a jigsaw document.
- Click `Reshuffle` several times.
- Confirm unplaced pieces do not visually stack.
- Confirm pieces can still be dragged.
- Confirm dropping a piece still creates position patches and snap connections as before.
- Check both rectangular and Voronoi documents if the current branch includes Voronoi support.

## Acceptance Criteria

- Reshuffling unplaced jigsaw pieces produces non-overlapping bounding-box positions.
- The behavior is deterministic for a fixed seed.
- Reshuffle remains local UI state and does not sync through CRDT updates.
- Dragging, snapping, undo, and redo behavior are not regressed.
- Unit tests cover rectangular board sizes and at least one irregular/Voronoi board when available.
- The implementation does not rely on exact polygon collision and leaves room for future spatial-index optimization.
