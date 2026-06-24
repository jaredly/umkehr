# Implementation Log: Kanban Block Type

## 2026-06-24

### Phase 1: Metadata, Serialization, And Creation Surfaces

- Started by reviewing the current rich text metadata, document format, clipboard, history, toolbar, and slash command paths.
- Noted that the working tree already contains the previewable-code work (`mermaid`/`vega-lite` as code previews), so kanban changes are being layered on top of that current state.
- Added `kanban` to rich block metadata, document import/export, clipboard metadata parsing, history metadata parsing, toolbar values, and slash command values.
- Added focused tests for kanban document import/export, clipboard metadata parsing, and replace-document history import.
- Issue: the document format export normalizes implicit paragraph children to explicit `{type: 'paragraph'}` and normalizes code language `text` to `plaintext`; adjusted the kanban round-trip expectation to match existing format behavior.

### Phase 2: Command Model And Structure Helpers

- Added a `convertBlockToKanban` command that marks the current block as `kanban` and creates default `todo`, `in progress`, and `done` column children when the block has no visible children.
- Added kanban structure helpers for identifying board columns, cards, and card/column context without introducing kanban-specific reorder commands.
- Added command-level tests proving that card moves, column moves, child-card nesting, column extraction, and column reordering all use normal `moveBlock` behavior.

### Phase 3: Rendering And Creation Flows

- Wired `kanban` into the toolbar block type control and slash command flow.
- Added board, column, and card renderers. Columns are direct children of the kanban block; cards are direct children of columns; child blocks render as card contents.
- Added CSS for the board layout, columns, cards, drag handles, and drop indicators.
- Added a `kanban-board` fixture covering mixed card block types, nested card contents, and a nested table.

### Phase 4: Drag And Drop

- Added kanban-aware drop target resolution in `useBlockReorder`; it maps card and column drops to existing `MoveTarget` values rather than adding new block reorder commands.
- Added UI tests for rendering the fixture, toolbar conversion, slash command creation, card moves between columns, and column reordering.
- Issue: fixture-created blocks originally used Lamport-style strings as timestamps, while local edits use packed HLC timestamps. Kanban drag generated valid `block:move` ops, but the move timestamp compared older than the fixture order timestamp and was ignored. Fixed runtime fixture import to keep fixture block ids stable while using HLC timestamps, so later local moves win normally.

### Validation

- Passed focused suite: `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/documentFixtures.test.ts examples/block-rich-text/src/App.test.tsx` (465 tests).
- Passed build: `npm run build` in `examples/block-rich-text`.
- Build note: the command printed `Error connecting to agent: Operation not permitted` before running, but `tsc` and Vite completed successfully and the process exited 0.
