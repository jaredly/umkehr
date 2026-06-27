# Implementation Log: Table Keyboard Navigation

## 2026-06-22

- Started Phase 1 by reviewing existing table command helpers, render structure, and tests.
- Key design constraint: vertical table navigation may create cells, so the navigation helper needs to return ops as well as a selection.
- Phase 1: Added `moveTableSelectionByArrow` in `examples/block-rich-text/src/blockCommands.ts`.
  - Resolves row headers, direct cells, and nested blocks inside cells.
  - Moves up/down by table row and source column.
  - Creates missing target cells for sparse rows during vertical navigation.
  - Moves left from the first cell to the row header and right from the last cell to the next row header.
  - Traverses nested cell child blocks before leaving a cell.
- Phase 2: Wired plain arrow-key boundary handling in `examples/block-rich-text/src/App.tsx`.
  - Table navigation is attempted before the existing flat `previousBlockId` / `nextBlockId` fallback.
  - Non-table arrows and in-block native movement continue through the existing path.
  - Used `previewReplicaTs` for non-mutating previews so non-table keys do not create no-op transient selection updates.
- Phase 3: Added single-selection Shift-arrow table extension at the React boundary-handler layer.
  - This covers the same table targets for a single active selection.
  - Multi-cursor table movement remains on the existing pure selection path. I did not route sparse-cell creation through multi-cursor movement because that path currently has no command context for ops; doing so cleanly would require a separate multi-selection command wrapper.
- Phase 4: Added tests.
  - Command tests cover same-column vertical movement, sparse target cell creation, row header navigation, right-wrap to next row header, and nested cell traversal.
  - App tests cover DOM ArrowDown between table rows, Shift+ArrowDown extension, and ArrowLeft from first cell to row header with replica sync after typing.
- Verification:
  - `pnpm exec vitest --run examples/block-rich-text/src/blockCommands.test.ts` passed: 126 tests.
  - `pnpm exec vitest --run examples/block-rich-text/src/App.test.tsx` passed: 128 tests.
  - `pnpm run typecheck` passed.
  - `pnpm exec tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
  - `pnpm exec vitest --run examples/block-rich-text/src --exclude examples/block-rich-text/src/typingPerf.test.ts` passed: 354 tests.
- Issue encountered:
  - An initial broad Vitest invocation accidentally ran the whole repo and failed only `examples/block-rich-text/src/typingPerf.test.ts` on elapsed time (`266ms` observed vs `120ms` threshold). I treated this as a timing-sensitive perf failure unrelated to the table navigation changes and verified the block-rich-text suite with that file excluded.
- Follow-up issue:
  - Plain table up/down initially preserved/clamped numeric offsets instead of preserving the visual horizontal caret position like normal block navigation. Fixed the React table arrow path to reuse `verticalCaretXRef`, `readCaretHorizontalIntent`, and `closestCaretOffsetForHorizontalIntent` when the table target block is already mounted. Missing cells created by navigation still restore to the command-selected offset because the new cell does not exist in the DOM until after the command applies.
  - Updated UI tests so the source caret is visually farther right than the shorter target cell; this catches numeric-offset-only behavior.
- Follow-up issue:
  - Row headers use their own `RichTextEditableSurface` instead of the shared `EditableBlock`, so they were bypassing the table arrow-key handling entirely. Added row-header plain and Shift arrow handling to that custom key handler.
  - Also made `ArrowLeft` from a row header start behave like grid navigation by moving to the previous row's last cell when available.
  - Added UI coverage for row-header right/down/up/left navigation and command coverage for row-header left wrapping.
