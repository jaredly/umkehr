# Implementation Log: Phase 7 Simple Block Plugins

## 2026-06-29

### Simple Block Plugin Declarations

- Added focused simple block plugins:
  - `headingsPlugin`
  - `listsPlugin`
  - `todosPlugin`
  - `quotePlugin`
  - `calloutsPlugin`
  - `ingredientsPlugin`
  - `imagesPlugin`
  - `linkPreviewPlugin`
- Each plugin now owns its block metadata declaration, relevant toolbar/slash entries, renderer ownership declarations, and option/command declarations where applicable.
- Moved heading/list/todo markdown shortcut specs into their owning plugins and kept `legacyMarkdownShortcutSpecs` as a compatibility aggregate.
- Added small shared validators/declaration helpers for simple rich block metadata, image sizes, and preview metadata.

### Legacy Aggregate Split

- Updated `legacyRichTextPlugins` to compose the new simple block plugins.
- Shrunk `legacyRichTextBlocksPlugin` to the remaining transitional block types:
  - `code`
  - `table`
  - `columns`
  - `slide_deck`
  - `slide`
  - `poll`
- Kept the transitional `table-cells` selection declaration in `legacyRichTextBlocksPlugin`.
- Updated legacy plugin tests and added focused simple block plugin tests.

### Registry-Aware Commands And UI

- Added registry-backed block type helpers:
  - `blockTypeMetaFromRegistry`
  - `blockTypeMenuValueFromRegistry`
  - `blockTypeMenuValuesFromRegistry`
- Updated toolbar/slash block type command paths in `BlockRichTextEditor` to use registry-aware metadata creation.
- Moved simple block toolbar and slash declarations out of `legacyRichTextUiPlugin`.
- Preserved block type menu ordering through shared block type command ordering.

### Renderer, Option, Image, Preview, And Clipboard Gating

- Added registry-derived block render features from `registry.blockRenderers`.
- Gated central rendering/classes/controls for:
  - headings
  - ordered list markers
  - todo checkbox affordance
  - blockquote/callout grouping
  - ingredient highlighting/affordance
  - image figures/options
  - preview cards/fetch side effects
- Gated callout and image option panels by `registry.optionPanels`.
- Gated image file insertion on registered `image:upload` availability.
- Added block metadata filtering for rich clipboard payloads:
  - unsupported block metadata degrades to paragraph metadata
  - unsupported image metadata drops orphaned attachment exports/imports

### Deferred API Gaps

- Generic block renderer execution is still deferred; plugins declare renderer ownership while the central renderer remains the implementation.
- Generic option panel rendering is still deferred; plugins declare ownership while existing hard-coded panels are registry-gated.
- Image upload, preview metadata fetch/update, callout kind changes, todo toggles, and image size changes still use editor-local handlers because command context does not yet expose editor services such as attachments, focused block UI state, or preview fetch services.
- Clipboard hooks remain document-wide; this phase uses a registry-derived block metadata filter rather than executing plugin-specific clipboard hooks.
- Added explicit Phase 14 cleanup items in `plan.md` to replace the image/preview command bridges and registry-derived clipboard filters with plugin-owned handlers/hooks once the required APIs exist.

### Compatibility Follow-Up

- Added the missing `annotation` mark declaration to `legacyAnnotationsCrdtPlugin`.
- This preserves annotated fixture/document loading under `legacyRichTextPlugins` now that `BlockRichTextEditor` enforces registry compatibility at render time.

### Verification

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/plugins/simpleBlockPlugins.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/markdownShortcuts.test.ts src/block-editor/clipboard.test.ts` passed.
- `npm exec vitest -- run src/block-editor` passed.
- `npm run typecheck:examples` passed.
- Follow-up verification: `npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/plugins/compatibility.test.ts` passed.
- Follow-up verification: `npm exec vitest -- run src/block-editor examples/block-rich-text/src/documentFixtures.test.ts examples/block-rich-text/src/documentFormat.test.ts` passed.
