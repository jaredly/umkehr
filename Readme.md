# Umkehr

Small JSON state updates with undo/redo history.

This library is built around a proxy updater that produces patch operations for plain JSON-like
state. It is not a CRDT, and it does not try to infer a diff between two arbitrary states. The
usual flow is:

1. Build a draft operation from a typed updater.
2. Realize the draft operation against the current state.
3. Apply the realized operation and store it in history.

## Core Terms

### DraftPatch

`DraftPatch<T>` is the authoring form of a patch operation. It records what the caller wants
to do, but it may omit data that can only be known by reading the current state.

For example:

- A draft `replace` has the new `value`, but not the old `previous` value.
- A draft `remove` has the `path`, but not the value being removed.
- A draft `push` targets an array path, but its final numeric insertion path depends on the current
  array length.
- `add`, `move`, and `copy` already contain the information needed to apply/invert them, so their
  draft and realized forms are the same shape.

### Patch

`Patch<T>` is the realized, invertible form of a patch operation. It contains the extra
state-dependent data needed to apply the change safely and invert it later.

Use `realizeDraftPatch(base, draft)` when you need to convert one draft op yourself. Most callers
should use `resolveAndApply`, `createStateContext`, or `createHistoryContext`, which realize drafts for you.

### Path

`Path` is an array of structured path segments:

```ts
[
    {type: 'key', key: 'items'},
    {type: 'key', key: 0},
];
```

The runtime does not use JSON Pointer strings like `"/items/0"`.

Umkehr patch objects are inspired by JSON Patch, but they are not JSON Patch compatible. Paths are
structured arrays, tagged-union path segments are Umkehr-specific, and operation semantics include
state-dependent draft realization for undo/redo.

## Building Draft Operations

Use `createPatchBuilder<T>()` to create typed draft operations without applying them:

```ts
import {createPatchBuilder, DraftPatch} from 'umkehr';

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

Explicit methods are also available:

```ts
$.title.$replace('New title');
$.tags.$push('featured');
$.settings.$remove();
$.tags.$move(0, 2);
$.tags.$reorder([2, 0, 1]);
```

`$reorder` takes a list of old indices in their new order. For example, `[2, 0, 1]` changes
`['a', 'b', 'c']` into `['c', 'a', 'b']`. It is also a realized patch operation; the permutation
itself contains enough information to invert the change.

Use `$update` when the next operation depends on the current value at that path:

```ts
$.title.$update((title, up) => up(`${title}!`));
```

The callback receives the current value and a nested updater rooted at that value. The nested draft
is rebased onto the outer path before it is applied.

Use `createPatchDispatcher` when you want the same builder API to immediately call an application
function:

```ts
import {createPatchDispatcher} from 'umkehr';

const $ = createPatchDispatcher<State, null, 'type'>(
    (draft, timing) => dispatch(draft, timing),
    null,
    'type',
);
```

Use `createPatchBuilderWithContext` when nested `$update` callbacks need access to caller-provided
context:

```ts
import {createPatchBuilderWithContext} from 'umkehr';

const $ = createPatchBuilderWithContext<State, {source: string}>('type', {source: 'example'});
```

## Applying Drafts

`resolveAndApply` realizes one or more draft operations, applies them in order, and returns both the
new state and the realized patch operations:

```ts
import {resolveAndApply} from 'umkehr';

const {current, changes} = resolveAndApply(
    state,
    [$.title('New title'), $.tags.$push('featured')],
    null,
    'type',
);
```

`changes` is a `Patch<T>[]`. These are the durable operations to store in history because
they can be inverted.

## History

Use `blankHistory(initialState)` to create a history tree:

```ts
import {blankHistory, dispatch} from 'umkehr';

const history = blankHistory(initialState);
const nextHistory = dispatch(history, [$.title('New title')]);
```

The simple `dispatch` overload uses the default `'type'` discriminant, no builder context, and
`fast-deep-equal`. Use the lower-level overload when you need a custom context, tag key, equality
function, or ID generator.

The React history context wraps this for common app usage:

```ts
import {createHistoryContext, useValue} from 'umkehr/react';

const [ProvideState, useStateContext] = createHistoryContext<State, Annotation>('type');
```

Inside the provider:

```tsx
function TitleEditor() {
    const ctx = useStateContext();
    const title = useValue(ctx.$.title);

    return <input value={title} onChange={(event) => ctx.$.title(event.target.value)} />;
}
```

The context exposes:

- `ctx.$`: typed updater for the current state.
- `ctx.latest()`: current state value.
- `ctx.undo()` / `ctx.redo()`: history navigation.
- `ctx.canUndo()` / `ctx.canRedo()`: history availability.
- `ctx.useHistory()`: React hook for subscribing to history changes.
- `ctx.dispatch(...)`: lower-level dispatch for draft ops or history commands.

## Non-History React State

For state without undo/redo, use `createStateContext`:

```ts
const [ProvideState, useStateContext] = createStateContext<State>('type');
```

The returned context exposes `ctx.$`, `ctx.latest()`, and `ctx.dispatch(...)`, but no history
commands.

## Preview Updates

Most updater methods accept an optional timing argument:

```ts
ctx.$.title('Preview title', 'preview');
ctx.$.title('Committed title');
```

Preview changes are applied to a temporary state and notify path subscribers, but they are cleared
before the next committed update.

## Tagged Unions

Pass the discriminant key to `createPatchBuilder`, `createStateContext`, or `createHistoryContext`. The default
pattern in this codebase uses `'type'`.

For tagged unions, use `$variant` to refine an updater to the active union arm:

```ts
ctx.$.item.$variant('shape').radius(10);
```

There is also a callback form for code that has the current value:

```ts
ctx.$.item.$variant(item, {
    shape: (value, up) => up.radius(value.radius + 1),
    text: (value, up) => up.text(`${value.text}!`),
});
```
