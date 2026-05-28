# Umkehr

The no-nonsense undo/redo library for json state.

Pronounced "oom-care". from the german for "a turning back", "changing one's ways", or "repentance".

What does it do? It allows you to make surgical edits to a large state document, handles undo/redo and arbitrary jumps around the history tree, with extremely handy type-safe update builders.

Inspired by the JSON Patch standard and CRDTs, though different from both.

## Install

```sh
npm install umkehr
```

```sh
pnpm add umkehr
```

```sh
bun add umkehr
```

## Entry Points

| Import | Use |
| --- | --- |
| `umkehr` | Core patch builders, patch application, and history helpers |
| `umkehr/react` | React contexts, hooks, and updater types |
| `umkehr/remix` | Remix 3 client component contexts and updater types |

React and Remix are optional peer dependencies. Non-React and non-Remix users should import from
`umkehr`.

## Examples

Small runnable examples live in [`examples`](./examples):

| Example | Shows |
| --- | --- |
| [`examples/basic`](./examples/basic) | Draft patches, realized changes, applying and inverting patches |
| [`examples/history`](./examples/history) | Dispatch, undo, redo, branching, and jump |
| [`examples/react`](./examples/react) | React context setup, `useValue`, preview updates, undo, and redo |
| [`examples/remix3`](./examples/remix3) | Remix 3 beta client components, path watches, preview updates, undo, and redo |
| [`examples/tagged-union`](./examples/tagged-union) | `$variant` with direct and callback forms |

## Quick Start

```ts
import {createPatchBuilder, resolveAndApply} from 'umkehr';

type State = {
    title: string;
    tags: string[];
};

const state: State = {
    title: 'Draft',
    tags: ['local'],
};

const $ = createPatchBuilder<State>();

const {current, changes} = resolveAndApply(
    state,
    [$.title('Published'), $.tags.$push('featured')],
    undefined,
    'type',
    Object.is,
);

current.title; // "Published"
current.tags; // ["local", "featured"]
changes; // realized, invertible patch operations
```

## Core Terms

### DraftPatch

`DraftPatch<T>` is the authoring form of a patch operation. It records what the caller wants to do,
but it may omit data that can only be known by reading the current state.

For example:

| Draft operation | State-dependent realization |
| --- | --- |
| `replace` | Adds the previous value so the patch can be inverted |
| `remove` | Adds the removed value so the patch can be inverted |
| `push` | Resolves to an `add` at the current array length |
| `add`, `move`, `reorder` | Already contain enough information to apply |

### Patch

`Patch<T>` is the realized, invertible form of a patch operation. These are the operations to store
in history because they can be applied and inverted later.

Most callers should use `resolveAndApply`, `dispatch`, `createStateContext`, or
`createHistoryContext`, which realize drafts for you.

### Path

`Path` is an array of structured path segments:

```ts
[
    {type: 'key', key: 'items'},
    {type: 'key', key: 0},
];
```

Umkehr patch objects are inspired by JSON Patch, but they are not JSON Patch compatible. Paths are
structured arrays, not JSON Pointer strings like `"/items/0"`, and tagged-union path segments are
Umkehr-specific.

## Building Draft Operations

Use `createPatchBuilder<T>()` to create typed draft operations without applying them:

```ts
import {createPatchBuilder, type DraftPatch} from 'umkehr';

type State = {
    title: string;
    tags: string[];
    settings?: {
        archived: boolean;
    };
};

const $ = createPatchBuilder<State>();

const rename: DraftPatch<State> = $.title('New title');
const addTag: DraftPatch<State> = $.tags.$push('featured');
const removeSettings: DraftPatch<State> = $.settings.$remove();
```

Every property access extends the path. Calling a node is shorthand for replacing that path:

```ts
$.title('New title');
$.settings.archived(true);
```

When you pass a function instead of a value, Umkehr treats it as a nested update. The function gets
the current value at that path and an `up` helper rooted at the same path:

```ts
$.settings((settings, up) => up.archived(!settings?.archived));
```

`up` looks like the normal patch builder, but it only creates draft operations. It does not dispatch
or apply them by itself. Return one draft or an array of drafts, and Umkehr will rebase them onto the
outer path and apply them together as a single update (so that they "undo" and "redo" together).

Use `createPatchBuilder('kind')` when your tagged unions use a discriminant other than `'type'`.

Use `createPatchBuilderWithContext` when nested `$update` callbacks need caller-provided context:

```ts
import {createPatchBuilderWithContext} from 'umkehr';

const $ = createPatchBuilderWithContext<State, {source: string}>('type', {source: 'example'});
```

Use `createPatchDispatcher` when you want the same builder API to immediately call an application
function:

```ts
import {createPatchDispatcher} from 'umkehr';

const $ = createPatchDispatcher<State, undefined, 'type'>(
    (draft, timing) => dispatch(draft, timing),
    undefined,
    'type',
);
```

## Builder Methods

| Method | Available on | Result |
| --- | --- | --- |
| `some.path.$replace(value)` | Any path | Draft `replace` |
| `some.path(value)` | Any path | Alias for `.$replace` |
| `some.path.$update((value, up) => draft / draft[])` | Any path | Nested draft update based on current value. Can be used to combine multiple changes into a single "history item" |
| `some.path((value, up) => draft)` | Any path | Alias for `.$update` |
| `some.path.$add(value)` | Any path | Draft `add` |
| `some.path.$remove()` | Any path | Draft `remove` |
| `some.path.$push(value)` | Arrays | Draft `push`, realized as an `add` at the current array length |
| `some.path.$move({fromIdx, targetIdx, after})` | Arrays | Draft array `move` within the current path |
| `some.path.$reorder(indices)` | Arrays | Realized `reorder` using old indices in their new order |
| `some.path.$variant(tag)` | Tagged unions | Refines the updater to one union arm |
| `some.path.$variant(value, handlers)` | Tagged unions | Runs the handler for the active union arm |

`$move({fromIdx: 0, targetIdx: 2, after: true})` changes `['a', 'b', 'c']` into `['b', 'c', 'a']`.

`$reorder([2, 0, 1])` changes `['a', 'b', 'c']` into `['c', 'a', 'b']`.

## Applying Drafts

`resolveAndApply` realizes one or more draft operations, applies them in order, and returns the new
state plus realized patch operations:

```ts
import {createPatchBuilder, resolveAndApply} from 'umkehr';

const $ = createPatchBuilder<State>();

const {current, changes} = resolveAndApply(
    state,
    [$.title('New title'), $.tags.$push('featured')],
    undefined,
    'type',
    Object.is,
);
```

## History

Use `blankHistory(initialState)` to create a history tree:

```ts
import {blankHistory, createPatchBuilder, dispatch} from 'umkehr';

const $ = createPatchBuilder<State>();
const history = blankHistory(initialState);
const nextHistory = dispatch(history, [$.title('New title')]);
const undone = dispatch(nextHistory, {op: 'undo'});
const redone = dispatch(undone, {op: 'redo'});
```

The simple `dispatch` overload uses the default `'type'` discriminant, no builder context, and
`fast-deep-equal`. The lower-level overload accepts a context value, tag key, equality function, and
ID generator.

History is a tree. If you undo and then dispatch a new change, the new node becomes another child of
the current history node rather than deleting the old branch.

## React Quick Start

```tsx
import {blankHistory} from 'umkehr';
import {createHistoryContext, useValue} from 'umkehr/react';

type State = {
    title: string;
};

const [ProvideState, useStateContext] = createHistoryContext<State, never>('type');

export function App() {
    return (
        <ProvideState initial={blankHistory<State>({title: 'Draft'})}>
            <TitleEditor />
        </ProvideState>
    );
}

function TitleEditor() {
    const ctx = useStateContext();
    const title = useValue(ctx.$.title);

    return (
        <>
            <input value={title} onChange={(event) => ctx.$.title(event.target.value)} />
            <button onClick={() => ctx.undo()} disabled={!ctx.canUndo()}>
                Undo
            </button>
            <button onClick={() => ctx.redo()} disabled={!ctx.canRedo()}>
                Redo
            </button>
        </>
    );
}
```

The history context exposes:

| API | Use |
| --- | --- |
| `ctx.$` | Root patch builder for the current state |
| `ctx.latest()` | Current state value |
| `ctx.undo()` / `ctx.redo()` | History navigation |
| `ctx.canUndo()` / `ctx.canRedo()` | History availability |
| `ctx.previewJump(id)` | Temporarily previews the state at another history node |
| `ctx.clearPreview()` | Clears temporary preview state without committing it |
| `ctx.useHistory()` | React hook for subscribing to history changes |
| `ctx.dispatch(...)` | Lower-level dispatch for draft ops or history commands |

Use `useValue(ctx.$.path)` to read and subscribe to a specific path. Components re-render when that
path, an ancestor, or a descendant is notified:

```tsx
const title = useValue(ctx.$.title);
const firstTag = useValue(ctx.$.tags[0]);
```

`useValue` also accepts a selector and equality function for derived values:

```tsx
const parity = useValue(
    ctx.$.count,
    (count) => ({parity: count % 2}),
    true,
    (a, b) => a.parity === b.parity,
);
```

The default selector returns the path value itself, and the default equality function is
`fast-deep-equal`.

For state without undo/redo, use `createStateContext`:

```tsx
import {createStateContext, useValue} from 'umkehr/react';

const [ProvideState, useStateContext] = createStateContext<State>('type');
```

The non-history context exposes `ctx.$`, `ctx.latest()`, `ctx.clearPreview()`, and
`ctx.dispatch(...)`.

## Preview Updates

Most updater methods accept an optional timing argument:

```ts
ctx.$.title('Preview title', 'preview');
ctx.$.title('Committed title');
```

Preview changes are applied to temporary state and notify path subscribers, but they are cleared
before the next committed update.

This is to enable interactions such as "scrubbing through a color picker" where you want the update the UI with the currently-hovered-value, but you don't want to spam history with these temporary updates or persist them. The next "non-preview" update is based on the state before any preview updates were processed, and clears all preview updates.

Note that preview updates are queued via requestAnimationFrame, whereas non-preview updates are processed immediately.

## Tagged Unions

Pass the discriminant key to `createPatchBuilder`, `createStateContext`, or `createHistoryContext`.
The default is `'type'`.

```ts
type Item = {type: 'shape'; radius: number} | {type: 'text'; text: string};

ctx.$.item.$variant('shape').radius(10);
```

There is also a callback form for code that has the current value:

```ts
ctx.$.item.$variant(item, {
    shape: (value, up) => up.radius(value.radius + 1),
    text: (value, up) => up.text(`${value.text}!`),
});
```

## Supported Data Model

Umkehr is intended for plain JSON-like data:

| Area | Support |
| --- | --- |
| Objects and arrays | Supported; changed ancestors are cloned |
| Primitive values | Supported as leaves and root values |
| `undefined` | Treated as absence by draft realization for add/remove decisions |
| Equality | Defaults to `fast-deep-equal` in history and React helpers; lower-level APIs accept a custom equality function |
| Paths | Structured `PathSegment[]`; no JSON Pointer strings |
| Tagged unions | Supported through Umkehr-specific tag path segments |
| CRDT behavior | Supported through `umkehr/crdt`; array `move` maps to stable item order updates |
| Arbitrary object diffing | Not supported |

## CRDT Behavior

`umkehr/crdt` is an operation-based CRDT layer for valid updates produced by honest replicas from
the same initial document and schema. Under arbitrary duplicate and reordered eventual delivery,
replicas are expected to converge in both materialized state and canonical CRDT metadata. Updates
whose causal parents never arrive may remain pending, but no update that is ready to apply should
remain stuck in `pending`.

CRDT update validation belongs at network and storage boundaries through
`createCrdtUpdateValidator` or `validateCrdtUpdate`; `applyCrdtUpdate` is intentionally kept fast
and does not validate every update internally. Root tombstones, Byzantine/malicious updates,
tombstone garbage collection, and fractional-order rebalancing are not part of the current CRDT
claim.

## Limitations

- Umkehr patches are not JSON Patch compatible.
- `copy` is not part of the public patch operation set.
- Preview updates are temporary React-context state; they are cleared before the next committed
  update.
- Array paths use numeric indices. Realized array operations are tied to the array state they were
  realized against.
- Persisted patch history assumes compatible application state shape. If your schema changes, you
  need to migrate stored history or start a new history root.
