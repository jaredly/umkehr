# Research: Pluggable Leaf CRDTs

## Goal

Make the core `src/crdt` document CRDT able to host user-provided leaf-node CRDTs instead of hardcoding rich text as the only special leaf. The existing rich text leaf should be migrated onto that plugin system. Plugin identity and plugin versions need to participate in schema fingerprints so a document created with one plugin set cannot be opened by an app missing those plugins or using incompatible plugin versions.

No backwards compatibility is required, so the current `richText` update/meta names can be replaced rather than supported forever.

## Current State

The core CRDT is in `src/crdt`. It already has generic support for primitives, objects, records, arrays, and tagged unions, plus one hardcoded leaf CRDT:

- `src/crdt/types.ts` defines `RichTextMeta`, `CrdtRichTextUpdate`, and adds both to the central `CrdtMeta` and `CrdtUpdate` unions.
- `src/crdt/schema.ts` detects rich text with `x-umkehr-crdt: rich-text`.
- `src/crdt/metadata.ts` turns rich text schema markers or rich text-looking values into `{kind: 'richText', created, maxOpCounter}` metadata.
- `src/crdt/materialize.ts` preserves the previous rich text state or initializes `emptyRichTextState()`.
- `src/crdt/updates.ts` translates `Patch` objects with `op: 'richText'` into peritext operations.
- `src/crdt/apply.ts` applies `op: 'richText'` by calling `applyRichTextOperation`.
- `src/crdt/validation.ts` special-cases rich text update envelopes and delegates operation validation to `validateRichTextOperation`.
- `src/crdt/history.ts` has rich text-specific capture, undo, redo, supersession checks, and fresh op-id allocation.
- `src/types.ts` and `src/helper.ts` hardcode the public patch-builder surface as `$text` methods on `RichCollaborativeText`.
- `src/ops.ts` and `src/history/history.ts` explicitly reject rich text patches outside CRDT history.
- `src/richtext/index.ts` defines the branded `RichCollaborativeText` type and typia schema plugin tags.

The newer block rich text CRDT in `src/block-crdt` is separate. It exposes its own `State`, `CachedState`, `Op`, `applyMany`, validation helpers, materializers, and undo planner. The `examples/block-rich-text` app uses it directly through `umkehr/block-crdt`; it is not integrated into `src/crdt` today.

Schema fingerprints currently live in `src/migration/index.ts`:

```ts
schemaFingerprintInput(schema, tagKey) => {root, components, tagKey}
schemaFingerprint(schema, tagKey) => stableStringify(...)
schemaFingerprintHash(schema, tagKey) => sha256Hex(...)
```

The React examples wrap these helpers in `examples/react-crdt/src/lib/local-first/schemaFingerprint.ts`, and then use the resulting full fingerprint/hash in solo, local-first, peer, and server persistence/sync checks.

## Main Constraint

This should not be just a runtime callback registry. Leaf updates must remain type-checked. Today type safety comes from hardcoded unions:

- `RichTextPatchChange`
- `RichTextPatch`
- `CrdtRichTextUpdate`
- `PatchBuilderInternal<...>` conditionally exposing `$text` when `Current extends RichCollaborativeText`

A plugin system needs a type-level registry as well as a runtime registry, otherwise user plugins can apply updates but callers lose typed patch/change/update construction.

## Recommended Shape

Introduce a generic leaf plugin concept in `src/crdt`, roughly:

```ts
type LeafCrdtPlugin<
    TId extends string,
    TVersion extends number | string,
    TValue extends JsonValue,
    TPatchChange,
    TOperation extends JsonValue,
    TMeta extends JsonValue,
> = {
    id: TId;
    version: TVersion;
    schemaMarker: {'x-umkehr-leaf-crdt': TId; 'x-umkehr-leaf-crdt-version': TVersion};

    empty(): TValue;
    isValue(value: unknown): value is TValue;
    init(input: {value: TValue | undefined; ts: HlcTimestamp}): {meta: TMeta; value: TValue};

    createOperations(input: {
        value: TValue;
        meta: TMeta;
        change: TPatchChange;
        ts: HlcTimestamp;
    }): TOperation[];

    applyOperation(input: {
        value: TValue;
        meta: TMeta;
        operation: TOperation;
        ts: HlcTimestamp;
    }): {value: TValue; meta: TMeta};

    validateOperation(input: unknown): {success: true; data: TOperation} | {success: false; errors: unknown[]};

    captureEffect(...): unknown;
    createUndoOperations(...): TOperation[];
    createRedoOperations(...): TOperation[];
    checkEffect(...): BlockedEffect | null;
};
```

The exact names can change, but the capability boundaries are important:

- initialization from schema/value
- patch change to operation translation
- operation validation
- remote operation application
- materialization/defaulting
- local undo/redo capture and regeneration
- conflict/blocking checks for undo/redo

The core update envelope can become generic:

```ts
type CrdtLeafUpdate<TPluginId extends string = string, TOperation = unknown> = {
    op: 'leaf';
    plugin: TPluginId;
    version: string | number;
    path: CrdtPathSegment[];
    change: TOperation;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};
```

Then `richText` becomes a built-in plugin with `id: 'umkehr.rich-text'`, `version: 1`, and its current `RichTextOperation` as `TOperation`. The old `op: 'richText'` branch can be removed.

For metadata, replace `RichTextMeta` with a generic leaf meta:

```ts
type LeafMeta = {
    kind: 'leaf';
    plugin: string;
    version: string | number;
    created: HlcTimestamp;
    data: JsonValue;
};
```

The current rich text `maxOpCounter` would move into `data`, for example `{maxOpCounter: number}`. Block CRDT can store whatever durable leaf metadata it needs in the same place, as long as it is JSON.

## Runtime Registry

`CrdtSchemaContext` should carry a plugin registry:

```ts
type CrdtSchemaContext = {
    root: Schema;
    components: Components;
    tagKey: string;
    leafPlugins: Record<string, LeafCrdtPluginAny>;
};
```

Functions that create or validate CRDT documents need plugin options:

- `createCrdtDocument(initial, schema, {timestamp, tagKey, plugins})`
- `createCrdtUpdateValidator(schema, {tagKey, plugins})`
- `createCrdtLocalHistory` can keep using the plugins stored on `doc.schema`
- `applyCrdtUpdate`, `createCrdtUpdates`, and history helpers can resolve plugins through `doc.schema.leafPlugins`

Document/schema setup should scan the JSON schema for leaf markers and fail if a required plugin id/version is not registered. This gives a clearer error than waiting for the first update.

## Type Surface

There are two viable approaches.

Preferred: make the patch builder generic over a plugin map and let leaf value brands expose plugin-specific methods.

```ts
type LeafCrdtValue<TPlugin> =
    JsonValue &
    tags.JsonSchemaPlugin<{
        'x-umkehr-leaf-crdt': TPlugin['id'];
        'x-umkehr-leaf-crdt-version': TPlugin['version'];
    }>;

type PatchBuilderInternal<Root, Current, Tag, R, Extra, Plugins> =
    Current extends LeafCrdtValue<infer Plugin>
        ? LeafBuilderMethods<Plugin, R>
        : ...existing navigation...
```

The rich text package would provide the existing ergonomic `$text` methods as its plugin builder methods, preserving type checking for:

```ts
$.body.$text.insert({index: 0}, 'hi')
```

Fallback: expose a generic but typed leaf method, for example:

```ts
$.body.$leaf(richTextPlugin).insert(...)
```

This is less ergonomic, but it avoids global declaration merging and makes the plugin dependency explicit at the call site.

Avoid an untyped `$leaf(pluginId: string, change: unknown)` as the primary API. It would satisfy runtime pluggability but not the task's type-checking requirement.

## Fingerprints

The fingerprint input should include the required plugin identities and versions. Recommended normalized form:

```ts
{
    root,
    components,
    tagKey,
    leafPlugins: [
        {id: 'umkehr.rich-text', version: 1},
        {id: 'umkehr.block-rich-text', version: 1}
    ]
}
```

Sort by `id` and `version` before stable stringification. The existing schema marker should remain in typia output, but relying only on the schema marker is not enough: an app can have the same schema but forget to register the runtime plugin. Including the runtime registered/required plugin list in the fingerprint makes "missing plugin" become a schema fingerprint mismatch, as requested.

Implementation impact:

- Update `schemaFingerprintInput`, `schemaFingerprint`, and `schemaFingerprintHash` to accept plugin descriptors.
- Update wrappers in `examples/react-crdt/src/lib/local-first/schemaFingerprint.ts`.
- Add `plugins` to `AppDefinition` in `examples/react-crdt/src/lib/crdtApp.ts`.
- Thread plugin descriptors through solo/local-first/peer/server fingerprint calls.
- Update migration `VersionedSchema` to include plugin descriptors, or at minimum make its `fingerprint`/`fingerprintHash` generated with the same plugin-aware helper.

Open migration point: if a plugin version changes incompatibly, that is effectively a schema migration even when the JSON state schema did not change. Migration configs should be able to register old and new plugin descriptors.

## Rich Text Migration

The existing peritext rich text can be the first plugin:

- Move current peritext imports and rich text-specific code from `src/crdt/updates.ts`, `apply.ts`, `validation.ts`, and `history.ts` behind a `richTextLeafPlugin`.
- Change `RichCollaborativeText` tags from `x-umkehr-crdt: rich-text` to the generic leaf marker plus id/version.
- Replace `RichTextMeta` with `LeafMeta` whose `plugin` is `umkehr.rich-text` and whose `data.maxOpCounter` stores the old counter.
- Replace `op: 'richText'` updates with `op: 'leaf', plugin: 'umkehr.rich-text', version: 1`.
- Keep public rich text helpers in `src/richtext/index.ts`; they should export the plugin object and still export `richText()`, `richTextFromPlainText`, and render helpers.
- Update tests in `src/crdt/richtext.test.ts` to assert the new generic update envelope and leaf metadata.

Because backwards compatibility is not required, fixtures/tests can be changed directly.

## Block CRDT Integration Notes

`src/block-crdt` is a plausible second built-in plugin, but it is larger than the current peritext leaf:

- Its operation type is already a CRDT op union: `Op<M>`.
- Its state is a JSON object with chars, blocks, marks, splits, joins, and `maxSeenCount`.
- It already has validation (`validateOp`), application (`applyMany` / `applyRemoteMany`), materialization helpers, and undo planning (`planUndoOps`).
- It has its own Lamport identifiers and block metadata generic, so plugin operation creation needs a stable mapping from core HLC timestamps to block-crdt actor/counter allocation.
- A block editor needs higher-level patch helpers than plain "apply this raw block op"; otherwise app code will construct valid but cumbersome leaf updates.

For scope control, migrate the existing peritext rich text first. Then add a block CRDT plugin once the plugin API has proven the needed hooks and type surface.

## Suggested Implementation Order

1. Add plugin descriptor/types and `LeafMeta` / `CrdtLeafUpdate`.
2. Add schema marker detection and plugin registry to `CrdtSchemaContext`.
3. Thread plugin options through document creation, validation, update creation, apply, and CRDT history.
4. Move current rich text logic into a built-in rich text plugin.
5. Update the patch builder type/runtime to expose rich text through the plugin system.
6. Add plugin-aware schema fingerprint helpers and update example app fingerprint calls.
7. Update tests and fixtures for the new `leaf` update envelope.
8. Consider block-crdt as a second plugin after the rich text migration passes.

## Open Questions

- Should plugin compatibility be exact id/version equality, or should plugins declare a compatibility range? The task says detect incompatible versions; exact equality is simpler and works with schema migrations.
    - exact
- Should plugin descriptors included in fingerprints be "registered plugins" or "plugins required by the schema"? Required-by-schema is better for stability, but the app should still fail if a schema-required plugin is missing at runtime.
    - required-by-schema
- Should plugin updates carry both `plugin` and `version`, or can version be inferred from the schema path? Carrying both makes persisted updates self-describing and easier to validate, but duplicates data.
    - no need for version. a given document can only have one version of a plugin at a time, and the plugin will validate updates itself
- Should plugin state always be a JSON value? The current persistence, schema validation, and migration code assume JSON; allowing non-JSON state would have a much larger blast radius.
    - yes
- Should the generic plugin API expose raw operations only, or also high-level patch-builder commands? Raw operations are enough for sync, but high-level commands are needed for ergonomic, type-checked app code.
    - both
- How much undo/redo behavior is required from third-party plugins? The current rich text integration supports local undo/redo. Plugins either need to implement those hooks or explicitly mark undo unsupported for that leaf.
    - we already have the notion of "operations that cannot be undone due to concurrent edits". some plugins will support undo/redo, and others won't.
- Should non-CRDT `History` continue to reject all leaf patches, or should plugins be able to provide non-CRDT apply/invert behavior too? Current rich text requires CRDT history.
    - reject leaf patches
- How should block-crdt actor/counter allocation map to core HLC timestamps? Peritext derives actor from HLC and counter from leaf meta; block-crdt uses Lamport counters and may need a formal allocator hook.
    - the lamport counter is local to the given leaf, and so doesn't need any global knowledge. the actor should be the sessionId, provided explicitly to the plugin by the broader CRDT system.
- Do plugin versions need semver strings, numeric schema versions, or either? The fingerprint code can handle either, but update validation should enforce one normalized representation.
    - numeric schema versions
- Should a plugin be allowed to migrate its own operation format between versions, or should all plugin-version migrations be handled by app-level `migrateCrdtUpdate` functions?
    - plugin libraries can provide migration helpers, but it's not part of the plugin spec, as all migrations will be handled by the app-level `migrateCrdtUpdate` function.

## Additional note:

I worry that leaving block-crdt to last will result in the plugin system not being powerful enough to accommodate it, and the whole thing will have to be rearchitected.
