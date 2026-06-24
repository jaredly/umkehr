# Plan: Previewable Code Blocks

## Decisions From Research

- Mermaid should become a code block with preview metadata, not a separate top-level block type.
- Preview/edit/split mode is local UI state only.
- Previewable code supports three local display modes: edit, preview, and split.
- No backward compatibility is required for exporting legacy `type: 'mermaid'` documents.
- All code blocks should use the two-trailing-blank-lines exit rule.
- The next renderer after Mermaid is Vega-Lite.
- Turtle is out of scope.
- The normal code language selector remains. A preview checkbox appears only when the selected language has a configured preview renderer.
- Preview renderers are trusted to return renderable HTML/SVG.

## Phase 1: Metadata And Type Model

Update the block metadata model so previewable code is represented as `code` metadata.

- In `examples/block-rich-text/src/blockMeta.ts`, add a `CodePreviewKind` type for supported renderers.
  - Start with `'mermaid' | 'vega-lite'`.
  - Do not include Turtle.
- Extend `code` metadata to include optional preview state:
  - `type: 'code'`
  - `language: string`
  - `preview?: CodePreviewKind`
  - `ts: HLC`
- Add helpers in `blockMeta.ts` or a small local module:
  - `normalizePreviewableCodeLanguage(language)`
  - `codePreviewKindForLanguage(language)`
  - `isPreviewableCodeMeta(meta)`
  - `codeMetaWithPreviewForLanguage(meta, enabled)`
- Update `sameTypeWithTs` to preserve `preview` on code metadata.
- Remove `mermaid` from `RichBlockMeta` once all call sites are migrated.

## Phase 2: Commands And Editing Behavior

Make code-like behavior apply to all code blocks instead of branching on Mermaid.

- In `blockCommands.ts`, replace direct `meta.type === 'mermaid'` checks with `meta.type === 'code'`.
- Change `splitBlock` so all code blocks insert newlines until the two-trailing-blank-lines exit condition is met.
- Replace `shouldExitMermaidBlock` / `shouldExitCodeBlock` with a single code-block exit helper using the two-blank-line rule.
- Ensure multiline paste remains inside code blocks.
- Update block command tests:
  - Existing Mermaid newline tests should become previewable-code or Mermaid-language-code tests.
  - Existing code newline tests should expect the new two-blank-line exit behavior.
  - Add coverage that plain code and preview-enabled code share the same exit behavior.

## Phase 3: Document Format, History, Clipboard

Migrate persisted and transferred data to code-with-preview metadata.

- In `documentFormat.ts`:
  - Remove `mermaid` from the exported/accepted current block type set if no import compatibility is desired.
  - Add validation for `code.meta.preview`.
  - Import Mermaid documents through the new `code` shape only if fixtures are updated to use it.
  - Export previewable Mermaid as `{type: 'code', meta: {language: 'mermaid', preview: 'mermaid'}}`.
  - Export Vega-Lite similarly with `{language: 'vega-lite', preview: 'vega-lite'}`.
- In `history.ts`, update metadata validation for `code.preview`.
- In `clipboard.ts`:
  - Update metadata validation for `code.preview`.
  - Keep code blocks serialized as `<pre>`.
  - Remove Mermaid-specific metadata handling.
- Update document format, history, and clipboard tests to assert the new metadata shape.

## Phase 4: UI Model And Block Controls

Replace Mermaid-specific UI with generic previewable-code UI.

- In `App.tsx`, update block type menu and slash commands:
  - Keep "Code" as plain code.
  - Change "Mermaid diagram" to create `{type: 'code', language: 'mermaid', preview: 'mermaid'}`.
  - Add "Vega-Lite chart" creating `{type: 'code', language: 'vega-lite', preview: 'vega-lite'}`.
- Update `blockTypeMenuValue` and block-type conversion so preview-enabled code maps to the correct menu value.
- Update `BlockInlineControls`:
  - Keep the language selector for code blocks.
  - Show a preview checkbox only when the current normalized language has a configured renderer.
  - Toggling the checkbox should set or clear `meta.preview`.
  - Changing the language should clear unsupported preview metadata, and may enable preview by default for Mermaid/Vega-Lite when selected through explicit block type commands.
- Replace `MermaidBlock` with `PreviewableCodeBlock`.
  - It receives `previewKind`, `source`, and `editor`.
  - It owns local `mode: 'edit' | 'preview' | 'split'`.
  - Initial mode is `preview` when source is non-empty and preview is enabled; otherwise `edit`.
  - Split mode shows editor on the left and preview on the right.
- Rename CSS from Mermaid-specific classes to generic preview-code classes.
- Keep Mermaid-specific labels where useful in renderer configuration rather than hardcoding them in the generic component.

## Phase 5: Renderer Registry

Create a generic renderer registry and migrate Mermaid first.

- Add a renderer type, likely local to `App.tsx` initially unless the component gets too large:

```ts
type CodePreviewRenderer = {
    kind: CodePreviewKind;
    emptyLabel: string;
    loadingLabel: string;
    render(source: string, renderId: string): Promise<{html: string}>;
};
```

- Register Mermaid:
  - Keep `mermaid.initialize({startOnLoad: false, securityLevel: 'strict'})`.
  - Keep render IDs unique per block/render attempt.
  - Preserve current behavior of retaining the last good SVG while a new render is pending or errors.
- Add Vega-Lite:
  - Add the required package dependency or dependencies.
  - Render JSON Vega-Lite specs into preview HTML/SVG.
  - Show parse/render errors in the same generic error surface.
  - Add syntax highlighting language alias support for `vega-lite` if useful; otherwise render as plain JSON until highlighting support is added.

## Phase 6: Fixtures And Tests

Update fixtures and broaden test coverage.

- Replace the Mermaid fixture block with `type: 'code'`, `language: 'mermaid'`, `preview: 'mermaid'`.
- Add a Vega-Lite fixture with a small chart spec.
- Update `App.test.tsx`:
  - Preview-enabled Mermaid opens in preview mode by default.
  - Empty preview-enabled code opens in edit mode.
  - Split mode shows both editor and preview.
  - Preview checkbox appears for Mermaid/Vega-Lite languages and does not appear for unsupported languages.
  - Toggling preview metadata replicates to the other editor.
  - Previous render remains visible while async render is pending.
  - Error overlay behavior is preserved.
  - Vega-Lite renders a fixture or mocked renderer output.
- Update `blockCommands.test.ts`, `documentFormat.test.ts`, `clipboard.test.ts`, `history.test.ts`, and `documentFixtures.test.ts`.
- Keep old class-name assertions out of tests where possible; prefer accessible buttons, roles, and renderer output markers.

## Phase 7: Verification

Run focused tests first, then the example build.

- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/history.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/App.test.tsx`
- `npm exec vitest -- examples/block-rich-text/src/documentFixtures.test.ts`
- `npm --prefix examples/block-rich-text run build`

If new Vega-Lite dependencies are added, also verify install/lockfile changes and bundle/build behavior.

## Risks

- The current Mermaid worktree has uncommitted changes in `App.tsx`, `App.test.tsx`, and `style.css`; implementation should read those files carefully and preserve unrelated edits.
- Adding Vega-Lite may bring sizable dependencies or async rendering behavior that needs careful test mocking.
- Removing the top-level `mermaid` metadata type touches many validators and tests at once.
- `dangerouslySetInnerHTML` remains in use for trusted renderer output, so renderer registration should remain a closed internal map rather than accepting arbitrary external HTML.
