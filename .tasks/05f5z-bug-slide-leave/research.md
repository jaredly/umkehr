# Research: Prevent Presentation-Mode Editing From Leaving the Current Slide

## Problem

In `examples/block-rich-text`, presentation mode currently makes a slide deck show only the active slide, but normal editor commands can still move the selection, selected blocks, or edited content outside that active slide.

The reported concrete case is `Shift+Tab`: when the caret is in a child block inside the current slide, `Shift+Tab` calls the normal unindent command. If that child block's parent is the slide block, unindent moves the child to become a sibling after the slide, which removes it from the presented slide and leaves the user's effective focus outside the current slide.

The broader requirement should be treated as: while editing inside a slide deck in presentation mode, commands should not produce a resulting selection/focus outside the currently presented slide, and commands should not move selected slide content out of that slide.

## Relevant Code

- `examples/block-rich-text/src/EditorApp.tsx`
  - `SlideDeckBlock` tracks `ui.mode`, `currentSlideId`, and selects the slide block when entering presentation mode or changing slides (`selectSlideBlock`, lines 3795-3815).
  - Presentation key handling only intercepts deck-level navigation keys when the current slide block itself is selected, and `Escape` for fullscreen (lines 3851-3888). It does not constrain editing commands from blocks inside the slide.
  - Editable block key handling maps `Tab` to `onIndent` and `Shift+Tab` to `onUnindent` for non-table, non-code blocks (lines 6976-6986).
  - `onIndent` and `onUnindent` call `indentSelections` / `unindentSelections` directly with no presentation-mode boundary context (lines 5358-5366).
  - Arrow navigation can explicitly move caret to `previousBlockId` / `nextBlockId` across block boundaries (lines 7087-7174). This is another path that can leave the current slide if the adjacent editable block is outside the slide.

- `examples/block-rich-text/src/multiSelectionCommands.ts`
  - `indentSelections` and `unindentSelections` both call `moveSelectedBlocks` (lines 697-707).
  - `moveSelectedBlocks` builds moves from `blockMovesForSelection`, then applies each via `moveBlock` (lines 728-751).
  - For unindent, `blockMovesForSelection` targets `{type: 'after', targetBlockId: parentId}` for each selected block (lines 832-842). If `parentId` is the current slide, this intentionally moves the selected block outside the slide.

- `examples/block-rich-text/src/blockCommands.ts`
  - Slide helpers already exist: `slideChildren`, `slideDeckForSlide`, and `isSlideChildOfDeck` (lines 2546-2562).
  - Generic `moveBlock` resolves and applies move targets without any slide/presentation boundary knowledge (lines 3097-3122).

- `examples/block-rich-text/src/selectionModel.ts`
  - `editableBlockIds`, selection normalization, and selected block calculations operate over the whole visible document, not over the active presentation slide.

## Current Behavior Hypothesis

Minimal repro:

1. Create a slide deck with a slide.
2. Add a nested child block under the slide, or indent a block so it is inside the slide.
3. Switch the deck to presentation mode.
4. Put the caret in the child block.
5. Press `Shift+Tab`.

Expected: no operation, or a constrained operation that keeps the block inside the slide.

Likely current result: the selected block is moved to `after` the slide block, because the unindent algorithm moves a selected child after its parent. The block is no longer inside the presented slide.

## Other Leave Paths To Consider

The bug report says "basically any operations that would result in the selection/focus leaving the current slide." `Shift+Tab` is the most obvious structural edit, but similar issues probably exist:

- Plain arrow navigation at slide boundaries: `ArrowLeft`, `ArrowRight`, `ArrowUp`, and `ArrowDown` can call `onMoveCaret` / `onMoveCaretVertically` with adjacent blocks from the global document order.
- Shift-arrow selection extension can extend ranges outside the current slide.
- `Home` / `End` and modifier-arrow movement use whole-block horizontal movement helpers and may cross slide boundaries.
- `Enter`, `Backspace`, and `Delete` may split or join blocks across a slide boundary if the caret is at the first or last block inside a slide.
- Multi-selection commands can include blocks outside the current slide unless the selection is clipped or rejected in presentation mode.
- Drag/drop block movement and toolbar/block controls may also move slide contents outside the current slide if available while presenting.

## Suggested Fix Shape

Add an explicit presentation editing boundary instead of only patching `Shift+Tab`.

Recommended model:

1. Determine the active presentation boundary in `EditorApp.tsx`: when a block is rendered inside a slide deck whose `ui.mode === 'presentation'`, pass the `currentSlideId` as a constraint through render/edit context.
2. Add helpers that answer:
   - Is a block inside the current slide subtree?
   - Is a selection wholly inside the current slide subtree?
   - Does a command result keep the primary selection/focus inside the current slide subtree?
3. For commands that can move blocks, reject moves whose moved block starts inside the boundary but whose resolved target parent would be outside the same slide subtree.
4. For navigation commands, do not move or extend the caret/range to `previousBlockId` / `nextBlockId` when that target is outside the current slide.
5. For split/join/delete commands, either preflight the specific boundary case or postflight-reject results whose selection leaves the slide or whose ops remove/move the selected slide content outside the slide.

For `Shift+Tab` specifically, the targeted guard can live in `blockMovesForSelection` / `moveSelectedBlocks` or as a wrapper around `unindentSelections`:

- If `direction === 'unindent'`, `parentId === activeSlideId`, and the selected block is inside `activeSlideId`, return no move for that block.
- More generally, compute the resolved move target and require its parent to still be within the active slide subtree.

The more durable approach is to make the boundary an option to the command layer, not just a UI key handler check, because paste, menu actions, drag/drop, and future shortcuts may route around the specific keydown branch.

## Test Plan

Add focused tests around the command layer where possible, plus at least one UI-level regression for the key behavior.

Useful command-level tests:

- `unindentSelections` with an active slide boundary should be a no-op when the selected block's parent is the current slide.
- `unindentSelections` should still work for deeper descendants when the result remains inside the current slide.
- `indentSelections` should still work within a slide when the target parent is inside the same slide.
- A selected range spanning outside the current slide should be rejected or clipped according to the chosen behavior.

Useful UI-level tests:

- In presentation mode, pressing `Shift+Tab` in a slide child does not move the block out of the slide and the active selection remains inside that slide.
- Arrow navigation from the first/last editable block in the current slide does not move focus to the previous/next block outside the slide.

## Open Questions

- Should presentation mode prevent only keyboard-driven edits, or all editing surfaces including toolbar actions, slash commands, paste, drag/drop, and block controls?
- When a user tries to extend a range outside the slide, should the app clamp the range at the slide boundary or treat the keypress as a no-op?
- Should `Enter`, `Backspace`, and `Delete` at the edge of a slide be no-ops, create content inside the current slide, or navigate slides?
- Should nested slide-like structures ever be allowed, and if not, should move/indent commands also prevent moving a slide into another slide or moving content between slides?
- In presentation mode, should selection be allowed on the slide block itself only for deck navigation, or should child text editing be fully supported but constrained?
- Should a slide boundary constraint be stored as UI-only state in `EditorApp.tsx`, or should it be represented in command context so command tests can exercise it directly?
