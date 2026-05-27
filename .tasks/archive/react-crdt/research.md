# React CRDT API research

This document explores a React API for the CRDT layer that feels as close as possible to the
current `src/react` API.

The goal is that an app using `umkehr/react` can switch to a CRDT-backed context with minimal
component changes. In the best case, leaf components keep using:

```ts
const [Provider, useStateContext] = createStateContext<State>('type');
const ctx = useStateContext();
const title = useValue(ctx.$.title);
ctx.$.title('Published');
ctx.undo();
ctx.redo();
```

The main differences should live at provider setup and network integration boundaries, not in every
field editor.

## Current React API

`src/react` exposes:

- `createStateContext<T, Tag>(tag, equalFn?)`
- `createHistoryContext<T, An, Tag>(tag, equalFn?)`
- `useValue(node, mod?, exact?, equalFn?)`

`createStateContext` returns:

```ts
const [Provider, useStateContext] = createStateContext<State>('type');
```

The provider takes:

```ts
<Provider initial={state} save={optionalSave}>
    <App />
</Provider>
```

The hook returns an object with:

- `latest()`
- `clearPreview()`
- `$`
- `dispatch`

`createHistoryContext` has the same basic shape, but the provider receives a `History<T, An>` and
the hook also exposes:

- `onHistoryChange(f)`
- `useHistory()`
- `tip()`
- `clearHistory()`
- `canUndo()`
- `canRedo()`
- `undo()`
- `redo()`
- `previewJump(id)`
- `updateAnnotations`

Most app code depends on only a small subset:

- `useValue(ctx.$.path)`
- `ctx.$.path(value)`
- `ctx.$.path(value, 'preview')`
- `ctx.clearPreview()`
- `ctx.canUndo()`
- `ctx.canRedo()`
- `ctx.undo()`
- `ctx.redo()`

That subset is a good compatibility target.

## CRDT constraints

The CRDT runtime needs information the current React API does not:

- a typia JSON schema collection;
- an initial HLC timestamp for the CRDT document;
- a local HLC clock or local actor ID;
- a way to emit local CRDT updates to the network;
- a way to receive remote CRDT updates;
- optional validation of remote CRDT updates;
- local-only undo/redo stacks, not `History<T, An>`.

The current CRDT state holder is:

```ts
type CrdtLocalHistory<T> = {
    doc: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
};
```

This means CRDT React should probably not reuse `History<T, An>` internally. It should provide a
similar UI-facing API while using `CrdtLocalHistory<T>` under the hood.

## Recommended public entry point

Add a new package export:

```json
"./react-crdt": {
    "types": "./dist/src/react-crdt/index.d.ts",
    "import": "./dist/src/react-crdt/index.js"
}
```

Export names should initially mirror `umkehr/react`:

```ts
export {createStateContext, useValue} from 'umkehr/react-crdt';
```

Open question: whether to also export `createHistoryContext`. Since CRDT undo/redo is not the same
as the existing branching `History` tree, a `createHistoryContext` export may imply too much
compatibility. There are two viable options:

1. Export only `createStateContext` first, but include `undo`/`redo` on its hook result.
2. Export `createHistoryContext` as an alias-like API for local CRDT history, but document that
   `useHistory`, `tip`, `jump`, branch annotations, and history scrubber features are not the same.

Recommendation: start with `createStateContext` in `umkehr/react-crdt`. It can still expose
`canUndo`, `canRedo`, `undo`, and `redo`, because those are local command stack operations.

## Proposed API

```ts
const [Provider, useStateContext] = createStateContext<State>('type');
```

The component API should stay close to the existing one:

```tsx
function TitleEditor() {
    const ctx = useStateContext();
    const title = useValue(ctx.$.title);

    return (
        <button type="button" onClick={() => ctx.$.title('Published')}>
            {title}
        </button>
    );
}
```

The CRDT provider needs richer props:

```tsx
<Provider
    initial={initialState}
    schema={typia.json.schemas<[State], '3.1'>()}
    actor="replica-a"
    onLocalUpdates={(updates) => send(updates)}
>
    <App />
</Provider>
```

For explicit clock ownership:

```tsx
<Provider
    initial={initialState}
    schema={schemas}
    clock={clock}
    onClockChange={setClock}
    onLocalUpdates={send}
>
    <App />
</Provider>
```

The actor-based form is nicer for app authors. Internally the provider can initialize:

```ts
hlc.init(actor, Date.now())
```

The explicit clock form is useful for persistence and deterministic tests. We can support both:

```ts
type CrdtProviderProps<T> = {
    children: React.ReactElement;
    initial: T;
    schema: IJsonSchemaCollection<'3.1', [T]>;
    tagKey?: string;
    actor?: string;
    clock?: hlc.HLC;
    timestamp?: HlcTimestamp;
    save?(snapshot: CrdtLocalHistory<T>): void;
    onClockChange?(clock: hlc.HLC): void;
    onLocalUpdates?(updates: CrdtUpdate[]): void;
    validateRemoteUpdates?: boolean;
};
```

Validation note: if `validateRemoteUpdates` is true, the provider can create a
`createCrdtUpdateValidator(schema, {tagKey})` and reject malformed remote updates before applying
them.

## Hook result

The CRDT hook should return:

```ts
type CrdtStateContext<T, Tag extends string> = {
    latest(): T;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    receiveRemoteUpdate(update: CrdtUpdate): void;
    receiveRemoteUpdates(updates: CrdtUpdate[]): void;
    useRuntime(): CrdtLocalHistory<T>;
    $: PatchBuilder<T, Tag, void, Context>;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming): void;
};
```

The most important compatibility pieces are `latest`, `clearPreview`, `$`, `dispatch`, `canUndo`,
`canRedo`, `undo`, and `redo`.

`receiveRemoteUpdate` is intentionally new. Components usually should not call it; the transport
boundary should. But exposing it on the hook makes simple apps and demos easy without adding another
context.

`useRuntime()` is the CRDT equivalent of `useHistory()`. It should subscribe to runtime changes and
return the current `CrdtLocalHistory<T>`. The name should not be `useHistory()` unless we are willing
to make it look enough like `History<T, An>`.

## Preview behavior

The current React API supports preview updates:

```ts
ctx.$.title('Preview', 'preview');
ctx.clearPreview();
```

This can remain local-only and not emit CRDT updates. The preview state should be computed with
`resolveAndApply` against the materialized CRDT state:

- committed base: `ctx.history.doc.state`;
- preview base: `ctx.previewState ?? ctx.history.doc.state`;
- preview changes: normal draft patches;
- path notification: same path listener tree as `src/react`.

On commit after preview, clear preview and apply the committed patch against the current CRDT
history. This matches current `src/react` behavior closely enough.

Remote updates arriving during preview need careful notification:

1. Apply the remote CRDT update to the committed CRDT history.
2. Keep or clear preview?

Recommendation: keep preview if possible, but recompute preview on top of the new committed state on
the next animation frame. If that is too much for the first pass, clear preview on any remote update.
Clearing preview is less surprising than showing a preview based on stale state.

## Dispatch behavior

Committed local dispatch should:

1. Resolve normal draft patches with `resolveAndApply`.
2. Convert those patches to CRDT updates with `applyLocalCommand`.
3. Update local `CrdtLocalHistory<T>` and HLC clock.
4. Notify value/path listeners.
5. Notify runtime/history listeners.
6. Call `save`.
7. Call `onLocalUpdates`.

Undo/redo should:

1. Call `undoLocalCommand` or `redoLocalCommand`.
2. If blocked or empty, update the clock if needed and return.
3. Update local runtime.
4. Notify listeners for changed materialized paths.
5. Call `save`.
6. Call `onLocalUpdates`.

The tricky part is changed paths. CRDT updates carry CRDT paths, not normal `Path` values. The React
subscription tree currently listens on normal builder paths. Options:

1. Conservative first pass: notify all path listeners after every CRDT commit/remote/undo/redo.
2. Add CRDT-path-to-normal-path translation for updates whose current materialized path is known.
3. Record changed normal paths when local changes originate from normal patches, but notify all for
   remote updates.

Recommendation: use option 3 initially. Local updates can preserve the efficient changed paths from
`resolveAndApply`; remote updates can notify all. This keeps component edits efficient while avoiding
fragile CRDT path reverse mapping.

## Receiving remote updates

Remote update application should:

```ts
const result = applyRemoteUpdate(ctx.history, update, ctx.clock);
ctx.history = result.history;
ctx.clock = result.clock;
```

Remote updates must not:

- enter local undo/redo stacks;
- call `onLocalUpdates`;
- run through normal patch dispatch;
- trigger `save` as if they were local user edits, unless `save` is explicitly defined as
  "persist every runtime state".

Open question: should `save` run for remote updates? Current `src/react` uses `save` for every local
committed state. In CRDT apps, persistence usually needs both local and remote applied state. I would
define `save` as "runtime snapshot changed" and call it for local, remote, undo, and redo.

## Identical API feasibility

Fully identical API is realistic for `createStateContext` consumers that use:

- `Provider initial save`
- `ctx.$`
- `ctx.dispatch`
- `ctx.latest`
- `ctx.clearPreview`
- `useValue`

It is not fully identical at provider setup because CRDT needs a schema and actor/clock.

`createHistoryContext` cannot be truly identical because:

- `History<T, An>` is a branching tree;
- CRDT local history is a flat undo/redo command stack;
- remote changes are not undoable;
- annotations and `updateAnnotations` do not currently have a CRDT design;
- `jump` and `previewJump` do not map cleanly to CRDT state.

The best migration path is:

```diff
- import {createHistoryContext, useValue} from 'umkehr/react';
+ import {createStateContext, useValue} from 'umkehr/react-crdt';

- const [Provider, useTodos] = createHistoryContext<State, never>('type');
+ const [Provider, useTodos] = createStateContext<State>('type');
```

Then provider setup changes:

```diff
- <Provider initial={blankHistory(initial)} save={saveHistory}>
+ <Provider initial={initial} schema={schemas} actor={actor} onLocalUpdates={send}>
```

Most leaf components can stay the same if they only call `ctx.$`, `useValue`, `ctx.undo`, and
`ctx.redo`.

## Possible implementation layout

```txt
src/react-crdt/
  index.ts
  react-crdt.tsx
  listeners.ts
  preview.ts
  runtime.ts
```

Reuse or move shared code from `src/react/react.tsx`:

- path listener tree;
- `useValue`;
- preview queueing;
- `Context` type;
- `createPatchDispatcher` integration.

Avoid copy/paste long-term by extracting shared React primitives:

```txt
src/react-core/
  listeners.ts
  preview.ts
  useValue.ts
```

But for a first pass, duplicating a small amount may be acceptable if it avoids destabilizing
`umkehr/react`.

## Suggested first pass

1. Add `src/react-crdt/index.ts`.
2. Implement `createStateContext` with CRDT provider props.
3. Export `useValue`, either reused directly or moved to a shared module.
4. Support committed local dispatch.
5. Support local-only `undo`/`redo`.
6. Support `receiveRemoteUpdate(s)`.
7. Support preview updates, clearing preview on remote updates.
8. Notify exact changed paths for local draft commits and notify all paths for remote CRDT updates.
9. Add a React CRDT test suite mirroring the current `createStateContext` tests plus remote update
   and local undo/redo tests.
10. Update `examples/react-crdt` to use `umkehr/react-crdt` instead of its custom runtime wrapper.

## Open questions

- Should the provider own HLC clocks via `actor`, or should apps pass `clock/onClockChange`? I think
  support both, with `actor` as the common path.
- Should `save` be called for remote updates? I think yes, because the runtime snapshot changed.
- Should blocked undo/redo expose the blocked effects? Current UI only needs booleans, but debugging
  may benefit from `lastUndoRedoFailure()` or an `onUndoRedoBlocked` callback.
- Should remote validation be on by default? For app-controlled transports, default off is simpler;
  for network payloads, default on is safer. I lean toward default on when `schema` is provided.
- Should `createHistoryContext` exist in `react-crdt`? I would defer it until there is a concrete
  CRDT story for history inspection, annotations, and scrubber UI.

# Feedback


let's have validation of remote CRDT updates live outside of the react-specific stuff. Seems like a transport layer thing.

let's call it `createSyncedContext` to be explicit about there being differences.

I don't think I like having `recieveRemoteUpdate` being returned by the crdt hook. I think instead we should have some kind of a `Transport` object that gets passed into the Provider. This would also replace the proposed `onLocalUpdates` prop.

instead of `useRuntime`, how about `useLocalHistory`.

for preview + remote updates, yeah let's recompute the preview on top of remote udpate.

for changed path notifications: let's try crdt-path-to-normal-path translation. If that fails, we should change the API of paths such that we can reliably compute efficient updates.

for the question about `save` running for remote updates: yes it should.

extracting shared stuff sounds great

for the question about clocks -- the `transport` prop to the provider should also own the clock & actor id.

blocked undo/redo doesn't need to expose effects.

remote validation should be handled by the transport, not by the react infrastructure
