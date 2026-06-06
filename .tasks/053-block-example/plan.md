# Plan: Block Rich Text UI Example

## Scope

Create a small standalone React/Vite example for `src/block-crdt` that shows two flat block editors
side-by-side, synced through operation exchange.

Required editing behavior:

- type text
- delete text with ordinary Backspace
- split blocks with Enter
- join with the previous block on Backspace at the start of a block
- paste plain text, splitting pasted newlines into blocks
- apply and remove bold/italic formatting with toolbar toggles
- apply formatting across multiple selected blocks by emitting one mark per affected block
- drag root blocks to reorder using pointer events and an explicit drag handle
- preserve each editor's local selection across local and remote/concurrent updates
- support an offline toggle that queues changes and flushes them when the editor goes online

Keep block structure flat. Do not implement nested block editing.

## Phase 1: Standalone Example Scaffold

Add a new standalone example directory, likely `examples/block-rich-text`.

Suggested files:

- `examples/block-rich-text/package.json`
- `examples/block-rich-text/index.html`
- `examples/block-rich-text/tsconfig.json`
- `examples/block-rich-text/vite.config.ts`
- `examples/block-rich-text/src/main.tsx`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`

Use the simpler `examples/react` Vite structure as the starting point. The example can import
`src/block-crdt` through TypeScript path aliases, because `block-crdt` is not currently exported from
the package's public `exports` map.

Recommended `tsconfig` path alias:

```json
"paths": {
    "umkehr/block-crdt": ["../../src/block-crdt/index.ts"],
    "umkehr/block-crdt/*": ["../../src/block-crdt/*"]
}
```

Also add the example to the root `typecheck:examples` script after it compiles cleanly.

Completion criteria:

- `npm run build` works inside `examples/block-rich-text`.
- The example starts under Vite and renders a static two-editor shell.

## Phase 2: CRDT Document Runtime

Build a small runtime wrapper around `CachedState` and `Op` before wiring `contenteditable`.

Suggested files:

- `src/blockEditorRuntime.ts`
- `src/blockCommands.ts`
- `src/selectionModel.ts`

Runtime responsibilities:

- initialize two editor replicas from the same `initialState(actor, ts)`
- own an actor ID per editor, for example `left` and `right`
- generate monotonic HLC-like timestamp strings per actor
- generate Lamport IDs for marks and LSEQ moves using `state.state.maxSeenCount + 1`
- apply local ops to the source editor immediately
- deliver local ops to the peer when online
- queue outbound ops while offline
- flush queued ops in order when the editor comes back online
- tolerate idempotent duplicate delivery

The sync layer can be intentionally simple and in-memory. It does not need network transport,
persistence, or op compaction.

Include debug affordances:

- per-editor online/offline toggle
- queued op count
- optional current block/order summary or serialized state panel

Completion criteria:

- Applying an op batch in editor A updates editor A immediately.
- When editor A is online, editor B receives the same op batch.
- When editor A is offline, editor B does not receive changes until A goes online again.
- Re-delivery of an already applied batch does not corrupt state.

## Phase 3: Command Adapter

Implement pure-ish command helpers that translate editor intent into block CRDT ops/state updates.
Keep these separate from DOM code so they can be unit tested.

Commands to implement:

- `insertText(editor, selection, text)`
- `deleteBackward(editor, selection)`
- `splitBlock(editor, selection)`
- `joinWithPrevious(editor, blockId)`
- `pastePlainText(editor, selection, text)`
- `toggleMark(editor, selection, 'bold' | 'italic')`
- `moveBlock(editor, movedBlockId, target)`

Important details:

- Use `selPos` for caret-to-Lamport insertion anchors.
- For Enter:
  - offset `0`: create an empty block before the current block.
  - middle: split at the current character and previous character.
  - end: create an empty block after the current block.
- For ordinary Backspace:
  - collapsed selection within a block deletes the previous visible character with `char:delete`.
  - collapsed selection at offset `0` joins with the previous visible root block.
  - non-collapsed selection deletes each selected visible character, across blocks if needed.
- For paste:
  - normalize to plain text.
  - split on newlines.
  - insert the first segment at the current selection.
  - use `split` to create subsequent blocks, then insert each following segment.
- For drag move:
  - calculate destination neighbors in root block order after removing the moved block.
  - create a `block:move` op with parent `[0, 'root']`.
  - use `createLseqIdBetween` for the new order index.

Completion criteria:

- Unit tests cover each command without relying on DOM selection.
- Cache invariants still hold after each command by comparing to `organizeState`.

## Phase 4: Selection Model

Define editor selection in block/grapheme coordinates and use it as the boundary between DOM and the
CRDT.

Suggested model:

```ts
type BlockPoint = {blockId: string; offset: number};

type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};
```

Needed helpers:

- normalize a range into ordered block segments
- clamp points after local or remote changes
- find visible text length for a block
- map DOM selection to `EditorSelection`
- restore DOM selection from `EditorSelection`
- count grapheme offsets within formatted run spans

Selection preservation rules:

- Local editor commands should produce an explicit next selection.
- Remote ops should preserve the local selection by block ID and offset when possible.
- If a selected block is archived by a remote join, move the selection to the surviving visible block
  at the nearest meaningful offset.
- If selected characters are deleted remotely, clamp to the nearest remaining offset.

Completion criteria:

- Selection survives React re-render after typing, formatting, split, join, and remote delivery.
- Empty blocks can receive and display a caret without storing placeholder text in the CRDT.

## Phase 5: Editor UI

Build the actual editor components.

Suggested files:

- `src/BlockRichTextDemo.tsx`
- `src/BlockEditor.tsx`
- `src/EditableBlock.tsx`
- `src/Toolbar.tsx`
- `src/useBlockReorder.ts`

UI structure:

- two equal-width editors side-by-side on desktop
- stacked editors on narrow screens
- each editor has a compact toolbar with bold and italic icon/text buttons
- each editor has an online/offline toggle and queued-op count
- each block row has an explicit drag handle beside the editable text
- blocks render from `materializeFormattedBlocks(state)`

Interaction handling:

- use `beforeinput` for text insertion, paste, and browser edit prevention where reliable
- use `keydown` for Enter and Backspace behavior
- use `selectionchange`, `beforeinput` target ranges where available, and focus/blur events to keep
  the selection model current
- render formatting runs as spans or semantic inline elements
- avoid making the whole block draggable; only the handle starts pointer drag

Completion criteria:

- The user can perform the full requested workflow in either editor.
- Text selection inside a block is not disrupted by the drag handle.
- The UI remains usable with empty blocks, formatted runs, and multi-block documents.

## Phase 6: Multi-Block Formatting and Toggle Behavior

Implement formatting commands after the selection pipeline is stable.

Rules:

- Collapsed selection: toggle a stored typing state for that editor if desired, or no-op for v1 if
  typing-state marks are not implemented.
- Single-block range: emit one `markRange` op.
- Multi-block range: emit one mark op per selected block segment.
- Toggle on/off:
  - inspect the selected visible characters' resolved marks from `materializeFormattedBlocks`.
  - if every selected character already has the mark, emit remove marks for each segment.
  - otherwise emit add marks for each segment.
- Do not use one cross-block `markOp` for v1; per-block marks make UI behavior clearer and avoid
  manually managing `crossedSplits` in the editor layer.

Completion criteria:

- Bold and italic can be applied independently.
- Applying the same toolbar action again removes that mark from the selected range.
- Multi-block selection emits multiple marks and renders correctly in both synced editors.

## Phase 7: Offline and Concurrent Editing Scenarios

Use the side-by-side demo to exercise CRDT behavior.

Scenarios to support manually and in tests where practical:

- editor A goes offline, types text, editor B types concurrent text, then A reconnects
- both editors split near the same position while one is offline
- one editor formats a range while the other splits or joins blocks
- one editor reorders blocks while the other edits text inside moved blocks
- one editor joins a block while the other has a selection in the joined-away block

The runtime should be deterministic enough for tests by using stable actor IDs and timestamp
generators.

Completion criteria:

- Queued offline changes flush cleanly.
- Both editor replicas converge after reconnect.
- Each editor keeps its own sensible local selection after remote changes.

## Phase 8: Tests and Verification

Add focused tests before relying on manual QA.

Suggested test layers:

- Vitest unit tests for command helpers and runtime sync.
- React/jsdom tests for rendering formatted runs and basic selection conversion if feasible.
- Playwright tests for keyboard, paste, toolbar, drag, and offline sync behavior.

Minimum test cases:

- initial render has two editors with one empty block each
- typing in one editor syncs to the other when online
- offline typing queues changes and reconnect flushes them
- Enter at start/middle/end creates the expected blocks
- ordinary Backspace deletes a character
- Backspace at block start joins with previous block
- paste with newlines creates multiple blocks
- bold/italic toggles apply and remove marks
- multi-block formatting produces formatted text in each affected block
- drag handle reorders blocks and syncs to the other editor
- concurrent offline edits converge after reconnect

Verification commands:

- `npm run build` from `examples/block-rich-text`
- root `npm run typecheck:examples`
- targeted Vitest command for helper tests
- Playwright command for the new example, if a Playwright config is added

## Implementation Order

1. Scaffold the standalone example and import `block-crdt` from source.
2. Build and test the in-memory two-replica runtime.
3. Build and test CRDT command helpers.
4. Implement editor rendering from `materializeFormattedBlocks`.
5. Implement DOM selection mapping and restoration.
6. Wire typing, Enter, Backspace, and paste.
7. Add toolbar formatting and multi-block mark segmentation.
8. Add pointer-event drag reorder with an explicit handle.
9. Add offline queue controls and side-by-side sync visibility.
10. Add Playwright coverage for the real browser interactions.

## Non-Goals

- Nested blocks.
- Production-grade collaboration transport.
- Persistence across reloads.
- Rich paste from HTML.
- IME-perfect composition handling beyond avoiding obvious breakage.
- A public package export for `block-crdt`, unless the example needs to build through package
  imports rather than source aliases.
