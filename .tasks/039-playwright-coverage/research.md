# Playwright E2E Coverage Research

## Request

Develop a comprehensive Playwright end-to-end testing plan for `examples/react-crdt`. The app already has some E2E tests, but they are ad-hoc. The plan should cover reliability-oriented tests and include Playwright specs suitable for demo video recording.

## Current State

`examples/react-crdt` is a Vite app with one Playwright config and two spec files:

- `examples/react-crdt/playwright.config.ts`
- `examples/react-crdt/tests/todo-smoke.spec.ts`
- `examples/react-crdt/tests/server-migration.spec.ts`
- `examples/react-crdt/tests/helpers/app.ts`
- `examples/react-crdt/tests/helpers/server.ts`

The Playwright config currently:

- Runs `./tests` with one Chromium desktop project.
- Uses `fullyParallel: false`, `workers: 1`, and CI retries.
- Starts the Vite app through `webServer`.
- Points the client at `VITE_UMKEHR_SERVER_HTTP_URL=http://localhost:${serverPort}`.
- Does not start the example server globally; server specs start their own Bun server with isolated SQLite databases.
- Retains traces on failure and screenshots only on failure.
- Does not enable video recording by default.

Existing E2E coverage is useful but uneven:

- Todo solo CRUD/reorder/undo-redo smoke flow.
- Todo local two-replica reorder sync and remote animation smoke flow.
- Server read-only history preview smoke flow.
- Server-backed seeded sync between two browser contexts.
- Server migration flows across schema versions, locks, lock expiry, old clients, client-upgrade-required state, and owner-disconnect recovery.

The strongest current coverage is server schema migration. The weakest E2E coverage is app-wide navigation, document management/archive flows, whiteboard interactions, PeerJS/local-first behavior, and server branch/merge/presence workflows.

## App Surface To Cover

The app has two registered user apps:

- `todos`, schema v2, plus route variants `todos@1` and `todos@3` for migration fixtures.
- `whiteboard`, schema v1.

The available architecture modes are:

- `solo`
- `local`
- `peerjs`
- `local-first`
- `server`

Important route/query behavior:

- Default mode is `local`.
- `mode`, `app`, and `doc` live in query params.
- `peer` is used by PeerJS and local-first invite flows.
- Server migration tests also use `serverMigrationDelayMs`.

Shared UI surfaces:

- Top bar app selector and architecture selector.
- Document manager modal for most modes.
- Seed fixture creation.
- Local document creation/deletion.
- JSON archive export/import.

Todo-specific UI:

- Add/edit/delete/toggle todos.
- Reorder via drag handle.
- Undo/redo.
- Background color picker.
- Recent editor/presence indicators.
- Read-only disabling when previews are active.

Whiteboard-specific UI:

- Tools: select, note, pen, emoji, erase, pan.
- Note color swatches and emoji selector.
- Add/move/resize notes.
- Draw strokes.
- Add emoji stamps.
- Layer ordering.
- Archive/recover.
- Zoom/minimap/pan.
- Undo/redo.
- Ephemeral selection/preview overlays.
- Read-only disabling when previews are active.

Server-specific UI:

- Login and known-user buttons.
- Manual disconnect/reconnect.
- Unsynced local event indicator.
- Online users roster.
- Server notices for migration, schema mismatch, upgrade required, errors, and duplicate session.
- Branch list, branch creation, rename, timeline event preview, fork point, merge source selection, merge preview, selective path revert/apply, and merge commit.

Local-first-specific UI:

- Persistent replica identity.
- Host/client role controls.
- Invite link and peer connection form.
- Sync request.
- Retained batch stats.
- Compaction flow and risk display.
- Snapshot accept/preview/replay flow.
- Reset local replica.
- Migration panel for local-first new-document migrations.
- Tab-lock blocked state.

PeerJS-specific UI:

- Host/client role controls.
- Invite link.
- Client connect form.
- Waiting for host snapshot state.
- Connection rows.
- Flush queued updates.
- Disconnect/reconnect.

## Coverage Gaps

1. App navigation and routing are not covered end-to-end.
   Need tests that switch app and architecture selectors and verify query params, panel changes, and state isolation.

2. Document manager is mostly untested in Playwright.
   Need tests for create/open/delete local documents, seed fixture creation, and archive export/import. These flows are shared and high value because every architecture mode depends on them.

3. Whiteboard has no Playwright coverage.
   Unit tests cover geometry/helpers/ephemeral data, but no browser test verifies pointer interactions, rendered elements, undo/redo, archive/recover, or cross-replica sync.

4. Local simulator coverage is todo-only and happy-path.
   Need paused-sync divergence, queued counts, resume convergence, concurrent edits, and presence/ephemeral selection behavior.

5. Server branch/history features are lightly covered.
   Existing read-only preview test clicks the timeline, but branch creation, rename, fork-at-event, merge preview, selective path revert, merge commit, and multi-client branch sync are not covered.

6. Server offline/resume and presence need more E2E coverage.
   Existing migration specs exercise pending uploads indirectly, but normal offline edit, reconnect flush, known-user login, logout, duplicate session, and roster behavior are not comprehensively covered.

7. PeerJS and local-first are not covered in Playwright.
   They may be harder to make deterministic because they depend on PeerJS networking. Coverage should start with UI states and, if practical, a deterministic same-browser/multi-context connection flow.

8. Demo-recording specs are not separated from reliability specs.
   Existing tests perform good assertions but are not paced, named, or structured for repeatable video capture.

9. Selectors are mostly accessible roles/classes rather than dedicated test IDs.
   Role-based selectors are good for user-facing controls, but pointer-heavy whiteboard flows and repeated panels would be more maintainable with a small set of stable `data-testid`s or better accessible names.

## Recommended Spec Layout

Split tests by intent and runtime cost:

```text
examples/react-crdt/tests/
  helpers/
    app.ts
    documents.ts
    server.ts
    todos.ts
    whiteboard.ts
    demo.ts
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
  local-first/
    local-first-ui.spec.ts
    local-first-sync.spec.ts
    local-first-migration.spec.ts
  peerjs/
    peerjs-ui.spec.ts
    peerjs-sync.spec.ts
  demo/
    todo-local-conflict.demo.spec.ts
    server-branch-merge.demo.spec.ts
    whiteboard-collaboration.demo.spec.ts
```

`server-migration.spec.ts` can remain mostly intact but should move under `tests/server/` once helpers are shared. The existing `todo-smoke.spec.ts` should be split into focused specs.

## Test Categories And Scenarios

### 1. App Routing And Shell

Priority: high.

Scenarios:

- Default route opens local/todos and shows both local replicas.
- Architecture selector switches between Solo, Local, Server, PeerJS, and Local-first, updating the URL.
- App selector switches between Todos and Whiteboard, updating the URL and replacing panels.
- Query params deep-link directly into each mode/app/doc.
- Browser back/forward restores previous mode/app selection.
- State is scoped by `doc` and app id; opening a new doc does not leak todos or whiteboard elements from another doc.

Implementation notes:

- Add an `openApp(page, {mode, appId, docId})` helper.
- Use unique doc ids in every test to avoid IndexedDB leakage.
- Consider a `clearBrowserStorage(page)` helper for test isolation.

### 2. Todo Solo

Priority: high.

Scenarios:

- Add, trim, reject empty add, edit, cancel edit, complete/uncomplete, delete.
- Reorder before/after and verify final order.
- Small drag does not reorder.
- Undo/redo covers add/edit/toggle/delete/reorder/color.
- Color picker changes visible item background and persists through reload.
- Reload preserves the current solo document.
- Read-only mode disables todo controls when server history preview is active.

Existing coverage:

- Most of the CRUD/reorder/undo-redo smoke flow exists in `todo-smoke.spec.ts`.

Recommended changes:

- Extract todo panel helpers into `tests/helpers/todos.ts`.
- Split broad smoke test into smaller tests so failures identify the broken behavior.

### 3. Todo Local Simulator

Priority: high.

Scenarios:

- Add on replica A syncs to replica B.
- Pause sync, edit both replicas independently, verify queue counts.
- Resume sync, verify convergence.
- Reorder on one replica syncs to the other and remote reorder animation runs.
- Undo local changes while offline, then resume.
- Concurrent edits to the same todo produce deterministic merged state.
- Presence/recent editor affordances appear after remote edits.

Existing coverage:

- One reorder sync and animation smoke test exists.

### 4. Whiteboard Solo

Priority: high.

Scenarios:

- Add note with selected color, edit note text, move note, resize note.
- Add emoji stamp with selected emoji and move it.
- Draw pen stroke and select it.
- Archive selected element and recover it from archive tray.
- Layer controls change z-order for overlapping elements.
- Undo/redo covers note, stroke, emoji, move, resize, archive, recover.
- Zoom in/out and minimap recenter keep content visible.
- Reload preserves document state.

Implementation notes:

- Whiteboard pointer tests should use deterministic board coordinates based on `.whiteboardViewport` or `.whiteboardCanvas` bounding boxes.
- Add test IDs for the canvas, note elements, emoji elements, strokes, and archive tray if role/class selectors prove brittle.

### 5. Whiteboard Local Simulator

Priority: high.

Scenarios:

- Add note on replica A and verify replica B receives it.
- Pause sync, add/move/archive on A and add/draw on B, verify queue counts.
- Resume sync, verify both panels converge.
- Selection presence/remote selection badge appears when another replica selects an element.
- Local preview overlay appears during drag before remote commit, then resolves.

### 6. Document Manager And Archive

Priority: high.

Scenarios:

- Open document modal and create a new document.
- Switch between documents and verify state isolation.
- Create seed fixtures for todos and whiteboard.
- Delete local copy and verify fallback document behavior.
- Export current document and validate downloaded JSON shape.
- Import a valid archive and verify it opens with expected content.
- Import archive for wrong app/payload kind/schema and verify error message.

Modes to cover:

- Solo.
- Local simulator.
- Server local replica.
- Local-first.
- PeerJS host.

Implementation notes:

- Use Playwright download handling for export.
- Use `setInputFiles` with generated temp JSON fixtures for import.
- Keep one shared document-manager spec per mode if helpers can abstract payload differences.

### 7. Server Sync

Priority: high.

Scenarios:

- Login with known seeded users and with a new nickname.
- Two clients edit the same server document and converge.
- Manual disconnect, local edit, unsynced count increments, reconnect flushes.
- Logout returns to login panel without deleting local replica.
- Roster shows another online user and returns to "No one else online" when they disconnect.
- Duplicate session shows recover/new-session UI if deterministic setup is possible.
- Server unavailable shows an actionable unavailable/error state.

Existing coverage:

- Two-client seeded server sync exists.
- Migration specs cover several pending-upload states.

### 8. Server Branches And History

Priority: high.

Scenarios:

- Create branch from current state.
- Rename active branch.
- Select timeline event to preview and verify app controls become read-only.
- Create branch from a selected historical event.
- Make divergent edits on two branches.
- Select merge source, verify merge preview facts and changed paths.
- Revert one changed path, accept merge, verify only selected paths applied.
- Verify merge event appears on timeline and syncs to a second client.
- Attempt already-merged source and verify disabled/no-effect merge state.

Implementation notes:

- Use todos first because changed paths are easy to assert.
- Add a whiteboard branch/merge test later to cover nested element paths and archive/recover paths.

### 9. Server Migration

Priority: high, mostly implemented.

Scenarios to keep:

- Browser-driven v1 to v2 migration.
- V1 client blocked after v2 migration.
- Pending edits while another client owns migration lock.
- Expired migration lock resolves and pending edits flush.
- Client-upgrade-required for server document ahead of client.
- V1 to v3 migration.
- Owner disconnect before upload and recovery.

Additional scenarios:

- Migration failure/error UI if the server returns failure deterministically.
- Whiteboard/server schema not configured should either be hidden from migration flows or tested as "normal server sync only".
- Manual-review policy for old pending changes if the current server code exposes deterministic UI for it.

### 10. PeerJS

Priority: medium until deterministic PeerJS test setup is proven.

Scenarios:

- Host mode initializes and exposes invite link.
- Client mode opens via `peer` param and shows waiting-for-snapshot.
- Client connects to host, receives snapshot, and edits sync both ways.
- Host disconnect/reconnect and queued updates flush.
- Client cannot access host-only document manager actions.

Open implementation risk:

- PeerJS may require an external PeerServer or network access. If the current environment uses the public PeerJS cloud, E2E should not rely on it in CI. Prefer a local PeerServer fixture or mockable transport if available.

### 11. Local-First

Priority: medium to high, depending on product priority.

Scenarios:

- New local-first document persists after reload.
- Host/client role controls and invite link state.
- Two contexts connect and exchange updates.
- Request sync updates vectors and received/pending counts.
- Retained log compaction with no risk.
- Compaction risk display when peer vector is unknown/behind.
- Pending snapshot accept, preview, replay.
- Reset local replica after confirm.
- Local-first migration panel creates a migrated target document.
- Second tab for same doc shows tab-lock blocked state.

Open implementation risk:

- Like PeerJS, sync may need a local deterministic PeerJS setup.

### 12. Accessibility And Responsive Smoke

Priority: medium.

Scenarios:

- Keyboard can operate top-bar selectors, document modal, todo CRUD, and server branch controls.
- Modal close/focus behavior works.
- Core views render without overlap at desktop and a narrow viewport.
- Whiteboard toolbar remains usable at smaller widths.

The current Playwright config only runs Desktop Chrome. Add a smaller viewport project or targeted responsive smoke tests after the main behavior coverage is stable.

## Demo Recording Specs

Demo specs should be separate from reliability specs. They should still assert key states, but they should be designed for readable video:

- Use deterministic seeded documents.
- Run with one browser/project.
- Enable video in a dedicated Playwright project or via CLI.
- Add small intentional pauses only in demo helper functions, not in reliability tests.
- Use clear titles and avoid parallel contexts unless the recording needs split-screen collaboration.
- Prefer app state that is reset by unique doc ids or seeded test databases.

Recommended demo specs:

### `demo/todo-local-conflict.demo.spec.ts`

Story:

1. Open Todos in Local mode.
2. Pause sync.
3. Add/edit/reorder items on Replica A.
4. Add/edit/toggle a different item on Replica B.
5. Show queued counts.
6. Resume sync.
7. Verify both replicas converge.
8. Undo/redo one local operation.

Why it records well:

- The side-by-side replica model is visually obvious.
- Queue counts and convergence communicate the CRDT behavior.

### `demo/whiteboard-collaboration.demo.spec.ts`

Story:

1. Open Whiteboard in Local mode.
2. Add a note and emoji on Replica A.
3. Pause sync.
4. Draw a stroke on Replica B.
5. Move/archive/recover an element.
6. Resume sync.
7. Show both boards converged.

Why it records well:

- It shows the non-todo app and pointer-driven interactions.

### `demo/server-branch-merge.demo.spec.ts`

Story:

1. Start seeded server database.
2. Login as Ada.
3. Add a todo on `main`.
4. Create a branch, make divergent changes.
5. Switch back to `main`, make another change.
6. Open merge preview, selectively apply/revert paths.
7. Accept merge and show timeline event.

Why it records well:

- It demonstrates the server branch/history UI and merge preview.

### `demo/server-migration.demo.spec.ts`

Story:

1. Open seeded v1 document with current todos client.
2. Show migration-required notice.
3. Click migrate.
4. Show synced v2 document and migrated content.

Why it records well:

- It is shorter and good for showing schema migration UX.

## Playwright Config Recommendations

Keep reliability defaults conservative:

- `workers: 1` is appropriate while tests share IndexedDB/ports/server processes.
- Keep server-backed specs isolated with per-test SQLite paths.
- Keep traces/screenshots on failure.

Add optional projects/scripts:

```json
{
  "scripts": {
    "test:e2e": "playwright test -c playwright.config.ts",
    "test:e2e:smoke": "playwright test -c playwright.config.ts tests/smoke tests/server/server-sync.spec.ts",
    "test:e2e:server": "playwright test -c playwright.config.ts tests/server",
    "test:e2e:demo": "UMKEHR_E2E_DEMO=1 playwright test -c playwright.config.ts tests/demo --project=demo-chromium"
  }
}
```

Suggested config additions:

- A `demo-chromium` project with fixed viewport, video enabled, and perhaps `trace: 'off'` unless debugging.
- A `mobile-smoke` or `narrow-chromium` project after layout stabilizes.
- `testIgnore` or grep conventions if demo specs should never run in normal CI.
- Per-test output paths for server DBs, downloads, generated archives, and videos.

Example project shape:

```ts
projects: [
  {name: 'chromium', use: {...devices['Desktop Chrome']}},
  {
    name: 'demo-chromium',
    testMatch: /.*\.demo\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      viewport: {width: 1440, height: 1000},
      video: 'on',
      trace: 'off',
      launchOptions: {slowMo: 100},
    },
  },
]
```

Only use `slowMo` or explicit pauses for demo specs. Reliability specs should stay fast and assertion-driven.

## Helper Recommendations

Create focused helper modules:

- `helpers/app.ts`: routing, storage reset, top-bar switching, common waits.
- `helpers/todos.ts`: todo panel locators, add/edit/toggle/delete/reorder/order assertions.
- `helpers/whiteboard.ts`: viewport coordinate helpers, add note, edit note, draw stroke, add emoji, select/move/resize/archive/recover/assert element counts.
- `helpers/documents.ts`: open document modal, create doc, create seed, switch, delete local, export/import.
- `helpers/server.ts`: keep existing DB/server process helpers; add server fixture wrappers if repeated setup grows.
- `helpers/demo.ts`: small paced actions, annotations if desired, and `pauseForDemo()` gated by `UMKEHR_E2E_DEMO`.

Recommended helper patterns:

- Use unique doc ids derived from `testInfo`.
- Use browser contexts to model separate users/replicas for server, PeerJS, and local-first.
- Use `expect.poll` for eventual CRDT/server convergence.
- Keep deterministic pointer geometry helpers centralized.
- Prefer user-facing accessible locators; add test IDs only where canvas/pointer rendering makes roles insufficient.

## Selector/Testability Recommendations

Add minimal testability affordances if needed:

- `data-testid="document-manager"`
- `data-testid="document-row-${docId}"` or a stable row locator helper.
- `data-testid="whiteboard-viewport"`
- `data-testid="whiteboard-canvas"`
- `data-testid="whiteboard-note-${id}"` if ids are exposed or deterministic enough.
- `data-testid="whiteboard-emoji-${id}"`
- `data-testid="whiteboard-stroke-${id}"`
- `data-testid="server-timeline"`
- `data-testid="server-branch-list"`

Before adding test IDs, first try accessible names:

- Top-bar selectors already have `aria-label`.
- Document modal has dialog role/name.
- Server controls have useful labels.
- Todo controls mostly have buttons/placeholders/labels.

Whiteboard is the strongest candidate for test IDs because pointer-created elements have limited accessible structure and repeated panels can make class-only selectors fragile.

## Suggested Implementation Phases

### Phase 1: Stabilize Existing Tests

- Move current helper functions out of `todo-smoke.spec.ts`.
- Split todo smoke tests into focused todo solo/local/server preview specs.
- Move server migration spec under `tests/server/` without changing behavior.
- Add unique doc id and storage cleanup helpers consistently.
- Add a smoke script.

### Phase 2: Add High-Value Missing Coverage

- App routing/top-bar spec.
- Document manager create/switch/delete/seed spec.
- Todo local paused-sync/convergence spec.
- Server offline/reconnect/known-user/logout spec.
- Server branch/history preview/merge spec.

### Phase 3: Add Whiteboard E2E

- Add whiteboard coordinate helpers.
- Add whiteboard solo interactions.
- Add whiteboard local sync/presence interactions.
- Add any needed test IDs.

### Phase 4: Add Demo Specs

- Add dedicated demo project/config/script.
- Add todo local conflict demo.
- Add whiteboard collaboration demo.
- Add server branch merge demo.
- Add server migration demo.

### Phase 5: PeerJS And Local-First

- Decide deterministic networking strategy.
- Add PeerJS UI tests first.
- Add PeerJS sync if local PeerServer/mocking is available.
- Add local-first persistence/migration/tab-lock tests.
- Add local-first sync/compaction/snapshot tests once networking is reliable.

### Phase 6: Responsive And Accessibility Smoke

- Add narrow viewport project or targeted tests.
- Add keyboard/focus coverage for modal and core controls.

## Acceptance Criteria For The E2E Plan

- Core todo behavior covered in solo, local, and server modes.
- Core whiteboard behavior covered in solo and local modes.
- Shared document manager covered for create/open/delete/seed/export/import.
- Server normal sync, offline/reconnect, history preview, branch/merge, and migration flows covered.
- Demo specs are separated from normal CI and can produce stable videos.
- Tests use isolated documents/databases and do not rely on persistent browser state.
- PeerJS/local-first networking is either covered deterministically or explicitly documented as requiring follow-up infrastructure.

## Open Questions

1. Should demo specs be committed as normal Playwright specs under `tests/demo`, or should they live outside the CI test tree and be run only manually?

2. Should demo videos use real-time pacing (`slowMo`/pauses) or should they be fast specs recorded and edited afterward?

3. Is PeerJS expected to work in CI without external network access, or should we add a local PeerServer/test transport before writing sync E2E?

4. Should local-first sync be tested through real PeerJS connections, or is a deterministic mock transport acceptable for E2E-level coverage?

5. Are `data-testid` attributes acceptable in this example app, especially for whiteboard pointer-created elements and server history controls?

6. Which flows are mandatory for CI versus acceptable as slower/nightly/manual suites?

7. Should Playwright run only Chromium, or should the final coverage include WebKit/Firefox and narrow viewport projects?

8. For archive import/export tests, should the plan validate only the UI result, or also parse and snapshot the downloaded archive shape?

9. Should server migration demo specs use the seeded Bun server helpers directly, or should there be a pre-generated static fixture path for easier local recording?

10. Should server branch/merge E2E focus on todos first, or should whiteboard branching be included because it better exercises nested CRDT paths?

11. What is the desired CI budget for `examples/react-crdt` E2E tests?

12. Should existing unit/component tests be reorganized alongside E2E, or should this task stay strictly Playwright-focused?
