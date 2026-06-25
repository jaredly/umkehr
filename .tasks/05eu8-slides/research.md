# Research: Slide Deck Block Type

## Goal

Add a slide deck block type to `examples/block-rich-text`.

Proposed model from the task:

- A slide deck is a block whose direct visible children are slides.
- The deck block's text is the deck title.
- Each slide is also a block type.
- A slide block's text is the slide title.
- A slide's children make up the visible slide body.
- Slide metadata stores presentation config such as title visibility, background color, and transition animation.
- Deck metadata stores deck-level config such as aspect ratio, resolution, and possibly footer behavior.
- Rendering has UI-only display modes:
  - presentation: one slide at a time
  - overview: all slides rendered in a vertical list
  - outline: normal document-like block rendering

## Current State

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockEditorTypes.ts`
- `examples/block-rich-text/src/blockTypeHelpers.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/Toolbar.tsx`
- `examples/block-rich-text/src/slashCommands.tsx`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/*test.ts`
- `src/block-crdt/types.ts`

The CRDT core is already generic enough for this shape. Blocks have app-defined metadata and stable parent/child order. `RichBlockMeta` is an example-layer union in `blockMeta.ts`, not a core CRDT concept. The core `Block<M>` only requires metadata to be timestamped (`TimestampedBlockMeta`), and `Op<M>` already has `block:meta`, `block:move`, `block:delete`, char ops, split records, and join records.

The closest existing precedent is `kanban`, which is already implemented in this branch:

- `RichBlockMeta` includes `{type: 'kanban'; ts: HLC}`.
- `BlockTypeMenuValue` includes `kanban`.
- `convertBlockToKanban(...)` changes the focused block to `kanban` and creates default child columns.
- `renderBlockNode(...)` special-cases `meta.type === 'kanban'` and renders a dedicated `KanbanBlock`.
- `documentFormat.ts` imports and exports nested kanban blocks through the same generic `children` array used by every block type.

That precedent is very close to the slide deck request. The main difference is that slides themselves need typed metadata, while kanban columns/cards currently derive role entirely from ancestry and can remain ordinary paragraph blocks.

## Data Model

Add two metadata variants:

```ts
export type SlideTransition = 'none' | 'fade' | 'slide' | 'zoom';

export type SlideDeckFooterMode = 'none' | 'deck-title' | 'slide-number' | 'deck-title-and-slide-number';

export type SlideDeckAspectRatio = '16:9' | '4:3' | '1:1' | 'custom';

type SlideDeckMeta = {
    type: 'slide_deck';
    aspectRatio: SlideDeckAspectRatio;
    width: number;
    height: number;
    footer: SlideDeckFooterMode;
    ts: HLC;
};

type SlideMeta = {
    type: 'slide';
    showTitle: boolean;
    backgroundColor: string;
    transition: SlideTransition;
    ts: HLC;
};
```

The exact names can change, but the important point is that deck-level and slide-level config should live in block metadata. That keeps config collaborative and history/undo-visible in the same way todo checked state, image size, preview URL, and callout kind are currently collaborative.

Recommended initial defaults:

- Deck: `aspectRatio: '16:9'`, `width: 1920`, `height: 1080`, `footer: 'slide-number'`.
- Slide: `showTitle: true`, `backgroundColor: '#ffffff'`, `transition: 'none'`.

Open modeling issue: `backgroundColor` needs validation. The example can start with a narrow palette or accept CSS hex strings only. Avoid accepting arbitrary CSS values if import/export is expected to be stable and safe.

## Tree Semantics

Recommended semantics:

- `slide_deck` direct visible children with `meta.type === 'slide'` are slides.
- Non-slide direct children under a deck are outline content or malformed deck children.
- A `slide` block's visible children are slide body blocks.
- A `slide` outside a deck should still render/edit as a normal block in outline mode, or be treated as a recoverable malformed block.

This is stricter than kanban. Kanban's columns/cards are ordinary blocks by ancestry; slides should be typed because they carry slide-specific config and controls.

The CRDT should not enforce these invariants. Enforce them in example commands/rendering:

- `convertBlockToSlideDeck(...)` creates slide children with slide metadata.
- "Add slide" inserts a `slide` child under the deck.
- Commands that turn a block into `slide` should be allowed only when useful, probably via a deck-specific control.
- Rendering should recover gracefully if a deck has no slides or has non-slide children.

## Rendering Plan

Add a `SlideDeckBlock` component parallel to `KanbanBlock` and `TableBlock`.

`renderBlockNode(...)` would add:

```tsx
if (meta.type === 'slide_deck') {
    return <SlideDeckBlock key={node.block.id} node={node} context={context} />;
}
```

Inside `SlideDeckBlock`:

- Render the deck title with `renderEditableBlock(node.block, context, ...)`.
- Derive `slides = node.children.filter(child => child.block.block.meta.type === 'slide')`.
- Keep display mode and current slide index in React state keyed by deck id.
- Render mode controls as UI-only state. They should not emit CRDT ops.
- In presentation mode, render one slide viewport using the deck aspect ratio/resolution.
- In overview mode, render all slide viewports stacked vertically.
- In outline mode, render the deck title and children with normal `renderBlockNodeAtRelativeDepth(...)` behavior.

Slide rendering:

- The slide block's editable surface is the title.
- If `showTitle` is false, the title should still be editable somewhere. Options:
  - hide it only inside the slide viewport, but keep it visible in a small editor control/header;
  - make outline mode the place to edit hidden titles;
  - show title on focus/hover in overview and presentation editing modes.
- Child blocks should render centered in the slide viewport. That can reuse normal block rendering with adjusted relative depth and CSS containment.
- Footer rendering should use deck title text and slide index derived from visible slides.

Important DOM detail: selection capture/restoration depends on `data-block-id` editable surfaces. As long as deck title, slide title, and body blocks use `renderEditableBlock(...)`, the existing selection machinery should continue to work.

## Commands And UI

Minimum commands:

- `convertBlockToSlideDeck(state, selection, context)`.
- `addSlide(state, deckId, options, context)`.
- `setSlideMeta(...)` or reuse `updateBlockMetaEverywhere(...)`/`setBlockMeta(...)`.
- `setSlideDeckMeta(...)`.

Suggested conversion behavior:

1. If the focused block is already `slide_deck`, no-op.
2. Change focused block metadata to `slide_deck`, preserving its current text as deck title.
3. If it has no visible children, create one or three default slides.
4. If it has existing children, either:
   - convert direct children to `slide` metadata and preserve their descendants as body content; or
   - create a first slide and move existing children under that slide.

Option 1 is better if converting an outline into slides. Option 2 is safer if the focused block already has a nested document that should become one slide. This needs a product decision.

Toolbar/slash work:

- Add `slide-deck` to `BlockTypeMenuValue`.
- Add toolbar option and slash command.
- Decide whether `slide` appears in the general block type menu. I would not expose it globally at first; slide creation is context-sensitive and should usually happen through deck controls.

Inline controls:

- Extend `BlockInlineControls` for `slide` metadata:
  - show/hide title toggle
  - background color selector
  - transition select
- Extend controls for `slide_deck` metadata:
  - aspect ratio/resolution controls
  - footer mode select

## UI-Only State

Display mode and current slide index should be local UI state, not block metadata:

```ts
type SlideDeckUiState = {
    mode: 'presentation' | 'overview' | 'outline';
    currentSlideId: string | null;
};
```

This can live in `EditorApp` as a map keyed by deck id, or inside each `SlideDeckBlock` if mode/index do not need to survive component unmounts. A parent-level map is more robust because re-rendering the tree or switching replicas should not unnecessarily reset active presentation state.

Do not store mode/current slide in CRDT metadata unless collaborative presentation control is explicitly desired. The task calls this UI-only state, and keeping it local avoids surprising remote edits.

## Import And Export

`documentFormat.ts` needs schema updates:

- Add `slide_deck` and `slide` to accepted block types.
- Extend `DocumentBlockMeta` with:
  - `aspectRatio`
  - `width`
  - `height`
  - `footer`
  - `showTitle`
  - `backgroundColor`
  - `transition`
- Parse and validate those fields.
- Export deck/slide metadata.

Example JSON:

```json
[
  {
    "type": "slide_deck",
    "meta": {"aspectRatio": "16:9", "width": 1920, "height": 1080, "footer": "deck-title-and-slide-number"},
    "content": "Quarterly Review",
    "children": [
      {
        "type": "slide",
        "meta": {"showTitle": true, "backgroundColor": "#ffffff", "transition": "fade"},
        "content": "Highlights",
        "children": [
          {"type": "paragraph", "content": "Revenue grew 18%."}
        ]
      }
    ]
  }
]
```

Clipboard probably works automatically if slide deck/slide metadata are added to the same validation and serialization paths used by document import/export. Tests should confirm this.

## Editing Behavior

First version can lean on existing block behavior:

- Enter in a slide title splits the slide block, which may create a sibling slide or a normal block depending on command logic. This likely needs custom handling.
- Enter in slide body should create another body block.
- Tab/Shift-Tab should indent/unindent body blocks normally, but probably should not accidentally move a slide title under a previous slide body.
- Backspace at the start of the first body block should not unexpectedly join body text into the slide title unless that is intentional.

This is the main editor-behavior risk. Tables have many special key commands for cell boundaries. Slide decks may need fewer, but slide/title/body boundaries still need explicit rules.

Recommended initial constraints:

- Treat slide titles like normal blocks in outline mode.
- In presentation/overview modes, intercept Enter on slide titles:
  - plain Enter creates a new slide after the current slide;
  - Shift+Enter or a toolbar action can add the first body block.
- In body blocks, keep normal Enter behavior.
- Add tests around split/backspace at slide boundaries before making the rendered UI fancy.

## Drag And Drop

Generic block dragging should cover basic slide reordering because slides are direct children of the deck and body blocks are descendants of slides.

Cases to test:

- Reorder slides within a deck.
- Move a slide between decks.
- Move a normal block into a slide body.
- Move a body block out of a slide.
- Prevent moving a deck into one of its slides.
- Decide whether dragging a non-slide block directly under a deck is allowed.

If direct deck children must always be slides, add deck-specific drop targets similar in spirit to table/kanban special cases.

## Testing Plan

Unit tests:

- `blockCommands.test.ts`
  - conversion creates deck metadata and slide children
  - add slide inserts in correct order
  - metadata updates preserve existing text/children
  - split/backspace boundary behavior
- `documentFormat.test.ts`
  - import/export deck and slide metadata
  - reject invalid colors/transitions/aspect ratios
- clipboard/import fixtures
  - slide deck round-trip preserves nested content and marks

UI tests:

- render deck in presentation, overview, and outline modes
- select/edit slide title and body content
- hidden title remains recoverably editable
- footer deck title and slide numbering update after slide reorder
- responsive viewport respects aspect ratio on desktop and mobile

## Implementation Scope

Small prototype:

1. Add metadata types and serialization.
2. Add `/slide deck` conversion with one default slide.
3. Render deck in overview mode only.
4. Render slide title/body inside a fixed-aspect viewport.
5. Add basic metadata controls.

Useful first product version:

1. Add presentation/overview/outline modes.
2. Add current-slide navigation.
3. Add add-slide and slide reorder affordances.
4. Add footer options.
5. Add boundary editing tests.

Polished version:

1. Presentation keyboard navigation and optional full-screen mode.
2. Deck-level theme/palette.
3. Better slide body layout controls beyond centered text.
4. Export to static HTML/PDF/PPTX if desired.

## Open Questions

- Should converting an existing nested outline make each direct child a slide, or move all existing children into one first slide?
- Should `slide` be available as a normal block type outside a deck?
- Are non-slide direct children under a deck allowed, ignored, auto-converted, or rendered only in outline mode?
- How should hidden slide titles be edited in presentation and overview modes?
- Should deck resolution be semantic metadata for export, or should CSS render only from aspect ratio?
- Should background color be a free hex value, a palette token, or a theme variable?
- Are transition animations collaborative document data, or purely presentation runtime preferences?
- Should slide numbering count only visible `slide` children, or every direct child under the deck?
- Should presentation mode support full-screen browser presentation, or only in-editor one-slide view?
- Should slide body content be limited to paragraphs/lists, or can tables, kanban boards, images, previews, math, and annotations all render inside slides?
- How should comments/footnotes render in presentation mode?
- Should remote collaborators see another user's current presentation slide, or is current slide strictly local?
- Should deck title footer use live deck text even when the deck title is hidden/collapsed?
