# Research: Dense Border Packing for Jigsaw Reshuffle

## Goal

Replace the current "reshuffle" placement for unplaced jigsaw pieces with an actual packing
algorithm. The important quality target is dense packing around the board border, with special
attention to minimizing the worst outlier distance from the board. A layout where one piece is very
far away is worse than a slightly looser but even layout.

Hard constraints and targets from the task:

- Optimize speed.
- Minimize max distance away from the board border.
- No piece may overlap another piece by more than 10%.
- Collision tests may treat pieces with tabs as plain polygons.
- The algorithm should work for 1000-piece puzzles.

## Current Code Shape

Relevant files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

The UI calls:

```ts
arrangeLocalUnplacedPieces(board, pieces, seed)
```

which currently delegates to:

```ts
arrangeUnplacedPieces(board, pieces, board.imageSize, seed)
```

Important coordinate detail: the arranger works in image coordinates. `JigsawPanel` later adds the
image offset when rendering into the larger board canvas. So the board border for placement metrics
is the image rectangle:

```ts
{left: 0, top: 0, right: board.imageSize.width, bottom: board.imageSize.height}
```

Current implementation:

- Computes a padded bounding rectangle for each piece with `rectForPiece`.
- Walks four lanes around the board.
- Searches fixed slots lane-by-lane, ring-by-ring.
- Accepts the first zero-overlap padded rectangle position.
- Falls back to the lowest bounding-rect overlap if it cannot find a zero-overlap slot.

This is deterministic and simple, but it is a greedy slot search. Late pieces can be pushed to
outer rings even when a more global packing would keep the max distance lower.

Quick local baseline, using `bun` and the current code on this workspace:

| Board | Time | Max border distance | P95 distance | Mean distance | Max overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 120 rectangular | 37 ms | 486 px | 386 px | 189 px | 0 |
| 120 Voronoi tabbed | 3 ms | 637 px | 486 px | 261 px | 0 |
| 600 rectangular | 390 ms | 680 px | 524 px | 266 px | 0 |
| 600 Voronoi tabbed | 231 ms | 811 px | 585 px | 326 px | 0 |

These numbers are not a real benchmark yet, but they confirm the quality issue: the current
algorithm is strict about padded AABB overlap, but it throws pieces much farther from the board than
the area lower bound should require.

## Geometry And Metrics

### Distance Metric

Recommended metric:

```txt
distance(piece, board) = shortest Euclidean distance from the placed piece polygon/AABB to the
board rectangle, with 0 if it intersects the rectangle.
```

Primary score:

```txt
max(distance(piece, board))
```

Secondary scores:

- P95 distance.
- Mean distance.
- Max distance normalized by average piece size.
- Number of pieces beyond useful bands, for example `> 2x`, `> 4x`, `> 8x` average piece size.

Max distance should lead the benchmark because the task explicitly penalizes outliers.

### Overlap Metric

Recommended constraint:

```txt
overlapRatio(a, b) = intersectionArea(a, b) / min(area(a), area(b))
```

Then require:

```txt
maxPairOverlapRatio <= 0.10
```

Using the smaller piece as denominator is conservative and matches "no piece can overlap more than
10% with another piece" better than using union area.

Use a broadphase spatial hash over AABBs, then a narrowphase polygon overlap check only for nearby
pairs. A final benchmark can afford all-pairs validation for 1000 pieces, but the actual arranger
should not rely on all-pairs checks in its inner loop.

### Polygon Handling

Current `JigsawPiece.mask` stores line, quadratic, and cubic path segments. For packing:

- Use `bounds` for broadphase.
- Convert the mask into a placed polygon for narrowphase.
- For curved tab segments, flatten into a small number of line segments, or use segment endpoints if
  we decide "plain polygons" means ignoring curve curvature.

Exact polygon overlap for concave polygons is the main geometry choice. Options:

- Add a small polygon clipping dependency and keep our code simple.
- Implement local ear clipping plus triangle intersection/area.
- Use a deterministic sampling approximation only for benchmark exploration, then replace it before
  committing production behavior.

## Algorithm Options

### Option A: Binary-Searched Perimeter Shelf Packing

Search for the smallest border band depth `D` that can fit all pieces. For a candidate `D`, pack
pieces only in the shell around the board:

```txt
expandedRect(board, D) minus boardRect
```

Feasibility algorithm:

1. Sort pieces largest-first, probably by max AABB dimension or polygon area.
2. Split the shell into shelves/rows around the top, right, bottom, and left sides.
3. Place each piece into the first shelf with enough remaining interval space.
4. Use a spatial hash plus polygon overlap check to allow overlaps up to 10%.
5. If all pieces fit, lower `D`; otherwise increase `D`.

Why it fits the task:

- Directly optimizes max distance by construction.
- Deterministic.
- Fast enough for 1000 pieces if the feasibility check is near `O(n log n)`.
- Easy to benchmark against current behavior.

Risks:

- Shelves can waste space near corners and with irregular Voronoi pieces.
- Largest-first placement may create holes that smaller pieces do not fully recover.
- If shelves are axis-aligned and rotations are disallowed, quality depends heavily on side
  assignment.

Expected role: best first implementation candidate. It should be simple, stable, and much better on
max distance than the current ring search.

### Option B: Best-First Candidate Grid Around The Border

Generate candidate center points in rows around the board, sorted by distance from the board border.
For each piece, choose the first candidate whose overlap with already placed pieces is <= 10%.

Candidate generation:

- Create rings/rows at fixed row spacing based on average piece height.
- For each row, sample along all four sides and corners.
- Sort candidates by distance, then seed-based tie-breakers.
- Place larger pieces first.

Why it fits the task:

- Very close to the current mental model, but fills nearest candidates globally instead of walking
  one piece into a far ring.
- Max distance is naturally controlled by the largest candidate distance used.
- Simple to implement and reason about.

Risks:

- Candidate spacing is sensitive: too coarse wastes space, too fine costs time.
- Greedy ordering can still strand one large piece unless pieces are sorted well.
- Needs duplicate/corner candidate cleanup.

Expected role: strong baseline and probably easiest to prototype. It may be enough if seeded
candidate density is tuned.

### Option C: Skyline Packing In Four Exterior Bins

Treat the border as four bins:

- Top strip.
- Right strip.
- Bottom strip.
- Left strip.

Each strip gets a skyline/guillotine-style 2D bin packer. Corners can be assigned to the adjacent
strip with more pressure, or represented as four additional corner bins.

Process:

1. Estimate minimum required strip depth from total piece area.
2. Assign pieces to strips by balancing area and width/height pressure.
3. Pack each strip with a standard skyline or max-rects heuristic.
4. Increase strip depth until all pieces fit.
5. Optionally run a short local compaction pass.

Why it fits the task:

- Very fast for 1000 pieces.
- Uses known bin-packing heuristics instead of bespoke lane logic.
- Binary searching strip depth still targets max distance.

Risks:

- Hard boundaries between strips can leave visible seams at side transitions.
- Corner utilization needs care or the max distance may increase unnecessarily.
- AABB-oriented bin packing can be over-conservative for Voronoi pieces unless polygon overlap is
  allowed during refinement.

Expected role: fastest serious candidate. Worth benchmarking if Option A is too slow or too hard to
tune.

### Option D: Frontier Packing With Local Compaction

Start from the board border and keep a frontier of candidate placements adjacent to either the board
or already-placed pieces. Always place the next piece in the candidate with the best score:

```txt
score = maxDistancePenalty + overlapPenalty + gapPenalty + sideBalancePenalty
```

After the greedy pass, run a few local compaction sweeps that move pieces inward while preserving
the overlap limit.

Why it fits the task:

- Usually produces denser, more organic layouts than shelves.
- Can use polygon overlap directly.
- Local compaction can reduce wasted holes left by greedy placement.

Risks:

- More complex and more tuning-heavy.
- Harder to keep deterministic and consistently fast.
- Local minima are likely; benchmark results may vary by seed and piece shape.

Expected role: quality contender after a simpler shelf/grid baseline exists.

### Option E: Physics/Constraint Relaxation

Initialize with a dense border layout, then simulate forces:

- Repel overlapping pieces.
- Pull every piece toward the nearest board edge.
- Keep pieces outside or near the board border according to policy.
- Stop after a fixed iteration budget.

Why it fits the task:

- Can smooth out cramped layouts and use the 10% overlap allowance naturally.
- Useful as a cleanup pass after Option A, B, or C.

Risks:

- Not a good primary algorithm for 1000 pieces unless carefully bounded.
- Determinism and convergence are harder to guarantee.
- It can accidentally create one outlier if the distance penalty is too weak.

Expected role: optional refinement, not the first implementation.

## Benchmark Plan

Build a small benchmark harness around `arrangeUnplacedPieces` variants. It should run outside the
browser first, probably as a Vitest perf test or a standalone script that imports the jigsaw modules.

Inputs:

- Piece counts: 12, 30, 60, 120, 600, and a synthetic 1000-piece board.
- Board types: rectangular and Voronoi.
- Tabs: off and on.
- Seeds: at least 20 seeds per configuration.
- Subsets: all pieces unplaced, 75% random unplaced, 50% random unplaced.

Metrics per run:

- Runtime in milliseconds.
- Placed piece count.
- Max border distance.
- P95 border distance.
- Mean border distance.
- Max pair overlap ratio.
- Count of pair overlap violations above 10%.
- Candidate attempts or collision checks, for diagnosing speed.

Comparison table:

```txt
algorithm, count, type, tabs, seed, ms, maxDistance, p95Distance, meanDistance,
maxOverlapRatio, overlapViolations, attempts
```

Suggested acceptance direction:

- No overlap violations above 10%.
- 1000 pieces should finish fast enough for a click-triggered reshuffle on the main thread, ideally
  under 100 ms after tuning, but benchmark before locking this in.
- Max distance should be close to the theoretical shell-depth lower bound plus gap overhead, not
  several board widths away.

## Recommended Path

1. Implement the metric harness first.
2. Keep the current algorithm as `currentRingLane` baseline.
3. Prototype Option B because it is closest to existing code and cheap to compare.
4. Prototype Option A if Option B still has bad max-distance outliers.
5. Consider Option C if speed is the limiting factor.
6. Consider a short compaction pass only after a deterministic primary packer is working.

I would not start with physics or a full general packing solver. The task is primarily about bounded
max distance and practical 1000-piece performance; binary-searched perimeter feasibility or
best-first candidate filling maps to that directly.

## Open Questions

- Current supported `JigsawPieceCount` values stop at 600. Should this task add a real 1000-piece
  board option, or should the benchmark use a synthetic 1000-piece artifact only?
    - let's add a real 1000 piece option
- Should unplaced pieces be allowed to overlap the image/board area, or must they stay fully outside
  the puzzle rectangle? The current layout can place pieces around the border in a way that may
  visually intrude near the board edge.
    - stay outside the image rectangle
- Does the 10% overlap limit mean overlap relative to the smaller piece area, each piece's own area,
  or union area? I recommend smaller-piece area.
    - smaller-piece
- For tabbed pieces, does "plain polygons" mean flattening curved tabs into polygon edges, or
  ignoring tab curvature and using only coarse path endpoints/base polygons?
    - ignoring curvature, only use the `.to` coord for each pathsegment
- Should the reshuffle consider already-positioned loose pieces as obstacles, or only pack the set
  it is actively reshuffling? Current behavior preserves pieces that already have positions.
    - only packathe set it is reshuffling. positioned pieces don't need to be considered when doing collision avoidance
- Are rotations allowed? Current rendering assumes pieces keep puzzle orientation, so I assume no
  rotation.
    - no rotations
- Should the seed preserve stable per-piece placement across small changes in the unplaced set, or
  is deterministic output for the whole input set sufficient?
    - simple determinism is sufficient
- What is the desired UI latency target for 1000 pieces on typical hardware?
    - if it takes more than 300ms, we should have the shuffling be incremental, so we can render intermediate states every 100ms. in that case, it can take up to 1000ms total.
