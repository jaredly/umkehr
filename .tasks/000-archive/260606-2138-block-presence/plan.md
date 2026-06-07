# Plan: Block Rich Text Selection Retention

## Goal

Make `examples/block-rich-text` retain each editor's current selection as a CRDT-anchored selection, and display that selection when the editor is inactive.

The stored selection state should not be offset based. Offsets should exist only at the DOM and command boundaries:

- DOM capture resolves DOM points to rendered offsets, then immediately converts to retained anchors.
- Commands resolve retained anchors to current rendered offsets just before execution.
- DOM restore and inactive selection rendering resolve retained anchors to current rendered offsets just before drawing.
- Replica state and any future presence payloads store retained anchors only.

## Phase 1: Retained Selection Model

Add a focused retained-selection module, probably `examples/block-rich-text/src/retainedSelection.ts`, or extend `selectionModel.ts` if the code stays small.

Define retained selection types:

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

Use the decisions from `research.md`:

- caret at offset `0` anchors after the block boundary;
- deleted characters remain valid anchors because tombstoned characters retain a logical position;
- inline span decorations are sufficient for inactive display;
- keep the API shape compatible with future remote presence, but do not implement cross-session presence now.

Implement pure conversion helpers:

- `retainPoint(state, point: BlockPoint): RetainedPoint`
- `retainSelection(state, selection: EditorSelection): RetainedSelection`
- `resolvePoint(state, point: RetainedPoint): BlockPoint`
- `resolveSelection(state, selection: RetainedSelection): EditorSelection`
- `initialRetainedSelection(state): RetainedSelection`

Resolution should scan current CRDT order rather than maintain an index. The example documents are small, and scanning is easier to test.

Resolution rules:

- If `charId` is visible, resolve before/after that visible character in the block where it currently renders.
- If `charId` is tombstoned, resolve to the logical position it would occupy in traversal order, with visible offset based on visible characters before it.
- If `charId` is `null`, resolve to offset `0` in `blockId` when that block is still visible.
- If the block is archived or missing, fall back through visible character anchors first, then the first visible root block.

## Phase 2: Runtime State Refactor

Refactor `Replica.selection` from `EditorSelection` to `RetainedSelection`.

Update runtime types in `blockEditorRuntime.ts`:

- `Replica.selection: RetainedSelection`
- `LocalChange.selection: RetainedSelection`
- `createReplica` initializes with `initialRetainedSelection(state)`.
- `applyRemoteOps` applies remote ops and keeps the same retained selection, without offset clamping.

Add runtime helpers where useful:

- `resolvedSelection(replica): EditorSelection`
- `resolveReplicaSelection(replica.state, replica.selection)` at call sites

Update local command flow in `App.tsx`:

- `captureSelection` reads an offset selection from the DOM and stores `retainSelection(replica.state, offsetSelection)`.
- `liveSelection` returns an offset `EditorSelection` for command execution by resolving the retained selection, using live DOM selection when present.
- `runEditCommand` accepts offset selections for existing command helpers, then converts the command result selection back to retained anchors against `result.state`.
- Pending DOM restore refs can continue to hold offset selections because they are short-lived render-boundary state.

Avoid storing both retained and offset selections on `Replica`; that would introduce two sources of truth.

## Phase 3: Retention Correctness Tests

Add pure tests before changing UI rendering deeply.

Good location options:

- `examples/block-rich-text/src/retainedSelection.test.ts`
- or append a focused `describe` block to `blockCommands.test.ts` if keeping test count small matters.

Cover:

- caret at offset `0` retains as after block boundary and resolves to offset `0`;
- caret after `b` in `abc` resolves back to offset `2`;
- caret after `b` in `abc` resolves to offset `3` after another actor inserts at the start;
- caret anchored to a deleted `b` still resolves to the logical tombstone position;
- range over `bc` shifts when text is inserted before it;
- selection inside a moved block follows that block after `block:move`;
- selection in the right side of a split follows moved characters into the new block;
- selection in a joined right block resolves inside the surviving left block.

These tests should assert retained-anchor behavior directly, not DOM behavior.

## Phase 4: Inactive Selection Rendering

Add focus tracking to `BlockEditor`.

Behavior:

- Active editor uses native DOM selection only.
- Inactive editor renders retained selection decorations from `resolveSelection(replica.state, replica.selection)`.
- Focus transitions within an editor panel should not count as blur.
- Toolbar mouse-down prevention should keep working.

Use inline rendering inside `EditableBlock`:

- pass `inactiveSelection` or a per-block selection decoration model into each block;
- compute block-local selected segments with `normalizeSelectionSegments`;
- split formatted runs by grapheme offsets using `segmentText`;
- wrap selected pieces with `.retainedSelectionHighlight`;
- insert a zero-width `.retainedSelectionCaret` element at collapsed caret offsets;
- ensure marker elements contain no text that would be counted by `readSelectionFromDom`.

CSS additions in `style.css`:

- subdued highlight color;
- visible caret marker;
- pointer-events disabled for decoration spans where appropriate.

Keep one selection style for now. Do not distinguish actor colors in this phase.

## Phase 5: DOM Integration Tests

Extend `App.test.tsx` with behavior-level tests:

- selecting/careting in Editor B and then focusing Editor A shows B's inactive caret;
- selecting a range in Editor B and then focusing Editor A shows B's inactive highlight;
- after Editor A inserts before Editor B's inactive caret, B's displayed caret resolves at the retained logical position;
- offline/queued edits flush into the inactive editor while its selection still resolves correctly.

Prefer assertions against explicit decoration classes or `data-*` attributes rather than layout rectangles. JSDOM does not provide reliable geometry.

## Phase 6: Verification

Run focused checks:

```sh
npm exec vitest examples/block-rich-text/src/retainedSelection.test.ts
npm exec vitest examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx
```

Then run the example typecheck if the focused tests pass:

```sh
npm run typecheck:examples
```

If typecheck is too broad or slow, at minimum run:

```sh
tsc -p examples/block-rich-text/tsconfig.json --noEmit
```

## Follow-Up Work

This task should leave a clear path for remote presence but not implement it.

Future-friendly choices:

- keep `RetainedSelection` serializable;
- avoid DOM nodes or transient offsets in stored selection state;
- keep conversion helpers independent from React;
- keep display styling actor-agnostic now, but allow color to be passed in later.

Possible later extraction:

- move retained-selection helpers into an editor-focused package if more examples need them;
- expose a public block selection API from `block-crdt` only after the model stabilizes.
