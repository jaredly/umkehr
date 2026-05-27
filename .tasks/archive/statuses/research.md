# Statuses / notices research

This document maps the existing architecture relevant to path-scoped sync notices and records open questions before designing the public API.

The requested shape is plausible: a hook parallel to `useValue`, tentatively `useStatuses` or `useNotices`, where sync code can attach status records to arbitrary state paths and UI code can subscribe either to exactly one path or to a path plus its descendants.

## Existing architecture

### Path-addressed state API

State paths are already first-class in the React APIs:

- `PatchBuilderInternal` carries a hidden path via `getPathSymbol` and context via `getExtraSymbol` in `src/types.ts`.
- `useValue` in `src/react-core/index.ts` extracts the builder path with `getPath(node)` and subscribes through `extra.listenToPath(path, listener)`.
- `createPatchDispatcher` and `makeContextForPath` are the bridge between typed path builders and runtime path lookup/subscription.

This means a statuses hook can probably accept the same typed builder nodes as `useValue`:

```ts
const itemStatuses = useStatuses(editor.$.todos[index]);
const subtreeStatuses = useStatuses(editor.$.todos[index], {descendants: true});
```

The hidden path API is already sufficient for locating the status subscription path without making callers pass raw arrays.

### Current path listener behavior

Path listeners live in `src/framework-core/index.ts`.

`notifyPaths(root, paths)` intentionally notifies:

- listeners attached to the changed path;
- ancestor listeners of the changed path;
- descendant listeners under the changed path.

`useValue` defaults to `exact = true`, but that exactness is implemented by comparing the selected value after a notification, not by suppressing ancestor/descendant notifications.

Implication for `useStatuses`:

- An exact statuses hook can subscribe to the existing style of path notification and then recompute only statuses whose `status.path` exactly equals the hook path.
- A descendant statuses hook can subscribe to the same listener and recompute statuses whose path is equal to, or below, the hook path.
- No listener-tree change is required for correctness, though a dedicated status listener tree is likely cleaner than mixing value listeners with status-only notifications.

### React CRDT provider

`src/react-crdt/react-crdt.tsx` owns the synced editor runtime:

- `createSyncedContext` creates a provider and a hook returning `latest`, undo/redo, `useLocalHistory`, `$`, and `dispatch`.
- `SyncedContextBase` stores `history`, `transport`, preview state, path listeners, local history listeners, and queued preview patches.
- Local drafts call `applyLocalCommand`, save history, notify changed paths, then publish CRDT updates.
- Remote updates call `applyRemoteHistoryUpdate`, save history, compute changed normal paths, then notify only affected paths when possible.
- Undo/redo similarly compute changed paths from emitted CRDT updates.

The key helper is `changedNormalPathsForCrdtUpdate` from `src/crdt/path.ts`. It maps CRDT paths back to public "normal" paths and is already used for minimal React invalidation.

Implication:

The generic synced provider is a natural place to host a status registry because it already has:

- typed path builders through `$`;
- path listeners;
- change notification helpers;
- access to local and remote CRDT update application.

But it currently has no sync-layer extension point other than `SyncedTransport`, and `SyncedTransport` only publishes/subscribes raw `CrdtUpdate[]`.

### Local-first sync layer

The local-first example lives under `examples/react-crdt/src/lib/local-first`.

Important current pieces:

- `useLocalFirstSync.ts` is a sync orchestrator around PeerJS, durable batches, snapshots, compaction, and replay.
- It exposes `stateStore`, `persistenceStore`, `statsStore`, and `connectionsStore` as external stores.
- `LocalFirstStats` currently includes coarse snapshot/replay data:
  - `pendingSnapshot`
  - `replayPreview`
  - `snapshotStatus`
  - `compactionStatus`
- `replay.ts` implements `buildSnapshotReplayPreview`.

`buildSnapshotReplayPreview` currently:

1. filters retained local batches that are not dominated by the incoming snapshot frontier;
2. starts from the peer snapshot document;
3. reapplies local retained CRDT updates;
4. counts updates that become pending or throw;
5. returns the preview history and vector.

The preview object stores the resulting state but not the specific paths changed, conflicted, skipped, or deleted by the replay.

Implication:

The requested "which parts of state would be impacted by this local replay" cannot be answered directly from `LocalFirstStats` today. We need either:

- a state-diff step between the current local state, the pending snapshot state, and the replay result; or
- path/status collection during replay, using CRDT update paths and before/after documents.

### Todo example

`examples/react-crdt/src/apps/todos/TodoPanel.tsx` currently reads values with `useValue`:

```ts
const todos = useValue(editor.$.todos);
```

Each item receives `todo` and `index`, then edits through `editor.$.todos[index]`.

A path-scoped hook would fit this component naturally:

```ts
const statuses = useStatuses(editor.$.todos[index], {descendants: true});
```

The item can then set a class or inline style when `statuses.length > 0`, for example adding an outline around todo items impacted by a replay preview.

One practical caveat: array index paths are unstable across reorder/delete. CRDT update paths use stable array item IDs internally, but UI builder paths use normal numeric indices. Existing invalidation maps CRDT paths back to current normal paths with `normalPathForCrdtPath`. Status producers should do the same and avoid storing long-lived statuses only by numeric array index when the underlying target is a CRDT array item.

## Candidate status model

A status should be separate from the document state. It is derived runtime metadata, not persisted app data.

Candidate shape:

```ts
type SyncStatusKind =
    | 'changed'
    | 'conflict'
    | 'deleted-in-peer'
    | 'pending'
    | 'skipped'
    | string;

type SyncStatus = {
    id: string;
    path: Path;
    kind: SyncStatusKind;
    source?: string;
    severity?: 'info' | 'warning' | 'error';
    message?: string;
    data?: unknown;
};
```

Useful properties:

- `id` lets consumers render stable lists and lets producers replace/remove one status.
- `path` controls subscription and UI scoping.
- `kind` is machine-readable and extensible.
- `message` is optional because many UIs will map `kind` to local copy.
- `data` keeps the API flexible for replay batch ids, actor ids, timestamps, or debug detail.

Open design choice: whether `kind` should be a closed exported union for core statuses, an open string, or a generic type parameter supplied by a sync adapter.

## Candidate subscription API

Parallel to `useValue`:

```ts
function useStatuses<Current, Tag extends PropertyKey>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
    options?: {descendants?: boolean; kinds?: string[]},
): SyncStatus[];
```

Default behavior should match the task: exact path only.

`{descendants: true}` should include statuses on the path and all child paths. This is what the Todo row wants, because a title-level conflict should decorate the whole row.

Naming:

- `useStatuses` is direct and pairs well with status `kind`.
- `useNotices` is broader and sounds more UI-facing.
- `useSyncStatuses` is explicit but longer.

Recommendation for planning: use `status` in lower-level types and `useStatuses` for the hook unless we decide these are not sync-specific.

## Candidate mutation API

The sync layer needs a way to publish statuses into the React context. Options:

### Provider-owned status controller

Extend `SyncedContext` with imperative status methods:

```ts
type SyncedContext<T, Tag extends string = 'type'> = {
    // existing fields...
    setStatuses(statuses: SyncStatus[]): void;
    clearStatuses(source?: string): void;
    useStatuses(...): SyncStatus[];
};
```

Pros:

- keeps statuses scoped to one synced provider;
- uses existing typed `$` paths for reads;
- easy for UI code to consume.

Cons:

- sync producers outside the provider, such as `useLocalFirstSync`, need access to this controller.
- puts non-document sync metadata into the editor API.

### Separate status store passed into provider

Create a generic status store and let the provider expose it to hooks:

```ts
type StatusStore = {
    get(path: Path, options?: {descendants?: boolean}): SyncStatus[];
    replace(source: string, statuses: SyncStatus[]): void;
    clear(source: string): void;
    subscribe(path: Path, options: {descendants?: boolean}, listener: () => void): () => void;
};
```

Pros:

- sync adapters can own and update statuses without needing the editor context;
- the provider/hook only needs to wire typed paths to the store;
- easier to use outside React later.

Cons:

- more API surface;
- provider setup gets another prop or default internal store.

### Transport-level statuses

Extend `SyncedTransport`:

```ts
type SyncedTransport = {
    // existing fields...
    statuses?: StatusStore;
};
```

Pros:

- statuses are clearly sync-layer output;
- local-first sync can provide the status store alongside the transport it already returns.

Cons:

- some statuses may be editor/runtime derived rather than transport derived;
- `SyncedTransport` is currently a small CRDT update boundary, and this would make it React/UI-adjacent unless the store is framework-neutral.

Most likely direction:

Keep `StatusStore` framework-neutral, optionally hang it off transport or provider props, and expose `useStatuses` from `umkehr/react-crdt` by reading that store through the current provider.

## How replay statuses could be produced

For local-first snapshot replay, useful statuses likely come from comparing three states:

- local current state before accepting the snapshot;
- pending peer snapshot state;
- replay preview state after local retained batches are applied to the snapshot.

Potential classifications:

- `changed`: the replay preview value differs from the peer snapshot value at this path.
- `deleted-in-peer`: a local value exists but the pending peer snapshot does not contain the corresponding value.
- `skipped`: a retained local update could not be applied during replay.
- `conflict`: a local retained update targets a value also changed by the peer snapshot, or replays to a different value than the current local state.

Implementation options:

- Diff `pending.document.state` against `preview.history.doc.state` to find replay-impact paths. This is straightforward for `changed`, but it does not identify skipped/deleted local targets well.
- During replay, call `changedNormalPathsForCrdtUpdate(before, after, update)` after each successful update. This is closer to existing CRDT invalidation and naturally tracks applied update paths.
- For skipped updates, attempt to map the update path against the current local document before the snapshot and/or the pending snapshot. If it maps locally but not in the snapshot, classify as `deleted-in-peer` or `skipped`.
- Add a generic deep diff helper over plain state when we need to compare final preview/current/snapshot values independent of CRDT updates.

The replay code currently discards path detail when it increments `skippedUpdates`. That function is the main place that would need richer instrumentation.

## Other likely uses

Beyond local replay previews, the same API could support:

- marking paths with unresolved remote updates in `doc.pending`;
- showing schema migration warnings for fields changed by migration;
- showing compaction/snapshot risk on state that exists only in local retained batches;
- showing validation errors or soft warnings if validation becomes path-aware;
- showing presence/cursor metadata if a future transport reports "peer is editing this item";
- showing optimistic write state or offline durability state for paths with unsaved local changes.

This argues for "status/notices on paths" as a generic runtime metadata channel, not a one-off replay preview data structure.

## Open questions

- Should statuses be part of the public `umkehr/react-crdt` API, only the example local-first runtime, or a lower-level `react-core` primitive?
  - part of the api
- Should the status store be owned by `createSyncedContext`, passed as a provider prop, or exposed from `SyncedTransport`?
  - passed in to the provider
- Is the hook named `useStatuses`, `useNotices`, or `useSyncStatuses`?
  - useStatuses
- Should status `kind` be a closed union, an open string, or generic over the app/sync adapter?
  - open string
- What should exact path matching mean for array items after reorder/delete? Do we need a stable item identity helper for statuses, or is recomputing normal paths on each status update enough?
  - same as what it means for useValue
- Should descendant subscriptions include statuses on the subscribed path itself? The expected Todo row behavior suggests yes.
  - yes
- Do statuses need priorities/severity, or should UI map `kind` to presentation?
  - UI deals with it. no need for severity. and status should be more general than just 'sync'
- Should statuses have lifecycle ownership by `source`, so a producer can replace all statuses from `local-first/replay-preview` without disturbing other producers?
  - hm use your judgement, haven't thought that far
- Should stale statuses be cleared automatically when history changes, when preview is accepted/discarded, or only when the producer clears them?
  - only when the producer clears them
- How much replay classification is required for the first version: only `changed`, or also `deleted-in-peer`, `skipped`, and `conflict`?
  - for this version let's not actually do replay-related stuff. we're just ironing out the statuses api
- Can `conflict` be defined precisely with current CRDT metadata, or should the first API avoid promising conflict semantics beyond "replay impact"?
  - again we'll deal with this later
- Should statuses be serializable for devtools/export, or intentionally runtime-only?
  - I don't think they should be persisted/serialized
- Should the hook support filtering by `kind` to avoid rerendering consumers that only care about conflicts?
  - sure
- Should non-React consumers get a direct subscribe/read API from the status store?
  - yeah it should be implemented in a way that non-react consumers can access it
