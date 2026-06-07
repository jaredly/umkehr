# Research: Block Rich Text Multi-Select

## Goal

Add multi-selection behavior to `examples/block-rich-text` after the retained-selection work in `.tasks/260606-2138-block-presence` lands.

Requested behavior:

- `Cmd`/`Ctrl` + click-drag adds a range selection.
- `Cmd`/`Ctrl` + click adds a collapsed cursor.
- Triple-clicking a word selects all occurrences of that word across all blocks.
- Typing, deleting, and splitting work against all selections.
- Cursors that resolve to the same visible position deduplicate, even when their retained anchors differ because of tombstones. The "logical first" cursor wins.

This research assumes the selection-retention task is the baseline: stored replica selection is retained/anchored, while offset-based `EditorSelection` is used only at DOM and command boundaries.

## Current Baseline

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/utils.ts`

The retained-selection baseline currently has:

```ts
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};

type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};
```

`Replica.selection` is a single `RetainedSelection`. `App.tsx` resolves it to a single offset selection before command execution and inactive rendering. The command layer (`insertText`, `deleteBackward`, `splitBlock`, `toggleMark`, `pastePlainText`) accepts exactly one offset `EditorSelection` and returns one next offset `EditorSelection`.

Inactive rendering is also single-selection oriented:

- `normalizeSelectionSegments(state, inactiveSelection)` returns a set of block-local range segments.
- a collapsed inactive caret is rendered with one `.retainedSelectionCaret`;
- range pieces get `.retainedSelectionHighlight`.

The DOM layer only reads/restores the browser's native single selection:

- `readSelectionFromDom(root): EditorSelection | null`
- `restoreSelectionToDom(root, selection)`
- `restoreCaretToDom(block, offset)`

Native browser selection cannot represent multiple carets/ranges, so added selections must be represented by app state and rendered manually.

## Recommended Model

Keep the single-selection types for browser/native command boundaries, but introduce selection-set types for stored editor state.

Suggested retained shape:

```ts
type RetainedSelectionEntry = {
    id: string;
    selection: RetainedSelection;
};

type RetainedSelectionSet = {
    primaryId: string;
    entries: RetainedSelectionEntry[];
};
```

Suggested resolved shape:

```ts
type EditorSelectionEntry = {
    id: string;
    selection: EditorSelection;
};

type EditorSelectionSet = {
    primaryId: string;
    entries: EditorSelectionEntry[];
};
```

The primary entry is the selection that behaves like the normal browser selection:

- normal click/drag replaces the set with one primary selection;
- `Cmd`/`Ctrl` + click or drag adds a new entry and makes it primary;
- keyboard editing restores the native DOM selection only for the primary entry;
- after commands, the returned set should keep one primary, usually the last-added/logically last cursor unless a command-specific reason changes it.

Store only `RetainedSelectionSet` on `Replica`.

For migration ergonomics:

- add `retainSelectionSet`, `resolveSelectionSet`, and `initialRetainedSelectionSet`;
- keep existing `retainSelection` and `resolveSelection` helpers for single-entry internals and tests;
- add `singleSelectionSet(selection)` and `primarySelection(set)` helpers so existing code paths can be refactored incrementally.

## Selection Ordering And Deduplication

The selection set needs a deterministic order for editing and dedupe. Use document/logical order derived from the CRDT, not insertion order.

For each resolved offset selection, compute:

- a visible start point from `firstPointForSelection(state, selection)`;
- a visible focus point from `focusPoint(selection)`;
- a stable logical key from retained anchors where possible.

Suggested ordering:

1. block order from `rootBlockIds(state, true)` so archived joined blocks can still participate during retained-anchor resolution;
2. character traversal from `orderedCharIdsForBlock(state, blockId)`, including tombstones;
3. boundary before/after a character via retained point affinity;
4. entry creation order/id as a final deterministic tie-breaker.

For editing commands that mutate text, execute selections from document end to document start. This prevents earlier deletes/inserts from invalidating the visible offsets of later selections. Because retained anchors survive edits, the implementation can also resolve before each step against the current working state, but reverse order is still the simpler mental model for visible offset operations.

Deduplication rules:

- Deduplicate collapsed carets that resolve to the same visible `{blockId, offset}`.
- The winner is the logically first retained point among the coincident carets.
- If logical order cannot distinguish the retained points, keep the earlier entry id.
- Ranges should not be deduplicated merely because they overlap; overlapping ranges should be normalized/merged only for operations that require non-overlapping delete/mark spans.
- A range collapsed by resolution should become a caret, then participate in caret dedupe.

This needs a helper along these lines:

```ts
dedupeSelectionSet(state, set): RetainedSelectionSet
```

It should resolve to visible offsets, group coincident carets, choose the logical-first retained anchor, and then return retained selections against the current state.

## Command Semantics

The existing command functions should remain useful for one selection. Add multi-selection wrappers rather than rewriting each low-level command immediately.

### Insert / Typing

For `insertText` against a selection set:

1. resolve and dedupe the set;
2. sort entries in reverse document order;
3. for each entry, resolve that entry against the current working state;
4. call existing `insertText(working, selection, text, context)`;
5. collect ops and retain the returned caret against the updated working state;
6. after all entries are processed, dedupe the resulting carets.

Typing into three cursors should insert the same text at each cursor. Typing into ranges should replace each range with the typed text.

Open behavioral decision: if a set contains overlapping ranges, the implementation should either reject/normalize them before command execution or merge overlapping delete spans before inserting. Merging is safer, but it means one typed string per merged region rather than one per original selection.

### Delete / Backspace

For `deleteBackward`:

- Non-collapsed ranges should delete their selected text.
- Collapsed carets should delete the character before each caret, or join with the previous block at offset `0`.
- Execute from end to start and resolve each retained entry immediately before applying its delete.
- After deletion, each entry should collapse to the deletion point returned by the command.
- Deduplicate coincident carets after the full command.

The highest-risk case is multiple carets in the same block at adjacent offsets. Reverse-order execution avoids deleting the wrong visible character for ordinary offsets, but tests should cover it.

### Split / Enter

For `splitBlock`:

- Ranges should first delete their selected text, then split at the resulting point.
- Collapsed carets should split at each caret.
- Execute from end to start.
- Each split result should create a caret at the start of that selection's new block.
- Preserve one caret per split unless the resulting visible positions dedupe.

Multiple carets in the same original block can create multiple new blocks. Reverse-order execution should produce intuitive left-to-right text partitioning, but the resulting block order needs explicit tests.

### Paste

`pastePlainText` can use the same multi-wrapper pattern as typing, but multi-line paste across multiple selections will create many blocks. That is probably acceptable for the example. If implementation time is tight, include paste in the wrapper because the current app already exposes it through `onPaste`.

### Formatting

The task only names typing, deleting, and splitting. Formatting can be handled later or supported cheaply:

- apply `toggleMark` to every range entry;
- ignore caret entries;
- for multiple ranges, determine remove/apply per range independently or from the whole union.

Open question below: whether `Cmd+B`/`Cmd+I` must support multi-select in this task.

## UI Interaction Plan

### Normal Native Selection

Normal click/drag should continue to use the browser's selection. On mouse/key selection capture without a modifier, replace the retained set with the single DOM selection.

The active primary selection can remain native. Extra selections must be rendered manually even while the editor is active.

### Cmd/Ctrl Add Selection

Use `event.metaKey || event.ctrlKey` to support macOS and non-macOS keyboards.

For `Cmd`/`Ctrl` + drag:

- let the browser create the temporary native selection during the drag;
- on `mouseUp`, read it with `readSelectionFromDom(root)`;
- add it to the stored set instead of replacing the set;
- make it primary;
- restore the previous primary if needed, or let the new primary become native.

For `Cmd`/`Ctrl` + click:

- a click creates a collapsed native selection;
- on `mouseUp`, read the caret and append it to the set;
- make it primary.

Implementation detail: `captureSelection` currently receives no event. It should become `captureSelection(event)` and decide replace vs add from modifier state. Because `onMouseUp` has the modifier state but `onKeyUp` does not represent click-add, key capture should probably replace/update the primary native selection only.

### Triple Click Word Occurrences

Triple-click can be detected with `onMouseDown` or `onClick` using `event.detail === 3`.

Flow:

1. Detect triple click inside a block.
2. Read the clicked DOM point with a new `pointFromDom` export or an event-target helper.
3. Resolve the word at that block/offset from the current materialized text.
4. Find all exact occurrences of that word across all visible blocks.
5. Replace the selection set with ranges for every occurrence.
6. Make the clicked occurrence primary.
7. Prevent the browser's native triple-click paragraph selection from overwriting the app state.

Use `Intl.Segmenter` where practical:

- existing code already uses `segmentText` for grapheme offsets;
- word detection can use `new Intl.Segmenter(undefined, {granularity: 'word'})`;
- filter segments with `isWordLike`.

Case sensitivity is an open question. A conservative first version should match exact text. If the clicked word is `Word`, select only `Word`, not `word`.

### Rendering Active Multi-Selections

The app currently renders retained decorations only when the editor is inactive. Multi-select needs decorations while active too, because native DOM can display only the primary selection.

Recommended rendering model:

- Render native DOM selection only for the primary entry while focused.
- Render manual decorations for all non-primary entries while focused.
- Render manual decorations for all entries while inactive.
- Use separate classes/data attributes for multi-select decorations, while keeping the retained inactive classes compatible if tests already rely on them.

Rendering needs to support multiple range segments and multiple carets per block:

```ts
type BlockSelectionDecorations = {
    carets: number[];
    segments: SelectionSegment[];
};
```

`App.tsx` currently stores at most one `SelectionSegment` per block in a `Map<string, SelectionSegment>`. Change this to arrays. `renderRunNodes` should be able to add:

- zero or more caret markers at an offset;
- highlight if the current grapheme offset is inside one or more segments.

After dedupe there should not be duplicate carets at one visible offset, but ranges may overlap. Overlapping highlights can use a single class for now.

## DOM Integration

`domSelection.ts` currently keeps `pointFromDom` private. Multi-select will likely need either:

- export `pointFromDom` and `domPointForOffset`; or
- add a public `readPointFromDom(root, node, offset)` helper.

Triple-click needs to convert the click target into a block offset. JSDOM tests can use existing text nodes; browser code should handle element targets by falling back to the native selection point or `document.caretPositionFromPoint`/`caretRangeFromPoint` if needed. For this example, relying on the native selection after the click may be sufficient if the triple-click handler runs after the browser has placed a selection, but preventing the browser paragraph selection can make that unreliable. This is an implementation detail to spike.

Decorative caret elements must remain textless. Current `.retainedSelectionCaret` spans have no text content and `contentEditable = 'false'`, which is good. Range highlight wrappers contain real text and are counted by `TreeWalker`, which is also acceptable.

## Testing Recommendations

Add pure tests before DOM behavior:

- retain/resolve a selection set with multiple carets;
- add a caret and preserve deterministic primary id;
- dedupe two visible-coincident carets with different retained anchors, keeping the logical-first one;
- insert text at two carets in one block;
- insert text at carets in different blocks;
- replace two ranges with typed text;
- delete backward from two carets in the same block;
- delete two ranges without offset drift;
- split at two carets in the same block and assert resulting block order/text;
- triple-click occurrence finder returns ranges across all visible blocks and ignores archived blocks.

Add UI tests in `App.test.tsx`:

- `Cmd`/`Ctrl` + click adds a second visible caret decoration.
- `Cmd`/`Ctrl` + drag adds a visible range while preserving the primary selection.
- typing with two cursors inserts at both positions.
- Backspace with two cursors deletes the intended characters.
- Enter with two cursors creates the expected blocks.
- triple-clicking a word highlights all exact occurrences across blocks.
- coincident carets render only one caret marker.

JSDOM does not provide reliable layout geometry, so continue asserting with `data-*` attributes/classes such as `data-retained-selection="caret"` or a new `data-selection-entry-id`.

## Risks

- Native DOM selection is single-range in most browsers. Multi-selection must be state-driven and manually rendered.
- Modifier click may race with normal selection capture. `mouseUp` handling should be explicit about add vs replace.
- Triple-click browser defaults vary by browser and can select a word, line, or paragraph. Tests should target the app's explicit handler rather than browser default semantics.
- Overlapping ranges can cause double-delete or invalid replacement if not normalized before command execution.
- Multiple carets in the same block are offset-sensitive. Reverse-order execution and re-resolving retained anchors before each step are both important.
- Splitting multiple carets in one block is the most complex editing operation because each split changes block topology.
- Retained-anchor logical ordering around tombstones must be deterministic or dedupe will flicker.
- Manual decorations inside `contenteditable` can perturb DOM selection offset calculations if marker nodes contain text.

## Open Questions

- Should multi-select additions use `Cmd` only, or should `Ctrl` be treated equivalently for Windows/Linux? Recommendation: support both with `event.metaKey || event.ctrlKey`.
- Is triple-click word matching case-sensitive? Recommendation: exact case-sensitive match for the first version.
- What counts as a word? Recommendation: use `Intl.Segmenter` word segmentation and require `isWordLike`.
- If selected ranges overlap, should they be merged, or should later-added ranges win? Recommendation: merge overlapping ranges for destructive operations.
- For typing into overlapping ranges, should inserted text appear once per merged range or once per original range? Recommendation: once per merged range.
- Should `Cmd+B` and `Cmd+I` apply to all selected ranges, or remain primary-selection only in this task?
- After adding a cursor/range, should the newly-added entry always become primary? Recommendation: yes.
- When triple-click selects all occurrences, should the clicked occurrence become primary even if it is not the first occurrence in document order? Recommendation: yes.
- Should occurrence search include formatted text across mark-run boundaries? Recommendation: yes, use block plain text from the materialized runs or `blockContents`.
- Should occurrence search include archived/joined blocks? Recommendation: no, visible blocks only.
