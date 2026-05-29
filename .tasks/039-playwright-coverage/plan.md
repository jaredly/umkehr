# Playwright E2E Coverage Plan

## Goal

Build comprehensive Playwright end-to-end coverage for `examples/react-crdt`, replacing the current ad-hoc structure with maintainable reliability specs plus committed demo-friendly specs. Keep the task focused on Playwright; do not reorganize unit/component tests except where E2E helpers need shared app affordances.

## Decisions From Research

- Demo specs should be normal committed Playwright tests under the test tree.
- Demo specs should run fast initially; do not add artificial slow pacing unless later video review proves it necessary.
- PeerJS and local-first sync should use real PeerJS connections.
- Add a local PeerServer/test PeerJS setup before relying on PeerJS sync tests in CI.
- `data-testid` attributes are acceptable where they make E2E interaction stable, especially for whiteboard and server history controls.
- Chromium-only coverage is sufficient for this plan.
- Archive coverage should test exporting from one context and importing into a fresh context.
- Server branch/merge coverage should include whiteboard, not just todos.
- Write broad coverage first; split out a critical CI subset later if total runtime becomes too high.

## Target Test Layout

```text
examples/react-crdt/tests/
  helpers/
    app.ts
    demo.ts
    documents.ts
    peer.ts
    server.ts
    todos.ts
    whiteboard.ts
  smoke/
    app-routing.spec.ts
    todo-solo.spec.ts
    todo-local-sync.spec.ts
    whiteboard-solo.spec.ts
    whiteboard-local-sync.spec.ts
  documents/
    document-manager.spec.ts
    archive-import-export.spec.ts
  server/
    server-sync.spec.ts
    server-offline.spec.ts
    server-branches.spec.ts
    server-history-preview.spec.ts
    server-migration.spec.ts
  peerjs/
    peerjs-ui.spec.ts
    peerjs-sync.spec.ts
  local-first/
    local-first-ui.spec.ts
    local-first-sync.spec.ts
    local-first-migration.spec.ts
  demo/
    todo-local-conflict.demo.spec.ts
    whiteboard-collaboration.demo.spec.ts
    server-branch-merge.demo.spec.ts
    server-migration.demo.spec.ts
```

## Phase 1: Test Infrastructure And Existing Test Cleanup

Objective: make the existing tests easier to grow without changing behavior.

Tasks:

- Split helper code out of `todo-smoke.spec.ts` into reusable modules:
  - `helpers/app.ts` for route opening, unique doc ids, storage cleanup, top-bar helpers, and common waits.
  - `helpers/todos.ts` for panel locators, add/edit/toggle/delete/reorder, and order assertions.
  - Keep and refine `helpers/server.ts` for isolated DB setup, seed, inspect, lock, and server lifecycle.
- Move current server migration coverage to `tests/server/server-migration.spec.ts`.
- Split current todo smoke coverage into focused specs:
  - `smoke/todo-solo.spec.ts`
  - `smoke/todo-local-sync.spec.ts`
  - `server/server-history-preview.spec.ts`
- Add consistent per-test isolation:
  - unique doc ids derived from `testInfo`;
  - fresh browser contexts where cross-test IndexedDB state could leak;
  - explicit storage cleanup helper when tests intentionally reuse a page.
- Update Playwright config paths if needed after moving specs.
- Add package scripts:
  - `test:e2e`
  - `test:e2e:smoke`
  - `test:e2e:server`
  - `test:e2e:demo`

Validation:

- Existing behavior remains covered after file moves.
- `pnpm test:e2e` passes from `examples/react-crdt`.

## Phase 2: Stable Selectors And App Testability

Objective: add minimal app affordances that make Playwright tests robust.

Tasks:

- Prefer accessible selectors where already available.
- Add `data-testid` attributes where role/class selectors are brittle:
  - document manager trigger/modal and rows;
  - whiteboard viewport/canvas;
  - whiteboard note, emoji, stroke, archive tray, and minimap controls as needed;
  - server timeline, branch list, merge panel, and merge path rows;
  - local/PeerJS/local-first connection rows where repeated text makes locators ambiguous.
- Avoid changing user-visible behavior while adding test IDs.
- Keep test IDs stable and semantic; do not encode transient visual state unless no better locator exists.

Validation:

- Existing unit tests and E2E tests still pass.
- New selectors are used by helper modules rather than duplicated across specs.

## Phase 3: Core Smoke Coverage

Objective: cover the main shell, todo, and whiteboard behavior in deterministic local modes.

Tasks:

- Add `smoke/app-routing.spec.ts`:
  - default route opens local/todos;
  - architecture selector updates URL and rendered shell;
  - app selector switches between Todos and Whiteboard;
  - direct deep links for mode/app/doc work;
  - browser back/forward restores selection.
- Expand todo solo coverage:
  - add/trim/reject empty;
  - edit/cancel edit;
  - complete/uncomplete;
  - delete;
  - reorder and small drag no-op;
  - undo/redo for add/edit/toggle/delete/reorder/color;
  - reload persistence.
- Expand todo local simulator coverage:
  - add on Replica A syncs to Replica B;
  - pause sync, edit both sides, assert queue counts;
  - resume sync and assert convergence;
  - remote reorder animation remains covered.
- Add `helpers/whiteboard.ts` with deterministic pointer helpers.
- Add whiteboard solo coverage:
  - add/edit/move/resize note;
  - add/move emoji;
  - draw/select stroke;
  - archive/recover;
  - layer controls;
  - undo/redo;
  - zoom/minimap smoke;
  - reload persistence.
- Add whiteboard local simulator coverage:
  - cross-replica note sync;
  - pause, divergent edits, queue counts, resume, convergence;
  - remote selection/presence if deterministic enough.

Validation:

- `pnpm test:e2e:smoke` passes.
- Whiteboard helpers avoid fixed absolute coordinates where possible; they compute positions from viewport/canvas boxes.

## Phase 4: Document Manager And Archive Coverage

Objective: test the shared document lifecycle across modes.

Tasks:

- Add `helpers/documents.ts`:
  - open/close modal;
  - create document;
  - create seed;
  - open document row;
  - delete local document with dialog handling;
  - export current document;
  - import archive.
- Add `documents/document-manager.spec.ts`:
  - create/open/delete local docs for solo and local simulator;
  - seed fixture creation for todos and whiteboard;
  - document state isolation across docs.
- Add `documents/archive-import-export.spec.ts`:
  - create content in one browser context;
  - export archive using Playwright download handling;
  - open a fresh browser context;
  - import archive with `setInputFiles`;
  - verify imported content and active doc.
- Add negative import coverage:
  - wrong app;
  - wrong payload kind;
  - invalid archive JSON.

Validation:

- Export/import tests verify the user-visible result in a fresh context.
- Archive JSON may be parsed for sanity, but avoid brittle snapshots unless the format is intended to be locked.

## Phase 5: Server Sync, Offline, History, And Branches

Objective: cover normal server behavior beyond schema migration.

Tasks:

- Keep per-test Bun server and temp SQLite DB isolation.
- Add `server/server-sync.spec.ts`:
  - login as seeded known user;
  - login as a new nickname;
  - two clients edit one document and converge;
  - online roster updates as clients join/leave;
  - logout returns to login without deleting local replica.
- Add `server/server-offline.spec.ts`:
  - manual disconnect;
  - local edit increments unsynced count;
  - reconnect flushes pending event;
  - fresh context sees flushed content.
- Add or expand `server/server-history-preview.spec.ts`:
  - select timeline event;
  - app controls become read-only;
  - exit preview restores editability;
  - create branch from selected historical event.
- Add `server/server-branches.spec.ts` for todos first:
  - create branch;
  - rename branch;
  - make divergent edits;
  - merge source selection shows preview facts and paths;
  - revert/apply selected paths;
  - accept merge;
  - merge event appears and syncs.
- Add whiteboard branch/merge coverage:
  - create divergent whiteboard edits on branches;
  - verify merge preview includes nested element paths;
  - accept merge and verify visible board result.
- Keep existing migration scenarios in `server/server-migration.spec.ts`.
- Add migration demo coverage later in Phase 8, using the same seeded server helpers unless a simpler fixture becomes obviously better.

Validation:

- Server specs pass repeatedly with isolated DBs.
- Branch tests assert both UI state and final materialized document state.

## Phase 6: Local PeerServer Infrastructure

Objective: make PeerJS and local-first E2E deterministic with real PeerJS connections.

Tasks:

- Add a test helper to start a local PeerServer process on a test port.
- Configure the React example to point PeerJS clients at the local PeerServer during E2E.
  - Prefer environment variables consumed by PeerJS/local-first setup.
  - If no configuration exists, add a small app-level config seam for host/port/path.
- Add `helpers/peer.ts`:
  - start/stop PeerServer;
  - wait for peer id readiness;
  - extract invite/peer id from host UI;
  - connect client contexts;
  - wait for open connection rows.
- Ensure PeerServer lifecycle is isolated and cleaned up.

Validation:

- A minimal host/client connection smoke test passes without external network.
- Tests fail clearly if the local PeerServer cannot start.

## Phase 7: PeerJS And Local-First Coverage

Objective: cover real peer-backed collaboration after infrastructure is deterministic.

Tasks:

- Add `peerjs/peerjs-ui.spec.ts`:
  - host initializes and exposes invite link;
  - client opens with `peer` param and shows waiting-for-snapshot;
  - client cannot access host-only document manager actions.
- Add `peerjs/peerjs-sync.spec.ts`:
  - client connects to host and receives snapshot;
  - host edit syncs to client;
  - client edit syncs to host;
  - disconnect/reconnect and queued flush behavior.
- Add `local-first/local-first-ui.spec.ts`:
  - document persists after reload;
  - host/client role controls;
  - invite link state;
  - reset local replica with confirm;
  - second tab for same doc shows tab-lock blocked state.
- Add `local-first/local-first-sync.spec.ts`:
  - two contexts connect through local PeerServer;
  - exchange updates;
  - request sync updates stats;
  - compact retained log with no risk;
  - compaction risk display when a peer is unknown/behind, if deterministic.
- Add `local-first/local-first-migration.spec.ts`:
  - local-first migration panel appears for old seeded fixture;
  - create migrated target document;
  - verify target document content and lineage stats.
- Add snapshot accept/preview/replay coverage if a deterministic setup can produce pending snapshots without excessive fixture complexity.

Validation:

- Peer-backed tests pass without public network access.
- If a subset proves slow/flaky, keep the specs but split scripts later into critical and extended E2E groups.

## Phase 8: Demo Specs

Objective: provide committed specs that can be video-recorded while still asserting behavior.

Tasks:

- Add demo project/config:
  - Chromium only;
  - fixed desktop viewport, for example `1440x1000`;
  - video enabled;
  - traces optional/off by default for demo project;
  - no slowMo initially.
- Add `helpers/demo.ts` only for optional pacing/annotation helpers, gated by `UMKEHR_E2E_DEMO` if ever needed.
- Add `demo/todo-local-conflict.demo.spec.ts`:
  - local/todos;
  - pause sync;
  - divergent edits on both replicas;
  - show queue counts;
  - resume;
  - assert convergence.
- Add `demo/whiteboard-collaboration.demo.spec.ts`:
  - local/whiteboard;
  - note, emoji, stroke, archive/recover;
  - pause/resume sync;
  - assert convergence.
- Add `demo/server-branch-merge.demo.spec.ts`:
  - seeded server;
  - branch and divergent edits;
  - merge preview;
  - selective apply/revert;
  - accept merge and assert result.
- Add `demo/server-migration.demo.spec.ts`:
  - seeded v1 server document;
  - migration-required notice;
  - migrate;
  - synced migrated content.

Validation:

- `pnpm test:e2e:demo` produces videos.
- Demo specs run as normal Playwright tests and do not require manual setup beyond dependencies.
- Videos are fast but visually coherent enough for recording review.

## Phase 9: Runtime Review And CI Subset

Objective: decide whether all coverage should run in CI or whether to split critical/extended groups.

Tasks:

- Measure runtime for:
  - smoke suite;
  - server suite;
  - peer-backed suite;
  - demo suite.
- If full runtime is acceptable, keep all in the default E2E path.
- If full runtime is too high, define:
  - critical CI subset: app routing, todo solo/local, whiteboard solo/local, server sync/offline/history smoke, server migration core;
  - extended suite: branch/merge exhaustive, PeerJS, local-first, demo specs.
- Document recommended commands in `examples/react-crdt/README.md` or a test README if useful.

Validation:

- A developer can run the critical suite and full suite with clear package scripts.

## Phase 10: Responsive And Keyboard Smoke

Objective: add modest breadth after behavior coverage is stable.

Tasks:

- Add a narrow viewport Chromium project or targeted tests with explicit viewport override.
- Cover:
  - top-bar selectors;
  - document modal layout;
  - todo panel controls;
  - whiteboard toolbar usability;
  - server branch controls.
- Add keyboard smoke for:
  - top-bar selectors;
  - document modal open/close/focus;
  - todo add/edit;
  - server branch form controls.

Validation:

- Responsive smoke remains small and does not duplicate core behavior specs.

## Completion Criteria

- Existing E2E behavior is preserved and reorganized into focused specs.
- Core todo behavior is covered in solo, local, and server modes.
- Core whiteboard behavior is covered in solo and local modes.
- Shared document manager create/open/delete/seed/export/import is covered.
- Server sync, offline/reconnect, history preview, branch/merge, and migration flows are covered.
- PeerJS and local-first tests use real PeerJS connections through a local PeerServer.
- Demo specs are committed, fast, video-capable, and runnable through a dedicated script.
- Tests are isolated by unique documents, browser contexts, and per-test server databases.
- Chromium-only Playwright coverage passes reliably.
