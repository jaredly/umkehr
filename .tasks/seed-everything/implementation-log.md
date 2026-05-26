# Seed Everything Implementation Log

## 2026-05-26

Status: in progress.

Initial findings:

- The repo already has more seed fixtures than the archived server plan originally described.
- The repo also already has mode-specific IndexedDB persistence and document import/export controls for solo, local simulator, PeerJS host, local-first, and server client replicas.
- Implementation will build seed import/projection helpers on top of those existing stores instead of adding a separate generic browser document database.

Completed so far:

- Added shared seed helper exports for seed users/actors, branch-free fixture checks, fixture lookup, summaries, main-branch history/events/state.
- Added `SeedDocumentPicker` for opening branch-free seed documents with `?doc=` semantics.
- Wired seed document import into solo, local simulator, and PeerJS host persistence.
- Added local-first seed projection with deterministic identity and one update event per retained batch.
- Wired local-first seed import/open into the existing local-first IndexedDB store.
- Added server-client seed replica builders for cached, pending-upload, and stale-schema client IndexedDB scenarios; wired cached seed import into server mode for quick client-cache setup.
- Added a dedicated server-client seed UI with scenario selection for cached client, pending uploads, and stale schema.
- Added styling for shared seed pickers and server-client seed controls.

Verification:

- `npx vitest run src/lib/seed/generate.test.ts`: 13 pass.
- `pnpm build` in `examples/react-crdt`: passed.
- `bun test ./src/store.bun.ts ./src/cli.bun.ts` in `examples/react-crdt-server`: 16 pass.
- `bun run typecheck` in `examples/react-crdt-server`: passed.
- `bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-seed-everything.sqlite`: imported 18 documents and 4 users.
- After server-client seed UI changes:
  - `npx vitest run src/lib/seed/generate.test.ts`: 13 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
- Fixed browser `process is not defined` error in `src/lib/seed/generate.ts` by guarding CLI detection behind `globalThis.process`.
  - `npx vitest run src/lib/seed/generate.test.ts`: 13 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
- Fixed solo archive adapter perf issue by reading latest history from a ref instead of memoizing the adapter on every history change.
  - `pnpm build` in `examples/react-crdt`: passed.
