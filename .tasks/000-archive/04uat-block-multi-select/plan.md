# Plan: Block Rich Text Multi-Select

## Goal

Extend `examples/block-rich-text` from one retained selection per editor to a retained selection set.

Supported behavior:

- `Cmd`/`Ctrl` + click adds a cursor.
- `Cmd`/`Ctrl` + click-drag adds a range.
- Triple-clicking a word selects all exact, case-sensitive occurrences of that word across visible blocks.
- Typing, Backspace, Enter/split, paste, `Cmd+B`, and `Cmd+I` apply to all applicable selections.
- Overlapping ranges are merged for destructive/replacement operations.
- Typing into overlapping ranges inserts once per merged range.
- Coincident visible cursors deduplicate, with the logically first retained cursor winning.
- Newly-added selections become primary.
- For triple-click occurrence selection, the clicked occurrence becomes primary.

This plan assumes the selection-retention work in `.tasks/260606-2138-block-presence` is complete and `Replica.selection` currently stores a retained single selection.

## Phase 1: Selection Set Model

Add selection-set types and helpers, probably in `examples/block-rich-text/src/retainedSelection.ts` or a new adjacent `selectionSet.ts`.

Types:

```ts
type RetainedSelectionEntry = {
    id: string;
    selection: RetainedSelection;
};

type RetainedSelectionSet = {
    primaryId: string;
    entries: RetainedSelectionEntry[];
};

type EditorSelectionEntry = {
    id: string;
    selection: EditorSelection;
};

type EditorSelectionSet = {
    primaryId: string;
    entries: EditorSelectionEntry[];
};
```

Helpers:

- `initialRetainedSelectionSet(state): RetainedSelectionSet`
- `singleRetainedSelectionSet(selection, id?): RetainedSelectionSet`
- `retainSelectionSet(state, resolvedSet): RetainedSelectionSet`
- `resolveSelectionSet(state, retainedSet): EditorSelectionSet`
- `primarySelection(set): EditorSelection`
- `replacePrimarySelection(state, retainedSet, selection): RetainedSelectionSet`
- `appendSelection(state, retainedSet, selection): RetainedSelectionSet`

Entry ids can be deterministic local strings such as `sel-${counter}`. The counter can live in `BlockEditor` state or derive from `Replica.clock`; keep it local and serializable.

Refactor runtime state:

- change `Replica.selection` from `RetainedSelection` to `RetainedSelectionSet`;
- change `LocalChange.selection` to `RetainedSelectionSet`;
- initialize replicas with `initialRetainedSelectionSet(state)`;
- leave remote op application as retained-state-preserving.

Keep existing single-selection helpers available for low-level commands and retained-selection tests.

## Phase 2: Ordering, Merging, And Dedupe

Add pure helpers for document order and normalized command input.

Ordering helpers:

- compute visible block order with `rootBlockIds(state)`;
- compute historical/logical character order with `rootBlockIds(state, true)` and `orderedCharIdsForBlock(state, blockId)`;
- compare visible points by block index, then offset;
- compare retained points by logical block/char traversal, affinity, then entry id.

Dedupe helpers:

- `dedupeSelectionSet(state, set): RetainedSelectionSet`
- resolve all entries to visible offset selections;
- convert collapsed ranges to carets;
- group carets by visible `{blockId, offset}`;
- pick the logically first retained point in each group;
- preserve ranges except where command-specific merging is requested;
- ensure `primaryId` still points to a surviving entry, preferring the previous primary when possible.

Merge helpers for command execution:

- `mergeOverlappingRanges(state, entries): EditorSelectionEntry[]`
- merge overlapping or touching range spans for destructive/replacement operations;
- keep non-overlapping carets separate;
- preserve direction only where the UI needs it, since command execution mostly needs normalized ranges.

Tests for this phase should cover:

- retaining/resolving multiple selections;
- primary id preservation;
- caret dedupe with two retained anchors resolving to the same visible point;
- overlap merging across one block and across blocks;
- visible-block-only ordering for rendered selections.

## Phase 3: Multi-Command Wrappers

Keep `blockCommands.ts` single-selection functions as the primitive command API. Add wrappers that accept a retained selection set and return a retained selection set.

Possible module: `examples/block-rich-text/src/multiSelectionCommands.ts`.

Common wrapper shape:

```ts
type MultiCommandResult = {
    state: CachedState;
    ops: Op[];
    selection: RetainedSelectionSet;
};
```

For typing and paste:

- dedupe the retained set;
- resolve and merge overlapping ranges;
- sort entries in reverse visible document order;
- resolve each retained entry against the current working state before applying it;
- call `insertText` or `pastePlainText`;
- retain each returned caret against the updated state;
- dedupe final carets.

For Backspace:

- dedupe the retained set;
- merge overlapping ranges first;
- execute from document end to start;
- call existing `deleteBackward` per entry;
- retain returned carets;
- dedupe final carets.

For Enter/split:

- dedupe the retained set;
- merge overlapping ranges first so selected text is deleted once;
- execute from document end to start;
- call existing `splitBlock` per entry;
- retain returned carets at the starts of the new blocks;
- dedupe final carets.

For formatting:

- apply `toggleMark` to all range entries;
- ignore caret entries;
- support `Cmd+B`, `Cmd+I`, and toolbar buttons across all selected ranges;
- decide apply/remove per range independently, matching current single-selection semantics;
- preserve the selection set after formatting, retained against the final state.

Tests for this phase:

- insert at two carets in one block;
- insert at carets in different blocks;
- replace two ranges with typed text;
- overlapping ranges receive one inserted string after merge;
- Backspace at adjacent same-block carets deletes the intended characters;
- Backspace deletes multiple ranges without offset drift;
- Enter at two carets in one block creates expected block order and returned carets;
- `Cmd+B`/`Cmd+I` marks all selected ranges and ignores carets.

## Phase 4: App Runtime Integration

Update `App.tsx` command flow to work with sets.

Refactor:

- `resolvedSelection` becomes `resolvedSelectionSet`;
- command handlers call multi-command wrappers;
- `liveSelection` becomes `liveSelectionSet`, using the native DOM selection to update/replace only the primary entry when focused;
- `captureSelection` replaces the whole set for ordinary selection changes;
- `captureSelection` appends a new entry when `event.metaKey || event.ctrlKey`;
- local no-op selection updates store a retained selection set.

DOM restore:

- restore only the primary selection to the native DOM;
- continue using existing `restoreSelectionToDom`/`restoreCaretToDom` for that primary selection;
- render all non-primary selections manually while focused;
- render all selections manually while inactive.

Focus behavior:

- keep existing panel focus tracking;
- toolbar `onMouseDown.preventDefault()` should continue preserving focus and native selection;
- ensure key-up selection capture updates the primary selection only, not the full multi-set.

## Phase 5: Triple-Click Occurrence Selection

Add word occurrence detection as pure helpers plus UI integration.

Pure helpers:

- `wordAtPoint(state, point): {text: string; range: EditorSelection} | null`
- `findWordOccurrences(state, word): EditorSelection[]`
- use `Intl.Segmenter(undefined, {granularity: 'word'})`;
- require `segment.isWordLike`;
- match exact case-sensitive text;
- search visible blocks only;
- search across formatted run boundaries by using block plain text from `blockContents` or materialized runs.

UI flow:

- detect triple-click with `event.detail === 3`;
- convert the clicked DOM location to a `BlockPoint`;
- build occurrence ranges;
- replace the full selection set with occurrence ranges;
- make the clicked occurrence primary;
- prevent browser triple-click selection from overwriting the app state.

DOM helper changes:

- export a focused public helper from `domSelection.ts`, such as `readPointFromDom(root, node, offset)`;
- avoid exposing more DOM internals than needed;
- keep decorative caret spans textless so offset scanning remains correct.

Tests:

- word occurrence helper finds all exact matches across visible blocks;
- case-sensitive matching does not select different-case words;
- helper spans formatted run boundaries;
- archived/joined blocks are ignored;
- triple-click UI renders all occurrences and sets the clicked one as primary.

## Phase 6: Rendering Multi-Selection Decorations

Replace the current one-segment/one-caret decoration model with per-block arrays.

New render model:

```ts
type BlockSelectionDecorations = {
    carets: Array<{id: string; offset: number; primary: boolean}>;
    segments: Array<{
        id: string;
        startOffset: number;
        endOffset: number;
        primary: boolean;
    }>;
};
```

Rendering rules:

- while focused, native DOM displays the primary selection;
- while focused, manual decorations display non-primary entries;
- while inactive, manual decorations display all entries;
- overlapping range highlights use one visual style for now;
- deduped coincident carets render one marker;
- marker nodes contain no text and stay `contentEditable=false`;
- add stable `data-*` attributes for tests, e.g. `data-selection-entry-id` and `data-retained-selection`.

Update `renderRunNodes`:

- insert zero or more caret markers at each grapheme offset;
- apply highlight class if the grapheme falls inside any segment;
- keep mark classes (`markBold`, `markItalic`) on text spans;
- update serialization so DOM rerendering notices decoration changes.

CSS:

- reuse `.retainedSelectionHighlight` and `.retainedSelectionCaret` where possible;
- add a secondary active-multi style only if primary/non-primary distinction is visually unclear.

## Phase 7: DOM Behavior Tests

Extend `examples/block-rich-text/src/App.test.tsx`.

Add tests for:

- ordinary click/drag replaces previous multi-selection with one selection;
- `Cmd`/`Ctrl` + click adds a second caret decoration;
- `Cmd`/`Ctrl` + drag adds a range decoration;
- newly-added selection becomes primary;
- typing with two cursors inserts at both positions;
- typing with overlapping ranges inserts once per merged range;
- Backspace with two cursors deletes intended characters;
- Enter with two cursors creates expected blocks;
- toolbar Bold and `Cmd+B` apply to all ranges;
- triple-clicking a word highlights all exact occurrences across blocks;
- coincident carets render as one caret marker;
- inactive editors still show their full retained selection set after sync.

Prefer assertions on explicit classes and `data-*` attributes. Do not assert geometry.

## Phase 8: Verification

Run focused tests first:

```sh
npm exec vitest examples/block-rich-text/src/retainedSelection.test.ts
npm exec vitest examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest examples/block-rich-text/src/App.test.tsx
```

Add and run any new focused files:

```sh
npm exec vitest examples/block-rich-text/src/selectionSet.test.ts
npm exec vitest examples/block-rich-text/src/multiSelectionCommands.test.ts
```

Then run the example typecheck:

```sh
tsc -p examples/block-rich-text/tsconfig.json --noEmit
```

If project scripts are available and not too broad, also run:

```sh
npm run typecheck:examples
```

## Notes For Implementation

- Keep stored selection state retained/anchored only; offsets are still boundary data for DOM and command calls.
- Keep command wrappers pure and testable before touching React event handling.
- Do not let manual decoration nodes contribute text to DOM selection offsets.
- Re-resolve retained entries against the current working state before each command step.
- Preserve existing single-selection tests; they are regression coverage for the primitives used by multi-select.
- The implementation should not add remote presence or actor-colored selections.
