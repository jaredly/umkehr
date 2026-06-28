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

### Phase 4: CRDT Hook Composition

- Updated `src/block-editor/editorCrdtConfig.ts` so the exported rich-text CRDT config is backed by plugin registry declarations.
- Added legacy CRDT plugin declarations:
  - `legacyAnnotationsCrdtPlugin`
  - `legacyPollsCrdtPlugin`
  - `legacyRichTextCrdtPlugins`
  - `legacyRichTextCrdtRegistry`
- Added `blockEditorCrdtConfigFromRegistry`.
- Preserved the existing `richTextCrdtConfig(state)` call shape and added an optional registry parameter for explicit callers.
- Added `src/block-editor/editorCrdtConfig.test.ts` covering:
  - annotation mark behavior
  - annotation mark virtual parents
  - poll metadata merge behavior
  - explicit registry-backed config
  - empty registry override

Issues/workarounds:

- `richTextCrdtConfig` now composes through the registry, but many command/render modules still call `annotationVirtualParents` directly. Those call sites should move behind plugin-provided CRDT/render contexts during annotations/table extraction.
- The legacy annotations CRDT plugin still includes table virtual parent behavior because the old `annotationVirtualParents`/`richTextVirtualParents` config bundled it that way. Table extraction should move that hook to the table plugin.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts` passed.
- `npm run typecheck` passed.

### Phase 5: Menus, Toolbar, And Commands

- Added `src/block-editor/plugins/legacyRichTextUi.ts` with registry contributions mirroring the current UI surfaces:
  - `legacyBlockTypeMenuItems`
  - `legacySlashCommandSpecs`
  - `legacyToolbarItemSpecs`
  - `legacyRichTextUiPlugin`
- Exported the legacy UI plugin from `src/block-editor/plugins/index.ts`.
- Updated `src/block-editor/slashCommands.tsx`:
  - exported `DEFAULT_SLASH_COMMANDS`
  - added `slashCommandsFromSpecs`
  - added `slashCommandsFromRegistry`
  - made `SlashCommandPopover` accept optional `commands`
- Updated `BlockRichTextEditor` to derive slash commands from the configured registry and fall back to the old built-in list when no slash contributions are registered.
- Added `src/block-editor/plugins/legacyRichTextUi.test.ts` covering:
  - legacy slash specs match current built-in slash commands
  - registry-derived slash commands match current built-in slash commands
  - block type menu/slash command parity, accounting for current poll menu entries not being slash commands
  - duplicate-free toolbar specs
  - compatibility with legacy CRDT plugins

Issues/workarounds:

- This is still a transitional Phase 5 slice. Toolbar rendering and command dispatch are not registry-driven yet; only slash command display can consume registry contributions.
- Slash command specs use the existing `commandId` convention (`block-type:*`, `inline-embed:date`) to bridge into the current `SlashCommand` union. Later command extraction should replace this with real registered command handlers.
- The existing toolbar block type menu includes poll entries that the existing slash menu does not include. The parity test documents that mismatch instead of changing behavior.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts` passed.
- `npm run typecheck` passed.
