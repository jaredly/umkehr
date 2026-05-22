# QA implementation log

## Phase 1: seed fixture update granularity

- Reworked seeded fixture edits to go through CRDT local command generation instead of hand-written root `set` events.
- Kept root replacement for initial document creation, then switched follow-up fixture edits to specific todo fields, todo array pushes, whiteboard record entries, and whiteboard background paths.
- Added deterministic `Date.now` wrapping around seed command generation so `--date` remains stable with command-generated HLC updates.
- Fixed `whiteboard-branches` so `main` merges branch-local `layout` and `annotation` element additions instead of competing root replacements.
- Added generator tests for non-root branch edit paths and materializing `whiteboard-branches` main with merged elements.

Verification:

- `bun run build` in `examples/react-crdt`: passed.
- `bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-qa-phase1.sqlite` in `examples/react-crdt-server`: passed.
- `npm run test -- examples/react-crdt/src/lib/seed/generate.test.ts`: blocked by existing Typia transform setup in root Vitest, before tests run.

## Phase 2: merge impact analysis

- Added `MergeImpact` data to merge previews with total source updates, effective updates, already-merged updates, no-effect updates, and already-merged-through metadata.
- Merge impact now recursively collects source update events through nested merge events.
- Already-merged coverage is computed by walking target merge events and their nested source merges.
- Effective update counts are computed by applying candidate source updates over the target pre-merge document and checking whether state or CRDT metadata changes.
- Added materialization tests for fresh effective merges, already-merged no-op merges, LWW-losing source updates, and recursive source merge counts.

Verification:

- `bun run build` in `examples/react-crdt`: passed.
- `npx vitest run examples/react-crdt/src/lib/server/materialize.test.ts`: passed.

## Phase 3: merge UI impact display

- Updated the merge preview UI to lead with `Changes to bring in` from `effectiveUpdateCount`.
- Added visible counts for already-merged status, source updates, no-effect updates, already-merged updates, source paths, kept paths, and reverted paths.
- Disabled both merge buttons when the preview has zero effective updates.
- Added no-op messaging for already-merged and otherwise no-effect merge previews.
- Renamed path labels to make clear they are source changed paths, not the merge impact count.

Verification:

- `bun run build` in `examples/react-crdt`: passed.
