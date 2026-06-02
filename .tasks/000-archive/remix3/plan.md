# Remix 3 example and `umkehr/remix` implementation plan

This plan adds a true Remix 3 beta example and a new `umkehr/remix` package entry point.

The goal is not to make a server-form-only demo. The goal is to explore whether Umkehr can feel
native in Remix 3's client component model: setup-scope state, `handle.context`, explicit
`handle.update()`, and host-element event mixins.

## Goals

- Add a new `umkehr/remix` entry point.
- Provide Remix-shaped `createStateContext` and `createHistoryContext` APIs inspired by
  `umkehr/react`.
- Use `provide/get`, not a JSX provider component.
- Use setup-phase `.watch(handle, node).current` subscriptions, not a hook-style `useValue`.
- Wire path-scoped updates to `handle.update()`.
- Support preview updates, undo, redo, localStorage persistence, and save callbacks.
- Generalize existing `src/react-core` path/preview primitives where practical.
- Add an `examples/remix3` app using Remix 3 beta client entries.
- List the Remix 3 example in `examples/README.md`.

## Non-goals

- Do not build a React Router framework example.
- Do not recreate `HistoryView` in the first pass.
- Do not design server/session persistence yet.
- Do not make server actions or frames the center of the example.
- Do not expose a public API that requires importing React from `umkehr/remix`.
- Do not overfit to Remix internals beyond documented `Handle`, `handle.context`, `handle.signal`,
  `handle.update()`, `clientEntry`, and `mix={on(...)}` behavior.

## Phase 1: Remix 3 app reconnaissance

Generate a scratch Remix 3 beta app and inspect it before implementing the example.

Tasks:

- Run a fresh `npx remix@next new` in `/private/tmp` or another throwaway location.
- Record the generated app shape:
  - `package.json` scripts;
  - TypeScript config;
  - Vite config;
  - client boot file using `run({loadModule})`;
  - `clientEntry(import.meta.url, ...)` or equivalent asset-entry pattern;
  - route/controller/render layout.
- Confirm the current package name and subpath imports:
  - `remix/ui`;
  - `remix/ui/server`;
  - routing/controller/server imports used by the template.
- Confirm how to install `@typia/unplugin/vite` into the Remix 3 Vite config.

Output:

- Keep notes in `.tasks/remix3/research.md` or a short scratch section in this plan if any generated
  API materially changes the implementation.

## Phase 2: Split framework-neutral subscription primitives

`src/react-core/index.ts` currently contains useful path/preview machinery, but it imports React for
`useValue`. `umkehr/remix` must not depend on React.

Tasks:

- Create a framework-neutral module, likely `src/framework-core/index.ts` or
  `src/subscription-core/index.ts`.
- Move these React-independent exports out of `src/react-core/index.ts`:
  - `Context`;
  - `PathListener`;
  - `PathListenerNode`;
  - `PreviewContextBase`;
  - `makePathListenerNode`;
  - `segmentKey`;
  - `addPathListener`;
  - `removePathListener`;
  - `collectAllPathListeners`;
  - `notifyPaths`;
  - `notifyAllPaths`;
  - `changedPaths`;
  - `recordPreviewPaths`;
  - `makeContextForPath`;
  - `clearPreviewState`;
  - `replacePreviewState`.
- Keep React-specific `useValue` in `src/react-core/index.ts`, importing the neutral primitives from
  the new module.
- Update `src/react/react.tsx` and any React CRDT code to import neutral primitives through the new
  module or re-export path.
- Preserve existing public behavior for `umkehr/react`.

Testing:

- Run `npm run typecheck`.
- Run the existing React tests if the suite is fast enough: `npm test` or targeted vitest.

## Phase 3: Add `src/remix`

Add the new Remix integration without JSX in the library layer if possible.

Suggested files:

```txt
src/remix/
    index.ts
    remix.ts
    types.ts
    watch.ts
    remix.test.ts
```

### Package boundary

Tasks:

- Add `./remix` to `package.json` exports:

```json
"./remix": {
    "types": "./dist/src/remix/index.d.ts",
    "import": "./dist/src/remix/index.js"
}
```

- Add `remix` as an optional peer dependency.
- Add `remix` as a dev dependency so TypeScript can resolve `remix/ui` types while building this
  package.
- Use a conservative beta range for the peer dependency, likely `">=3.0.0-beta.0 <4"`, unless the
  generated app or npm package metadata points to a better range.
- Do not export Remix APIs from the root `umkehr` entry point.

### Public API

Implement:

```ts
import {createHistoryContext, createStateContext} from 'umkehr/remix';
```

`createStateContext<T, Tag>(tag, equalFn?)` returns an object shaped approximately like:

```ts
type RemixStateContextFactory<T, Tag extends string> = {
    provide(handle: Handle, props: {initial: T; save?(value: T): void}): RemixStateContext<T, Tag>;
    get(handle: Handle): RemixStateContext<T, Tag>;
};
```

`createHistoryContext<T, An, Tag>(tag, equalFn?)` returns:

```ts
type RemixHistoryContextFactory<T, An, Tag extends string> = {
    provide(
        handle: Handle,
        props: {initial: History<T, An>; save?(value: History<T, An>): void},
    ): RemixHistoryContext<T, An, Tag>;
    get(handle: Handle): RemixHistoryContext<T, An, Tag>;
};
```

The `provide` function should:

- create a stable mutable runtime during component setup;
- store it with `handle.context.set(runtime)`;
- return the runtime for provider component code;
- clean up runtime-owned listeners on `handle.signal` if needed.

The `get` function should:

- read the runtime with `handle.context.get(factoryIdentity)`;
- throw a clear error if called outside a matching provider.

### Context API

`RemixStateContext` should expose:

```ts
type RemixStateContext<T, Tag extends string> = {
    latest(): T;
    watch<V>(handle: Handle, node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>): {
        get current(): V;
    };
    read<V>(node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>): V;
    clearPreview(): void;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming): void;
    $: Updater<T, Context, Tag>;
};
```

`RemixHistoryContext` should add:

```ts
type RemixHistoryContext<T, An, Tag extends string> = RemixStateLike<T, Tag> & {
    history(): History<T, An>;
    watchHistory(handle: Handle): {get current(): History<T, An>};
    onHistoryChange(f: () => void): () => void;
    tip(): string;
    clearHistory(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    previewJump(id: string): void;
    updateAnnotations: Updater<Annotations<An>, null, Tag>;
};
```

Naming can be refined during implementation, but prefer `.watch` as the primary value-subscription
API.

### Watch behavior

Implement `.watch(handle, node)` as a setup-phase helper:

- compute the path and extra context from the node;
- register one listener for this handle/path pair;
- listener calls `handle.update()`;
- cleanup is tied to `handle.signal`;
- return `{get current() { return extra.getForPath(path); }}`.

Avoid registering duplicate listeners if `.watch` is accidentally called more than once for the same
handle and path. A per-runtime `WeakMap` or `Map` keyed by `handle.id + pathToString(path)` is
acceptable.

Add `.read(node)` for one-off reads that do not subscribe.

### Dispatch behavior

Port the state and history dispatch logic from `src/react/react.tsx`, but use neutral subscription
primitives and Remix listeners:

- queued preview changes;
- committed changes;
- `save`;
- path notifications;
- history listeners;
- history update listeners.

Scheduling rule:

- use `requestAnimationFrame` when available;
- fall back to `setTimeout(fn, 0)` when RAF is unavailable;
- pair cancellation with `cancelAnimationFrame` or `clearTimeout`.

This may require replacing the current `raf?: number` field with a small scheduler handle:

```ts
type ScheduledTask = {kind: 'raf'; id: number} | {kind: 'timeout'; id: ReturnType<typeof setTimeout>};
```

## Phase 4: Tests for `umkehr/remix`

Add focused tests before building the full example.

Test with a fake handle:

```ts
type FakeHandle = {
    id: string;
    signal: AbortSignal;
    update: () => Promise<AbortSignal> | void;
    context: {
        set(value: unknown): void;
        get<T>(provider: unknown): T;
    };
};
```

Tests:

- `provide/get` returns the same runtime for descendants.
- `.watch` reads the initial value.
- dispatching a changed path calls only the relevant watched handles.
- unrelated path dispatch does not call unrelated watchers.
- aborting `handle.signal` removes the watcher.
- preview dispatch updates `.watch(...).current` and notifies watchers.
- `clearPreview` restores committed state and notifies previewed paths.
- history context supports `undo`, `redo`, `canUndo`, `canRedo`, and `history`.
- fallback scheduler works when RAF is absent.

If importing the real `Handle` type from `remix/ui` complicates tests, keep runtime code duck-typed
and use structural TypeScript types.

## Phase 5: Build `examples/remix3`

Create the example from the generated Remix 3 beta app, trimmed to the smallest useful shape.

Suggested behavior:

- one hydrated `clientEntry` todo app;
- local client-side Umkehr history;
- initial state matching `examples/react`;
- localStorage persistence;
- persistence validation with `typia` and `createPatchValidator` if Vite transform setup works;
- add todo;
- toggle todo;
- inline edit title;
- background swatches with hover preview;
- undo and redo;
- no `HistoryView` in the first pass.

Suggested files, adjusted to the generated app:

```txt
examples/remix3/
    package.json
    README.md
    tsconfig.json
    vite.config.ts
    app/
        assets/
            client.ts
        actions/
            controller.tsx
            render.tsx
        ui/
            App.tsx
            model.ts
            persistence.ts
            style.ts
        routes.ts
        router.ts
```

Implementation notes:

- Use `createHistoryContext<State, never>('type')` from `umkehr/remix`.
- Use `Todos.provide(handle, {initial, save})` in the top-level client entry.
- Use `Todos.get(handle)` in child components.
- Use `ctx.watch(handle, ctx.$.todos)` and `ctx.watch(handle, ctx.$.bgcolor)` during setup.
- Use `on(...)` mixins for click, pointerenter, pointerleave, submit, blur, and keydown behavior.
- Keep component-local edit drafts in setup-scope variables.
- Keep styles either as Remix `css(...)` mixins or a simple app stylesheet, matching generated
  Remix conventions.

## Phase 6: Documentation

Update docs:

- Add `examples/remix3/README.md` with:
  - Remix 3 beta caveat;
  - setup commands;
  - root package build prerequisite;
  - what the example demonstrates;
  - note that first pass intentionally omits `HistoryView`.
- Update `examples/README.md` to list `remix3`.
- Update root `Readme.md` package entry point section if it already lists subpath imports.

Example table row:

```md
| `remix3` | Remix 3 beta client components with `umkehr/remix`, path watches, preview updates, undo, and redo |
```

## Phase 7: Verification

Run these checks:

```sh
npm run build
npm run typecheck
npm test
```

Example checks:

```sh
cd examples/remix3
pnpm install
pnpm run build
pnpm dev
```

Manual browser verification:

- app renders from a fresh checkout after root build;
- adding a todo updates the list;
- toggling a todo only rerenders subscribed UI;
- inline edit commits on blur/Enter and cancels on Escape;
- swatch hover previews background and pointer leave clears preview;
- click commits swatch color;
- undo/redo works;
- localStorage persists and invalid persisted data is discarded.

Package smoke:

- ensure `import {createHistoryContext} from 'umkehr/remix'` resolves after `npm run build`;
- ensure importing plain `umkehr` does not require Remix;
- ensure importing `umkehr/react` behavior is unchanged.

## Suggested order of commits

1. Split neutral subscription core out of `src/react-core`.
2. Add `src/remix` with tests and package export.
3. Add generated/trimmed `examples/remix3`.
4. Add Remix example README and examples table entry.
5. Run full verification and adjust the plan/research notes with any beta API surprises.
