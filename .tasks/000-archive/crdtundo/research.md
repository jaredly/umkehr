# CRDT undo history normalization research

This note looks at removing `CRDTLocalHistory`'s `undoStack` and `redoStack` as independent local-command storage, and instead deriving local undo/redo from retained `CRDTUpdate` values.

## Current shape

`src/crdt/history.ts` currently stores:

```ts
export type CrdtLocalHistory<T> = {
    doc: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
};
```

`LocalCommand` duplicates parts of the CRDT update log:

```ts
export type LocalCommand = {
    id: string;
    forward: CrdtUpdate[];
    effects: LocalEffect[];
    undoEffects?: LocalEffect[];
};
```

The duplication is not accidental. The current undo code needs:

- **Command grouping:** one user dispatch can produce multiple `CrdtUpdate`s, and those must undo atomically.
- **Local authorship:** remote updates should not enter local undo/redo.
- **Before/after effects:** undo must know what to restore and redo must know what to reapply.
- **Conservative guards:** undo/redo is blocked if any affected target was superseded by another update.
- **Redo state:** after undo, the command leaves the undo side and becomes redoable until a new local edit clears redo.

Raw `CrdtUpdate` currently carries only operation data:

- `set`: path, value, timestamp;
- `delete`: path, timestamp;
- `setOrder`: array path and per-item order timestamps.

For local/remote distinction, the HLC node can identify the authoring session if actors are stable and unique per session. That is useful, but it is not enough to replace `LocalCommand`.

## What HLC author identity gives us

Given a local actor string, we can classify an update as local if every timestamp in it has that actor:

- `set.ts`;
- `delete.ts`;
- every `setOrder.orders[*].ts`.

This is enough to avoid pushing remote updates into local undo. It is also enough to reconstruct a user's own authored timeline after reload if the client has a retained update log.

It does not solve:

- where one user command starts and ends;
- which later updates are undo/redo operations rather than normal edits;
- which original command an undo refers to;
- whether redo should still be available;
- what value existed before a command unless we replay from a base document;
- whether a retained log was compacted past information needed for undo.

So HLC actor identity is a necessary input, not a sufficient model.

## Option 1: Derive from raw CRDT updates only

This is the smallest conceptual change: keep a retained update log, remove local stacks, and infer undoable commands by scanning updates authored by the current actor.

Possible grouping heuristics:

- one update equals one command;
- adjacent local updates with contiguous HLC counters are one command;
- adjacent local updates in one transport batch are one command if the retained log stores batches outside `CrdtUpdate`.

Pros:

- No `CrdtUpdate` schema change.
- No duplicated `LocalEffect` storage.
- Works for simple one-update commands.

Cons:

- One-update-per-command breaks multi-patch atomicity.
- HLC counter adjacency is a leaky command boundary. Remote receives can advance the local clock between patches, and separate UI actions can also be adjacent.
- Transport batches are outside `CrdtUpdate`, so the source of truth is no longer only `CrdtUpdate`.
- Redo is impossible to infer cleanly. An undo update is just another local edit unless the update type says otherwise.
- Reconstructing `before` still requires replaying from a base snapshot through retained updates.

Verdict: not strong enough. HLC actor identity can classify authorship, but raw updates do not contain enough intent.

## Option 2: Add command metadata to `CrdtUpdate`

Add optional metadata to every update:

```ts
export type CrdtUpdateMeta = {
    commandId: HlcTimestamp;
    commandSeq?: number;
    actor?: string;
    intent?: 'edit' | 'undo' | 'redo';
    undoOf?: HlcTimestamp;
    redoOf?: HlcTimestamp;
};
```

Then each variant carries `meta?: CrdtUpdateMeta`, or the project adds a common base type and intersects it into the variants.

Normal local edit:

- `meta.commandId` is the id for the user command;
- all updates produced by the same dispatch share the same `commandId`;
- `commandSeq` preserves deterministic ordering within the command if needed;
- `intent` is `'edit'`.

Undo:

- undo emits normal CRDT updates with fresh HLC timestamps;
- every undo update has a new `commandId`;
- `intent` is `'undo'`;
- `undoOf` points to the original command id.

Redo:

- redo emits normal CRDT updates with fresh HLC timestamps;
- `intent` is `'redo'`;
- `redoOf` points to the original command id, or `undoOf` depending on naming preference.

This makes the retained CRDT update log the source of truth for stack membership. A local undo index can be derived by scanning the log in order:

1. Keep only updates whose timestamp actor matches the current session, or whose `meta.actor` matches if explicit actor metadata is used.
2. Group updates by `meta.commandId`.
3. Treat commands with `intent: 'edit'` as candidates for undo.
4. Treat commands with `intent: 'undo'` as moving `undoOf` from undoable to redoable.
5. Treat commands with `intent: 'redo'` as moving `redoOf` back to undoable.
6. When a new local `edit` appears after one or more undone commands, clear redo by treating those older redo candidates as abandoned.

Pros:

- Removes durable `undoStack` and `redoStack`.
- Keeps undo/redo operations as normal CRDT updates with fresh timestamps.
- Preserves command atomicity.
- Survives reload if the update log is retained.
- Makes undo/redo intent inspectable in history views.

Cons:

- Requires a `CrdtUpdate` protocol/schema migration.
- Old peers that validate strict update envelopes may reject metadata unless validation explicitly allows it.
- The derived index still has to replay or otherwise inspect document history to recover before/after effects.
- Log compaction can remove the data needed to rebuild undo history unless compaction has undo-aware cutoffs.

Verdict: best direction if the goal is "only CRDTUpdate is durable source of truth".

## Option 3: Use a CRDT event envelope instead of changing `CrdtUpdate`

Keep `CrdtUpdate` pure and introduce:

```ts
type CrdtEvent = {
    update: CrdtUpdate;
    meta: CrdtUpdateMeta;
};
```

The local/server logs would retain `CrdtEvent[]`, while `applyCrdtUpdate` still accepts `CrdtUpdate`.

Pros:

- Keeps the core CRDT operation type minimal.
- Avoids threading metadata through `applyCrdtUpdate`.
- Easier to make metadata transport/server-specific.

Cons:

- Does not satisfy the strict version of "relying only on the `CRDTUpdate` type".
- Existing persistence currently stores `CrdtUpdate[]` in several places, so this is still a log format migration.
- Call sites need to decide when they want bare updates vs events.

Verdict: architecturally clean, but if the design goal is to make `CRDTUpdate` itself sufficient, this is one layer too far away.

## Option 4: Store inverse metadata as CRDT updates

Instead of storing `LocalEffect` separately, represent undo data as explicit metadata-bearing updates. For example, an original command could include `inverse` data:

```ts
type CrdtUpdateMeta = {
    commandId: HlcTimestamp;
    intent: 'edit' | 'undo' | 'redo';
    inverse?: unknown;
};
```

The inverse would store the prior CRDT metadata/value needed to undo without replaying the whole log.

Pros:

- Fast reload-time undo reconstruction.
- Does not require retaining a full un-compacted log merely to recover `before`.
- Closer to the current `LocalEffect` behavior.

Cons:

- It moves the denormalization into every `CrdtUpdate`; it does not really remove it.
- The update payload gets much larger.
- Inverses can contain schema-shaped values and CRDT metadata, so validation/versioning becomes harder.
- Remote peers receive undo internals they may not need.

Verdict: probably the wrong tradeoff. It preserves performance by embedding the duplicated data in the replicated log.

## Option 5: Operation-level undo semantics

A more radical option is to make undo an operation over prior operations, not a compensating state update. For example:

```ts
type CrdtUndoUpdate = {
    op: 'undo';
    targetCommandId: HlcTimestamp;
    ts: HlcTimestamp;
};
```

Materialization would ignore or reverse effects of operations whose command id is currently undone.

Pros:

- Very explicit operation model.
- Undo metadata is compact.
- Global/collaborative undo becomes more expressible.

Cons:

- This changes CRDT semantics instead of using normal LWW updates.
- Materialization must understand operation ancestry and undone state.
- It conflicts with the current "undo is a new edit with fresh timestamps" model.
- Redo and remote supersession rules become much more complex.
- Deleting/recreating objects and array item ordering need operation-aware treatment.

Verdict: too large for the current architecture unless the project wants a fundamentally different CRDT.

## Reconstructing effects without `LocalCommand`

Even with command metadata, undo generation still needs `LocalEffect`-like data. The difference is that it can be derived instead of stored durably.

A derivation pass can replay from a base document:

```ts
type DerivedCommand = {
    id: HlcTimestamp;
    intent: 'edit' | 'undo' | 'redo';
    undoOf?: HlcTimestamp;
    redoOf?: HlcTimestamp;
    forward: CrdtUpdate[];
    effects: LocalEffect[];
};
```

Algorithm:

1. Start from the initial snapshot or a checkpoint snapshot.
2. Replay retained updates in canonical log order.
3. Before applying each update, capture the target metadata using the same logic as `captureBefore`.
4. Apply the update with `applyCrdtUpdate`.
5. Capture the resulting effect using the same logic as `captureEffect`.
6. Group the update/effect into its `meta.commandId`.
7. Fold command intents into an ephemeral undo/redo index.

This keeps `LocalEffect` as a derived cache, not persisted independent state.

The replay order matters:

- In local-first mode, the retained batch order needs to be deterministic enough for reconstruction.
- In server mode, branch-scoped server `eventIndex` should be the replay order, not HLC sorting.
- HLC timestamps remain the CRDT conflict-resolution metadata.

## Derived undo/redo behavior

Given a derived command list, `canUndo` can use the current `checkEffects` logic against the command at the undo tip.

Undo:

1. Derive or read the current undo tip command.
2. Run conservative all-or-nothing guards.
3. Generate compensating `CrdtUpdate`s from the command's derived effects.
4. Stamp those updates with fresh HLC timestamps.
5. Add metadata: `intent: 'undo'`, `undoOf: originalCommandId`, new `commandId`.
6. Apply/publish/retain them like any other local update.

Redo:

1. Derive or read the current redo tip command.
2. Guard against the undo effects currently being superseded.
3. Generate forward updates from the original command's derived effects.
4. Stamp fresh HLC timestamps.
5. Add metadata: `intent: 'redo'`, `redoOf: originalCommandId`, new `commandId`.
6. Apply/publish/retain them like any other local update.

The UI can still keep an ephemeral derived index for fast `canUndo()`/`canRedo()`. The important change is that the index is disposable and rebuildable from retained CRDT updates.

## Redo clearing

The current rule is:

- remote updates do not clear redo;
- new local edit after undo clears redo.

With metadata, redo clearing can be derived:

- Maintain a set/list of locally undone command ids.
- When a local `edit` command appears, clear the redo list that existed immediately before that edit.
- Undo/redo intent commands do not count as new local edits for clearing.

This reproduces normal editor behavior without a stored `redoStack`.

One caveat: this rule depends on per-session local intent. If a user opens another session with the same durable user id, that session's edits should probably not clear this session's redo. That argues for actor/session identity in HLC nodes, not only durable user id.

## Metadata details

Recommended minimal metadata:

```ts
export type CrdtUpdateMeta = {
    commandId: HlcTimestamp;
    commandSeq: number;
    intent: 'edit' | 'undo' | 'redo';
    targetCommandId?: HlcTimestamp;
};
```

Use `targetCommandId` for both undo and redo:

- `intent: 'undo', targetCommandId: originalCommandId`;
- `intent: 'redo', targetCommandId: originalCommandId`.

The actor can be derived from the update timestamps, but an explicit `actor` may still be useful for validation/debugging. If included, validation should ensure it matches the HLC node in the update timestamps.

`commandId` should be stable across all updates in one dispatch. The first HLC timestamp generated for the dispatch is a reasonable id, as the current `LocalCommand.id` already does this.

For `setOrder`, all per-item order timestamps should share the same actor and command metadata. Do not try to infer command membership from each order timestamp independently.

## Compaction impact

Removing persisted stacks makes retained update history more important.

If the log is compacted to a snapshot, undo can only be reconstructed for commands after the snapshot unless the snapshot also stores undo reconstruction data.

Reasonable policy:

- Undo history is bounded by the retained update log.
- Compaction may drop undo/redo availability for commands before the compaction point.
- Before compacting, choose a checkpoint that is older than the maximum undo depth you want to preserve.
- Do not preserve old `LocalEffect` data inside snapshots unless fast reload is more important than strict normalization.

This is consistent with common editor behavior: undo history is local/session-scoped and can be discarded at persistence or compaction boundaries.

## Migration path

1. Add optional metadata to `CrdtUpdate` types and validators.
2. Start writing metadata for all new local updates, undo updates, and redo updates.
3. Keep existing `undoStack`/`redoStack` as a compatibility path for old persisted histories.
4. Add a derived undo index builder from retained updates.
5. Teach local-first/server persistence to expose retained local update logs to the CRDT provider.
6. Switch `canUndo`, `canRedo`, `undo`, and `redo` to the derived index.
7. Stop persisting `undoStack`/`redoStack`; optionally keep ephemeral caches.
8. Later, remove compatibility once old histories are migrated or intentionally reset.

Old updates without metadata should be treated as not reconstructable for undo, unless the old persisted `LocalCommand` stacks are still present.

## Recommendation

Use option 2: add command/intent metadata to `CrdtUpdate`, and make local undo/redo stacks derived indexes over a retained update log.

HLC actor identity is enough to answer "was this authored by my current session?", but it is not enough to encode undo. The missing pieces are command boundaries and undo/redo relationships. Add those as small metadata fields on updates.

Do not embed full inverse/effect data in update metadata. Instead, derive `LocalEffect` by replaying retained updates from a snapshot/checkpoint. That removes the durable denormalization while preserving the current conservative undo semantics.

The resulting model is:

- `CrdtDocument` is the materialized CRDT state.
- `CrdtUpdate[]` plus metadata is the durable source of local undo/redo truth.
- `LocalEffect`/undo/redo stacks become ephemeral caches rebuilt from that source.
- Undo/redo still emits normal fresh CRDT updates, so remote peers see plain state changes and conflict resolution remains unchanged.
