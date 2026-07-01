# Plan 7: Phase 7 Simple Block Plugins

## Context

Phases 1-6 are complete. The current plugin system can declare block metadata support, inline features, UI specs, markdown shortcuts, command ids, renderers, option panels, clipboard hooks, styles, and CRDT hooks. Inline feature availability is now registry-derived, but many block features still run through legacy central switches in `BlockRichTextEditor`, `blockTypeHelpers`, `markdownShortcuts`, `legacyRichTextBlocks`, and `legacyRichTextUi`.

The original Phase 7 entry says to extract low-structural-risk block plugins:

- `headings`
- `lists`
- `todos`
- `quote`
- `callouts`
- `ingredients`
- `images`
- `link-preview`

This phase is larger than the original list implies because each block feature currently owns a mix of metadata validation, block type menu entries, slash commands, markdown shortcuts, rendering classes, editor-local commands, option panels, clipboard behavior, and sometimes side effects.

## Goal

Move simple block features out of the transitional legacy aggregate into focused plugins while preserving current rich editor behavior when `legacyRichTextPlugins` is used.

The result should be:

- Each simple block type is declared by its owning plugin, not by `legacyRichTextBlocksPlugin`.
- Block type toolbar/slash/markdown declarations live with the feature plugin that owns the resulting metadata.
- Existing central rendering and command implementations are gated by registry declarations as an intermediate step.
- Image upload and link preview behavior remain editor services, but their metadata support, commands, block renderer ownership, and option panels are plugin-owned.
- `legacyRichTextPlugins` remains the full-feature compatibility preset by composing the new block plugins.

## Non-Goals

- Do not extract code blocks, tables, columns, slides, or polls in this phase.
- Do not build a fully generic block renderer replacement for every block. Registry ownership can gate the current central renderer first.
- Do not move editor-owned layout services such as sidebar width, global block indentation, drag handles, selection surfaces, or attachment storage into plugin APIs.
- Do not redesign block metadata unions in this phase. Continue using `RichBlockMeta` while moving ownership boundaries.
- Do not require plugins to perform network fetches directly unless the render context is intentionally extended for that purpose.

## Current Ownership To Untangle

Metadata:

- `legacyRichTextBlocksPlugin` declares every non-core block type.
- `isLegacyRichBlockMeta` validates all rich block metadata variants in one switch.
- `sameTypeWithTs` and `blockEditorMetaWithTs` preserve block-specific fields during timestamp updates.

UI declarations:

- `legacyRichTextUiPlugin` owns all remaining block type menu items and slash specs.
- `legacyMarkdownShortcutSpecs` owns heading, list, and todo shortcuts together.
- `Toolbar` receives registry-filtered block type items, but the visual block type select still maps through `BlockTypeMenuValue`.

Commands:

- `blockTypeMeta` maps `BlockTypeMenuValue` to `RichBlockMeta`.
- `runBlockTypeCommandEverywhere` and toolbar/slash dispatch still run legacy block-type command paths.
- Todo checkbox toggling, callout option changes, image size changes, preview URL changes, and preview metadata updates are implemented inside editor-local rendering callbacks.
- Image file insertion depends on editor-owned attachment services.

Rendering:

- `BlockRichTextEditor` centrally computes group classes and block body rendering for headings, lists, todos, blockquotes, callouts, ingredients, images, previews, and code.
- `deriveOrderedListNumbers` is a shared helper for ordered list numbering.
- Ingredient highlighting uses `highlightIngredientLine` before rendering text runs.
- `ImagePreview` and `PreviewBlockCard` live in `mediaBlocks.tsx`.

Clipboard and persistence:

- `clipboard.ts` serializes and parses block-specific HTML/data attributes for ingredients, image blocks, and preview blocks.
- Example import/export/history validators duplicate rich block metadata validation.
- Attachment serialization remains editor/example-owned and should not move into the plugin object yet.

## Proposed Plugin Boundaries

### `headingsPlugin`

Owns:

- Block type `heading`
- Toolbar block menu entries `heading1`, `heading2`, `heading3`
- Slash commands for Heading 1/2/3
- Markdown shortcut `#`, `##`, `###`
- Block type creation and reverse menu value mapping for heading levels
- Renderer ownership declaration for heading blocks

Expected behavior:

- Existing heading classes and heading levels remain unchanged.
- Heading markdown shortcuts only run when the plugin is registered.

### `listsPlugin`

Owns:

- Block type `list_item`
- Toolbar block menu entries `unordered`, `ordered`
- Slash commands for unordered and ordered lists
- Markdown shortcuts `- `, `* `, and `1. `
- Ordered list numbering ownership declaration
- Block type creation and reverse menu value mapping for list kinds

Expected behavior:

- Ordered list numbers reset exactly as they do now.
- List indentation and nesting behavior remains in core block command code until heavier structural extraction.

### `todosPlugin`

Owns:

- Block type `todo`
- Toolbar block menu entry `todo`
- Slash command for todo
- Markdown shortcuts `[ ] `, `[x] `, `[X] `
- Todo toggle command id, likely `todo:toggle`
- Renderer/option ownership for checkbox affordance
- Block type creation that preserves the existing checked state when converting todo-to-todo

Expected behavior:

- Todo checkbox clicks produce the same CRDT metadata updates.
- Todo markdown shortcuts only run when both the shortcut and target block type are registered.

Dependency decision:

- Prefer `todosPlugin.requires = ['lists']` only if the implementation keeps the current behavior that todo markdown shortcuts can convert unordered list items. If that behavior is made conditional instead, `todosPlugin` can remain independent.

### `quotePlugin`

Owns:

- Block type `blockquote`
- Toolbar block menu entry `blockquote`
- Slash command for blockquote
- Renderer ownership for quote grouping/classes
- Block type creation and reverse menu value mapping

Expected behavior:

- Blockquote subtree rendering remains visually identical.
- Quote grouping remains a central renderer concern until generic grouped block renderers exist.

### `calloutsPlugin`

Owns:

- Block type `callout`
- Toolbar block menu entries `callout-info`, `callout-warning`, `callout-error`
- Slash commands for info/warning/error callouts
- Option panel for callout kind changes
- Commands for callout kind changes, likely `callout:set-kind`
- Renderer ownership for callout grouping/classes
- Block type creation and reverse menu value mapping

Expected behavior:

- Callout kind changes still replicate as block metadata updates.
- Existing callout classes remain stable.

### `ingredientsPlugin`

Owns:

- Block type `recipe_ingredient`
- Toolbar block menu entry `recipe-ingredient`
- Slash command for ingredient line
- Ingredient highlighting renderer ownership
- Clipboard HTML serialization/parsing ownership for ingredient block metadata, if clipboard hooks are ready enough
- Block type creation and reverse menu value mapping

Expected behavior:

- Ingredient token highlighting is unchanged.
- Inline marks inside ingredient text still render within highlighted token spans.

### `imagesPlugin`

Owns:

- Block type `image`
- Toolbar item `image:upload`
- Command id `image:upload`
- Image block insertion command bridge
- Image renderer ownership
- Image size option panel and command, likely `image:set-size`
- Image metadata validation and timestamp preservation
- Clipboard export/import hooks for image block metadata where feasible

Editor-owned services:

- Attachment store, object URL lifecycle, file picking input, drag/drop paste detection, and serialized attachment merging stay editor-owned.
- Plugin command handlers should receive editor services through a narrow context only if generic command context is expanded. Until then, keep the editor-local command implementation but gate it on `imagesPlugin` declarations.

Expected behavior:

- Toolbar upload, paste/drop image insertion, image captions, missing-image fallback, and image size options are unchanged.
- Documents containing image metadata fail compatibility checks without `imagesPlugin`.

### `linkPreviewPlugin`

Owns:

- Block type `preview`
- Toolbar block menu entry `preview`
- Slash command for preview
- Preview block insertion/conversion command
- Preview URL and metadata commands, likely `preview:set-url` and `preview:set-metadata`
- Preview block renderer ownership
- Preview option panel or menu ownership for URL editing
- Preview metadata validation and timestamp preservation
- Clipboard export/import hooks for preview block metadata where feasible

Editor-owned services:

- Network metadata fetching can stay inside `PreviewBlockCard` for this phase, provided rendering is gated by plugin availability.
- CORS proxy config remains editor/environment-owned.

Expected behavior:

- Empty preview block URL editor, invalid URL validation, fetched metadata storage, and replicated preview cards are unchanged.
- Documents containing preview metadata fail compatibility checks without `linkPreviewPlugin`.

## Required Foundation Work

### 1. Block Metadata Specs Per Feature

Add a new plugin module for each simple block feature under `src/block-editor/plugins/`.

Each plugin should declare:

- `blockTypes` with `id`, `label`, `validate`, `isMeta`, and `withTs`
- any owned `toolbarItems`
- any owned `slashCommands`
- any owned `markdownShortcuts`
- renderer/option panel ownership declarations when applicable

Keep validation focused and local:

- `heading`: `level` is `1 | 2 | 3`
- `list_item`: `kind` is `ordered | unordered`
- `todo`: `checked` is boolean
- `blockquote`: no extra fields
- `callout`: `kind` is `info | warning | error`
- `recipe_ingredient`: no extra fields
- `image`: `attachmentId` is string and `size` is a valid image size
- `preview`: `url` is string and `preview` is null or valid preview metadata

Add shared tiny validators only when they remove meaningful duplication, such as image size and preview metadata validators.

### 2. Legacy Aggregate Composition

Update `legacyRichTextPlugins` to include the new plugins.

Then shrink `legacyRichTextBlocksPlugin` so it only declares block types not extracted in this phase:

- `code`
- `table`
- `columns`
- `slide_deck`
- `slide`
- `poll`

Keep the transitional `table-cells` selection declaration there until the table phase.

Update tests so:

- the legacy aggregate still supports all current rich block metadata
- the legacy block metadata plugin only declares the remaining unextracted types
- each new plugin has focused compatibility tests

### 3. Registry-Backed Block Type Menu Mapping

The current `BlockTypeMenuValue` path is still acceptable, but the mapping from menu value to metadata must become registry-aware.

Add helpers along these lines:

- `blockTypeMetaFromRegistry(registry, kind, current, ts)`
- `blockTypeMenuValueFromRegistry(registry, meta)`
- `blockTypeMenuValuesFromRegistry(registry)` if needed by toolbar tests

These helpers can initially delegate to per-plugin metadata factories keyed by command id or menu value. Avoid keeping one growing switch in `legacyRichTextUiPlugin`.

Behavioral requirement:

- If a block type command is unavailable, it must not create unsupported metadata.
- If an existing document contains unsupported metadata, compatibility checks should catch it before rendering.
- If a toolbar select encounters metadata whose plugin is unavailable, it should display a safe fallback such as paragraph rather than exposing a command that cannot run.

### 4. Markdown Shortcut Ownership

Move markdown shortcut specs out of `legacyMarkdownShortcutSpecs` and into:

- `headingsPlugin`
- `listsPlugin`
- `todosPlugin`

Update the legacy shortcut export to compose from the registered plugins or keep a deprecated aggregate that imports those specs.

Behavioral requirement:

- `markdownShortcutPrefixFromSpecs` remains the central matcher for now.
- Main editor command paths must pass `registry.markdownShortcuts`, not the legacy aggregate.
- Markdown shortcut tests should cover an empty registry and partial registries.

### 5. Central Renderer Gating

Before moving rendering implementations, make central rendering check plugin-owned block renderer declarations or block type declarations.

For this phase, it is acceptable for `BlockRichTextEditor` to keep the JSX implementation if:

- rendering feature availability is derived from the registry
- plugin-specific classes and controls only appear when the feature is registered
- unsupported metadata is rejected by compatibility checks before normal rendering

Add a small helper similar to inline render features:

- `blockRenderFeaturesFromRegistry(registry)`

Candidate feature keys:

- `heading`
- `list_item`
- `todo`
- `blockquote`
- `callout`
- `recipe_ingredient`
- `image`
- `preview`

### 6. Option Panel Ownership

Current block options are centralized. Split ownership in two steps:

1. Declare option panel ownership from plugins.
2. Gate existing hard-coded options by registry declarations.

Option panel extraction targets:

- `calloutsPlugin`: callout kind select/buttons
- `imagesPlugin`: image size select/buttons
- `linkPreviewPlugin`: preview URL edit menu

Do not move generic block options, drag affordances, or layout controls into these plugins.

### 7. Command Availability And Services

Add command declarations for feature-specific actions even if the implementation remains editor-local in this phase.

Likely command ids:

- `block-type:heading1`
- `block-type:heading2`
- `block-type:heading3`
- `block-type:unordered`
- `block-type:ordered`
- `block-type:todo`
- `block-type:blockquote`
- `block-type:callout-info`
- `block-type:callout-warning`
- `block-type:callout-error`
- `block-type:recipe-ingredient`
- `block-type:preview`
- `todo:toggle`
- `callout:set-kind`
- `image:upload`
- `image:set-size`
- `preview:set-url`
- `preview:set-metadata`

Gating requirement:

- Existing editor-local handlers must no-op when their command id is not registered.
- Paste/drop image insertion must be gated on `image:upload` or image block support.
- Preview metadata side effects must be gated on preview block support.

Possible API gap:

- `BlockEditorCommandContext` currently has no attachment service, URL preview service, focused block id, or local UI callback support. If moving image/preview command implementation fully into plugin handlers requires those services, defer full command extraction and document the API gap in the implementation log.

### 8. Clipboard And Static Serialization

Keep behavior unchanged first, then move ownership where the current hooks fit.

Minimum for this phase:

- Clipboard export should not emit plugin-specific block metadata for unsupported features during copy from a filtered editor.
- Rich paste should not import unsupported image/preview/ingredient metadata when the corresponding plugin is unavailable.
- Existing full-feature copy/paste round trips remain unchanged under `legacyRichTextPlugins`.

If `BlockEditorClipboardHooks` is too document-wide for clean block-specific serialization, add a small registry-derived filter helper first and defer plugin hook execution until a later cleanup.

## Implementation Slices

### Slice 1: Declarations And Aggregate Split

Add plugin files and focused tests for:

- `headingsPlugin`
- `listsPlugin`
- `todosPlugin`
- `quotePlugin`
- `calloutsPlugin`
- `ingredientsPlugin`
- `imagesPlugin`
- `linkPreviewPlugin`

Update:

- `plugins/index.ts`
- `legacyRichTextPlugins.ts`
- `legacyRichTextBlocks.ts`
- `legacyRichTextBlocks.test.ts`
- `legacyRichTextPlugins.test.ts`

Verification:

- New plugin tests pass.
- Existing compatibility and metadata tests pass.
- `legacyRichTextPlugins` still accepts all current fixtures.

### Slice 2: UI Spec Ownership

Move block toolbar and slash specs from `legacyRichTextUiPlugin` into owning plugins.

Update tests so:

- full slash and toolbar parity is asserted through `legacyRichTextPlugins`
- `legacyRichTextUiPlugin` only owns remaining transitional controls
- each simple block plugin owns its expected toolbar/slash entries

Expected remaining `legacyRichTextUiPlugin` ownership after this slice:

- history controls, unless already moved elsewhere
- annotation controls until Phase 8
- code/table/columns/slides/polls block menu entries until their phases

### Slice 3: Markdown Shortcut Ownership

Move shortcut specs into `headingsPlugin`, `listsPlugin`, and `todosPlugin`.

Update editor shortcut plumbing to use `registry.markdownShortcuts`.

Tests:

- heading shortcuts work only with `headingsPlugin`
- list shortcuts work only with `listsPlugin`
- todo shortcuts work only with `todosPlugin`
- full-feature preset preserves existing behavior
- empty plugin set does not create heading/list/todo metadata

### Slice 4: Registry-Aware Block Type Commands

Replace direct use of the monolithic `blockTypeMeta` switch in editor command dispatch with registry-aware metadata factories.

Keep the old helper as compatibility glue only if needed by tests or examples.

Tests:

- toolbar block type conversion no-ops for unavailable block type commands
- slash block type conversion no-ops for unavailable block type commands
- partial plugin sets can create only their registered block types
- existing block type conversions still work under `legacyRichTextPlugins`

### Slice 5: Renderer And Option Gating

Add registry-derived block render features or consume `registry.blockRenderers` declarations.

Gate:

- heading classes
- ordered list number marker
- todo checkbox
- blockquote grouping
- callout grouping/classes/options
- ingredient highlighting spans
- image figure/preview/options
- preview card/options/fetch side effects

Tests:

- unsupported feature render controls do not appear under partial registries
- full-feature rendering remains unchanged for the target block types
- lists still number correctly
- todo checkbox toggles still replicate
- blockquote/callout subtree rendering remains unchanged
- ingredient highlighting remains unchanged

### Slice 6: Image Plugin Behavior

Move image metadata, toolbar declaration, command availability, renderer ownership, and size option ownership into `imagesPlugin`.

Keep attachment store and file input editor-owned, but ensure every entry point is plugin-aware:

- toolbar upload
- paste image files
- drop image files, if supported by current code path
- rich paste image block import
- image caption editing
- image size change

Tests:

- image upload/caption behavior remains unchanged under `legacyRichTextPlugins`
- image paste/drop does not create image blocks without `imagesPlugin`
- image size changes produce CRDT metadata updates
- image metadata compatibility fails without `imagesPlugin`
- serialized attachments remain preserved by example import/export where relevant

### Slice 7: Link Preview Plugin Behavior

Move preview metadata, toolbar/slash declaration, command availability, renderer ownership, and URL option ownership into `linkPreviewPlugin`.

Keep fetch implementation in `PreviewBlockCard` unless a narrow preview service context is introduced.

Tests:

- converting to preview from toolbar and slash still works
- invalid URL handling remains unchanged
- fetched preview metadata is written to block meta and replicated
- editing an existing preview URL still works
- preview card rendering/fetching is absent or inert without `linkPreviewPlugin`
- preview metadata compatibility fails without `linkPreviewPlugin`

### Slice 8: Clipboard And Paste Filtering

Apply registry-aware block metadata filtering to copy/paste paths for the extracted block features.

Tests:

- full-feature clipboard tests still pass
- copying/pasting with partial plugins strips unsupported block metadata
- ingredient HTML serialization remains unchanged with `ingredientsPlugin`
- image and preview payloads round-trip with their plugins
- image and preview payloads degrade safely without their plugins

### Slice 9: Cleanup And Documentation

Remove duplicated declarations and stale legacy references.

Update:

- `implementation-log.md`
- public exports
- any task docs that list built-in plugin presets

Document any deferred API gaps:

- generic block renderer execution
- generic option panel rendering
- plugin command contexts for editor-local services
- clipboard hook shape limitations

## Test Matrix

Focused unit tests:

- `src/block-editor/plugins/*BlockPlugins*.test.ts` or one test per plugin
- `src/block-editor/plugins/legacyRichTextBlocks.test.ts`
- `src/block-editor/legacyRichTextPlugins.test.ts`
- `src/block-editor/markdownShortcuts.test.ts`
- `src/block-editor/plugins/legacyRichTextUi.test.ts`
- `src/block-editor/blockTypeHelpers.test.ts` if new registry helpers are added

Editor behavior tests:

- block type conversion from toolbar
- block type conversion from slash menu
- markdown shortcuts with full and partial registries
- todo checkbox CRDT updates
- callout kind option updates
- ingredient highlighting
- image upload, image caption, image size
- preview URL editing, fetch, metadata replication

Clipboard/import tests:

- `src/block-editor/clipboard.test.ts`
- example clipboard tests if the example owns additional document-format behavior
- example history/import validation where image and preview metadata are duplicated

Commands to run after each major slice:

```sh
npm run typecheck
npm exec vitest -- run src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/clipboard.test.ts
```

Commands to run before completing the phase:

```sh
npm run typecheck
npm run typecheck:examples
npm exec vitest -- run src/block-editor examples/block-rich-text/src
```

Known test caveat from Phase 6:

- Broad `npm test` currently has existing Mermaid preview failures in `examples/block-rich-text/src/App.test.tsx`. Do not treat those as caused by Phase 7 unless the failure shape changes.

## Risks

- The block renderer API exists, but the editor does not yet execute arbitrary block renderers as the primary rendering path. This phase should declare ownership and gate central rendering first.
- The command API is too narrow for image upload and preview metadata side effects. Avoid over-expanding it until the necessary editor services are clear.
- `BlockTypeMenuValue` is a legacy enum-like surface that combines plugin-owned values and future structural block values. Registry-aware mapping should avoid making this switch more central.
- Clipboard filtering can become broad quickly because block metadata, attachments, inline marks, and HTML fallbacks intersect. Keep the first filter narrow and test the degradation path.
- Preview fetching runs as a render side effect today. Gating must prevent unsupported preview blocks from starting fetches in partial-plugin editors.

## Completion Criteria

- The eight simple block plugins are exported and included in `legacyRichTextPlugins`.
- `legacyRichTextBlocksPlugin` no longer declares heading, list, todo, quote, callout, ingredient, image, or preview block types.
- Toolbar block menu entries, slash commands, and markdown shortcuts for simple blocks are owned by their feature plugins.
- Partial plugin registries cannot create, render controls for, paste, or side-effect unsupported simple block metadata.
- Full-feature editor behavior remains unchanged for headings, lists, todos, quotes, callouts, ingredients, images, and link previews.
- Compatibility checks fail clearly when a document contains one of these block metadata types without its owning plugin.
- The implementation log records any intentionally deferred API gaps.
