# Implementation Log: More Normal Table Blocks

## Progress

- Started Phase 1 by locating all `rowParent` and `table_row` references across metadata, commands, rendering, history validation, and tests.
- Completed the source-side metadata and structural conversion:
  - `RichBlockMeta` table metadata no longer carries `rowParent`.
  - `table_row` metadata has been removed from source code.
  - table rows are now detected as direct children of table blocks.
  - table cells are now detected as direct children of non-table rows.
  - cell subtrees are considered for row emptiness.
  - cell child blocks render below the cell's own content.
  - direct child tables of tables render as full-width interstitial rows.
- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passes.
- Updated tests to assert the new table shape and nested-cell semantics:
  - rows are paragraph children of tables
  - direct table children are rows, not below-grid content
  - moving a cell preserves its child subtree
  - non-empty cell child subtrees prevent empty-row deletion
  - child blocks inside cells can indent normally
  - multi-selection movement reaches row headers through the new editable table order
- Final targeted verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/multiSelectionCommands.test.ts`
- Addressed feedback pass:
  - rows can move out of tables as normal blocks
  - normal blocks can move into tables as rows
  - child drops onto rows remain blocked to avoid accidentally turning blocks into cells
  - empty row headers now use their row index placeholder instead of the global ellipsis
  - table title/header renders inside the bordered table grid
  - table row header and cell editable surfaces use non-wrapping text behavior with horizontal overflow
- Feedback verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/multiSelectionCommands.test.ts`
- Fixed table-header block type selector regression:
  - the toolbar no longer skips table blocks for non-table block type choices
  - selecting the table header and choosing Paragraph/Heading/etc. now changes the table block metadata
  - added an App regression test that converts a table header back to a paragraph
- Selector regression verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/multiSelectionCommands.test.ts`
- Fixed conversion behavior for blocks with existing children:
  - converting a block with direct children to a table now treats those children as the rows
  - default rows/cells are only added when the converted block has no children
  - added a command regression test for this case
- Existing-children conversion verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Issues / Workarounds / Bugs

- `table_row` is used outside the table creation path, especially in row-header editing, block movement constraints, multi-selection block classification, and history validation. The implementation needs shared structural helpers rather than isolated string replacement.
- Paste shortcut row-header special casing was removed because rows are now normal paragraph blocks. This may be revisited if row headers need restricted markdown behavior later.
- Multi-selection horizontal movement now sees the table title as an editable stop before row headers. The old test assumed row headers followed the previous root block directly; the test was updated to assert movement from the table title into the row header and from the first cell back to the row header.
- App-level rendering tests did not have a clean way to synthesize arbitrary cell child blocks through the UI. The cell-child rendering path is covered by source changes and command-level subtree tests; existing App tests still pass.
- Moving the table title into the `role="table"` subtree made existing test helpers count the title as a table cell editor. The helper was narrowed to `.tableCell` editors, and the row-handle test now expects the table title's normal block move affordance inside the table.
- The block type toolbar had intentionally skipped `meta.type === 'table'` for non-table choices from the previous model. Once the table header became a normal editable block, that skip made the selector appear inert; removing it restored normal block type behavior.
- `convertBlockToTable()` previously always synthesized the requested default rows/cells after changing metadata. With normal children-as-rows, that would append rows to a block that already had meaningful children, so it now exits after the metadata change when rows already exist.
