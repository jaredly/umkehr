# Plan: Multi-Block Selection In Single-Selection Mode

## Goals

- Ordinary single-selection mode should support Shift+Arrow selection across block boundaries.
- Shift+ArrowUp/Down should preserve visual horizontal intent, matching the existing plain ArrowUp/Down behavior.
- Backspace/Delete over any cross-block range should remove the selected block boundaries and join blocks in visible document order.
- Boundary-only selections, such as the end of block A to the start of block B, should join the blocks even when no characters are selected.
- Multi-selection deletes should continue to use `mergeOverlappingRanges` before applying edits.

## Phase 1: Add Focused Command Tests

Start with command-level coverage so the model behavior is nailed down before React keyboard handling changes.

### `blockCommands.test.ts`

Add tests for `deleteBackward` and `deleteForward` with non-collapsed cross-block selections:

- Middle of block A to middle of block B:
  - Input: `one` / `two`
  - Selection: `{first, 2}` to `{second, 1}`
  - Expected: one block `onwo`, caret at `{survivingFirst, 2}`
- End of block A to start of block B:
  - Input: `one` / `two`
  - Selection: `{first, 3}` to `{second, 0}`
  - Expected: one block `onetwo`, caret at original start offset.
- Start of block A to start of block B:
  - Input: `one` / `two`
  - Expected: one block `two`, caret at offset `0`.
- A range spanning three blocks:
  - Input: `ab` / `cd` / `ef`
  - Selection from middle of first to middle of third.
  - Expected: all remaining fragments joined into the first surviving block.
- Reversed anchor/focus order:
  - Same expected result as the forward selection.

Run cache validation in these tests if existing helpers make that available.

### `multiSelectionCommands.test.ts`

Add tests proving selection-set behavior delegates correctly:

- `deleteBackwardEverywhere` with a single retained cross-block range joins blocks.
- `deleteForwardEverywhere` with the same range behaves the same.
- A multi-selection set with overlapping cross-block ranges merges before deletion and applies the edit once.
- A multi-selection set with one cross-block range and one independent caret/range elsewhere still applies in reverse document order without corrupting offsets.

## Phase 2: Implement Cross-Block Range Deletion

Change `blockCommands.ts`, keeping the behavior below the React layer.

### Helper Shape

Replace or extend `deleteSelection` with a helper that can delete selected characters and join selected boundaries:

```ts
const deleteSelectionAndJoinBoundaries = (
    state: CachedState,
    selection: EditorSelection,
    context: CommandContext,
): {state: CachedState; ops: Op[]; point: BlockPoint}
```

Use it from both `deleteBackward` and `deleteForward` when `!isCollapsed(selection)`.

### Algorithm

1. Normalize the range using existing selection utilities.
   - Use `normalizeSelectionSegments` to get visible selected character segments.
   - Derive the normalized start and end points from the selection, including boundary-only ranges where segments may be empty.
2. Capture the visible block order before deletion.
   - Use `visibleBlockIds(state)`.
   - Determine all visible blocks between normalized start and normalized end, inclusive.
3. Delete selected visible characters exactly as today.
   - Emit `char:delete` ops for characters covered by the segments.
   - Apply those ops to a working state.
4. Join boundaries if the normalized selection crosses block ids.
   - Join in visible document order.
   - The first block in the selected block run should be the survivor.
   - For `A/B/C`, join `A+B`, then surviving `A+C`.
   - Boundary-only ranges should still join because the block run contains more than one block.
5. Return the caret at the normalized start point in the surviving block.
   - For cross-block selections, the surviving block is the start block.
   - Clamp the offset after deletion/join.

### Notes

- Joins must be emitted after character deletes and against the current working state.
- Use the existing `join(state, left, right, ts, actor)` primitive rather than duplicating block join op construction.
- Keep collapsed Backspace/Delete behavior through `joinWithPrevious` and `joinWithNext` unchanged.
- Do not move this logic into `multiSelectionCommands.ts`; that layer should continue to merge and delegate.

## Phase 3: Make Single-Selection Shift+Arrow Use The Shared Selection Commands

Change `EditableBlock.onKeyDown` in `App.tsx`.

### Horizontal Shift+Arrow

Remove the `hasMultipleSelections` gate for Shift+ArrowLeft/Right so both single-selection and multi-selection modes call:

- `onExtendSelectionsHorizontally('left')`
- `onExtendSelectionsHorizontally('right')`

This should make single-selection horizontal extension use the retained selection-set path already used for multi-select.

### Vertical Shift+Arrow

Single-selection Shift+ArrowUp/Down needs visual horizontal intent.

Implement a DOM-aware path for ordinary single-selection vertical extension, analogous to existing plain ArrowUp/Down:

1. Read the current DOM selection from the root, not only the current block.
2. Preserve the range anchor:
   - If current selection is a caret, anchor is that caret point.
   - If current selection is a range, anchor is the existing anchor.
3. Move the focus to the visually closest offset in the previous/next block.
   - Reuse `verticalCaretXRef`.
   - Reuse `readCaretHorizontalIntent` and `closestCaretOffsetForHorizontalIntent`.
   - For a non-collapsed range, measure horizontal intent from the focus side if possible.
4. Store and restore `{type: 'range', anchor, focus: movedFocus}` through `replacePrimarySelection`.

Keep the existing multi-selection `onExtendSelectionsVertically` path for multi-select mode unless it is practical to generalize visual intent for every selected range. The task requires ordinary mode to preserve visual horizontal intent; multi-select parity can remain model-based for now.

### Keyup Handling

Any custom-handled Shift+Arrow should set `handledNavigationKeyRef.current = true` so `captureSelection` does not overwrite the model selection on keyup with stale native DOM state.

## Phase 4: Add App-Level Keyboard Tests

Update `App.test.tsx`.

### Single-Selection Horizontal Extension

Add tests for:

- Shift+ArrowRight at the end of block A extends into block B.
- Shift+ArrowLeft at the start of block B extends backward into block A.
- Typing after the cross-block selection replaces the selected content and joins as expected.
- Backspace after the cross-block selection joins blocks.

### Boundary-Only Selection

Add a test for:

- Place caret at end of block A.
- Shift+ArrowRight into start of block B, or otherwise create the boundary-only cross-block range.
- Press Backspace.
- Expected: blocks join even though no characters were selected.

### Vertical Visual Intent

Add tests with the existing mocked caret geometry:

- Shift+ArrowDown from block A extends focus into block B using the closest horizontal offset.
- Repeated Shift+ArrowDown preserves the original horizontal intent.
- Shift+ArrowUp mirrors the behavior.

### Multi-Selection Regression

Retain existing multi-selection tests and add one app-level regression only if command tests do not sufficiently cover:

- Overlapping cross-block multi-selections delete once after `mergeOverlappingRanges`.

## Phase 5: Cleanup And Verification

After implementation:

1. Run the focused test files:
   - `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
   - `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
   - `npm exec vitest -- examples/block-rich-text/src/App.test.tsx`
2. Run the broader block-rich-text test suite if the focused tests pass.
3. Check for naming confusion around `multiSelectionCommands.ts`.
   - Optional cleanup: rename local callback names or comments to clarify that these commands operate on selection sets, not only multi-select mode.
   - Avoid broad file renames unless the implementation already touches most call sites.
4. Manually scan `App.tsx` keydown branches for ordering issues:
   - Formatting shortcuts first.
   - Enter/Tab/delete before navigation.
   - Shift+Arrow before plain Arrow.
   - Multi-selection branches before ordinary single-selection fallbacks where behavior differs.

## Risks

- Joining after range deletion may expose assumptions in retained selection resolution for archived joined blocks. Existing retained-selection tests cover joined-block selections, but add regression coverage if failures appear.
- Visual vertical range extension from a non-collapsed selection may need careful DOM focus-side measurement. If direct measurement is unreliable, fall back to current focus point offset for the first implementation and document the limitation.
- Nested blocks may reveal CRDT join constraints. The product decision is visible document order, so tests should include at least one indented scenario if the join primitive supports it cleanly.
