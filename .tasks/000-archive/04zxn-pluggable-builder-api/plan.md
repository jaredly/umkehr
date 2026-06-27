# Plan: Typed Third-Party Builder Extension API

## Goal

Replace the hardcoded `$text` and `$block` builder support with a general typed extension API that third-party leaf CRDT plugins can use without modifying core.

The accepted design choices from `research.md` are:

- No built-in builder extensions are included by default in `createPatchBuilder()`.
- Each leaf plugin gets at most one builder extension for now.
- Builder extensions are leaf-only for now.
- React CRDT providers are created with a known extension tuple for compile-time typing.
- No module augmentation in this pass.
- Runtime extension key collisions throw early.
- Plugin builder methods are single-argument commands; the optional second argument is always `when?: ApplyTiming`.
- No low-level `$leaf(plugin, change)` escape hatch.

## Target API

Standalone builder:

```ts
const $ = createPatchBuilder<State>({
    builderExtensions: [richTextBuilderExtension],
});

$.body.$text.insert({at: {index: 0}, text: 'hi'});
$.body.$text.insert({at: {index: 0}, text: 'hi'}, 'preview');
```

Plugin-carried extension:

```ts
export const richTextLeafPlugin = {
    id: RICH_TEXT_LEAF_PLUGIN_ID,
    version: RICH_TEXT_LEAF_PLUGIN_VERSION,
    builder: richTextBuilderExtension,
    // ...
} satisfies LeafCrdtPlugin<...>;
```

React CRDT:

```ts
const [Provider, useDoc] = createSyncedContext<
    State,
    'type',
    never,
    [typeof richTextBuilderExtension]
>('type', equal, undefined, {
    builderExtensions: [richTextBuilderExtension],
});
```

At runtime, CRDT-aware contexts may also derive builder extensions from registered leaf plugins. Compile-time typing still comes from the provider's extension tuple.

## Phase 1: Core Builder Extension Types

Add a new core module, likely `src/builderExtensions.ts`, for builder-extension definitions.

Define:

- `LeafBuilderExtension<TValue, TKey, TPlugin, TCommands>`
- `LeafBuilderCommand<TChange, TArg>`
- `LeafBuilderCommandMap<TChange>`
- `LeafBuilderExtensionAny`
- `PatchBuilderRuntimeExtension`
- `defineLeafBuilderExtension<TValue, TChange>()(...)`

Because builder methods are single-argument only, a command should have this shape:

```ts
type LeafBuilderCommand<TChange, TArg> = (arg: TArg) => TChange;
```

Generated builder methods should have this shape:

```ts
type BuilderCommandMethod<F, R> =
    F extends (arg: infer Arg) => unknown
        ? (arg: Arg, when?: ApplyTiming) => R
        : never;
```

Add type helpers:

- `BuilderSurfaceForExtension<E, Current, R>`
- `BuilderSurfacesForExtensions<Extensions, Current, R>`

Acceptance checks:

- A single extension maps to `{[key]: {[command]: (arg, when?) => R}}`.
- Multiple extensions compose into one builder surface.
- Extension command arguments stay strongly typed.
- Non-matching value types get no extension surface.

## Phase 2: Thread Extension Generics Through Patch Builders

Update `src/types.ts` and `src/helper.ts` so `PatchBuilderInternal` and `PatchBuilder` include an extension tuple generic.

Likely type signatures:

```ts
type PatchBuilder<
    T,
    Tag extends PropertyKey = 'type',
    R = void,
    Context = unknown,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = PatchBuilderInternal<T, T, Tag, R, Context, Extensions>;
```

Update `PatchBuilderInternal` recursive navigation so every nested builder receives the same `Extensions`.

Remove these hardcoded type imports from `src/types.ts`:

- `RichCollaborativeText`
- `BlockRichText`
- rich text snapshot/value types
- block `Op`, `Lamport`, `DefaultBlockMeta`

Remove hardcoded `RichTextBuilderMethods` and `BlockRichTextBuilderMethods` from core.

Acceptance checks:

- Existing non-leaf builder types still compile.
- Array/object/record/tagged-union navigation still works.
- `$text` and `$block` are absent unless their extensions are provided.

## Phase 3: Runtime Dispatcher Support

Add builder-extension options to dispatcher creation.

Suggested option type:

```ts
type PatchBuilderOptions<
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    builderExtensions?: Extensions;
};
```

Update:

- `createPatchBuilder`
- `createPatchBuilderWithContext`
- `createPatchDispatcher`

Runtime behavior:

1. Normalize `builderExtensions ?? []`.
2. Build a map by extension `key`.
3. Throw if two extensions share the same key.
4. In the proxy `get` trap, check extension keys before falling through to normal path navigation.
5. Return a cached command object for the extension.
6. Each command method receives `(arg, when?)`.
7. It emits:

```ts
apply({
    op: 'leaf',
    plugin: extension.plugin,
    path,
    change: extension.commands[command](arg),
    ...ghost,
}, when)
```

Remove the hardcoded runtime `$text` and `$block` branches from `src/helper.ts`.

Acceptance checks:

- Generic runtime extension emits the expected plugin-tagged leaf patch.
- Passing `'preview'` as the second argument reaches `apply(..., 'preview')`.
- Duplicate extension keys throw when creating the dispatcher/builder.
- Unknown `$something` with no registered extension still behaves as normal path navigation.

## Phase 4: Attach Builder Extensions To Leaf Plugins

Update `LeafCrdtPlugin` with one optional builder field:

```ts
builder?: LeafBuilderExtension<TValue, string, TId, any>;
```

Keep this field optional so plugins without ergonomic builders remain valid.

Add helper:

```ts
function builderExtensionsFromLeafPlugins(
    plugins: LeafPluginRegistry | readonly LeafCrdtPluginAny[],
): LeafBuilderExtensionAny[]
```

This helper should:

- return only plugins with `builder`
- preserve plugin order for arrays
- use registry value order for registries
- throw if builder/plugin ids do not match, if that is not already guaranteed by typing

Acceptance checks:

- Existing plugins without builders still typecheck.
- Runtime extension derivation works from a CRDT document's `schema.leafPlugins`.
- Builder key collisions still throw via dispatcher normalization.

## Phase 5: Migrate Rich Text Builder

Move rich text builder command definitions into `src/richtext`.

Because commands must be single-argument, replace the current multi-argument runtime command shape with object args:

Current:

```ts
$.body.$text.insert({index: 0}, 'hi')
$.body.$text.mark({start: 0, end: 2}, 'strong', true, 'inclusive')
```

New:

```ts
$.body.$text.insert({at: {index: 0}, text: 'hi'})
$.body.$text.mark({
    range: {start: 0, end: 2},
    markType: 'strong',
    value: true,
    preset: 'inclusive',
})
```

Define:

- `richTextBuilderExtension`
- command arg types:
  - `RichTextInsertCommand`
  - `RichTextDeleteCommand`
  - `RichTextMarkCommand`
  - `RichTextUnmarkCommand`
  - `RichTextReplaceCommand`

Attach:

```ts
builder: richTextBuilderExtension
```

to `richTextLeafPlugin`.

Update all `$text` call sites and tests to pass `richTextBuilderExtension` explicitly or use a CRDT/React context configured with it.

Acceptance checks:

- `$text` no longer depends on core imports.
- Rich text CRDT tests still pass.
- Rich text builder runtime tests use the generic extension path.
- Old multi-argument `$text` call sites are fully migrated.

## Phase 6: Migrate Block Rich Text Builder

Move block builder command definitions into `src/block-richtext`.

Current:

```ts
$.body.$block.insertText(block, 0, 'hi')
$.body.$block.deleteRange(block, 0, 2)
$.body.$block.moveBlock({block, parent})
```

New:

```ts
$.body.$block.insertText({block, offset: 0, text: 'hi'})
$.body.$block.deleteRange({block, startOffset: 0, endOffset: 2})
$.body.$block.moveBlock({block, parent})
```

Define:

- `blockRichTextBuilderExtension`
- command arg types for:
  - `ops`
  - `insertText`
  - `deleteRange`
  - `splitBlock`
  - `joinBlocks`
  - `moveBlock`
  - `setBlockMeta`

Attach:

```ts
builder: blockRichTextBuilderExtension
```

to `blockRichTextLeafPlugin`.

Update all `$block` call sites and tests to pass `blockRichTextBuilderExtension` explicitly or use a CRDT/React context configured with it.

Acceptance checks:

- `$block` no longer depends on core imports.
- Block rich text plugin, builder, undo/redo, and example registry tests pass.
- Old multi-argument `$block` call sites are fully migrated.

## Phase 7: React CRDT And Example App Typing

Update `createSyncedContext` and related types to accept a builder extension tuple.

Suggested signature:

```ts
createSyncedContext<
    T,
    Tag extends string = 'type',
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    tag: Tag,
    equalFn?: EqualFn,
    ephemeralConfig?: EphemeralConfig<EphemeralData>,
    options?: {builderExtensions?: Extensions},
)
```

Update `SyncedContext` so:

- `$` includes `Extensions`
- `dispatch(...)` accepts draft patches built with `Extensions`
- `useRichText(...)`, if kept, uses `richTextBuilderExtension` typing internally or remains a built-in convenience independent of `$text`

Runtime:

- Provider should prefer explicit `options.builderExtensions`.
- If explicit extensions are absent, it may derive runtime extensions from `initial.doc.schema.leafPlugins`.
- Compile-time methods only appear when the context generic includes the extension tuple.

Update `examples/react-crdt` app definitions/runtimes to carry known builder extension tuples where needed:

- rich notes: `[typeof richTextBuilderExtension]`
- block notes: `[typeof blockRichTextBuilderExtension]`
- other apps: `[]`

Acceptance checks:

- React CRDT tests compile with explicit extension tuples.
- Rich notes still dispatches rich text commands.
- Block notes dispatches `$block` commands through the configured provider/runtime.
- Runtime derived extensions work for CRDT providers that have plugin builders.

## Phase 8: Compatibility And Migration Helpers

Decide whether to provide compatibility wrappers for existing built-ins.

Possible helper:

```ts
createRichTextPatchBuilder<T>()
createBlockRichTextPatchBuilder<T>()
```

These are optional convenience APIs outside core. The core `createPatchBuilder()` should not include built-ins by default.

Recommended first pass:

- Do not add compatibility wrappers unless migration churn is high.
- Update internal tests/examples to the new object-argument API.
- Document the breaking changes in the implementation log.

Acceptance checks:

- No hardcoded `$text` or `$block` branches remain in core.
- No core type imports from rich text or block rich text remain.
- Public built-in packages export their builder extensions.

## Phase 9: Tests

Add or update tests in these areas.

Core type tests:

- generic extension appears only on matching value type
- extension methods enforce single object-argument type
- extension methods accept optional `when?: ApplyTiming` as the second argument
- extension methods return `DraftPatch` for `createPatchBuilder`
- extension methods return `void` for dispatchers/context `$`
- no `$text`/`$block` when extension tuple is absent

Core runtime tests:

- generic extension emits `op: 'leaf'`
- preview timing is passed through
- duplicate keys throw
- extension command object is cached per path

Rich text migration tests:

- `richTextBuilderExtension` emits current rich text patch changes
- CRDT update creation still produces the same operations
- undo/redo tests still pass
- non-CRDT history still rejects leaf patches

Block migration tests:

- `blockRichTextBuilderExtension` emits current block patch changes
- insert/delete/split/join/move/meta builder commands validate and apply
- undo/redo tests still pass
- block notes app registry test still passes

React CRDT tests:

- context with extension tuple exposes commands
- context without extension tuple does not expose commands at type level
- provider runtime can dispatch plugin-carried builder extensions

Verification:

- `npm run typecheck`
- `npm run typecheck:tests`
- `npm test`
- `npm run typecheck:examples`
- focused `examples/react-crdt` registry tests

## Phase 10: Documentation And Cleanup

Update docs/comments in:

- `src/core.ts` exports
- `src/crdt/plugins.ts` for the optional plugin `builder`
- rich text public exports
- block rich text public exports
- task implementation log

Document:

- how to define a leaf builder extension
- how to attach it to a plugin
- how to pass extensions to `createPatchBuilder`
- how to configure `createSyncedContext`
- the single-argument command convention

Cleanup checks:

- `rg "\\$text|\\$block" src/types.ts src/helper.ts` finds no hardcoded implementation
- `rg "RichCollaborativeText|BlockRichText" src/types.ts` finds no coupling
- `rg "RICH_TEXT_LEAF_PLUGIN_ID|BLOCK_RICH_TEXT_LEAF_PLUGIN_ID" src/helper.ts` finds no coupling

## Risks

- The single-argument command convention is a breaking API change for `$text` and `$block`.
- React CRDT generic parameter order may get awkward. If needed, introduce an options object or separate `createSyncedContextWithBuilders(...)` helper.
- Runtime extension derivation from plugins can make commands available at runtime even when TypeScript does not expose them. This is acceptable as long as compile-time surfaces remain explicit.
- Type-level composition of extension tuples can get complex. Keep the first implementation narrow: readonly tuples of `LeafBuilderExtensionAny`, one key per extension, one object argument per command.
