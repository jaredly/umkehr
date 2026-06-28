# Implementation Log: Block Editor Plugin System

## 2026-06-28

### Phase 1: Core Plugin API And Registry

- Started Phase 1 with a standalone plugin API and registry implementation.
- Added `src/block-editor/plugins/types.ts` for public plugin contribution types.
- Added `src/block-editor/plugins/registry.ts` with:
  - deterministic dependency sorting
  - duplicate plugin id checks
  - missing dependency and cycle checks
  - contribution conflict checks
  - destination renderer grouping
  - code preview renderer language indexing
  - CRDT hook composition for virtual parents, mark virtual parents, mark behavior, and metadata merge hooks
- Added `src/block-editor/plugins/index.ts` and exported it from `src/block-editor/index.ts`.
- Added focused registry tests in `src/block-editor/plugins/registry.test.ts`.

Issues/workarounds:

- Git commits cannot be made in the current sandbox without escalation because `.git/index.lock` cannot be created.
- Phase 1 intentionally does not wire the registry into `BlockRichTextEditor` yet. This keeps the first slice limited to API/validation behavior.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/registry.test.ts` passed.
- `npm run typecheck` passed.

### Phase 2: Plugin-Aware Editor Props

- Added `plugins?: readonly BlockEditorPlugin<Meta>[]` to the public `BlockRichTextEditorProps` type.
- Added `plugins?: readonly BlockEditorPlugin<RichBlockMeta>[]` to the currently exported `BlockRichTextEditor` component props.
- Added `coreBlockEditorPlugins` and `defaultBlockEditorPlugins` as empty plugin arrays matching the decision that paragraph is core and built-ins should not be enabled by default.
- The editor now constructs a registry with `createBlockEditorRegistry(plugins)` during render, so explicit plugin lists are validated immediately.
- Added `src/block-editor/plugins/compatibility.ts` with:
  - `blockEditorDocumentCompatibilityIssues`
  - `assertBlockEditorDocumentPluginsAvailable`
  - `BlockEditorPluginLoadError`
- Added tests for paragraph-only compatibility, missing block/mark/embed/selection plugins, declared plugin support, and load-error throwing.

Issues/workarounds:

- The registry is not yet used for rendering, commands, or document load enforcement inside `BlockRichTextEditor`. Enforcing missing-plugin load errors there now would break current examples until the full built-in preset exists and examples pass it explicitly.
- The current exported `BlockRichTextEditor` prop shape does not match the generic `BlockRichTextEditorProps` type in `types.ts`; Phase 2 updates both, but a later cleanup should reconcile this API shape.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts` passed.
- `npm run typecheck` passed.

### Phase 3: Metadata Model

- Added `src/block-editor/plugins/metadata.ts` with additive metadata helpers:
  - `CoreBlockMeta`
  - `CORE_PARAGRAPH_BLOCK_TYPE`
  - `coreParagraphMeta`
  - `blockEditorMetaType`
  - `blockEditorMetaIsCore`
  - `validateBlockEditorMeta`
  - `blockEditorMetaWithTs`
- Added `withTs` to `BlockEditorBlockTypeSpec` so plugins can preserve metadata-specific fields while updating timestamps.
- Added metadata tests for core paragraph metadata, plugin validators, plugin timestamp hooks, and shallow timestamp fallback.

Issues/workarounds:

- Existing call sites still use `RichBlockMeta`, `paragraphMeta`, `sameTypeWithTs`, `blockTypeMeta`, and `blockTypeMenuValue`. This phase only adds the registry-backed replacement path; migrating all call sites should happen after block plugins are introduced.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts` passed.
- `npm run typecheck` passed.
