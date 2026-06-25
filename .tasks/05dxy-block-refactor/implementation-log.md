# Implementation Log

## Phase 0: Baseline And Safety

- Inspected current task plan and local status.
- Existing relevant user change: `examples/block-rich-text/src/App.test.tsx` has a new performance test for selecting a block in the many-blocks fixture. This must be preserved.
- Existing task docs: `research.md` includes inline answers; `plan.md` was newly added before implementation.
- Initial `pnpm build` reported `src/useBlockReorder.ts` `NO_DROP_TARGET`/`DropTarget | null` TypeScript errors during baseline checking. After rechecking the file and rerunning, no lasting `useBlockReorder.ts` diff remained and `pnpm build` passed. The final patch set does not modify `useBlockReorder.ts`.
- Baseline targeted tests failed before the App split:
  - `src/App.test.tsx`: the new many-blocks fixture performance test selected the block correctly but measured about 206ms, above the 50ms threshold.
  - `src/undoHistory.test.ts`: code block double-enter undo expectation mismatch (`['ab\n\n']` received instead of `['ab', '']`). This test ran even though only `App.test.tsx` and `typingPerf.test.ts` were requested, likely due Vitest project/dependency behavior.

## Phase 2: App Shell Extraction

- Moved the large implementation from `src/App.tsx` to `src/EditorApp.tsx`.
- Recreated `src/App.tsx` as a tiny entrypoint that switches between `BlogVisualDemos` and `EditorApp`.
- Updated `typingPerf.test.ts` to import `deriveActiveInlineMarks` from `EditorApp` temporarily. This should move again when inline run rendering is extracted.
- Extracted `KeyPerfMonitor` plus key performance sample types/constants into `src/KeyPerfMonitor.tsx`.
- Verification: `pnpm build` passes after both the app shell move and the `KeyPerfMonitor` extraction. Build output still includes the existing pnpm registry metadata fetch warning due restricted network, but the command exits successfully.

## Phase 1/3: Shared Types And Toolbar

- Added `src/blockEditorTypes.ts` for shared editor UI types currently needed across extracted components.
- Moved `PendingInlineMarks` and `BlockTypeMenuValue` there. The current code includes `vega-lite` and `kanban` block type values, so those were preserved.
- Extracted `Toolbar` into `src/Toolbar.tsx`.
- Verification: `pnpm build` passes.

## Phase 4: Active Inline Marks

- Added `src/inlineRunRendering.tsx`.
- Moved `deriveActiveInlineMarks` and its immediate active-mark helpers there.
- Updated `typingPerf.test.ts` to import `deriveActiveInlineMarks` from `inlineRunRendering`.
- Issue encountered: initially imported `segmentText` from `charUtils`, but it is exported by `selectionModel`; fixed the import.
- Verification: `pnpm build` passes.

## Phase 1: Generic Editor UI Utilities

- Added `src/editorUiUtils.ts`.
- Moved generic helpers for event propagation, jsdom detection, image file extraction, plain arrow key detection, click matching, primary decoration removal, selection key/equality, and key/input performance labels.
- Left popover trigger/range helpers in `EditorApp.tsx` because they still depend on local run/range rendering details.
- Verification: `pnpm build` passes.

## Phase 1: Block Drop Target Helpers

- Added `src/blockDropTargets.ts`.
- Moved block drag ordering helpers and block-level drop target hit-testing helpers there.
- Used a minimal `{blocks}` context shape instead of importing `RenderBlockContext`, avoiding a dependency cycle with editor rendering.
- Verification: `pnpm build` passes.

## Phase 3: Floating Popovers

- Added `src/floatingPopovers.tsx`.
- Moved link, code, code-hover, link-hover, and date embed floating popover components there.
- Moved shared popover state types into `blockEditorTypes.ts`.
- Verification: `pnpm build` passes.

## Verification Summary

- Final `pnpm build`: passes.
- Final `pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts`: fails.
  - Existing/baseline failure: `src/App.test.tsx` many-blocks block-selection performance test still exceeds 50ms. It measured about 336ms in the final run.
  - Existing/baseline failure: `src/undoHistory.test.ts` code block double-enter undo expectation still receives `['ab\n\n']` instead of `['ab', '']`.
  - Additional observed perf failure in final run: `src/typingPerf.test.ts` moderate sequential typing workload measured about 138ms against a 120ms threshold. This appears timing-sensitive; no command/model logic was changed by this refactor.

## Deferred Work

- `EditorApp.tsx` is still large. The first implementation pass created the app entrypoint and several leaf/shared modules, but deeper phases remain:
  - annotation views
  - slash command module
  - table/kanban rendering
  - editable block surface
  - media/code preview blocks
  - controller hook seam
  - CSS split
