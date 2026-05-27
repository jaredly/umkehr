# React CRDT App Abstraction Plan

## Goal

Prepare `examples/react-crdt` to host multiple CRDT-backed apps, such as the
current todo list and a future whiteboard, while keeping sync, persistence,
mode routing, and shared UI code independent of any one app's document shape.

The first refactor should preserve current behavior. After the refactor, adding
a new app should mostly mean adding an app module with its state type, schema,
initial document, synced context, document id, and view component.

## Current Coupling

The app currently has a single `src/model.ts` that mixes several concerns:

- Todo domain types and initial state: `Todo`, `State`, `initialState`.
- Todo CRDT setup: `schema`, `ProvideTodos`, `useTodos`, `createInitialHistory`.
- Local simulator concerns: `ReplicaId`, `replicas`, `DemoTransport`.
- Generic transport clock logic: `createDemoTransport`.
- Generic UI-only types: `GridSlot`, `QueueCount`.

Other generic files also depend on the todo `State` or schema:

- `src/peerjs/types.ts` types `snapshotStore` and `setSnapshotDocument` as todo documents.
- `src/peerjs/protocol.ts` hard-codes todo schema validation and `TODO_DOC_ID`.
- `src/peerjs/usePeerJsSync.ts` accepts and stores only todo CRDT documents.
- `src/persistence.ts` validates only todo history.
- `src/LocalSimulatorApp.tsx` and `src/PeerJsApp.tsx` compose sync infrastructure directly with `TodoPanel`.

This makes the todo list the implicit application model for the whole example.

## Proposed Structure

Create a reusable `src/lib` folder for application-agnostic infrastructure:

```text
src/
  apps/
    todos/
      TodoApp.tsx
      TodoPanel.tsx
      model.ts
  lib/
    appRegistry.ts
    crdtApp.ts
    local/
      replicas.ts
      transport.ts
      useLocalDemoSync.ts
      LocalSimulatorApp.tsx
      SyncControls.tsx
    peerjs/
      PeerJsApp.tsx
      PeerJsControls.tsx
      protocol.ts
      types.ts
      usePeerJsSync.ts
    persistence.ts
    store.ts
    useHashMode.ts
  App.tsx
  main.tsx
  style.css
```

The exact filenames can change while implementing, but the key boundary should
hold: `src/apps/*` owns app-specific state and UI; `src/lib/*` owns reusable
sync, transport, persistence, routing, and shell UI.

## Core Abstraction

Introduce a generic app descriptor in `src/lib/crdtApp.ts`:

```ts
export type CrdtAppDefinition<TState> = {
    id: string;
    title: string;
    docId: string;
    tagKey: string;
    schema: /* typia JSON schema type used by umkehr */;
    createInitialHistory(): CrdtLocalHistory<TState>;
    Provider: ReturnType<typeof createSyncedContext<TState>>[0];
    useContext: ReturnType<typeof createSyncedContext<TState>>[1];
    renderPanel(props: AppPanelProps): ReactNode;
};
```

The reusable shells should receive a `CrdtAppDefinition<TState>` rather than
importing todo symbols. This lets the same local simulator and PeerJS flow host
different document types.

Keep the todo context created inside `src/apps/todos/model.ts`:

- `Todo`
- `TodoState`
- `todoSchema`
- `TODO_DOC_ID`
- `[ProvideTodos, useTodos]`
- `createTodoInitialHistory`
- `todoAppDefinition`

## Migration Phases

### 1. Move clearly generic files into `src/lib`

Start with files that do not need meaningful behavior changes:

- Move `store.ts` to `lib/store.ts`.
- Move `useHashMode.ts` to `lib/useHashMode.ts`.
- Move `ModeTabs.tsx` to `lib/ModeTabs.tsx`.
- Move `SyncControls.tsx` to `lib/local/SyncControls.tsx`.
- Move `peerjs/*` to `lib/peerjs/*`.

Update imports only. Run the build after this phase to catch path mistakes.

### 2. Split todo domain from generic model

Create `src/apps/todos/model.ts` and move todo-only exports there:

- `Todo`
- `State`, renamed to `TodoState`
- `schema`, renamed to `todoSchema`
- `initialState`, renamed to `initialTodoState`
- `initialTimestamp` if it stays todo-specific
- `createInitialHistory`, renamed to `createTodoInitialHistory`
- `ProvideTodos`
- `useTodos`
- `TODO_DOC_ID`

Move `TodoPanel.tsx` to `src/apps/todos/TodoPanel.tsx` and import from the new
todo model.

Leave local simulator types such as `ReplicaId`, `replicas`, and transport
helpers out of the todo module unless they are genuinely app-specific.

### 3. Extract local simulator infrastructure

Move simulator concepts into `src/lib/local`:

- `replicas`
- `ReplicaId`
- `GridSlot`
- `QueueCount`
- `DemoTransport`
- `createDemoTransport`
- `useDemoSync`, renamed to `useLocalDemoSync`
- `LocalSimulatorApp`

Make `LocalSimulatorApp` accept an app definition:

```tsx
export function LocalSimulatorApp<TState>({app}: {app: CrdtAppDefinition<TState>}) {
    const [initialHistory] = useState(app.createInitialHistory);
    const sync = useLocalDemoSync();
    // render each replica with app.Provider and app.renderPanel(...)
}
```

At this point, the local transport should no longer import todo state or todo
UI.

### 4. Genericize PeerJS sync and protocol

Make `PeerJsSync`, `usePeerJsSync`, and protocol parsing generic over `TState`.

The protocol should receive a document config instead of importing todo schema:

```ts
export type PeerProtocolConfig<TState> = {
    docId: string;
    schema: /* same schema type */;
    validateState(input: unknown): ValidateResult<TState>;
};
```

Then update:

- `parsePeerMessage(input, config)` instead of `parsePeerMessage(input, docId)`.
- `validatePeerSnapshot(input, config)`.
- `createCrdtUpdateValidator<TState>(config.schema)`.
- Schema context comparison uses `config.schema`.
- `PeerJsSync<TState>` stores `CrdtDocument<TState> | null`.
- `usePeerJsSync<TState>` accepts `initialDocument?: CrdtDocument<TState>` and
  `protocol: PeerProtocolConfig<TState>`.

Keep the wire format unchanged except for allowing different `docId` values per
app.

### 5. Make persistence reusable or app-scoped

`src/persistence.ts` is currently unused by the visible app shell, but it is
todo-specific. Either:

- Move it to `src/apps/todos/persistence.ts` if it is only for the todo app.
- Or make it generic under `src/lib/persistence.ts`:

```ts
createHistoryPersistence<TState>({
    storageKey,
    validateState,
    patchValidator,
});
```

Prefer generic only if the next app is expected to persist local histories. If
not, moving it into the todo app keeps the refactor smaller.

### 6. Add an app registry

Create `src/lib/appRegistry.ts` with the available app definitions:

```ts
import {todoApp} from '../apps/todos/model';

export const apps = [todoApp] as const;
export const defaultApp = todoApp;
```

Then update `App.tsx` to choose both:

- the app, such as `todos` or future `whiteboard`;
- the transport mode, such as `local` or `peerjs`.

A simple first version can keep `#local` and `#peerjs` for transport mode and
hard-code `defaultApp`. A later version can support routes such as:

- `#todos/local`
- `#todos/peerjs`
- `#whiteboard/local`
- `#whiteboard/peerjs`

Do the routing change after the module boundaries are stable.

### 7. Recompose PeerJS shell with app definition

Move `PeerJsApp.tsx` into `src/lib/peerjs/PeerJsApp.tsx` and make it generic:

- Use `app.createInitialHistory()` for host initialization.
- Pass `app.docId` and protocol validators into `usePeerJsSync`.
- Render host and client documents through `app.Provider`.
- Render document UI through `app.renderPanel`.

The only app-specific text that should remain in the generic PeerJS shell is
provided by the app definition, such as panel titles.

## Suggested Implementation Order

1. Move generic files and fix imports.
2. Move todo files under `src/apps/todos`.
3. Add `CrdtAppDefinition` and `todoApp`.
4. Make local simulator consume `todoApp` through the definition.
5. Genericize PeerJS types and protocol.
6. Make PeerJS shell consume `todoApp` through the definition.
7. Decide whether persistence moves into `apps/todos` or becomes generic.
8. Add app registry and optional hash route support.

Each step should leave `pnpm build` passing.

## Acceptance Criteria

- `pnpm build` passes from `examples/react-crdt`.
- Existing local two-replica todo demo behaves the same.
- Existing PeerJS host/client todo demo behaves the same.
- No file under `src/lib` imports from `src/apps/todos` or mentions todo types.
- Todo-specific code is isolated under `src/apps/todos`, except for registry
  wiring in `src/lib/appRegistry.ts` or `src/App.tsx`.
- Adding a whiteboard app does not require editing local transport, PeerJS
  transport, external store, or protocol internals.

## Notes and Risks

- Typing the schema field in `CrdtAppDefinition<TState>` may require using the
  exact typia schema type inferred from the current `typia.json.schemas` return
  value. Keep this local and pragmatic rather than introducing broad framework
  types.
- `createSyncedContext<TState>` returns app-specific hooks. The app definition
  should carry those hooks instead of trying to create a single global context
  for all apps.
- PeerJS snapshot validation must remain strict. Genericizing it should not mean
  accepting arbitrary document shapes; it should validate against the selected
  app's schema and document id.
- Keep the first refactor behavior-preserving. Add the whiteboard only after the
  todo app runs through the new abstraction.
