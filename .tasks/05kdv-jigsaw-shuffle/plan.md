# Plan: Dense Jigsaw Border Packing

## Decisions From Research

- Add a real 1000-piece jigsaw option.
- Reshuffled pieces must stay fully outside the image rectangle.
- Collision avoidance only considers the set being reshuffled. Existing positioned pieces are not
  obstacles.
- The overlap limit is `intersectionArea / min(pieceAreaA, pieceAreaB) <= 0.10`.
- For tabbed pieces, collision polygons use only each path segment's `.to` coordinate. Curvature is
  ignored.
- Pieces are not rotated.
- Simple deterministic output for the full input set is enough. The layout does not need stable
  per-piece positions when the input set changes.
- If 1000-piece shuffling takes more than 300 ms, make shuffling incremental and render
  intermediate states every 100 ms. In that mode, up to 1000 ms total is acceptable.

## Phase 1: Preserve Current Work And Add 1000-Piece Support

Files:

- `examples/react-crdt/src/apps/jigsaw/artifacts.ts`
- `examples/react-crdt/src/apps/jigsaw/JigsawApp.tsx`
- `examples/react-crdt/scripts/jigsaw-board-svg.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`
- `examples/react-crdt/tests/helpers/documents.ts`

Tasks:

1. Inspect the current jigsaw diffs before editing. `artifacts.ts` is already modified in the
   worktree, so preserve unrelated changes.
2. Extend `JigsawPieceCount` and `isJigsawPieceCount` to include `1000`.
3. Add `1000` to document creation UI and test helpers.
4. Add a `gridForPieceCount(1000)` entry. Start with `40 x 25`; it preserves the landscape shape
   better than the other simple factor pairs.
5. Update script usage/help text and any validation tests that enumerate supported counts.
6. Add rectangular and Voronoi generation tests for 1000 pieces. Keep the assertions focused so the
   suite does not become slow:
   - correct piece count,
   - positive finite bounds,
   - non-empty masks,
   - reciprocal neighbor offsets for either all pieces or a representative sample,
   - `validConnections` accepts a sampled neighbor.

Acceptance criteria:

- A 1000-piece board can be created through the normal app flow.
- Existing 12, 30, 60, 120, and 600-piece behavior remains supported.

## Phase 2: Add Packing Geometry And Metrics

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- optional new helper file, for example `examples/react-crdt/src/apps/jigsaw/jigsawPacking.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Add geometry helpers for packing:
   - convert a piece mask to an endpoint-only local polygon,
   - translate a local polygon to a placed image-space polygon,
   - compute polygon area with the shoelace formula,
   - compute AABBs for broadphase checks,
   - compute shortest distance from a placed AABB or polygon to the image rectangle,
   - test whether a piece is fully outside the image rectangle.
2. Add pair-overlap measurement:
   - use AABB broadphase to avoid unnecessary polygon work,
   - use endpoint-only polygons for the narrowphase,
   - report `intersectionArea / min(areaA, areaB)`.
3. If exact concave polygon intersection is too much for the first pass, use triangulation or a
   small local clipping utility rather than a sampling approximation in the final production path.
4. Add metric helpers that summarize a generated layout:
   - runtime,
   - placed count,
   - max border distance,
   - P95 border distance,
   - mean border distance,
   - max overlap ratio,
   - count of overlap violations,
   - count of outside-rectangle violations.
5. Add unit tests for geometry edge cases:
   - touching rectangles/polygons count as zero overlap,
   - smaller-piece overlap ratio is used,
   - pieces intersecting the image rectangle fail the outside check,
   - tabbed masks are converted from `.to` endpoints only.

Acceptance criteria:

- Packing quality can be measured independently of the UI.
- Tests verify the specific geometry semantics decided in research.

## Phase 3: Build The Benchmark Harness

Files:

- new script, likely `examples/react-crdt/scripts/jigsaw-pack-benchmark.ts`
- `examples/react-crdt/package.json`
- optional output file under `.tasks/05kdv-jigsaw-shuffle/`

Tasks:

1. Add a benchmark script that can run from `examples/react-crdt`.
2. Include the current ring/lane arranger as the baseline.
3. Run configurations for:
   - piece counts `12, 30, 60, 120, 600, 1000`,
   - rectangular and Voronoi boards,
   - tabs on and off,
   - at least 20 seeds,
   - all pieces unplaced, 75% unplaced, and 50% unplaced.
4. Emit CSV or markdown rows:

   ```txt
   algorithm, count, type, tabs, seed, subset, ms, maxDistance, p95Distance,
   meanDistance, maxOverlapRatio, overlapViolations, outsideViolations, attempts
   ```

5. Write the first benchmark results into the task directory, for example
   `.tasks/05kdv-jigsaw-shuffle/benchmark.md`.

Acceptance criteria:

- The current algorithm has repeatable baseline numbers.
- New algorithm variants can be compared without touching UI code.

## Phase 4: Prototype Candidate Packers

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- optional new helper file, for example `examples/react-crdt/src/apps/jigsaw/jigsawPacking.ts`
- benchmark script from Phase 3

Prototype two production-shaped algorithms before choosing the default.

### Candidate 1: Best-First Border Grid

Tasks:

1. Generate candidate centers outside the image rectangle in rows around all four sides and corners.
2. Sort candidates by border distance, then deterministic seed tie-breakers.
3. Sort pieces largest-first by polygon area or max dimension.
4. For each piece, choose the nearest candidate that:
   - keeps the piece fully outside the image rectangle,
   - keeps all pair overlap ratios at or below 10% against already placed reshuffled pieces.
5. Use a spatial hash over candidate AABBs so 1000-piece checks do not degrade into expensive
   all-pairs work.
6. Track attempt counts and collision-check counts for benchmark diagnostics.

### Candidate 2: Binary-Searched Perimeter Shelf

Tasks:

1. Binary-search the minimum exterior band depth that can fit all pieces.
2. For each candidate depth, pack pieces into top, right, bottom, left, and corner shelf regions.
3. Keep every accepted placement fully outside the image rectangle.
4. Validate overlap with the same spatial hash and polygon overlap helpers.
5. Stop the search when the band-depth improvement is smaller than a useful pixel threshold.

Selection criteria:

- Zero outside-rectangle violations.
- Zero overlap violations above 10%.
- Lowest max border distance is the primary quality metric.
- P95 and mean distance break ties.
- Runtime decides between algorithms with similar distance quality.

Acceptance criteria:

- Both candidates can be run through the same benchmark harness.
- At least one candidate is clearly better than the current algorithm on max distance for 600 and
  1000-piece boards.

## Phase 5: Replace `arrangeUnplacedPieces`

Files:

- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.test.ts`

Tasks:

1. Keep the public `arrangeUnplacedPieces(board, pieces, stage, seed)` signature.
2. Move the selected packer behind that function.
3. Preserve existing behavior for empty input and invalid stage sizes.
4. Preserve deterministic output for the same board, piece list, stage, and seed.
5. Return positions in image coordinates, as the existing renderer expects.
6. Ensure the function only packs the supplied `pieces` list and does not look at authoritative
   state positions.
7. Keep any alternate packers private or test-only unless there is a clear need to expose them.

Tests:

- Deterministic output for fixed input and seed.
- Empty and invalid stage cases return an empty map.
- Rectangular, Voronoi, tabbed rectangular, and tabbed Voronoi boards satisfy:
  - all requested pieces receive positions,
  - every piece is fully outside the image rectangle,
  - max pair overlap ratio is <= 10%.
- Include 600 and 1000-piece coverage. If exact all-pairs validation is too slow, use the spatial
  index validator in tests too.

Acceptance criteria:

- The existing `Reshuffle` button gets better packing without needing UI changes.
- Unit tests enforce the hard constraints.

## Phase 6: Add Incremental Shuffling If Needed

Only do this phase if benchmarked 1000-piece packing exceeds 300 ms on typical local runs.

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/apps/jigsaw/jigsaw.ts`
- optional new hook/helper, for example `examples/react-crdt/src/apps/jigsaw/useIncrementalShuffle.ts`

Tasks:

1. Refactor the selected packer so it can run as a generator or chunked async job.
2. Yield partial placement maps at least every 100 ms while work remains.
3. In `JigsawPanel`, start an incremental reshuffle job when the user clicks `Reshuffle`.
4. Render intermediate local layout positions as chunks arrive.
5. Disable or cancel the current reshuffle cleanly if:
   - the user clicks `Reshuffle` again,
   - the board artifact changes,
   - the unplaced set changes,
   - the component unmounts.
6. Keep total 1000-piece shuffle time under 1000 ms in incremental mode.
7. Avoid dispatching CRDT patches; this remains local UI state.

Acceptance criteria:

- If synchronous packing is slow, the UI still updates every 100 ms or better.
- Incremental work does not race with dragging or document changes.

## Phase 7: UI And Viewport Review

Files:

- `examples/react-crdt/src/apps/jigsaw/JigsawPanel.tsx`
- `examples/react-crdt/src/style.css`
- `examples/react-crdt/tests/smoke/jigsaw-solo.spec.ts`

Tasks:

1. Confirm the existing `boardSpaceFor` padding is large enough for the new dense exterior band,
   including 1000-piece boards.
2. If pieces are clipped by the canvas/viewport, adjust local board-space padding. Do not change CRDT
   stored coordinates.
3. Add a minimal progress/disabled state only if incremental shuffling is implemented.
4. Consider a smoke test that clicks `Reshuffle` and validates visible piece boxes do not heavily
   overlap. Keep hard geometry guarantees in Vitest, not Playwright.

Acceptance criteria:

- Dense packed pieces are visible and reachable.
- Dragging, snapping, undo, redo, preview, minimap, pan, and zoom are not regressed.

## Phase 8: Verification

Run focused checks from `examples/react-crdt`:

```sh
npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts
npm run build
```

Run the benchmark script and archive the final comparison in the task directory.

Run smoke coverage if practical:

```sh
pnpm exec playwright test tests/smoke/jigsaw-solo.spec.ts
```

Manual verification:

- Create rectangular and Voronoi boards at 120, 600, and 1000 pieces.
- Test tabs on and off.
- Click `Reshuffle` several times.
- Confirm reshuffled pieces remain outside the image rectangle.
- Confirm there are no visually obvious overlap violations.
- Confirm high-count shuffling either completes quickly or renders progressive updates.

## Risks

- Exact polygon overlap for endpoint-only tab polygons is the most technical part. Keep it isolated
  and covered by tests.
- The best-first candidate grid may still strand a late large piece. Benchmark Candidate 2 before
  accepting that tradeoff.
- 1000-piece Voronoi generation may expose generator performance issues separate from packing.
- Incremental shuffling adds UI state and cancellation complexity; only add it if measurement shows
  it is needed.
