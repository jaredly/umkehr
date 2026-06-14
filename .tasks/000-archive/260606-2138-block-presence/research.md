# Research: Block Rich Text Selection Retention

## Goal

Update `examples/block-rich-text` so each side-by-side editor retains and displays its most recent selection while it is inactive. The visual should make the CRDT's selection-retention behavior visible: when Editor A is focused, Editor B can still show its last caret/range, and vice versa.

The important correctness requirement is not just drawing a stale offset. The retained selection should remain meaningful after concurrent inserts, deletes, splits, joins, and block moves arrive from the other replica.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/utils.ts`
- `src/block-crdt/types.ts`

The example already stores a selection per replica:

```ts
type Replica = {
    selection: EditorSelection;
    // ...
};
```

`EditorSelection` is currently offset based:

```ts
type BlockPoint = {blockId: string; offset: number};
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};
```

The UI captures the live DOM selection on `mouseUp` and `keyUp` with `readSelectionFromDom(root)`, stores it via a no-op local command, and uses `liveSelection(current)` before edit commands. Local edit commands return the next offset-based selection, and the active editor restores the DOM selection after React rerenders.

Remote ops flow through `applyRemoteOps` in `blockEditorRuntime.ts`:

```ts
const state = applyMany(replica.state, ops);
return {...replica, state, selection: clampSelection(state, replica.selection)};
```

This only clamps offsets into valid bounds. It does not adjust the selection for inserted or deleted text before the selection.

## Current Gap

Offset clamping is not selection retention.

Example failure case:

1. Both replicas contain `abc`.
2. Editor B's stored caret is `{blockId, offset: 2}` between `b` and `c`.
3. Editor A inserts `X` at offset `0` and syncs to B.
4. The text becomes `Xabc`.
5. B's retained caret should still be between `b` and `c`, now offset `3`.
6. Current code keeps offset `2`, which moves the caret to between `a` and `b`.

Deletes have a similar issue. If a retained selection points after text that is deleted remotely, the logical location should resolve to the nearest surviving neighbor rather than staying at the same numeric offset.

Block structure changes also matter:

- `block:move` should not affect a selection inside the moved block, because the block id is stable.
- `split` can move the right side of a block into a newly-created block. A selection anchored to moved characters should follow those characters into the new block.
- `join` archives the right block and moves its contents into the left block. A selection anchored to joined text should resolve inside the left block, not clamp to an archived block or the first visible block.

## CRDT Primitives Available

`block-crdt` already exposes enough stable identifiers to model retained selections correctly in the example layer:

- Blocks have stable Lamport ids, rendered as strings with `lamportToString`.
- Characters have stable Lamport ids and are retained as tombstones when deleted.
- `orderedCharIdsForBlock(state, blockId, {visibleOnly: true})` returns the current visible character order for a block.
- `orderedCharIdsForBlock(state, blockId)` returns visible plus deleted character ids in traversal order.
- `selPos(state, block, offset)` maps a visible offset to the Lamport id immediately before the insertion position.
- `rootBlockIds(state, includeArchived)` can include archived blocks when resolving historical anchors.
- `applyMany` preserves character ids through concurrent insert/delete/move operations.

There is no reusable public selection-anchor type today. That is fine for this task: the block-rich-text example can introduce an example-local retained-selection model and keep the public block CRDT unchanged.

## Recommended Model

Keep `EditorSelection` as the UI/command shape, but add a retained/anchored representation for selections stored on each `Replica`.

Suggested types:

```ts
type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};

type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};
```

Interpretation:

- `charId: null` means the block boundary, usually offset `0` in an empty block or before the first visible char.
- `affinity: 'after'` means the point is after `charId`; this is the natural caret representation for an offset produced by typing.
- `affinity: 'before'` is useful for range starts and for preserving a point before a specific character when inserts race at that boundary.
- `blockId` is retained as a fallback and for empty-block carets.

A simpler initial version can use only `{blockId, afterCharId}` for carets, but explicit affinity will make range behavior and boundary cases easier to reason about.

## Conversion Functions

Add pure helpers in `selectionModel.ts` or a new focused module such as `retainedSelection.ts`.

### UI Offset To Retained Point

Convert the DOM/command `BlockPoint` to a retained point against the current state:

- Get visible char ids for `point.blockId`.
- If `offset <= 0`, use `{blockId, charId: null, affinity: 'after'}` or `{charId: firstChar, affinity: 'before'}` depending on the desired boundary behavior.
- If `offset > 0`, use the visible char at `offset - 1` with `affinity: 'after'`.
- Clamp offsets before conversion.

For a selected range, preserve anchor/focus direction by converting each endpoint independently.

### Retained Point To UI Offset

Resolve retained points after any state change:

1. If `charId` is visible, find the block that currently contains it and return the before/after offset based on affinity.
2. If `charId` exists but is deleted, walk the current materialized order to find the nearest surviving position around the tombstone.
3. If the original block still exists and is visible but no character anchor resolves, clamp to that block boundary.
4. If the block was archived by join, look for visible characters formerly in that block that now resolve through the joined tree; otherwise fall back to the nearest visible root block.

The first version can use a scan over `rootBlockIds(state, true)` and `orderedCharIdsForBlock(state, blockId)` to find the anchor and surrounding visible characters. The example documents are small, so an O(blocks * chars) resolver is acceptable and easier to verify than maintaining an index.

### Store Both Forms Or One Form

Preferred: store retained selections on `Replica`, derive offset selections for commands/rendering as needed.

Pragmatic migration path:

```ts
type Replica = {
    selection: EditorSelection;          // resolved offset selection for existing commands
    retainedSelection: RetainedSelection; // source of truth across remote ops
};
```

Then:

- On local DOM selection capture, update both fields by converting offset -> retained.
- On local command result, update both fields from the result selection and new state.
- On remote ops, apply ops, then resolve `retainedSelection` against the new state to produce `selection`.
- If resolving fails badly, rebuild `retainedSelection` from the clamped `selection` to keep the app usable.

Longer term, `selection` can become derived-only, but dual fields keep the example changes smaller.

## Rendering Inactive Selections

The active editor should continue using the native DOM selection. Inactive editors should render a non-interactive overlay based on their stored resolved selection.

Recommended UI behavior:

- Track focus per `BlockEditor` with local React state: `hasFocus` from focus/blur events on the editor root, using `event.currentTarget.contains(event.relatedTarget)` to ignore focus moves within the panel.
- Only show retained selection decorations when `!hasFocus`.
- For collapsed carets, render a small vertical caret in the relevant block at the resolved offset.
- For ranges, render highlights over the selected offsets. Multi-block ranges can reuse `normalizeSelectionSegments(state, selection)`.

Implementation options:

1. Inline span splitting in `EditableBlock`.
   - Render runs with extra wrappers that split text by selection segment boundaries.
   - This is deterministic and test-friendly.
   - It requires combining mark-run boundaries and selection boundaries.

2. Absolutely positioned overlay from DOM ranges.
   - After render, use `domPointForOffset`-style helpers and `Range.getClientRects()` to draw carets/highlights.
   - This handles marked text and wrapping naturally in real browsers.
   - It is harder to test in jsdom because layout rects are not real.

For this example, inline splitting is probably the better first implementation. It avoids layout measurement, works in unit tests, and the block editor already manually renders text spans from `block.runs`.

A lightweight rendering plan:

- Pass `inactiveSelection={hasFocus ? null : replica.selection}` to each block.
- For each block, compute the segment for that block.
- Split each formatted run into grapheme pieces with absolute offsets.
- Wrap selected text pieces with `.retainedSelectionHighlight`.
- If a caret falls at a given offset, insert a zero-width `.retainedSelectionCaret` marker before the matching grapheme, or at the end of the block.
- Set overlay spans/content to `contentEditable={false}` if needed, and ensure they do not affect text extraction or DOM selection mapping.

Important DOM selection concern: if caret/highlight marker elements are rendered inside the `contenteditable`, `pointFromDom` and text-length calculations must ignore their marker text. The safest approach is for caret markers to have no text content and for highlight wrappers to contain the actual text. Avoid pseudo text or visible placeholder characters inside the editable tree.

## Command And Runtime Changes

Expected code changes:

- Add retained selection types and conversion helpers.
- Extend `Replica` with `retainedSelection` or replace `selection` with a retained source of truth plus a resolver.
- Update `createReplica` to initialize both forms at the first block start.
- Update `applyLocalChange` to accept enough information to update retained selection after local commands.
- Update `applyRemoteOps` to resolve retained selections against the post-remote state instead of only clamping offsets.
- Update `captureSelection` to derive retained anchors from the captured DOM selection and current replica state.
- Add focus tracking in `BlockEditor` and render inactive decorations.
- Keep active DOM restore paths unchanged except where they read the resolved `selection`.

One detail to avoid: `makeCommandContext(replica)` mutates `replica.clock++` inside a React state updater. This preexisting pattern works in this example, but selection-retention tests should avoid depending on clock side effects beyond operation ids.

## Testing Recommendations

Add focused pure tests first. They should not need DOM:

- converting caret at offset `2` in `abc` retains after char `b` and resolves back to offset `2`;
- retained caret after `b` resolves to offset `3` after a concurrent insert at block start;
- retained caret after `b` resolves to the nearest sane offset after `b` is deleted;
- retained range over `bc` expands/shifts correctly after an insert before it;
- retained selection inside a moved block follows the block after `block:move`;
- retained selection in the right side of a split follows the moved characters into the new block;
- retained selection in a joined block resolves into the surviving left block.

Then add UI tests in `App.test.tsx`:

- focusing Editor A hides A's retained decoration and shows B's last caret/range;
- selecting text in B, then focusing A, displays B's range highlight;
- after A inserts text before B's inactive caret, B's displayed caret shifts to the retained logical location;
- after offline edits flush, the inactive selection still resolves correctly.

JSDOM may not give useful layout assertions, another reason to prefer inline selection spans for the first implementation.

## Risks

- Resolving anchors around deleted characters can get subtle. Define a deterministic fallback policy before implementation.
- Split/join behavior is the highest-risk part because block ids can change/archive while character ids remain the better anchor.
- Marker spans inside `contenteditable` can interfere with DOM selection offsets if they contain text or are counted by `TreeWalker`.
- Multi-block selections need anchor/focus direction preserved; using only normalized segments loses direction and can affect subsequent shift-selection semantics.
- `Intl.Segmenter` is already used by the example, so splitting text for highlights should use the same grapheme segmentation to avoid offset drift.
- Native focus/blur handling can briefly hide/show decorations while toolbar buttons are clicked. The toolbar already prevents mouse-down focus theft; keep that behavior.

## Open Questions

- What exact boundary affinity do we want for a collapsed caret at offset `0`: before the first visible char, or after the block boundary? This determines whether concurrent inserts at the beginning appear before or after the retained caret.
    - let's go with after block boundary
- For a caret whose anchor character is deleted, should the caret prefer the previous surviving character, the next surviving character, or preserve the original side via affinity?
    - it can stay anchored to the deleted character. the CRDT retains characters with tombstones, so there is always a "logical position" where the character would be if it were rendered, and the caret can go there.
- Should inactive selection decorations be editor-local only, or should they later become remote presence data shared across browser sessions?
    - we should set things up so that remote presence data is easy to do in the future
- How polished should the inactive range rendering be for wrapped multi-line text? Inline spans are robust for tests but do not produce a single continuous browser-like highlight shape.
    - inline spans are fine
- Should the retained-selection helpers live only in the example, or should `block-crdt` eventually expose a reusable anchor/selection API?
    - not sure yet. might have them in an editor-focused separate package
- Do we need to distinguish the inactive editor's retained selection color by actor, or is one subdued local style enough for this two-editor demo?
    - one is enough for now
