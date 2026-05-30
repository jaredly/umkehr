# Playwright E2E Coverage Implementation Log

## 2026-05-29

### Phase 1: Test Infrastructure And Existing Test Cleanup

- Started Phase 1.
- Audited current Playwright files:
  - `tests/todo-smoke.spec.ts`
  - `tests/server-migration.spec.ts`
  - `tests/helpers/app.ts`
  - `tests/helpers/server.ts`
- Noted current `server-migration.spec.ts` already includes stale merge review coverage in addition to schema migration coverage; preserve those tests during the move.
- Added `tests/helpers/todos.ts` and moved todo panel, drag/reorder, unique doc id, and animation-recorder helpers out of the old smoke spec.
- Split `tests/todo-smoke.spec.ts` into:
  - `tests/smoke/todo-solo.spec.ts`
  - `tests/smoke/todo-local-sync.spec.ts`
  - `tests/server/server-history-preview.spec.ts`
- Moved `tests/server-migration.spec.ts` to `tests/server/server-migration.spec.ts` and updated relative imports.
- Added initial focused scripts:
  - `test:e2e:smoke`
  - `test:e2e:server`
- Verification:
  - `pnpm test:e2e:smoke` passed: 3 tests in 17.8s.
  - `pnpm test:e2e:server` passed: 12 tests in 2.1m.
  - Both commands required running outside the default sandbox because Playwright/Vite need to bind localhost ports.

### Phase 2: Stable Selectors And App Testability

- Added behavior-neutral `data-testid` and data attributes for future E2E helpers:
  - document manager trigger, modal, archive file input, document rows, and seed rows;
  - whiteboard panel, viewport, canvas, note, emoji, stroke, archive tray/items, and minimap;
  - server history root, branch list/buttons, merge panel/path rows, and timeline/events.
- Verification:
  - `pnpm test:e2e:smoke` passed: 3 tests in 17.2s.
  - `pnpm build` passed.

### Phase 3: Core Smoke Coverage

- Added shared app routing helpers:
  - `openApp`
  - `selectArchitecture`
  - `selectExampleApp`
  - `uniqueTestDocId`
- Added `tests/smoke/app-routing.spec.ts` covering top-bar app/mode changes, deep links, and browser history restoration.
- Expanded todo smoke coverage:
  - solo color persistence after reload;
  - local paused-sync divergent edits, queue counts, resume, and convergence.
- Added `tests/helpers/whiteboard.ts` with deterministic viewport-based pointer helpers and note text polling.
- Added whiteboard smoke coverage:
  - solo note, move, resize, emoji, stroke, archive, recover, undo/redo, and reload persistence;
  - local note sync between replicas;
  - local paused-sync divergent edits, queue counts, resume, and convergence.
- Iterated on failures:
  - tightened whiteboard tool locators to avoid matching note color swatches;
  - adjusted todo convergence expectation to match deterministic CRDT order;
  - replaced unsupported locator display-value checks with textarea value polling;
  - clamped whiteboard pointer coordinates to the measured viewport for two-column layouts.
- Verification:
  - `pnpm test:e2e:smoke` passed: 10 tests in 57.9s.
  - `pnpm build` passed.

### Phase 4: Document Manager And Archive Coverage

- Added `tests/helpers/documents.ts` covering:
  - opening/closing the document manager;
  - creating documents;
  - opening documents by title or doc id;
  - deleting local documents with dialog acceptance;
  - creating seed documents;
  - exporting current documents;
  - importing archive files.
- Added `tests/documents/document-manager.spec.ts`:
  - creates, switches, and deletes local todo documents;
  - verifies state isolation between local documents;
  - creates todo and whiteboard seed fixtures and opens them.
- Added `tests/documents/archive-import-export.spec.ts`:
  - exports a solo todo archive from one browser context;
  - imports it into a fresh browser context;
  - verifies the imported document opens with expected content.
- Iterated on failures:
  - made `openDocumentManager` reuse an already-open modal;
  - switched the whiteboard seed assertion to a smaller deterministic fixture (`whiteboard-element-editing`).
- Verification:
  - `pnpm test:e2e -- tests/documents` passed: 3 tests in 33.0s.
  - `pnpm test:e2e:smoke` passed: 10 tests in 58.1s.
  - `pnpm build` passed.

### Phase 5: Server Sync, Offline, History, And Branches

- Added `tests/server/server-sync.spec.ts`:
  - verifies two logged-in clients sync edits through the seeded server database;
  - verifies online presence appears/disappears as another client connects and closes;
  - verifies logout returns to login without deleting the local server replica.
- Added `tests/server/server-offline.spec.ts`:
  - verifies manual disconnect keeps edits local;
  - verifies unsynced count increments while offline;
  - verifies reconnect flushes the edit to the server and a fresh client sees it.
- Added `tests/server/server-branches.spec.ts`:
  - creates a branch;
  - inserts a todo on the branch;
  - opens merge preview and verifies changed paths;
  - accepts the merge and verifies the inserted todo and timeline merge event.
- Preserved the existing server history preview and migration/stale-review coverage.
- Iterated on branch coverage:
  - an attempted branch todo insertion exposed a separate app crash: `Cannot translate CRDT path: array index 4 is missing`.
  - temporarily changed this phase's branch/merge test to use scalar `bgcolor` edits so the server branch/merge UI was covered without blocking on that app bug.
  - after the bug was fixed, restored branch coverage to insert and merge a real todo from the source branch.
- Verification:
  - `pnpm test:e2e -- tests/server/server-sync.spec.ts tests/server/server-offline.spec.ts tests/server/server-branches.spec.ts` passed: 4 tests in 35.3s before restoring insertion coverage.
  - `pnpm test:e2e -- tests/server/server-branches.spec.ts` passed after restoring insertion coverage: 1 test in 12.4s.
  - `pnpm test:e2e:server` passed: 16 tests in 2.5m.
  - `pnpm build` passed.

### Phase 6: Local PeerServer Infrastructure

- Added `peer` as a dev dependency so E2E can start a local PeerServer without relying on the public PeerJS cloud broker.
- Added configurable PeerJS client options:
  - `VITE_UMKEHR_PEERJS_HOST`
  - `VITE_UMKEHR_PEERJS_PORT`
  - `VITE_UMKEHR_PEERJS_PATH`
  - `VITE_UMKEHR_PEERJS_SECURE`
- Wired those options into both PeerJS sync paths:
  - `src/lib/peerjs/usePeerJsSync.ts`
  - `src/lib/local-first/useLocalFirstSync.ts`
- Updated Playwright web server startup to point browser clients at the local test PeerServer endpoint.
- Added `tests/helpers/peer.ts`:
  - starts `node_modules/.bin/peerjs` on the configured test port;
  - waits for the PeerServer id endpoint;
  - kills the process at test cleanup.
- Added `tests/peerjs/peerjs-sync.spec.ts` as a minimal real PeerJS host/client smoke test.
- Added `test:e2e:peerjs`.
- Iterated on PeerServer readiness:
  - local PeerServer with `--path /peerjs` exposes its id endpoint at `/peerjs/peerjs/id?key=peerjs`;
  - adjusted the readiness probe accordingly.
- Verification:
  - `pnpm test:e2e -- tests/peerjs/peerjs-sync.spec.ts` passed: 1 test in 13.4s.
  - `pnpm build` passed.

### Phase 7: PeerJS And Local-First Coverage

- Added PeerJS coverage:
  - `tests/peerjs/peerjs-ui.spec.ts` verifies host invite UI and host-only document management.
  - Expanded `tests/peerjs/peerjs-sync.spec.ts` to verify host-to-client sync, client-to-host sync, disconnected client queueing, and reconnect flush.
- Added stable control selectors:
  - `data-testid="peerjs-controls"` and `data-peer-id` on PeerJS connection rows.
  - `data-testid="local-first-controls"`, `local-first-stats`, `local-first-invite-box`, and `data-peer-id` on local-first connection rows.
- Added local-first coverage:
  - `tests/local-first/local-first-ui.spec.ts` verifies durable reload persistence, invite readiness, reset confirmation, and same-replica tab locking.
  - `tests/local-first/local-first-sync.spec.ts` verifies real PeerJS-backed local-first sync in both directions, request sync, and retained log compaction.
  - `tests/local-first/local-first-migration.spec.ts` creates a real v1 local-first replica and migrates it through the current local-first migration panel.
- Wired local-first mode to receive app-specific migration config from the app registry.
- Added `test:e2e:local-first`.
- Iterated on failures:
  - PeerJS connection rows display actor names, so tests now target `data-peer-id` instead of row text.
  - Local-first invite readiness requires a local PeerServer, so the invite UI test starts one explicitly.
  - Server migration seed fixtures are not branch-free local histories, so the migration spec now creates the old local replica through the v1 local-first UI.
- Verification:
  - `pnpm test:e2e:peerjs` passed: 2 tests in 19.9s.
  - `pnpm test:e2e:local-first` passed: 4 tests in 28.5s.
  - `pnpm build` passed.

### Phase 8: Demo Specs

- Added `playwright.demo.config.ts`:
  - demo-only `tests/demo` test directory;
  - Chromium desktop viewport `1440x1000`;
  - video recording enabled;
  - traces disabled for demo runs;
  - same local app/server/PeerJS environment wiring as the reliability config.
- Added `tests/helpers/demo.ts` with optional `UMKEHR_E2E_DEMO` pacing.
- Added committed demo specs:
  - `tests/demo/todo-local-conflict.demo.spec.ts`
  - `tests/demo/whiteboard-collaboration.demo.spec.ts`
  - `tests/demo/server-branch-merge.demo.spec.ts`
  - `tests/demo/server-migration.demo.spec.ts`
- Added `test:e2e:demo`.
- Iterated on demo failures:
  - fixed a relative import for migration fixture metadata.
  - moved the whiteboard demo emoji click away from an existing replicated note so the stamp lands reliably in the demo viewport.
- Verification:
  - `pnpm test:e2e:demo` passed: 4 tests in 31.9s.
  - `pnpm build` passed.

### Phase 9: Runtime Review And CI Subset

- Reviewed measured local runtimes from the current implementation:
  - smoke: about 1.1m after adding the responsive/keyboard smoke.
  - server: about 2.5m.
  - PeerJS: about 20s.
  - local-first: about 29s.
  - demo: about 32s.
- Kept the existing split as the practical critical/extended boundary:
  - `test:e2e:smoke` is the critical local UI subset.
  - `test:e2e:server`, `test:e2e:peerjs`, `test:e2e:local-first`, and `test:e2e:demo` are focused extended suites.
- Documented the E2E commands and current runtimes in `examples/react-crdt/README.md`.

### Phase 10: Responsive And Keyboard Smoke

- Added `tests/smoke/responsive-keyboard.spec.ts`.
- Coverage includes:
  - narrow mobile-like viewport (`390x844`);
  - top-bar app and architecture selectors remain visible;
  - document manager modal opens and creates a document;
  - todo add form submits with Enter;
  - todo edit commits with Enter.
- Verification:
  - `pnpm test:e2e:smoke` passed: 11 tests in 1.1m.
