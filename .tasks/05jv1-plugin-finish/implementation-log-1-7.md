# Implementation Log 1.7: Table Renderer Extraction

## 2026-07-01

- Started table renderer extraction from `BlockRichTextEditor.tsx` into `tablePlugin`.
- Read `plan-1-7.md`, the current central table renderer, plugin renderer types, table selection helpers, table commands, and block drop target utilities.
- Added typed `BlockEditorTableRenderServices` and table drag/drop target types in `src/block-editor/plugins/types.ts`.
- Moved reusable table selection helpers into `src/block-editor/tableRenderHelpers.ts`, preserving annotation virtual-parent lookups.
- Moved table DOM hit-testing helpers into `src/block-editor/tableDomTargets.ts`.
- Added plugin-owned `src/block-editor/plugins/tableRenderer.tsx` with table title, rows, row headers, cells, missing-cell controls, nested tables, table-cell selection drag, and cell drag/drop UI.
- Wired `tablePlugin` to `tableBlockRenderer` and removed the placeholder structural renderer.
- Removed the hard-coded central table render branch and migrated table renderer components/helpers from `BlockRichTextEditor.tsx`.
- Kept table command execution bridged through `pluginBlockRenderContext(...).table`; command ownership remains central for now.

## Issues, Workarounds, And Bugs

- `EditorSelection` can represent arbitrary plugin selections, so moved table rectangle helpers needed explicit `isTableCellSelection(...)` guards before calling table-selection APIs.
- The table renderer still relies on a central command bridge for create/add/move/select operations. This is intentional for this phase and should be revisited during command extraction.
- No focused DOM render harness was added in this pass; visual/DOM interaction coverage relies on existing command/selection/clipboard tests plus manual browser smoke.

## Verification

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts src/block-editor/clipboard.test.ts`
- `rg -n "function TableBlock|function TableRowHeader|renderTableCell|tableCellDragTargetFromPoint|tableCellElementFromPoint" src/block-editor/BlockRichTextEditor.tsx` returns no matches.
