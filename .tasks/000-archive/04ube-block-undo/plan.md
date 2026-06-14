# Plan: Block Rich Text Undo/Redo

## Goal

Implement undo/redo for `examples/block-rich-text` as forward CRDT updates. Undo and redo should append new `local-change` history actions; they must not move the history scrub cursor backward.

Key decisions from research:

- Command metadata lives on `HistoryAction`, not raw `Op` objects.
- Command ids use the existing editor Lamport clock.
- Imported metadata-free histories replay normally but are not undoable.
- `planUndoOps()` must become capable enough for normal editor expectations, including text delete, block delete, split, join, redo, and remove-mark cases.
- Undoing deletes and redo after tombstone-based undo should create fresh replacement chars/blocks, not resurrect old ids.
- Join undo should be represented with fresh split/move/block ops, not a special unjoin op.
- Blocked undo/redo state should be shown inside each editor panel.
- Undo/redo actions may include diagnostic labels for future history UI.

## Phase 1: Expand Block CRDT Undo Planning

Update `src/block-crdt/undo.ts` so `planUndoOps()` can plan visual undo for the operations the editor emits.

Required behavior:

- `char` insert undo:
  - keep current behavior: emit `char:delete` for inserted chars that are still visible.
- `char:delete` undo:
  - create fresh `char` ops with new ids and the deleted text;
  - insert them at the logical position where the deleted chars were visible in the `before` state;
  - use the nearest surviving logical left neighbor when possible, falling back to the containing block.
- `block` insert undo:
  - keep current behavior: emit `block:delete` for a newly inserted visible block.
- `block:delete` undo:
  - create a fresh `block` op with equivalent meta/order placement;
  - do not try to restore collaborative edits to the old block id;
  - restore enough visible shape for user-facing undo.
- `block:move` undo:
  - keep current behavior but ensure nested `BlockOrder.path` and fresh order ids remain valid.
- `block:meta` undo:
  - keep current behavior.
- additive `mark` undo:
  - keep current behavior: emit later remove mark.
- remove-mark undo:
  - recover previous winning mark data from `before` and emit a later positive mark when possible.
- `split-record` undo:
  - plan higher-level visual inverse using fresh ops where needed;
  - move split text back into the left/original block and delete or hide the split-created block if that is the correct visible inverse.
- `join-record` undo:
  - plan fresh split/move/block ops to visually separate joined content again;
  - do not add a dedicated unjoin operation.

Implementation notes:

- Prefer helper functions in `undo.ts` over leaking example-specific logic into the CRDT core.
- Keep `UndoPlan` shape with `complete`, `ops`, and `unsupported`.
- Unsupported cases should still be reported conservatively when a safe visual inverse cannot be planned.
- Use `actor` and `ts()` from the planner options for all fresh Lamport ids and timestamps.

Verification:

```sh
npm exec vitest src/block-crdt/index.test.ts
```

Add or update tests for:

- undoing text deletion by inserting replacement chars;
- redo of text insertion by undoing the tombstone undo with replacement chars;
- undoing block delete with a fresh block;
- undoing split;
- undoing join with fresh ops;
- undoing remove-mark by restoring prior mark data;
- blocked/unsupported cases remain explicit.

## Phase 2: Add Command Metadata To History Actions

Update `examples/block-rich-text/src/history.ts`.

Extend `HistoryAction`:

```ts
type BlockCommandIntent = 'edit' | 'undo' | 'redo';

type BlockCommandInfo = {
    id: string;
    actor: EditorId;
    intent: BlockCommandIntent;
    targetCommandId?: string;
    beforeSelection: RetainedSelectionSet;
    afterSelection: RetainedSelectionSet;
    label?: string;
};
```

Then add optional `command?: BlockCommandInfo` to `local-change` actions.

Rules:

- New document-changing edit actions must include `command`.
- Selection-only actions still are not recorded in history and do not allocate command ids.
- Imported actions without `command` remain valid but are not undoable.
- Undo actions use `intent: 'undo'` and `targetCommandId` of the original edit command.
- Redo actions use `intent: 'redo'` and `targetCommandId` of the original edit command.
- `label` is optional diagnostic metadata for export/history inspection.

Update import/export validation:

- validate optional command metadata;
- validate `actor` is `left` or `right`;
- validate `intent`;
- require `targetCommandId` for `undo` and `redo`;
- reject `targetCommandId` for normal `edit` unless a future need appears;
- validate `beforeSelection` and `afterSelection` with existing retained selection validators;
- keep metadata-free action imports valid.

Update clock advancement:

- `advanceReplicaClocks()` currently scans Lamport arrays and strings shaped like `left-00001`;
- add support for `lamportToString()` strings shaped like `0001-left` / `0001-right`;
- command ids and target command ids should advance the appropriate editor clock after import/replay.

Verification:

```sh
npm exec vitest examples/block-rich-text/src/history.test.ts
```

Add tests for:

- command metadata round-trips through serialize/parse;
- metadata-free imports still parse and replay;
- invalid command metadata is rejected;
- command ids advance editor clocks after import.

## Phase 3: Stamp Edit Commands In App

Update `examples/block-rich-text/src/App.tsx`.

Change `runCommand()` so document-changing commands append action-level command metadata.

Implementation shape:

- Read the displayed `replica` before running the command.
- Capture `beforeSelection` from `replica.selection`.
- Allocate a command id from the same editor clock before or during command execution.
- Run the existing command.
- If `result.ops.length === 0`, keep current transient selection behavior and do not allocate/record command metadata.
- If there are ops, append a `local-change` action with:
  - `command.id`;
  - `command.actor`;
  - `intent: 'edit'`;
  - `beforeSelection`;
  - `afterSelection: result.selection`;
  - optional `label`.

Important detail:

- The current `makeCommandContext(replica)` mutates `replica.clock`.
- Because `displayDemo` is replay-derived, command id allocation must not create duplicate ids with op ids/timestamps.
- Prefer a small helper in `blockEditorRuntime.ts`, such as `nextReplicaTs(replica)`, so command id allocation and op generation use the same clock discipline.

Verification:

- Existing App tests should still pass.
- Add tests proving document edits include command metadata in exported history.
- Add tests proving selection-only captures do not append action metadata.

## Phase 4: Derive Undo/Redo State

Create `examples/block-rich-text/src/undoHistory.ts`.

Expose:

```ts
export const deriveUndoState = (
    history: HistoryState,
    editorId: EditorId,
): {
    canUndo: boolean;
    canRedo: boolean;
    undoReason?: string;
    redoReason?: string;
};

export const createUndoAction = (
    history: HistoryState,
    editorId: EditorId,
): {action: HistoryAction} | {error: string};

export const createRedoAction = (
    history: HistoryState,
    editorId: EditorId,
): {action: HistoryAction} | {error: string};
```

Internal derivation:

- Replay from `createDemoState()` through `history.cursor`.
- Use the same semantics as `replayHistory()`: for `local-change`, apply ops to the source replica state, then pass through `applyLocalChange()` so online/offline queues are faithfully represented.
- Capture each command's source replica `before` and `after` state during replay.
- Ignore metadata-free actions for undo stacks.
- Ignore commands from the other actor for this editor's undo/redo stacks.

Stack rules:

- `edit`: push onto undo, clear redo.
- `undo`: move `targetCommandId` from undo to redo.
- `redo`: move `targetCommandId` from redo to undo.
- Remote commands never clear local redo.
- Malformed transitions should not throw; skip the invalid undo-index transition while replaying document state normally.

Planning availability:

- `canUndo` should inspect the last undo command and call `planUndoOps(target.before, currentReplica.state, target.ops, ...)`.
- `canRedo` should inspect the last redo command and call `planUndoOps(undoCommand.before, currentReplica.state, undoCommand.ops, ...)` or the equivalent redo planner path.
- Empty or incomplete plans should return false with a reason.

Verification:

```sh
npm exec vitest examples/block-rich-text/src/undoHistory.test.ts
```

Cover:

- local edit becomes undoable;
- remote edit does not become undoable and does not clear redo;
- metadata-free local-change replays but is not undoable;
- undo moves command to redo;
- redo moves it back to undo;
- new edit after undo clears redo;
- scrub cursor derives from the prefix only;
- malformed metadata does not crash derivation.

## Phase 5: Create Undo And Redo Actions

Implement `createUndoAction()` and `createRedoAction()` in `undoHistory.ts`.

Undo action creation:

- derive current state and target command at `history.cursor`;
- call expanded `planUndoOps(target.before, currentReplica.state, target.ops, {actor, ts})`;
- if incomplete, return `{error}`;
- apply planned ops to the source replica state to validate and compute selection fallback;
- create a `local-change` action:
  - `editorId`;
  - `ops: plan.ops`;
  - `selection: target.beforeSelection` when it resolves, otherwise current selection fallback;
  - `command.intent: 'undo'`;
  - `command.targetCommandId: target.id`;
  - `command.beforeSelection`: current source selection;
  - `command.afterSelection`: target before selection or fallback;
  - optional label like `Undo ${target.command.label ?? target.id}`.

Redo action creation:

- derive current state and redo target;
- use the undo command associated with the redo target;
- call `planUndoOps(undoCommand.before, currentReplica.state, undoCommand.ops, {actor, ts})`;
- if incomplete, return `{error}`;
- create a `local-change` action with `intent: 'redo'` and `targetCommandId` set to the original edit command id;
- use the original command's `afterSelection` when it resolves, otherwise current selection fallback.

Clock handling:

- Use the same editor clock as normal edits.
- Derivation can get current clock from replayed `DemoState` at `history.cursor`.
- Planned fresh ids/timestamps must be reflected by the appended action so future replay/import advances clocks.

Verification:

- Unit tests should apply created actions with `appendHistoryAction()` and `replayHistory()`, not only inspect action shapes.
- Include offline scenarios so queued undo/redo ops flush correctly.

## Phase 6: Wire Editor UI

Update `examples/block-rich-text/src/App.tsx` and `style.css`.

UI behavior:

- Add Undo and Redo buttons per editor, near existing formatting controls.
- Buttons should use `onMouseDown(event.preventDefault())`.
- Disable buttons when unavailable.
- Show blocked/unavailable reason inside the relevant editor panel, not in global history status.
- Add keyboard shortcuts while focus is inside an editor:
  - `Mod+Z` -> undo;
  - `Mod+Shift+Z` and/or `Mod+Y` -> redo.

State integration:

- On successful undo/redo, call `setHistory(current => appendHistoryAction(current, action))`.
- This preserves existing branch behavior when `history.cursor < history.actions.length`.
- Clear transient selection for that editor after appending undo/redo, matching edit action behavior.
- Do not record blocked undo/redo attempts as history actions.

Verification:

```sh
npm exec vitest examples/block-rich-text/src/App.test.tsx
```

Add tests for:

- Undo button updates both editors while online.
- Undo while offline updates only source and increments queue count.
- Returning online flushes undo ops.
- Redo works for cases supported by expanded planning.
- Blocked undo displays editor-local status and does not change history count.
- `Mod+Z` invokes undo.
- Undo while scrubbed into the past branches and drops future actions.

## Phase 7: Import/Export And Replay Polish

Update export/import behavior after command metadata and undo UI exist.

Tasks:

- Ensure exported history includes command metadata and optional labels.
- Ensure imported history jumps to the end as it does today.
- Ensure metadata-free imported histories show undo unavailable rather than attempting inference.
- Ensure final snapshots remain diagnostic only.
- Update validation for any new op shapes produced by expanded `planUndoOps()`.

Verification:

- Export a history containing edit, undo, and redo.
- Reset.
- Import.
- Verify final state, scrub range, command metadata, and undo/redo availability.

## Phase 8: Full Verification

Run focused tests first:

```sh
npm exec vitest src/block-crdt/index.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/App.test.tsx
```

Then build the example:

```sh
npm run build --workspace examples/block-rich-text
```

If workspace build syntax is not available in this repo setup, run the equivalent command from `examples/block-rich-text`.

Manual smoke checklist:

- Type text in Editor A, undo, redo.
- Delete text, undo, redo.
- Split a block, undo, redo.
- Join blocks, undo, redo.
- Move/indent/unindent blocks, undo, redo.
- Toggle bold/italic, undo, redo.
- Go offline, edit, undo, return online.
- Scrub to the past, undo, confirm future actions are truncated.
- Export, reset, import, verify replay and undo availability.

## Definition Of Done

- `planUndoOps()` supports visual undo for normal block-rich-text edit operations.
- `HistoryAction` includes optional command metadata and validates it on import.
- New edit actions are stamped with command metadata.
- Undo/redo state is derived from replayed history at the current cursor.
- Undo/redo append new `local-change` actions with fresh ops.
- Metadata-free imported actions replay but are not undoable.
- Editor UI exposes undo/redo buttons, shortcuts, and editor-local blocked reasons.
- Online/offline queueing and history scrub branching continue to work.
- Focused tests and the block-rich-text build pass.
