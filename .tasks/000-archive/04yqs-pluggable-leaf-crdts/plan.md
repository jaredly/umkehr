# Plan: Pluggable Leaf CRDTs

## Decisions From Research

- Plugin version compatibility is exact numeric equality.
- Schema fingerprints include plugins required by the schema, not every plugin registered by the app.
- Leaf update envelopes carry `plugin`, but not `version`; the document/schema context determines the active version and the plugin validates its own operation payloads.
- Plugin state and plugin metadata must be JSON-compatible.
- The plugin API should support both raw operations and high-level typed patch-builder commands.
- Leaf undo/redo is optional. Plugins that support it provide hooks; plugins that do not support it should produce blocked/unsupported undo results.
- Non-CRDT `History` continues to reject leaf patches.
- Plugins receive an explicit `sessionId` from the broader CRDT system. Leaf-local counters remain local to each leaf.
- App-level `migrateCrdtUpdate` remains responsible for plugin-version migrations. Plugin packages may provide helper functions, but migration helpers are not part of the core plugin spec.
- Do not leave block-crdt integration as a final afterthought. Use it as an early design target so the plugin system is known to support the richer leaf.

## Phase 1: Core Leaf Plugin Contract

Add a plugin contract in `src/crdt`, likely in a new `src/crdt/plugins.ts`.

Define:

- `LeafCrdtPlugin`
- `LeafCrdtPluginAny`
- `LeafPluginDescriptor = {id: string; version: number}`
- `LeafPluginRegistry`
- helper functions to normalize plugin descriptors, build registries, and compare exact versions

The plugin contract should include:

- `id: string`
- `version: number`
- schema marker fields, or helper to create marker tags
- `empty` / `init` for initial value and leaf metadata
- `isValue` for fallback value detection where useful
- `createOperations` for high-level patch changes
- `applyOperation` for raw operation application
- `validateOperation`
- optional undo/redo hooks
- optional effect checking hook
- a session context argument that includes `sessionId`

Acceptance checks:

- The contract can express the existing peritext rich text leaf.
- The contract can express the block-crdt leaf at the type/API level before full integration.
- Plugin metadata and values are constrained to JSON-compatible values.

## Phase 2: Generic Leaf Metadata And Updates

Replace the hardcoded rich text CRDT envelope with a generic leaf envelope.

Change `src/crdt/types.ts`:

- Remove `RichTextMeta`.
- Add `LeafMeta`:

```ts
type LeafMeta = {
    kind: 'leaf';
    plugin: string;
    created: HlcTimestamp;
    data: JsonValue;
};
```

- Remove `CrdtRichTextUpdate`.
- Add `CrdtLeafUpdate`:

```ts
type CrdtLeafUpdate = {
    op: 'leaf';
    plugin: string;
    path: CrdtPathSegment[];
    change: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};
```

Do not include `version` on each update.

Update:

- `src/crdt/metadata.ts`
- `src/crdt/materialize.ts`
- `src/crdt/apply.ts`
- `src/crdt/updates.ts`
- `src/crdt/path.ts`
- `src/crdt/history.ts`
- `src/crdt/validation.ts`
- tests that assert `kind: 'richText'` or `op: 'richText'`

Acceptance checks:

- Core CRDT no longer has rich text-specific update/meta unions.
- A missing plugin causes a clear runtime error during document/schema setup or validation.
- Existing non-leaf CRDT behavior is unchanged.

## Phase 3: Schema Detection And Plugin Registry

Extend `CrdtSchemaContext` to include required and registered plugins.

Add schema traversal helpers:

- detect `x-umkehr-leaf-crdt`
- detect `x-umkehr-leaf-crdt-version`
- collect required plugin descriptors from `root` plus `components`
- sort descriptors by `id`, then `version`
- reject duplicate plugin ids with conflicting versions
- reject missing registered plugins
- reject registered plugin version mismatches for required plugins

Thread plugin options through:

- `createCrdtDocument`
- `CreateCrdtDocumentOptions`
- `createCrdtUpdateValidator`
- `CrdtUpdateValidatorOptions`
- any helper that creates schema contexts in examples/tests

Acceptance checks:

- A schema requiring `umkehr.rich-text@1` fails if no rich text plugin is supplied.
- A schema requiring `umkehr.rich-text@1` fails if `umkehr.rich-text@2` is supplied.
- A schema requiring no plugins still works without plugin options.

## Phase 4: Built-In Rich Text Plugin Migration

Move the current peritext integration behind a built-in plugin exported by `src/richtext/index.ts`.

Implement `richTextLeafPlugin` with:

- `id: 'umkehr.rich-text'`
- `version: 1`
- current peritext `RichTextState` as value state
- current `RichTextOperation` as raw operation
- current `RichTextPatchChange` as high-level patch change
- metadata data `{maxOpCounter: number}`
- current insert/delete/mark/unmark/replace translation from `src/crdt/updates.ts`
- current apply logic from `src/crdt/apply.ts`
- current validation from `src/crdt/validation.ts`
- current undo/redo/effect-check logic from `src/crdt/history.ts`

Update `RichCollaborativeText` schema tags:

- replace `x-umkehr-crdt: rich-text`
- add `x-umkehr-leaf-crdt: umkehr.rich-text`
- add `x-umkehr-leaf-crdt-version: 1`

Update callers so rich text schemas register the plugin when creating documents, validators, and app definitions.

Acceptance checks:

- `src/crdt/richtext.test.ts` passes after changing expectations from `op: 'richText'` to `op: 'leaf'`.
- Rich text undo/redo still produces fresh peritext op ids.
- Rich text validation still rejects malformed peritext operations.
- `materializeRichText` still works through the public helper.

## Phase 5: Typed Patch Builder Plugin Surface

Replace hardcoded `$text` special casing with a plugin-driven builder surface while preserving the existing rich text ergonomics.

Update:

- `src/types.ts`
- `src/helper.ts`
- `src/make.ts`
- `src/ops.ts`
- `src/history/history.ts`

The builder should support:

- high-level plugin commands, e.g. existing `$.body.$text.insert(...)`
- raw leaf operations, e.g. a typed command for applying a plugin operation directly
- plugin-specific type checking based on the branded leaf value type

The raw operation path is important for block-crdt and for advanced users bringing their own leaf CRDTs. The high-level command path is important for editor ergonomics.

Keep non-CRDT `History` rejection behavior:

- `ops.apply` rejects leaf patches
- `ops.invert` rejects leaf patches
- `history/history.ts` rejects leaf patches with an explicit error

Acceptance checks:

- Type tests or compile-time tests show `$text` is available only on `RichCollaborativeText`.
- Type tests show rich text command payloads are checked.
- Type tests show raw operation payloads are checked for a concrete plugin.
- Non-CRDT history still rejects leaf patches.

## Phase 6: Plugin-Aware Fingerprints

Update schema fingerprinting in `src/migration/index.ts`.

Change:

```ts
schemaFingerprintInput(schema, tagKey)
```

to include required leaf plugin descriptors collected from the schema:

```ts
{
    root,
    components,
    tagKey,
    leafPlugins: [{id, version}]
}
```

Use required-by-schema descriptors only. Sort descriptors deterministically before `stableStringify`.

Update all wrappers/callers:

- `examples/react-crdt/src/lib/local-first/schemaFingerprint.ts`
- app registry and migration config code
- solo/local-first/peer/server sync paths
- seed/fixture generation
- tests that hardcode fingerprints

Update `VersionedSchema` and migration config helpers so previous/current schemas carry fingerprints generated with the same plugin-aware logic.

Acceptance checks:

- Same JSON schema with different required plugin versions produces different fingerprint hashes.
- Missing required plugin fails before opening/syncing a document.
- Documents with matching schema and required plugin descriptors continue to sync.
- Migration tests still pass after fixture fingerprint updates.

## Phase 7: Session Context Plumbing

Thread an explicit `sessionId` into local CRDT command generation and plugin operation creation.

Likely places:

- `applyLocalCommand`
- `createLocalCrdtCommand`
- `createCrdtUpdates`
- plugin `createOperations` calls
- example editor runtime/provider setup

The existing HLC node can remain the default session id if no explicit value is supplied, but plugin calls should receive `sessionId` directly. Block-crdt should not have to infer actor identity from packed HLC strings.

Acceptance checks:

- Rich text still produces stable actor ids.
- A test plugin can observe the supplied `sessionId`.
- Block-crdt design spike can allocate Lamport ids using `{counter: leaf-local, actor: sessionId}`.

## Phase 8: Block-CRDT Design Spike

Before finishing the plugin system, add a narrow block-crdt plugin spike. This is not necessarily the full product integration, but it must prove the contract is powerful enough.

Create a built-in or test-only block plugin that uses:

- `src/block-crdt` `State` / `CachedState`
- `Op`
- `applyMany` or `applyRemoteMany`
- `validateOp`
- leaf-local Lamport counter allocation
- explicit `sessionId` as actor id

Prove at least:

- initial empty block document can be represented as a leaf value
- raw block op leaf update can be created, validated, applied, and synced
- plugin metadata can track leaf-local allocation state
- changed path reporting marks the containing leaf path
- undo unsupported or supported behavior is explicit and does not crash generic history

If this spike reveals missing hooks, fix the generic plugin API before continuing.

Acceptance checks:

- A focused test applies a block-crdt leaf update through core `src/crdt`.
- A focused test applies two concurrent block-crdt leaf updates from different sessions.
- A focused test verifies missing/mismatched block plugin versions fail schema/plugin validation.

## Phase 9: Full Block-CRDT Plugin Integration

After the spike validates the API, build the actual block-crdt plugin.

Work items:

- define the block leaf branded value type and schema marker
- export `blockRichTextLeafPlugin`
- provide raw operation update helpers
- provide high-level typed patch-builder commands for common editor operations
- map block-crdt validation errors into CRDT update validation issues
- integrate block-crdt undo if practical, otherwise mark plugin undo unsupported with clear blocked results
- add render/materialize helpers as public exports if needed by examples

Update the block-rich-text example or add a new core-CRDT-backed example to use the plugin path instead of direct standalone `src/block-crdt` state management.

Acceptance checks:

- The example can edit block rich text through core `src/crdt`.
- Core CRDT persistence/sync carries block-crdt leaf updates.
- Block plugin fingerprint/version mismatch is detected.
- Type checking catches invalid block plugin command payloads.

## Phase 10: Cleanup, Tests, And Docs

Remove leftover hardcoded rich text branches and stale names.

Search targets:

- `richText`
- `RichTextMeta`
- `CrdtRichTextUpdate`
- `x-umkehr-crdt`
- `kind: 'richText'`
- `op: 'richText'`

Add/update tests:

- plugin registry tests
- schema marker collection tests
- fingerprint tests
- CRDT validation tests
- rich text migration tests
- CRDT history undo/redo tests
- block-crdt plugin tests
- package smoke tests
- example typecheck tests

Run:

```sh
npm test
npm run typecheck
npm run typecheck:examples
```

Acceptance checks:

- No remaining hardcoded rich text behavior in core CRDT except through the built-in plugin.
- Public rich text helpers still work.
- Block-crdt has a proven plugin path.
- Schema fingerprints include required plugin id/version data.
- Missing/incompatible plugin versions fail deterministically.

