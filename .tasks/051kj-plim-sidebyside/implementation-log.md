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
- Bug encountered after manual use: when both panes were online, typing in the left pane moved the browser selection/focus to the right pane after replication.
- Fix: Plim view updates reapply model selection globally, so inactive pane `setState` calls now snapshot and restore the current focused element and DOM selection. Added a regression test for left-to-right online sync preserving focus in the left pane.
- Re-ran `npm test -- src/App.test.tsx`; passed with 10 tests.
- Re-ran full `npm test`; passed with 2 test files and 21 tests.
- Re-ran `npm run build`; TypeScript and Vite production build passed.
- Added Plim's built-in `bold`, `italic`, `code`, and `link` mark descriptors to each pane's driver so the built-in floating formatting toolbar has items to render.
- Added a regression test that selects text, verifies the floating toolbar buttons appear, and applies `code` through the toolbar with CRDT sync to the peer pane.
- Test note: jsdom needed the editor root focused before setting the DOM selection; otherwise Plim's toolbar visibility check treated focus as outside the editor and kept the toolbar hidden.
- Re-ran `npm test -- src/App.test.tsx`; passed with 11 tests.
- Re-ran full `npm test`; passed with 2 test files and 22 tests.
- Re-ran `npm run build`; TypeScript and Vite production build passed.
- Added CRDT-aware undo/redo stacks per replica. Local edits record their pre-edit CRDT state and op batch; undo/redo uses `planUndoOps(...)` to emit normal CRDT ops so the result syncs or queues like any other local edit.
- Added per-pane Undo/Redo buttons and keyboard shortcuts: Ctrl/Mod+Z for undo, Ctrl/Mod+Shift+Z and Ctrl+Y for redo.
- Added tests for button undo/redo syncing to the peer, keyboard undo in the active pane, and queued undo while the peer is offline.
- Test note: Plim's shortcut matcher treats `Mod` as Ctrl in jsdom because the environment is not Mac-like, so the keyboard undo regression fires Ctrl+Z.
- Re-ran `npm test -- src/App.test.tsx`; passed with 14 tests.
- Re-ran full `npm test`; passed with 2 test files and 25 tests.
- Re-ran `npm run build`; TypeScript and Vite production build passed.
- Bug encountered: undoing a split restored the document but left the retained selection pointing at the split-created block, which could no longer resolve after undo and fell back to document start.
- Fix: undo history entries now store both before-edit and after-edit retained selections. Undo rematerializes the source adapter with the before selection; redo rematerializes with the after selection.
- Added a regression test for split undo restoring the caret to offset 5 in the original block instead of resetting to offset 0.
- Re-ran `npm test -- src/App.test.tsx`; passed with 15 tests.
- Re-ran full `npm test`; passed with 2 test files and 26 tests.
- Re-ran `npm run build`; TypeScript and Vite production build passed.
