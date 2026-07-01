# Research 1: Renderer Extraction

## Scope

Section 1 of `remaining-work.md` is about moving rendering execution out of
`BlockRichTextEditor.tsx` and into plugin-owned renderers:

- `blockRenderers`
- `inlineRenderers`
- `destinationRenderers`
- `optionPanels`

The current registry already records most renderer declarations, but the declarations are mostly
feature flags. The actual JSX, event handling, and editor-service wiring remain centralized in
`BlockRichTextEditor.tsx`.

## Current Architecture

Renderer contribution types are intentionally small today. `BlockEditorRenderContext` only exposes
`state` and `registry`, and renderer functions receive a raw CRDT `Block`, not the formatted render
tree or editor services. See `src/block-editor/plugins/types.ts` around lines 132-165.

That shape is enough for declaration tests, but not enough to render bundled features:

- block renderers cannot render children or an editable surface;
- inline renderers cannot participate in the existing DOM/event behavior for links, code, math,
  annotations, and embeds;
- destination renderers cannot access annotation layout, popover state, body editing callbacks, or
  measurement data;
- option panels cannot mutate block metadata except through central callback props.

The central editor converts registered renderers into availability sets:

- `blockRenderFeaturesFromRegistry(...)`
- `inlineRenderFeaturesFromRegistry(...)`
- `annotationDestinationFeaturesFromRegistry(...)`

These sets gate hard-coded branches rather than dispatching to the renderer objects.

## Central Render Ownership Still Present

### Render tree dispatch

`renderBlockNode` in `BlockRichTextEditor.tsx` owns the block-tree traversal and hard-coded feature
branches. Around lines 3871-3940 it special-cases:

- `table` -> `TableBlock`
- `columns` -> `ColumnsBlock`
- `slide_deck` -> `SlideDeckBlock`
- orphan `slide` -> `OrphanSlideBlock`
- grouped `blockquote` and `callout`
- child-backed `poll` option/matrix derivation and child visibility

Everything else falls back to `renderEditableBlock`.

### Editable block wrappers

`EditableBlock` owns both the core editable surface and feature-specific wrapping. Around lines
7487-7888 it handles:

- code syntax highlighting and previewable code cards;
- ingredient highlighting;
- heading/image/ingredient CSS classes;
- image figure rendering and attachment lookup;
- link preview card rendering and metadata callbacks;
- poll rendering and vote callbacks;
- block options host rendering.

This means image, preview, poll, and previewable code renderers cannot be moved without first
creating a plugin render context that can supply an editable-surface element and feature services.

### Block affordances

`BlockAffordance` still contains feature-specific marker rendering for list items, todos, and
ingredients around lines 8916-8982. These are simple enough to extract early, but they raise a
small API question: block renderers may need to customize the row affordance separately from the
main block body.

### Option panels

`BlockOptions` remains a central branch table for `code`, `callout`, `image`, `poll`, `columns`,
`slide_deck`, `slide`, and block styles around lines 8985-9305. This overlaps with section 4, but
renderer extraction will touch it because `EditableBlock` always mounts `BlockOptions` as part of
the block row.

### Annotation destinations and bodies

Annotation destinations are registered in `annotationsPlugin`, but their `render` functions return
`null`. The real implementations remain in:

- `AnnotationSidebar`
- `Footnotes`
- `FloatingAnnotationPopover`
- `AnnotationBodyBlock`

These need the broadest context: rendered annotation models, body-block editing, focus requests,
popover positioning, inline mark/link/code popovers, clipboard, toolbar command availability, and
selection synchronization.

### Inline rendering

Plugins declare inline renderers for marks and embeds, but the central editable surface still owns
the behavior and DOM rendering choices. The plugin entries are currently used to derive feature
availability for boolean marks, code, links, math, annotations, and inline embeds.

## Existing Plugin Declarations

Current plugin modules already declare the intended ownership surface:

- `plugins/headings.ts`, `lists.ts`, `todos.ts`, `quote.ts`, `callouts.ts`, `ingredients.ts`
  declare simple block renderers.
- `plugins/images.ts`, `linkPreview.ts`, and `code.ts` declare media/code block renderers and
  option panels.
- `plugins/polls.ts`, `columns.ts`, `slides.ts`, and `table.ts` use structural placeholder helpers.
- `plugins/annotations.ts` declares inline and destination renderers.
- `plugins/basicMarks.ts`, `links.ts`, `math.ts`, `inlineDate.ts`, and `code.ts` declare inline
  renderers.

Most render declarations use helpers such as `declarationBlockRenderer(...)` or structural helpers
whose `render` implementation is a placeholder. That is useful for registry compatibility checks,
but it hides the execution gap.

## Required Context Shape

A practical renderer extraction needs a richer context than the current `BlockEditorRenderContext`.
The context should probably be split so simple plugins do not receive a very large API by default.

Recommended split:

- `BlockEditorRenderContext`: stable read-only basics, such as formatted state, registry, user id,
  block lookup, text lookup, and feature availability.
- `BlockEditorBlockRenderContext`: block tree node, child rendering helpers, editable-surface
  factory, row/affordance helpers, block-level decoration lookup, drag/drop services, and command
  dispatch helpers.
- `BlockEditorInlineRenderContext`: run/mark data, popover trigger services, link/code hover
  services, footnote/annotation labels, and inline embed opening.
- `BlockEditorDestinationRenderContext`: destination-specific state such as annotation models,
  popover positions, gutter positions, focus requests, body editing services, and measurement
  callbacks.
- `BlockEditorOptionPanelContext`: block metadata update services or command dispatch, code preview
  registry access, and block style mutation.

The service list implied by the existing central code includes:

- selection read/write and focus restoration;
- `runEditCommand` and `runBlockControlCommand`;
- editable-surface creation for a formatted block;
- child rendering for block subtrees with relative-depth support;
- attachment lookup for image blocks;
- preview metadata update hooks for link previews;
- current `userId` for poll rendering;
- drag/drop state and callbacks for block rows, slides, tables, and cells;
- table helpers for cell selection, keyboard movement, missing-cell creation, row/column insertion,
  cell drag targeting, and table-relative rendering;
- slide UI state for deck mode, fullscreen, current slide, orphan slide mode, and add-slide actions;
- poll editor mode state and vote/long-answer callbacks;
- annotation body activity, focus, selection, clipboard, and command services;
- popover positioning and hover lifecycle for links, code, annotations, and inline embeds;
- performance measurement callbacks used by editable surfaces.

## Suggested Extraction Plan

1. Add execution-capable renderer contexts without moving feature JSX.
   Keep central rendering behavior unchanged while exposing helper methods that mirror the current
   central closures. This reduces risk and lets plugin render functions become real one at a time.

2. Replace block availability sets with registry dispatch where possible.
   For each block, look up `registry.blockRenderers.get(meta.type)`. If a renderer exists, call it.
   Keep explicit core fallback rendering for paragraph/plain editable blocks and unknown unsupported
   blocks.

3. Extract simple block wrappers first.
   Headings, lists, todos, quote, callouts, and ingredients mostly need editable-surface creation,
   CSS class decisions, marker/affordance handling, and small command hooks such as todo toggle.
   These validate the context without moving the highest-risk interaction code.

4. Extract media and preview blocks.
   Image needs attachment lookup and caption editable surface. Link preview needs subtitle editable
   surface and preview metadata update services. Code preview needs syntax highlighting, code
   preview renderer lookup, and editor/preview composition.

5. Extract polls.
   Poll rendering needs user id, child option derivation, matrix derivation, editor mode state,
   vote commands, long-answer commands, and child visibility control for edit/view modes.

6. Extract columns and slides.
   Columns need child rendering and display-mode styling. Slides need deck-local UI state,
   fullscreen handling, current-slide selection/focus, slide scaling, relative rendering, and
   slide-specific block selection behavior.

7. Extract tables last among block renderers.
   Tables own the most DOM hit-testing and selection behavior: cell/row drag targets, missing-cell
   insertion, row/column insertion, keyboard selection, table-cell rendering, row headers, and
   relative-depth child rendering.

8. Extract annotation destinations and body editing.
   This likely deserves a dedicated annotation render context because it combines destination
   rendering with an embedded editor for annotation body blocks.

9. Convert inline rendering from feature flags to plugin dispatch.
   This should follow or happen alongside an editable-surface API pass. The current inline renderer
   declarations lack enough data and callbacks to recreate link/code/math/embed/annotation DOM
   behavior cleanly.

## Fallback Semantics

The central renderer should retain explicit fallbacks:

- paragraph/plain editable blocks always render with the core editable surface;
- registered block types with no renderer should degrade to a plain editable row unless the block
  type is structurally non-editable and needs an unsupported placeholder;
- unsupported persisted metadata should continue to be handled by compatibility checks before
  rendering where possible;
- plugin renderer failures should not silently hide user content. Prefer a visible unsupported
  block fallback during development and tests.

## Test Targets

Renderer extraction should keep or add coverage for:

- registry conflict/order tests for real renderer dispatch;
- default preset smoke test that asserts major block renderers are non-placeholder;
- focused render tests for image, preview, code preview, poll, columns, slides, and table;
- interaction tests for table keyboard/cell selection and slide presentation mode;
- annotation destination/body-editing tests;
- inline rendering tests for links, code, math, annotations, and inline date;
- compatibility tests confirming absent renderers disable feature surfaces or produce expected
  fallbacks.

## Risks

- The renderer context can become a large untyped service bag. Splitting by renderer kind is likely
  necessary to keep plugin APIs understandable.
- Some renderer work depends on command extraction. For example, poll votes, todo toggles, preview
  metadata updates, slide selection changes, table cell creation, and annotation body edits still
  call central command helpers.
- Option panel rendering overlaps with section 4. It may be better to add the option-panel context
  during renderer context work, but move actual panel JSX in a separate milestone.
- Inline renderer extraction may require changes inside `RichTextEditableSurface`, not just plugin
  modules.
- Tables and annotation bodies contain DOM-dependent behavior. They should be moved after simpler
  blocks prove the context model.

## Open Questions

- Should block renderers receive a formatted `RenderTreeNode` instead of a raw CRDT `Block`? The
  current type receives `Block`, but real renderers need runs, depth, parent/child relationships,
  and child rendering.
    - yeah that sounds right
- Should editable-surface creation be a context method, a component exported from the core editor,
  or both?
    - use your judgement
- Do block renderers own the full row chrome (`blockRow`, affordance, options), or only the content
  inside the row? Simple extraction is easier if core owns row chrome, but tables/slides may need
  more control.
    - core should own row chrome. tables and slides should actually change to better accommodate that (i.e. the drag handle for a table is currently rendered inside the table border, it should change to be to the left, like other blocks)
    - tables and slides do need to be able to indicate (via a plugin option? or implementing an optional `renderWithChildren` function?) that they take care of rendering children
- Should block affordances be a separate plugin contribution, or part of `blockRenderers`?
    - no opinion
- How should option panels dispatch metadata updates: direct mutation service, command IDs, or
  plugin-owned command handlers only?
    - no opinion
- Should destination renderers be generic, or should annotations get a specialized destination/body
  editor API because of their embedded editor behavior?
    - we can have it be specialized for now if that makes more sense
- What is the expected behavior when a document contains a supported block type but the renderer
  plugin is absent? Plain fallback, unsupported placeholder, or compatibility failure?
    - loading a document without the required plugins is prevented
- Should inline renderers compose multiple marks themselves, or should core continue to compose mark
  classes while plugins only provide mark-specific decorations and event hooks?
    - I think core should compose mark classes
- Can table and slide renderers safely live in plugin modules while still importing central helper
  functions, or should those helpers move first to avoid circular dependencies?
    - I think it's ok
- Should renderer context APIs be public/stable plugin API now, or internal experimental APIs until
  the bundled extraction is complete?
    - let's aim for public
