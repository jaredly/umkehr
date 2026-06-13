# Implementation Log: Plim Side-by-Side CRDT Example

## 2026-06-13

- Started implementation from `plan.md`.
- Confirmed `App.tsx` is still single-pane and uses scripted `Remote Insert` / `Remote Split` controls.
- Confirmed `App.test.tsx` still asserts the old remote-button behavior and will need pane-scoped updates.
- Phase 1: added `examples/plim-block-crdt/src/plimDemoRuntime.ts` with left/right replicas, per-replica timestamps, online state, queued op batches, and queue flushing.
- Phase 2/3: rewrote `App.tsx` around two reusable Plim panes with independent drivers/handles and parent-managed local transaction replication.
- Phase 4: replaced the single-editor/sidebar CSS with a two-column editor grid and collapsed per-side debug panels below.
- Phase 5: replaced app tests with pane-scoped coverage for initial render, bidirectional text sync, offline queue flushing, slash menu behavior, mark sync, selection retention, and split behavior.
- Phase 6: ran `npm test` in `examples/plim-block-crdt`; passed with 2 test files and 20 tests.
- Phase 6: ran `npm run build` in `examples/plim-block-crdt`; TypeScript and Vite production build passed.
- Issue noted: both npm commands printed `Error connecting to agent: Operation not permitted` before running. It did not fail either command, so no workaround was needed.
