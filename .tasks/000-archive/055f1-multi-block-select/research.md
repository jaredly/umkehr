# Research: Multi-Block And Block-Level Selection

## Goal

Improve `examples/block-rich-text` selection behavior in three related areas:

1. Normal drag-to-select should work across multiple blocks.
2. If a text selection spans multiple blocks, dragging one selected block's handle should move all selected blocks together and preserve the original text selection after drop.
3. Add a first-class block-level selection mode, primarily for table cells, with keyboard navigation, rectangular table-cell ranges, clipboard support, and drag-to-reorder.

## Relevant Files

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Current Selection Model

The core resolved selection shape is still text-only:

```ts
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};
```

See `selectionModel.ts:7-11`.

The app stores retained selections as a set with a primary entry:

```ts
type RetainedSelectionSet = {
    primaryId: string;
    entries: RetainedSelectionEntry[];
};
```

See `selectionSet.ts:25-43`.

That existing set model is a good base. It already supports:

- multiple entries;
- a primary selection that maps to the native DOM selection;
- retained anchors that survive remote edits;
- range normalization across editable blocks;
- active/inactive manual decorations for retained carets and ranges.

Cross-block text ranges are already model-supported. `normalizeSelectionSegments()` expands a range across visible editable block order and produces one segment per block (`selectionModel.ts:77-110`). Keyboard Shift+Arrow already uses this model path.

## Finding 1: Drag-To-Select Across Blocks Is Mostly A DOM/Event Issue

The root block list has `onMouseDown`, `onMouseUp`, and `onKeyUp` selection capture in `App.tsx:848-951`. On mouse up, it reads the browser selection from the whole editor root:

```ts
const selection = readSelectionFromDom(root);
```

`readSelectionFromDom(root)` supports selections whose anchor and focus are in different blocks, as long as both endpoints are under the same root.

The likely reason normal cross-block drag selection is incomplete is that each block is its own `contentEditable` surface. Browser-native drag selection across separate editable hosts is unreliable or impossible in some browsers. `RichTextEditableSurface` attaches `contentEditable` per block, and `readSelectionFromDom()` can only read the result if the browser actually creates a cross-host DOM selection.

Recommended direction:

- Add an editor-root pointer selection path for plain mouse drag.
- On pointer down inside a text block, capture the start point with `readPointFromMouseEvent(root, event.nativeEvent)`.
- While dragging, compute the current point with `readPointFromMouseEvent(root, pointerEvent)` and store a transient primary `{type: 'range', anchor, focus}`.
- On pointer up, retain that range into the existing `RetainedSelectionSet`.
- Continue restoring the primary selection to the DOM when possible, but rely on manual decorations for cross-block drag feedback.

This should reuse existing `replaceSelectionSet`, `replacePrimarySelection`, `scheduleSelectionRestore`, and `decorationsForSelectionSet` rather than adding a second text-selection store.

Important interaction detail: current `Cmd`/`Ctrl` drag already appends a DOM-read range on mouseup (`App.tsx:927-938`), and tests cover Cmd-drag ranges. The new plain drag logic should avoid regressing that mode. Plain drag replaces the set; Cmd/Ctrl drag appends.

## Finding 2: Multi-Block Drag Reorder Is Currently Single-Block

`useBlockReorder` accepts one source block id and emits one `onMove(blockId, target)` call (`useBlockReorder.ts:27-33`, `useBlockReorder.ts:119-132`). The UI state is also single-root:

- `draggingId: string | null`
- `draggingSubtreeIds` computed from that one id
- one drop target normalized around that one dragged id

`BlockEditor` wires this to `moveBlock(...)` and explicitly keeps the current selection unchanged:

```ts
return {state: result.state, ops: result.ops, selection: current.selection};
```

That selection-preservation behavior is already the desired high-level result for a single block move: retained text anchors should resolve after the move. The missing part is selecting the block group to move.

Recommended direction:

1. Derive selected block ids from the current text range.
   - If a text range spans multiple blocks, collect blocks between the normalized start and end in visible editable order.
   - For drag reorder, use top-level selected blocks, excluding descendants whose ancestor is also selected. `multiSelectionCommands.ts` already has private `topLevelSelectedBlockIds()` logic for indent/unindent; it should be extracted or mirrored.
2. When the user pointer-downs a block handle inside that derived selection, start a group drag instead of a single-block drag.
3. Drop should move the selected top-level blocks as a contiguous group, preserving their relative order and subtrees.
4. Keep `current.selection` unchanged after applying moves so the retained text selection resolves in the moved content.

The command layer should probably expose a `moveSelectedBlocksToTarget(...)` helper rather than teaching React to emit a hand-built sequence. The helper can:

- filter out selected descendants;
- reject drops into the moving set's own subtree;
- apply moves in an order that preserves the selected run order;
- return the original retained selection after the moves.

Risk: `MoveTarget` describes a target for one block. For a group move, `before`/`after`/`child` needs to be interpreted as the insertion point for the first or last block in the group. Applying moves one at a time can disturb the target if the target is also near the moving group. Tests should cover moving a selected middle run upward/downward and moving nested selected blocks.

## Finding 3: Block-Level Selection Should Be A New Selection Variant

Trying to encode block selection as text ranges from offset `0` to block end will cause ambiguity:

- Text range means typing replaces text.
- Block selection means typing should enter text mode at the end of the last selected block.
- Cell selection needs rectangular ranges, which are not naturally represented by one linear text range.
- Clipboard and drag behavior differ from text selection.

Recommended resolved model:

```ts
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint}
    | {type: 'block'; anchorBlockId: string; focusBlockId: string; mode?: 'linear'}
    | {
          type: 'table-cells';
          tableId: string;
          anchorCellId: string;
          focusCellId: string;
      };
```

Recommended retained model:

```ts
type RetainedSelection =
    | retained text caret/range today
    | {type: 'block'; anchorBlockId: string; focusBlockId: string}
    | {type: 'table-cells'; tableId: string; anchorCellId: string; focusCellId: string};
```

Block ids are stable Lamport ids and do not need char anchors. Resolution should clamp missing/deleted block ids to visible nearby blocks, similar in spirit to `clampPoint()`, but block selections should not become text selections unless an editing command explicitly requests that.

Open implementation choice: whether generic multi-block selection and table-cell selection should be one `{type: 'block'; shape: 'linear' | 'rect'}` variant or separate variants. Separate variants are clearer initially because rectangular cells need table-specific resolution.

## Finding 4: Table Structure Is Ready For Cell Block Selection

The recent table-normalization work is present in the code:

- A table's rows are `node.children` (`App.tsx:1922`).
- Cell identity is structural: direct child of a row whose parent is a table (`App.tsx:2306-2314`).
- `tableCellIdForSelection()` already maps a text selection inside a cell child back to the owning cell (`App.tsx:2291-2304`).
- Table cells render with `data-cell-id` and active-cell styling (`App.tsx:2039-2062`).

This means table-cell selection can use cell block ids directly. Rectangular selection can be derived by:

1. Resolve `anchorCellId` and `focusCellId` to row/column coordinates in the same table.
2. Build the inclusive row range and column range.
3. Select existing cells within that rectangle.
4. Decide how to represent missing sparse cells. Current rendering supports missing cells and `createMissingTableCell`; selection may either skip missing cells or create them on edit/paste.

## Finding 5: Current Tab Behavior Conflicts With Desired Block Selection Mode

Current behavior in `EditableBlock`:

- If the block itself is a table cell and the user presses Tab, move to adjacent cell (`App.tsx:3857-3863`).
- If not a table cell, Tab indents/unindents (`App.tsx:3863-3867`).

That already matches the older decision that Tab in a cell child indents/dedents. The new task adds a missing transition: when tabbing through a table cell block, the destination should be a block selection of the next/previous cell, not a text caret.

`moveTableCellByTab()` currently returns a text caret in the destination cell (`blockCommands.ts:1409-1433`). This should either:

- return an `EditorSelection` block/table-cell variant; or
- be wrapped by the app so Tab navigation stores `{type: 'table-cells', anchorCellId: nextCellId, focusCellId: nextCellId}`.

The first option is cleaner if `CommandResult.selection` is widened to the new `EditorSelection`.

## Recommended Implementation Shape

### 1. Extend Selection Types

Add block-level variants to:

- `EditorSelection`
- `RetainedSelection`
- `SelectionSet` helpers
- `primarySelection`, `focusPoint` callers, or replacement helpers for code paths that require text selections.

Do not let text-only helpers silently accept block selections. Add explicit guards:

- `isTextSelection(selection)`
- `textFocusPoint(selection)` or keep `focusPoint()` text-only
- `selectedBlockIdsForSelection(state, selection)`
- `selectedCellIdsForSelection(state, selection)`

This will force toolbar, link, annotation, inline marks, and text-editing paths to decide how block selections behave.

### 2. Add Decorations For Block Selection

Extend `BlockSelectionDecorations` or add a sibling decoration map for:

- selected block rows;
- selected table cells;
- primary/focus styling;
- rectangular table selection range.

The existing text decorations are inserted inside editable text runs. Block/cell selection styling should live on row/cell wrappers:

- `.blockRow.blockSelected`
- `.tableCell.cellSelected`
- `.tableCell.cellSelectionAnchor`
- `.tableCell.cellSelectionFocus`

This avoids mixing whole-block outlines with inline text highlights.

### 3. Add Pointer Selection Paths

Text drag across blocks:

- pointer down on text starts a text-drag selection unless the target is a block/cell control;
- pointer move updates transient text range;
- pointer up commits it.

Cell border click:

- pointer/click on `.tableCell` border should set a single-cell block selection.
- Shift-drag or drag over cells can update the table-cell focus id.
- Rectangular preview should use the table-cell decoration path.

Block drag handle click:

- pointer down on a block handle should set a block selection for that block immediately.
- If the pointer moves past the drag threshold, start reorder.
- If the handle belongs to a block already covered by the current block/text-derived selected block set, drag the selected group.

Current block handles call `onStartDrag(blockId, event)` directly from `BlockAffordance` (`App.tsx:4266-4322`) and row handles from `TableRowHeader`. That hook will need either:

- an `onPointerDownBeforeDrag(blockId)` callback to update selection, or
- a new `startDrag({sourceBlockId, selectedBlockIds})` API.

### 4. Block Selection Editing Semantics

Typing while block-selected:

- Convert to text caret at the end of the last selected block.
- Then insert typed text normally.
- For a table-cell selection, "last" should be focus cell or rectangular bottom-right cell. This is an open product question below.

Backspace/Delete:

- Likely delete selected blocks/cells, not text contents, when in block selection mode.
- For selected table cells, decide whether deletion clears cell content, deletes cells, or deletes rows/columns only when full rows/columns are selected.

Enter:

- Likely switch to text caret at end/start or split after selected block. Needs decision.

Inline marks and link commands:

- Should probably be disabled for block selections unless the selected block maps to a text range.

Block type toolbar:

- Should apply to selected blocks for linear block selection.
- For table-cell selection, apply to selected cell blocks, not every descendant.

### 5. Clipboard Semantics

Current paste path is text-only and goes through `pastePlainTextWithMarkdownShortcutsEverywhere`.

For block selection:

- `Cmd+C` should serialize selected blocks/cells.
- `Cmd+V` should insert copied blocks/cells structurally when the clipboard contains the app format.
- Plain text fallback should paste text into the text caret produced by "typing while block selected" behavior.

Recommended clipboard format:

- `application/x-umkehr-block-rich-text+json` for structured block payloads.
- `text/plain` fallback generated from selected blocks' visible text, probably newline-separated.

For table-cell rectangular selections:

- `text/plain` and `text/tab-separated-values` should be TSV-shaped for spreadsheet interoperability.
- structured payload should preserve cell block subtrees.

Open question: whether copying whole table cells and pasting into a single selected cell should fill a rectangular target, append blocks inside the cell, or replace selected cells.

### 6. Drag Reorder Semantics

Generic block selections:

- Move selected top-level blocks as a group.
- Preserve relative order and subtrees.
- Preserve retained selection after drop.

Table-cell selections:

- Existing cell drag moves one cell (`App.tsx:1917-1968`, `blockCommands.ts:1436+`).
- Multi-cell drag needs explicit product semantics:
  - reorder selected cells within a row?
  - move a rectangular region?
  - move full rows/columns only?

For this task, a pragmatic first pass is:

- Single selected cell drag uses existing `moveTableCell`.
- Multiple selected cells drag is supported only for cells in one row as a contiguous run, unless a rectangle-move behavior is explicitly defined.
- Rectangular multi-cell selection can still support copy/paste before it supports drag movement.

## Suggested Test Coverage

App-level tests:

- Plain drag from block A into block B creates a cross-block text selection.
- Typing after plain cross-block drag replaces the selected text and joins/deletes boundaries according to existing text range semantics.
- Plain click after cross-block drag clears the range to one caret.
- Cmd/Ctrl drag still appends a range instead of replacing existing selections.
- Dragging a handle inside a cross-block text selection moves all selected blocks and preserves the text selection after drop.
- Dragging a handle outside the selected range moves only that block and updates selection to a block selection for that block.
- Clicking a block handle without moving creates a block selection.
- Typing in block selection mode switches to a text caret at the end of the selected block and inserts text.
- Tab from a table cell block moves to the adjacent cell and stores a cell/block selection.
- Tab from a child block inside a cell still indents/dedents.
- Shift+Tab moves backward through cells and stores a cell/block selection.
- Clicking a cell border creates a single-cell selection.
- Dragging across table cells creates a rectangular cell selection.
- Cmd+C in block/cell selection writes useful `text/plain` and app JSON clipboard data.
- Cmd+V with app JSON restores block/cell structure.

Command/model tests:

- Resolve and retain block selections across block moves.
- Clamp block selections when selected blocks are deleted or joined.
- Compute selected top-level blocks from text ranges and block selections.
- Move a selected block group before/after/into a target while preserving order.
- Resolve rectangular table-cell selections across sparse rows.
- Tab navigation helper returns block/table-cell selections instead of text carets.

## Open Questions

1. Should a block-level selection be allowed to include table rows and cells in the same generic linear selection, or should table cell selections always use the table-specific rectangular variant?
- yeah it can, but the mouse-drag-ui should produce a table rectangular selection.

2. For rectangular table selections with missing sparse cells, should selecting the rectangle create missing cells immediately, skip them visually, or show selected empty slots that are created only on edit/paste?
- basically ignore them? I mean you can't have the 'target' or 'anchor' be a missing cell. tabbing into a sparce cell should create it though.

3. When typing in a multi-cell block selection, should the text caret appear at the end of the focus cell, the bottom-right cell of the rectangle, or the last selected cell in document order?
- the focus cell

4. What should Backspace/Delete do in block selection mode: delete selected blocks/cells, clear their contents, or switch to text mode and delete text?
- in table/rect selection mode, if it's a clean "full column" or "full row" it should delete that column/row. otherwise it should clear the contents.
- in normal linear block selection mode, it should delete the blocks

5. What should Enter do in block selection mode?
- new block after the last selected block (furthest down the document)

6. For table-cell clipboard paste, should structured paste replace selected cells, append into cells, or insert new rows/columns when the copied rectangle shape differs from the target selection?
- if the selection is a full column, then past should add an adjacent column. if it's a full row, it should add a row below.
- if the selection is a text selection within a cell, it should add the blocks as children of the cell
- otherwise I think we block the paste... at least for now

7. Should multi-cell drag reorder support arbitrary rectangular selections in the first implementation, or only single cells/contiguous same-row cell runs?
- yes arbitary rectangular selections. and if it's a full column, we should support column-reorder as drop targets

8. When a text selection spans part of the first and last block, and the user drags a selected block handle, should the moved block set include every touched block, or only blocks that are fully selected?
- every touched block

9. Should clicking a block drag handle select only that block, or the whole visible subtree rooted at that block?
- whole visible subtree

10. For block selections over nested blocks, should copy/drag include selected descendants implicitly when an ancestor is selected, matching the top-level selected block behavior used for moves?
- yes implicitly

## Practical First Milestone

A useful staged implementation would be:

1. Implement root-level plain drag-to-select across blocks using the existing text range model.
2. Add selected-block derivation from text ranges and move selected top-level blocks as a group from drag handles.
3. Add a minimal block selection variant for single blocks and single table cells.
4. Change table Tab navigation to store a single-cell block selection.
5. Add rectangular table-cell selection and clipboard support after the single-cell mode is stable.

This order keeps normal text selection improvements separate from the larger block-selection type expansion while still aligning the data model with the table UX goal.
