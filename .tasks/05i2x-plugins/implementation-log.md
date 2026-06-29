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

### Phase 5 Continued: Legacy Block Metadata Declarations

- Added `src/block-editor/plugins/legacyRichTextBlocks.ts`.
- Added `legacyRichTextBlockTypeIds` for every non-core current `RichBlockMeta['type']`.
- Added `legacyRichTextBlockTypeSpecs` with validation and timestamp update hooks.
- Added `legacyRichTextBlocksPlugin`.
- Added `isLegacyRichBlockMeta` for shallow validation of the current rich block metadata union.
- Added `src/block-editor/legacyRichTextPlugins.ts` as a transitional aggregate preset:
  - `legacyRichTextBlocksPlugin`
  - `legacyRichTextUiPlugin`
  - `legacyRichTextCrdtPlugins`
- Exported the aggregate from `src/block-editor/index.ts`.
- Added tests:
  - `src/block-editor/plugins/legacyRichTextBlocks.test.ts`
  - `src/block-editor/legacyRichTextPlugins.test.ts`

Issues/workarounds:

- Paragraph remains core and is intentionally not included in `legacyRichTextBlockTypeIds`.
- The legacy block metadata plugin declares current metadata support as one aggregate plugin. Later extraction should split these declarations into per-feature plugins.
- Validation is intentionally shallow. It catches malformed discriminants and required fields, but does not deeply validate preview metadata payloads.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts` passed.
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

### Phase 5 Continued: Markdown Shortcut Specs

- Refactored `src/block-editor/markdownShortcuts.ts` so the current heading/list/todo shortcuts are represented as `BlockEditorMarkdownShortcutSpec<RichBlockMeta>` entries.
- Preserved the existing `markdownShortcutPrefix(text, currentMeta, nextTs)` API by routing it through `legacyMarkdownShortcutSpecs`.
- Added `markdownShortcutPrefixFromSpecs` for registry-style shortcut matching.
- Added `legacyMarkdownShortcutSpecs` to `legacyRichTextUiPlugin`.
- Added `src/block-editor/markdownShortcuts.test.ts`.

Issues/workarounds:

- `markdownShortcutPrefixFromSpecs` currently narrows matches to the existing legacy shortcut kind union (`list`, `heading`, `todo`) because downstream command code expects that shape. More general plugin shortcut kinds need command-handler extraction first.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts` passed.
- `npm run typecheck` passed.

### Phase 5 Continued: Command Result Contract

- Updated `BlockEditorCommandContext` to include the current retained selection.
- Added `BlockEditorCommandResult`.
- Updated `BlockEditorCommandSpec.handle` so command handlers may return editor mutations:
  - `state`
  - `ops`
  - optional `selection`
- Updated toolbar unknown-command fallback to run registry command handlers through `runBlockControlCommand`, applying returned state/ops/selection through the normal editor command pipeline.
- Updated slash unknown-command fallback to apply returned state/ops/selection after slash trigger deletion.
- Added a registry unit test covering command handlers that return command results.

Issues/workarounds:

- The command result contract is still intentionally minimal. It does not yet include command labels, post-render DOM selection restore hints, or access to richer editor-local services such as attachments/popovers.
- Generic command handlers can now mutate document state, but feature-specific extraction still needs narrower command contexts so plugins do not depend on broad editor internals.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/registry.test.ts` passed.
- `npm run typecheck` passed.

### Phase 5 Continued: Slash Command Dispatcher

- Extracted `runBlockTypeCommandEverywhere` inside `BlockRichTextEditor` to share block-type command behavior for slash execution.
- Updated slash execution to route through `command.commandId`:
  - `inline-embed:date` keeps the existing inline embed behavior.
  - `block-type:*` routes through the shared block-type command helper.
  - unknown command ids fall through to `registry.commands` handlers.
- This reduces the slash path's dependence on the legacy `SlashCommand` union branch structure while preserving slash-trigger deletion and selection restoration behavior.

Issues/workarounds:

- Generic registry command handlers called from slash still cannot return editor mutations. They can be invoked, but the slash path currently keeps the deleted-slash state unchanged for unknown command ids. A richer command result contract is still needed before arbitrary plugin slash commands can mutate document state.
- Toolbar block-type execution still has its own primary-selection path to avoid changing current toolbar behavior while slash keeps multi-selection/everywhere behavior.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts` passed.
- `npm run typecheck` passed.

### Phase 5 Continued: Toolbar Command Dispatcher

- Added `onCommand?(commandId: string)` to `Toolbar`.
- Updated existing toolbar buttons/select events to emit command ids when `onCommand` is provided, while preserving the previous dedicated callback fallback path.
- Added `runToolbarCommand(commandId)` inside `BlockRichTextEditor`.
- Mapped current legacy command ids back to existing behavior:
  - `history:undo`
  - `history:redo`
  - `mark:bold`
  - `mark:italic`
  - `mark:strikethrough`
  - `mark:code`
  - `mark:math`
  - `mark:display-math`
  - `link:edit`
  - `inline-embed:date`
  - `image:upload`
  - `annotation:sidebar`
  - `annotation:footnote`
  - `annotation:popover`
  - `block-type:*`
- Unknown toolbar command ids now fall through to `registry.commands` handlers.
- Added `commandId` to `SlashCommand` values and to the built-in slash command list.

Issues/workarounds:

- The dispatcher lives inside `BlockRichTextEditor` for now because it still depends heavily on editor-local state and current feature command helpers.
- Slash command execution still uses the old `SlashCommand` union and its slash-trigger deletion flow. Command ids are now present on slash commands, but slash execution has not yet been rewritten to dispatch generic registered commands.
- Plugin command handlers currently receive the current state and a command dispatcher, but they cannot yet return CRDT ops or selection changes through the editor command pipeline. That needs a richer command handler contract before third-party commands can mutate editor state safely.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts` passed.
- `npm run typecheck` passed.

### Phase 5 Continued: Toolbar Registry Wiring

- Updated `Toolbar` so the block type `<select>` is rendered from data instead of hard-coded `<option>` elements.
- Added `blockTypeItems` and `toolbarItemIds` props to `Toolbar`.
- Added registry-derived toolbar filtering for the existing known toolbar controls:
  - history buttons
  - inline mark/link/embed/image buttons
  - annotation buttons
  - block type menu options
- Updated `BlockRichTextEditor` to derive:
  - block type menu items from `registry.toolbarItems`
  - a toolbar item id set from `registry.toolbarItems`
- Added helpers in `legacyRichTextUi.ts`:
  - `blockTypeMenuItemsFromToolbarSpecs`
  - `legacyBlockTypeMenuItemsFromToolbarSpecs`
- Extended `legacyRichTextUi.test.ts` to cover toolbar-to-block-menu derivation and filtering of unknown/non-block toolbar specs.

Issues/workarounds:

- The toolbar JSX is still explicit for known controls. Registry specs can now hide/show current controls, but arbitrary third-party toolbar item rendering is not implemented yet.
- Existing callback props (`onBold`, `onLink`, `onBlockType`, etc.) remain the command dispatch mechanism. A real command dispatcher is still needed before toolbar controls can be fully plugin-owned.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts` passed.
- `npm run typecheck` passed.

### Phase 6 Started: Basic Marks Plugin

- Added `basicMarksPlugin` with explicit mark declarations for:
  - `bold`
  - `italic`
  - `strikethrough`
  - `underline`
- Added the basic marks plugin to `legacyRichTextPlugins` so compatibility checks recognize current basic inline mark records through the transitional preset.
- Added underline as a first-class boolean inline mark in the existing editor paths:
  - active mark derivation/toggling
  - toolbar button and command dispatch
  - static run rendering and DOM class application
  - clipboard serialization/deserialization HTML wrapping
  - annotation body mark toggling
- Added underline toolbar/run CSS, including combined underline + strikethrough decoration handling.
- Added tests for the basic marks plugin and legacy preset mark compatibility.

Issues/workarounds:

- `basicMarksPlugin` currently declares mark metadata only. Toolbar items remain in `legacyRichTextUiPlugin` for now because that plugin already owns the existing toolbar command ids; duplicating them in `basicMarksPlugin` creates registry conflicts.
- The first test run caught an initialization-order bug in `basicMarksPlugin`; the label helper was converted to a function declaration before rerunning verification.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts` passed.
- `npm run typecheck` passed.

### Phase 6 Continued: Inline Feature Declaration Plugins

- Added focused declaration plugins for the next inline features:
  - `linksPlugin` declares the `link` mark.
  - `mathPlugin` declares the `math` mark.
  - `inlineDatePlugin` declares the generic `embed` mark and the `date` inline embed type.
- Added these plugins to `legacyRichTextPlugins` so the transitional full-feature preset recognizes link, math, and date embed records during compatibility checks.
- Added `inlinePlugins.test.ts` to verify registry declarations and document compatibility for link/math/date embed marks.
- Extended `legacyRichTextPlugins.test.ts` to cover these inline records through the aggregate preset.

Issues/workarounds:

- `inlineDatePlugin` owns the generic `embed` mark for now because the compatibility scanner validates both mark type and inline embed type. If more inline embed plugins are added, this likely wants a small shared `inline-embeds` base plugin to avoid duplicate `embed` mark declarations.
- Link popovers, math rendering, and date embed rendering still live in the legacy editor implementation. This step only moves their declared compatibility surface into plugins.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts` passed.
- `npm run typecheck` passed.

### Phase 6 Continued: Inline UI Declaration Ownership

- Moved inline toolbar/slash declarations out of `legacyRichTextUiPlugin` and into their owning inline plugins:
  - `basicMarksPlugin` now owns `mark:bold`, `mark:italic`, `mark:strikethrough`, and `mark:underline` toolbar items.
  - `linksPlugin` now owns the `link:edit` toolbar item.
  - `mathPlugin` now owns `mark:math` and `mark:display-math` toolbar items.
  - `inlineDatePlugin` now owns the `inline-embed:date` toolbar item and slash command.
- Kept `legacyRichTextUiPlugin` responsible for the remaining legacy UI declarations:
  - history
  - `mark:code`
  - image upload
  - annotation buttons
  - block type menu/slash entries
- Updated tests so full slash-command parity is asserted through `legacyRichTextPlugins`, while `legacyRichTextUiPlugin` is tested for only the subset it still owns.

Issues/workarounds:

- Toolbar rendering is still explicit JSX in `Toolbar`; this step changes registry ownership/filtering, not arbitrary plugin-rendered toolbar controls.
- The hard-coded toolbar visual order is preserved by the existing JSX order. Registry `order` values are still assigned to the moved inline items so future generic toolbar rendering has the intended order available.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts` passed.
- `npm run typecheck` passed.

### Phase 6 Continued: Inline Code And Active Mark Registry Filtering

- Added `codePlugin` for the inline `code` mark.
- Moved the `mark:code` toolbar item out of `legacyRichTextUiPlugin` and into `codePlugin`.
- Added `codePlugin` to `legacyRichTextPlugins` so inline code mark records are recognized by the transitional preset compatibility scan.
- Added `activeInlineMarkTypesFromRegistry(registry)` and updated `BlockRichTextEditor` to derive active inline marks from registered inline mark ids.
- Kept `deriveActiveInlineMarks` backward-compatible by defaulting to the full current inline mark list when no explicit mark type list is passed.
- Added tests for:
  - `codePlugin` registry and compatibility declarations
  - registry-derived active inline mark types
  - ignoring unregistered mark types during active mark derivation

Issues/workarounds:

- The previous log entry listed `mark:code` as still owned by `legacyRichTextUiPlugin`; that was true for that slice, but this slice moves it into `codePlugin`.
- Keyboard shortcuts and command handlers still know about the legacy mark ids directly. This change filters active mark derivation through the registry, but it does not yet add a command-policy layer that disables hard-coded keyboard commands when a plugin is unavailable.

Verification:

- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.
- `npm run typecheck` passed.

### Phase 6 Continued: Explicit Presets And Toolbar Command Gating

- Updated local rich editor example callers to pass `legacyRichTextPlugins` explicitly:
  - `examples/block-rich-text`
  - `examples/react-crdt` block notes panel
- Tightened `BlockRichTextEditor` toolbar filtering so it always passes registry-derived toolbar item ids and block type menu items to `Toolbar`, including the empty-registry case.
- Added a guard around hard-coded legacy toolbar command execution so known toolbar commands only run when their toolbar item is registered.
- Kept unknown registry command handlers executable even without toolbar items, since commands can be invoked by other plugin-owned surfaces.

Issues/workarounds:

- `Toolbar` itself still keeps its no-`toolbarItemIds` legacy fallback for isolated usage. The stricter behavior is applied by `BlockRichTextEditor`, which now always provides a registry-derived set.
- Keyboard shortcuts and some editor-local command paths still need a plugin-aware command policy. This slice gates toolbar dispatch only.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Main Editor Shortcut Gating

- Added a shared toolbar command availability helper inside `BlockRichTextEditor`.
- Routed `runToolbarCommand` through that helper instead of reading `toolbarItemIds` directly.
- Wrapped the main render-context inline shortcut callbacks so plugin-owned shortcuts no-op unless their command id is registered:
  - basic mark toggles use `mark:*`
  - inline code uses `mark:code`
  - link editing uses `link:edit`
- This makes the main editable block keyboard paths line up with the registry-filtered toolbar behavior.

Issues/workarounds:

- Annotation body keyboard shortcuts still have a separate editing path. They remain to be gated in a follow-up slice because the availability predicate has to be threaded through annotation sidebar/footer/popover rendering.
- The shortcut wrappers intentionally no-op after the key handler prevents default behavior, so unavailable plugin commands do not fall through to browser-native rich-text mutations.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Annotation Body Shortcut Gating

- Threaded the toolbar command availability predicate through annotation body render destinations:
  - sidebar comments
  - footer footnotes
  - floating popovers
- Gated annotation body inline shortcuts through registered command ids:
  - `mark:bold`
  - `mark:italic`
  - `mark:strikethrough`
  - `mark:code`
  - `link:edit`
- Gated annotation body plain-text paste auto-linking on `link:edit` availability.

Issues/workarounds:

- Annotation body command implementations still live in the legacy annotation editor path. This only makes those commands honor plugin availability before they run.
- Pending annotation-body code state is not proactively cleared if plugins change while editing; unavailable code shortcuts no-op after this slice.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Inline Render Feature Gating

- Added registry-derived inline render features for:
  - basic boolean marks
  - inline code
  - links
  - math
  - inline embeds by embed type
- Threaded those render features through main editable blocks and annotation body editors.
- Updated run rendering so unavailable inline plugins no longer add plugin-specific DOM classes, datasets, previews, or inline embed widgets.
- Included the render feature key in run serialization so changing plugin availability causes editable surfaces to rerender.

Issues/workarounds:

- Rendering is still implemented by the legacy central run renderer rather than plugin-owned inline renderer callbacks. This slice gates legacy rendering by registry support; it does not yet consume `registry.inlineRenderers`.
- Unknown/unavailable inline embeds currently fall back to the object replacement character as plain text in the editor surface.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Clipboard Inline Feature Filtering

- Added optional `ClipboardInlineFeatureSet` support to `serializeSelectionToClipboardPayload`.
- Filtered clipboard mark export for basic marks, links, math, and inline embeds based on registered inline features.
- Passed registry-derived inline features into main editor and annotation body copy/cut serialization.
- Added `clipboard.test.ts` coverage for default copy preservation and filtered copy behavior.

Issues/workarounds:

- Inline code marks still are not represented in the existing clipboard payload model; this slice preserves that current behavior rather than adding a new clipboard mark type.
- Paste/import still trusts marks present in incoming rich clipboard payloads. Plugin-aware paste filtering remains a separate follow-up.
- The new test asserts exported feature families rather than one mark entry per type because the clipboard model can split repeated mark ranges across formatted runs.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Rich Paste Inline Feature Filtering

- Added `filterRichClipboardPayloadInlineFeatures` to sanitize already-parsed rich clipboard payloads by registered inline features.
- Routed main editor rich paste and annotation body rich paste through the registry-derived inline feature set.
- Filtered pasted basic marks, links, math marks, and inline embeds before rich paste applies CRDT mark ops.
- Kept rich clipboard parsing permissive so documents copied from fuller editors can still be parsed and degraded at paste time.

Issues/workarounds:

- Annotation marks remain allowed by this inline-focused filter; annotations still need their own plugin extraction/gating phase.
- Inline code still has no rich clipboard mark representation, so there is no code paste mark to filter in this slice.
- The sanitizer recomputes top-level `plainText` and `html` from filtered fragments, but annotation body HTML is not separately represented in the clipboard payload.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Main Editor Link Paste Gating

- Gated main-editor plain-text URL paste auto-linking on `link:edit` availability.
- Gated block/table-cell rich clipboard link paste on `link:edit` availability.
- Kept the fallback behavior as normal plain/rich paste when the links plugin is not registered.

Issues/workarounds:

- This uses the existing toolbar command availability predicate as the command policy source; a standalone command dispatcher policy layer is still future work.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Continued: Registry Command Availability

- Added a registry-derived command availability set in `BlockRichTextEditor`.
- Command availability now includes:
  - explicit registry command handlers
  - toolbar item command ids
  - slash command command ids
- Switched the existing command availability predicate to use registered command ids instead of toolbar item ids only.

Issues/workarounds:

- The legacy editor command switch still owns many command implementations. This slice makes availability less toolbar-coupled, but it does not yet move those implementations into plugin command handlers.
- The exported prop name passed through annotation rendering is still `isToolbarCommandAvailable` for compatibility with the current component plumbing.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.

### Phase 6 Complete: Inline Renderer Ownership

- Added inline renderer ownership declarations to the Phase 6 inline plugins:
  - `basic-marks`
  - `links`
  - `math`
  - `code`
  - `inline-date`
- Switched `BlockRichTextEditor` inline render feature derivation from registered mark ids to registered inline renderer declarations.
- Kept the existing DOM run renderer as the rendering implementation while making plugin renderer registrations the source of render capability.
- Added plugin tests covering inline renderer ownership for basic marks, code, links, math, and date embeds.

Issues/workarounds:

- Phase 6 still uses the legacy editor command switch for many command implementations. Availability is registry-derived now, but moving the implementations themselves into plugin command handlers needs the broader command dispatcher work from Phase 5/next phases.
- Static annotation/body helper rendering has no active call sites in the current code path; editable and annotation body render paths use the registry-derived inline feature gating.
- Broad `npm test` currently fails in four existing example Mermaid preview tests that expect `[data-testid="mermaid-render"]`. This is in optional code-preview rendering, not inline plugin behavior, and belongs with the later code/mermaid plugin extraction.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/metadata.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/basicMarks.test.ts src/block-editor/plugins/inlinePlugins.test.ts src/block-editor/plugins/code.test.ts` passed.
- `npm run typecheck:examples` passed.
- `npm test` built successfully and then failed only in `examples/block-rich-text/src/App.test.tsx` Mermaid preview cases:
  - `opens populated mermaid fixture blocks in preview mode`
  - `shows editor and preview together in split mode`
  - `keeps the previous mermaid render visible while remote updates render`
  - `keeps the previous mermaid render visible with an error overlay when remote updates fail`
