# Path statuses plan

Implement a general, runtime-only path status API that can be used by sync layers later, but does not implement replay-specific statuses in this first pass.

The API should be public, React-friendly, and also usable outside React.

## Goals

- Add a public status primitive for arbitrary state paths.
- Let status producers add or clear statuses.
- Let UI consumers subscribe to statuses for a typed path.
- Match `useValue` path semantics as much as possible.
- Support exact-path subscriptions by default.
- Support opt-in descendant subscriptions that include the subscribed path itself.
- Support filtering by open-string `kind`.
- Make `get` very fast via path-indexed storage.
- Keep statuses runtime-only. Do not persist or serialize them.
- Do not build local-first replay classification yet.

## Non-goals

- Do not define first-class `conflict`, `changed`, or replay semantics yet.
- Do not add severity/priority to the core status type.
- Do not persist statuses in CRDT history, local-first storage, exports, or snapshots.
- Do not require React for the underlying store.

## Proposed API

Add framework-neutral status types and store helpers:

```ts
type Status = {
    id: string;
    path: Path;
    kind: string;
    message?: string;
    data?: unknown;
};

type StatusQuery = {
    descendants?: boolean;
    kinds?: readonly string[];
};

type StatusStore = {
    get(path: Path, query?: StatusQuery): Status[];
    subscribe(
        path: Path,
        query: StatusQuery | undefined,
        listener: (statuses: Status[]) => void,
    ): () => void;
    add(statuses: Status[]): void;
    clear(id: string): void;
    clearAll(): void;
};

function createStatusStore(): StatusStore;
```

Notes:

- `kind` is intentionally an open string.
- `id` is globally unique within the store.
- `add(statuses)` inserts statuses by `id`; if an added id already exists, the new status replaces the old one.
- `clear(id)` removes one status by `id`.
- `clearAll()` removes every status.
- Whole-store replacement can be expressed as `clearAll()` plus `add(statuses)`.
- Producers are responsible for clearing stale statuses.

Add React hook support:

```ts
function useStatuses<Current, Tag extends PropertyKey>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
    query?: StatusQuery,
): Status[];
```

Hook behavior:

- Default query is exact path only.
- `{descendants: true}` returns statuses on the path and below it.
- `{kinds: ['conflict']}` returns only matching kinds.
- Filtering should affect returned statuses and, where practical, rerender notifications.

## Provider integration

Update `createSyncedContext` provider props to accept an optional status store:

```ts
{
    children: React.ReactElement;
    initial: CrdtLocalHistory<T>;
    transport: SyncedTransport;
    save?(history: CrdtLocalHistory<T>): void;
    statuses?: StatusStore;
}
```

The synced context should expose the status store to hooks. If no store is provided, create a default empty internal store so `useStatuses` always works and returns `[]`.

This keeps status production outside the synced provider while allowing the provider to map typed patch-builder paths to store subscriptions.

## Module placement

Recommended file layout:

- `src/statuses.ts`
  - framework-neutral `Status`, `StatusQuery`, `StatusStore`, `createStatusStore`.
- `src/react-core/index.ts`
  - shared typed hook infrastructure for reading statuses from a patch-builder node and a provided store.
  - export a helper such as `useStatusesFromStore(node, store, query)` or a small hook factory that context packages can wrap.
- `src/react-crdt/react-crdt.tsx`
  - provider wiring for optional status store.
  - public `useStatuses` hook for synced contexts, implemented through `react-core` status hook infrastructure.
- `src/react-crdt/index.ts`
  - export `useStatuses`, status types, and `createStatusStore` as appropriate.
- `src/react/index.ts`
  - optionally export the lower-level hook helper only if it is useful for non-CRDT state contexts.

`react-core` should own the common hook mechanics because the status concept is more general than sync-specific UI. Context-specific packages can decide how to supply the store.

## Store behavior

Store implementation should maintain:

- statuses indexed by `id`;
- exact path indexes for fast exact `get`;
- descendant-aware path indexes for fast subtree `get`;
- a path listener tree for status subscriptions;
- optional per-kind indexing if kind filtering needs to avoid scanning path results.

Required first implementation:

1. Keep `Map<string, StoredStatus>` by status id.
2. Keep `Map<string, Set<string>>` from exact path key to status ids.
3. Keep `Map<string, Set<string>>` from ancestor path key to descendant/self status ids, so descendant queries are direct lookups instead of full-store scans.
4. On `add`, remove old indexed entries for any incoming ids, add new entries to exact and ancestor indexes, then notify affected old and new paths once for the batch.
5. On `clear` / `clearAll`, remove indexed entries and notify affected paths.

`get` must not scan all statuses. Exact mode should look up the exact path bucket. Descendant mode should look up the ancestor path bucket. Kind filtering may scan only the matched bucket unless profiling shows a need for a secondary kind index.

`subscribe` should call listeners with the already-computed matching statuses:

```ts
store.subscribe(path, query, (statuses) => {
    // statuses is equivalent to store.get(path, query)
});
```

This avoids making React consumers do the same path/index lookup twice after every notification.

Path relation helpers needed:

- `samePath(a, b)`
- `isDescendantOrSelf(path, candidate)`
- `statusMatchesQuery(status, path, query)`
- `pathKey(path)`
- `ancestorPathKeys(path)` including the path itself and root

For array paths, use the same normal path semantics as `useValue`: consumers subscribe with current builder paths, and producers should publish statuses using current normal paths.

## React hook behavior

The shared `react-core` hook infrastructure should:

1. Extract `path` and context from the patch builder.
2. Accept a `StatusStore` from the caller.
3. Initialize state from `store.get(path, query)`.
4. Subscribe with `store.subscribe(path, query, listener)`.
5. On notification, use the `statuses` list passed to the listener and update only when it meaningfully differs from the current list.

`react-crdt`'s public `useStatuses` should be a thin context-aware wrapper:

1. Read the current synced context.
2. Pull `ctx.statuses`.
3. Delegate to the `react-core` helper with the caller's node and query.

Use existing equality patterns from `useValue` where possible. Since statuses are arrays of objects, either:

- compare by shallow status identity fields (`id`, `path`, `kind`, `message`, `data` reference), or
- reuse the repo's `deepEqual`.

Prefer a simple equality check first unless tests show awkward rerenders.

## Tests

Add focused unit tests for the framework-neutral store:

- exact subscription returns only statuses on the same path.
- descendant subscription includes self and children.
- sibling and ancestor statuses are excluded for exact and descendant queries as appropriate.
- `kinds` filters returned statuses.
- `add(statuses)` inserts multiple statuses.
- `add(statuses)` replaces existing statuses with matching ids.
- replacing one status updates old and new path indexes.
- `clear(id)` removes and notifies affected statuses.
- `clearAll()` removes and notifies affected statuses.
- `subscribe` listeners receive the matching status list directly.
- `get` uses path buckets rather than scanning every status. This can be tested by structure where practical, or covered by targeted behavior tests that would fail with stale indexes.
- statuses are not persisted anywhere because the store is independent of CRDT history.

Add `react-core` hook tests where practical:

- helper extracts the typed builder path and reads matching statuses from a supplied store.
- default exact mode does not include child statuses.
- `{descendants: true}` includes child statuses.
- `{kinds: [...]}` filters statuses.

Add `react-crdt` wrapper tests under `src/react-crdt/react-crdt.test.tsx` or a new adjacent test:

- `useStatuses(editor.$.path)` rerenders when a provided store adds a status to that exact path.
- a provider without a store returns `[]` and does not throw.

## Example integration

Add a minimal demonstration in the Todo example only after the library API is in place.

Suggested low-risk demo:

- Create a status store in the app shell.
- Pass it into the synced provider.
- Add a small development/demo control or effect that writes a sample status for one todo item.
- Update `TodoItem` to call `useStatuses(editor.$.todos[index], {descendants: true})`.
- Add an outline/class when statuses exist.

Do not wire local-first replay preview into statuses in this pass. Leave that for a follow-up once the API has tests.

## Implementation steps

1. Add `src/statuses.ts` with public types, path matching helpers, `createStatusStore`, and unit tests.
2. Add shared status hook infrastructure to `src/react-core/index.ts`.
3. Export the status primitives and shared hook helper from package entry points that make sense for public consumption.
4. Extend the synced provider's props and context base to hold a `StatusStore`.
5. Add `useStatuses` to `src/react-crdt/react-crdt.tsx` as a wrapper around the `react-core` helper, and export it from `src/react-crdt/index.ts`.
6. Add store, `react-core`, and `react-crdt` tests for the behaviors above.
7. Optionally update example app types so `AppEditorContext` can expose or support status usage cleanly.
8. Add the Todo visual demo using descendant status lookup.
9. Run targeted tests and type checks.

## Open follow-ups

- Decide whether `createStatusStore` should preserve insertion order by path bucket, global replacement order, or another stable ordering.
- Add local-first replay status production later.
- Add path-aware validation statuses later if validation grows path-level reporting.
- Decide whether non-CRDT React contexts should expose their own `useStatuses` wrapper around the `react-core` helper.
