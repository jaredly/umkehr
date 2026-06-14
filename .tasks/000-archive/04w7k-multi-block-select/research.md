# Research: Multi-Block Selection Outside Multi-Select Mode

## Task

`examples/block-rich-text` supports Shift+Arrow expansion across block boundaries when there are multiple selections. In ordinary single-selection mode, Shift+Arrow cannot cross block boundaries. Also, pressing Backspace while a selection spans a block boundary should join the affected blocks, but currently only deletes selected characters and leaves the block boundary intact.

The recent selection work has moved most editing through a retained multi-selection model, so this is a good point to simplify the split between "normal" and "multi-select" behavior.

## Relevant Files

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Current Architecture

Selection has three related representations:

- `EditorSelection` in `selectionModel.ts`: UI/command shape, either a caret or anchor/focus range using `{blockId, offset}`.
- `RetainedSelection` in `retainedSelection.ts`: stable selection anchors based on block ids and character ids so selections survive remote edits, split, join, and move.
- `RetainedSelectionSet` in `selectionSet.ts`: one or more retained selections with a primary id.

Most commands now operate through the selection-set layer:

- `App.tsx` uses `runEditCommand`.
- `runEditCommand` reads the live DOM selection with `liveSelectionSet`.
- It calls a `multiSelectionCommands.ts` command such as `deleteBackwardEverywhere`, `insertTextEverywhere`, or `extendSelectionsHorizontally`.
- The command resolves retained selections, applies the underlying block command, retains the result, and restores the primary selection to the DOM.

The underlying block commands already accept multi-block `EditorSelection` ranges:

- `normalizeSelectionSegments(state, selection)` expands a cross-block range into per-block segments.
- `insertText`, `splitBlock`, `toggleMark`, `deleteBackward`, and `deleteForward` all call into that model for non-collapsed selections.
- `joinWithPrevious` and `joinWithNext` exist for collapsed Backspace/Delete at block boundaries.

## Finding 1: Shift+Arrow Cross-Block Behavior Is Gated On Multiple Selections

In `EditableBlock.onKeyDown`, Shift+Arrow is delegated to `onExtendSelectionsHorizontally` or `onExtendSelectionsVertically` only when `hasMultipleSelections` is true:

```ts
hasMultipleSelections &&
isPlainArrowKey(event.key) &&
event.shiftKey
```

When there is only one selection, Shift+Arrow falls through to native contenteditable behavior. Native selection can expand within the focused editable div, but the blocks are separate contenteditable elements, so native selection does not cross into sibling blocks.

This is why multi-select mode can cross block boundaries and ordinary mode cannot. The model layer can already do it; the event routing prevents ordinary single-selection mode from using it.

## Finding 2: Plain Arrow Cross-Block Behavior Has Two Paths

For multiple selections, plain Arrow keys use:

- `moveSelectionsHorizontally`
- `moveSelectionsVertically`

For a single selection, cross-block ArrowLeft/ArrowRight/ArrowUp/ArrowDown is handled with custom per-block logic in `App.tsx`:

- ArrowLeft at offset `0` moves to the previous block end.
- ArrowRight at block end moves to the next block start.
- ArrowUp/ArrowDown at visual first/last line use DOM geometry to pick a target offset.

This is why single-selection plain movement works at boundaries, while single-selection extension does not. The single-selection movement path was manually implemented, but the matching extension path was not.

## Finding 3: Backspace Over A Cross-Block Range Deletes Text But Does Not Join

`deleteBackward` and `deleteForward` currently treat any non-collapsed selection the same:

```ts
if (!isCollapsed(selection)) {
    const deleted = deleteSelection(state, selection);
    return {state: deleted.state, ops: deleted.ops, selection: caret(deleted.point.blockId, deleted.point.offset)};
}
```

`deleteSelection` iterates over `normalizeSelectionSegments` and emits `char:delete` ops for selected visible characters. It does not emit any block join ops.

Example:

1. Document is `one` / `two`.
2. Selection is from `{first, 2}` to `{second, 1}`.
3. Current delete removes `e` and `t`.
4. Blocks remain `on` / `wo`.
5. Desired behavior is likely one block: `onwo`, with caret at the original selection start.

Collapsed boundary deletes are already handled correctly by `joinWithPrevious` and `joinWithNext`. The missing behavior is specifically non-collapsed ranges that cross one or more block boundaries.

## Recommended Direction

### 1. Route ordinary Shift+Arrow through the selection-set commands

Remove the `hasMultipleSelections` requirement from the Shift+Arrow branch in `EditableBlock.onKeyDown`, or introduce a shared predicate that delegates all plain Shift+Arrow events to the selection-set movement layer.

This would make single-selection and multi-selection keyboard extension share:

- `extendSelectionsHorizontally`
- `extendSelectionsVertically`
- retained selection resolution
- primary DOM restoration
- keyup suppression via `handledNavigationKeyRef`

The current multi-selection command names are broader than multi-select in practice. They already work for a one-entry `RetainedSelectionSet`, so a future cleanup could rename them to selection-set commands, but that is not required for the fix.

### 2. Keep vertical Shift+Arrow behavior model-based unless visual-line semantics are required

`extendSelectionsVertically` currently moves to the previous/next block and clamps the offset by text length. It does not use DOM geometry or visual-line detection.

That is already the behavior available in multi-select mode. If the task is only to bring ordinary mode to parity with multi-select mode, reusing it is correct and low risk. If ordinary Shift+ArrowUp/Down is expected to preserve horizontal visual intent like plain ArrowUp/Down, that is a larger feature because the selection-set command layer is model-only and does not accept DOM geometry.

### 3. Teach range deletion to remove selected boundaries

For Backspace/Delete with a non-collapsed range, deletion should:

1. Normalize the selection to start/end points.
2. Delete selected visible characters as today.
3. If the normalized range spans multiple visible blocks, join the covered block run so the start and end fragments become one block.
4. Return a caret at the normalized start point, resolved in the surviving block after joins.

For a range from block A to block C, this likely means joining A with B, then the surviving A with C, in document order after character deletion. The existing `join(state, left, right, ts, actor)` primitive can emit the necessary ops, and `joinWithNext` demonstrates the desired caret placement for a single boundary.

The command should produce one operation list containing both `char:delete` ops and join ops so replicas apply the same edit.

### 4. Prefer putting boundary-joining behavior in `blockCommands.ts`

The invariant "deleting a range that crosses block boundaries removes the boundary" belongs with the editing command, not with React event handling.

Suggested shape:

- Extend `deleteSelection` or add `deleteSelectionAndJoinBoundaries`.
- Compute normalized start/end before applying ops.
- Delete selected chars.
- Join visible blocks from the start block through the end block.
- Return `{state, ops, point}` with `point` at the original start.

This keeps `deleteBackwardEverywhere` and `deleteForwardEverywhere` correct for both one selection and many selections, because they already delegate to `deleteBackward` / `deleteForward` for each merged range.

## Edge Cases To Cover

- Single-selection Shift+ArrowRight from end of one block selects into the next block.
- Single-selection Shift+ArrowLeft from start of one block selects backward into the previous block.
- Single-selection Shift+ArrowDown/Up crosses blocks with the same model behavior as multi-select mode.
- Backspace on a range from middle of block A to middle of block B joins the remaining text into block A.
- Delete on the same cross-block range behaves the same as Backspace.
- Backspace on a range spanning three blocks joins all remaining fragments into one block.
- Backspace on a cross-block range where the start or end block has no selected characters still removes the selected boundary if the range crosses it.
- Multi-selection delete still works when one entry is cross-block and another entry is a caret or range elsewhere.
- Remote replica receives the same block join result after deleting a cross-block range.
- Retained selections resolve sensibly after the join.

## Test Targets

Good focused tests:

- `multiSelectionCommands.test.ts`: add command-level tests for `deleteBackwardEverywhere` on a one-entry retained selection set whose range crosses blocks.
- `blockCommands.test.ts`: add lower-level tests for `deleteBackward` and `deleteForward` with cross-block ranges.
- `App.test.tsx`: add keyboard tests for ordinary single-selection Shift+Arrow crossing block boundaries, then typing/replacing/deleting to prove the retained selection state matches the DOM.

Existing tests around plain Arrow movement and Backspace caret restoration are useful regression coverage and should stay intact.

## Open Questions

1. Should Backspace/Delete over a cross-block selection always join every boundary touched by the selection, matching browser contenteditable behavior, even if the selection starts or ends exactly at a boundary?
    - yeah
2. For a selection from the end of block A to the start of block B, should Backspace join A and B even though no characters are selected? Browser behavior usually treats the boundary as selected if the range crosses it, but this needs an explicit product decision.
    - yes
3. Should Shift+ArrowUp/Down in ordinary mode exactly match current multi-select mode's block-to-block offset clamp, or should it preserve visual horizontal intent like plain ArrowUp/Down?
    - yeah we want visual horizontal intent
4. When deleting a range spanning nested/indented blocks, should join follow visible document order only, or should parent/child structure affect which block survives and where descendants move?
    - visible document order.
5. If a multi-selection delete includes overlapping cross-block ranges, is the existing `mergeOverlappingRanges` normalization enough, or do we need extra tests around boundary joins after range merging?
    - yeah mergeOverlappingRanges should be used

## Implementation Sketch

1. In `App.tsx`, delegate all unmodified Shift+Arrow keys to `onExtendSelectionsHorizontally` / `onExtendSelectionsVertically`, not only when `hasMultipleSelections`.
2. Keep plain Arrow behavior as-is initially, because it has DOM geometry behavior for ordinary vertical movement.
3. In `blockCommands.ts`, replace the non-collapsed delete path with a helper that deletes selected characters and joins visible block boundaries included by the normalized selection.
4. Ensure joins are emitted after character deletes against the updated working state.
5. Add command tests first, then app-level keyboard tests.
