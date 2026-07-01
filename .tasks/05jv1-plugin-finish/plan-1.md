# Plan 1: Renderer Extraction

## Decisions From Research

- Renderer APIs should aim to be public, not temporary internal scaffolding.
- Block renderers should receive formatted render-tree information rather than only a raw CRDT
  block.
- Core should own common block row chrome: row container, depth/drop styling, selection decoration,
  drag affordance, and option-panel host.
- Feature renderers should own block body content. Structural renderers that consume their children
  should explicitly declare that they render children.
- Tables and slides should adapt to core-owned row chrome. For example, table dragging should move
  to the standard left-side affordance instead of being inside the table border.
- Loading documents without required feature plugins is prevented by compatibility checks, so
  renderer fallback can focus on core paragraph/plain editable blocks and development-time
  unsupported states.
- Core should continue composing inline mark classes; inline plugins should provide mark-specific
  decoration/event behavior rather than owning full mark composition.
- Annotation destination rendering can use a specialized API for now.
- Plugin renderers may import central helpers during extraction if that avoids premature helper
  churn.

## Phase 1: Public Renderer Context APIs

Add execution-capable renderer types in `src/block-editor/plugins/types.ts`.

Work items:

- Replace or extend `BlockEditorBlockRenderer.render(block, context)` so block renderers receive a
  formatted render node. The node should include block id, formatted runs, depth, parent id, block
  metadata/style, and children.
- Add an explicit child-rendering contract. A block renderer should be able to declare whether core
  should render children after the block body, or whether the renderer consumes children itself.
  Possible shape:
  - `children: 'core' | 'renderer'`
  - or optional `renderWithChildren(...)` in addition to `render(...)`.
- Add a public block render context with stable services:
  - `renderEditableBlock(node, options?)`
  - `renderChildren(node, options?)`
  - `renderChildrenAtRelativeDepth(node, baseDepth)`
  - block text and child text helpers
  - selection/focus update helpers
  - block command dispatch helpers
  - attachment lookup
  - preview metadata services
  - user id
  - drag/drop state needed for body renderers
  - table, slide, poll, and annotation service namespaces
- Keep row chrome services in core, not plugin renderers. Renderers should return body content that
  core mounts inside the row unless they are structural wrappers that need a body plus children.
- Add public inline render context while preserving core mark-class composition.
- Add public destination render context, with an annotation-specialized subcontext if needed.
- Add public option panel context or reserve the type in this phase, even if actual option panel JSX
  moves later.

Verification:

- Typecheck.
- Registry tests still pass.
- Add or update type-level/unit tests proving real renderers can receive formatted nodes and child
  rendering helpers.

## Phase 2: Core Dispatch And Row Host

Change central rendering from feature availability branches to registry dispatch while keeping
behavior equivalent.

Work items:

- Refactor `renderBlockNode` so it looks up `registry.blockRenderers.get(meta.type)` and dispatches
  to a renderer for registered feature blocks.
- Keep an explicit core fallback for paragraph/plain editable blocks.
- Keep a visible development fallback for impossible unsupported render states, but do not design
  around missing required plugins as a normal runtime path.
- Move common row rendering into a core host used by plugin body renderers:
  - `blockRow` wrapper
  - depth/drop CSS variables
  - block selection classes
  - drag classes
  - standard block affordance
  - option-panel host
- Make `renderEditableBlock` a core helper that plugin renderers can call without recreating row
  chrome.
- Move feature-specific row/body branches out of `EditableBlock` incrementally. During this phase,
  wrappers can call existing central components to avoid behavior changes.
- Decide and implement the block affordance extension point. Default recommendation: keep core
  affordances, add optional renderer metadata for marker content only if needed by lists/todos/
  ingredients.

Verification:

- Default preset smoke tests should render the same supported block set.
- Existing editor tests should pass.
- Manual smoke check for paragraph, heading, list, todo, callout, image, preview, poll, columns,
  slides, and table documents.

## Phase 3: Simple Block Renderers

Move simple block body renderers into their plugin modules.

Target plugins:

- `headings`
- `lists`
- `todos`
- `quote`
- `callouts`
- `ingredients`

Work items:

- Replace placeholder `declarationBlockRenderer(...)` entries with real render functions.
- Move heading/list/todo/ingredient body class decisions out of `EditableBlock`.
- Keep the standard row chrome in core.
- For lists and ingredients, keep marker/affordance rendering in core unless Phase 2 introduced a
  marker hook.
- For todos, route checkbox changes through existing command plumbing until command extraction
  moves ownership fully into the todo plugin.
- Move quote/callout grouped subtree rendering into plugin renderers using child-rendering helpers.

Verification:

- Simple block plugin tests should assert real renderer metadata and dispatch.
- Add render tests for headings, ordered/unordered lists, todos, blockquotes, callouts, and
  ingredients.
- Existing markdown shortcut and default preset tests should still pass.

## Phase 4: Media, Preview, And Code Renderers

Move image, link preview, and previewable code block body rendering into plugins.

Target plugins:

- `images`
- `linkPreview`
- `code`

Work items:

- Move image figure/body rendering into `plugins/images.ts` or a plugin-owned component module.
  Use context attachment lookup and core editable-surface caption rendering.
- Move preview card rendering into `plugins/linkPreview.ts` or a plugin-owned component module.
  Use context preview metadata update services.
- Move previewable code block rendering into `plugins/code.ts` or a plugin-owned component module.
  Use core syntax highlighting helpers and registry code preview renderer lookup as needed.
- Remove image/preview/code body branches from `EditableBlock`.
- Keep code keyboard behavior in core until command/keyboard extraction has a defined owner.

Verification:

- Image attachment render smoke test.
- Link preview render/update test.
- Code syntax and code preview tests.
- Clipboard tests should still pass, even though clipboard ownership is a later section.

## Phase 5: Poll Renderers

Move poll rendering into `plugins/polls.ts`.

Work items:

- Move `PollBlock`, `MatrixPollBlock`, and `LongAnswerPollBlock` to plugin-owned modules.
- Provide poll context services for:
  - current user id
  - child option derivation
  - matrix row/column derivation
  - editor mode read/write
  - vote and long-answer dispatch
- Mark child-backed poll renderers as consuming children when not in edit mode.
- Keep poll commands centrally bridged until command extraction moves them.
- Remove poll body branch and poll option derivation from central `renderBlockNode` and
  `EditableBlock`.

Verification:

- Poll render tests for choice, rating, long answer, child-backed options, and matrix polls.
- Poll edit/view mode tests.
- Existing history and document fixture tests should still pass.

## Phase 6: Columns And Slides

Move columns and slides into plugin-owned renderers while adapting them to core row chrome.

Target plugins:

- `columns`
- `slides`

Work items:

- Move `ColumnsBlock` and related mode components to the columns plugin.
- Move `SlideDeckBlock`, `OrphanSlideBlock`, slide viewport components, slide toolbar, and fullscreen
  controls to the slides plugin.
- Use context child rendering helpers for nested content and relative-depth rendering.
- Provide slide context services for:
  - deck UI state
  - orphan slide mode
  - current slide selection/focus
  - fullscreen state
  - add-slide command
- Update slide/table-adjacent drag affordance assumptions so slides use core row chrome wherever
  possible.
- Mark slide deck renderers as consuming children.

Verification:

- Columns display-mode render tests.
- Slide deck overview, outline, presentation, fullscreen, and orphan slide tests.
- Manual smoke check for drag/drop around slides after row chrome changes.

## Phase 7: Tables

Move table rendering into `plugins/table.ts` after the structural renderer context is proven.

Work items:

- Move `TableBlock`, table row/cell rendering, row header rendering, and table cell drag UI to
  plugin-owned modules.
- Adapt table row chrome to core-owned row affordances. The table drag handle should be standard
  left-side chrome, not inside the table border.
- Provide table context services for:
  - table cell selection lookup
  - full-column and rectangle selection helpers
  - keyboard navigation helpers
  - missing-cell creation
  - row/column insertion
  - cell and row drag target calculation
  - table-relative child rendering
- Mark table renderers as consuming children.
- Keep command helpers imported from central modules during this phase if needed.

Verification:

- Table render tests.
- Table keyboard navigation tests.
- Table selection and cell drag/drop tests.
- Existing multi-selection and block command tests should still pass.

## Phase 8: Annotation Destinations

Move annotation destination rendering and annotation body editing behind annotation plugin renderers.

Work items:

- Add an annotation-specific destination render context if the generic destination context becomes
  too broad.
- Move `AnnotationSidebar`, `Footnotes`, `FloatingAnnotationPopover`, `AnnotationBodyBlock`, and
  related body editor popover handling into annotation-owned modules.
- Wire `annotationsPlugin.destinationRenderers` to real render functions for:
  - sidebar
  - footer
  - floating
- Keep core responsible for mounting destination regions and passing the annotation context.
- Keep annotation body command implementations centrally bridged until command extraction.

Verification:

- Annotation sidebar/footer/floating render tests.
- Annotation body editing tests.
- Annotation resolve/focus tests.
- Existing annotation clipboard behavior should still pass.

## Phase 9: Inline Renderer Dispatch

Move inline DOM feature behavior from availability flags toward plugin-owned inline renderer
contributions while core keeps composition.

Work items:

- Update `RichTextEditableSurface` and related inline run rendering so core composes mark classes
  across all active marks.
- Let inline renderers contribute per-mark/per-embed behavior:
  - class names or attributes
  - event handlers
  - popover trigger metadata
  - text decoration wrappers where necessary
- Move link, code, math, annotation, and inline date behavior behind inline renderer contributions.
- Remove `InlineRenderFeatures` as a feature gate once dispatch covers the same behavior.
- Preserve deterministic mark composition for overlapping marks.

Verification:

- Inline rendering tests for overlapping bold/italic/code/link/annotation marks.
- Link hover/edit tests.
- Code hover/language tests.
- Math and inline date render tests.

## Phase 10: Option Panel Renderer Integration

This overlaps with section 4, but renderer extraction should leave the host ready for plugin-owned
panels.

Work items:

- Keep the option panel host/popover frame in core.
- Dispatch panel body rendering through `registry.optionPanels`.
- Use the public option panel context for metadata updates or command dispatch.
- Move central panel branches only when the section 4 extraction starts, unless a block renderer
  move needs a panel moved earlier.

Verification:

- Existing option panel behavior remains unchanged before full section 4 extraction.
- Registry dispatch test for option panels.

## Cleanup Criteria

Renderer extraction is complete when:

- `BlockRichTextEditor.tsx` no longer contains hard-coded block body branches for bundled feature
  metadata.
- `BlockRichTextEditor.tsx` owns only core editor shell responsibilities: registry dispatch, row
  host, editable-surface factory, destination hosts, and fallback rendering.
- Plugin modules own their block body render components.
- Annotation destinations are rendered through `annotationsPlugin.destinationRenderers`.
- Inline feature behavior uses inline renderer dispatch while core composes overlapping mark
  classes.
- Placeholder renderer declarations are gone for bundled features that actually render UI.
- Compatibility checks still prevent loading documents without required feature plugins.

## Recommended Test Command Set

Run the focused suite after each phase, widening for the later structural phases:

- `npm exec vitest -- src/block-editor/plugins/registry.test.ts`
- `npm exec vitest -- src/block-editor/defaultBlockEditorPlugins.test.ts`
- `npm exec vitest -- src/block-editor/inlineRunRendering.test.ts`
- `npm exec vitest -- src/block-editor/clipboard.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts`

