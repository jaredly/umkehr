# Plan 9: Phase 9 Code Plugin And Preview Renderers

## Context

Phases 1-8 have already built most of the plugin foundation needed for code extraction. The registry can declare marks, block types, toolbar and slash items, markdown shortcuts, renderer ownership, option panels, command ids, and code preview renderers.

Phase 9 is therefore not a large framework design phase. The main work is moving the remaining code ownership out of transitional legacy switches and connecting the existing preview UI to registry-owned Mermaid and Vega-Lite preview renderer contributions.

The current `codePlugin` only owns the inline `code` mark, its inline renderer ownership declaration, and the `mark:code` toolbar item. Code block metadata, code block menu entries, code options, syntax highlighting, preview mode, and Mermaid/Vega rendering are still partly owned by legacy aggregates or hard-coded editor modules.

## Goal

Move code block and code preview ownership behind code plugins while preserving existing rich editor behavior under `legacyRichTextPlugins`.

The result should be:

- `codePlugin` owns code block metadata support, inline code mark support, code toolbar/slash/markdown declarations, code renderer ownership, and the code option panel declaration.
- `codeMermaidPlugin` and `codeVegaPlugin` own preview renderer registrations and require `code`.
- Preview availability is derived from registered code preview renderers, not from a hard-coded language switch alone.
- Mermaid and Vega-Lite rendering still use lazy dynamic imports.
- Existing stored document metadata remains compatible: `{type: 'code', language, preview?: 'mermaid' | 'vega-lite'}`.
- Editors without `codePlugin` reject or degrade code block and inline code features according to the existing compatibility and clipboard rules.
- Editors with `codePlugin` but without a preview sub-plugin can still edit plain code blocks, but cannot enable or render that sub-plugin's preview mode.

## Non-Goals

- Do not redesign `RichBlockMeta` or make external plugins extend the metadata union in this phase.
- Do not change persisted code preview metadata values away from `mermaid` and `vega-lite`.
- Do not build a fully generic block renderer execution path if the current central renderer can be registry-gated.
- Do not move editor-owned text editing services, retained selection plumbing, focus restoration, or code popover positioning into plugin APIs.
- Do not remove public helpers such as `codePreviewKindForLanguage` until all callers have a registry-backed replacement.
- Do not extract link preview, images, polls, tables, columns, or slides in this phase.

## Current Ownership To Untangle

Plugin declarations:

- `codePlugin` currently declares the inline code mark and `mark:code` toolbar item only.
- `legacyRichTextBlocksPlugin` still declares the `code` block type.
- `legacyRichTextUiPlugin` still owns code, Mermaid, and Vega-Lite block type toolbar/slash entries.

Code metadata and commands:

- `blockTypeHelpers.ts` maps `code`, `mermaid`, and `vega-lite` menu values to code block metadata.
- `blockMeta.ts` contains hard-coded preview language mapping through `codePreviewKindForLanguage`, `CODE_PREVIEW_LANGUAGES`, `isPreviewableCodeMeta`, and `codeMetaWithPreviewForLanguage`.
- `BlockRichTextEditor.tsx` owns code language changes, preview toggle changes, syntax token calculation, and option panel rendering.
- `blockCommands.ts` owns inline code mark commands and code block editing behavior.

Rendering:

- `syntaxHighlight.ts` owns language normalization for highlighting and code token generation.
- `BlockRichTextEditor.tsx` applies code block classes, trailing newline behavior, and syntax ranges inside editable surfaces.
- `mediaBlocks.tsx` owns `PreviewableCodeBlock`, preview mode state, cached preview HTML, Mermaid initialization, Vega-Lite rendering, labels, and error display.

Examples and persistence:

- Example import/export validates code block metadata and preview values directly.
- Example history validation allows `mermaid` and `vega-lite` preview values when they match the language.
- Existing app tests cover plain code editing, inline code marks, preview mode, split mode, cached renders, and error overlays.

## Proposed Plugin Boundaries

### `codePlugin`

Owns:

- block type declaration: `code`
- inline mark declaration: `code`
- inline renderer ownership for the `code` mark
- block renderer ownership for code blocks
- option panel ownership for code blocks
- toolbar block type item: `block-type:code`
- slash command: `block-type:code`
- inline toolbar item: `mark:code`
- code markdown shortcut for fenced/backtick conversion, where currently registry-supported
- code language normalization for stored mark and block language values, either directly or through exported helpers
- syntax highlighting support for code blocks and language-marked inline code
- command declarations for code language and preview toggles if command ids are introduced in this phase

Expected behavior:

- Plain code blocks still edit exactly as before.
- Inline code mark toggling and language-specific inline code rendering remain unchanged.
- Code block syntax highlighting is present only when code rendering support is registered.
- The code option panel is visible only when `codePlugin` is registered.

### `codeMermaidPlugin`

Owns:

- preview renderer id, likely `code/mermaid:preview`
- preview languages: `mermaid`
- preview metadata kind: `mermaid`
- preview labels:
  - empty: `Empty diagram`
  - loading: `Rendering diagram...`
  - error fallback: `Unable to render Mermaid diagram.`
- Mermaid dynamic import and one-time initialization

Requires:

- `code`

Expected behavior:

- Mermaid preview mode renders the same SVG output path as today.
- Mermaid render failures keep the same error display and cached-HTML behavior.
- Registering `codeMermaidPlugin` without `codePlugin` fails registry construction.

### `codeVegaPlugin`

Owns:

- preview renderer id, likely `code/vega:preview`
- preview languages: `vega-lite`, `vegalite`
- preview metadata kind: `vega-lite`
- preview labels:
  - empty: `Empty chart`
  - loading: `Rendering chart...`
  - error fallback: `Unable to render Vega-Lite chart.`
- Vega-Lite, Vega, and YAML dynamic imports
- JSON-or-YAML parsing for chart specs

Requires:

- `code`

Expected behavior:

- Vega-Lite preview mode renders the same SVG output path as today.
- YAML input remains supported.
- Registering `codeVegaPlugin` without `codePlugin` fails registry construction.

## Required Foundation Work

### 1. Fill Out Code Plugin Declarations

Move code block declarations out of transitional legacy aggregates:

- Add `code` block type spec to `codePlugin`.
- Add code toolbar and slash block type items to `codePlugin`.
- Add block renderer and option panel ownership declarations for code blocks.
- Keep `legacyRichTextPlugins` full-featured by composing `codePlugin`.

If the block type menu still uses `BlockTypeMenuValue`, keep the existing registry-aware helper path and add code-specific mappings there.

### 2. Add Preview Sub-Plugins

Create focused plugin modules for:

- `codeMermaidPlugin`
- `codeVegaPlugin`

Both should set `requires: ['code']` and contribute `codePreviewRenderers`.

The registry already indexes preview renderers by id and normalized language. This phase should use that existing extension point rather than adding a second mechanism.

### 3. Make Preview Availability Registry-Derived

Replace UI decisions that ask only `codePreviewKindForLanguage(language)` with registry-aware checks:

- The code options panel should show `Preview` only when a registered preview renderer supports the current language.
- Toggling preview should write the canonical stored preview kind for the registered renderer.
- Code block rendering should enter `PreviewableCodeBlock` only when the block metadata preview is supported by a registered renderer.

Keep helper functions available for compatibility, but prefer new registry-backed helpers such as:

- `codePreviewRendererForLanguage(registry, language)`
- `codePreviewKindForRenderer(renderer)` or an explicit `previewKind` field on the renderer type, if needed
- `isPreviewableCodeMetaFromRegistry(registry, meta)`
- `codeMetaWithPreviewForRegistry(registry, meta, enabled)`

### 4. Connect `PreviewableCodeBlock` To Registry Renderers

Refactor `PreviewableCodeBlock` so it receives a renderer contribution instead of looking up a local hard-coded `codePreviewRenderers` record.

The component should preserve:

- edit/preview/split mode behavior
- initial preview mode for non-empty previewable blocks
- cached preview HTML while a new render is pending
- cached preview HTML with error overlay after render failure
- empty/loading/error labels
- sanitized render ids
- `contentEditable={false}` preview containers

This probably requires extending `BlockEditorCodePreviewRenderer` with label fields and a canonical preview kind:

- `previewKind: CodePreviewKind`
- `emptyLabel`
- `loadingLabel`
- `errorLabel`

If adding those fields would churn too many tests, keep a small adapter in the code plugin module, but do not leave Mermaid/Vega renderer selection hard-coded in `mediaBlocks.tsx`.

### 5. Gate Code Editing And Rendering Defensively

Ensure unavailable code support no-ops or degrades consistently:

- Inline code mark commands should require the `code` mark or `mark:code` command availability.
- Code block option changes should require code block option support.
- Code block classes and syntax highlighting should be tied to code block renderer ownership.
- Preview mode should not render for unregistered preview plugins, even if persisted metadata contains a preview value.

Follow the Phase 7/8 pattern: central rendering can remain the implementation, but it must respect plugin ownership declarations.

### 6. Preserve Document Compatibility

Compatibility checks should distinguish:

- no `codePlugin`: code block metadata and inline code marks are unsupported
- `codePlugin` only: plain code block and inline code marks are supported, preview sub-plugin metadata may be unsupported
- `codePlugin` plus `codeMermaidPlugin`: Mermaid preview metadata is supported
- `codePlugin` plus `codeVegaPlugin`: Vega-Lite preview metadata is supported

If compatibility currently treats all code preview values as valid whenever `code` is valid, tighten that behavior only if the existing compatibility model can report preview sub-feature issues clearly. Otherwise, document the temporary behavior and gate actual rendering/UI by registry.

### 7. Update Legacy Preset

`legacyRichTextPlugins` should include:

- `codePlugin`
- `codeMermaidPlugin`
- `codeVegaPlugin`

This preserves existing app behavior for users who opt into the full legacy preset.

## Implementation Slices

### Slice 1: Code Plugin Ownership Declarations

- Move `code` block type declaration out of `legacyRichTextBlocksPlugin`.
- Move code block toolbar and slash items out of `legacyRichTextUiPlugin`.
- Add code block renderer and option panel ownership declarations to `codePlugin`.
- Update focused plugin tests and legacy aggregate tests.

Verification:

- Registry construction under `legacyRichTextPlugins` still includes the code block type and code menu entries.
- A registry without `codePlugin` does not advertise code block or inline code support.

### Slice 2: Preview Renderer Plugin Modules

- Add `codeMermaidPlugin` and `codeVegaPlugin`.
- Move Mermaid and Vega render functions out of the local hard-coded renderer map.
- Keep dynamic imports lazy.
- Add dependency tests for `requires: ['code']`.
- Add duplicate language coverage if the existing registry tests do not already cover the final plugin modules.

Verification:

- `codeMermaidPlugin` without `codePlugin` fails registry construction.
- `codeVegaPlugin` without `codePlugin` fails registry construction.
- Registered preview languages resolve from `registry.codePreviewRenderersByLanguage`.

### Slice 3: Registry-Backed Preview UI

- Update code option panel preview toggle visibility to use the registry.
- Update preview metadata writes to use the registered renderer's canonical preview kind.
- Update previewable code block detection to require a registered renderer.
- Pass the renderer contribution into `PreviewableCodeBlock`.

Verification:

- Plain code blocks still show language controls.
- Preview checkbox appears for Mermaid only when `codeMermaidPlugin` is registered.
- Preview checkbox appears for Vega-Lite aliases only when `codeVegaPlugin` is registered.
- Preview checkbox is hidden for unsupported languages and unregistered preview plugins.

### Slice 4: Rendering And Command Gating

- Gate code block syntax/rendering classes through registered code block renderer ownership.
- Gate inline code hover/language actions through code command or mark availability.
- Ensure preview metadata in unsupported registries does not call optional preview imports.

Verification:

- Editors without `codePlugin` do not expose code creation/toggle surfaces.
- Documents with unsupported preview metadata can still display/edit source text without running preview renderers, if compatibility allows the document to open.

### Slice 5: Example And Regression Coverage

- Update example import/export/history validation only if registry-backed compatibility requires it.
- Keep existing Mermaid/Vega app behavior tests passing.
- Add focused tests for code-only versus code-plus-preview plugin registries.

Verification:

- Plain code blocks still edit and highlight.
- Inline code mark still toggles and renders.
- Mermaid preview mode renders or reports errors.
- Vega-Lite preview mode renders or reports errors.
- Cached preview HTML remains visible while remote updates render.
- Cached preview HTML remains visible with an error overlay after render failure.

## Test Matrix

Plugin registry:

- `codePlugin` declares code block, inline code mark, toolbar/slash items, block renderer, inline renderer, and option panel ownership.
- `codeMermaidPlugin` contributes a Mermaid preview renderer and requires `code`.
- `codeVegaPlugin` contributes Vega-Lite preview renderer languages and requires `code`.
- Duplicate preview language ownership still fails with a clear registry error.

Compatibility:

- Inline code mark records are compatible only when `codePlugin` is registered.
- Code block metadata is compatible only when `codePlugin` is registered.
- Preview metadata compatibility is either sub-plugin-aware or explicitly documented as temporarily code-level compatible while rendering remains gated.

Editor behavior:

- Code block creation, conversion, splitting, joining, and syntax highlighting remain unchanged with the legacy preset.
- Inline code toggling, language assignment, hover, and clearing remain unchanged with the legacy preset.
- Code option panel is hidden when code option ownership is absent.
- Preview toggle is hidden when no preview renderer supports the language.
- Mermaid and Vega-Lite preview renderers are not imported until preview rendering is needed.

Examples:

- Existing code fixtures import/export unchanged.
- Mermaid diagram fixture opens in preview mode with the legacy preset.
- Empty Mermaid block opens in edit mode.
- Split preview mode still renders.
- Preview errors still show the current error UI.

## Risks

- `codePreviewKindForLanguage` is used by persistence and history code; replacing it too aggressively could churn public helper behavior. Prefer adding registry-backed helpers first.
- Preview renderer contributions may need label and canonical-kind fields. Add them deliberately rather than creating plugin-specific hard-coded maps elsewhere.
- Compatibility for preview sub-plugins may be harder than UI gating because the stored metadata uses code-level values. If needed, keep compatibility broad for this phase and document the temporary behavior.
- Mermaid/Vega tests have had known instability in broader app tests. Keep focused renderer tests small and preserve existing lazy import mocks.

## Completion Criteria

- `legacyRichTextPlugins` preserves all existing code and preview behavior.
- Code block and inline code ownership no longer depends on `legacyRichTextBlocksPlugin` or `legacyRichTextUiPlugin`.
- Mermaid and Vega-Lite preview renderers are registered by `code/mermaid` and `code/vega` plugins requiring `code`.
- Preview UI and rendering availability are derived from the registry.
- Optional preview modules remain dynamically imported.
- Focused plugin, registry, compatibility, and example regression tests pass.
