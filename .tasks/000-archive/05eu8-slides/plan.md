# Plan: Slide Deck Block Type

## Decisions From Research

- Add two real block metadata types: `slide_deck` and `slide`.
- A deck block's text is the deck title.
- A slide block's text is the slide title.
- Direct visible `slide` children under a deck are the deck's slides.
- Non-slide direct children under a deck are rendered only in outline mode.
- Existing children are not rearranged when converting a block to a slide deck.
- `slide` is available as a normal block type outside a deck.
- An orphaned slide block has local UI state to toggle between view and outline modes.
- Slide deck and slide config are collaborative document data.
- Presentation mode, current slide, full-screen state, and orphan-slide view/outline mode are local UI-only state.
- Deck sizing uses `width` and `height` metadata as the source of truth. Do not keep a separate aspect-ratio field.
- Slide background color is a free hex string for now.
- Slide transitions are collaborative metadata with values like `none | fade | slide`.
- Slide numbering counts only visible `slide` children.
- Hidden slide titles are hidden in presentation/overview/view modes. They remain directly editable in outline mode.
- Presentation mode should support in-editor one-slide view and browser full-screen presentation.
- Slide body content allows any block type: tables, kanban boards, images, previews, math, annotations, etc.
- In presentation mode, footnotes render at the bottom of the slide and comments are hidden.
- Deck footer uses live deck title text.

## Phase 1: Metadata And Schema

Goal: introduce durable slide deck and slide block metadata everywhere the rich-text example validates or switches on block types.

Files likely involved:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockEditorTypes.ts`
- `examples/block-rich-text/src/blockTypeHelpers.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/history.test.ts`

Work:

1. Add metadata types and defaults in `blockMeta.ts`.
   - Add `SlideTransition = 'none' | 'fade' | 'slide'`.
   - Add deck footer mode, probably:

     ```ts
     export type SlideDeckFooterMode =
         | 'none'
         | 'deck-title'
         | 'slide-number'
         | 'deck-title-and-slide-number';
     ```

   - Add:

     ```ts
     | {
           type: 'slide_deck';
           width: number;
           height: number;
           footer: SlideDeckFooterMode;
           ts: HLC;
       }
     | {
           type: 'slide';
           showTitle: boolean;
           backgroundColor: string;
           transition: SlideTransition;
           ts: HLC;
       }
     ```

   - Add helpers:
     - `defaultSlideDeckMeta(ts)`
     - `defaultSlideMeta(ts)`
     - `isSlideDeckBlock(meta)`
     - `isSlideBlock(meta)`
     - hex color validation/normalization helper

2. Update metadata switch statements.
   - `sameTypeWithTs(...)`.
   - `blockTypeMeta(...)`.
   - `blockTypeMenuValue(...)`.
   - Any history/clipboard metadata validators.

3. Add block type menu values.
   - Add `slide-deck`.
   - Add `slide`.
   - Expose both in slash commands.
   - Expose `slide-deck` in the toolbar select.
   - Consider exposing `slide` in the toolbar select too, since orphan slides are supported.

4. Update document import/export.
   - Accept `slide_deck` and `slide`.
   - Add deck meta fields: `width`, `height`, `footer`.
   - Add slide meta fields: `showTitle`, `backgroundColor`, `transition`.
   - Validate positive integer-ish `width`/`height`.
   - Validate hex colors, initially `#rgb` or `#rrggbb`.
   - Validate transition and footer enum values.
   - Export metadata in the same shape.

5. Add tests.
   - Import/export round trips a deck with slides and nested body content.
   - Import/export round trips an orphan slide.
   - Invalid color, dimensions, footer, and transition fail with useful `DocumentFormatError`s.
   - History/clipboard validation accepts the new metadata.

Acceptance:

- The app compiles with `slide_deck` and `slide` in the metadata union.
- JSON import/export preserves deck title, slide title, metadata, nested slide body blocks, marks, and annotations.
- Invalid slide/deck metadata is rejected at document import boundaries.

## Phase 2: Command Layer

Goal: add commands that create and update decks/slides without disturbing existing children.

Files likely involved:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/slashCommands.tsx`
- `examples/block-rich-text/src/Toolbar.tsx`
- `examples/block-rich-text/src/EditorApp.tsx`

Work:

1. Add tree helpers.
   - `slideChildren(state, deckId)` returns direct visible children whose metadata is `slide`.
   - `isSlideChildOfDeck(state, slideId)`.
   - `slideDeckForSlide(state, slideId)` if useful for UI/commands.
   - Use existing `visibleBlockChildren(...)` and `materializedBlockParent(...)` patterns.

2. Add conversion commands.
   - `convertBlockToSlideDeck(state, selection, context)`.
     - No-op if focused block is already `slide_deck`.
     - Set focused block meta to default deck meta.
     - Do not convert, move, wrap, or delete existing children.
     - If it has no visible children, create one default `slide` child.
     - Return selection in the first slide title when a slide is created, otherwise keep focus on the deck title.
   - `convertBlockToSlide(state, selection, context)`.
     - No-op if already `slide`.
     - Set focused block meta to default slide meta.
     - Preserve text and children.

3. Add deck-specific slide creation.
   - `addSlide(state, deckId, context, position?)`.
   - Insert a `slide` child under the deck.
   - Position defaults to after the current slide or at the end.
   - Return caret in the new slide title.

4. Add metadata update commands.
   - Reuse `setBlockMeta(...)` where enough.
   - Add small typed helpers for deck dimensions/footer and slide show-title/background/transition to keep UI handlers simple.

5. Wire slash/toolbar commands.
   - `/slide deck` calls deck conversion.
   - `/slide` calls slide conversion.
   - Toolbar block type select handles `slide-deck` and `slide`.

6. Add tests.
   - Converting an empty block to a deck creates one default slide.
   - Converting a block with existing children does not rearrange children.
   - Existing non-slide children under a deck remain present.
   - Converting a normal block to slide preserves text and children.
   - Adding a slide appends or inserts in the correct order.
   - Slide numbering helper counts only visible slide children.

Acceptance:

- Users can create slide decks and slides through existing command entry points.
- Command behavior is deterministic and does not perform hidden outline rewrites.

## Phase 3: Render Tree And UI-Only State

Goal: render slide decks and orphan slides with local mode state while preserving normal editable block selection behavior.

Files likely involved:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/editorAppUtils.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

Work:

1. Add local UI state in `BlockEditor`.
   - Use parent-level maps keyed by block id:

     ```ts
     type SlideDeckDisplayMode = 'presentation' | 'overview' | 'outline';
     type OrphanSlideDisplayMode = 'view' | 'outline';

     type SlideDeckUiState = {
         mode: SlideDeckDisplayMode;
         currentSlideId: string | null;
         fullScreen: boolean;
     };
     ```

   - Keep current slide strictly local.
   - Clamp `currentSlideId` to a visible slide after edits/deletes.

2. Add render entry points.
   - In `renderBlockNode(...)`, special-case `slide_deck`.
   - Special-case orphan `slide` blocks when not rendered as a child of a deck.
   - Pass mode state and setters through `RenderBlockContext` or a small slide-specific context object.

3. Implement `SlideDeckBlock`.
   - Always render deck title controls outside the slide viewport.
   - Mode controls: presentation, overview, outline.
   - Add slide button.
   - Full-screen button for presentation mode.
   - Derive visible slides from direct children with `meta.type === 'slide'`.
   - Outline mode:
     - Render deck title.
     - Render all children with normal nested block rendering, including non-slide children.
   - Overview mode:
     - Render deck title and controls.
     - Render only visible slide children as stacked slide viewports.
     - Do not render non-slide direct children.
   - Presentation mode:
     - Render deck title and controls.
     - Render only the current visible slide.
     - Add previous/next slide controls and keyboard navigation.
     - Do not render non-slide direct children.

4. Implement `SlideBlockView`.
   - Use deck `width` and `height` for aspect ratio via CSS, not a separate aspect-ratio field.
   - Apply slide `backgroundColor`.
   - Show slide title only when `showTitle` is true.
   - Render children centered in the slide viewport.
   - Render footer according to deck footer mode.
   - Footer slide number uses only visible slide children.
   - Render footnotes at the bottom of the slide in presentation mode.
   - Hide comments/comment sidebar triggers inside presentation mode where practical.

5. Implement `OrphanSlideBlock`.
   - Local view/outline toggle.
   - View mode renders a single slide viewport using a default standalone size or the slide viewport's parent width.
   - Outline mode renders the slide title and children normally.

6. Preserve selection mechanics.
   - Deck title, slide title, and slide body blocks should keep using `renderEditableBlock(...)`.
   - Avoid wrapping editable surfaces in elements that interfere with `data-block-id` selection lookup.
   - Ensure hidden titles are genuinely hidden in view/presentation modes and editable in outline mode.

Acceptance:

- A deck can switch between presentation, overview, and outline without CRDT ops.
- Orphan slides can switch between view and outline without CRDT ops.
- Selection and text editing still work in deck title, visible slide titles, and body blocks.
- Non-slide direct deck children appear in outline mode only.

## Phase 4: Styling And Presentation Experience

Goal: make slides usable as a visual presentation surface, including full-screen mode.

Files likely involved:

- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/editorUiUtils.ts`

Work:

1. Add layout CSS.
   - `.slideDeckBlock`
   - `.slideDeckToolbar`
   - `.slideViewport`
   - `.slideSurface`
   - `.slideTitle`
   - `.slideBody`
   - `.slideFooter`
   - `.slideOverview`
   - `.slidePresentation`
   - `.orphanSlideBlock`

2. Size slides from `width` and `height`.
   - Use CSS custom properties like `--slide-width` and `--slide-height`.
   - Use `aspect-ratio: var(--slide-width) / var(--slide-height)`.
   - Constrain viewport width responsively.
   - Scale contents with normal responsive CSS first; avoid transform-scaling editable text unless unavoidable because it can complicate caret/selection geometry.

3. Add full-screen behavior.
   - Use the Fullscreen API from the deck presentation container.
   - Track full-screen state locally and clean it up on `fullscreenchange`.
   - Full-screen presentation should preserve local current slide and keyboard navigation.
   - Provide an exit button in full-screen mode.

4. Add keyboard navigation.
   - In presentation mode:
     - ArrowRight/PageDown/Space moves next slide when not editing text.
     - ArrowLeft/PageUp moves previous slide when not editing text.
     - Escape exits full-screen or leaves presentation mode depending on focus/state.
   - Avoid stealing keys from focused contentEditable surfaces.

5. Add transitions.
   - Store transition on each slide.
   - Initial implementation can apply simple CSS classes for `fade` and `slide`.
   - `none` should avoid animation.
   - Do not animate in outline mode.

Acceptance:

- Slides keep the requested deck ratio on desktop and mobile.
- Full-screen presentation works and exits cleanly.
- Keyboard navigation works outside active editable fields.
- Transition metadata has visible presentation behavior.

## Phase 5: Boundary Editing And Drag/Drop

Goal: make slide/deck boundaries predictable during normal editor operations.

Files likely involved:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/blockDropTargets.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

Work:

1. Handle Enter at slide titles.
   - In outline mode, normal split behavior is acceptable.
   - In presentation/overview mode, plain Enter on a slide title should create a new slide after the current slide.
   - Provide a path to add a first body block when a slide has no body blocks.

2. Handle Backspace/Delete at boundaries.
   - Prevent surprising joins that merge slide body text into hidden/non-visible slide titles in presentation/overview modes.
   - Preserve normal behavior in outline mode where the full structure is visible.
   - Add focused tests before broad changes.

3. Review Tab/Shift-Tab behavior.
   - Body blocks can indent/unindent normally.
   - Avoid moving a slide block under a previous slide's body accidentally from presentation/overview modes.

4. Drag and drop.
   - Basic slide reordering can use generic block drag if slide row registration works.
   - Test moving slides within a deck and between decks.
   - Test moving body blocks into and out of slides.
   - Prevent moving a deck into one of its slides, relying on existing descendant checks where possible.
   - Decide after testing whether deck-specific drop slots are needed for empty decks or end-of-deck slide insertion.

5. Multi-selection.
   - Ensure block selection of multiple slides moves selected slide roots in visible order.
   - Ensure deck outline mode remains the reliable escape hatch for complex rearrangements.

Acceptance:

- Editing in presentation/overview does not accidentally corrupt deck structure.
- Outline mode remains a faithful editable representation of every child.
- Basic slide reorder and body block moves work.

## Phase 6: Footnotes, Comments, And Nested Content

Goal: make existing rich-text features behave acceptably inside slides.

Files likely involved:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/useAnnotationPopoverController.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/annotations.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

Work:

1. Footnotes in presentation mode.
   - Derive footnotes whose anchor ranges are inside the current slide subtree.
   - Render them at the bottom of the slide surface.
   - Numbering should be slide-local in presentation mode unless existing global numbering is simpler for the first slice.
   - Keep normal document footnotes outside the slide deck in outline mode.

2. Comments in presentation mode.
   - Hide sidebar comments and comment anchors for slide content in presentation mode.
   - Keep comments available in outline mode.
   - Ensure hidden comments do not leave hover/focus popovers stranded.

3. Nested content compatibility.
   - Tables, kanban boards, images, previews, math, and code previews should render inside slide bodies.
   - Add CSS constraints so nested wide content does not break the slide viewport.
   - Start with overflow handling before custom layout logic.

Acceptance:

- Footnotes tied to current slide content are visible at the bottom of that slide in presentation mode.
- Comments are hidden in presentation mode and return in outline mode.
- Common nested block types render without destroying the slide layout.

## Phase 7: Persistence Fixtures And Regression Tests

Goal: lock in the intended behavior and make the feature safe to iterate on.

Files likely involved:

- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/documentFixtures.test.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/clipboard.test.ts`

Work:

1. Add fixtures.
   - Simple deck with one slide.
   - Deck with several slides and footer numbering.
   - Deck with non-slide direct children.
   - Orphan slide.
   - Slide with nested table/kanban/image/footnote/comment content.

2. Add command tests.
   - Creation/conversion.
   - Add slide.
   - Slide metadata updates.
   - Deck metadata updates.
   - Boundary editing.

3. Add format tests.
   - Import/export fixtures.
   - Clipboard round trip for a whole deck.
   - Clipboard round trip for one slide.

4. Add UI tests.
   - Mode switching is local and does not create ops.
   - Current slide navigation clamps after slide deletion.
   - Hidden title behavior.
   - Full-screen state cleanup can be unit-tested around event handling where jsdom allows it; otherwise keep this as manual QA.

Acceptance:

- `npm exec vitest -- run` for relevant block-rich-text test files passes.
- Fixtures document the intended JSON shape and visual behavior.

## Phase 8: Manual QA

Goal: verify browser behavior that unit tests cannot cover well.

Work:

1. Start the example app.
2. Create a deck from toolbar and slash command.
3. Add slides, edit titles, hide a title, change background color, change transitions.
4. Add nested rich content to a slide: paragraph, list, image, table/kanban, math, footnote, comment.
5. Switch modes repeatedly.
6. Enter full-screen presentation, navigate slides, and exit.
7. Reorder slides and confirm footer numbering updates.
8. Verify non-slide direct children show only in outline mode.
9. Verify an orphan slide can toggle view/outline.
10. Check desktop and mobile viewport screenshots for overlap, text clipping, and broken selection/caret positioning.

Acceptance:

- The feature is usable in the browser without layout breakage.
- Full-screen behavior works in a real browser.
- No obvious selection/caret regressions while editing visible slide content.
