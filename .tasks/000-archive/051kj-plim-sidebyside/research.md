# Research: Plim Side-by-Side CRDT Example

## Goal

Expand `examples/plim-block-crdt` from a single Plim editor plus scripted remote buttons into a two-pane CRDT demo, similar in spirit to `examples/block-rich-text`.

The requested product change is:

- show two Plim editor panes backed by independent block-CRDT replicas
- local edits in either pane should sync to the other pane
- remove the current `Remote Insert` and `Remote Split` buttons because side-by-side editing makes scripted remote actions redundant

## Current Plim Example

Relevant files:

- `examples/plim-block-crdt/src/App.tsx`
- `examples/plim-block-crdt/src/plimBlockCrdtAdapter.ts`
- `examples/plim-block-crdt/src/fixtures.ts`
- `examples/plim-block-crdt/src/style.css`
- `examples/plim-block-crdt/src/App.test.tsx`

`App.tsx` currently owns one adapter instance:

```ts
const [adapter, setAdapter] = useState<AdapterState>(() => createAdapterState(createFixtureState()));
```

The adapter contains:

```ts
type AdapterState = {
    crdt: CachedState<PlimBlockMeta>;
    plim: EditorState;
    retainedSelection: RetainedSelection | null;
};
```

Local Plim transactions flow through:

```ts
applyLocalTransaction(current, tx, options, state)
```

That translates Plim transaction ops to block CRDT ops, applies them locally, derives the next retained selection, and rematerializes a fresh Plim `EditorState` from CRDT.

Scripted remote actions currently call block CRDT helpers directly:

- `insertTextOps(...)`
- `splitBlockOps(...)`
- `applyRemoteOps(current, ops)`

Those actions update the same single adapter and then rematerialize Plim. They should be removed from the UI and tests once real peer editing exists.

## Adapter Readiness

The adapter already exposes the key primitives needed for two panes:

- `createAdapterState(initialCrdt)`
- `applyLocalTransaction(adapter, tx, options, postPlim)`
- `applyRemoteOps(adapter, ops)`
- retained selection conversion via `selectionToRetained` and `resolveSelection`

`applyRemoteOps` is already shaped for peer replication:

```ts
const result = applyRemoteMany(adapter.crdt, ops);
return {
    ...result,
    crdt: result.state,
    plim: createPlimEditorState(result.state, adapter.retainedSelection),
    retainedSelection: adapter.retainedSelection,
};
```

That means a local transaction from pane A can produce `next.ops`, apply them to pane A immediately, and pass the same ops to pane B through `applyRemoteOps`.

One important detail: local editor state sync is currently guarded by a single `applyingFromCrdt` ref. In a two-pane app, this state needs to move into a reusable editor pane component so each Plim editor has its own driver, handle, and "programmatic update" guard.

## Block Rich Text Pattern

`examples/block-rich-text` uses a richer architecture than this task probably needs:

- two replicas: `left` and `right`
- per-replica actor ids
- per-replica selections
- online/offline toggles and queued ops
- history replay, import/export, undo/redo, keystroke log
- a custom editor DOM rather than Plim

The closest useful pieces are conceptual:

- represent each side as a named replica
- run commands against one replica
- apply the resulting ops to the peer replica
- keep each editor's local selection separate
- style the editors as a two-column grid with per-pane headings/status

The Plim example should probably avoid copying the whole history/replay system. A small local `DemoState` is enough for the requested side-by-side behavior.

## Proposed Implementation Shape

Introduce app-level replica state:

```ts
type EditorId = 'left' | 'right';

type Replica = {
    id: EditorId;
    label: string;
    actor: string;
    adapter: AdapterState;
};

type DemoState = {
    left: Replica;
    right: Replica;
};
```

Initialize both replicas from the same fixture CRDT:

```ts
const initial = createFixtureState();
left.adapter = createAdapterState(initial);
right.adapter = createAdapterState(initial);
```

Use distinct actors for generated local ops, for example `plimleft` and `plimright`, and distinct timestamp generators or actor-bearing Lamport/HLC values as required by the existing helpers. The current `makeTs(500)` returns string HLC values and is shared by the single editor. Sharing one monotonically increasing `ts` closure across both panes is likely sufficient for this example, but per-replica `ts` closures would make logs easier to reason about.

Create a reusable component, tentatively `PlimReplicaEditor`, that owns:

- `new PlimDriver(...)`
- `useEditorHandle()`
- `applyingFromCrdt` ref
- effect that calls `editor.setState(replica.adapter.plim)` when adapter state changes
- `onTransaction` handler that calls back to the parent with `(editorId, tx, postPlimState)`
- `SlashCommandMenu` for that editor handle

The parent `onTransaction` should:

1. Ignore transactions that came from `editor.setState`.
2. For selection-only transactions, update only the source replica's `plim` and `retainedSelection`.
3. For edit transactions, call `applyLocalTransaction` on the source replica.
4. Apply the resulting CRDT ops to the peer replica with `applyRemoteOps`.
5. Append one concise log line.

Sketch:

```ts
setDemo((current) => {
    const source = current[id];
    const peerId = id === 'left' ? 'right' : 'left';

    const nextSource = applyLocalTransaction(source.adapter, tx, optionsById[id], postPlim);
    const nextPeer = nextSource.ops.length
        ? applyRemoteOps(current[peerId].adapter, nextSource.ops)
        : current[peerId].adapter;

    return {
        ...current,
        [id]: {...source, adapter: nextSource},
        [peerId]: {...current[peerId], adapter: nextPeer},
    };
});
```

Selection-only transactions should stay local. They should not overwrite the peer's selection, and they should not create CRDT ops.

## UI Notes

The current layout is:

- left: single `.editorPane`
- right: `.debugPane`

The side-by-side layout can become:

- top/header area with title or short status
- two equal-width editor panes
- optional shared debug pane below or to the side

Pragmatic option:

- `main.appShell` as a vertical shell
- `.editorGrid` with two columns for Editor A and Editor B
- each `.editorPane` contains a compact pane header and one `PlimEditor`
- `.debugPane` below the editors with CRDT text for both replicas, Plim JSON for the selected/default replica, and the log

The debug output can be reduced if the two-column UI becomes cramped. At minimum, keep enough debug information to verify that both CRDT replicas converge.

The current `SlashCommandMenu` is mounted once. In the side-by-side app, each editor component should render its own menu bound to its own handle.

## Test Impact

Existing `App.test.tsx` will need updates:

- remove expectations for `Remote Insert` and `Remote Split`
- remove or replace tests that click those buttons
- update selectors that assume one editor instance
- add tests proving pane A edits sync to pane B
- add tests proving pane B edits sync to pane A
- keep existing transaction/selection/mark tests, scoped to one pane where possible
- verify each pane can open its own slash menu

Useful new test cases:

1. Initial render shows two editor panes with matching fixture content.
2. Text inserted in Editor A appears in Editor B and in both CRDT debug outputs.
3. Text inserted in Editor B appears in Editor A.
4. Selection-only changes in one pane do not reset the other pane's retained selection.
5. Bold/italic shortcut in one pane syncs the mark to the other pane.

The adapter tests should not need major changes unless the implementation exposes a new helper for replica orchestration.

## Risks

- Plim handles and drivers are per editor. Sharing `useEditorHandle()` or `PlimDriver` between panes could cause selection/menu focus bugs.
- Programmatic `editor.setState(...)` emits transactions or selection updates, so the existing `applyingFromCrdt` guard needs to remain per pane.
- Selection-only Plim transactions must not replicate as document edits, but they must update the local retained selection so later CRDT rematerialization restores the user's cursor.
- Both panes will rematerialize Plim state after every CRDT edit. This matches the current adapter design but can make focus/selection bugs more visible.
- Tests that query `[data-block-content]` globally may accidentally operate on the wrong pane after there are two copies of the document.

## Open Questions

1. Should the side-by-side demo include online/offline toggles and queued sync like `block-rich-text`, or should it always sync immediately?
    - yes for the toggle
2. Should debug panes show both replicas' Plim JSON, both CRDT text outputs, or only a compact convergence/status view?
    - let's have the debug panes below the editors, collapsed by default. but yes one per side
3. Should actor ids be human-readable pane names such as `left`/`right`, or keep the existing `plimlocal` style with `plimleft`/`plimright`?
    - left/right
4. Should timestamp generation be shared globally to keep total ordering simple, or separated per replica to better model independent peers?
    - per-replica
5. Should local selections be visually distinguishable between panes, or is each Plim editor's native/current selection enough for this task?
    - leave it for now

## Likely Scope

This is mostly an `App.tsx`, `style.css`, and `App.test.tsx` change. The adapter already has the core local/remote conversion pieces. The implementation may benefit from a small local helper for `DemoState`, but a new runtime module is optional unless the app component starts to get difficult to test.
