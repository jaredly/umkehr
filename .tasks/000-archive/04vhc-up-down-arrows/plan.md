# Plan: Up/Down Arrow Navigation Between Blocks

## Decisions From Research

- `ArrowUp` on the first block and `ArrowDown` on the last block should fall through to native browser behavior.
- `Shift+ArrowUp` and `Shift+ArrowDown` are out of scope for now.
- Wrapped visual lines matter. Let the browser handle up/down movement inside the current block, and only do custom cross-block movement when the caret is on the first visual line for `ArrowUp` or the last visual line for `ArrowDown`.
- Horizontal intent should be editor-level for a vertical-navigation sequence and reset on non-vertical actions.
- Browser layout behavior can be manually tested; automated tests should cover deterministic command/state flow and helper logic where practical.

## Phase 1: DOM Caret Geometry Helpers

File: `examples/block-rich-text/src/domSelection.ts`

Add helper types/functions for vertical movement:

```ts
export type CaretHorizontalIntent = {
    x: number;
};
```

Implement a helper to read the live collapsed caret's horizontal position:

- Read `window.getSelection()`.
- Require an existing collapsed range contained by the provided root/block.
- Measure the caret x-coordinate using a robust rect fallback:
  - `range.getClientRects()[0]`,
  - non-empty `range.getBoundingClientRect()`,
  - temporary zero-width marker span,
  - final fallback to the block's left edge.

Implement a helper to find the closest caret offset in a target block:

- Iterate candidate offsets in grapheme units, matching `segmentText`.
- Convert each candidate offset to a DOM point using existing offset logic.
- Measure a collapsed range at each candidate.
- Choose the offset whose measured x-coordinate is closest to the stored intent x.
- Return `0` for empty blocks.

Implement helpers to detect visual-line boundaries:

- For `ArrowUp`, determine whether there is a caret position in the same block visually above the current caret.
- For `ArrowDown`, determine whether there is a caret position in the same block visually below the current caret.
- If such a position exists, do not intercept the key event; allow native contenteditable movement.
- A practical implementation can compare candidate caret rect `top`/`bottom` values against the current caret rect with a small tolerance.

Keep these helpers DOM-focused and independent of CRDT state.

## Phase 2: Editor-Level Vertical Intent State

File: `examples/block-rich-text/src/App.tsx`

Add an editor-level ref in `BlockEditor`:

```ts
const verticalCaretXRef = useRef<number | null>(null);
```

Add a reset helper:

```ts
const resetVerticalCaretIntent = useCallback(() => {
    verticalCaretXRef.current = null;
}, []);
```

Reset the ref on non-vertical actions:

- mouse selection capture,
- keyup selection capture for non-vertical keys,
- text insertion,
- delete/backspace,
- enter split,
- tab indent/unindent,
- paste,
- bold/italic command shortcuts,
- `ArrowLeft` / `ArrowRight`,
- focus leaving the editor.

Do not reset it during consecutive plain `ArrowUp` / `ArrowDown` movements.

## Phase 3: Cross-Block Up/Down Key Handling

File: `examples/block-rich-text/src/App.tsx`

Extend `EditableBlock` props so the block can request vertical movement using the target block id and DOM element lookup.

Recommended shape:

- Keep `rootRef` in `BlockEditor`.
- Add a `moveCaretVertically(direction, sourceBlockElement, targetBlockId)` callback in `BlockEditor`.
- Pass `onMoveCaretVertically` into each `EditableBlock`.

In `EditableBlock.onKeyDown`:

- Only consider `ArrowUp` / `ArrowDown` when:
  - no `shiftKey`,
  - no `altKey`,
  - no `metaKey`,
  - no `ctrlKey`,
  - `readSelectionFromDom(event.currentTarget)` returns a caret.
- For `ArrowUp`:
  - If there is no `previousBlockId`, do nothing and let native behavior run.
  - If the caret is not on the first visual line, do nothing and let native behavior run.
  - Otherwise prevent default and move to the previous block.
- For `ArrowDown`:
  - If there is no `nextBlockId`, do nothing and let native behavior run.
  - If the caret is not on the last visual line, do nothing and let native behavior run.
  - Otherwise prevent default and move to the next block.

In `moveCaretVertically`:

- Resolve the target contenteditable by `[data-block-id]` within `rootRef`.
- Initialize `verticalCaretXRef.current` from the current caret x if it is `null`.
- Use `closestCaretOffsetForHorizontalIntent(targetBlock, {x})`.
- Call existing `onMoveCaret(caret(targetBlockId, offset))` behavior so retained selection state and DOM restoration stay on the current path.

## Phase 4: Tests

File: `examples/block-rich-text/src/App.test.tsx`

Add integration tests for the state and caret behavior that jsdom can verify:

- `ArrowDown` from the last visual line of a block moves to the next block.
- `ArrowUp` from the first visual line of a block moves to the previous block.
- Moving vertically updates the live DOM caret and subsequent insertion happens at that moved caret.
- Movement syncs inserted text to the other replica after the caret move.
- `Shift+ArrowUp` / `Shift+ArrowDown` are not custom-handled.
- `ArrowUp` on the first block and `ArrowDown` on the last block do not force a cross-block move.

For horizontal preservation, add deterministic test coverage by shimming measurement:

- Prefer testing a pure or injectable helper for "pick closest offset from candidate rects".
- If the DOM helper is not easily injectable, monkey-patch range rect methods in the test to return predictable positions.
- Cover a shorter target block clamp case and a longer target block middle-offset case.
- Cover repeated vertical movement preserving the original x intent through a shorter middle block, if the test shim can express it cleanly.

Avoid relying on real jsdom layout.

## Phase 5: Manual Browser Verification

Run the example in a browser and verify:

- `ArrowUp` / `ArrowDown` move normally within a wrapped multi-line block.
- `ArrowUp` at the first visual line moves to the previous block while preserving x.
- `ArrowDown` at the last visual line moves to the next block while preserving x.
- Repeated up/down maintains the original horizontal goal through shorter blocks.
- First-block `ArrowUp` and last-block `ArrowDown` behave natively.
- Empty blocks can be entered from above and below.
- Inline bold/italic spans and emoji/graphemes do not cause obvious offset drift.

## Phase 6: Validation

Run focused tests first:

```sh
npm exec vitest examples/block-rich-text/src/App.test.tsx
```

Then run the broader relevant test set if time permits:

```sh
npm exec vitest examples/block-rich-text/src
```

Record any manual browser findings in an implementation log if this task directory starts tracking one.
