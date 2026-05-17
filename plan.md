# React CRDT synced context implementation plan

This plan implements a React API for CRDT-backed umkehr state.

The target is a new entry point, likely `umkehr/react-crdt`, that provides an API similar to
`umkehr/react` while being explicit about the collaborative runtime differences.

## Goals

- Add a new `createSyncedContext` API for CRDT-backed React state.
- Preserve the normal leaf-component editing style:

```ts
const ctx = useTodos();
const title = useValue(ctx.$.todos[index].title);
ctx.$.todos[index].title('Published');
```

- Keep CRDT collaboration responsibilities out of leaf UI components.
- Put actor ID, HLC clock ownership, outbound update delivery, and inbound update subscription behind
  a provider `transport` prop.
- Keep remote update validation outside React. Validation belongs in transport/network code.
- Reuse shared React primitives from `src/react` instead of copying the whole implementation.
- Support local-only undo/redo through the existing CRDT history layer.
- Support preview updates and recompute previews on top of remote updates.
- Use efficient path notifications by translating CRDT paths back to normal umkehr paths. If that
  proves unreliable, update path APIs rather than falling back permanently to broad notifications.

## Non-goals

- Do not implement CRDT `createHistoryContext` yet.
- Do not implement branch/jump/history scrubber semantics.
- Do not implement annotations in CRDT React.
- Do not perform remote CRDT update validation inside React.
- Do not expose blocked undo/redo effects in the first API.

## Public API

Add:

```ts
import {createSyncedContext, useValue} from 'umkehr/react-crdt';
```

`createSyncedContext` mirrors `createStateContext` where practical:

```ts
const [Provider, useTodos] = createSyncedContext<State>('type');
```

Provider:

```tsx
<Provider
    initial={createCrdtLocalHistory(createCrdtDocument(initialState, schema, {timestamp: seedTs}))}
    transport={transport}
    save={saveLocalHistory}
>
    <App />
</Provider>
```

Hook result:

```ts
type SyncedContext<T, Tag extends string> = {
    latest(): T;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    useLocalHistory(): CrdtLocalHistory<T>;
    $: PatchBuilder<T, Tag, void, Context>;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming): void;
};
```

No `receiveRemoteUpdate` should be returned from the hook. Remote updates enter through the
transport object passed to the provider.

## CRDT remote apply split

Before building `react-crdt`, split the current CRDT remote history helper so React does not need to
know anything about remote HLC receive behavior.

Current helper:

```ts
applyRemoteUpdate(history, update, clock): {history, clock}
```

This combines two responsibilities:

- applying a remote CRDT update to local CRDT history;
- advancing a local HLC from the remote update timestamp.

For `react-crdt`, the transport should own the second responsibility. Add a clock-free helper:

```ts
export function applyRemoteHistoryUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
): CrdtLocalHistory<T>;
```

Keep the existing clock-aware helper for lower-level callers that want this convenience:

```ts
export function receiveRemoteUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
    clock: hlc.HLC,
): {history: CrdtLocalHistory<T>; clock: hlc.HLC};
```

Naming can be adjusted during implementation, but the API split should be clear:

- `applyRemoteHistoryUpdate` is pure history application and does not touch clocks.
- `receiveRemoteUpdate` is clock-aware convenience and can delegate to `applyRemoteHistoryUpdate`.
- `react-crdt` must use the clock-free function.
- transports should call `hlc.recv` or equivalent before delivering remote updates to the provider.

Existing tests that currently call `applyRemoteUpdate` should be updated to cover both paths:

- clock-free remote application keeps remote updates out of local undo history;
- clock-aware receive still advances the clock and preserves existing behavior.

## Transport API

The provider should receive a transport object that owns actor identity, clock, outbound update
publication, and inbound update subscription.

Initial shape:

```ts
type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};
```

Notes:

- `publish` is called only for local edits and local undo/redo.
- `subscribe` delivers remote updates to the provider.
- `tick` increments the local transport clock and returns the new local HLC for authoring local
  updates.
- Before `subscribe` calls `receive(update)`, the transport must already have incorporated the
  remote update timestamp into its own clock.
- The transport may validate remote updates before calling `receive`.
- The transport may batch updates internally, but the provider can start with one-at-a-time receive.
- The transport owns persistence of the clock if needed.

Optional follow-up shape if batches are more ergonomic:

```ts
subscribe(receive: (updates: CrdtUpdate[]) => void): () => void;
```

Start with single update delivery because it composes with `applyRemoteHistoryUpdate`.

## Provider props

```ts
type SyncedProviderProps<T> = {
    children: React.ReactElement;
    initial: CrdtLocalHistory<T>;
    transport: SyncedTransport;
    save?(history: CrdtLocalHistory<T>): void;
};
```

The provider should not create CRDT documents. Callers must construct the initial
`CrdtLocalHistory<T>` themselves with `createCrdtDocument` and `createCrdtLocalHistory`.

This keeps initial document metadata explicit and avoids hiding seed timestamp choices inside the
React layer.

## Internal context shape

The CRDT context should mirror the existing React context internals where possible:

```ts
type SyncedContextBase<T, Tag extends string> = {
    history: CrdtLocalHistory<T>;
    transport: SyncedTransport;
    save: (history: CrdtLocalHistory<T>) => void;
    previewState: T | null;
    raf?: number;
    listeners: (() => void)[];
    localHistoryListeners: (() => void)[];
    listenersByPath: PathListenerNode;
    queuedChanges: DraftPatch<T, Tag, Context>[];
    previewPaths: Record<string, Path>;
};
```

`Context.getForPath` should read from:

```ts
ctx.previewState ?? ctx.history.doc.state
```

## Shared React primitives

Before implementing `src/react-crdt`, extract shared code from `src/react/react.tsx` into reusable
modules.

Suggested layout:

```txt
src/react-core/
  index.ts
  listeners.ts
  preview.ts
  useValue.ts
  types.ts
```

Move or expose:

- `Context`
- `PathListenerNode`
- `makePathListenerNode`
- `addPathListener`
- `removePathListener`
- `notifyPaths`
- `notifyAllPaths`
- `changedPaths`
- `recordPreviewPaths`
- `clearPreviewState`
- `replacePreviewState`
- `useValue`

Keep public package exports unchanged for `umkehr/react`.

After extraction:

- `src/react/react.tsx` imports shared primitives.
- `src/react/index.ts` still exports the same API.
- Existing React tests should pass unchanged.

## CRDT path to normal path translation

Efficient remote notifications need to translate `CrdtPathSegment[]` to normal `Path`.

Add a CRDT helper, probably in `src/crdt/path.ts`:

```ts
export function normalPathForCrdtPath<T>(
    doc: CrdtDocument<T>,
    path: CrdtPathSegment[],
): Path | undefined;
```

Rules:

- `objectField` -> `{type: 'key', key}`
- `recordEntry` -> `{type: 'key', key}`
- `taggedField` -> append `{type: 'tag', key: tagKey, value: tagValue}` if entering a tagged
  branch, then append `{type: 'key', key}`
- `arrayItem` -> find the current live index for the array item ID and append `{type: 'key', key:
  index}`

For deleted or missing array items:

- try translating against the pre-apply document for delete updates;
- try translating against the post-apply document for set/add updates;
- return `undefined` if no reliable normal path exists.

For `setOrder`, the changed normal path is the array path itself.

Add helper:

```ts
export function changedNormalPathsForCrdtUpdate<T>(
    before: CrdtDocument<T>,
    after: CrdtDocument<T>,
    update: CrdtUpdate,
): Path[] | null;
```

Return `null` when translation fails. The React layer should then notify all paths for that update.

## Local dispatch

Committed local dispatch should:

1. Clear any active preview, keeping its paths for notification.
2. Resolve the draft patches against `ctx.history.doc.state` with `resolveAndApply`.
3. If no materialized change occurred, return.
4. Apply the realized patches with `applyLocalCommand(ctx.history, draft, transport.tick())`.
5. Do not store returned clocks in React; transport owns clock persistence.
6. Store `ctx.history = result.history`.
7. Call `save(ctx.history)`.
8. Notify root listeners.
9. Notify path listeners for the realized normal patch paths plus any cleared preview paths.
10. Notify local history listeners.
11. Call `transport.publish(result.updates)`.

`dispatch(v, 'preview')` should not create CRDT updates. It should behave like `src/react` preview:

1. Queue flat draft patches.
2. On animation frame, apply them to `ctx.previewState ?? ctx.history.doc.state`.
3. Store `ctx.previewState`.
4. Record and notify preview paths.

## Remote receive

Provider subscribes on mount:

```ts
useEffect(() => transport.subscribe((update) => receiveRemoteUpdate(ctx, update)), [transport]);
```

Remote receive should:

1. Capture `before = ctx.history.doc`.
2. Apply with `applyRemoteHistoryUpdate(ctx.history, update)`.
3. Store `ctx.history = result`.
4. Call `save(ctx.history)`.
5. Recompute active preview on top of the new committed state.
6. Notify root listeners.
7. Notify translated changed paths, or all paths if translation fails.
8. Notify local history listeners so `useLocalHistory`, `canUndo`, and `canRedo` update.

Remote receive must not:

- call `transport.publish`;
- enter local undo/redo stacks;
- run through normal patch dispatch.
- read or mutate HLC clocks.

## Preview plus remote updates

When remote updates arrive while preview is active:

1. Keep the queued preview patches.
2. Recompute preview from the new committed state.
3. Notify paths touched by the remote update and paths touched by the preview.

Implementation detail:

- Store preview draft patches, not only preview paths.
- Current `src/react` stores `queuedChanges` and `previewPaths`, but after preview is applied the
  queue is cleared. For recomputation, CRDT React needs a separate `previewChanges` list containing
  the active preview patches.

Suggested preview fields:

```ts
queuedPreviewChanges: DraftPatch<T, Tag, Context>[];
activePreviewChanges: DraftPatch<T, Tag, Context>[];
previewState: T | null;
previewPaths: Record<string, Path>;
```

On preview frame:

- move queued changes into active changes;
- apply all active changes to the committed base;
- update preview paths.

On committed local edit:

- clear preview.

On remote update:

- recompute active preview changes against the updated committed base.

## Undo/redo

Hook methods:

```ts
canUndo(): boolean;
canRedo(): boolean;
undo(): void;
redo(): void;
```

Implementation:

1. Clear/recompute preview policy: start by clearing preview before undo/redo.
2. Call `undoLocalCommand` or `redoLocalCommand` with `transport.tick()`.
3. Do not store returned clocks in React; transport owns clock persistence.
4. If result is not ok, return.
5. Compute changed paths from emitted CRDT updates, falling back to notify-all if needed.
6. Store `ctx.history`.
7. Call `save(ctx.history)`.
8. Notify listeners and local history listeners.
9. Call `transport.publish(result.updates)`.

Blocked undo/redo should simply no-op for now. `canUndo` and `canRedo` should already return false
when the top command is blocked.

## Hook result and subscriptions

`useLocalHistory()` should subscribe to `localHistoryListeners` and return `ctx.history`.

`canUndo()` and `canRedo()` should call:

```ts
canUndoLocalCommand(ctx.history)
canRedoLocalCommand(ctx.history)
```

Components that display `canUndo`/`canRedo` should call `useLocalHistory()` to re-render when remote
updates or local stack changes affect the answer. This mirrors current `createHistoryContext`, where
components call `ctx.useHistory()` when they need history-derived reactivity.

## Tests

Create `src/react-crdt/react-crdt.test.tsx`.

Mirror key `src/react` state tests:

- renders subscribed values and dispatches committed updates;
- notifies path subscribers for changed local paths only;
- applies preview updates without publishing;
- clears preview on committed local edit;
- recomputes preview after remote update;
- supports selector/modifier form of `useValue`;
- updates subscribers when provider receives new initial value, if this behavior is kept.

Add CRDT-specific tests:

- local dispatch publishes CRDT updates through transport;
- remote update received through transport updates subscribed values;
- remote update does not call `publish`;
- remote update calls `save`;
- local undo emits CRDT updates and publishes them;
- remote superseding update disables/no-ops undo;
- redo works after undo and publishes updates;
- `useLocalHistory()` re-renders on local, remote, undo, and redo;
- multiple providers with a test transport converge on edits.

Add package smoke coverage:

- `umkehr/react-crdt` imports separately;
- root `umkehr` does not export React CRDT APIs;
- `umkehr/react` remains unchanged.

## Example migration

Update `examples/react-crdt` to use `umkehr/react-crdt`.

The example should keep the current separation:

- transport/router owns message routing and clocks;
- provider owns CRDT React context for a replica;
- panel components use `ctx.$`, `useValue`, `ctx.undo`, and `ctx.redo`.

Expected structure:

```tsx
const [Provider, useTodos] = createSyncedContext<State>('type');

function ReplicaHost({transport}) {
    return (
        <Provider initial={initialHistory} transport={transport}>
            <TodoPanel />
        </Provider>
    );
}
```

`TodoPanel` should become close to the normal React example and should not know about CRDT update
objects.

## Package changes

Update `package.json` exports:

```json
"./react-crdt": {
    "types": "./dist/src/react-crdt/index.d.ts",
    "import": "./dist/src/react-crdt/index.js"
}
```

Ensure `npm run pack:check` includes the new built files.

## Implementation order

1. Split the CRDT remote history API into clock-free apply and clock-aware receive helpers.
2. Extract shared React primitives into `src/react-core`.
3. Update `src/react/react.tsx` to import those primitives; keep behavior unchanged.
4. Add CRDT path-to-normal-path translation helpers and tests.
5. Add `src/react-crdt/index.ts` and `src/react-crdt/react-crdt.tsx`.
6. Implement `createSyncedContext` provider and hook without preview first.
7. Add local dispatch, clock-free remote receive, undo, redo, and transport integration.
8. Add preview support, including preview recomputation after remote updates.
9. Add React CRDT tests.
10. Add package export and smoke tests.
11. Migrate `examples/react-crdt`.
12. Run `npm run typecheck`, `npm test`, example build, and `npm run pack:check`.

## Risks

- CRDT path-to-normal-path translation may be tricky around deleted array items and reordered arrays.
  If translation fails often, we may need to enrich CRDT updates with original normal paths for local
  changes and a best-effort affected-parent path for remote changes.
- Extracting `src/react-core` can accidentally change `umkehr/react` behavior. The first step should
  be covered by the existing React test suite before adding CRDT behavior.
- Preview recomputation requires storing active preview patches, which differs from current
  `src/react` internals. Keep this contained to `react-crdt` unless/until the normal React preview
  implementation needs the same behavior.
- The transport API may need a batch receive form later, but single-update receive is enough for the
  first pass.
