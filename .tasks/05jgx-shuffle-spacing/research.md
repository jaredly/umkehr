# Research: Jigsaw Shuffle Collision Avoidance

## Goal

Update `examples/react-crdt` so reshuffling jigsaw puzzle pieces avoids overlapping unplaced pieces.

The task text says "jugsaw"; the relevant app and files use `jigsaw`.

## Current State

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`
- `examples/react-crdt/src/style.css`

`JigsawPanel` renders unplaced pieces from local UI state:

```ts
type LocalLayoutState = {
    seed: number;
    positions: Map<number, Coord>;
};
```

That local state is intentionally separate from authoritative CRDT state. Authoritative `JigsawState.positions` stores placed component anchor positions. Unplaced pieces are derived locally with `arrangeUnplacedPieces` and can be reshuffled without dispatching CRDT patches.

The current reshuffle handler does this:

```ts
setLocalLayout((current) => {
    const seed = current.seed + 1;
    return {
        seed,
        positions: arrangeLocalUnplacedPieces(board, unplaced, seed),
    };
})
```

`arrangeLocalUnplacedPieces` delegates to:

```ts
arrangeUnplacedPieces(board, pieces, board.imageSize, seed)
```

`arrangeUnplacedPieces` currently spreads pieces around the image border:

- calculates max piece size,
- uses a margin of `maxPieceSize * 0.65`,
- steps evenly around the perimeter,
- adds small seeded jitter.

This is deterministic for a fixed board, piece set, stage size, and seed, but it does not check whether the resulting piece rectangles overlap. The existing unit test only verifies deterministic output:

```ts
expect(arrangeUnplacedPieces(board, [0, 1, 2], {width: 720, height: 540}, 123)).toEqual(
    arrangeUnplacedPieces(board, [0, 1, 2], {width: 720, height: 540}, 123),
);
```

## Coordinate And Collision Model

Piece positions are center points in image coordinates. Rendering converts each center to a top-left CSS box using the piece's artifact bounds:

```ts
'--piece-left': `${canvasPosition.x + piece.bounds.left}px`,
'--piece-top': `${canvasPosition.y + piece.bounds.top}px`,
'--piece-width': `${piece.bounds.width}px`,
'--piece-height': `${piece.bounds.height}px`,
```

The visible pixels are clipped by `piece.mask` inside a child canvas, but the DOM hit box and layout footprint are rectangular. For this task, collision avoidance should almost certainly use inflated piece bounds, not exact polygon masks:

- It matches the interactive hit boxes.
- It is cheap enough for 12, 30, 60, 120, and later many-hundred-piece boards.
- It avoids introducing polygon intersection complexity for a local shuffle feature.
- It produces visually comfortable spacing even for Voronoi pieces with irregular masks.

Recommended rectangle helper shape:

```ts
type PieceRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};
```

For piece `p` at center `position`:

```ts
{
    left: position.x + board.pieces[p].bounds.left - padding,
    top: position.y + board.pieces[p].bounds.top - padding,
    right: position.x + board.pieces[p].bounds.left + board.pieces[p].bounds.width + padding,
    bottom: position.y + board.pieces[p].bounds.top + board.pieces[p].bounds.height + padding,
}
```

`padding` can start as a small fraction of average/max piece size, for example `Math.max(6, Math.min(pieceSize.width, pieceSize.height) * 0.08)`.

## Recommended Implementation

Keep the change in `jigsaw.ts` as pure layout logic, then wire `JigsawPanel` through the existing `arrangeLocalUnplacedPieces` path.

Suggested helper:

```ts
export function arrangeUnplacedPiecesAvoidingCollisions(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
): Map<number, Coord>
```

Possible implementation strategy:

1. Generate deterministic candidate positions around the border.
2. For each piece, choose the first candidate whose padded rectangle does not overlap any previously placed rectangle.
3. If the direct border slot collides, try deterministic offsets along the outward normal and then tangent directions.
4. If no nearby candidate works after a bounded number of attempts, fall back to a deterministic search over additional perimeter distances.
5. As a last resort, return the least-overlapping candidate rather than dropping the piece.

This keeps the algorithm predictable and avoids unbounded loops.

However, the cleanest first pass may be to replace the current "one slot per piece" perimeter placement with a perimeter lane packer:

- Determine each piece's inflated width and height.
- Walk the four border lanes and reserve arc length based on the piece's projected size on that lane.
- Place piece centers at the midpoint of each reserved lane segment.
- Apply jitter only if it does not cause a collision, or make jitter smaller than the known gap.

The current algorithm uses equal `perimeter / pieces.length` spacing, which can be too small for large pieces or uneven Voronoi bounds. A lane packer directly accounts for each piece's footprint.

Recommended first implementation balance:

- Keep `arrangeUnplacedPieces` as the public function and enhance it rather than adding a separate public API, unless the new helper makes unit tests clearer.
- Preserve determinism for the same inputs.
- Sort or consume `pieces` in the input order, because callers already provide `unplaced` in board index order.
- Use rectangular bounds plus spacing padding.
- Prefer avoiding overlap among the generated unplaced pieces themselves.
- Do not account for authoritative placed pieces in the first pass unless product wants reshuffle to avoid the solved-image/placed-piece area too. Current shuffle is specifically an unplaced local layout around the image border.

## Interaction With Existing Jigsaw Behavior

This should remain local-only UI state. Reshuffle currently does not dispatch CRDT patches and should continue not to, because unplaced layout is not part of shared puzzle state.

Dragging should continue to work unchanged:

- `renderedPositions` merges local unplaced positions, authoritative layout positions, and in-progress drag positions.
- Dropping dispatches only the dragged component anchor position and any snap connection patches.
- Once a piece becomes placed, `unplacedPieces(board, layout)` removes it from local layout.

The existing viewport work gives the board a larger logical `boardSpace`, but `arrangeLocalUnplacedPieces` still calls `arrangeUnplacedPieces(board, pieces, board.imageSize, seed)`. That means generated positions remain in image coordinates around the solved image, and rendering adds `imageOffset` later. Collision math should stay in this image-coordinate system.

## Tests

Add unit coverage in `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`:

- `arrangeUnplacedPieces` remains deterministic for fixed seed.
- For 12, 30, 60, and 120 rectangular boards, generated padded rectangles for all pieces do not overlap.
- For a 30-piece Voronoi board, generated padded rectangles do not overlap. This is useful because Voronoi bounds are uneven.
- Edge case: empty `pieces`, zero-width stage, or zero-height stage still returns an empty map.
- If testing a helper directly, include an intentionally dense candidate scenario to prove the fallback search avoids overlap when the first candidate collides.

Useful assertion helper:

```ts
function expectNoArrangedOverlap(board: JigsawBoardArtifact, positions: Map<number, Coord>, padding = 0) {
    const rects = Array.from(positions, ([piece, position]) => rectForPiece(board, piece, position, padding));
    for (let a = 0; a < rects.length; a++) {
        for (let b = a + 1; b < rects.length; b++) {
            expect(rectsOverlap(rects[a], rects[b])).toBe(false);
        }
    }
}
```

The existing Playwright smoke test already clicks `Reshuffle` and asserts no piece hit target escapes the viewport. It could be extended to sample `.jigsawPiece.unplaced` bounding boxes after reshuffle and assert no pair overlaps materially. Unit tests should carry most of the weight, though, because DOM bounding boxes after zoom/pan are slower and more fragile.

Useful commands:

```sh
cd examples/react-crdt
npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts
pnpm exec playwright test tests/smoke/jigsaw-solo.spec.ts
```

## Risks

- Exact non-overlap may be impossible if too many inflated piece rectangles are forced into too small a band. The implementation should have a bounded fallback and tests should use realistic board sizes.
- Jitter can reintroduce collisions after a packed placement. Apply jitter before final collision checks, clamp/retry it, or skip it for dense boards.
- Voronoi piece bounds vary. Using only `maxPieceSize` for spacing can be conservative but waste space; using each piece's actual bounds is better.
- If collision avoidance spreads pieces farther from the image than before, the current initial viewport fit and minimap may need visual checking to ensure pieces remain easy to find.
- The worktree currently has modified jigsaw files. Implementation should inspect current diffs before editing and avoid overwriting unrelated work.

## Open Questions

1. Should reshuffle avoid overlap only among unplaced pieces, or also avoid overlapping placed/solved components?

Recommended default: only unplaced pieces. Placed components are authoritative puzzle state and can intentionally sit wherever users dragged them.

Yup

2. How strict should "overlap" be?

Recommended default: no padded rectangular DOM-box overlap. Exact polygon/mask overlap is not worth the complexity for this task.

polygon overlap would be better, but we can go with bounding box

3. Should pieces be allowed to move farther outside the solved image border to satisfy spacing?

Recommended default: yes, within the existing logical board space. The whole point of the surrounding ring is to hold unsolved pieces; avoiding overlap is more important than preserving the exact current border distance.

Sure

4. Should the algorithm preserve the current small random-looking jitter?

Recommended default: keep subtle seeded variation only when it does not break collision guarantees. Deterministic, readable spacing is more important than randomness.

No need

5. Should collision avoidance account for future "many hundred pieces" now?

Recommended default: use an O(n^2) rectangle check for the current sizes unless profiling shows it matters. For several hundred pieces this is still acceptable on reshuffle; if needed later, replace the overlap check with a grid spatial index without changing the public behavior.

Yes
