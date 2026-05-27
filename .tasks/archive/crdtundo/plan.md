# CRDT undo metadata plan

This plan implements option 2 from `research.md`: add minimal command metadata to `CrdtUpdate` and derive local undo/redo from retained CRDT updates instead of persisting `undoStack` and `redoStack`.

There is no migration or compatibility layer. `umkehr` has no production users right now, so persisted CRDT history shapes can change directly.

## Target model

### Minimal update metadata

Add a small optional metadata object to every `CrdtUpdate` variant:

```ts
export type CrdtUpdateMeta = {
    commandId: HlcTimestamp;
    commandSeq: number;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: HlcTimestamp;
};
```

Rules:

- Every locally-authored update must have `meta`.
- All updates produced by one local dispatch share the same `commandId`.
- `commandSeq` is zero-based within that command.
- Normal user edits use `intent: 'edit'`.
- Undo updates use `intent: 'undo'` and `targetCommandId` set to the original edit command.
- Redo updates use `intent: 'redo'` and `targetCommandId` set to the original edit command.
- Remote updates are allowed to have metadata and should preserve it.
- `applyCrdtUpdate` ignores metadata for CRDT merge semantics.
- HLC timestamp actor identity is still used to determine whether a command belongs to the current session.

`commandId` should be the first timestamp allocated for a command. This keeps it stable, sortable, and consistent with the existing `LocalCommand.id` behavior.

### Local history shape

Replace durable stacks with a retained update log:

```ts
export type CrdtLocalHistory<T> = {
    base: CrdtDocument<T>;
    doc: CrdtDocument<T>;
    updates: CrdtUpdate[];
};
```

`base` is the snapshot/checkpoint from which `updates` can be replayed. For the first implementation, it is the initial document passed to `createCrdtLocalHistory`.

`updates` is the canonical retained log for this local history object. It contains local and remote updates in application order. `doc` is the materialized result of applying `updates` to `base`.

Undo/redo stacks become derived ephemeral data:

```ts
type DerivedCommand = {
    id: HlcTimestamp;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: HlcTimestamp;
    updates: CrdtUpdate[];
    effects: LocalEffect[];
};

type DerivedUndoIndex = {
    undoStack: DerivedCommand[];
    redoStack: DerivedCommand[];
};
```

`LocalEffect` can remain internal to `history.ts`, but it should no longer be stored in public persisted history.

### Actor/session input

Deriving local undo requires the current session actor. Add actor-aware APIs rather than guessing from the document:

```ts
canUndoLocalCommand(history, actor)
canRedoLocalCommand(history, actor)
undoLocalCommand(history, actor, clock)
redoLocalCommand(history, actor, clock)
```

React already has `SyncedTransport.actor`, so `createSyncedContext` can pass `ctx.transport.actor`.

For lower-level tests and callers, actor is explicit.

## Phase 1: Types and validators

1. Add `CrdtUpdateMeta` to `src/crdt/types.ts`.
2. Add `meta?: CrdtUpdateMeta` to `CrdtSetUpdate`, `CrdtDeleteUpdate`, and `CrdtSetOrderUpdate`.
3. Update `createCrdtUpdateValidator`:
   - allow optional `meta`;
   - validate `commandId` as an HLC timestamp;
   - validate `commandSeq` as a non-negative integer;
   - validate `intent` as `edit`, `undo`, or `redo`;
   - require `targetCommandId` for `undo` and `redo`;
   - reject `targetCommandId` for `edit`, unless there is a concrete need to allow it.
4. Add validation tests for valid and invalid metadata.

Verification:

- `src/crdt/validation.test.ts` covers metadata envelope validation.
- Existing CRDT update validation still accepts bare remote/test updates if they are created manually without metadata.

## Phase 2: Metadata stamping

1. Keep `createCrdtUpdates` responsible only for operation shape.
2. Add helper functions in `src/crdt/history.ts`:
   - `withCommandMetadata(updates, metaBase)`;
   - `updateActor(update)`;
   - `isAuthoredBy(update, actor)`;
   - `latestCrdtUpdateTimestamp` remains as the timestamp helper.
3. Update `createLocalCrdtCommand`:
   - allocate timestamps as it does now;
   - choose `commandId` from the first generated update timestamp, or the current packed clock for an empty command;
   - stamp generated updates with `{commandId, commandSeq, intent: 'edit'}`.
4. Update undo generation:
   - generate compensation updates with fresh HLC timestamps;
   - stamp all of them with a new undo `commandId`;
   - set `intent: 'undo'`;
   - set `targetCommandId` to the original edit command id.
5. Update redo generation similarly with `intent: 'redo'`.

Verification:

- Local edit tests assert emitted updates have `meta.intent === 'edit'`.
- Undo/redo tests assert fresh command ids and correct `targetCommandId`.
- `setOrder` updates carry one update-level metadata object even though they contain multiple per-item timestamps.

## Phase 3: Retained update log

1. Change `createCrdtLocalHistory(doc)` to clone/store the input as `base` and return `{base, doc, updates: []}`.
2. Update `applyLocalCommand`:
   - apply stamped updates to `doc`;
   - append stamped updates to `history.updates`;
   - do not mutate or store undo/redo stacks.
3. Update `applyRemoteHistoryUpdate` and `receiveRemoteUpdate`:
   - apply the incoming update to `doc`;
   - append the incoming update to `history.updates`;
   - do not clear redo.
4. Update undo/redo:
   - derive the current undo index from `history.updates`;
   - generate and apply stamped undo/redo updates;
   - append generated updates to `history.updates`.
5. Remove `LocalCommand.forward`, `undoStack`, `redoStack`, and public exports for durable local command types if they are no longer needed.

Important detail: `applyGeneratedUpdates` should still return derived effects for the updates it applies, but those effects are temporary.

Verification:

- Existing CRDT history tests should pass after replacing direct stack assertions with derived `canUndo`/`canRedo` assertions.
- Add a test that re-creates a history from the same initial document plus retained updates and still gets the same `canUndo`/`canRedo` results.

## Phase 4: Derived undo index

Implement a pure helper:

```ts
function deriveUndoIndex<T>({
    initial,
    updates,
    actor,
}: {
    initial: CrdtDocument<T>;
    updates: readonly CrdtUpdate[];
    actor: string;
}): {
    doc: CrdtDocument<T>;
    commands: DerivedCommand[];
    undoStack: DerivedCommand[];
    redoStack: DerivedCommand[];
};
```

Use the explicit `history.base` snapshot/checkpoint described in the target model.

Derivation rules:

1. Replay updates from `base` in stored order.
2. For every update with metadata, capture `LocalEffect` before/after applying it.
3. Group adjacent/same-command updates by `meta.commandId`.
4. Ignore commands that are not authored by `actor`.
5. `edit` commands push onto undo and clear redo.
6. `undo` commands move `targetCommandId` from undo to redo.
7. `redo` commands move `targetCommandId` from redo to undo.
8. Remote commands never clear local redo.
9. Bare updates without metadata apply to the document but do not enter undo/redo.

If a malformed log has split command ids, missing targets, duplicate undo commands, or redo of a non-redoable command, prefer conservative behavior:

- materialize document state normally;
- skip only the invalid undo-index transition;
- keep undo/redo availability based on the valid prefix.

Verification:

- Multi-update command derives as one undo step.
- Remote updates apply to derived document but do not enter or clear stacks.
- Undo moves an edit command to redo.
- Redo moves it back to undo.
- New local edit after undo clears redo.
- Bare metadata-free update is not undoable.

## Phase 5: Undo/redo generation from derived commands

1. `canUndoLocalCommand(history, actor)`:
   - derive undo index;
   - inspect the last undo command;
   - run current `checkEffects` against `history.doc`.
2. `canRedoLocalCommand(history, actor)`:
   - derive undo index;
   - inspect the last redo command;
   - check against the latest undo command effects for that target.
3. `undoLocalCommand(history, actor, clock)`:
   - derive undo index;
   - choose last undo command;
   - run all-or-nothing guard;
   - generate compensation updates from derived effects in reverse order;
   - stamp generated updates with undo metadata;
   - apply and append them.
4. `redoLocalCommand(history, actor, clock)`:
   - derive undo index;
   - choose last redo command;
   - run all-or-nothing guard;
   - generate forward updates from the original edit command effects;
   - stamp generated updates with redo metadata;
   - apply and append them.

The current conservative blocking rules should remain unchanged:

- set undo/redo blocks if the visible value no longer matches the expected after/undo value;
- delete undo blocks if the target is no longer the tombstone created by the command;
- reorder undo/redo blocks if any affected item was deleted or reordered by a newer update;
- multi-effect commands are all-or-nothing.

Verification:

- Port all current `src/crdt/history.test.ts` undo/redo tests.
- Add tests that inspect retained `history.updates` instead of `undoStack`/`redoStack`.
- Add a reload-style test: build `history2 = createCrdtLocalHistory(base.doc)`, apply retained updates as remote/log replay, then undo from `history2`.

## Phase 6: React CRDT integration

1. Update `src/react-crdt/react-crdt.tsx`:
   - pass `ctx.transport.actor` to `canUndoLocalCommand`, `canRedoLocalCommand`, `undoLocalCommand`, and `redoLocalCommand`;
   - ensure local `publish` receives metadata-stamped updates;
   - ensure remote receive preserves metadata in `history.updates`.
2. Update React CRDT tests:
   - existing undo/redo behavior should remain the same;
   - add an assertion that `useLocalHistory().updates` grows for edits, undo, redo, and remote updates.

Verification:

- `src/react-crdt/react-crdt.test.tsx` passes.
- No UI-facing API has to expose metadata unless tests need to inspect it.

## Phase 7: Persistence and examples

Update code that persisted or assumed `undoStack`/`redoStack`:

- `examples/react-crdt/src/lib/local-first/types.ts`;
- `examples/react-crdt/src/lib/local-first/replay.ts`;
- `examples/react-crdt/src/lib/server/types.ts`;
- any persistence validation in example apps;
- docs/readmes that mention local undo/redo stacks.

Because there is no compatibility requirement, delete old fields directly and update seed/default persisted shapes.

Important replay rule:

- If replaying retained updates into a `CrdtLocalHistory`, append them to `history.updates` exactly once.
- Avoid using `applyRemoteHistoryUpdate` for preview materialization if it would accidentally duplicate updates in the retained log. Add a lower-level replay helper if needed.

Verification:

- Example TypeScript compile catches stale fields.
- Local-first replay preview still materializes state correctly.
- Server-mode persisted replica type no longer includes stack fields.

## Phase 8: Public API cleanup

1. Decide whether to keep `LocalCommand` and `LocalEffect` exported. Preferred:
   - stop exporting `LocalCommand`;
   - keep `BlockedEffect` public only if callers use it for blocked undo UI;
   - keep `LocalEffect` internal unless public blocked data requires it.
2. Export `CrdtUpdateMeta`.
3. Export a small helper only if useful:
   - `deriveLocalUndoState(history, actor)` returning counts/availability, not internals.
4. Update `src/crdt/index.ts` exports.
5. Update README/package examples if they mention stack persistence.

Verification:

- Package smoke tests pass.
- Type tests compile.

## Test command

Run:

```sh
pnpm test
```

If the full suite is too broad during development, use focused runs first:

```sh
pnpm vitest src/crdt/history.test.ts src/crdt/validation.test.ts src/react-crdt/react-crdt.test.tsx
```

Then run the full suite before considering the work done.

## Open decisions

- Should `CrdtLocalHistory.base` be a full cloned `CrdtDocument`, or should it store only `baseMeta/baseState/schema`? Start with full document for simplicity.
  - hm it doesn't make sense for it to have pending though, right?
- Should `deriveUndoIndex` be recomputed every `canUndo()` call, or cached by `history.updates.length`? Start uncached for correctness; add cache only if UI polling becomes expensive.
  - wow um yeah it should be cached, and definitely incrementally updated, not recomputed from scratch each time a new update comes in
- Should malformed metadata throw or be skipped? For retained sync logs, skip invalid undo-index transitions while still applying valid CRDT updates.
  - skip
- Should remote updates with the same actor but a different session count as local? No. Use exact HLC node/session actor for local undo.
  - that's right. different sessions dont invalidate local undo

## Definition of done

- `CrdtUpdate` has minimal command metadata.
- Local edits, undo, and redo stamp metadata consistently.
- `CrdtLocalHistory` no longer stores durable `undoStack`/`redoStack`.
- Undo/redo behavior is derived from retained `CrdtUpdate[]`.
- Current conservative undo/redo blocking semantics still pass.
- React CRDT integration passes actor into derived undo APIs.
- Example persistence types compile with the new history shape.
- Tests cover reload-style derivation from retained updates.
