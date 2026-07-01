# Implementation Log 1: Renderer Extraction

## 2026-06-30

- Started implementation of `plan-1.md`.
- Observed unrelated dirty worktree changes outside this task. Keeping task edits scoped to
  `.tasks/05jv1-plugin-finish` and `src/block-editor`.
- Phase 1: added public renderer context types in `src/block-editor/plugins/types.ts`.
  - Block renderers now receive formatted render-tree nodes and have an explicit child-rendering
    mode.
  - Added public block, inline, destination, and option-panel render contexts.
  - Kept existing placeholder renderers source-compatible.
  - Verification passed:
    - `npm exec tsc -- --noEmit`
    - `npm exec vitest -- src/block-editor/plugins/registry.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`
- Phase 2: added central registry dispatch for block renderers.
  - Render tree nodes now use the public formatted node type and include stable `id` fields.
  - Plugin renderer output is mounted by the core render path. Renderers that return `null` still
    fall back to the legacy central branches, which keeps placeholder renderers safe during
    extraction.
  - Added a bridge from the existing internal `RenderBlockContext` to the public
    `BlockEditorBlockRenderContext`.
  - Issue/workaround: command dispatch in the render context is intentionally thin for now because
    real command ownership is covered by a later plan section. It routes to registered command
    handlers with the current primary selection as a retained selection set.
- Phase 3: replaced placeholder renderers for simple block plugins with real plugin-owned render
  functions.
  - Updated `headings`, `lists`, `todos`, `quote`, `callouts`, and `ingredients`.
  - Added reusable `editableBlockRenderer(...)` and `groupedBlockRenderer(...)` helpers.
  - Quote and callout renderers now consume and render their children via plugin renderers.
  - Verification passed:
    - `npm exec tsc -- --noEmit`
    - `npm exec vitest -- src/block-editor/plugins/registry.test.ts src/block-editor/plugins/simpleBlockPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts src/block-editor/inlineRunRendering.test.ts`
- Phase 4: moved media, link-preview, and previewable-code block rendering into plugin renderers.
  - Updated `images`, `linkPreview`, and `code` block renderers.
  - Plugin renderers still delegate to existing shared components/helpers (`ImagePreview`,
    `PreviewBlockCard`, `PreviewableCodeBlock`, and code preview registry helpers).
  - Keyboard behavior and command ownership remain central, as planned.
  - Verification passed:
    - `npm exec tsc -- --noEmit`
    - `npm exec vitest -- src/block-editor/plugins/code.test.ts src/block-editor/plugins/simpleBlockPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`
- Phase 5: moved poll block rendering into a plugin-owned renderer module.
  - Added `src/block-editor/plugins/pollRenderer.tsx` and wired `pollsPlugin` to it.
  - Added typed poll render services for editor mode, voting, and long-answer submission. These
    still call the existing central mutation logic until command extraction.
  - Issue found/fixed: the first pass let core render child-backed poll children in view mode.
    The renderer now declares `children: 'renderer'` and reproduces the old edit/view child
    visibility rule.
  - Verification passed:
    - `npm exec tsc -- --noEmit`
    - `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts examples/block-rich-text/src/history.test.ts`
- Phase 6 partial: moved columns rendering into a plugin-owned renderer module.
  - Added `src/block-editor/plugins/columnsRenderer.tsx` and wired `columnsPlugin` to it.
  - Added public drag/drop, decoration, and relative-depth render services needed by columns.
  - Verification passed:
    - `npm exec tsc -- --noEmit`
    - `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts examples/block-rich-text/src/blockCommands.test.ts`
- Phase 6 issue: slide rendering is significantly more coupled than columns. It depends on
  fullscreen DOM state, element measurement, block-selection mutation, slide option panels, and
  slide-specific drag/focus behavior. It should be extracted in a dedicated slide renderer pass
  after those services are promoted, rather than copied hastily.
- Broader verification passed after completed slices:
  - `npm exec vitest -- src/block-editor/plugins/registry.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts src/block-editor/inlineRunRendering.test.ts src/block-editor/clipboard.test.ts`
  - `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts`
  - `npm exec tsc -- --noEmit`
- Remaining renderer phases not completed in this pass:
  - Slides still need a dedicated service extraction for fullscreen, measurement, slide selection,
    and slide option-panel behavior.
  - Tables still need table-specific render services for cell selection, hit-testing, drag/drop,
    and row/cell rendering.
  - Annotation destinations/body editing still need an annotation-specific destination context.
  - Inline renderer dispatch and option-panel body dispatch remain pending.
