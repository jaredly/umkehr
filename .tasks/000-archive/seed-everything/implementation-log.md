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
- Reduced solo hot-path rerenders for large seeded documents:
  - `SoloApp.saveHistory` now persists without mirroring every edit into `historySnapshot` state.
  - Added non-subscribing `getHistory()` to `createHistoryContext`.
  - Moved `useHistory()` out of `SoloDocument` into a small `SoloHistoryPanel`, so the app panel/editor subtree is not subscribed to every history graph update.
  - Memoized the disabled-ephemeral editor wrapper passed to app panels.
  - `npx vitest run src/react/react.test.tsx`: 15 pass.
  - `npx vitest run src/lib/seed/generate.test.ts`: 13 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
  - After memoizing the panel editor wrapper, `pnpm build` in `examples/react-crdt`: passed.
- Added a focused solo render regression test that edits one todo title and verifies only that todo row rerenders while unsubscribed controls and the todo list stay stable.
  - `npx vitest run src/lib/solo/solo-render.test.tsx`: 1 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
- Fixed stale `useValue` subscriptions after keyed todo rows move between array indices:
  - `useResettingState` now updates the current memoized value cell instead of a stale cell from the component's first path.
  - Added a regression for title edit -> reorder -> undo reorder -> undo title.
  - `npx vitest run src/react/react.test.tsx`: 15 pass.
  - `npx vitest run src/lib/solo/solo-render.test.tsx`: 3 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
  - Rechecked with normal `useEffect` subscriptions; layout effects are not required for this fix.
- Fixed local simulator document switching:
  - Local mode now waits for the requested document to load before mounting replica panels, avoiding the initial default 4-todo flash for seeded `?doc=` URLs.
  - Replica providers remount per active document so path subscriptions do not leak across document swaps.
  - Removed the earlier `react-crdt` hook tolerance attempt; the fix is now contained to local simulator lifecycle.
  - `npx vitest run src/react-crdt/react-crdt.test.tsx`: 18 pass.
  - `npx vitest run src/react/react.test.tsx`: 15 pass.
  - `npx vitest run src/lib/solo/solo-render.test.tsx`: 3 pass.
  - `pnpm build` in `examples/react-crdt`: passed.
- Removed the duplicate server document dropdown:
  - The main server Document dropdown now includes branch-free seed documents.
  - Server client seed controls now only choose the client-state scenario and apply it to the currently selected document.
  - `pnpm build` in `examples/react-crdt`: passed.
