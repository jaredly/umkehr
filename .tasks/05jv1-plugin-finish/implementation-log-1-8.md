# Implementation Log 1.8: Annotation Destination Renderer Extraction

## 2026-07-01

- Added typed annotation render services in `src/block-editor/plugins/types.ts`, including annotation data accessors, sidebar/focus state, body command bridging, floating-popover lifecycle hooks, and body editor support.
- Moved `InlineRenderFeatures` to `src/block-editor/blockEditorTypes.ts` so core and plugin-owned annotation renderers share one type.
- Added `src/block-editor/plugins/annotationRenderer.tsx` with plugin-owned sidebar, footnote, floating popover, annotation body editor, and annotation body marker rendering.
- Wired `annotationsPlugin.destinationRenderers` to real sidebar, footer, and floating render functions while preserving renderer ids and destinations.
- Replaced hard-coded annotation destination branches in `BlockRichTextEditor.tsx` with registry destination dispatch for `footer`, `sidebar`, and `floating`.
- Built the core annotation render-service bridge in `BlockRichTextEditor.tsx`, keeping command execution, clipboard parsing, and editable-surface creation as explicit transitional services.
- Removed central annotation destination/body component definitions from `BlockRichTextEditor.tsx`.
- Added plugin coverage asserting annotation destination renderers return concrete UI from a minimal typed destination context.

## Issues, Workarounds, And Bugs

- Importing editor internals directly from `annotationRenderer.tsx` caused a runtime module cycle through `defaultBlockEditorPlugins`. The workaround is an explicit `renderEditableSurface` annotation service implemented by core, so the plugin renderer can own annotation body behavior without importing `BlockRichTextEditor.tsx`.
- Annotation body command execution remains centrally bridged through `runBodyCommand`; command ownership is still intended for the later command extraction phase.
- Annotation body clipboard behavior still uses central clipboard helpers and multi-selection paste commands. Ownership was not moved in this phase.

## Verification

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/annotations.test.ts`
- `npm exec vitest -- src/block-editor/plugins/annotations.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts src/block-editor/editorCrdtConfig.test.ts`
- `npm exec vitest -- src/block-editor/clipboard.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts`
