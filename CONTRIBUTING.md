# Contributing

This document is a quick map of Umkehr's internals. The README explains how to use the library; this file explains where the main behavior lives and how changes usually fit together.

## Project Shape

The package has five public entry points:

- `umkehr`: core patch builders, patch realization/application, and history helpers.
- `umkehr/crdt`: CRDT documents, update generation/application, CRDT-local undo/redo, and CRDT update validation.
- `umkehr/react`: React context helpers and path subscriptions.
- `umkehr/react-crdt`: React bindings for CRDT-backed synced contexts.
- `umkehr/validation`: optional patch validation helpers for untrusted persisted or remote data.

Keep optional integrations out of the root entry point. React is exposed only through `umkehr/react` and `umkehr/react-crdt`, validation is exposed through `umkehr/validation` and the CRDT validator exports, and CRDT behavior is exposed only through `umkehr/crdt`. `react` and `typia` are optional peer dependencies because only those integrations need them.

## Core Concepts

Umkehr separates three related representations:

- `DraftPatch<T>`: the authoring form produced by builders. Drafts may omit state-dependent data.
- `Patch<T>`: the realized, invertible form stored in history.
- `Path`: an array of structured path segments, not a JSON pointer string.

Paths are arrays of:

```ts
{type: 'key', key: string | number}
{type: 'tag', key: string, value: string}
```

`key` segments navigate object properties, record keys, and array indices. `tag` segments refine tagged unions and are checked at runtime when reading or cloning through the path.

## Type Layer

Most of the type-level API lives in `src/types.ts`.

`PatchBuilderInternal<Root, Current, Tag, R, Extra>` is the central type. It uses conditional types to expose different navigation and operations depending on `Current`:

- objects expose their keys;
- records expose string keys;
- arrays expose numeric indices, `$push`, `$move`, and `$reorder`;
- tagged unions require `$variant(...)` before variant-specific fields are exposed.

The realized `Patch<T>` type intentionally stores payloads as `unknown`. The type safety story for trusted in-process usage comes from constructing patches through the builder, not from the serialized patch object carrying a fully precise TypeScript type.

When changing builder types, update `type-tests/patch-builder.ts`. Those tests are the quickest way to confirm the intended compile-time behavior.

## Patch Builders

Runtime builder implementation lives in `src/helper.ts`.

`createPatchBuilder<T>()` is just a typed draft factory. It creates a proxy whose property accesses extend a path and whose method calls emit draft operations.

Important runtime details:

- Calling a builder node as a function is shorthand for `$replace(...)`.
- Passing a function to a builder node creates a `nested` draft update.
- `$variant(value)` adds a tag path segment.
- `$move({fromIdx, targetIdx, after})` creates an array-local move at the current path.
- Numeric-looking property names are normalized to numbers so array paths use numeric indices.
- `createPatchDispatcher(...)` is the underlying primitive. The React bindings use it to dispatch immediately instead of returning drafts.

Builder proxies are intentionally dynamic at runtime. The compile-time type layer is what prevents invalid authoring in normal TypeScript code.

## Realizing Drafts

Draft realization lives in `src/make.ts`.

`realizeDraftPatch(base, draft)` turns a single draft into an invertible realized patch:

- `replace` reads the current value and stores it as `previous`;
- replacing a missing value becomes an `add`;
- `remove` reads and stores the removed value;
- `push` becomes an `add` at the current array length;
- `reorder` verifies that indices match the current array;
- `nested` cannot be realized directly.

`resolveAndApply(...)` handles one draft, arrays of drafts, and nested arrays. For `nested` drafts, it reads the current value at the outer path, runs the callback with a fresh builder rooted at that value, rebases the returned inner drafts onto the outer path, then realizes and applies them in order.

## Applying Patches

Patch application lives in two layers:

- `src/ops.ts`: public operation dispatch, inversion, rebasing.
- `src/internal.ts`: low-level path traversal and immutable updates.

`ops.apply(...)` dispatches by operation:

- `add` inserts into arrays or assigns missing object keys;
- `replace` requires `previous` to match the current value;
- `remove` requires the expected removed value to match;
- `move` reorders one array item before or after another index at `path`;
- `reorder` replaces an array with a permutation.

The low-level helpers clone only changed ancestors. Unchanged branches retain reference identity, which is important for React path subscriptions and general performance.

Runtime path checks are deliberately strict about arrays: array paths require numeric keys, not string keys like `"0"`.

## History

History lives in `src/history/history.ts`.

`History<T, An>` is a tree:

- `initial`: the root state;
- `current`: the currently selected state;
- `nodes`: history nodes keyed by id;
- `root`: the root node id;
- `tip`: the current node id;
- `undoTrail`: redo stack;
- `annotations`: optional per-node metadata.

Each non-root history node stores realized `changes: Patch<T>[]`. Undo applies inverted changes in reverse order. Redo reapplies changes. Jumping between arbitrary nodes computes the path through the history tree in `src/history/findHistoryJump.ts`, inverts changes up to the common ancestor, then applies changes down to the destination.

`dispatchWithChangedPaths(...)` returns both the next history and the paths touched by the operation. React uses those paths for targeted subscriptions.

## CRDT Layer

CRDT code lives in `src/crdt/*` and is exported as `umkehr/crdt`.

The CRDT layer converts realized patches into commutative updates that can be exchanged between replicas:

- `document.ts` creates a `CrdtDocument<T>` from initial state plus a typia OpenAPI schema collection.
- `metadata.ts` builds and clones the metadata tree that tracks per-value versions, array item ids, array item lifecycle, tagged-union incarnations, and tombstones.
- `updates.ts` converts realized local `Patch<T>` values into CRDT updates.
- `apply.ts` applies incoming CRDT updates, queues updates whose parents have not arrived yet, and retries pending updates after successful applies.
- `materialize.ts` turns metadata back into the public state shape.
- `path.ts`, `schema.ts`, and `traversal.ts` translate between normal Umkehr paths, CRDT paths, schema nodes, and metadata parents.
- `history.ts` maintains CRDT-local undo/redo stacks by recording local effects and generating fresh CRDT updates for undo and redo.
- `validation.ts` validates serialized CRDT updates against the document schema.
- `clock.ts`, `hlc.ts`, and `fractionalIndex.ts` provide timestamp ordering, replica clocks, and array ordering.

CRDT paths are not the same as normal `Path` values. They include stable array item ids, parent incarnation timestamps, and tagged-union branch metadata. They do not include array order values; order is carried by `insert` and `setOrder` updates. These fields let remote updates target the right logical value even after array reordering, deletion, or recreation.

Important behavior to preserve:

- CRDT updates are timestamped and last-writer-wins at each metadata node.
- Deletions leave tombstones so older or out-of-order updates can be discarded correctly.
- Array inserts use a dedicated `insert` update with a stable item id and fractional order value instead of a numeric index.
- Array item tombstones store deletion timestamps, not order values.
- Array `move` translates to a narrow `setOrder` update for the moved item.
- Remote updates apply to the CRDT document but do not enter local undo/redo history.
- Undo and redo use optional update `command` info to group local edit/undo/redo commands, then generate fresh CRDT updates only when the recorded local effects are still applicable.
- Pending remote updates should stay queued only while a missing parent, missing tag branch, or future incarnation can still arrive.

Because CRDT document creation and update validation depend on typia schemas, `typia` remains optional. Do not import CRDT code from the root entry point.

## React Bindings

React code lives in `src/react/react.tsx`.

The React layer is built around mutable context objects plus explicit listener lists. It does not rely on replacing React context values for every state change. Instead:

- `useValue(builderPath)` subscribes to a specific path;
- dispatch records changed paths;
- only listeners for affected paths are notified;
- history views can subscribe separately to history-tree changes.

Preview updates use `ApplyTiming = 'preview'`. Preview changes are applied to a temporary preview state and can be cleared without committing to history. This powers interactions like hovering over color swatches.

The providers accept a `save` callback. Examples use this for persistence; the core React binding does not know about localStorage or storage formats.

Shared React subscription utilities live in `src/react-core/index.ts`. Keep generic path-listener behavior there when it is needed by both `src/react` and `src/react-crdt`.

## React CRDT Bindings

React CRDT code lives in `src/react-crdt/react-crdt.tsx` and is exported as `umkehr/react-crdt`.

`createSyncedContext(...)` has the same path-subscription shape as the regular React binding, but the backing state is a `CrdtLocalHistory<T>` instead of a plain `History<T, An>`. The provider receives a `SyncedTransport`:

```ts
type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};
```

Local dispatch resolves normal drafts through the core patch layer, converts the realized patches into CRDT updates, updates local CRDT history, publishes the updates, and notifies only affected paths when possible. Remote updates are applied through CRDT history, saved, and then mapped back to normal paths for targeted React subscriptions. If a remote update cannot be mapped cleanly, notify all path listeners.

Preview behavior mirrors the regular React binding: preview drafts are held outside committed history, cleared before local commit/undo/redo, and recomputed when remote updates arrive while a preview is active.

## Validation

Validation lives in `src/validation/index.ts` and is exported as `umkehr/validation`.

Validation is for untrusted serialized patches, such as localStorage, server data, or a sync log. It uses a typia-generated OpenAPI 3.1 schema collection:

```ts
const validator = createPatchValidator<State>(typia.json.schemas<[State], '3.1'>());
```

The validator checks:

- patch envelope shape;
- path legality against the schema;
- `value` and `previous` payloads at the target path;
- tagged-union path segments;
- `move` array targets;
- `reorder` targets.

It does not validate a whole history object and it does not prove state-level preconditions like `replace.previous` matching the current state. Callers that persist a full history should validate the history envelope themselves, validate states with typia, and validate stored patches with `createPatchValidator`.

Because validation depends on typia types, `typia` is an optional peer dependency. Do not import validation from the root entry point.

## Tests And Checks

Common commands:

```sh
npm run typecheck
npm test
npm run typecheck:tests
npm run typecheck:examples
```

Use focused tests while developing, but run `npm test` before considering a change complete. The package smoke test checks that root, React, and validation entry points stay separated.
It also checks the separate CRDT and React CRDT entry points.

The React example has its own build:

```sh
cd examples/react
pnpm run build
```

The React CRDT example has its own build:

```sh
cd examples/react-crdt
pnpm run build
```

## Contribution Guidelines

Keep changes local to the layer they affect:

- Type-level builder changes should usually touch `src/types.ts` plus type tests.
- Builder runtime changes should usually touch `src/helper.ts` plus core/helper tests.
- Patch semantics should usually touch `src/make.ts`, `src/ops.ts`, or `src/internal.ts` plus core/internal tests.
- History behavior should usually touch `src/history/*` plus history tests.
- React subscription or preview behavior should usually touch `src/react/react.tsx` plus React tests.
- Shared React subscription behavior should usually touch `src/react-core/index.ts` plus both React and React CRDT tests when behavior changes for both bindings.
- CRDT document/update semantics should usually touch `src/crdt/*` plus `src/crdt/crdt.test.ts` or the focused CRDT history/validation tests.
- React CRDT subscription, transport, preview, or undo/redo behavior should usually touch `src/react-crdt/react-crdt.tsx` plus `src/react-crdt/react-crdt.test.tsx`.
- Validation behavior should usually touch `src/validation/*` plus validation tests.

Avoid broad refactors while changing semantics. The library depends on a small number of invariants being easy to reason about: drafts are produced by typed builders, realized patches are invertible, patch application clones changed ancestors only, and history nodes store realized patches.

When adding a new operation or path behavior, update all relevant layers: types, builder proxy, draft realization, patch application, inversion, history changed-path reporting, CRDT update generation/application/path mapping, validation, React and React CRDT subscriptions, tests, and README/docs if it is public.
