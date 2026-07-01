# Plan 1.8: Annotation Destination Renderer Extraction

## Goal

Move annotation destination rendering and annotation body editing out of
`BlockRichTextEditor.tsx` and into the annotations plugin, while preserving current behavior for:

- comment sidebar open/collapsed state;
- sidebar gutter markers and body focus;
- footnote list rendering and numbering;
- floating popover positioning, nesting, hover/focus pinning, and Escape handling;
- annotation body rich-text editing;
- body selection retention for toolbar commands;
- link/code hover and edit popovers inside annotation bodies;
- annotation body copy/cut/paste behavior;
- annotation resolve from the sidebar;
- inline annotation trigger behavior used by floating popovers.

This plan continues `plan-1.md` phase 8. It assumes block renderer extraction has already added
registry destination dispatch primitives, but it does not require command handler extraction or
clipboard ownership to be complete.

## Current Annotation Ownership

`annotationsPlugin` declares annotation compatibility and placeholder destination renderers in
`src/block-editor/plugins/annotations.ts`:

- `annotations.sidebar`
- `annotations.footer`
- `annotations.floating`

The actual UI and editing behavior still lives centrally in `BlockRichTextEditor.tsx`:

- `AnnotationSidebar`
- `Footnotes`
- `FloatingAnnotationPopover`
- `AnnotationBodyBlock`
- `annotationBodyMarker`
- destination mounting branches gated by `annotationDestinationFeatures`
- body command bridge `runAnnotationBodyCommand`
- body focus helpers `requestCommentFocus`, `focusBodyBlockForAnnotation`, and
  `recordCommentBodyActivity`
- active body selection tracking through `activeAnnotationBodySelection`
- popover wiring through `useAnnotationPopoverController`

Some annotation selectors are already reusable in `src/block-editor/annotations.ts`:

- `RenderedAnnotation`
- `renderedAnnotations`
- `renderedAnnotationsByPresentation`
- `renderedAnnotationMapById`
- `popoverTextByAnnotationId`
- `footnoteNumberByAnnotationId`
- `annotationBodyBlockIds`
- `annotationVirtualParents`

The current `BlockEditorAnnotationRenderServices` type in `src/block-editor/plugins/types.ts` is
still `Record<string, unknown>`, so the plugin cannot safely own real annotation rendering yet.

## Design Targets

- `annotationsPlugin.destinationRenderers` owns real sidebar, footer, and floating destination
  rendering.
- Core owns only destination host placement and the construction of annotation render services.
- Annotation body editing moves with the annotation renderer because it is specific to annotation
  destinations, even though it still calls central command helpers during this phase.
- The render services should be typed public APIs, not a loose bag of component-local callbacks.
- Command implementations remain centrally bridged until section 2 command extraction.
- Clipboard implementation remains central until section 3 clipboard ownership.
- Inline mark rendering can stay on the existing central inline path until `plan-1.md` phase 9,
  except for the event callbacks needed by annotation body editors and floating popover triggers.

## Phase A: Define Annotation Render Service Types

Replace `BlockEditorAnnotationRenderServices = Record<string, unknown>` in
`src/block-editor/plugins/types.ts` with a typed service namespace.

Add or export data types for:

- `BlockEditorAnnotationFocusRequest`
  - `{blockId: string; token: number; selection?: EditorSelection}`
- `BlockEditorRenderedAnnotation`
  - alias or re-export of `RenderedAnnotation` from `annotations.ts`
- `BlockEditorAnnotationBodyBlock`
  - the `RenderedAnnotation['bodyBlocks'][number]` shape
- `BlockEditorAnnotationPopover`
  - alias of `ActivePopover` from `useAnnotationPopoverController`
- `BlockEditorAnnotationPopoverPointerTransition`
  - alias of `PopoverPointerTransition`

Add read/state services:

- `all(): readonly RenderedAnnotation[]`
- `byPresentation(presentation): readonly RenderedAnnotation[]`
- `byId(id): RenderedAnnotation | null`
- `popoverTextById(): ReadonlyMap<string, string>`
- `footnoteNumberById(): ReadonlyMap<string, number>`
- `sidebarOpen(): boolean`
- `gutterTops(): Readonly<Record<string, number>>`
- `focusRequest(): BlockEditorAnnotationFocusRequest | null`
- `activePopovers(): readonly ActivePopover[]`
- `popoverAnnotation(id): RenderedAnnotation | null`
- `visibleBodyBlockIds(): ReadonlySet<string>`

Add mutation/event services:

- `setSidebarOpen(open: boolean): void`
- `focusAnnotation(annotation): void`
- `focusBodyBlock(annotation): string`
- `requestBodyFocus(blockId, selection?): void`
- `markFocusRequestHandled(): void`
- `recordBodyActivity(annotationId, bodyBlockId): void`
- `setActiveBodySelection(selection): void`
- `resolve(annotation): void`
- `isToolbarCommandAvailable(commandId): boolean`

Add body command bridge services:

- `runBodyCommand(command): void`
- `dispatch(command): void`

The bridge can keep its current function-command shape for this phase:

```ts
runBodyCommand(
    command: (current: Replica, context: ReturnType<typeof makeCommandContext>) => CommandResult,
): void
```

If exposing `Replica` or `makeCommandContext` through plugin public types feels too central, create
a transitional `BlockEditorAnnotationBodyMutation` type in `BlockRichTextEditor.tsx` and document it
as internal. Do not generalize command APIs prematurely; section 2 owns that.

Add floating popover services:

- `showPopover(id, element): void`
- `schedulePopoverHide(id?, transition?): void`
- `cancelPopoverHide(): void`
- `setPopoverFocusPinned(focused, id?, relatedTarget?): void`
- `closeDeepestPopover(): void`

Add annotation body inline/editor services:

- `inlineRenderFeatures(): InlineRenderFeatures`
- `registry(): BlockEditorRegistry<RichBlockMeta>`
- `rainbowLamportIds(): boolean`
- `onInputMeasured(label, ms): void`
- `onDisplayInputRenderStarted(label, started): void`

Expected result:

- `BlockEditorDestinationRenderContext['annotations']` is fully typed.
- Annotation destination renderers no longer need component-local prop bags from
  `BlockRichTextEditor.tsx`.

## Phase B: Normalize Annotation Data Boundaries

Make `src/block-editor/annotations.ts` the shared annotation data boundary.

Work items:

- Import `RenderedAnnotation` directly from `annotations.ts` wherever possible.
- Delete the local `type RenderedAnnotation = ReturnType<typeof renderedAnnotations>[number]` from
  `BlockRichTextEditor.tsx`.
- Move `CommentFocusRequest` to a public or internal annotation render type.
- Keep selector functions in `annotations.ts`; do not duplicate destination filtering in the plugin
  renderer.
- Keep `annotationVirtualParents` in `annotations.ts` because annotation body blocks are virtual
  children of annotation ids.

Expected result:

- The renderer module can consume annotations without importing `BlockRichTextEditor.tsx`.
- Existing `plugins/annotations.test.ts` selector coverage remains valid.

## Phase C: Add Plugin-Owned Annotation Renderer Module

Create `src/block-editor/plugins/annotationRenderer.tsx`.

Move these components into it:

- `AnnotationSidebar`
- `Footnotes`
- `FloatingAnnotationPopover`
- `AnnotationBodyBlock`
- `annotationBodyMarker`

Recommended exports:

- `renderAnnotationSidebar(context)`
- `renderAnnotationFooter(context)`
- `renderAnnotationFloating(context)`
- `AnnotationBodyBlock`
- `annotationBodyMarker`

The renderer functions should read from `context.annotations` instead of accepting large prop lists.
For example:

- sidebar renderer reads `byPresentation('sidebar')`, `sidebarOpen()`, `gutterTops()`, and body
  editor services;
- footer renderer reads `byPresentation('footnote')` and footnote numbering services;
- floating renderer maps `activePopovers()` to popover panels and resolves each annotation through
  `popoverAnnotation(popover.id)`.

Expected result:

- The annotation plugin has a real renderer module.
- The central editor no longer contains annotation destination component definitions.

## Phase D: Wire Real Destination Renderers

Update `src/block-editor/plugins/annotations.ts` so `destinationRenderers` call the new renderer
functions:

- `annotations.sidebar` renders `renderAnnotationSidebar(context)`
- `annotations.footer` renders `renderAnnotationFooter(context)`
- `annotations.floating` renders `renderAnnotationFloating(context)`

Keep the renderer ids and destinations unchanged so registry ordering and existing tests remain
stable.

Update `src/block-editor/plugins/annotations.test.ts`:

- assert the destination renderer ids are unchanged;
- assert each destination renderer returns a non-placeholder result when given a minimal valid
  annotation render context;
- keep compatibility, toolbar, command, CRDT hook, and selector assertions.

Expected result:

- `annotationsPlugin` owns destination rendering execution, not just declarations.

## Phase E: Replace Central Destination Branches With Registry Dispatch

Replace the central branches in `BlockRichTextEditor.tsx`:

- `annotationDestinationFeatures.footer ? <Footnotes ... /> : null`
- `annotationDestinationFeatures.sidebar ? <AnnotationSidebar ... /> : null`
- `annotationDestinationFeatures.floating ? activePopovers.map(...) : null`

with destination dispatch through `registry.destinationRenderers`.

Recommended core helpers:

- `renderDestination('footer')`
- `renderDestination('sidebar')`
- `renderDestination('floating')`

Each helper should:

- read all renderers registered for the destination;
- call each renderer with a `BlockEditorDestinationRenderContext`;
- preserve registry order;
- return `null` when no renderer contributes UI.

Core still chooses where the destination host is mounted:

- footer remains inside the editor content frame after document blocks;
- sidebar remains alongside the editor content;
- floating remains at the outer editor level so absolute positioning behaves as it does today.

Expected result:

- Core hosts destination regions but does not know which annotation UI component renders inside
  them.

## Phase F: Move Annotation Body Editing Internals

Move `AnnotationBodyBlock` with its local behavior intact, then tighten dependencies.

Behavior to preserve:

- local body selection state;
- pending caret/range restore after edits;
- focus request handling from sidebar/footer/floating destinations;
- activity tracking for last-edited body block;
- `RichTextEditableSurface` usage;
- body copy/cut/paste;
- markdown shortcut handling;
- inline mark toggles from annotation body commands;
- body link popover and link hover popover;
- body code popover and code hover popover;
- pending/retained code mark behavior;
- fallback text for empty footnote/popover bodies;
- body marker rendering.

Dependency cleanup order:

1. Move the component unchanged and import existing helpers from central modules.
2. Replace prop threading with `context.annotations` services.
3. Move any annotation-specific helper that has no central callers into
   `plugins/annotationRenderer.tsx`.
4. Leave shared editor helpers in their current modules if moving them would cause unrelated churn.

Expected result:

- Annotation body editing is plugin-owned at the renderer level.
- Body command execution still uses the central bridge until command extraction.

## Phase G: Build The Annotation Service Bridge In Core

Add a `useMemo` or stable factory in `BlockRichTextEditor.tsx` that creates the typed
`annotations` render services from current component state.

Inputs should include:

- `replica.state`
- `annotations`
- `sidebarAnnotations`
- `popoverAnnotationsById`
- `popoverTextById`
- `footnoteNumberById`
- `blocksWithAnnotationBodies`
- `commentsOpen`
- `commentGutterTops`
- `commentFocusRequest`
- `activePopovers`
- `rainbowLamportIds`
- `inlineRenderFeatures`
- `registry`
- `isToolbarCommandAvailable`
- `runAnnotationBodyCommand`
- `requestCommentFocus`
- `focusBodyBlockForAnnotation`
- `recordCommentBodyActivity`
- `setActiveAnnotationBodySelection`
- `setCommentsOpen`
- `setCommentFocusRequest`
- `showPopover`
- `schedulePopoverHideFromPointer`
- `cancelPopoverHide`
- `setPopoverFocusPinned`
- `closeDeepestPopover`
- measurement callbacks

Keep the bridge narrow enough that annotation renderers are not handed unrelated editor internals.

Expected result:

- Annotation services are constructed once in core and passed through destination contexts.
- Future command extraction can replace service implementations without rewriting JSX.

## Phase H: Keep Inline Annotation Rendering Stable

Do not attempt full inline renderer dispatch in this phase.

Work items:

- Keep existing central inline rendering behavior for annotation marks.
- Keep `showPopover` and `schedulePopoverHideFromPointer` available through annotation services for
  body editors that render nested annotation triggers.
- Ensure `popoverTextById` and `footnoteNumberById` continue to flow to all editable surfaces.

Expected result:

- Floating annotation popovers keep opening from inline annotation triggers.
- Phase 9 can later move link/code/math/date/annotation inline behavior behind inline renderer
  contributions.

## Phase I: Remove Central Annotation UI Definitions

After destination dispatch works, remove the central annotation UI code from
`BlockRichTextEditor.tsx`:

- delete `AnnotationSidebar`;
- delete `Footnotes`;
- delete `FloatingAnnotationPopover`;
- delete `AnnotationBodyBlock`;
- delete `annotationBodyMarker` if all callers moved;
- delete now-unused annotation prop types and imports.

Keep central annotation state and command bridges only where they are still genuinely editor-shell
responsibilities.

Expected result:

- `BlockRichTextEditor.tsx` owns annotation state integration and destination hosting, but no
  annotation UI component implementations.

## Phase J: Tests And Verification

Run typecheck:

- `npm exec tsc -- --noEmit`

Run focused plugin and registry tests:

- `npm exec vitest -- src/block-editor/plugins/annotations.test.ts`
- `npm exec vitest -- src/block-editor/plugins/registry.test.ts`
- `npm exec vitest -- src/block-editor/defaultBlockEditorPlugins.test.ts`
- `npm exec vitest -- src/block-editor/editorCrdtConfig.test.ts`

Run behavior-adjacent tests:

- `npm exec vitest -- src/block-editor/clipboard.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts`

Manual smoke areas:

- create sidebar comment, type in body, close/open sidebar, verify focus returns to body;
- resolve sidebar comment;
- create footnote, type in body, verify numbering remains stable;
- create floating popover, hover trigger, move between nested trigger and panel, verify it stays
  open while hovered/focused and closes when expected;
- press Escape in a floating popover and verify deepest popover closes;
- copy/paste text inside annotation body;
- use link and code popovers inside annotation bodies;
- verify main editor toolbar commands still target active annotation body selection.

## Risks

- Annotation body editing is effectively a nested editor. Moving it exposes many implicit
  dependencies on central editor state, inline render feature flags, and command helpers.
- Floating popover lifecycle is easy to regress because hover, focus, selection, nested popovers,
  and delayed hide timers interact.
- Body selection tracking drives main toolbar state. A stale `activeAnnotationBodySelection` can
  make toolbar commands apply to the wrong surface.
- Body clipboard behavior is still central and feature-aware. Keep it working here, but avoid
  solving section 3 clipboard ownership during this phase.
- Command handlers are still central. The renderer services should make that dependency explicit so
  section 2 can replace it later.
- Annotation body virtual parents must continue to be passed to CRDT/materialization helpers.

## Open Questions

- Should `BlockEditorAnnotationRenderServices` expose raw maps (`popoverTextById`,
  `footnoteNumberById`) or accessor methods only? Accessors are cleaner public API; maps are less
  churn for the move.
    - maps is good for now
- Should floating destination render one aggregate renderer or one renderer invocation per active
  popover? Aggregate rendering matches the current component and keeps nested popover ordering in
  the plugin.
    - aggregate sounds good
- Should `AnnotationBodyBlock` be public from the annotations plugin, or kept internal to
  `annotationRenderer.tsx` until command and clipboard ownership settle?
     - public
- Should the transitional body command bridge be typed in plugin public APIs, or kept in an
  internal `annotationRenderer` prop/service type to avoid exposing `Replica` and
  `makeCommandContext`?
     - no opinion

## Completion Criteria

Phase 8 is complete when:

- `annotationsPlugin.destinationRenderers` call real renderer functions.
- `BlockRichTextEditor.tsx` no longer defines annotation destination or body editor components.
- Core destination hosts dispatch through registry renderers for sidebar, footer, and floating
  regions.
- Annotation render services are typed and documented enough for future command extraction.
- Existing annotation selector, compatibility, clipboard, and command-adjacent tests pass.
- Any remaining central bridges are explicitly limited to command execution, clipboard behavior, or
  inline renderer extraction planned for later phases.
