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
  - makes divergent scalar todo color edits across main and the branch;
  - opens merge preview and verifies changed paths;
  - accepts the merge and verifies the merged color state and timeline merge event.
- Preserved the existing server history preview and migration/stale-review coverage.
- Iterated on branch coverage:
  - an attempted branch todo insertion exposed a separate app crash: `Cannot translate CRDT path: array index 4 is missing`.
  - changed this phase's branch/merge test to use scalar `bgcolor` edits so the server branch/merge UI is covered without blocking on that app bug.
  - merge impact treats older scalar source updates as no-effect when a newer main update wins, so the passing test makes the branch edit after the main edit before merging.
- Verification:
  - `pnpm test:e2e -- tests/server/server-sync.spec.ts tests/server/server-offline.spec.ts tests/server/server-branches.spec.ts` passed: 4 tests in 35.3s.
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
