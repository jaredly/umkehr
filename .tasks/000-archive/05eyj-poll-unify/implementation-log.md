# Implementation Log: Poll Edit/View Toggle

## Phase 1: Local Mode State

- Started implementation against a clean diff for the touched source files.
- Confirmed the mode can live inside each `BlockEditor` instance, so toggling one pane will not sync to the other pane or create CRDT ops.
- Added `PollEditorMode` and local `pollModesByBlockId` state in `BlockEditor`, defaulting missing entries to `view`.
- Reset the local mode map on editor reset signal so fixture/history resets do not keep stale block-id UI state.

## Phase 2: Render Tree Gating

- Added child-backed poll detection for `kind === 'children'` and `kind === 'matrix'`.
- Passed poll mode through `RenderBlockContext` into `renderEditableBlock`.
- Gated recursive child rendering so answer/matrix poll children render only in edit mode.

## Phase 3: Inline Toggle

- Added an inline `View` / `Edit` toggle inside answer and matrix poll blocks.
- Kept the toggle `contentEditable={false}` and prevented mouse down from stealing rich-text selection.
- In edit mode, the parent poll question remains visible/editable while answer/matrix poll controls are hidden.

## Phase 4: Hidden-Selection Handling

- Added a selection-only command when switching from edit to view.
- If the active selection intersects the poll's descendant subtree, it moves to the end of the parent poll question.
- No CRDT ops are emitted for this selection move or for the mode toggle.

## Phase 5: Tests

- Added answer-poll coverage for default view mode, toggling into edit mode, hiding rendered poll controls in edit mode, showing child option blocks in edit mode, and returning to view mode.
- Added matrix-poll coverage for default view mode, hiding row/column/extra child blocks in view mode, toggling into edit mode, showing all child blocks in edit mode, and returning to view mode.
- Covered per-pane UI behavior by asserting the right pane remains in view mode when toggling the left pane.

## Phase 6: Verification

- Passed: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "poll"`
- Passed: `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`
- Issue: full `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` failed only on existing perf-threshold tests outside the poll path:
  - `keeps a single printable input in an empty document under the perf budget`: measured `6.87ms`, threshold `<5ms`.
  - `handles Enter at the end of the second 400 character pasted block in less than 50ms`: measured `58.5ms`, threshold `<50ms`.
- Reran the failed perf filter. The Enter perf case passed on rerun, but the printable-input perf case still exceeded the strict local threshold (`14ms`, threshold `<5ms`). No functional poll tests failed.

## Follow-up: Compact Poll Stats

- Changed rating poll, inline answer poll, and matrix poll stats to render as subtle background fills instead of inline percentage/count text.
- Moved exact stat details into native hover text via `title` attributes.
- Left list answer polls with inline stats, since the follow-up specifically called out inline answer polls.
- Added focused assertions that compact poll stats use hover details and do not render `.pollResult` inline text.
- Passed after follow-up: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "poll"`
- Passed after follow-up: `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`

## Follow-up: Immediate Poll Stat Tooltip

- Replaced native `title` hover details with `data-poll-result` attributes plus CSS hover/focus tooltips.
- Kept the implementation CSS-only so stats appear immediately without adding popover state or timers.
- Updated tests to assert compact poll controls no longer have native `title` attributes.
- Passed after tooltip follow-up: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "poll"`
- Passed after tooltip follow-up: `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`

## Follow-up: Selected Result Background

- Issue: selected/hover poll control rules had higher specificity than `.pollResultBackground`, so a user's selected answer could hide the result fill.
- Fixed by adding result-background selectors that match selected/hover specificity for answer options, rating stars, and matrix cells.
- Added assertions that selected inline answer, matrix, and rating controls keep `pollResultBackground` and `data-poll-result`.
- Passed after selected-background follow-up: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "poll"`
- Passed after selected-background follow-up: `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`
