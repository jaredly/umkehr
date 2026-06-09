# Research: Block Rich Text Undo/Redo

## Goal

Add local undo/redo to `examples/block-rich-text`.

Undo/redo should behave like collaborative CRDT undo: pressing undo creates a new local update that compensates for a prior local command, then syncs that update to the other replica or queues it while offline. It must not move the history scrubber cursor backward. Scrubbing previews an action prefix; undo/redo appends new forward actions.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/undo.ts`
- `src/crdt/history.ts`

The history scrub task has landed. `App` no longer stores `DemoState` directly; it stores `HistoryState` and derives the visible demo with:

```ts
const demo = useMemo(
    () => replayHistory(history.actions, history.cursor),
    [history.actions, history.cursor],
);
```

`HistoryAction` is currently:

```ts
type HistoryAction =
    | {
          type: 'local-change';
          editorId: EditorId;
          ops: Op[];
          selection: RetainedSelectionSet;
      }
    | {
          type: 'toggle-online';
          editorId: EditorId;
      };
```

Selection-only commands are intentionally transient. `runCommand()` appends a `local-change` action only when `result.ops.length > 0`; otherwise it updates `transientSelections`.

The block CRDT API and types have also changed since the first research pass:

- `Op` is now exported from `src/block-crdt/types.ts`.
- `Block` uses `deleted: boolean`; the old `block.status.archived` shape is gone.
- `block:status` has been removed and replaced by `block:delete`.
- `BlockOrder` now carries `{id, path, index, ts}`.
- `join()` now emits a `join-record` rather than moving chars and archiving the right block.
- `State` and `Cache` track `joins`, `joinSentinels`, and `joinedBlocks`.
- `applyRemote()` and `applyRemoteMany()` now expose applied/ignored/pending/invalid outcomes, though the example still uses strict `applyMany()`.
- `src/block-crdt/undo.ts` exports `planUndoOps(before, current, batch, {actor, ts})`.

## Existing Undo Primitive

`planUndoOps()` is the important new primitive. It plans inverse ops for a batch when it can do so safely:

- `char` insert -> `char:delete`
- `char:move` -> `char:move` back to the previous parent
- `block` insert -> `block:delete`
- `block:move` -> `block:move` back to the previous order with a fresh order id/timestamp
- `block:meta` -> `block:meta` with the previous metadata and a fresh timestamp
- additive `mark` -> later remove `mark`

It deliberately reports unsupported cases instead of producing unsafe inverses:

- `char:delete` undo, because there is no char resurrection operation;
- `block:delete` undo, because there is no block resurrection operation;
- remove-mark undo, because it needs previous winning mark data;
- `split-record` undo, because split inverse planning is higher-level;
- `join-record` undo, because there is no unjoin operation.

That means the example should not reinvent low-level inverse planning. Use `planUndoOps()` as the first undo engine, and surface unsupported plans as blocked undo. A later task can expand `planUndoOps()` if we want deletion, split, and join undo to work.

## Relationship To History Scrubbing

Undo/redo should append `local-change` actions to the existing scrub history.

For example:

1. Editor A inserts `abc`.
2. Editor A presses undo.
3. History now contains the insert action and a later undo action with compensation ops.
4. Moving the scrubber backward previews the action prefix.
5. Editing or undoing while scrubbed into the past should use the existing branch rule in `appendHistoryAction()`: truncate future actions, then append the new action.

This means undo must not call `setHistoryCursor(cursor - 1)`. It should produce ops and route them through the same append/replay path as edits.

## Missing Layer

`planUndoOps()` can invert a batch, but the app still needs a local command history layer that answers:

- which past local batch is the next undo target?
- which original batch is redoable after an undo?
- what `before` state should be passed to `planUndoOps()`?
- what `current` state should be checked before applying an undo?
- what retained selection should be shown after undo/redo?

The current `HistoryAction` model records action order, editor id, ops, and final selection. It does not record command metadata, before-selection, or command intent. Without that metadata, undo can infer only "all local-change actions by this editor", and redo cannot distinguish an undo action from a normal edit.

## Recommended Model

Add example-local command metadata to local-change actions rather than to raw block ops.

```ts
type BlockCommandIntent = 'edit' | 'undo' | 'redo';

type BlockCommandInfo = {
    id: string;
    actor: EditorId;
    intent: BlockCommandIntent;
    targetCommandId?: string;
    beforeSelection: RetainedSelectionSet;
    afterSelection: RetainedSelectionSet;
};

type HistoryAction =
    | {
          type: 'local-change';
          editorId: EditorId;
          ops: Op[];
          selection: RetainedSelectionSet;
          command?: BlockCommandInfo;
      }
    | {
          type: 'toggle-online';
          editorId: EditorId;
      };
```

Why action-level metadata is preferable now:

- `history.ts` already owns replay, import/export, branch trimming, and clock advancement.
- `Op` is a public block CRDT type with a validator/import path; embedding extra `command` fields in every op would require broadening validation and makes raw CRDT ops less clean.
- Commands in the example already correspond to one `local-change` action, including multi-op paste, split, indent/unindent, and multi-selection commands.
- Selection data belongs to the editor action layer, not the low-level CRDT op layer.

For compatibility with existing exported histories, `command` can be optional during import. Metadata-free `local-change` actions should replay normally but should not be undoable.

## Command IDs

Every document-changing local edit should receive a command id. Options:

1. Use the first Lamport/HLC-like value found in the emitted ops.
2. Allocate a dedicated id from `makeCommandContext().nextTs()` before running the command.
3. Use an app-local sequence id in `HistoryState`.

Option 1 avoids consuming an extra timestamp but is fiddly because different op types store ids/timestamps in different places. Option 2 is simple and stable, but it advances the replica clock even for metadata. Option 3 is clean for the example but does not preserve actor-clock identity in exported logs.

Recommended first pass: use a dedicated command id from the editor replica clock, formatted with `lamportToString([replica.clock++, replica.actor])`, before running a document-changing command. That produces strings like `0001-left`. Selection-only commands still should not allocate command ids.

`history.ts` already recursively scans action values for Lamport arrays and some string timestamps, but its current string regex is shaped like `left-00001`. If command ids use `lamportToString()` strings, update `scanClockValue()` to also recognize `0001-left` and `0001-right`; otherwise imported histories could reuse command ids.

## Derived Undo Index

Build a pure helper over `HistoryAction[]` and a cursor:

```ts
type DerivedBlockCommand = {
    id: string;
    actor: EditorId;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: string;
    actionIndex: number;
    before: CachedState;
    after: CachedState;
    ops: Op[];
    beforeSelection: RetainedSelectionSet;
    afterSelection: RetainedSelectionSet;
    redoGuardOps?: Op[];
};

type BlockUndoIndex = {
    demo: DemoState;
    commands: DerivedBlockCommand[];
    undoStack: DerivedBlockCommand[];
    redoStack: DerivedBlockCommand[];
};
```

Derivation should replay actions from `createDemoState()` through `cursor`, matching `replayHistory()` semantics. For each `local-change` with `command`:

- capture the source replica state before applying the action;
- apply it with `applyLocalChange()` so online/offline queues still matter;
- capture the source replica state after applying the action;
- include only commands whose `command.actor` matches the editor actor when deriving that editor's undo stacks.

Stack transition rules should mirror `src/crdt/history.ts`:

- `edit` pushes onto undo and clears redo;
- `undo` moves `targetCommandId` from undo to redo;
- `redo` moves `targetCommandId` from redo to undo;
- remote commands do not enter or clear this actor's stacks;
- metadata-free actions apply but do not affect undo/redo;
- malformed transitions are skipped for undo-index purposes while replay continues.

Because `history.cursor` can point into the past, derive from `actions.slice(0, cursor)`, not the full action list.

## Undo Execution

`canUndo(editorId)` should:

1. derive the undo index at the current cursor;
2. inspect the last undo command for that editor;
3. call `planUndoOps(command.before, currentReplica.state, command.ops, {actor, ts})` in a dry-run mode or with a disposable timestamp generator;
4. return false if the plan is incomplete or empty.

`undo(editorId)` should:

1. derive the same target command;
2. call `planUndoOps(target.before, currentReplica.state, target.ops, {actor, ts})`;
3. if incomplete, leave history unchanged and optionally show the unsupported reasons in the UI/status;
4. apply the planned ops to the source state with `applyMany()` to compute the next selection/action;
5. append a `local-change` action with `command.intent: 'undo'` and `targetCommandId: target.id`.

Use `target.beforeSelection` as the undo action's final selection. Because selections are retained by char/block ids, they should resolve as well as possible after the compensation ops. If the target selection no longer resolves cleanly, fall back to the current primary selection or the first visible block.

## Redo Execution

Redo should not time-travel either; it should append fresh forward ops.

The simplest first pass is to redo by planning undo of the undo action:

1. when deriving an undo command, capture its `before`, `after`, and `ops`;
2. move the original edit command to `redoStack` with a reference to the undo command;
3. for redo, call `planUndoOps(undoCommand.before, currentReplica.state, undoCommand.ops, {actor, ts})`;
4. append those planned ops with `command.intent: 'redo'` and `targetCommandId` set to the original edit command id.

This works for undo ops that `planUndoOps()` can invert. For example, undoing an insert emits `char:delete`, and `planUndoOps()` currently cannot invert `char:delete`; so redo for text inserts will be blocked with the current primitive.

If redo of text insertion is required for the first implementation, `planUndoOps()` needs a supported way to restore tombstoned chars or insert replacement chars with fresh ids. That is currently an open product/CRDT decision.

## Current Limitations

With the current `planUndoOps()`, the first implementation can support:

- undoing text insertions;
- undoing additive formatting marks;
- undoing block moves, indent, and unindent when represented as `block:move`;
- undoing block metadata changes if/when the UI exposes them;
- undoing some split/move side effects only where the batch consists of supported ops.

It will not yet support:

- undoing text deletion/backspace;
- undoing block deletion;
- undoing joins represented by `join-record`;
- undoing split as a complete user action because `split-record` is unsupported;
- undoing remove-mark commands;
- redo of any undo action whose generated ops include unsupported inverse cases.

This is acceptable only if the UI communicates blocked undo/redo clearly. If users expect ordinary text-editor behavior, we should extend `planUndoOps()` before wiring the buttons.

## Runtime API Shape

Keep the undo logic out of React handlers where possible. A small example-local module, likely `examples/block-rich-text/src/undoHistory.ts`, should expose:

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

`App.tsx` can then call `appendHistoryAction(current, action)` for successful undo/redo actions. That preserves existing branch behavior when `cursor < actions.length`.

## UI

Add undo/redo buttons per editor, probably in the toolbar next to bold/italic.

Behavior:

- buttons reflect local availability for that editor only;
- disabled or blocked undo should not append a history action;
- blocked reasons can be shown in `historyStatus` or a compact editor-local status;
- keyboard shortcuts should support `Mod+Z` for undo and `Mod+Shift+Z` or `Mod+Y` for redo when focus is inside an editor;
- toolbar buttons should use `onMouseDown(event.preventDefault())` like formatting buttons so clicking them does not steal editor focus.

Because history scrub is active, undo/redo buttons should operate on the displayed cursor state. If `cursor < actions.length`, successful undo/redo should branch by truncating future actions through `appendHistoryAction()`.

## Import/Export

Update `history.ts` import validation for optional `command` metadata:

- validate `id`, `actor`, `intent`, optional `targetCommandId`, `beforeSelection`, and `afterSelection`;
- reject removed op shapes as it already does;
- keep metadata optional so older exports still import;
- include command metadata in `finalSnapshot` only if useful for diagnostics, not as replay authority.

`advanceReplicaClocks()` already recursively scans action values, but it needs the string-format update noted above if command ids and target ids use `lamportToString()` strings.

## Testing Plan

Unit tests for the undo-history helper:

- local text insert creates an undoable edit command;
- undoing a text insert appends a new `local-change` with `intent: 'undo'`;
- undo while offline queues the compensation ops and replays correctly after toggling online;
- metadata-free imported actions replay but are not undoable;
- remote editor actions do not enter or clear the local undo stack;
- new local edit after undo clears redo;
- scrubbed cursor derives undo state from the prefix only;
- undo while scrubbed into the past branches and drops future actions;
- unsupported undo returns a useful error and appends no action;
- reload/import style derivation from serialized history preserves undo availability.

Block CRDT tests already cover `planUndoOps()` for insert, move/meta batches, additive marks, and unsupported deletion. Add tests there only when extending low-level undo support.

App tests:

- clicking Undo in Editor A updates both editors when online;
- clicking Undo while offline updates source only and increments queued count;
- going online flushes undo ops to the peer;
- blocked undo does not change history count;
- keyboard `Mod+Z` invokes undo;
- export/import preserves command metadata and undo availability.

Suggested focused verification:

```sh
npm exec vitest src/block-crdt/index.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/App.test.tsx
```

## Open Questions

1. Is partial undo acceptable for the first UI, or should we extend `planUndoOps()` before exposing buttons so text deletion, split, join, and redo work like users expect?
    - we definitely need planUndoOps to be much more capable. undo-ing char:delete should add new chars in the logical place. they will be new chars, but visually it will be an undo. undoing block delete should recreate the block in the same place, even though it will not restore collaborative edits to the old block. split and join also need to be undoable. 
2. Should command metadata live on `HistoryAction` as recommended, or should it be embedded on raw `Op` objects for closer alignment with `src/crdt/history.ts`?
    - HistoryAction is fine
3. Should command ids consume the editor Lamport clock, or should `HistoryState` maintain a separate command sequence?
    - same clock is fine
4. What should redo mean for text insertions if undo tombstones the original chars and `char:delete` has no inverse?
    - redo would create new chars, same as undoing a delete
5. Should `planUndoOps()` grow a replacement-char strategy for undoing deletes, or should the block CRDT add explicit resurrection semantics?
    - see 1 and 4
6. Should `join-record` get an explicit unjoin operation, or should join undo be represented as fresh split/move/block ops?
    - fresh ops
7. Should remove-mark undo be supported by capturing previous winning mark data in command metadata?
    - sure
8. Should blocked undo/redo be shown globally in `historyStatus` or inside each editor panel?
    - in each editor panel
9. Should imported metadata-free histories be entirely non-undoable, or should we infer edit commands from `editorId` for old exports?
    - no undo for them
10. Should undo/redo actions include diagnostic labels for future history scrub UI, even though the current plan says not to add explicit action labels?
    - could be nice
