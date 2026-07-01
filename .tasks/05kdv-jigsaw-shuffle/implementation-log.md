# Implementation Log: Dense Jigsaw Border Packing

## 2026-06-30

- Started implementation from `plan.md`.
- Checked current jigsaw source diffs before editing. No tracked jigsaw source diffs were present at
  start, so there was no existing source work to preserve in the touched files.
- Phase 1 complete: added real 1000-piece support to artifact typing/validation, the creation UI,
  Playwright document helper options, SVG script validation/help text, and artifact tests.
- Verification: `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passed with 41 tests.
- Phase 2 complete: added endpoint-only packing geometry helpers, polygon overlap/ratio metrics,
  outside-image validation, border-distance metrics, and unit tests.
- Issue: tabbed masks can repeat the first endpoint as a closing segment. Workaround: expose raw
  `.to` endpoints for collision polygons, while normalizing duplicate closing points internally for
  area/intersection math.
- Issue: the new 1000-piece Voronoi test was nondeterministic when using default `Math.random()`.
  Workaround: fixed the test seed for 600/1000 Voronoi viability coverage.
- Verification: `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passed with 46 tests.
- Phase 3 complete: added `scripts/jigsaw-pack-benchmark.ts` and the
  `npm run jigsaw:pack-benchmark` script. Quick benchmark output is written to
  `.tasks/05kdv-jigsaw-shuffle/benchmark.md`.
- Phase 4/5 complete: preserved the old ring/lane arranger as `currentRingLane`, prototyped
  `bestFirstGrid` and `perimeterShelves`, and replaced public `arrangeUnplacedPieces` with the
  perimeter shelf packer.
- Decision: `bestFirstGrid` produced lower max distances on some 1000-piece Voronoi cases, but took
  roughly 600-1200 ms in quick benchmark runs. `perimeterShelves` stayed around 0.4-0.5 ms for
  1000-piece cases while removing the worst current outliers, so it is the production path.
- Issue: an attempted dynamic-row shelf variant was faster but increased max distance by wasting
  corner band capacity. Workaround: discarded that variant and kept the fixed-ring perimeter shelf.
- Issue: padded bounding-box tests caught corner-touching shelves because bare pieces touched at the
  image corner. Workaround: added shelf-corner clearance and a small floating-point margin to the
  packing gap.
- Phase 6 skipped: selected 1000-piece packer is far below the 300 ms incremental-shuffle threshold.
- Verification: `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passed with 49 tests.
- Verification: `npm run build` passed. Vite still reports pre-existing large chunk warnings.
- Follow-up decision: use the nicer `bestFirstGrid` packer for 12, 30, and 60-piece boards, and
  use `perimeterShelves` for 120 pieces and above.
- Test adjustment: low-count grid packing intentionally allows denser placements than the old padded
  bounding-box check. Tests now enforce the actual researched contract: pieces remain outside the
  image rectangle and pair overlap stays within the 10% smaller-piece threshold.
- Verification: `npm exec vitest -- run src/apps/jigsaw/jigsaw.test.ts` passed with 50 tests.
- Verification: `npm run build` passed. Vite still reports large chunk warnings.
