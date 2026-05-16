# CRDT undo/redo research

This document explores undo/redo for the CRDT version of umkehr.

The simplifying product rule is important:

- Only local changes are undoable.
- Remote changes are never placed on the local undo stack.
- Undo/redo still produces normal CRDT updates, so other replicas see the result.
- Undo does not remove or rewrite historical CRDT updates.

That rule avoids the hardest collaborative editing semantics. The local user can walk back their own intent, while the shared document still behaves like an append-only CRDT update stream.

## Current CRDT shape

The CRDT layer currently has:

- materialized user state;
- parallel metadata;
- HLC timestamps;
- stable CRDT paths with parent incarnation timestamps;
- arrays addressed by generated item IDs and fractional order strings;
- records/arrays using tombstones;
- `createCrdtUpdates(doc, patch, ts)` to translate realized local patches into replicated updates;
- `applyCrdtUpdate(doc, update)` to merge local or remote updates.

The regular umkehr history system stores realized `Patch` values and inverts them. That works for single-user state, but those inverses are not directly valid collaborative undo operations because the document may have changed since the original patch was applied.

## What undo should mean

For this project, undo should mean:

> Generate a new local command that attempts to reverse the visible effect of one previous local command against the current CRDT document.

So undo is not:

- deleting an old CRDT update;
- rewinding the replicated document clock;
- restoring a full old snapshot;
- undoing remote edits;
- guaranteeing byte-for-byte restoration of what the local user saw at the time.

Undo is a new edit. It gets a fresh HLC timestamp and merges like any other local edit.

## Why local-only helps

If remote changes are not undoable, the local undo stack does not need to explain global causality to the user. It only tracks commands authored by this replica.

Example:

1. Local user sets `title = "A"`.
2. Remote user sets `title = "B"`.
3. Local user presses undo.

There are two plausible behaviors:

- Strong restore: set `title` back to the local command's previous value.
- Intent-aware undo: only undo if the local command is still the visible winner.

Because remote changes are not undoable, intent-aware undo is usually the better default. In this example, undoing the local `"A"` command should not overwrite remote `"B"` unless the local `"A"` is still the winning visible value.

## Option 1: Store realized patches and invert them later

This is closest to existing umkehr history.

For every local command:

```ts
type LocalCommand<T> = {
    id: string;
    changes: Patch<T>[];
    updates: CrdtUpdate[];
};
```

Undo:

1. Invert the stored `Patch` values.
2. Realize/translate those inverses against the current CRDT document.
3. Apply and broadcast the resulting CRDT updates.

Pros:

- Simple to understand.
- Reuses existing `invertPatch`.
- Works well for isolated primitive edits.

Cons:

- Stored patches are state-relative and array-index-relative.
- An inverse patch may point at the wrong current array item after concurrent inserts/reorders.
- The inverse may overwrite remote changes.
- A stored `replace` inverse says "put previous value back", not "remove my contribution if it still wins".

Verdict: useful as a prototype, but too blunt for collaborative undo.

## Option 2: Store CRDT updates and generate inverse CRDT updates

For every local command, store the generated CRDT updates:

```ts
type LocalCommand = {
    id: string;
    forward: CrdtUpdate[];
    inverse?: CrdtUpdate[];
};
```

Undo creates inverse updates from CRDT paths and timestamps, not from normal umkehr paths.

Pros:

- Stable array item IDs avoid index drift.
- Parent incarnation timestamps avoid attaching undo to the wrong recreated object.
- Undo can inspect whether the original local update is still relevant.

Cons:

- Current `CrdtUpdate` does not include enough previous-value information to construct inverses later.
- For `set`, we need the previous CRDT value/meta at that path.
- For `delete`, we need the deleted value/meta if undo should restore it.
- For `setOrder`, we need previous order values.

Verdict: good direction, but only if local command records capture undo metadata at command creation time.

## Option 3: Store local command records with before/after CRDT effects

This is the recommended model.

When applying a local command, record enough CRDT-addressed information to compensate it later:

```ts
type LocalCommand = {
    id: string;
    actor: string;
    status: 'done' | 'undone';
    forward: CrdtUpdate[];
    effects: LocalEffect[];
};

type LocalEffect =
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
```

The exact shape can be smaller than this, but the idea is:

- paths are CRDT paths, not umkehr paths;
- array items are item IDs, not indices;
- each effect records the local timestamp that made the change;
- each effect records the previous CRDT meta/order needed to compensate later.

Undo then walks the command effects in reverse order and emits fresh CRDT updates.

Pros:

- Stable under array reorder/index changes.
- Can avoid overwriting remote winners.
- Does not need to retain full snapshots.
- Keeps local undo stack separate from replicated update log.

Cons:

- Requires capturing effect metadata during local update creation.
- Requires a small helper layer below `createCrdtUpdates`, because current update creation only returns updates, not before/after effects.
- Needs clear conflict policy when remote edits have superseded local edits.

Verdict: best fit.

## Option 4: Operation-level undo with authorship metadata

Another route is to put author/command identity into every CRDT update and make values multi-value or operation-aware. Undo would mark one local operation as undone, and materialization would ignore undone operations.

Pros:

- Very principled for operation undo.
- Can express "remove my contribution" exactly.

Cons:

- Significantly changes the CRDT model.
- LWW registers stop being simple timestamps.
- Tombstones/order updates need extra authorship layers.
- More expensive metadata and more complicated materialization.

Verdict: too much machinery for the current design.

## Recommended design

Use local command records with CRDT-addressed effects.

Public-ish shape:

```ts
type CrdtLocalHistory<T> = {
    doc: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
};

function applyLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    draft: DraftPatch<T> | DraftPatch<T>[],
    clock: HLC,
): {
    history: CrdtLocalHistory<T>;
    updates: CrdtUpdate[];
    clock: HLC;
};

function undoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: HLC,
): {
    history: CrdtLocalHistory<T>;
    updates: CrdtUpdate[];
    clock: HLC;
};

function redoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: HLC,
): {
    history: CrdtLocalHistory<T>;
    updates: CrdtUpdate[];
    clock: HLC;
};
```

Remote updates are applied directly to `history.doc` and do not touch `undoStack` or `redoStack`.

## Undo conflict policy

Undo should be conservative. It should reverse local effects only when the original local effect is still the visible winner for that target.

For each effect:

### Primitive or container `set`

If the current target still has the command's `localTs`, undo can restore `before`.

- If `before` is missing, emit a fresh `delete`.
- If `before` is a tombstone, emit a fresh `delete`.
- Otherwise emit a fresh `set` with the materialized `before` value.

If the current target has a newer timestamp, skip this effect. A remote or later local command has already superseded it.

### `delete`

If the current target is still a tombstone with the command's `localTs`, undo can restore `before`.

If the key/item has been recreated with a newer timestamp, skip. The recreate is already the visible state.

### `setOrder`

For each affected item, if the current item order timestamp is still the command's `localTs`, emit a fresh `setOrder` restoring the previous order.

If the item has been deleted or reordered with a newer timestamp, skip that item.

This may partially undo a reorder. That is acceptable for v1 and matches the per-item LWW reorder model.

## Redo semantics

Redo should reapply the same local intent as a new CRDT command, not replay the old timestamps.

There are two options:

### Redo from stored forward values

Use the command's stored `after` values and emit fresh `set` / `delete` / `setOrder` updates.

Pros:

- Redo works even if original umkehr paths are no longer meaningful.
- Stable for arrays because effects use CRDT paths/item IDs.

Cons:

- If the target was deleted/recreated, parent incarnation checks may cause redo effects to be skipped.

### Redo by re-running the original draft callback

Store the original draft patch or command function and run it against current state.

Pros:

- Redo behaves more like "do the command again".
- Useful for semantic commands like "toggle done".

Cons:

- Harder to serialize.
- Callback commands may not be deterministic.
- Array indices can drift unless the command is re-bound to CRDT IDs.

Recommendation: redo from stored forward effects for v1. It is simpler, serializable, and aligned with local-only history.

## Grouping

The unit of undo should be a local command, not an individual CRDT update.

A single umkehr dispatch may create multiple realized patches, and each patch may create one or more CRDT updates. Those should undo together.

```ts
type LocalCommand = {
    id: string;
    label?: string;
    forward: CrdtUpdate[];
    effects: LocalEffect[];
};
```

The existing `resolveAndApply` nested-update behavior already groups multiple draft patches into one user-facing update. The CRDT history layer should preserve that grouping.

## Interaction with remote updates

Remote updates:

- advance the local HLC through `recv`;
- update the CRDT document;
- may make old local commands no longer undoable;
- do not clear the undo stack;
- do not enter the redo stack.

If a local command is skipped during undo because remote edits superseded every effect, it should still move to the redo stack as "undone" only if we consider the user action consumed. I lean yes: pressing undo should pop one local command even if it has no visible effect. The UI can expose a disabled/grey state later if we add command-effect availability checks.

## Redo stack clearing

Use normal local-history behavior:

- local command after undo clears the redo stack;
- remote update after undo does not clear the redo stack.

Reasoning: remote updates are not user intent from this replica. Clearing redo on remote traffic would make redo feel random in collaborative sessions.

## Capturing effects

Current `createCrdtUpdates(doc, patch, ts)` returns only updates. Undo wants a richer local result:

```ts
type CreatedCrdtCommand = {
    updates: CrdtUpdate[];
    effects: LocalEffect[];
};

function createLocalCrdtCommand<T>(
    doc: CrdtDocument<T>,
    patches: Patch<T>[],
    ts: HlcTimestamp,
): CreatedCrdtCommand;
```

Implementation approach:

1. Convert each realized `Patch` to CRDT update(s), as now.
2. Before applying each update locally, read the target meta/order from the current doc.
3. Store the before state in `LocalEffect`.
4. Apply the update to the local doc.
5. Store the after state if useful for redo.

This helper can replace direct calls to `createCrdtUpdates` in local-authoring flows. Remote replication can continue using raw `applyCrdtUpdate`.

## Important edge cases

### Local set, remote set, local undo

Local `title = "A"` at `ts=10`.
Remote `title = "B"` at `ts=20`.
Undo local command should not emit `title = old` because the local command is no longer the winner.

### Local set wins, local undo

Local `title = "A"` at `ts=20`.
Remote older `title = "B"` at `ts=10`.
Undo should restore the previous value with a fresh timestamp.

### Local delete, remote child update

If local delete wins and is still the current tombstone, undo can recreate the deleted value from `before`. Delayed older child updates that targeted the deleted incarnation should still be rejected by parent creation timestamps.

### Remote recreate before local undo

Local deletes `items.one`.
Remote recreates `items.one` with a newer timestamp.
Undo local delete should skip, because the item already has a newer incarnation.

### Local array insert, local undo

Undo should delete the inserted array item by item ID, not by current numeric index.

### Local array reorder, remote reorder, local undo

Undo should restore previous order only for items whose order timestamp is still the local reorder timestamp.

## Open questions

- Should skipped undo effects be surfaced to the caller for UI messaging?
  -> instead of "skipping", we should just block undo if any of the changes would be skipped.
- Should undo pop a command if all effects are skipped? I recommend yes for v1.
  -> same answer -- undo is blocked if any effect is skipped
- Should local commands store full `CrdtMeta` snapshots for `before`, or a compact materialized value plus schema path?
  -> materialized value should be fine, as long as we're retaining array IDs and such. then again, just going with crdtmeta might be simpler
- Do we need command labels for UI, or can that wait?
  -> that can wait
- Should redo preserve the original command grouping even if only some effects can currently apply? I recommend yes.
  -> I'd say that redo should also be blocked if any part of it would be "skipped"
- Should delete undo restore the entire deleted subtree exactly as it was, including internal timestamps, or create a new incarnation with one fresh timestamp? I recommend a new incarnation with a fresh timestamp, because undo is a new edit.
  -> fresh timestamps

## Recommendation

Implement local-only CRDT undo/redo as a command stack layered above `CrdtDocument`.

The stack should store local command effects addressed by CRDT paths and item IDs. Undo/redo should emit fresh CRDT updates and broadcast them normally. Remote updates should never enter local history and should not clear redo.

The key rule is conservative compensation: undo only reverses a local effect if that local effect is still the current winner for its target. This keeps undo from overwriting remote edits while still making local-only undo predictable and useful.
