# CRDT local undo/redo implementation plan

This plan implements local-only undo/redo for the CRDT layer.

The core rule:

- Only local commands go into undo/redo history.
- Remote updates apply to the CRDT document but do not enter local history.
- Undo/redo creates fresh CRDT updates.
- Undo/redo is blocked if any effect in the command can no longer be cleanly reversed/reapplied.

This avoids partial undo and avoids overwriting remote edits.

## Non-goals

Do not implement these in this pass:

- collaborative/global undo;
- history tree branching;
- history scrubber UI;
- accepting/rejecting old remote changes;
- causal frontier / dotted version vectors;
- branch merge semantics;
- command labels.

Those are important follow-up topics, but this pass should only build a reliable local command stack.

## Target API

Add a new CRDT history layer, probably under `src/crdt/history.ts`.

```ts
export type CrdtLocalHistory<T> = {
    doc: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
};

export type ApplyLocalCommandResult<T> = {
    history: CrdtLocalHistory<T>;
    updates: CrdtUpdate[];
    clock: HLC;
};

export type UndoRedoResult<T> =
    | {
          ok: true;
          history: CrdtLocalHistory<T>;
          updates: CrdtUpdate[];
          clock: HLC;
      }
    | {
          ok: false;
          reason: 'empty' | 'blocked';
          blocked?: BlockedEffect[];
          history: CrdtLocalHistory<T>;
          clock: HLC;
      };
```

Functions:

```ts
export function createCrdtLocalHistory<T>(doc: CrdtDocument<T>): CrdtLocalHistory<T>;

export function applyLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    draft: MaybeNested<DraftPatch<T, 'type', undefined>>,
    clock: HLC,
): ApplyLocalCommandResult<T>;

export function applyRemoteUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
    clock: HLC,
): {history: CrdtLocalHistory<T>; clock: HLC};

export function undoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: HLC,
): UndoRedoResult<T>;

export function redoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: HLC,
): UndoRedoResult<T>;
```

If generic tag/context support is easy, add it. If not, start with the default `'type'` tag and `undefined` context to match current CRDT examples.

## Data structures

Store full `CrdtMeta` snapshots for before/after. This is simpler and preserves array IDs, container incarnations, and tombstones.

```ts
export type LocalCommand = {
    id: string;
    forward: CrdtUpdate[];
    effects: LocalEffect[];
};

export type LocalEffect =
    | {
          kind: 'set';
          path: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: CrdtMeta | undefined;
          after: CrdtMeta;
      }
    | {
          kind: 'delete';
          path: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: CrdtMeta | undefined;
      }
    | {
          kind: 'setOrder';
          arrayPath: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp} | undefined>;
          after: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp}>;
      };

export type BlockedEffect = {
    command: LocalCommand;
    effect: LocalEffect;
    reason: 'missing-target' | 'superseded' | 'wrong-incarnation' | 'deleted';
};
```

Command IDs can be the packed HLC timestamp for the first update in the command.

## Required internal helpers

Some existing CRDT internals are currently private but are needed for history.

Export internally from module files, not necessarily from `umkehr/crdt` public API unless useful:

- `getMetaAtPath`
- `versionOf`
- `buildMeta`
- `materialize`
- `schemaAtCrdtPath`
- maybe `cloneMeta`

Add helper functions:

```ts
function cloneEffectMeta(meta: CrdtMeta | undefined): CrdtMeta | undefined;

function getEffectTarget(doc: CrdtDocument<unknown>, effect: LocalEffect): CrdtMeta | undefined;

function effectStillApplies(doc: CrdtDocument<unknown>, effect: LocalEffect): true | BlockedEffect;

function createUndoUpdates(doc: CrdtDocument<unknown>, command: LocalCommand, ts: HlcTimestamp): CrdtUpdate[];

function createRedoUpdates(doc: CrdtDocument<unknown>, command: LocalCommand, ts: HlcTimestamp): CrdtUpdate[];
```

## Capturing local command effects

Add a command creation helper:

```ts
function createLocalCrdtCommand<T>(
    doc: CrdtDocument<T>,
    patches: Patch<T>[],
    clock: HLC,
): {
    doc: CrdtDocument<T>;
    command: LocalCommand;
    updates: CrdtUpdate[];
    clock: HLC;
};
```

Algorithm:

1. Start with the current CRDT document.
2. For each realized `Patch` in command order:
   - increment HLC with `hlc.inc`;
   - call `createCrdtUpdates(currentDoc, patch, hlc.pack(clock))`;
   - for each generated update:
     - read and clone the before target from `currentDoc`;
     - apply the update to get `nextDoc`;
     - read and clone the after target from `nextDoc`;
     - append a `LocalEffect`;
     - append the update to `forward`;
     - set `currentDoc = nextDoc`.
3. Return the final document, command, generated updates, and clock.

Effect capture details:

- `set`: `before` is the current meta at `update.path`, `after` is the meta after apply.
- `delete`: `before` is the current meta at `update.path`.
- `setOrder`: `before` is each affected item's current order, `after` is the update's new order.

If a patch creates multiple CRDT updates, all effects belong to the same `LocalCommand`.

## Applying local commands

`applyLocalCommand` should:

1. Use existing `resolveAndApply(history.doc.state, draft, undefined, 'type', equal)` to realize regular patches.
2. Convert/apply them through `createLocalCrdtCommand`.
3. Push the command onto `undoStack`.
4. Clear `redoStack`.
5. Return generated CRDT updates for broadcast.

Do not store remote updates in this flow.

## Applying remote updates

`applyRemoteUpdate` should:

1. Advance the local HLC with `hlc.recv`.
2. Apply the update with `applyCrdtUpdate`.
3. Return updated history with the same `undoStack` and `redoStack`.

Remote updates must not clear redo.

## Undo

Undo is blocked if any effect in the top command cannot be reversed.

Algorithm:

1. If `undoStack` is empty, return `{ok: false, reason: 'empty'}`.
2. Let `command = undoStack.at(-1)`.
3. Check every effect in reverse order.
4. If any effect is blocked, return `{ok: false, reason: 'blocked', blocked}` with unchanged history and clock.
5. Increment HLC once per emitted undo update.
6. Generate fresh CRDT updates that compensate the effects.
7. Apply those updates locally.
8. Move the command from `undoStack` to `redoStack`.
9. Return emitted updates for broadcast.

Blocking rules:

- `set`: current target must exist and its winning timestamp must equal `effect.localTs`.
- `delete`: current target must be a tombstone with `deleted === effect.localTs`.
- `setOrder`: every affected live item must exist and its order timestamp must equal `effect.localTs`.

Undo update generation:

- `set` with `before === undefined` -> fresh `delete`.
- `set` with `before.kind === 'tombstone'` -> fresh `delete`.
- `set` with live `before` -> fresh `set` using `materialize(before)`.
- `delete` with live `before` -> fresh `set` using `materialize(before)`.
- `delete` with missing/tombstone `before` -> no-op, but this case should be rare.
- `setOrder` -> fresh `setOrder` restoring all previous order values.

Fresh timestamps:

- Undo must not reuse the original command timestamps.
- Use `hlc.inc` for every emitted CRDT update.
- Deleted subtree restore should create a new incarnation with the fresh timestamp.

## Redo

Redo is blocked if any effect cannot be reapplied.

Algorithm:

1. If `redoStack` is empty, return `{ok: false, reason: 'empty'}`.
2. Let `command = redoStack.at(-1)`.
3. Check every effect in original order.
4. If any effect is blocked, return `{ok: false, reason: 'blocked', blocked}`.
5. Generate fresh CRDT updates from the stored `after` values.
6. Apply locally.
7. Move command from `redoStack` back to `undoStack`.
8. Return emitted updates for broadcast.

Redo blocking rules:

- Same all-or-nothing policy as undo.
- Parent incarnation must still match the CRDT path.
- For reapplying `set`, current target should still correspond to the value produced by the prior undo.
- For reapplying `delete`, current target should still correspond to the restored pre-delete value.
- For `setOrder`, every affected item must still be present and have the order timestamp from the undo step.

Implementation note: redo may be easier if undo records an additional "undo command" internally. However, avoid putting undo commands into the normal local command stack. A simpler v1 is to re-check against the stored original effects and emit `after` values if the target is compatible.

## All-or-nothing behavior

Both undo and redo should be all-or-nothing.

If any effect would be skipped, block the whole command and return the blocking details. Do not partially apply.

This matches the answers in `research.md` and avoids confusing partial reverts.

## Tests

Add tests under `src/crdt/history.test.ts`.

Required cases:

1. Local primitive set undo restores previous value and broadcasts a fresh CRDT update.
2. Local primitive set redo reapplies the value with a fresh timestamp.
3. Remote primitive set with newer timestamp blocks undo of older local set.
4. Remote update does not enter undo stack.
5. Remote update does not clear redo stack.
6. Local command after undo clears redo stack.
7. Local array insert undo deletes the inserted item by CRDT item ID.
8. Local array insert undo still works after remote reorder.
9. Local array item edit undo targets the same item after remote reorder.
10. Local delete undo restores the deleted value as a fresh incarnation.
11. Remote recreate after local delete blocks undo.
12. Local reorder undo restores previous order.
13. Remote reorder of any affected item blocks reorder undo.
14. Multi-patch local command undoes all effects together.
15. Multi-patch undo is blocked if one effect is superseded, and no effects are applied.
16. Redo is blocked if any effect cannot be reapplied.

Also add a small React CRDT example update after the core tests pass:

- Wrap each replica in `CrdtLocalHistory`.
- Add local Undo/Redo buttons per replica.
- Keep the existing sync pause/resume behavior.
- Remote deliveries call `applyRemoteUpdate`.

## Implementation order

1. Add `src/crdt/history.ts` types and empty public functions.
2. Add internal target-reading helpers for CRDT paths and order values.
3. Implement `createLocalCrdtCommand` effect capture.
4. Implement `applyLocalCommand`.
5. Implement undo blocking checks.
6. Implement undo update generation.
7. Implement `undoLocalCommand`.
8. Implement redo blocking checks.
9. Implement redo update generation.
10. Implement `redoLocalCommand`.
11. Implement `applyRemoteUpdate`.
12. Export history API from `src/crdt/index.ts`.
13. Add unit tests incrementally.
14. Update `examples/react-crdt`.

## Risks

- `createCrdtUpdates` and `applyCrdtUpdate` currently hide some useful internals. Avoid duplicating path traversal logic if possible.
- Redo compatibility checks may need refinement after undo implementation exists.
- Restoring deleted containers with fresh timestamps means nested child timestamps change. That is intended, but tests should assert the visible state, not exact old metadata.
- `materialize(before)` returns `undefined` for tombstones; callers must distinguish missing/tombstone from live values before generating updates.
- A command with multiple CRDT updates may include dependent paths. Capture and undo in reverse order to avoid deleting a parent before reversing a child.

## Acceptance criteria

- Local undo/redo works without involving remote updates in history.
- Undo/redo emits CRDT updates suitable for broadcast.
- Undo/redo uses fresh HLC timestamps.
- Undo/redo is blocked all-or-nothing when any effect has been superseded.
- Array operations use item IDs, not numeric indices.
- Remote updates do not clear redo.
- Existing CRDT tests still pass.
