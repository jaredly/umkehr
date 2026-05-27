# AppEditorContext Plan

## Goal

Make app UI components independent of whether they are running on
`umkehr/react-crdt` or `umkehr/react`. The app shell should construct the
runtime-specific provider and context, then pass a generic `AppEditorContext`
into the app panel as a prop.

This keeps app views such as the todo panel focused on editing state. They
should not import `useTodos`, `createSyncedContext`, or `createHistoryContext`
directly.

## Core Idea

Introduce an editor context type in `src/lib/crdtApp.ts`:

```ts
export type AppEditorContext<TState, Tag extends string = 'type'> = {
    latest(): TState;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    $: PatchBuilder<TState, Tag, void, Context>;
    dispatch(v: MaybeNested<DraftPatch<TState, Tag, Context>>, when?: ApplyTiming): void;
};
```

This is the common subset shared by:

- `createSyncedContext` from `umkehr/react-crdt`
- `createHistoryContext` from `umkehr/react`

Then extend panel props:

```ts
export type AppPanelProps<TState> = {
    editor: AppEditorContext<TState>;
    actor: string;
    title: string;
    queued?: number;
    gridSlot?: GridSlot | 'full';
};
```

The shells call the runtime-specific hook and pass the returned context into
`app.renderPanel(...)`.

## Important Hook Constraint

Do not call hooks inside `renderPanel`.

`renderPanel` is just a render callback. Hooks must be called in React
components such as `LocalReplicaPanel`, `PeerHostDocument`, and
`PeerClientDocument`. Those components are already inside the correct provider,
so they are the right place to call:

```ts
const editor = runtime.useEditorContext();
```

or, later:

```ts
const editor = historyRuntime.useEditorContext();
```

## Proposed App Definition Shape

Update the app definition so it describes the document and UI only:

```ts
export type AppDefinition<TState> = {
    id: string;
    title: string;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    renderPanel(props: AppPanelProps<TState>): ReactElement;
};
```

The shell, not the app, should derive the initial CRDT history:

```ts
createCrdtLocalHistory(
    createCrdtDocument(app.initialState, app.schema, {
        timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
    }),
);
```

Provider/hook pairs belong to runtime adapters. Keep them next to the concrete
context that created them:

```ts
export type CrdtRuntime<TState> = {
    docId: string;
    Provider: SyncedProvider<TState>;
    useEditorContext(): AppEditorContext<TState>;
};

export type HistoryRuntime<TState, TAnnotations> = {
    Provider: HistoryProvider<TState, TAnnotations>;
    useEditorContext(): AppEditorContext<TState>;
};
```

The registry can store the app and supported runtime adapters together:

```ts
export type RegisteredApp<TState, TAnnotations = never> = {
    app: AppDefinition<TState>;
    crdt?: CrdtRuntime<TState>;
    history?: HistoryRuntime<TState, TAnnotations>;
};
```

Runtime shells should derive their initial state containers:

- CRDT shells create `CrdtLocalHistory<TState>` from `initialState`, `schema`,
  and `initialTimestamp`.
- Regular history shells create `History<TState, TAnnotations>` from
  `initialState`.

This keeps app data in one place while allowing each app to support one or more
runtimes.

## Migration Steps

### 1. Add `AppEditorContext`

In `src/lib/crdtApp.ts`:

- Import the common patch-builder types from the same modules used by
  `umkehr/react` and `umkehr/react-crdt`.
- Import `useValue` from the shared `react-core` source, or expose it from a
  local editor module as a stable import. It is the same hook for `umkehr/react`
  and `umkehr/react-crdt`.
- Add `AppEditorContext<TState>`.
- Change `AppPanelProps` to `AppPanelProps<TState>` and add `editor`.
- Change `renderPanel(props: AppPanelProps<TState>)`.
- Move `useEditorContext()` to the CRDT runtime adapter.
- Replace `createInitialHistory()` on the app definition with `initialState`
  and optional `initialTimestamp`.

Keep this as a structural type. The existing `SyncedContext<TState>` should be
assignable because it has the required fields.

### 2. Add runtime initializers

Create a CRDT initializer helper in `src/lib/crdtApp.ts` or a nearby runtime
module:

```ts
export function createInitialCrdtHistory<TState>(app: AppDefinition<TState>) {
    return createCrdtLocalHistory(
        createCrdtDocument(app.initialState, app.schema, {
            timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
        }),
    );
}
```

Use this helper anywhere the CRDT runtime currently calls
`app.createInitialHistory()`.

When adding the regular history runtime later, create the equivalent helper
there:

```ts
export function createInitialHistory<TState, TAnnotations>(
    app: AppDefinition<TState>,
): History<TState, TAnnotations> {
    return createHistory(app.initialState);
}
```

Use the actual Umkehr history constructor/helper available in this codebase;
the important boundary is that it consumes `app.initialState`, not an
app-provided history factory.

### 3. Pass editor context from local simulator

In `src/lib/local/LocalSimulatorApp.tsx`:

- Replace `useState(app.createInitialHistory)` with
  `useState(() => createInitialCrdtHistory(app))`.
- Receive or look up the selected CRDT runtime adapter.
- Keep `<runtime.Provider initial={...} transport={...}>`.
- Add a child component inside the provider, for example
  `LocalReplicaDocument`.
- In that child component, call `const editor = runtime.useEditorContext()`.
- Pass `editor` into `app.renderPanel`.

This avoids calling the hook before the provider exists.

Expected structure:

```tsx
<runtime.Provider initial={initial} transport={sync.transports[replica.id]}>
    <LocalReplicaDocument app={app} runtime={runtime} ... />
</runtime.Provider>
```

### 4. Pass editor context from PeerJS host/client documents

In `src/lib/peerjs/PeerJsApp.tsx`:

- Replace `useState(app.createInitialHistory)` with
  `useState(() => createInitialCrdtHistory(app))`.
- Receive or look up the selected CRDT runtime adapter.
- `PeerHostDocument` should call `runtime.useEditorContext()`. The returned
  CRDT editor can still be narrowed or intersected with the CRDT-only
  `useLocalHistory()` method where the shell needs access to the local document.
- Pass `editor` into `app.renderPanel`.
- `PeerClientDocument` currently renders the panel directly inside `Provider`.
  Add a nested child component, for example `PeerClientPanel`, that calls
  `runtime.useEditorContext()` inside the provider and passes it to
  `app.renderPanel`.

Expected structure:

```tsx
<runtime.Provider initial={initial} transport={sync.transport}>
    <PeerClientPanel app={app} runtime={runtime} actor={actor} queued={queuedCount(connections)} />
</runtime.Provider>
```

### 5. Refactor todo panel to accept `editor`

In `src/apps/todos/TodoPanel.tsx`:

- Remove `useTodos`.
- Keep `useValue`, imported from shared `react-core` or a local re-export, and
  use it with the passed editor:

```ts
const todos = useValue(editor.$.todos);
```

- Use `editor.undo()`, `editor.redo()`, `editor.canUndo()`,
  `editor.canRedo()`.
- Pass `editor` into `TodoItem`.
- Use `editor.$.todos[index]...` inside `TodoItem`.

The todo panel should still know about `TodoState` and `Todo`, but not about
which runtime produced the editor context.

### 6. Update `TodoApp`

In `src/apps/todos/TodoApp.tsx`:

- Export `initialState` through the app definition.
- Remove `createTodoInitialHistory` from the app definition.
- Move `ProvideTodos` and `useTodos` into a CRDT runtime adapter, for example
  `todoCrdtRuntime`.
- Change `renderPanel` to receive `editor`.
- Pass `editor` into `TodoPanel`.

No runtime-specific imports should be added to `TodoPanel`.

### 7. Verify CRDT behavior before adding `umkehr/react`

Run:

```sh
pnpm build
```

Then manually check:

- Local two-replica editing.
- Local pause/resume sync.
- PeerJS host/client snapshot and updates.
- Undo/redo still works in all panels.

This phase should be behavior-preserving.

## Adding `umkehr/react` Afterward

Once panels consume `AppEditorContext`, adding `umkehr/react` becomes a shell
problem instead of an app UI problem.

Needed additions:

- Add a `HistoryProvider<TState, TAnnotations>` type.
- Add a `HistoryRuntime<TState, TAnnotations>` adapter next to the app
  definition.
- Add a generic regular-history initializer that derives
  `History<TState, TAnnotations>` from `app.initialState`.
- Create `[ProvideTodoHistory, useTodoHistory]` with
  `createHistoryContext<TodoState, never>('type')`.
- Add a non-CRDT shell, such as `HistoryApp`, that:
  - creates initial regular history from `app.initialState`;
  - renders the history provider;
  - calls `historyRuntime.useEditorContext()`;
  - passes that editor into `app.renderPanel`.

The history shell can expose history-only controls later, such as jumps,
annotations, or clearing history. Those should not be part of
`AppEditorContext` unless every runtime can reasonably support them.

## What Not To Do

- Do not make `TodoPanel` branch on runtime type.
- Do not put `useSyncedContext` or `useHistoryContext` on the pure app
  definition.
- Do not pass runtime context hooks into the panel.
- Do not put `useLocalHistory`, `useHistory`, `previewJump`, or annotations in
  `AppEditorContext`; those are runtime-specific extensions.
- Do not call app context hooks inside `renderPanel`.

## Acceptance Criteria

- `pnpm build` passes.
- `TodoPanel` has no import from `./model` except todo types, and no import from
  `umkehr/react-crdt`.
- `TodoPanel` receives `editor` as a prop and uses it for reads, writes,
  undo, and redo.
- `src/lib` remains todo-independent except for the registry.
- Existing CRDT local and PeerJS behavior is unchanged.
- The next step of adding a regular `umkehr/react` shell does not require
  changing `TodoPanel`.
