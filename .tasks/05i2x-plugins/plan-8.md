# Plan 8: Phase 8 Annotations Plugin

## Context

Phases 1-7 are complete. The editor now has a plugin registry, compatibility checks, registry-derived inline rendering availability, simple block plugin declarations, registry-aware block type commands, and registry-gated central rendering for simple blocks.

Phase 8 extracts annotations into one plugin that owns comments, footnotes, and popovers. This is higher risk than the simple block plugin work because annotations are not just a mark. They create virtual parent blocks, own body editing behavior, affect CRDT materialization, add inline decorations, render destination UI outside the main block flow, and participate in clipboard/import/export.

The current Phase 8 entry in `plan.md` is directionally correct but too compressed for implementation. This document expands it into concrete boundaries and slices.

## Goal

Move annotation ownership behind `annotationsPlugin` while preserving current full-feature behavior under `legacyRichTextPlugins`.

The result should be:

- The `annotation` mark, annotation mark behavior, and annotation mark virtual-parent hook are declared by `annotationsPlugin`.
- Annotation toolbar items, command ids, inline renderer ownership, destination renderer ownership, and clipboard behavior are plugin-owned or registry-gated.
- Documents containing annotation marks fail compatibility checks when `annotationsPlugin` is absent.
- Editors without `annotationsPlugin` cannot create comments, footnotes, popovers, annotation bodies, annotation inline decorations, or annotation clipboard payloads.
- Existing sidebar comments, footnotes, floating popovers, nested popovers, and annotation body editing remain unchanged when the plugin is registered.
- Table virtual-parent behavior is not accidentally owned by annotations after this phase.

## Non-Goals

- Do not extract tables, table cell selections, columns, slides, or other structural plugins in this phase.
- Do not require destination renderers to fully replace all existing annotation JSX if the render context is not ready; registry ownership and gating can come first.
- Do not redesign the annotation data model or persisted document format.
- Do not move editor-owned layout concerns such as sidebar width, editor panel layout, scroll coordination, or global focus management into the plugin.
- Do not make annotation body editing independent of existing inline/block command helpers unless the required service context already exists.
- Do not remove public compatibility exports such as `annotationVirtualParents` until examples and downstream tests have a registry-backed replacement.

## Current Ownership To Untangle

CRDT and compatibility:

- `ANNOTATION_MARK`, `AnnotationPresentation`, `AnnotationMarkData`, and annotation mark behavior live in `virtualParents.ts` and are re-exported from `annotations.ts`.
- `annotationVirtualParents` is currently an alias of `richTextVirtualParents`.
- `richTextVirtualParents` combines annotation mark virtual parents with `tableVirtualParentsForBlock`.
- `legacyAnnotationsCrdtPlugin` declares the `annotation` mark and CRDT behavior, but it also currently includes table virtual parents.
- Many command modules call `annotationVirtualParents(state)` directly instead of using a registry-derived CRDT config.

Commands and editing:

- `createAnnotation` creates the annotation mark and a body paragraph under the annotation mark id.
- `resolveAnnotation` rewrites active annotation marks as resolved.
- Annotation body commands handle text replacement, markdown paste, splitting, backspace/delete, body block removal, basic marks, links, and inline code.
- Annotation body markdown shortcuts currently default to `legacyMarkdownShortcutSpecs`.
- Toolbar and shortcut availability are registry-gated from Phase 6, but annotation command implementations still live in editor-local paths.

Rendering:

- Inline run rendering adds sidebar, popover, and footnote datasets/classes for annotation marks.
- Footnote references are inserted inline based on stable visible reference order.
- `renderedAnnotations` derives sidebar/footer/floating destination data from materialized blocks.
- `AnnotationSidebar`, `Footnotes`, `AnnotationFloatingPopover`, and annotation body editor components are embedded in `BlockRichTextEditor.tsx`.
- `useAnnotationPopoverController` owns nested popover open/close state, hover transition behavior, focus reasons, and active popover positioning.

Clipboard and static serialization:

- `clipboard.ts` serializes annotation refs and body blocks.
- Clipboard filtering from Phase 6 intentionally still allows annotation marks.
- Rich paste can reuse annotation ids within a document or create fresh ids for another document.
- Static run serialization in `BlockRichTextEditor.tsx` renders annotation datasets, footnote references, and popover data.

Examples and persistence:

- `examples/block-rich-text/src/documentFormat.ts` imports/exports annotation marks and annotation body blocks.
- Example tests call `annotationVirtualParents` directly for document formatting, runtime, history, and structural assertions.
- Several example behavior tests cover sidebar comments, footnotes, nested popovers, annotation body editing, undo, and clipboard.

## Proposed Plugin Boundary

### `annotationsPlugin`

Owns:

- mark declaration: `annotation`
- mark behavior: stacking annotation marks
- mark virtual parents for active annotation marks
- annotation toolbar items:
  - `annotation:sidebar`
  - `annotation:footnote`
  - `annotation:popover`
- command declarations:
  - `annotation:create-sidebar`
  - `annotation:create-footnote`
  - `annotation:create-popover`
  - `annotation:resolve`
  - `annotation:body-replace-selection`
  - `annotation:body-split-block`
  - `annotation:body-delete-backward`
  - `annotation:body-delete-forward`
  - `annotation:body-remove-block`
  - `annotation:body-toggle-mark`
  - `annotation:body-set-link`
  - `annotation:body-remove-link`
  - `annotation:body-toggle-code`
  - `annotation:body-set-code-language`
  - `annotation:body-clear-code-language`
  - `annotation:body-remove-code`
- inline renderer ownership for annotation mark decorations
- destination renderer ownership:
  - `sidebar` for comments
  - `footer` for footnotes
  - `floating` for popovers
- annotation selectors/helpers needed by destination renderers
- clipboard participation for annotation refs and body blocks, where the current hook shape allows
- styles for annotation-specific classes, if Phase 12 has not moved styles yet

Editor-owned:

- sidebar width and collapsed/open panel layout
- main editor focus restoration and retained selection plumbing
- popover DOM positioning relative to the editor panel, unless a generic destination service is introduced
- global outside-click and editor-switch behavior
- body editor integration with existing block/inline command helpers

Compatibility decision:

- Keep public annotation helper exports during this phase, but make the default full-feature helpers use `legacyRichTextPlugins` or an annotations registry internally where possible.
- Add registry-backed alternatives before removing or deprecating legacy helper names.

## Required Foundation Work

### 1. Split Annotation CRDT From Table Virtual Parents

The current annotation CRDT path is coupled to tables through `richTextVirtualParents`.

Add focused CRDT helpers:

- `annotationMarkVirtualParents(mark)`
- `annotationCrdtHooks`
- `annotationVirtualParentConfigFromRegistry(registry, state)` if useful for compatibility exports

Then update `legacyAnnotationsCrdtPlugin` so it owns only:

- `marks: [{id: 'annotation'}]`
- `crdt.markBehavior.annotation = 'stacking'`
- `crdt.markVirtualParents` for annotation body blocks

Move table virtual parent behavior out of the annotations plugin path:

- Keep it in a transitional legacy structural CRDT plugin if needed.
- Or keep it in `legacyRichTextBlocksPlugin`/a `legacyStructuralCrdtPlugin` until Phase 10/11.

Behavioral requirement:

- Removing `annotationsPlugin` removes annotation mark support.
- Removing table support later should not require removing annotations.
- Existing table tests continue passing under `legacyRichTextPlugins`.

### 2. Registry-Backed Virtual Parent Access

Direct calls to `annotationVirtualParents(state)` make annotation behavior look core.

Add a transition helper such as:

- `richTextVirtualParentsFromRegistry(registry, state)`
- `virtualParentsForEditorState(registry, state)`
- or `commandVirtualParents(context, state)`

Use it in editor-owned runtime paths first:

- `BlockRichTextEditor`
- slash command deletion flow
- main block command application paths where context is already available
- annotation body command calls

Do not try to rewrite every structural helper in one step if that creates churn. For modules that still need standalone exports, keep a compatibility wrapper that uses `legacyRichTextPlugins`.

### 3. Annotation Mark Compatibility And Validation

Centralize annotation mark data validation:

- `id` is a Lamport tuple
- `presentation` is `sidebar | footnote | popover`
- `resolved` is optional boolean

Ensure compatibility scanning catches:

- active or resolved annotation marks without `annotationsPlugin`
- malformed annotation mark data, if the existing compatibility scanner supports mark data validation
- persisted annotation body blocks whose virtual parent is an annotation mark without `annotationsPlugin`

If the current mark spec cannot validate data, record that API gap and add tests for the checks that are possible today.

### 4. Annotation Command Availability

Move toolbar declarations out of `legacyRichTextUiPlugin` into `annotationsPlugin`.

Preserve existing visual toolbar placement through `order`.

Gate all existing editor-local annotation entry points on registered command ids:

- toolbar comment/footnote/popover buttons
- keyboard shortcuts, if any
- annotation body inline shortcuts
- annotation body paste auto-linking
- resolve buttons
- nested popover creation from annotation body selections

Implementation can remain editor-local initially. The important requirement is that unavailable annotation commands do not mutate state.

### 5. Annotation Selectors For Destination Renderers

Define the selectors the destination renderers need, even if the actual JSX stays central at first.

Selectors should cover:

- all active rendered annotations
- comments only
- footnotes only, with stable numbering
- popovers only, with body text lookup
- annotation body block ids for a mark id
- reference text for an annotation id
- active/resolved annotation mark data
- visible annotation ranges for alignment/positioning

Prefer pure helpers that take `state`, materialized blocks, and registry/CRDT config rather than reading React component state.

### 6. Destination Renderer Gating

The plugin registry already groups destination renderers, but `BlockRichTextEditor` does not fully execute arbitrary destination renderers as the primary rendering path.

For this phase, use a two-step transition:

1. `annotationsPlugin` declares destination renderer ownership for `sidebar`, `footer`, and `floating`.
2. `BlockRichTextEditor` renders the existing annotation destinations only when those registry declarations exist.

Later phases can replace hard-coded destination JSX with generic renderer execution.

Behavioral requirement:

- Without `annotationsPlugin`, no annotation sidebar cards, gutter dots, footnote list, inline footnote numbers, annotation hover spans, or floating popovers render.
- With `annotationsPlugin`, current rendering stays unchanged.

### 7. Inline Annotation Render Feature Gating

Add annotation capability to the existing inline render feature flow.

Gate:

- annotation mark classes
- `data-sidebar-annotation-ids`
- `data-popover-id`
- `data-popover-ids`
- footnote reference numbers
- static serialization of annotation-specific spans/datasets

Behavioral requirement:

- Documents with annotation marks should normally be rejected by compatibility checks when the plugin is absent.
- Defensive rendering should still avoid annotation-specific DOM if a caller bypasses compatibility checks.

### 8. Clipboard And Paste Filtering

Move annotation clipboard behavior behind plugin availability.

Minimum behavior:

- Copy without `annotationsPlugin` does not include annotation refs or annotation body payloads.
- Rich paste without `annotationsPlugin` strips annotation marks and ignores annotation body payloads.
- Rich paste with `annotationsPlugin` preserves current behavior:
  - same-document paste reuses existing annotation ids
  - cross-document paste creates fresh ids
  - body blocks are copied with nested marks and child annotations

If `BlockEditorClipboardHooks` remains too document-wide, implement registry-aware annotation filtering first and log the hook limitation.

### 9. Example Import/Export And History Gating

The example document format supports annotations directly. Decide whether example import/export is full-feature-only or plugin-aware.

Recommended transition:

- Keep example fixtures full-feature by using `legacyRichTextPlugins`.
- Add parser/exporter tests that document annotations require the annotations plugin if plugin-aware document loading is introduced there.
- Keep `annotationVirtualParents` public for existing example utilities until a registry-backed example helper exists.

## Implementation Slices

### Slice 1: Plugin Declaration And CRDT Decoupling

Add `annotationsPlugin` under `src/block-editor/plugins/`.

Declare:

- mark `annotation`
- toolbar items
- commands
- inline renderer ownership
- destination renderer ownership
- CRDT mark behavior and mark virtual parents

Update:

- `plugins/index.ts`
- `legacyRichTextPlugins.ts`
- `editorCrdtConfig.ts`
- `editorCrdtConfig.test.ts`
- `legacyRichTextPlugins.test.ts`
- `legacyRichTextUi.test.ts`

Also introduce a separate transitional structural/table CRDT plugin if needed to remove table virtual parents from the annotations plugin without breaking current full-feature behavior.

Tests:

- `annotationsPlugin` declares the annotation mark.
- registry CRDT config includes annotation stacking behavior with the plugin.
- registry CRDT config excludes annotation behavior without the plugin.
- table virtual parents still exist under `legacyRichTextPlugins` but are not contributed by `annotationsPlugin`.
- annotation mark compatibility fails without `annotationsPlugin`.

### Slice 2: Registry-Backed Virtual Parent Helpers

Add a registry-backed virtual-parent helper and thread it through the editor-local paths that are easiest to reach.

Update at least:

- `BlockRichTextEditor` materialization
- `renderedAnnotations` call sites
- annotation body id derivation
- slash command trigger deletion
- annotation command application inside the editor

Keep old `annotationVirtualParents` export as a compatibility wrapper using the full legacy registry.

Tests:

- editor materialization still includes annotation body blocks under `legacyRichTextPlugins`
- editor materialization excludes annotation virtual body behavior without `annotationsPlugin`
- existing annotations tests still pass

### Slice 3: Toolbar And Command Gating

Move annotation toolbar specs out of `legacyRichTextUiPlugin` and into `annotationsPlugin`.

Gate editor-local handlers for:

- create sidebar comment
- create footnote
- create popover
- resolve annotation
- create nested popover from annotation body selection
- annotation body editing commands

Tests:

- toolbar annotation buttons are present only with `annotationsPlugin`
- create comment/footnote/popover no-op without the plugin
- resolve no-ops without the plugin
- annotation body commands no-op or are unavailable without the plugin
- full-feature annotation creation still replicates to peer editor

### Slice 4: Annotation Selectors

Move pure selector logic into an annotations plugin support module.

Targets:

- `renderedAnnotations`
- `annotationBodyBlockIds`
- active annotation data extraction
- footnote numbering derivation
- popover text lookup
- sidebar annotation ranges/gutter alignment inputs

Do not force React components into plugin files yet if that makes destination rendering harder to review.

Tests:

- selectors return comments, footnotes, and popovers in stable visible order
- footnote numbering remains stable with overlapping and multi-run references
- resolved annotations are excluded from active render selectors
- body blocks survive CRDT materialization

### Slice 5: Destination Renderer Ownership And Gating

Declare destination renderers from `annotationsPlugin`:

- `annotations.sidebar`
- `annotations.footer`
- `annotations.floating`

Gate existing central destination rendering on those declarations.

If adding generic destination renderer execution is straightforward, introduce it behind existing props. Otherwise keep the central JSX and record the deferred renderer API gap.

Tests:

- comments render in the sidebar and align to annotated text under `legacyRichTextPlugins`
- footnotes render in the footer with stable numbering
- popovers render on hover/focus
- no sidebar/footer/floating annotation UI appears without `annotationsPlugin`

### Slice 6: Inline Annotation Rendering Gating

Thread annotation inline render availability through editable and static run rendering.

Gate:

- annotation classes
- sidebar datasets
- popover datasets
- footnote references
- popover text and footnote number maps

Tests:

- annotated text receives the same classes and datasets with `annotationsPlugin`
- footnote reference numbers render once for multi-run references
- popover marks expose the same `data-popover-*` attributes
- annotation DOM is absent under a defensive no-plugin render path

### Slice 7: Popover Controller Boundary

Move annotation popover control behind the plugin boundary without changing behavior.

Options:

- keep `useAnnotationPopoverController` as a plugin-owned exported hook used by `BlockRichTextEditor`
- or keep it editor-owned but only initialize/use it when the floating annotation destination renderer is registered

Tests:

- nested popovers remain ordered parent-to-child
- leaving toward a popover keeps it open briefly
- leaving away closes it immediately
- parent/child focus and hover rules remain unchanged
- Escape closes nested popovers deepest-first

### Slice 8: Annotation Body Editing

Move annotation body command declarations into `annotationsPlugin` and gate body editor handlers by command availability.

Keep existing implementations in `annotations.ts` unless command context is expanded enough to own them fully.

Pay special attention to plugin dependencies:

- body basic marks depend on basic mark plugins
- body links depend on `linksPlugin`
- body code depends on `codePlugin`
- body markdown shortcuts depend on registered block plugins from Phase 7

Tests:

- annotation body text editing still works
- splitting body blocks with Enter still focuses the new sibling
- Backspace on the last empty body resolves/removes as before
- body markdown shortcuts use `registry.markdownShortcuts`
- body inline shortcuts respect the owning inline plugin availability

### Slice 9: Clipboard And Rich Paste

Add annotation-aware registry filtering to clipboard copy/paste.

With `annotationsPlugin`:

- preserve annotation refs
- include reachable body blocks
- preserve nested annotation refs in body blocks
- reuse ids within the same document
- create fresh ids across documents

Without `annotationsPlugin`:

- strip annotation marks from copied/pasted fragments
- drop annotation body payloads
- avoid creating virtual body blocks

Tests:

- existing annotation clipboard tests pass under `legacyRichTextPlugins`
- invalid annotation entries are rejected as before
- no-plugin copy/paste drops annotations cleanly
- no-plugin paste does not leave orphan body blocks

### Slice 10: Example Import/Export And Public Compatibility

Audit example imports and public exports.

Keep or add:

- a legacy full-feature `annotationVirtualParents` wrapper
- registry-backed virtual parent helper exports
- annotation selector exports that do not force plugin internals into app code

Update example tests only where plugin-aware behavior is now explicit.

Tests:

- document format imports annotations with body blocks
- document format round-trips footnote annotation metadata
- history replay preserves annotation body blocks
- undo removes/restores annotation marks and body blocks as before

### Slice 11: Cleanup And Documentation

Remove stale legacy declarations after the new plugin owns them.

Update:

- `implementation-log.md` or a phase-specific log
- `plan.md` if any later phase dependency changed
- public exports
- comments around transitional virtual-parent helpers

Document deferred gaps:

- generic destination renderer execution if still hard-coded
- richer command context for plugin-owned body editing
- clipboard hook shape limitations
- remaining direct `annotationVirtualParents` compatibility wrappers

## Test Matrix

Focused unit tests:

- `src/block-editor/plugins/annotations.test.ts`
- `src/block-editor/editorCrdtConfig.test.ts`
- `src/block-editor/legacyRichTextPlugins.test.ts`
- `src/block-editor/plugins/legacyRichTextUi.test.ts`
- `src/block-editor/plugins/compatibility.test.ts`
- `src/block-editor/clipboard.test.ts`

Command and selector tests:

- `src/block-editor/annotations.test.ts`, if added
- existing command tests that cover annotation creation/body editing
- markdown shortcut tests for annotation bodies and registered block shortcuts

Example behavior tests:

- `examples/block-rich-text/src/annotations.test.ts`
- `examples/block-rich-text/src/App.test.tsx` annotation/sidebar/footnote/popover cases
- `examples/block-rich-text/src/clipboard.test.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/undoHistory.test.ts`
- `examples/block-rich-text/src/history.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`

Commands to run after each major slice:

```sh
npm run typecheck
npm exec vitest -- run src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/clipboard.test.ts
```

Commands to run before completing the phase:

```sh
npm run typecheck
npm run typecheck:examples
npm exec vitest -- run src/block-editor examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/undoHistory.test.ts
```

If touching popover UI behavior, also run the focused App tests or the full example test file:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

## Risks

- Annotation virtual parents are currently used as a broad rich-text virtual-parent helper. Separating annotations from table virtual parents can break structural tests if done too aggressively.
- `blockCommands.ts` has many direct `annotationVirtualParents` calls, including table/columns/slides logic. Trying to migrate all of them in one slice is likely too much churn.
- Destination renderer APIs exist but the editor does not yet execute arbitrary destination renderers as the sole rendering path.
- Annotation body editing depends on several other plugins. Gating must compose with basic marks, links, code, and Phase 7 block shortcuts.
- Clipboard behavior is recursive because annotation body blocks can contain annotation refs. Filtering must avoid orphan body payloads.
- Popover behavior has nuanced hover/focus timing. Any extraction should keep the hook behavior intact until tests prove otherwise.
- Example import/export currently treats annotations as document-format features, not optional plugins. Plugin-aware document loading needs a deliberate boundary.

## Completion Criteria

- `annotationsPlugin` is exported and included in `legacyRichTextPlugins`.
- `legacyRichTextUiPlugin` no longer owns annotation toolbar items.
- Annotation mark compatibility is owned by `annotationsPlugin`.
- Annotation CRDT mark behavior and mark virtual parents are owned by `annotationsPlugin`.
- Table virtual parents are no longer contributed by the annotations plugin.
- Creating, resolving, rendering, and editing annotations is gated by plugin availability.
- Sidebar comments, footnotes, floating popovers, nested popovers, and annotation body editing behave unchanged under `legacyRichTextPlugins`.
- Clipboard copy/paste preserves annotations with the plugin and strips them without the plugin.
- Documents with annotation marks fail compatibility checks without `annotationsPlugin`.
- Deferred API gaps are recorded in the implementation log.
