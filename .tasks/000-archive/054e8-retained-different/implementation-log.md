# Implementation Log: Boundary-Based Retained Inline Formatting

## 2026-06-16

- Started Phase 1 by inspecting mark traversal, op validation, retained selection sets, and multi-selection command flow.
- Noted that optional/empty mark ends affect both `coveredCharIdsForMark(...)` and `src/block-crdt/ops.ts` validation/max-counter helpers.
- Implemented optional mark ends and `markBoundaryOp(...)`.
- Added Phase 1 formatting tests for explicit `before` ends, omitted ends, and remove-plus-bounded-add closing.
- Issue encountered: omitted-end marks initially followed existing split traversal into the split-right block. Since the requirement says an empty end means "to the end of the block", omitted-end traversal now stays inside the current block and does not follow split jumps.
- Verified: `npm exec vitest -- run src/block-crdt/formatting.test.ts`.
- Implemented Phase 2 single-caret retained formatting commands:
  - `insertTextWithRetainedMarks(...)` opens one boundary mark on first typed text and updates the final typed char on later insertions.
  - `closeRetainedInlineMarkSessions(...)` emits remove-plus-bounded-add close ops.
- Added command tests for middle-of-text retained marks and empty-block/end-of-block omitted-end behavior.
- Verified: `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`.
- Implemented Phase 3 multi-caret retained formatting wrappers with sessions keyed by selection id.
- Added a multi-caret test that opens two retained marks, continues typing without extra mark ops, then closes both sessions.
- Verified: `npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts`.
- Implemented Phase 4 UI wiring:
  - `App.tsx` now keeps active pending mark flags plus retained CRDT mark sessions.
  - Collapsed mark toggles activate retained typing style; toggling off closes open sessions with remove-plus-bounded-add ops.
  - Text insertion uses retained formatting for collapsed carets and keeps selection movement from clearing pending retained formatting.
- Updated the old caret-movement test to match the new requirement that movement does not clear retained formatting.
- Issue encountered: after closing bold at the end of a bold run, the toolbar can still report bold because existing caret mark detection looks at the previous character. The close path still works; subsequent typed text is plain because insertion uses pending retained state, not toolbar-derived active state.
- Fixed optional-end assumptions in remote dependency checks and undo mark remapping after grep found remaining `mark.end.id` uses.
- Verified: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`.
- Follow-up fix: changed toolbar active-state logic to indicate whether the next typed character will inherit each mark. For collapsed carets, pending retained marks still count as active; otherwise the display checks the next character's marks, not the previous character's marks. This keeps the toolbar active inside an interval where inserted text will be marked, but inactive after a closed mark at block end where inserted text will be plain.
- Verified toolbar fix with `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` and `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`.
- Verification:
  - `npm exec vitest -- run src/block-crdt/formatting.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx src/block-crdt/index.test.ts src/block-crdt/adapter-additions.test.ts`
  - `npm run typecheck`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
- Workaround: `npm run build && tsc -p examples/block-rich-text/tsconfig.json --noEmit` built the package but then failed because the second shell segment could not find `tsc` on PATH. Re-ran the example typecheck through `npm exec`, which passed.
