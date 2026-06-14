# Research: Up/Down Arrow Navigation Between Blocks

## Goal

Update `examples/block-rich-text` so `ArrowUp` and `ArrowDown` move the caret between rendered blocks, preserving the user's horizontal caret position as closely as possible.

This should make the block editor behave like a normal multi-line editor even though each block is a separate `contentEditable` element.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/style.css`

The UI renders one `contentEditable` per block in `EditableBlock`. Each block receives:

- `previousBlockId`
- `previousBlockLength`
- `nextBlockId`
- `blockLength`
- `selection`
- `onMoveCaret(selection)`

`EditableBlock` already handles horizontal cross-block movement:

- `ArrowLeft` at offset `0` moves to the previous block at `previousBlockLength`.
- `ArrowRight` at `blockLength` moves to the next block at offset `0`.

Those handlers use `readSelectionFromDom(event.currentTarget)`, require a collapsed caret, call `event.preventDefault()`, then call `onMoveCaret(caret(...))`. `onMoveCaret` stores the primary retained selection and schedules DOM restoration, so later edits use the moved caret.

Selection infrastructure is offset based at the UI boundary:

```ts
type BlockPoint = {blockId: string; offset: number};
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};
```

`domSelection.ts` can currently:

- read a DOM selection into block id plus grapheme offset,
- restore a selection to DOM,
- restore a caret to a block offset.

It does not currently expose helpers for caret geometry or "closest offset at x-coordinate".

## Important Constraint

Up/down navigation cannot be implemented correctly from character offsets alone.

For proportional fonts, wrapping, inline formatting, emoji/graphemes, and variable-width text, "same offset in previous/next block" is not the same as "same horizontal position". The implementation needs to preserve a pixel x-coordinate and resolve that x-coordinate to the closest caret position in the target block.

The browser selection/range APIs are the right source of truth for this:

- Use the current collapsed caret range's `getBoundingClientRect()` or `getClientRects()` to get the current x-position.
- Probe candidate caret positions in the target block with temporary ranges and choose the offset whose rect is nearest to the remembered x-position.

## Recommended Design

Add DOM geometry helpers in `domSelection.ts`.

Suggested exported API:

```ts
export type CaretHorizontalIntent = {
    x: number;
};

export const readCaretHorizontalIntent = (root: HTMLElement): CaretHorizontalIntent | null;

export const closestCaretOffsetForHorizontalIntent = (
    block: HTMLElement,
    intent: CaretHorizontalIntent,
): number;
```

`readCaretHorizontalIntent` should:

1. Read `window.getSelection()`.
2. Return `null` unless there is one collapsed range inside `root`.
3. Derive an x-coordinate from the caret rect.
4. Use a fallback rect strategy for collapsed ranges that return empty rects.

`closestCaretOffsetForHorizontalIntent` should:

1. Count offsets in grapheme units, matching the existing `segmentText` model.
2. Create a temporary collapsed range at each possible offset in the target block.
3. Compare each caret rect's x-coordinate to `intent.x`.
4. Return the nearest offset.
5. Clamp to `0` for empty blocks.

This can be O(block length) because this is an example app and block lengths are small. If performance ever matters, the same helper can later be optimized with binary search by visual line.

## Key Handling

Extend `EditableBlock` in `App.tsx`.

Add props for previous/next block elements or a lookup function. The current component only has ids and lengths; for vertical movement it also needs the target block's DOM node.

A minimal local pattern:

- Keep the existing `rootRef` in `BlockEditor`.
- Pass an `onMoveCaretVertically(direction, sourceBlockElement)` callback to `EditableBlock`, or pass a helper that resolves `blockId` to the corresponding `[data-block-id]` element.
- In `ArrowUp` / `ArrowDown`, only handle plain collapsed-caret movement:
  - no `shiftKey`,
  - no `altKey`,
  - no `metaKey` / `ctrlKey`,
  - `readSelectionFromDom(event.currentTarget)?.type === 'caret'`.
- If there is no previous/next block, allow the browser's native behavior or prevent and stay put. See open question below.
- If a target block exists:
  - `preventDefault()`,
  - read the horizontal intent from the current block/root,
  - resolve the closest offset in the target block,
  - call `onMoveCaret(caret(targetBlockId, offset))`.

The existing `onMoveCaret` flow should continue to handle retained-selection storage and DOM restoration.

## Horizontal Intent Across Repeated Keypresses

Native editors preserve the original horizontal goal while moving through short lines. Example:

1. Caret starts near x=300 in a long line.
2. `ArrowDown` moves to offset at x=120 in a short line.
3. Another `ArrowDown` should still try x=300, not x=120.

To match that behavior, store the current vertical navigation x-coordinate in a ref in `BlockEditor` or `EditableBlock`.

Suggested shape:

```ts
const verticalCaretXRef = useRef<number | null>(null);
```

On `ArrowUp` / `ArrowDown`:

- If `verticalCaretXRef.current` is `null`, initialize it from the live caret rect.
- Use the ref value for target resolution.

Reset `verticalCaretXRef.current` on any non-vertical navigation or editing input, such as:

- text insertion,
- delete/backspace,
- enter,
- tab indent/unindent,
- paste,
- mouseup selection capture,
- `ArrowLeft` / `ArrowRight`,
- focus changes.

This is optional for a first version, but it is the difference between "one-step horizontal preservation" and normal editor behavior across multiple up/down presses.

## DOM Geometry Details

Collapsed range rects can be awkward:

- Some browsers return an empty `getBoundingClientRect()` for a collapsed range.
- `range.getClientRects()[0]` may exist even when the bounding rect is empty.
- At offset `0` in an empty block, there may be no text node.

Robust fallback strategy:

1. Try `range.getClientRects()[0]`.
2. Try `range.getBoundingClientRect()` if it has non-zero dimensions.
3. Insert a temporary zero-width marker span at the caret, measure it, then remove it.
4. As a final fallback, use the block's left edge.

The existing empty-block CSS creates a pseudo-element:

```css
.editableBlock[data-empty="true"]::before {
    content: "";
    display: inline-block;
    width: 1px;
}
```

Pseudo-elements are not DOM nodes, so geometry helpers should still handle an empty editable by measuring a temporary marker or the block rect.

## Tests

`examples/block-rich-text/src/App.test.tsx` already has integration helpers for:

- creating blocks via paste/newlines,
- setting DOM carets,
- firing keydown events,
- checking `domCaretPosition(panel)`.

Add tests covering:

1. `ArrowDown` from a block moves to the next block.
2. `ArrowUp` from a block moves to the previous block.
3. The target offset is clamped to the shorter block's closest available offset.
4. The target offset can land in the middle of a longer next/previous block rather than always start/end.
5. Repeated `ArrowDown` / `ArrowUp` preserves the original horizontal intent through a shorter middle block, if implementing the ref behavior.
6. `Shift+ArrowUp` / `Shift+ArrowDown` is not intercepted yet, unless range extension is intentionally implemented.
7. After vertical movement, text insertion occurs at the moved caret and syncs to the other replica.

Potential jsdom issue: jsdom does not perform layout, so `Range#getClientRects()` / `getBoundingClientRect()` cannot naturally verify pixel-based horizontal behavior. Options:

- Unit-test the pure "choose nearest measured candidate" helper by injecting a measurement function.
- In App tests, monkey-patch range rect methods or the exported geometry helper to return deterministic x-values.
- Keep integration tests for command flow and add a browser-level test later if this repo already has Playwright coverage for examples.

## Proposed Implementation Plan

1. Add caret geometry helpers to `domSelection.ts`.
2. Add vertical movement handling to `EditableBlock`.
3. Add a vertical-intent ref so repeated up/down presses preserve the original x-coordinate.
4. Reset vertical intent on non-vertical edits/navigation.
5. Add focused tests in `App.test.tsx`, using a deterministic geometry shim where needed.
6. Run the block-rich-text test suite.

## Open Questions

- Should `ArrowUp` on the first block and `ArrowDown` on the last block be prevented and keep the caret in place, or should native browser behavior be allowed?
    - allow native behavior
- Should `Shift+ArrowUp` and `Shift+ArrowDown` extend selections across blocks now, or is collapsed-caret movement enough for this task?
    - skip for now
- Should vertical navigation account for wrapped visual lines inside the same block, or only move between blocks? Native contenteditable can already handle intra-block visual-line movement; intercepting every `ArrowUp` / `ArrowDown` may override that. A conservative implementation should only move between blocks when the caret is on the first visual line for `ArrowUp` or the last visual line for `ArrowDown`.
    - yes account for wrapping, do the conservative thing
- If a block contains multiple visual lines due to wrapping, how should "go between blocks" be triggered? The most editor-like behavior is: browser handles movement within the block, custom code handles movement only when there is no visual line above/below in the current block.
    - yeah
- Should horizontal intent be shared across the whole editor or scoped per focused block? Native behavior is effectively per vertical-navigation sequence, so an editor-level ref reset by non-vertical actions is likely best.
    - yeah
- Is browser-level coverage expected for this task? jsdom can test state flow, but not real layout without shims.
    - we can do manual testing
