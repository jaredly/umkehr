# Research: Block Rich Text Undo/Redo

## Goal

Add local undo/redo to `examples/block-rich-text`.

Undo/redo should behave like collaborative CRDT undo: pressing undo creates a new local update that compensates for a prior local command, then syncs that update to the other replica or queues it while offline. It must not time-travel the app state or move the history scrubber cursor backward. This is logically separate from `.tasks/04ub5-history-scrub`, whose job is to replay or preview past demo actions.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/utils.ts`
- `src/crdt/history.ts`
- `src/react-crdt/react-crdt.tsx`
- `.tasks/04ub5-history-scrub/research.md`
- `.tasks/000-archive/crdtundo/plan.md`

The block example currently stores two mutable-ish demo replicas:

```ts
type Replica = {
    id: EditorId;
    actor: EditorId;
    state: CachedState;
    selection: RetainedSelection;
    online: boolean;
    queue: Op[][];
    clock: number;
};
```

Local edits flow through `runCommand()` in `App.tsx`. A command receives the current `Replica`, returns `{state, ops, selection}`, and `applyLocalChange()` applies the source state/selection and either sends `ops` to the peer immediately or appends them to the source replica's offline queue.

The command boundary is already the right undo unit. Examples:

- typing one character creates one `char` op;
- paste can create inserts and splits across multiple blocks;
- Enter can create a `block`, `split-record`, and `char:move` ops;
- Backspace at block start calls `join()`, which emits `char:move` ops plus a `block:status` archive op;
- formatting creates `mark` ops;
- drag reorder creates one `block:move` op.

The generic CRDT history layer in `src/crdt/history.ts` already implements the desired architectural shape for object CRDTs:

- `CrdtLocalHistory` retains `{base, doc, updates}`;
- updates carry command metadata;
- undo/redo stacks are derived per actor from the retained update log;
- undo/redo create fresh compensation updates with `intent: 'undo' | 'redo'`;
- remote updates stay in the retained log but do not become local undo steps.

The block CRDT is separate from that generic object CRDT, so the block example cannot directly use `CrdtLocalHistory`. It should reuse the same idea locally for block `Op[]`.

## Relationship To History Scrubbing

History scrub should record and replay demo actions. Undo/redo should be recorded as ordinary new local-change actions, not as cursor movement.

For example:

1. Editor A inserts `abc`.
2. Editor A presses undo.
3. The scrub history should contain two or more forward actions: the original insert command(s), then an undo command with fresh compensation ops.
4. Moving the scrubber backward previews the earlier action prefix.
5. Pressing undo while scrubbed into the past should follow the same branch rule as any other edit: truncate future scrub actions, derive the displayed state at the current cursor, then append the undo action.

This means the implementation should not expose undo as `setHistory({cursor: cursor - 1})`. It should call the same `applyLocalChange()` path as edits, so online/offline queues and peer sync remain reproducible.

## Recommended Model

Add an example-local undo model in `blockEditorRuntime.ts` or a new `blockUndo.ts`.

Suggested metadata:

```ts
export type BlockCommandIntent = 'edit' | 'undo' | 'redo';

export type BlockCommandMeta = {
    commandId: string;
    commandSeq: number;
    intent: BlockCommandIntent;
    targetCommandId?: string;
};

export type CommandedOp = Op & {
    command?: BlockCommandMeta;
};
```

The block CRDT apply functions ignore extra properties because they switch on `op.type`, so metadata can ride on the plain op objects without affecting merge semantics. If TypeScript becomes awkward, define a wrapper instead:

```ts
type BlockHistoryUpdate = {
    op: Op;
    command?: BlockCommandMeta;
};
```

The wrapper is cleaner for validation/export, but it requires unwrapping before `applyMany()`. The embedded metadata approach is closer to `src/crdt/history.ts`.

Extend `Replica` with a retained operation log:

```ts
type Replica = {
    // existing fields...
    base: CachedState;
    ops: CommandedOp[];
};
```

or, if it is clearer, split the history state:

```ts
type BlockLocalHistory = {
    base: CachedState;
    state: CachedState;
    ops: CommandedOp[];
};
```

Each replica needs its own local log because undo is actor/session local. Remote ops should be appended to the receiving replica's log too, with their original metadata preserved. That is what lets the peer materialize state, distinguish remote edits from local undoable edits, and later derive local undo after reload/import.

## Command Metadata

Every non-empty locally-authored command should stamp all emitted ops with one `commandId`.

Rules:

- `commandId` can be the first generated timestamp in the command, or a dedicated id from `context.nextTs()`.
- `commandSeq` is zero-based within the command.
- normal edits use `intent: 'edit'`;
- undo uses `intent: 'undo'` and `targetCommandId` of the original edit;
- redo uses `intent: 'redo'` and `targetCommandId` of the original edit;
- remote ops preserve their metadata;
- metadata-free ops apply but are not undoable.

Selection-only `captureSelection` commands emit `ops: []`. They should update retained selection but should not become undoable document commands.

One practical issue: `charOp()` currently ignores its `ts` argument and creates `char.parent.ts: ''`. The character id is still actor-stamped and unique, but if command id derivation depends on timestamps, inserts should use the char id or fix `charOp()` to store the timestamp. The simplest block-example-local approach is to derive `commandId` from the first generated op's stable id when possible, falling back to `actor-clock`.

## Derived Undo Index

Implement a pure derivation helper similar to `src/crdt/history.ts`:

```ts
type BlockCommand = {
    id: string;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: string;
    ops: CommandedOp[];
    effects: BlockEffect[];
    redoGuardEffects?: BlockEffect[];
};

type BlockUndoIndex = {
    state: CachedState;
    commands: BlockCommand[];
    undoStack: BlockCommand[];
    redoStack: BlockCommand[];
};
```

Derivation should replay `ops` from `base` in stored order. For each op, capture a before/after effect, apply the op, then group adjacent ops with the same `command.commandId`.

Rules:

- ignore commands not authored by the current replica actor;
- `edit` pushes the command onto undo and clears redo;
- `undo` moves `targetCommandId` from undo to redo;
- `redo` moves `targetCommandId` from redo to undo;
- remote commands never clear the local redo stack;
- metadata-free ops apply to the materialized state but do not enter undo/redo;
- malformed transitions should be skipped for undo-index purposes while still applying valid CRDT ops.

This can be recomputed from the retained log first. If it becomes expensive during UI polling, cache by `(replica object identity, actor, ops.length)` or carry an incremental cache like `src/crdt/history.ts`.

## Effects And Compensation Ops

The block CRDT has tombstoned chars and archived blocks, so undo should generally create new LWW updates or tombstone/status changes rather than deleting history.

Suggested `BlockEffect` cases:

```ts
type BlockEffect =
    | {kind: 'char'; id: string; before: Char | undefined; after: Char | undefined}
    | {kind: 'block'; id: string; before: Block | undefined; after: Block | undefined}
    | {kind: 'mark'; id: string; before: Mark | undefined; after: Mark | undefined}
    | {kind: 'split-record'; id: string; before: SplitRecord | undefined; after: SplitRecord | undefined};
```

This generic snapshot effect is enough for LWW fields, but text deletion needs extra placement data because `char:delete` is a tombstone. `applyChar()` preserves the existing `deleted` flag when a char id already exists, so a deleted char cannot be resurrected by replaying a full `char` op with `deleted: false`.

For text edits, capture enough context to insert replacements:

```ts
type DeletedCharEffect = {
    kind: 'charDelete';
    id: string;
    text: string;
    blockId: string;
    visibleOffsetBeforeDelete: number;
    previousVisibleCharId: string | null;
};
```

The replacement insertion point should be resolved against the current state at undo time. Prefer the still-visible previous neighbor; if that neighbor was deleted, walk left through the captured before-order or fall back to the block start. If the original block was archived by a later join, retained-selection style resolution may need to map the insertion into the surviving visible block.

Suggested conservative inverses:

- `char` insert undo: emit `char:delete` for the inserted char.
- `char:delete` undo: emit a fresh `char` op with a new id and the deleted text at the resolved replacement location.
- `char:move` undo: emit `char:move` with the previous parent and a fresh move timestamp.
- `block` insert undo: emit `block:status` with `{archived: true, ts}` for the created block.
- `block:status` undo: emit `block:status` with the previous archived value and a fresh timestamp.
- `block:move` undo: emit `block:move` with the previous order and a fresh timestamp in the order object.
- `block:meta` undo: emit `block:meta` with previous meta and a fresh timestamp.
- `mark` undo: if the command inserted a mark, emit a later remove mark covering the same range; if undoing a remove mark, emit a later positive mark covering the same range.
- `split-record` probably has no direct undo op because records are immutable facts used by traversal. Undoing the corresponding split should be achieved by moving chars back and archiving the inserted block.

Redo uses the original effects in forward order:

- reinsert or reapply the original after-state with fresh LWW timestamps where required;
- for char inserts that were undone by tombstone, redo by inserting replacement chars with fresh ids rather than trying to un-delete the original ids;
- for formatting, create a later mark with the same range/type/data/remove meaning as the original command.

## Blocking Semantics

Start conservative, matching the object CRDT undo behavior.

Before generating undo/redo, validate all effects all-or-nothing against the current replica state:

- inserted char can be undone only if it still exists and is not already deleted;
- deleted char can be restored only if the same char is still deleted and has not been moved into an unexpected parent by a later command;
- moved char can be moved back only if its current parent still matches the command's after parent;
- block move undo can proceed only if the block's current order still matches the command's after order;
- block status/meta undo can proceed only if current status/meta still matches the command's after value;
- mark undo can proceed only if no later mark for the same type/range makes the visible formatting ambiguous, unless we accept "add a later opposite mark" semantics as always valid;
- multi-op commands are all-or-nothing.

This avoids surprising undo behavior after concurrent remote edits. The first implementation can return `{ok: false, reason: 'blocked'}` and disable the button; it does not need a detailed blocked-effect UI unless desired later.

## Selection Behavior

Undo/redo should update the source replica's retained selection to a meaningful location after applying the compensation ops.

Recommended first pass:

- for undo, restore to the retained selection captured before the original command;
- for redo, restore to the retained selection captured after the original command;
- for blocked undo/redo, leave selection unchanged;
- after local undo/redo, resolve the retained selection and schedule the same DOM restore path used by edit commands.

This means each derived command should store `beforeSelection` and `afterSelection`, or the live command action recorded by history scrub should include both. Today `runCommand()` only records the result selection. The undo implementation should capture `current.selection` before running a local command, and `retainSelection(result.state, result.selection)` after it.

Because retained selections are char-id based, they should remain meaningful across remote inserts, deletes, split, join, and block moves.

## Runtime API Shape

Add small helpers rather than putting undo logic directly in React:

```ts
export const canUndoReplica = (replica: Replica): boolean;
export const canRedoReplica = (replica: Replica): boolean;

export const undoReplica = (replica: Replica): CommandResult | {ok: false; reason: 'empty' | 'blocked'};
export const redoReplica = (replica: Replica): CommandResult | {ok: false; reason: 'empty' | 'blocked'};
```

or:

```ts
export type UndoRedoResult =
    | {ok: true; state: CachedState; ops: CommandedOp[]; selection: RetainedSelection}
    | {ok: false; reason: 'empty' | 'blocked'};
```

`App.tsx` can then route successful undo/redo through `applyLocalChange()` exactly like edits.

If `.tasks/04ub5-history-scrub` is implemented first, the append action should include `intent` or a label so the scrub UI can distinguish edits, undo, redo, toggles, and selection captures. The replay path should still only care about applying recorded ops.

## UI

Add undo/redo buttons per editor, probably in the existing toolbar next to bold/italic.

Behavior:

- buttons reflect local availability for that editor only;
- disable undo/redo while the derived command is blocked;
- keyboard shortcuts should support `Mod+Z` for undo and `Mod+Shift+Z` or `Mod+Y` for redo when focus is inside an editor;
- toolbar buttons should use `onMouseDown(event.preventDefault())` like formatting buttons so clicking them does not steal editor focus before selection capture.

The block example currently does not use an icon library. Plain text buttons are acceptable for this research task; implementation can improve styling in `style.css`.

## Testing Plan

Unit tests for the undo helper:

- local text insert undo deletes inserted chars and redo restores them;
- paste with multiple ops undoes/redoes as one command;
- split undo rejoins visible text and archives/removes the created block from the visible root list;
- join undo restores the archived right block and moves chars back;
- block move undo restores order;
- formatting undo removes bold/italic and redo reapplies it;
- selection-only capture is not undoable;
- remote edit is applied but not undoable by this actor;
- remote edit after local undo does not clear redo;
- new local edit after undo clears redo;
- blocked undo returns `blocked` and emits no ops;
- reload-style derivation from `{base, ops}` preserves undo/redo availability.

App tests:

- typing in Editor A, clicking Undo updates both editors when online;
- undo while offline updates source only and queues compensation ops;
- going online flushes the undo ops to the peer;
- redo works after undo;
- pressing `Mod+Z` inside an editor runs undo;
- history scrub, once implemented, records undo/redo as new forward actions.

## Implementation Notes

`applyRemoteOps()` currently only applies remote ops to state:

```ts
const state = applyMany(replica.state, ops);
return {...replica, state};
```

It should also append received ops to the receiving replica's retained op log. `applyLocalChange()` should append local stamped ops to the source replica log whether the peer is online or offline.

Offline queues currently store `Op[][]`. They can continue doing that if metadata is embedded into each op. If a wrapper type is used, queues should become `BlockHistoryUpdate[][]` and flush should unwrap before apply.

Be careful with `makeCommandContext()`: it mutates `replica.clock` while commands are running. Undo/redo generation will also need fresh ids/timestamps, so it should either use the same context or return the advanced clock with the result.

The block CRDT does not currently have an exported validator for ops. Import/export for history scrub should validate the envelope and enough op shape to avoid crashes, but exact CRDT semantic validation can remain a future improvement.

## Open Questions

1. Should metadata be embedded directly on block `Op` objects, or should history scrub store `{op, command}` wrappers and unwrap for `applyMany()`?
2. Should undo derive from each replica's retained op log, or should command/effect stacks be stored directly on `Replica` for the example? Derivation matches the CRDT undo plan and reload story, but direct stacks are faster and simpler.
3. What should be the precise inverse for marks? A later opposite mark is CRDT-friendly, but "blocked if later formatting overlaps" may be more predictable for a first implementation.
4. Should split undo try to generate the same shape as a user join, or use lower-level inverse moves/status ops captured from effects? Lower-level inverse ops are more general for concurrent splits.
5. Should redo of an inserted char reuse the original char id or create a new char id? Reusing preserves identity but must handle the existing tombstoned char path carefully.
6. Should undo/redo commands include before/after retained selections in command metadata, or should selection remain outside the op log as part of the history action model?
7. If undo is blocked, should the UI only disable the button, or show a reason in the existing debug log?
8. How much should the first implementation support concurrent remote edits around split/join? The conservative blocking rules can keep correctness high while leaving some valid undo cases unavailable.
9. Should `charOp()` be fixed to store its `ts` argument in `char.parent.ts` before adding undo metadata, or is the current id-based ordering enough for this example?
10. Once history scrub exists, should undo/redo be disabled while `cursor < actions.length`, or should it branch from the scrubbed state like any other edit? Branching is consistent with the scrub research, but disabling is simpler.
