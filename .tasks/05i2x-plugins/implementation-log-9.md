# Implementation Log 9: Code Plugin And Preview Renderers

## 2026-06-29 10:55 CDT

### Initial read

- Read `plan-9.md` and inspected the current code ownership paths.
- Confirmed `codePlugin` only declares the inline `code` mark, inline renderer ownership, and `mark:code` toolbar item.
- Confirmed `legacyRichTextBlocksPlugin` still declares the `code` block type.
- Confirmed `legacyRichTextUiPlugin` still declares code, Mermaid, and Vega-Lite block menu and slash entries.
- Confirmed `mediaBlocks.tsx` still owns hard-coded Mermaid and Vega-Lite renderer implementations and labels.

### Slice 1: Code Plugin Ownership Declarations

- Moved code block metadata, toolbar/slash items, block renderer ownership, and option panel ownership into `codePlugin`.
- Removed `code` from `legacyRichTextBlocksPlugin`.
- Removed code, Mermaid, and Vega-Lite toolbar/slash ownership from `legacyRichTextUiPlugin`.
- Updated the legacy preset to compose `codePlugin`, `codeMermaidPlugin`, and `codeVegaPlugin`.

### Slice 2: Preview Renderer Plugin Modules

- Added `codeMermaidPlugin` with `requires: ['code']`, Mermaid language ownership, canonical `previewKind: 'mermaid'`, labels, and the existing lazy Mermaid dynamic import path.
- Added `codeVegaPlugin` with `requires: ['code']`, `vega-lite` and `vegalite` language ownership, canonical `previewKind: 'vega-lite'`, labels, and the existing lazy Vega/Vega-Lite/YAML dynamic import path.
- Extended `BlockEditorCodePreviewRenderer` with `previewKind`, `emptyLabel`, `loadingLabel`, and `errorLabel`.

### Slice 3: Registry-Backed Preview UI

- Added `codePreviewRegistry.ts` helpers for language lookup, canonical preview metadata writes, and previewable metadata checks from the registry.
- Updated the code option panel so the Preview checkbox appears only when the registry has a preview renderer for the current language.
- Updated preview metadata writes to use the registered renderer's canonical preview kind.

### Slice 4: Rendering And Command Gating

- Refactored `PreviewableCodeBlock` to receive a registered preview renderer contribution instead of selecting from a local hard-coded Mermaid/Vega table.
- Gated preview rendering on a registry renderer whose `previewKind` matches stored block metadata.
- Gated code option changes on the registered code option panel.
- Gated code block classes and syntax highlighting on code block renderer ownership.

### Verification

- `npm exec vitest -- run src/block-editor/plugins/code.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/legacyRichTextPlugins.test.ts` passed.
- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts src/block-editor/markdownShortcuts.test.ts` passed.
- `npm exec vitest -- run src/block-editor/plugins/code.test.ts src/block-editor/plugins/registry.test.ts src/block-editor/plugins/legacyRichTextBlocks.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/clipboard.test.ts src/block-editor/markdownShortcuts.test.ts examples/block-rich-text/src/App.test.tsx` passed all non-App tests and failed only the four known Mermaid preview app tests:
  - `opens populated mermaid fixture blocks in preview mode`
  - `shows editor and preview together in split mode`
  - `keeps the previous mermaid render visible while remote updates render`
  - `keeps the previous mermaid render visible with an error overlay when remote updates fail`

### Issues / Notes

- `blockEditorMetaWithTs` is not a plugin declaration check; it falls back to copying timestamps when no block type spec exists. I adjusted the legacy block test to assert `registry.blockTypes.has('code') === false` and timestamp a remaining legacy-owned `table` block instead.
- Compatibility remains code-level for preview metadata in this slice: a code block with `preview: 'mermaid'` is still compatible when `codePlugin` is present. Actual preview UI/rendering is sub-plugin gated by the registry.
- The broader App test failure shape matches the known prior Mermaid preview failures from Phase 6/7/8: the tests wait for mocked `[data-testid="mermaid-render"]` SVG output and receive zero rendered nodes.
