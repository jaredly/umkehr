# Research: Block Rich Text UI Example

## Goal

Build a small UI example for `src/block-crdt` that demonstrates a flat, block-based rich text editor:

- type text into blocks
- press Enter to split the current block
- apply bold and italic marks to a selected range
- press Backspace at the start of a block to join with the previous block
- drag blocks to reorder them
- keep scope to one level of root blocks, with no nested blocks

This should be an example/demo layer over the block CRDT, not a new rich text CRDT.

## Current CRDT Surface

Relevant files:

- `src/block-crdt/index.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/initialState.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/Readme.md`
- `.tasks/051-block-testing/research.md`
- `.tasks/052-block-formatting/research.md`

The current block CRDT already exposes the primitives needed for the requested behaviors:

- `cachedState(initialState(actor, ts))` creates a usable starting document with one root paragraph block.
- `addChars(state, text, after, ts, actor?)` inserts grapheme-segmented text after a Lamport anchor.
- `selPos(state, block, offset)` maps a visible block offset to the Lamport position used by insertion/splitting.
- `split(state, {block, char, previous}, ts, actor, options?)` builds ops for block splitting.
- `join(state, left, right, ts, actor)` builds ops for joining the right block into the left block and archiving the right block.
- `markRange(state, block, startOffset, endOffset, type, data, remove, id)` builds inline mark ops for one block range.
- `markOp(...)` can mark an explicit Lamport range, including `crossedSplits`, when a range spans existing split records.
- `materializeFormattedBlocks(state)` returns visible root blocks with text runs and resolved marks.
- `rootBlockIds(state)` and `orderedCharIdsForBlock(...)` expose ordered visible block/character IDs.
- `applyMany(state, ops)` applies operation batches.

The type model already includes `marks` and `splits` in `State`, and `Op` already includes `mark` and `split-record`.

## Behavior Notes

### Text Input

Typing can be implemented by deriving the current caret anchor from the selected block ID and offset:

1. Use `selPos(state, blockId, offset)` to get the insertion anchor.
2. Call `addChars(state, text, anchor, nextTimestamp, actor)`.
3. Move the local caret forward by the number of inserted grapheme segments.

`addChars` uses `Intl.Segmenter`, so the UI should treat offsets as grapheme offsets rather than UTF-16 indexes when possible. For a simple demo, offsets can be tracked from rendered text content if tests include emoji/combining-character coverage later.

### Enter / Split

The `split` helper expects `{block, char, previous}` rather than only an offset.

For a UI adapter:

- at offset `0`, use `char: blockId` and `previous: null`; this creates an empty block before the current block.
- at the end of a block, use `char: null` and `previous: last visible char`; this creates an empty block after the current block.
- in the middle, use `char: selPos(state, blockId, offset)` and `previous: selPos(state, blockId, offset - 1)`.

The existing implementation matches the prior research answers:

- split at start creates an empty previous sibling block
- split at end creates an empty following sibling block
- split in the middle emits a `split-record` and moves the right-side character tree into the new block

After applying a split, the caret should move to the new editable block. At start-split, that means the newly-created empty block before the old content. At middle/end split, that means the newly-created block after the original block, at offset `0`.

### Backspace / Join

The requested behavior is specifically Backspace at the start of a block.

For a UI adapter:

1. If caret offset is not `0`, let the normal delete-character path handle it, or leave it out of the demo if deletion is not in scope.
2. If the block is the first root block, no-op.
3. Otherwise find the previous visible root block via `rootBlockIds(state)`.
4. Record the previous block's visible text length before joining.
5. Apply `join(state, previousBlockId, currentBlockId, ts, actor)`.
6. Move the caret to the previous block at the recorded length.

`join` archives the right block and preserves the left block. The prior testing research settled that the left block wins for metadata/status/order in a join.

### Bold / Italic

For a simple UI, support marks only when the selected range is inside one block. That maps directly to:

```ts
markRange(state, blockId, startOffset, endOffset, 'bold', undefined, false, nextMarkId)
markRange(state, blockId, startOffset, endOffset, 'italic', undefined, false, nextMarkId)
```

The formatter resolves same-type mark conflicts by highest Lamport ID. Removing formatting can be represented by the same range with `remove: true`, though the task only asks to bold and italicize selection.

Selections spanning multiple blocks are not directly handled by `markRange`, which takes one block ID. The CRDT has lower-level `markOp` plus split traversal support, and formatting tests show cross-split marks can work when `crossedSplits` is supplied. The demo should either:

- disable toolbar buttons for multi-block selections in v1, or
- split a multi-block selection into per-block marks.

For this basic example, single-block selection support is lower risk and aligns with the flat-block scope.

### Rendering Formatted Text

`materializeFormattedBlocks(state)` is the natural render source. It returns runs like:

```ts
{text: 'abc', marks: {bold: true, italic: true}}
```

The UI can render each block as a `contenteditable` element containing spans for each run:

- `font-weight: 600` or `<strong>` for `bold`
- `font-style: italic` or `<em>` for `italic`

The hard part is not rendering marks; it is preserving/restoring DOM selection after React re-renders. A demo adapter should keep an editor selection model in CRDT coordinates:

```ts
type EditorSelection =
    | {type: 'caret'; blockId: string; offset: number}
    | {type: 'range'; anchor: {blockId: string; offset: number}; focus: {blockId: string; offset: number}};
```

On selection changes, convert DOM positions to block text offsets. After applying ops, restore DOM selection from the stored model.

### Drag Reorder

Block movement is already represented by `block:move`, with LSEQ ordering:

```ts
{
    type: 'block:move',
    id: movedBlockId,
    order: {
        parent: [0, 'root'],
        index: createLseqIdBetween(beforeIndex, afterIndex, actor/counter info),
        ts,
    },
}
```

`createLseqIdBetween` is exported from `src/block-crdt/lseq.ts`, and `block:move` application already updates the block child cache.

The existing todo demo has a reusable pointer-based drag pattern in `examples/react-crdt/src/apps/todos/useTodoReorder.ts`. It tracks row refs, derives before/after targets from pointer Y coordinates, avoids no-op moves, and calls an `onMove` callback. The block editor can reuse that interaction shape with block IDs instead of todos.

For a flat-list block editor, the move helper should:

1. compute the target list after removing the dragged block;
2. derive `before` and `after` neighbor block IDs for the desired insertion position;
3. create an LSEQ index between their current indexes;
4. emit one `block:move` op with `parent: [0, 'root']`.

Nested block movement should be intentionally unavailable in this example.

## Suggested Example Shape

The repo already has React examples under `examples/react-crdt`. A block rich text example could be added in the same app family as a new app, or built as a smaller isolated example if the goal is only to exercise `src/block-crdt`.

Recommended component responsibilities:

- `BlockRichTextExample`: owns `CachedState`, timestamp generator, actor ID, selection state, and command handlers.
- `BlockEditor`: renders the toolbar and flat block list.
- `EditableBlock`: wraps one `contenteditable` block, renders formatted runs, handles `beforeinput`, `keydown`, `input`, and selection updates.
- `useBlockReorder`: adapted from `useTodoReorder`.

Command handlers should use CRDT ops directly and keep DOM mutation under control:

- Prefer `beforeinput`/`keydown` to intercept Enter, Backspace-at-start, and text insertion.
- Prevent the browser's default DOM edit for handled operations.
- Apply CRDT ops, re-render from `materializeFormattedBlocks`, then restore selection.

Using uncontrolled `contenteditable` and diffing browser-mutated DOM back into the CRDT would be more work and less useful for demonstrating the CRDT operations.

## Testing Recommendations

Minimum coverage for the example:

- renders initial empty block
- typing inserts text into a block
- Enter at start creates an empty block before existing text
- Enter in middle splits text into two blocks
- Enter at end creates an empty following block
- bold and italic buttons apply marks to a selected single-block range
- Backspace at start joins into the previous block and moves caret to the join point
- dragging a block reorders root blocks and preserves block text/marks

Unit tests can cover the command adapter functions without a browser. A small Playwright test is useful for the actual contenteditable selection/keyboard behavior.

## Risks

- DOM selection mapping is the main implementation risk. Rendered mark spans mean a single logical text offset may sit inside different text nodes.
- `markRange` only covers one block. Multi-block selection behavior must be explicitly limited or implemented separately.
- Empty blocks have no character anchors. Caret positioning in empty `contenteditable` blocks needs a DOM placeholder strategy, but that placeholder must not become CRDT text.
- `selPos` throws when the requested offset is out of bounds. UI code should clamp offsets from DOM events.
- Local timestamps and Lamport IDs need a consistent generator. `addChars` uses `state.maxSeenCount + 1`; marks and new block/move ops should also consume IDs/timestamps in a predictable way.
- Browser IME/composition input can conflict with aggressive `beforeinput` interception. For a basic demo, composition can be noted as out of scope or tested separately.

## Open Questions

- Where should the example live: inside `examples/react-crdt` as another selectable app, or as a smaller standalone example?
    - small standalone example
- Should v1 support formatting selections that span multiple blocks, or should toolbar actions be disabled unless selection is inside one block?
    - formatting across blocks results in multiple marks, one per block
- Should bold/italic buttons toggle based on current selection state, or only apply marks? Toggle requires detecting active formatting and emitting remove marks.
    - yeah let's toggle so we can remove marks too
- Should ordinary Backspace within a block delete a character, or is only Backspace-at-start needed for this example?
    - yeah ordinary backspace within a block should delete a character
- Should paste insert plain text only, split pasted newlines into blocks, or be left to browser defaults?
    - split on newlines
- Should the demo preserve selection through remote/concurrent updates, or only through local edits?
    - preserve selection through remote/concurrent updates
- Should drag reorder use pointer events only, HTML5 drag-and-drop, or a small drag library? Existing repo code favors pointer events.
    - use pointer events only
- What visual block affordance should initiate dragging so it does not fight text selection inside `contenteditable`?
    - dragging with an explicit handle
- Do we want this UI to demonstrate archived/joined blocks in history, or only the current materialized document?
    - use your judgement

## Additional Notes

We'll want this example to be able to demonstrate the full capability of the CRDT, we'll want to have two editors side-by-side, synced together (with a toggle to "go offline & queue changes").
