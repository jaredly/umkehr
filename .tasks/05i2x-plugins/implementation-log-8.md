# Implementation Log: Phase 8 Annotations Plugin

## 2026-06-29

### Slice 1: Plugin Declaration And CRDT Decoupling

- Added `annotationsPlugin` in `src/block-editor/plugins/annotations.ts`.
- The plugin now declares:
  - the `annotation` mark
  - annotation toolbar items
  - annotation command ids
  - annotation inline renderer ownership
  - `sidebar`, `footer`, and `floating` destination renderer ownership
  - annotation CRDT mark behavior and mark virtual parents
- Exported the plugin from `src/block-editor/plugins/index.ts`.
- Updated `legacyAnnotationsCrdtPlugin` to alias `annotationsPlugin`.
- Added `legacyStructuralCrdtPlugin` as a transitional home for table virtual parents.
- Updated `legacyRichTextCrdtPlugins` so full legacy behavior still includes annotations, table virtual parents, and poll metadata merge hooks.
- Moved annotation toolbar item declarations out of `legacyRichTextUiPlugin` to avoid duplicate registry contributions.
- Added focused `src/block-editor/plugins/annotations.test.ts`.
- Updated existing CRDT, legacy preset, and UI tests for the new ownership split.

Issues/workarounds:

- Adding toolbar declarations to `annotationsPlugin` immediately conflicted with `legacyRichTextUiPlugin`, so the annotation toolbar move happened in this slice rather than waiting for a later command-gating slice.
- A plugin ordering assertion needed to be updated after adding `legacyStructuralCrdtPlugin`.
- The first typecheck caught that CRDT mark hooks receive `Mark` values with optional `data`; `annotationMarkVirtualParents` now accepts optional `data`.
- Destination and inline renderer declarations are ownership declarations only. Existing central rendering remains the implementation.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/plugins/compatibility.test.ts` passed.
- `npm run typecheck` passed.

### Slice 2: Registry-Backed Virtual Parent Helpers

- Added `richTextVirtualParentsFromRegistry(state, registry)` as a registry-backed helper for editor-local virtual parent config.
- Extended `annotationBodyBlockIds` and `renderedAnnotations` to accept an explicit virtual parent config while preserving the existing legacy default.
- Updated `BlockRichTextEditor` to derive `virtualParents` from the configured registry and use it for:
  - materializing blocks with annotation bodies
  - collecting annotation body ids
  - deriving rendered annotation models

Issues/workarounds:

- The broad exported `annotationVirtualParents(state)` wrapper remains in place because `blockCommands.ts`, `multiSelectionCommands.ts`, examples, and structural tests still use it as the legacy full-feature virtual-parent helper.
- This slice intentionally avoids rewriting all structural command call sites. Those call sites include table, columns, and slide behavior and need a more deliberate command-context migration.
- The new selector parameters provide a migration path without breaking existing direct helper callers.

Verification:

- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts src/block-editor/editorCrdtConfig.test.ts src/block-editor/legacyRichTextPlugins.test.ts src/block-editor/plugins/compatibility.test.ts examples/block-rich-text/src/annotations.test.ts` passed.
- `npm run typecheck` passed.

### Slice 3: Toolbar And Command Gating

- Added defensive command availability checks around top-level annotation creation and resolve paths.
- Gated annotation body mutations by annotation command ids:
  - body text replacement
  - split
  - backward/forward delete
  - link set/remove
  - code language set/clear/remove
  - body mark/code/link keyboard shortcuts
  - rich/plain paste body mutations
  - cut body deletion
- Kept the existing editor-local command implementations. The plugin owns command declarations, while the editor still supplies body editing services and focus restoration.

Issues/workarounds:

- The main toolbar path was already gated through registered toolbar command ids. This slice added explicit defensive checks for direct function calls and body editor handlers.
- Annotation body handlers still receive a prop named `isToolbarCommandAvailable`, but it now checks all registered command ids, toolbar ids, and slash ids. Renaming the prop is a cleanup item.
- Full `examples/block-rich-text/src/App.test.tsx` still fails in the four known Mermaid preview tests that were already called out in Phase 6/7. The annotation-specific cases in that file passed before those known failures.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/legacyRichTextPlugins.test.ts examples/block-rich-text/src/annotations.test.ts` passed.
- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts src/block-editor/plugins/legacyRichTextUi.test.ts src/block-editor/legacyRichTextPlugins.test.ts examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/App.test.tsx` failed only in the known Mermaid preview cases:
  - `opens populated mermaid fixture blocks in preview mode`
  - `shows editor and preview together in split mode`
  - `keeps the previous mermaid render visible while remote updates render`
  - `keeps the previous mermaid render visible with an error overlay when remote updates fail`

### Slice 4: Annotation Selectors

- Added pure annotation selector helpers in `annotations.ts`:
  - `renderedAnnotationsByPresentation`
  - `renderedAnnotationMapById`
  - `popoverTextByAnnotationId`
  - `footnoteNumberByAnnotationId`
- Updated `BlockRichTextEditor` to use those helpers for sidebar, popover, popover text, and footnote numbering derivation.
- Added focused selector coverage to `src/block-editor/plugins/annotations.test.ts`.

Issues/workarounds:

- React destination components still live in `BlockRichTextEditor.tsx`; this slice only moved pure data derivation behind annotation support helpers.
- Selector helpers operate on `RenderedAnnotation[]`, preserving the current materialization and ordering contract from `renderedAnnotations`.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts examples/block-rich-text/src/annotations.test.ts` passed.

### Slice 6: Inline Annotation Rendering Gating

- Added an `annotations` capability to `InlineRenderFeatures`.
- Derived annotation inline rendering availability from registered inline renderer ownership of the `annotation` mark.
- Included annotation availability in the inline render feature cache key.
- Gated annotation-specific run rendering:
  - `markAnnotation`
  - sidebar annotation datasets
  - popover classes/datasets/ARIA label
  - inline footnote reference insertion

Issues/workarounds:

- Default inline render features still include annotations for legacy/static helper callers that do not pass a registry-derived feature set.
- Documents with annotation marks are still expected to fail compatibility checks without `annotationsPlugin`; the render gate is defensive and supports partial rendering paths.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/inlineRunRendering.test.ts src/block-editor/plugins/annotations.test.ts examples/block-rich-text/src/annotations.test.ts` passed.

### Slice 7: Popover Controller Boundary

- Added an `enabled` option to `useAnnotationPopoverController`.
- Passed `annotationDestinationFeatures.floating` from `BlockRichTextEditor`.
- When disabled, the controller:
  - returns no active popovers
  - ignores show/hide/focus callbacks
  - skips global outside-click, resize, scroll, and selection effects
  - clears managed popover state and pending hide timers

Issues/workarounds:

- The hook is still called unconditionally to preserve React hook ordering. The new `enabled` flag makes it inert when the annotations floating destination is unavailable.
- Popover positioning and lifecycle logic remains in the existing hook for now; this slice moves the boundary without changing behavior.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts src/block-editor/plugins/annotations.test.ts` passed.

### Slice 8: Annotation Body Editing

- Confirmed annotation body command ids are declared by `annotationsPlugin`.
- Body editor handlers are now gated by annotation command availability from Slice 3.
- Added a defensive pass so body link/code popover actions also require their owning inline plugin commands:
  - link body actions require `link:edit`
  - code body actions require `mark:code`
- Existing body markdown paste already uses `registry.markdownShortcuts`, so Phase 7 block shortcut ownership applies inside annotation bodies.

Issues/workarounds:

- Annotation body command implementations remain in `annotations.ts` and editor-local body components. Moving them into plugin command handlers still needs a richer command context for body focus, retained selection restoration, inline dependency checks, and editor-local popover services.
- The prop name `isToolbarCommandAvailable` remains misleading for body components because it now checks the full command availability set.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/blockCommands.test.ts src/block-editor/plugins/annotations.test.ts` passed.

### Slice 9: Clipboard And Rich Paste

- Added `annotations?: boolean` to clipboard inline feature filtering.
- Annotation clipboard marks are now exported/imported only when annotation inline features are enabled.
- Rich clipboard filtering now drops annotation body payloads when annotations are disabled.
- Annotation collection short-circuits when annotations are unavailable, preventing copied body payloads from being generated.
- Added focused clipboard coverage for stripping annotation refs and body payloads without mutating the source payload.

Issues/workarounds:

- Clipboard hooks are still not executed as plugin callbacks. This follows the Phase 7 pattern: a registry-derived feature set drives central clipboard filtering until plugin-specific clipboard hook APIs are narrower.
- `serializeSelectionToClipboardPayload` still uses the legacy full-feature virtual-parent config internally. Annotation collection is disabled by the inline feature flag when annotations are unavailable, but a deeper registry-backed clipboard materialization pass remains a cleanup item.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/clipboard.test.ts examples/block-rich-text/src/clipboard.test.ts` passed.

### Slice 10: Example Import/Export And Public Compatibility

- Audited public exports:
  - `annotationsPlugin` is exported through `plugins/index.ts` and `block-editor/index.ts`.
  - `richTextVirtualParentsFromRegistry` is exported through `editorCrdtConfig.ts` and `block-editor/index.ts`.
  - existing `annotationVirtualParents` remains exported as the legacy full-feature helper.
- Kept example import/export/history paths on the existing legacy helper for now.
- Verified that example callers using `legacyRichTextPlugins` continue to load and round-trip annotations.

Issues/workarounds:

- The examples still call `annotationVirtualParents` directly in many structural assertions and document format helpers. Keeping that wrapper avoids mixing Phase 8 annotation extraction with table/columns/slides migration.
- Plugin-aware example document import/export is deferred. The example app currently runs as a full-feature editor through `legacyRichTextPlugins`.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts` passed.
- `npm run typecheck:examples` passed.

### Slice 11: Cleanup And Documentation

- Confirmed `annotationsPlugin` is exported through the public block editor plugin exports.
- Confirmed `legacyRichTextUiPlugin` no longer declares annotation toolbar items.
- Confirmed annotation CRDT behavior is owned by `annotationsPlugin`.
- Confirmed table virtual parents now live in `legacyStructuralCrdtPlugin`, not the annotations plugin.
- Kept `annotationVirtualParents` as a public compatibility wrapper for examples and structural command tests.
- Left unrelated pre-existing task-file changes untouched.

Issues/workarounds:

- Generic destination renderer execution remains deferred; annotation destination renderer contributions are ownership/gating declarations.
- Generic plugin command handlers remain deferred for body editing, resolve, and create flows because command context still lacks body focus and editor-local service APIs.
- Clipboard annotation behavior is registry-feature filtered centrally rather than owned by plugin clipboard hooks.
- Many structural command paths still use `annotationVirtualParents` as the legacy full-feature virtual-parent helper. Migrating those should happen with the table/selection structural phases.
- `examples/block-rich-text/src/App.test.tsx` still has the known Mermaid preview failures from earlier phases; the broader non-App annotation/import/export tests pass.

Verification:

- `npm exec vitest -- run src/block-editor` passed.
- `npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts` passed.
- `npm run typecheck` passed.

### Slice 5: Destination Renderer Ownership And Gating

- Added registry-derived annotation destination feature detection for:
  - `annotations.sidebar`
  - `annotations.footer`
  - `annotations.floating`
- Gated existing `AnnotationSidebar`, `Footnotes`, and `FloatingAnnotationPopover` rendering on those destination declarations.
- Suppressed selected popover id derivation when the floating annotation destination is unavailable.
- Kept existing central React components as the implementation; plugin destination renderers remain ownership declarations for now.

Issues/workarounds:

- Generic destination renderer execution is still deferred. The editor now respects plugin destination ownership, but does not yet call arbitrary renderer callbacks to build those areas.
- The popover controller hook still initializes even if the floating destination is unavailable. Selected popover ids are empty in that case; fully moving the controller boundary is left for the popover-controller slice.

Verification:

- `npm run typecheck` passed.
- `npm exec vitest -- run src/block-editor/plugins/annotations.test.ts examples/block-rich-text/src/annotations.test.ts` passed.
