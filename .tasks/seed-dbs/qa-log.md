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
