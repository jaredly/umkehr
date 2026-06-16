# Research: General Typed Third-Party Builder Extension API

## Goal

Remove the hardcoded `$text` and `$block` builder branches while preserving the ergonomics they provide:

```ts
$.body.$text.insert({index: 0}, 'hi')
$.body.$block.insertText(blockId, 0, 'hi')
```

The replacement should let a leaf CRDT plugin provide:

- a typed value shape, such as `RichCollaborativeText` or `BlockRichText`
- a typed builder command surface, such as `$text.insert(...)`
- a runtime implementation that emits a plugin-tagged `op: 'leaf'` draft patch

The design should work for third-party packages without editing `src/types.ts` or `src/helper.ts`.

## Current State

The pluggable leaf CRDT work made core CRDT updates generic:

- `LeafCrdtPlugin<TId, TValue, TPatchChange, TOperation, TMetaData>` lives in `src/crdt/plugins.ts`
- public draft patches use:

```ts
type LeafPatch<_T, TPlugin extends string = string, TChange = unknown> = {
    op: 'leaf';
    plugin: TPlugin;
    path: Path;
    change: TChange;
};
```

The remaining hardcoding is in the patch builder layer.

In `src/types.ts`, `PatchBuilderInternal` conditionally exposes built-in leaf command surfaces:

```ts
NonNullish<Current> extends RichCollaborativeText
    ? RichTextBuilderMethods<R>
    : NonNullish<Current> extends BlockRichText
      ? BlockRichTextBuilderMethods<R>
      : ...
```

In `src/helper.ts`, the proxy has matching runtime branches:

- `prop === '$text'`
- `prop === '$block'`

Each branch manually builds a leaf patch with a fixed plugin id and fixed change shape.

This means a third-party leaf plugin can participate in CRDT document creation, validation, application, schema fingerprints, and undo/redo, but it cannot add an ergonomic typed builder surface without modifying core.

## Constraints

- Builder typing and CRDT plugin execution are separate phases.
  `createPatchBuilder()` can produce draft patches without a CRDT document, schema, or registered plugin registry.

- Runtime builder dispatch only knows:
  - path
  - `apply(...)`
  - optional context/extra
  - tag key
  It does not know the actual runtime value at the path.

- TypeScript can hide methods based on `Current`, but the proxy currently returns hardcoded methods at runtime for any path. Correctness is still enforced later by CRDT metadata/plugin checks.

- `when?: ApplyTiming` is a builder-layer concern. Extension command definitions should not need to know about preview timing, but generated methods need to append it.

- Any explicit extension tuple passed to the builder can provide good type inference. A purely global/module-augmentation approach is more ergonomic but creates type/runtime drift risks.

- React CRDT contexts currently create their dispatcher internally. They can derive runtime leaf plugins from `history.doc.schema.leafPlugins`, but the TypeScript type of `ctx.$` still needs to know which builder extensions are available.

## Recommended Shape

Introduce a small builder extension abstraction, separate from but attachable to `LeafCrdtPlugin`.

### Command-Based Leaf Builder Extension

Use command functions that translate user-facing command arguments into `TPatchChange`.

Sketch:

```ts
type LeafBuilderCommand<TChange> = (...args: any[]) => TChange;

type LeafBuilderExtension<
    TValue,
    TKey extends string,
    TPlugin extends string,
    TCommands extends Record<string, LeafBuilderCommand<unknown>>,
> = {
    key: TKey;
    plugin: TPlugin;
    commands: TCommands;
    readonly __value?: TValue;
};

function defineLeafBuilderExtension<TValue>() {
    return <
        TKey extends string,
        TPlugin extends string,
        TCommands extends Record<string, LeafBuilderCommand<unknown>>,
    >(
        extension: {key: TKey; plugin: TPlugin; commands: TCommands},
    ): LeafBuilderExtension<TValue, TKey, TPlugin, TCommands> => extension as any;
}
```

A rich text extension would move out of `src/helper.ts` and into the rich text module:

```ts
export const richTextBuilderExtension =
    defineLeafBuilderExtension<RichCollaborativeText>()({
        key: '$text',
        plugin: RICH_TEXT_LEAF_PLUGIN_ID,
        commands: {
            insert: (at: RichTextIndexPosition, text: string) =>
                ({kind: 'insert', at, text}) satisfies RichTextPatchChange,
            delete: (range: RichTextIndexRange) =>
                ({kind: 'delete', range}) satisfies RichTextPatchChange,
            mark: (range, markType, value, preset) =>
                ({kind: 'mark', range, markType, value, preset}) satisfies RichTextPatchChange,
            unmark: (range, markType, preset) =>
                ({kind: 'unmark', range, markType, preset}) satisfies RichTextPatchChange,
            replace: (snapshot: RichTextImportSnapshot) =>
                ({kind: 'replace', snapshot}) satisfies RichTextPatchChange,
        },
    });
```

A block extension would similarly define `$block` commands in `src/block-richtext`.

### Generated Method Types

Core can map command functions to builder methods that return `R` and append `when?: ApplyTiming`:

```ts
type BuilderCommandMethod<F, R> =
    F extends (...args: infer Args) => unknown
        ? (...args: [...Args, ApplyTiming?]) => R
        : never;

type BuilderSurfaceForExtension<E, Current, R> =
    E extends LeafBuilderExtension<infer TValue, infer TKey, string, infer Commands>
        ? NonNullish<Current> extends TValue
            ? {
                  [K in TKey]: {
                      [C in keyof Commands]: BuilderCommandMethod<Commands[C], R>;
                  };
              }
            : {}
        : {};
```

Then `PatchBuilderInternal` takes an extension-set generic:

```ts
type PatchBuilderInternal<
    Root,
    Current,
    Tag extends PropertyKey,
    R,
    Extra = unknown,
    Extensions extends readonly LeafBuilderExtensionAny[] = DefaultBuilderExtensions,
> = ... & BuilderSurfacesForExtensions<Extensions, Current, R> & ...
```

This removes imports of `RichCollaborativeText`, `BlockRichText`, `Op`, `Lamport`, etc. from `src/types.ts`.

### Runtime Dispatch

`createPatchDispatcher(...)` should accept runtime builder extensions:

```ts
type PatchBuilderRuntimeExtension = {
    key: string;
    plugin: string;
    commands: Record<string, (...args: unknown[]) => unknown>;
};

createPatchDispatcher(apply, extra, tag, {
    builderExtensions: [richTextBuilderExtension, blockRichTextBuilderExtension],
});
```

Runtime behavior:

1. Build a `Map<string, PatchBuilderRuntimeExtension>` by `key`.
2. In the proxy `get(...)` trap, check extension keys before normal property navigation.
3. Return a cached command surface.
4. Each method:
   - strips trailing `'preview'` as `ApplyTiming`
   - calls the extension command function with the remaining args
   - emits:

```ts
apply({
    op: 'leaf',
    plugin: extension.plugin,
    path,
    change,
    ...ghost,
}, when)
```

This exactly replaces the current `$text` and `$block` proxy branches.

## How Extensions Reach Builders

There are three viable approaches.

### Option A: Explicit Extension Tuples

Users pass extensions when constructing builders:

```ts
const $ = createPatchBuilder<State>({
    builderExtensions: [richTextBuilderExtension, blockRichTextBuilderExtension],
});
```

Types can infer the tuple and expose only those extension methods.

Pros:

- strongest type/runtime alignment
- no global side effects
- best for third-party packages
- easiest to test

Cons:

- existing call sites need to pass extensions
- React CRDT contexts need another generic/options parameter
- can get noisy for common built-ins

### Option B: Plugin Carries Its Builder Extension

Add an optional `builder` field to `LeafCrdtPlugin`:

```ts
type LeafCrdtPlugin<...> = {
    ...
    builder?: LeafBuilderExtension<TValue, string, TId, any>;
};
```

Then CRDT-aware dispatchers can derive runtime builder extensions from registered leaf plugins:

```ts
Object.values(history.doc.schema.leafPlugins)
    .map((plugin) => plugin.builder)
    .filter(Boolean)
```

Pros:

- good runtime cohesion: one plugin object contains CRDT behavior and builder behavior
- React CRDT can use the registered document plugins automatically
- app definitions already have `leafPlugins`

Cons:

- standalone `createPatchBuilder()` still has no document/plugin registry
- type exposure still needs either explicit generic extension info or module augmentation
- plugin authors may want multiple builder surfaces for one plugin

This is compatible with Option A: plugin objects can carry builders, and non-CRDT builders can still accept explicit extensions.

### Option C: Module Augmentation Defaults

Export an augmentable interface:

```ts
export interface DefaultPatchBuilderExtensionTypes {}

type DefaultBuilderExtensions =
    DefaultPatchBuilderExtensionTypes[keyof DefaultPatchBuilderExtensionTypes];
```

Plugin packages augment it:

```ts
declare module 'umkehr' {
    interface DefaultPatchBuilderExtensionTypes {
        richText: typeof richTextBuilderExtension;
    }
}
```

Pros:

- best ergonomics: importing `umkehr/richtext` can make `$text` visible
- minimal type parameters at app call sites

Cons:

- module augmentation across package subpaths can be brittle
- type availability may not match runtime extension registration
- harder for users to reason about collisions
- harder to keep tree-shaking clean

This can be added later as a convenience layer, but should not be the only mechanism.

## Recommendation

Implement Options A and B together:

1. Add `defineLeafBuilderExtension(...)` and the type-level mapping in core.
2. Add an optional `builder` field to `LeafCrdtPlugin`.
3. Add `builderExtensions` runtime support to `createPatchDispatcher`.
4. Add explicit builder-extension options to `createPatchBuilder(...)` / `createPatchBuilderWithContext(...)`.
5. Update React CRDT dispatch creation to derive runtime extensions from `history.doc.schema.leafPlugins`.
6. Add a generic parameter to React CRDT context/app types for compile-time builder extensions, defaulting to no third-party extensions.
7. Move `$text` and `$block` definitions into `umkehr/richtext` and `umkehr/block-richtext`.
8. Remove the hardcoded imports/branches from `src/types.ts` and `src/helper.ts`.

This keeps the core third-party story explicit and type-safe while allowing CRDT-aware contexts to avoid duplicate runtime registration.

Module augmentation can be considered after this if ergonomics are too noisy.

## Expected Public API Sketch

Standalone builder:

```ts
const $ = createPatchBuilder<State>({
    builderExtensions: [myLeafPlugin.builder],
});

$.customLeaf.$myPlugin.doThing('arg');
```

CRDT document/app setup:

```ts
const myPlugin = {
    ...,
    builder: myBuilderExtension,
} satisfies LeafCrdtPlugin<...>;

createCrdtDocument(initial, schema, {
    timestamp,
    leafPlugins: [myPlugin],
});
```

React CRDT:

```ts
const [Provider, useDoc] = createSyncedContext<
    State,
    'type',
    never,
    [typeof myBuilderExtension]
>('type');
```

The provider/runtime can derive the extension from the document plugin registry; the generic gives TypeScript the builder surface.

## Migration Notes For Existing Built-Ins

Rich text:

- move `RichTextBuilderMethods<R>` out of `src/types.ts`
- export `richTextBuilderExtension`
- add `builder: richTextBuilderExtension` to `richTextLeafPlugin`
- update tests to construct builders with the extension or use a new built-in helper

Block rich text:

- move `BlockRichTextBuilderMethods<R>` out of `src/types.ts`
- export `blockRichTextBuilderExtension`
- add `builder: blockRichTextBuilderExtension` to `blockRichTextLeafPlugin`
- keep command names identical to current `$block`

Core:

- remove imports of `RichCollaborativeText`, `BlockRichText`, `DefaultBlockMeta`, `Lamport`, `Op`, and rich text snapshot/value types from `src/types.ts`
- remove imports of rich/block plugin constants and associated command types from `src/helper.ts`
- keep `LeafPatch` generic in `src/types.ts`

## Testing Targets

Type tests:

- extension method appears on matching value type
- extension method does not appear on plain fields
- command argument types are enforced
- method return type is `DraftPatch` for `createPatchBuilder` and `void` for dispatchers
- explicit extension tuple controls visibility

Runtime tests:

- generic extension emits the expected `op: 'leaf'` patch
- `when: 'preview'` is stripped and passed to `apply(...)`
- duplicate extension keys throw early
- unknown extension properties fall through to normal path navigation

Migration tests:

- `$text` works through `richTextBuilderExtension`
- `$block` works through `blockRichTextBuilderExtension`
- CRDT React contexts can dispatch plugin builder commands from registered leaf plugins
- non-CRDT history still rejects leaf patches

## Open Questions

1. Should built-in extensions be included by default in `createPatchBuilder()`?

   Keeping them defaulted reduces churn but leaves core with some built-in knowledge unless the default is provided by a separate convenience entry point.

    -> leave them out for now

2. Should third-party plugins be able to add multiple builder keys for one leaf plugin?

   The proposed `builder?: ...` field handles one primary surface. It could become `builders?: readonly ...[]` if needed.

    -> one is enough

3. Should builder extensions be leaf-only?

   Current need is leaf CRDT patches. A future non-leaf builder extension API would need a broader `toDraftPatch(...)` hook rather than `{plugin, change}`.

    -> leaf only for now

4. How much should React CRDT types infer from app definitions?

   Runtime can derive extensions from `leafPlugins`, but TypeScript cannot infer those from a `Provider initial={...}` value. App/runtime wrapper types may need an explicit extension tuple generic.

    -> a given Provider will have been created with a known extension tuple

5. Should module augmentation be added now or later?

   It improves ergonomics, but explicit extension tuples are more reliable for the first implementation.

    -> not yet

6. How should extension-key collisions be handled?

   Recommended: throw when constructing the dispatcher if two runtime extensions share a key. Type-level collisions will naturally intersect and may produce confusing method types, so runtime validation should fail loudly.

    -> yes

7. Is trailing `'preview'` acceptable as a reserved builder-method argument convention?

   The current API already uses `when?: ApplyTiming`. A generic wrapper can strip the final argument only when it is exactly `'preview'`, but plugin command authors should avoid meaningful trailing arguments with that literal value.

    -> how about instead we require that plugin builder-methods be single-argument only, and then the second argument can be the `when?: ApplyTiming`

8. Should low-level `$leaf(plugin, change)` exist as an escape hatch?

   It would give users a builder path without custom extension registration, but it does not solve ergonomic typed third-party command surfaces.

    -> no
