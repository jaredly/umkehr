# Research: Boundary-Based Retained Inline Formatting

## Goal

Update retained inline formatting in `examples/block-rich-text` so typing with an active collapsed mark does not create a new mark op for every inserted character.

The desired shape is:

- Starting bold at a collapsed caret creates one open mark whose start is "before" the next typed character, so later children inserted after that character are included.
- Continuing to type while bold is active should extend through normal CRDT character parent/child ordering without emitting a mark op per character.
- Stopping bold should remove or close the overshooting/open mark and create a bounded mark ending "after" the final character that was typed.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/localTextOps.ts`
- `examples/block-rich-text/src/inlineMarks.ts`
- `src/block-crdt/marks.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/formatting.test.ts`

Collapsed inline formatting is currently UI-local pending state:

```ts
type PendingInlineMarks = Partial<Record<BooleanInlineMark, boolean>>;
```

`runInlineMarkToggle` in `App.tsx` checks whether every selection entry resolves to a caret. If so, it toggles the pending mark flag and returns no CRDT ops. When text is inserted, `insertTextWithPendingMarks` routes to `insertTextWithMarksEverywhere`.

`insertTextWithMarks` in `blockCommands.ts` is the expensive part. It:

1. Calls `insertText(...)`.
2. Computes the inserted visible offset range.
3. Emits one `markRangeOp(...)` per pending mark over exactly the just-inserted text.

This means typing `abcdef` with bold pending emits six char ops plus, for bold, six mark ops if each character arrives as an individual `beforeinput` insertion.

The core block CRDT mark model is already boundary-based:

```ts
export type Boundary = {
    id: Lamport;
    at: 'before' | 'after';
};

export type Mark = {
    id: Lamport;
    start: Boundary;
    end: Boundary;
    remove: boolean;
    type: string;
    data?: JsonValue;
    crossedSplits: Lamport[];
};
```

But the public helper path hides that flexibility. `markOp(...)` always creates `{start: before, end: after}`, and `markRange(...)` requires a non-empty visible offset range, anchors to the first and last covered characters, and throws for empty ranges.

`applyMark` stores marks immutably by mark id. Reusing a mark id with a different payload throws `re-insert of mark ... and the payload is different`. So "stop bold" cannot mutate the original open mark in place. It needs to be expressed as additional mark ops.

## Current Mark Semantics

`materializeFormattedBlocks(...)` collects the characters covered by each mark using `coveredCharIdsForMark(...)`, then resolves marks by type.

For normal, non-stacking marks:

- The highest Lamport mark id for a type wins at each character.
- A remove mark wins by deleting the type from the resolved marks.
- Later same-type add marks override earlier same-type add/remove marks.

This existing last-writer-wins behavior is useful for closing an open retained mark. A later remove mark can cover the part that should no longer be bold. A later add mark can reassert the exact bounded range if needed.

`coveredCharIdsForMark(...)` already honors boundary polarity:

- `start.at === 'before'` starts at the start id.
- `start.at === 'after'` starts at the next id.
- `end.at === 'before'` stops before the end id.
- `end.at === 'after'` includes the end id.

It also follows later splits unless the mark explicitly recorded those splits as crossed. This is the behavior that makes boundary marks track CRDT structure rather than fragile offsets.

## Implementation Direction

The main change should move pending collapsed formatting from a boolean flag to retained pending mark state that tracks an open CRDT mark.

Possible editor-side state:

```ts
type PendingInlineMark = {
    type: BooleanInlineMark;
    openMarkId: string;
    start: Boundary;
    lastTypedCharId: string | null;
};

type PendingInlineMarks = Partial<Record<BooleanInlineMark, PendingInlineMark>>;
```

A helper should create boundary-aware mark ops directly or via a new core helper. The existing `markRangeOp` is not enough because it cannot create a mark whose end is intentionally open beyond the inserted character.

Likely core helper additions in `src/block-crdt/marks.ts`:

- `markBoundaryOp(id, start, end, type, data, remove, crossedSplits?)`
- `crossedSplitsBetweenBoundaries(state, start, end)` or a documented rule for when split provenance is needed.
- Possibly `charBoundaryAtVisibleOffset(state, block, offset, bias)` to convert a caret/offset into "before next char" or "after previous char".

Starting a retained mark:

1. User toggles bold on at a collapsed caret.
2. No op is possible yet if there is no next typed char to anchor to. Store an intent in local state.
3. On the first inserted character, emit a single add mark with:
   - `start: {id: firstInsertedCharId, at: 'before'}`
   - `end: {id: openEndAnchor, at: 'after'}` or another deliberately open boundary
4. Store `firstInsertedCharId`, `openMarkId`, and update `lastTypedCharId` after each subsequent insertion.

The open-end design is the key unresolved technical detail. A mark must still have an `end` boundary. If the end is the first inserted char, later siblings/children after that char are not necessarily included. To include text typed after the current character, the mark needs an end boundary that remains after those later insertions according to traversal semantics.

Potential approaches:

1. End at a sentinel boundary such as the block id or a synthetic tail marker.
   - Current `Boundary.id` is just a Lamport, so a block id could type-check, but `coveredCharIdsForMark` expects the end id to appear in the flattened char sequence. A block id currently will not.
   - This likely requires explicit support for block-start/block-end boundaries or sentinel chars.
2. End at "before next char" when there is a next visible character after the caret.
   - If typing in the middle of `a|b`, start before the first typed char and end before `b`. Later typed children before `b` remain included.
   - This matches the user's wording: "The first op should be `before` the next char, so all children added after the current one are included."
   - It does not directly cover typing at end of block unless there is an end sentinel.
3. End at a far/right boundary and close with a remove mark.
   - For example, open bold from first typed char through the current end of the block/document.
   - On stop, emit a later remove mark over the overshoot after the final typed char and optionally a later bounded add mark through the final typed char.
   - This fits immutable mark ops and LWW resolution, but needs careful handling so existing text after the caret is not visibly bold while the user is typing.

Stopping a retained mark:

1. If no character was typed while the mark was pending, clear local pending state and emit no ops.
2. If characters were typed, emit a close sequence that leaves only the typed range formatted.
3. Because mark ops are immutable, this must be additional ops, not mutation of the original add mark.
4. A robust close sequence is likely:
   - Add a remove mark of the same type over the open/overshot suffix.
   - Add a bounded add mark from the original start to `{id: lastTypedCharId, at: 'after'}` if the remove mark's LWW id would otherwise erase part of the intended range.

The bounded replacement/add mark in step 4 matches the task wording "remove that bold and make a new one that is bounded to `after` the final char you typed." It also avoids relying on a lower-id open add mark after a higher-id remove mark has covered any overlapping characters.

## Edge Cases To Design Explicitly

Typing at end of block is the hardest case because there may be no "next char" to use as a stable right boundary. This probably needs a block-end boundary or sentinel if the intended behavior must work at normal end-of-paragraph typing positions.

Typing before existing text can use the existing next character as the right boundary. Example: `a|b`, turn on bold, type `XY`. The open mark can start before `X` and end before `b`, so `XY` is bold and `b` is not.

Typing into an empty block has neither a previous nor next character. It likely has the same requirements as end-of-block typing and needs a sentinel/block boundary.

Deleting while an open retained mark is active needs a clear policy. If the user types `abc`, backspaces `c`, then stops bold, should the bounded mark end after `b`? The pending state should track the last surviving typed character, not just the last inserted char id.

Splitting while an open retained mark is active should either close the mark before the structural edit or update the open mark bookkeeping across the split. Existing marks can follow splits, but pending local state must still find the final typed character and close boundary.

Multi-caret retained formatting currently routes through `insertTextWithMarksEverywhere`. A boundary-based retained mark per caret is possible but more stateful. A scoped implementation could initially support only the primary collapsed caret and clear pending marks for multi-caret edits, but that would be a behavior change from the current tests.

Composition/input chunks matter. A single `beforeinput` may insert multiple Unicode segments. The first open add should anchor to the first inserted char, while `lastTypedCharId` should become the final inserted char in the chunk.

Remote/concurrent inserts inside the open interval should follow the chosen boundary policy. If another replica inserts between the open mark start and its right boundary before the local user stops bold, those characters may become bold too. That may be correct CRDT interval behavior, but it should be intentional.

## Test Plan

Core `src/block-crdt/formatting.test.ts` coverage should come first:

- A mark from `before X` to `before next` includes later children inserted after `X` and before `next`.
- A mark ending `before next` does not include `next`.
- A close sequence leaves only the intended typed characters bold.
- Closing after a later remove plus bounded add converges when ops are applied in different orders.
- End-of-block or empty-block retained formatting behavior, once the boundary design is chosen.

Command-level tests in `examples/block-rich-text/src/blockCommands.test.ts` or a new retained-formatting command test should cover:

- Starting bold at `a|b`, typing `XY`, and stopping bold emits one initial mark plus close ops, not one mark per typed char.
- The final rendered runs are `a` plain, `XY` bold, `b` plain.
- Typing multiple characters in separate insert commands still uses one open mark until stop.
- Toggling off before typing emits no mark ops.
- Backspace before stopping closes at the last surviving typed char.

UI tests in `examples/block-rich-text/src/App.test.tsx` should cover:

- `Cmd+B`, type several characters, `Cmd+B` produces the expected `.markBold` run.
- Toolbar active state still reflects pending and existing marks.
- Moving the selection clears or closes pending retained formatting according to the chosen product rule.
- Existing range formatting still uses range mark ops and still passes.

Useful commands:

```sh
npm exec vitest -- run src/block-crdt/formatting.test.ts
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

## Open Questions

- What should the right/open boundary be when the caret is at end of block or in an empty block? Current mark traversal has no block-end sentinel.
    - let's have an empty end mean "to the end of the block"
- Should the open mark ever visibly format existing text after the caret while the user is still typing, or must the initial open interval exclude it immediately?
    - it should definitely exclude it
- On stop, is the intended operation exactly two mark ops after typing: one remove over the open bold and one bounded add through the final typed char?
    - yes
- Should retained formatting support multiple simultaneous carets, each with its own open mark, or can pending retained marks be limited to the primary caret?
    - yes, support multiple simultaneous carets
- Should selection movement close the open mark at the last typed char, or clear it and leave any already-emitted open mark to be closed by an explicit toggle-off only?
    - selection movement should do nothing
- Should delete/backspace while pending retained formatting is active update the final boundary to the last surviving typed char, or should deletion close/cancel the open mark?
    - don't do anything special. it should work as normal
- Should concurrent remote inserts inside the open interval inherit the local pending bold before the local user stops bold?
    - yes, don't do anything special
- Should this redesign apply to `italic` and `strikethrough` at the same time as `bold`, since current pending state supports all `BooleanInlineMark` values?
    - yes
