# Remix 3 Example Research

This document explores adding a true Remix 3 beta example and a matching `umkehr/remix` integration
library.

Assumptions for this research:

- "Remix 3" means the current `remix@next` beta, not React Router framework mode.
- The example should explore Remix 3's client component model, not only server-rendered forms.
- The library work should be inspired by `umkehr/react`, but adapted to Remix Component's explicit
  `handle.update()` model.

## Current Remix 3 Facts

`remix@next` is currently `3.0.0-beta.0`. The official beta post describes it as a pre-release, not
production-ready framework, but suitable for experiments and feedback. Source:
<https://remix.run/blog/remix-3-beta-preview>

Remix 3 is not React. The current app template guidance says components are functions that receive
a `handle`, read current props from `handle.props`, keep state in setup-scope variables, and return
a render function. A component rerenders only when code explicitly calls `handle.update()`.

Client interactivity uses `clientEntry(...)` and `run(...)` from `remix/ui`. On the server,
client-entry components render normally; Remix wraps their output in hydration markers and serializes
props into JSON. On the client, `run` scans the document, loads the client entry modules, and
hydrates only those marked components. Sources:

- <https://github.com/remix-run/remix/blob/main/packages/ui/docs/hydration.md>
- <https://github.com/remix-run/remix/blob/main/template/.agents/skills/remix/references/component-model.md>
- <https://github.com/remix-run/remix/blob/main/template/.agents/skills/remix/references/hydration-frames-navigation.md>

Host-element behavior composes through `mix`, especially `on(...)` for event handling. Event
handlers receive an `AbortSignal` for re-entry/cancellation. Source:
<https://github.com/remix-run/remix/blob/main/template/.agents/skills/remix/references/mixins-styling-events.md>

The Remix template guidance also calls out `handle.context` and `TypedEventTarget` as the intended
tools for ancestor/descendant communication and granular updates.

## Existing React Example

`examples/react` demonstrates the current React integration:

- `blankHistory(initialState)` from `umkehr`;
- `createHistoryContext<State, never>('type')` from `umkehr/react`;
- `useValue(ctx.$.path)` for path-scoped React subscriptions;
- mutation through generated `$` path helpers;
- preview updates with `ctx.$.bgcolor(color, 'preview')`;
- `ctx.clearPreview()`;
- undo/redo through `ctx.undo()`, `ctx.redo()`, `ctx.canUndo()`, and `ctx.canRedo()`;
- branch jumping and preview jumping in `HistoryView`;
- localStorage persistence validated with `typia` and `createPatchValidator<State>()`.

Important files:

- `examples/react/src/App.tsx`
- `examples/react/src/HistoryView.tsx`
- `examples/react/src/persistence.ts`
- `src/react/react.tsx`
- `src/react-core/index.ts`

The most relevant internal boundary is `src/react-core`: it already owns path listener trees,
preview state replacement, changed-path notification, and `useValue` plumbing. `src/react/react.tsx`
then adapts those primitives to React hooks, contexts, refs, and effects.

For Remix 3, the useful reuse target is not the React hook layer. It is the underlying model:

- one mutable state/history holder per provider;
- path-scoped listener nodes;
- `createPatchDispatcher`;
- preview state;
- changed-path notifications;
- optional save callback;
- history-specific methods such as undo, redo, jump, previewJump, and annotations.

## Proposed Public Entry Point

Add a new package export:

```json
"./remix": {
    "types": "./dist/src/remix/index.d.ts",
    "import": "./dist/src/remix/index.js"
}
```

Recommended initial exports:

```ts
export {
    createHistoryContext,
    createStateContext,
    readValue,
    subscribeValue,
    value,
} from 'umkehr/remix';
export type {RemixStateContext, RemixHistoryContext} from 'umkehr/remix';
```

Naming is still open. The React API has `useValue(...)` because React subscriptions are hook-based.
Remix should not use a `use*` name unless it truly behaves like a Remix convention. Possible names:

- `value(ctx.$.todos)` for "read the current value and subscribe this component to that path";
- `readValue(ctx.$.todos)` plus explicit `subscribeValue(...)`;
- `trackValue(handle, ctx.$.todos)` if the API needs the component handle directly.

Recommendation: start explicit:

```ts
const todos = ctx.value(handle, ctx.$.todos);
```

This makes the update mechanism obvious. Under the hood, `value(handle, node)` reads the node's
current path and registers `handle.update` as the path listener with cleanup tied to
`handle.signal`.

## Remix Integration Shape

The Remix equivalent of a React provider should use `handle.context.set(...)`.

Sketch:

```tsx
import {clientEntry, on, type Handle, type RemixNode} from 'remix/ui';
import {blankHistory} from 'umkehr';
import {createHistoryContext} from 'umkehr/remix';

type Todo = {
    id: string;
    title: string;
    done: boolean;
};

type State = {
    bgcolor: string;
    todos: Todo[];
};

const Todos = createHistoryContext<State, never>('type');

export const TodoApp = clientEntry(import.meta.url, function TodoApp(
    handle: Handle<{initialHistory?: History<State, never>}>,
) {
    Todos.provide(handle, {
        initial: handle.props.initialHistory ?? blankHistory(initialState),
        save: savePersistedHistory,
    });

    return () => (
        <Todos.Provider>
            <TodoList />
        </Todos.Provider>
    );
});
```

That exact JSX may need adjustment after checking Remix 3's component/context ergonomics. The core
idea is:

- `createHistoryContext` creates a provider identity;
- provider setup creates a stable mutable Umkehr runtime;
- provider setup calls `handle.context.set(runtime)`;
- child components call `Todos.use(handle)` or `Todos.get(handle)` to retrieve the runtime;
- path reads register the child component's `handle.update` with the runtime's path listener tree.

A more Remix-shaped API may avoid a JSX provider component entirely:

```tsx
const Todos = createHistoryContext<State, never>('type');

function TodoApp(handle: Handle<{initialHistory?: History<State, never>}>) {
    Todos.provide(handle, {
        initial: handle.props.initialHistory ?? blankHistory(initialState),
        save: savePersistedHistory,
    });

    return () => <TodoList />;
}

function TodoList(handle: Handle) {
    const ctx = Todos.get(handle);
    const todos = ctx.value(handle, ctx.$.todos);

    return () => (
        <ul>
            {todos.map((todo, index) => (
                <TodoItem key={todo.id} todo={todo} index={index} />
            ))}
        </ul>
    );
}
```

This second shape looks closer to Remix Component's documented context model.

## Hook/Context Result

The Remix context should expose the same app-facing concepts as the React history context, but with
explicit component handles for subscriptions:

```ts
type RemixHistoryContext<T, An, Tag extends string = 'type'> = {
    latest(): T;
    history(): History<T, An>;
    value<V>(handle: Handle, node: PathNode<V>): V;
    subscribe(handle: Handle, node: PathNode<unknown>, exact?: boolean): void;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    tip(): string;
    clearHistory(): void;
    previewJump(id: string): void;
    dispatch(
        patch:
            | {op: 'undo' | 'redo'}
            | {op: 'jump'; id: string}
            | MaybeNested<DraftPatch<T, Tag, Context>>,
        when?: ApplyTiming,
    ): void;
    $: Updater<T, Context, Tag>;
    updateAnnotations: Updater<Annotations<An>, null, Tag>;
};
```

Open naming issue: `PathNode` above is placeholder language. The existing `Updater` proxy type
already carries enough path information for React `useValue`, but the public type names may need to
be made more deliberate before exporting them through `umkehr/remix`.

## Update Model

React `useValue` works by coupling a subscription to React state. Remix should instead couple a
subscription to `handle.update()`.

For a component:

```tsx
function TodoCount(handle: Handle) {
    const ctx = Todos.get(handle);
    let count = ctx.value(handle, ctx.$.todos).length;

    return () => <span>{count}</span>;
}
```

Implementation idea:

1. `ctx.value(handle, node)` reads `node` from `ctx.previewState ?? ctx.state.current`.
2. It gets the node's path from the same path metadata used by React `useValue`.
3. It registers one listener per `{handle.id, path, exact}`.
4. The listener calls `handle.update()`.
5. `handle.signal` cleanup removes all listeners registered for that component.

The tricky part is avoiding duplicate listener registration on every render. Since Remix components
have setup and render phases, the recommended pattern may be:

```tsx
function TodoCount(handle: Handle) {
    const ctx = Todos.get(handle);
    const todos = ctx.watch(handle, ctx.$.todos);

    return () => <span>{todos.current.length}</span>;
}
```

Where `watch(...)` runs during setup, registers once, and returns a small reader:

```ts
type WatchedValue<T> = {
    get current(): T;
};
```

This would match Remix's "setup once, render many times" model better than calling a subscription
helper inside render output. It also avoids making render-phase code mutate listener lists.

Recommendation: prototype both `ctx.value(handle, node)` and `ctx.watch(handle, node).current` in a
small spike. If duplicate listener bookkeeping becomes awkward, prefer `watch`.

## Mutation Model

The core dispatch logic can stay close to `src/react/react.tsx`:

- apply preview patches into `previewState`;
- apply committed patches into `state`;
- call `save`;
- notify global listeners and path listeners;
- notify history listeners when history shape changes.

The difference is the subscriber callback. React listeners call a state setter. Remix listeners call
`handle.update()`.

Event handlers should use Remix `on(...)` mixins:

```tsx
<button
    mix={on('click', () => {
        ctx.$.todos[index].done(!todo.done);
    })}
>
    Toggle
</button>
```

Preview updates map naturally to pointer/focus mixins:

```tsx
<button
    style={{backgroundColor: color}}
    mix={[
        on('pointerenter', () => ctx.$.bgcolor(color, 'preview')),
        on('pointerleave', () => ctx.clearPreview()),
        on('click', () => ctx.$.bgcolor(color)),
    ]}
/>
```

Open question: if a preview update is scheduled via `requestAnimationFrame`, does Remix 3 testing or
server/client runtime always provide RAF in the relevant environments? React code assumes browser
RAF. The Remix integration may need a scheduler abstraction for tests and non-browser execution.

## Example App Goals

`examples/remix3` should intentionally be more than a server CRUD demo. It should prove that
`umkehr/remix` works with Remix client entries and explicit updates.

Suggested first example:

- one `clientEntry` todo app;
- local client-side history initialized from serialized props;
- localStorage persistence, matching the React example's user-visible behavior;
- todos list with add, toggle, inline edit;
- background color swatches with hover preview;
- undo/redo buttons;
- a minimal history tree or at least jump/preview controls if recreating `HistoryView` is feasible;
- README clearly stating this is a Remix 3 beta/client-component integration experiment.

This keeps the example focused on the library integration:

- client component setup;
- `handle.context`;
- path-scoped updates through `handle.update`;
- event mixins;
- preview state;
- persistence validation.

Server actions, frames, and session persistence are worth exploring later, but they should not hide
the core question: can Umkehr feel native inside Remix 3's client component paradigm?

## Possible File Layout

```txt
src/remix/
    index.ts
    remix.tsx
    types.ts
    watch.ts

examples/remix3/
    package.json
    README.md
    app/
        assets/
            client.ts
        actions/
            controller.tsx
            render.tsx
        ui/
            App.tsx
            HistoryView.tsx
            persistence.ts
            style.ts
        routes.ts
        router.ts
```

The exact Remix app layout should be copied from a freshly generated `npx remix@next new` app
rather than guessed. The template docs say Remix apps normally use `app/routes.ts`, `app/router.ts`,
`app/actions`, `app/assets`, and `app/ui`.

## Build And Package Considerations

Package export:

- add `./remix` to `package.json`;
- decide whether `remix` should be an optional peer dependency, like `react`;
- ensure importing `umkehr/remix` does not pull Remix into the root `umkehr` entry point.

TypeScript/JSX:

- Remix 3 uses its own JSX/component runtime, so `src/remix` likely needs separate JSX settings or
  no JSX in the library layer.
- If the library only exports functions and types, keep JSX out of `src/remix` and let the example
  own JSX.

Typia:

- The React example uses `@typia/unplugin/vite`.
- Remix 3's beta pipeline may not expose the same plugin path.
- First implementation can either:
  - keep typia validation if the generated app can compile it cleanly;
  - or use a small hand-written persisted-history validator and leave typia as a follow-up.

Testing:

- Add unit tests for `src/remix` without requiring a full browser if possible.
- A fake `Handle` with `id`, `signal`, `update`, and minimal context may be enough to test
  subscription cleanup and path notification.
- Add a package smoke test once `./remix` is exported.
- Full example testing should probably remain manual until Remix 3 beta tooling stabilizes.

## Design Risks

- Remix 3 beta APIs are moving quickly. `clientEntry`, `handle.context`, `mix`, or hydration asset
  resolution may change.
- The initial API could become too React-shaped if it copies provider/hook language directly.
- Registering subscriptions during render would fight Remix's setup/render split.
- Preview updates depend on client-only scheduling and need a clean SSR no-op behavior.
- `handle.context.set()` does not trigger updates by itself; provider setup and state dispatch need
  explicit update/notify behavior.
- Persisted client-entry props must be JSON-serializable. Do not pass functions, class instances, or
  live context/runtime objects as props.
- If the runtime object is stored in context, it must be created on both server render and client
  hydration in compatible ways.

## Open Questions

- What exact shape should `createHistoryContext` return in `umkehr/remix`: an object with
  `provide/get`, a JSX provider component, or both?
  -> let's do provide/get, no provider component
- Should value subscriptions be `ctx.value(handle, node)` or a setup-phase
  `ctx.watch(handle, node).current`?
  -> .watch is better
- Should `umkehr/remix` expose a general `TypedEventTarget`-backed store so Remix components can
  subscribe without direct path listener internals?
  -> I'm not sure -- use your judgement on whatever's simpler
- Can we reuse `src/react-core` by generalizing it to a framework-agnostic subscription core, or is
  a small duplicated Remix adapter cleaner?
  -> I'm interested in generalizing it to be framework-agnostic where possible
- How should preview scheduling work outside browsers and tests?
  -> check for existence of raf and if not use setTimeout(0)
- Does the example need to recreate `HistoryView`, or is undo/redo plus background preview enough
  for the first pass?
  -> we can wait on historyview for the first pass
- Should persistence use localStorage first to match the React example, or should it intentionally
  use Remix sessions/cookies to explore full-stack state?
  -> localStorage for now
- Can Remix 3 beta compile typia transforms today?
  -> remix 3 uses vite so it should be fine
- What is the generated app's current asset-entry pattern for `clientEntry(import.meta.url, ...)`
  and `run({loadModule})`?
  -> no idea
- Should `remix` become an optional peer dependency, and what version range should be used while it
  is beta?
  -> optional yes, idk about version range
- Should `examples/remix3` be listed in `examples/README.md` immediately or kept task-local until
  the beta API settles?
  -> let's list it in readme

## Suggested Next Step

Do a spike before committing the full example:

1. Generate a fresh Remix 3 beta app with `npx remix@next new`.
2. Add a tiny local `createStateContext` prototype inside the example, not the package.
3. Build one client-entry counter/todo component that:
   - stores mutable state in setup scope;
   - exposes it through `handle.context`;
   - has a child component subscribe to one field;
   - updates through an `on('click', ...)` mixin;
   - calls `handle.update()` only through the Umkehr adapter.
4. Once that feels correct, move the adapter into `src/remix` and port the React todo example
   behavior.

This avoids freezing a public `umkehr/remix` API before we have seen where Remix 3's component model
pushes back.
