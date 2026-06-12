# CRDT Leaf Plugins

Umkehr's core CRDT handles JSON object, array, record, tagged-union, set, delete, move, and reorder semantics. Leaf plugins let a schema field opt into a specialized CRDT for the value at that field.

Use a leaf plugin when a value needs domain-specific merge behavior that normal JSON replacement cannot provide. Rich text and block rich text are both implemented this way.

## Mental Model

A leaf field is still part of the document tree, but the core CRDT treats the value at that path as plugin-owned.

The flow for a local edit is:

1. Application code creates a normal draft patch with `op: 'leaf'`.
2. `createCrdtUpdates(...)` verifies that the target path is a leaf field and that the patch plugin matches the schema metadata.
3. The plugin converts the high-level patch change into one or more CRDT operations with `createOperations(...)`.
4. Each operation is stored as a normal CRDT update with `op: 'leaf'`.
5. Every replica applies the operation through the same plugin's `applyOperation(...)`.

Core still owns:

- locating the field in the document;
- checking schema/plugin/version compatibility;
- update ordering and transport;
- metadata tree traversal;
- validation dispatch;
- undo/redo grouping.

The plugin owns:

- the JSON value format for the leaf;
- the patch change shape accepted by local commands;
- the CRDT operation format stored in history;
- applying, validating, and optionally undoing those operations.

## Schema Markers

A schema field becomes a leaf CRDT field by adding these JSON Schema extension keys:

```ts
{
    type: 'object',
    'x-umkehr-leaf-crdt': 'example.counter',
    'x-umkehr-leaf-crdt-version': 1,
}
```

With Typia, the built-in rich text types add these markers through `tags.JsonSchemaPlugin<...>`. A custom plugin can use the same pattern or can provide schemas that contain the markers directly.

The marker id and version are part of schema fingerprint input. Loading or validating a document with a schema that requires a missing or wrong-version plugin fails before updates are applied.

## Registering Plugins

Pass plugins when creating documents or validators:

```ts
import {createCrdtDocument, createCrdtUpdateValidator} from 'umkehr/crdt';
import {counterLeafPlugin} from './counterPlugin';

const doc = createCrdtDocument(initialState, schema, {
    timestamp,
    leafPlugins: [counterLeafPlugin],
});

const validator = createCrdtUpdateValidator(schema, {
    leafPlugins: [counterLeafPlugin],
});
```

Registration rules:

- plugin ids must be unique;
- registering the same id at different versions throws;
- every schema-required plugin must be present;
- the registered plugin version must exactly match the schema marker version.

## Plugin Shape

The main type is:

```ts
type LeafCrdtPlugin<
    TId extends string,
    TValue extends JsonValue,
    TPatchChange,
    TOperation extends JsonValue,
    TMetaData extends JsonValue,
> = {
    id: TId;
    version: number;
    builder?: LeafBuilderExtension<TValue, string, TId, any>;

    empty(input: {schema: Schema}): TValue;
    isValue(value: unknown): value is TValue;
    init(input: {value: TValue | undefined; schema: Schema; ts: HlcTimestamp}): {
        value: TValue;
        meta: TMetaData;
    };

    createOperations(input: {
        value: TValue;
        meta: LeafMeta<TMetaData>;
        change: TPatchChange;
        ts: HlcTimestamp;
        context: {sessionId: string};
    }): TOperation[];

    applyOperation(input: {
        value: TValue;
        meta: LeafMeta<TMetaData>;
        operation: TOperation;
        ts: HlcTimestamp;
        context: {sessionId: string};
    }): {value: TValue; meta: TMetaData};

    validateOperation(input: unknown): LeafOperationValidationResult<TOperation>;

    // Optional undo/redo hooks.
    captureEffect?(...): LocalEffect;
    createUndoOperations?(...): CrdtUpdate[];
    createUndoOperationsForEffects?(...): CrdtUpdate[];
    createRedoOperations?(...): CrdtUpdate[];
    createRedoOperationsForEffects?(...): CrdtUpdate[];
    checkEffect?(...): BlockedEffect | null;
};
```

The full definitions live in `src/crdt/plugins.ts`.

## Minimal Plugin Example

This example shows the shape of a tiny plugin. It is intentionally simple: it uses last-writer-wins operations inside the leaf. Real plugins should use operation formats that preserve the merge semantics they need.

```ts
import {type JsonValue, type LeafCrdtPlugin} from 'umkehr/crdt';

const COUNTER_PLUGIN_ID = 'example.counter';

type CounterValue = JsonValue & {
    kind: 'counter';
    version: 1;
    value: number;
};

type CounterMeta = JsonValue & {
    maxSeenValue: number;
};

type CounterPatchChange =
    | {kind: 'increment'; by: number}
    | {kind: 'set'; value: number};

type CounterOperation =
    | (JsonValue & {kind: 'increment'; by: number})
    | (JsonValue & {kind: 'set'; value: number});

export const counterLeafPlugin: LeafCrdtPlugin<
    typeof COUNTER_PLUGIN_ID,
    CounterValue,
    CounterPatchChange,
    CounterOperation,
    CounterMeta
> = {
    id: COUNTER_PLUGIN_ID,
    version: 1,

    empty() {
        return {kind: 'counter', version: 1, value: 0};
    },

    isValue(value): value is CounterValue {
        return (
            Boolean(value) &&
            typeof value === 'object' &&
            (value as {kind?: unknown}).kind === 'counter' &&
            (value as {version?: unknown}).version === 1 &&
            typeof (value as {value?: unknown}).value === 'number'
        );
    },

    init({value}) {
        const next = value ?? {kind: 'counter', version: 1, value: 0};
        return {
            value: next,
            meta: {maxSeenValue: next.value},
        };
    },

    createOperations({change}) {
        return [change];
    },

    applyOperation({value, meta, operation}) {
        const nextValue =
            operation.kind === 'increment'
                ? value.value + operation.by
                : operation.value;
        return {
            value: {...value, value: nextValue},
            meta: {
                ...meta.data,
                maxSeenValue: Math.max(meta.data.maxSeenValue, nextValue),
            },
        };
    },

    validateOperation(input) {
        if (
            input &&
            typeof input === 'object' &&
            (input as {kind?: unknown}).kind === 'increment' &&
            typeof (input as {by?: unknown}).by === 'number'
        ) {
            return {success: true, data: input as CounterOperation};
        }
        if (
            input &&
            typeof input === 'object' &&
            (input as {kind?: unknown}).kind === 'set' &&
            typeof (input as {value?: unknown}).value === 'number'
        ) {
            return {success: true, data: input as CounterOperation};
        }
        return {
            success: false,
            errors: [{path: '', message: 'Expected counter operation.'}],
        };
    },
};
```

## Builder Extensions

Plugins can expose typed builder methods so users do not have to hand-write raw `op: 'leaf'` patches.

Builder extensions are optional and leaf-only. A plugin can have at most one builder extension for now.

```ts
import {defineLeafBuilderExtension} from 'umkehr';

export const counterBuilderExtension = defineLeafBuilderExtension<
    CounterValue,
    CounterPatchChange
>()({
    key: '$counter',
    plugin: COUNTER_PLUGIN_ID,
    commands: {
        increment: (arg: {by: number}) => ({kind: 'increment', by: arg.by}),
        set: (arg: {value: number}) => ({kind: 'set', value: arg.value}),
    },
});

export const counterLeafPlugin = {
    id: COUNTER_PLUGIN_ID,
    version: 1,
    builder: counterBuilderExtension,
    // ...
} satisfies LeafCrdtPlugin<
    typeof COUNTER_PLUGIN_ID,
    CounterValue,
    CounterPatchChange,
    CounterOperation,
    CounterMeta
>;
```

Use the extension with a standalone builder:

```ts
import {createPatchBuilder} from 'umkehr';

type BuilderExtensions = [typeof counterBuilderExtension];

const $ = createPatchBuilder<State, BuilderExtensions>({
    builderExtensions: [counterBuilderExtension],
});

const patch = $.stats.count.$counter.increment({by: 1});
const previewPatch = $.stats.count.$counter.increment({by: 1}, 'preview');
```

The generated method shape is always:

```ts
(arg: CommandArg, when?: ApplyTiming) => R
```

Command methods intentionally take one object argument. This keeps plugin methods predictable and leaves the optional second argument for `when?: 'preview'`.

Runtime behavior:

- `createPatchBuilder(...)`, `createPatchBuilderWithContext(...)`, and `createPatchDispatcher(...)` accept `builderExtensions`;
- duplicate extension keys throw;
- an extension command emits `{op: 'leaf', plugin, path, change}`;
- an extension only appears on builder nodes whose value type matches the extension's value type.

Current TypeScript caveat: if you explicitly provide the document state generic, TypeScript cannot infer the extension tuple from the options object. Use the tuple generic form shown above.

## React CRDT

`createSyncedContext` accepts the same builder extension tuple:

```ts
const [Provider, useDoc] = createSyncedContext<
    State,
    'type',
    never,
    [typeof counterBuilderExtension]
>('type', undefined, undefined, {
    builderExtensions: [counterBuilderExtension],
});
```

The provider can derive runtime builder extensions from registered leaf plugins, but compile-time typing still comes from the extension tuple passed to `createSyncedContext`.

## Validation

`validateOperation(input)` validates stored CRDT operations, not high-level builder command arguments.

This distinction matters:

- builder command argument: what local application code passes to `$counter.increment(...)`;
- patch change: what the builder turns that command into;
- CRDT operation: what the plugin writes into durable update history.

Validators should reject any operation that a replica should not apply. Update validators dispatch leaf operations to the plugin validator based on the schema marker at the update path.

## Metadata

Each leaf has plugin-owned metadata stored in the CRDT metadata tree. `init(...)` creates initial metadata. `applyOperation(...)` returns the updated metadata with the new value.

Use metadata for compact, deterministic bookkeeping that is needed to create or apply later operations. Examples:

- max operation counters;
- known Lamport counters;
- cached plugin-local summaries.

Metadata must be JSON-compatible.

## Undo And Redo

Leaf undo/redo is optional. A plugin without undo hooks can still apply local and remote edits, but its edits will not be undoable through CRDT local history.

The undo pipeline is:

1. A local leaf update is applied.
2. The plugin may capture an effect with `captureEffect(...)`.
3. Undo asks the plugin to convert one or more effects into new CRDT updates.
4. Redo similarly asks the plugin to produce new forward updates.
5. `checkEffect(...)` can block undo/redo if the original effect is no longer valid, such as when its target was deleted remotely.

Plugins can implement either per-effect hooks or grouped hooks:

- `createUndoOperations(...)`
- `createUndoOperationsForEffects(...)`
- `createRedoOperations(...)`
- `createRedoOperationsForEffects(...)`

Grouped hooks are useful when one high-level command creates multiple leaf operations and undo needs to reason about them together.

## Versioning

Plugin versions are runtime compatibility boundaries.

Increment a plugin version when any persisted or schema-observable behavior changes incompatibly, including:

- the leaf value JSON format;
- the CRDT operation format;
- metadata assumptions;
- operation validation rules;
- merge semantics that old code cannot safely replay.

Do not use versions for cosmetic builder API changes if the stored value and operation formats remain compatible. Builder APIs are compile-time ergonomics; plugin versions protect persisted documents and update logs.

Because required plugin descriptors are included in schema fingerprints, changing a schema marker from version `1` to version `2` changes the schema fingerprint. Documents using the old fingerprint need a migration path if they should load under the new app schema.

## Built-In Plugins

The built-in plugin packages are examples of the same public system:

- `umkehr/richtext`
  - `richTextLeafPlugin`
  - `richTextBuilderExtension`
  - builder key: `$text`
- `umkehr/block-richtext`
  - `blockRichTextLeafPlugin`
  - `blockRichTextBuilderExtension`
  - builder key: `$block`

They are not hardcoded into the core patch builder. Register their plugins and pass their builder extensions explicitly when you want their CRDT/runtime behavior and builder methods.
