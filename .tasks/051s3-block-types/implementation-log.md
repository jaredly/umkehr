# Implementation Log

## 2026-06-13

- Started phases 1-3 implementation.
- Found core `block-crdt` already has generic metadata types and `initialStateWithMeta`, so the example can carry its own metadata union without core changes.
- Added the example-local `RichBlockMeta` union plus metadata constructors/predicates.
- Switched the demo runtime to `initialStateWithMeta('doc', paragraphMeta('00000'))`.
- Added block metadata commands on top of `setBlockMetaOps`, including multi-selection wrappers.
- Added toolbar block-type controls, todo/code/callout inline controls, code Enter/Tab behavior, and grouped subtree rendering for blockquote/callout.
- Added command/history/undo/UI coverage for rich metadata, metadata undo/redo, code Enter/Tab, and grouped blockquote rendering.
- Issue encountered: tests that used static metadata timestamps newer than replica clock timestamps caused later todo toggles/undo ops to be ignored by LWW as designed. Fixed the tests to use replica-style timestamp ordering.
- Verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run build`
- Follow-up issue: `preventDefault()` on native `<select>` controls made the block type menu unusable, and removing it from the inline callout menu exposed editor-level mouse capture/focus interference. Fixed inline code/callout controls by stopping event propagation without preventing default behavior, and added a callout kind dropdown regression test.
- Follow-up issue: code language edits were routed through the normal edit-command path, which restores the text caret after every command and stole focus from the language input after each typed character. Fixed by adding a block-control command path for inline metadata controls that does not schedule text selection restore, and by targeting the specific block instead of the current text selection.
- Follow-up issue: code blocks with trailing newline text did not visibly show the final blank line, and there was no keyboard path to leave a code block. Added a display-only trailing-newline marker, made normal Enter on a trailing blank line remove that trailing newline and create a following paragraph, and kept Shift+Enter as a forced newline inside code.
- Follow-up issue: the first trailing-newline marker was visual-only and did not create a selectable DOM position after the newline; restored carets landed before the line break. Replaced it with a real `<br>` plus zero-width sentinel target, and updated DOM selection mapping to ignore sentinel text for logical offsets while restoring the final offset inside the sentinel.
- Follow-up issue: the `<br>` version over-rendered the trailing code newline as two blank lines because `white-space: pre-wrap` already creates the visual line for the model newline. Removed the `<br>` and kept only the zero-width sentinel after the newline as the selectable final caret target.
- Follow-up issue: undoing the code-block double-Enter exit restored the deleted newline as a fresh replacement char, so the previous newline-insert command then looked like it had no live original char to undo and became blocked. Updated the undo planner to delete a visible replacement char at the same insertion parent when undoing an inserted char whose original id is already tombstoned, and added a regression for undoing exit followed by undoing the newline insert.
- Follow-up issue: the toolbar block-type dropdown always showed the placeholder/default instead of the selected block's type. Made it controlled from the primary selection's focused block metadata and added a regression for moving between differently typed blocks.

## Phase 4-5

- Added an opt-in `VirtualBlockParentConfig` to core block parent derivation, materialized paths/parents, cache organization, traversal, insert/move ops, and apply/remote dependency checks.
- Preserved default behavior for callers that do not pass virtual parent config.
- Added virtual-parent tests for inserting under a virtual parent, moving under a virtual parent, virtual-aware visible traversal/path sibling anchors, remote pending/apply after the declaring block arrives, and cycle safety.
- Added example `editableBlockIds` traversal and moved text navigation, selection normalization, retained selection fallback, word occurrence search, and multi-selection movement onto editable traversal.
- Left drag/drop and block structural movement on visible rendered blocks, so non-text operations are not forced through editable-only order.
- Added regression coverage for skipping `table_row` structural blocks during horizontal caret movement.
- Verification passed:
  - `npm run typecheck`
  - `npm exec vitest -- run src/block-crdt/index.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts src/block-crdt/index.test.ts`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run build`

## Phase 6

- Added the first annotation mark model for sidebar comments, footnotes, and popovers using a single `annotation` mark with presentation data and the mark Lamport id as the body parent.
- Added comment/footnote/popover toolbar actions, annotation reference styling, sidebar comment rendering, and document-order footnote rendering.
- Added explicit mark-based virtual parent ownership so annotation mark ids can validate as block parents without storing annotation identity on body blocks.
- Routed example replay/remote application through the annotation virtual-parent config so annotation body blocks replay from history and sync to peers.
- Issue encountered: the existing virtual-parent config only allowed virtual parents declared by block metadata, but annotation parents are declared by marks. Addressed this by adding an explicit `markVirtualParents` config surface to core virtual-parent handling and scanning annotation body blocks directly for sidebar/footnote UI instead of surfacing them in the main visible outline.
- Follow-up review found phase 6 gaps: annotation bodies were static, popovers were creatable but not rendered, body rich-text runs were ignored, same-block footnotes sorted by creation order, and there was no phase 6 acceptance coverage.
- Made `markVirtualParents` first-class in core parent derivation, traversal, cache organization, split ops, and join-record apply. This removed the need for raw path scanning and lets configured formatted outlines include annotation body blocks.
- Updated annotation rendering to use formatted body runs, added prompt-backed sidebar/footnote body editing that records ordinary CRDT text ops on body blocks, and rendered popover annotations.
- Added phase 6 regression coverage for annotation sync, virtual body parents, history export/import replay, split/join mark survival, footnote document order, deleted-reference hiding, shared annotation mark type, and formatted body runs.
- Issue encountered: normal example commands that derive block paths must pass the annotation virtual-parent config once annotation body blocks exist. Threaded `annotationVirtualParents(state)` through the example block command apply/path/sibling helpers.
- Verification passed:
  - `npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
- Follow-up issue: clicking Comment crashed undo-state derivation because `undoHistory` replayed command ops with plain `applyMany`, so the annotation body block under a mark virtual parent was pending. Fixed undo replay to pass `annotationVirtualParents(before)` and added a regression for deriving undo availability after creating a comment.
- Follow-up issue: annotation body editing was initially exposed through a prompt, which made it a CRDT text replacement but not a usable rich-text block editor. Replaced the prompt UI with embedded contentEditable body blocks that render formatted runs and emit normal body-block text/delete/mark ops for typing, paste, Backspace/Delete, Enter-as-newline, and Cmd/Ctrl+B/I.
- Follow-up issue: the first embedded body editor used a separate React `onBeforeInput` path and duplicated editor surface behavior, so browser input was unreliable and the implementation diverged from normal blocks. Extracted a shared `RichTextEditableSurface` from `EditableBlock` and reused its native `beforeinput`, DOM run rendering, focus decoration cleanup, and caret restore path for annotation bodies.
- Follow-up issue: Cmd+B in a comment body applied the mark but collapsed the DOM selection to the start. Added a failing DOM regression, then fixed `restoreSelectionToDom`'s block lookup so a single editable block can be passed as the selection root, not only a parent container.
- Follow-up enhancement: comments can now be created on selected text inside comment/footnote body blocks. The toolbar tracks the active annotation body selection, `createAnnotation` accepts same-block body ranges, and annotation reference rendering now uses the formatted outline that includes annotation bodies so nested comments are visible.
- Follow-up issue: same-type annotation marks used the formatter's default LWW resolution, so overlapping comments hid older comment data. Added `markBehavior` to formatted block materialization with default `lww` behavior and opt-in `stacking` behavior, then configured `annotation` as stacking in the example. Exact-overlap comment creation now appends a new body block under the existing annotation mark instead of creating another identical mark.
- Follow-up cleanup: split formatted run output into scalar `marks` and optional array-valued `stackedMarks` so callers that only use LWW marks do not have to handle scalar-or-array unions.
- Follow-up enhancement: popover annotations now render inline on marked text as hover/focus popovers using the annotation body text, instead of appearing in a separate side panel.
- Follow-up issue: CSS-only popovers disappeared before the pointer could reach the body, so the popover text could not be selected or edited. Replaced the pseudo-element tooltip with a delayed-hide floating popover that renders the same CRDT annotation body editor used by sidebar comments and footnotes, and threaded popover hover handling through shared editable surfaces so popovers inside annotation bodies work too.
- Workaround: the test DOM used here does not expose `Element` on `globalThis`, so delegated popover target detection uses the editable root document's `Element` constructor instead.
- Follow-up issue: a popover could still disappear from pointer-leave while its body editor was focused, and fully selected popover marks required hover before opening. Added focus-pinning based on actual DOM focus and derived selected-mark activation from the formatted block list, including annotation body blocks.
- Follow-up issue: nested popovers replaced or allowed their parent popover to close. Switched active popovers to a small stack and made pointer-hide id-specific so parent popovers remain visible while a child popover is shown or focused.
- Follow-up issue: clicking a nested popover mark inside a parent popover did not reliably open the child while preserving the parent because popover marks only activated on hover/selection and focus pinning checked only the first floating popover. Added delegated click activation for popover marks and made focus checks cover the whole popover stack.
- Follow-up issue: child popovers stayed open when focus returned to their parent popover. Focus now trims the popover stack to the focused popover unless the current selection fully covers a deeper popover mark, and the DOM test selection helper now maps offsets across all rendered run text nodes so nested mark selections are exercised correctly.
- Follow-up issue: leaving a parent popover while a hover-open child popover was visible left the child stuck open because parent hide requests refused to modify stacks with descendants. Id-specific pointer hides now trim the leaving popover and descendant hover popovers, with coverage for leaving the parent entirely after hovering a child mark.
- Follow-up issue: focus or selection in a parent popover pinned hover-open child popovers even when the selection did not cover the child mark. The pointer-hide focus guard is now stack-position aware, so parent focus only pins the parent while child hover popovers still close unless the child mark itself is selected or focused.
- Follow-up issue: the same parent-focus pinning bug still appeared when the pointer left the parent popover entirely because the parent hide path treated focus in the parent as protecting all descendants. The parent-focused hide branch now trims descendant hover popovers while keeping selected descendants, and focused popover id is tracked explicitly instead of relying only on `document.activeElement`.

## Phase 7

- Added table-aware virtual-parent config for the example, combining table row parents with the existing annotation mark virtual parents so commands, replay, selection traversal, and rendering validate the same paths.
- Added table commands for creating tables, creating missing sparse cells, adding rows, adding columns, and reordering rows under the table's virtual `rowParent`.
- Table creation now creates a sibling table after the focused block in normal document flow, and converts a focused table cell block into a nested table when invoked inside a row.
- Rendered table blocks by grouping structural `table_row` children into a grid and rendering row children as ordinary editable cell blocks. Normal children under the table block continue to render outside the grid.
- Added table toolbar controls plus per-table row/column controls and row up/down controls. Sparse missing cells render as grayed-out "Add cell" buttons.
- Issue encountered: the main render tree needs annotation virtual parents for path validation, but should not render annotation body blocks in the document flow. Fixed by materializing with the full virtual-parent config and filtering annotation body block ids out of the main tree.
- Issue encountered: row reordering initially appeared broken in tests because the test used a fresh timestamp generator, causing the move's LWW timestamp to lose to row creation. Fixed the test to reuse a monotonic command context, matching replica clock behavior.
- Verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm run build`

## Phase 8

- Added table-cell keyboard navigation: Tab moves forward through cells, Shift+Tab moves backward, and Tab from the final cell creates a new row beneath and moves into its first cell.
- Table creation from the toolbar now restores the caret into the first created cell instead of preserving the pre-table selection.
- Added deliberate cell-boundary join behavior: Backspace/Delete can join adjacent cells in the same row, but cross-row and table-to-document joins are blocked.
- Kept split behavior using ordinary block split semantics, so splitting a cell creates another ordinary cell in the same row.
- Multi-selection text operations now use the full rich-text virtual-parent traversal, and multi-selection marks across table cells are covered by regression tests.
- Indent/unindent now refuses to move cells out of structural `table_row` parents, both directly and through multi-selection structural movement.
- Cell drag handles are visible again, allowing cells to be dragged into and out of tables. Table rows now also have drag handles wired through the existing block reorder hook, in addition to row up/down buttons.
- Issue encountered: generic outline movement in `multiSelectionCommands` still used non-virtual materialization, which made table-aware selected-block movement inconsistent. Fixed it to use the shared rich-text virtual-parent config.
- Verification passed:
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm run build`
- Follow-up polish: removed row up/down arrow controls now that rows can be dragged, added row-level drop indicators, tightened table-cell drop indicators so they do not use the document block offset, and fixed the table-cell grid so hidden markers do not leave a zero-width track over the editable content.
- Follow-up behavior: Enter at the end of a table cell now moves into an empty cell to the right, or creates the missing cell to the right when the row is sparse. Non-empty right cells still fall through to the normal split behavior.
