# Research: Slide Rim Drag, Focus, and Selection Management

## Scope

This note covers the current selection and focus management approach in
`examples/block-rich-text`, with emphasis on the recent slide presentation work:

- rendered slide rims as drag/block-selection affordances
- slide presentation keyboard navigation
- block, table-cell, text, and DOM selection interactions
- structural issues that make fixes fragile

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/style.css`

## Selection Model

The app has one central logical selection type:

```ts
type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint}
    | {type: 'block'; anchorBlockId: string; focusBlockId: string}
    | {type: 'table-cells'; tableId: string; anchorCellId: string; focusCellId: string};
```

Text selections are directly representable in the DOM. Block selections and table-cell
selections are not; they are logical selections rendered through CSS decorations.

The editor stores retained selections in replica state, resolves them against the current
CRDT state, and derives:

- `primaryResolvedSelection`
- inline text decorations via `decorationsForSelectionSet`
- block-level decorations via `blockLevelDecorationsForSelectionSet`

This gives the editor a single selection abstraction, but the abstraction covers multiple
interaction modes with very different DOM behavior.

## DOM Selection Bridge

`domSelection.ts` only reads/restores text selections:

- `readSelectionFromDom(root)` returns `caret` or `range`
- `restoreSelectionToDom(root, selection)` ignores non-text selections
- `readPointFromMouseEvent(root, event)` maps pointer coordinates to text offsets

Block-level selections are therefore represented by:

- clearing `window.getSelection()`
- focusing a block or table cell element
- storing logical `block` / `table-cells` selection in retained state
- rendering CSS classes from `blockLevelDecorationsByBlock`

This means there are two selection systems active at once:

- browser DOM selection for text
- retained logical selection for app behavior

Most bugs in this area come from code assuming one of those is authoritative when the other
still has meaningful state.

## Capture and Restore Flow

The main editor root wires several broad event handlers:

- `onPointerDown={startTextDragSelection}`
- `onMouseDown={captureMouseDown}`
- `onMouseUp={captureSelection}`
- `onKeyDown={handleBlockSelectionKeyDown ...}`
- `onKeyUp={captureSelection}`

`captureSelection` reads the DOM selection and writes it back into retained selection state.
It also handles multi-selection modifier behavior. Because it is on the root, feature-specific
surfaces must opt out by stopping propagation or being listed in selector exclusions.

`scheduleSelectionRestore` stores a pending DOM restore for carets/ranges after React updates.
For block-level selections, `focusBlockSelectionTarget` clears the DOM selection and focuses
the relevant editable block/cell.

The consequence is that focus, DOM selection, and retained selection can temporarily disagree:

- a retained block selection may exist while the focused DOM node is an editable child
- a DOM text range may exist before `captureSelection` has committed it
- feature-level key handlers can see stale retained selection during the same event turn

## Block Selection and Drag

Block drag handles call `startBlockDragFromHandle`.

Current behavior:

1. If the clicked block is inside the already-selected top-level block group, drag the group.
2. Otherwise, call `selectBlockSubtreeFromHandle(blockId)`.
3. Then call `startDrag(blockId, event, ids)`.

`selectBlockSubtreeFromHandle` intentionally selects the whole visible subtree:

```ts
{type: 'block', anchorBlockId: blockId, focusBlockId: lastVisibleDescendant}
```

This is semantically useful for moving, copying, and deleting nested content. A recent visual
fix changed `blockLevelDecorationsForSelectionSet` so block-subtree selections decorate only
their selected top-level roots, not every descendant. That made visual selection less noisy
without weakening command semantics.

This split is important: command selection and visual selection are not always the same list
of block ids.

## Slide Rendering and Rim Interaction

Rendered slides are `SlideBlockView` instances. The slide viewport is an `<article>` with:

- `data-slide-id`
- registered row geometry for block reordering
- block-level selection classes
- pointer/mouse handlers for rim selection/drag

The actual editable slide content is inside `.slideSurface`.

The rim interaction is fragile because slide viewport and slide content are nested:

- clicking the rim should block-select/drag the slide
- clicking inside `.slideSurface` should allow ordinary text/table/block interactions

The current approach uses event target checks such as:

```ts
if (event.target !== event.currentTarget) return;
```

This makes only true viewport/rim events trigger slide block selection. Without this guard,
handlers on the viewport can intercept all slide content events and break text selection.

This is a local workaround, not a general interaction boundary.

## Presentation Keyboard Navigation

Presentation mode currently lives inside `SlideDeckBlock` as a feature-local key handler:

```ts
onKeyDown={ui.mode === 'presentation' ? handlePresentationKeyDown : undefined}
```

It handles:

- `ArrowRight`
- `PageDown`
- `Space`
- `ArrowLeft`
- `PageUp`
- `Escape` for full-screen exit

Recent attempts tried to gate slide navigation based on:

- whether the event target is editable text
- whether the current retained selection is `type === 'block'`
- whether the selected top-level block is the current slide

The desired behavior is more specific:

- left/right/space should advance only when the current slide itself is block-selected
- they should not advance for a text/range selection inside the slide
- they should not advance for table-cell selection inside the slide
- they should not advance for block selection of a slide child

The current implementation struggles because a local key handler must infer interaction intent
from low-level facts that are not always synchronized:

- event target
- active DOM element
- retained primary selection
- block-level decoration state
- current slide id
- whether full-screen presentation is active

This is the immediate structural weakness exposed by the table-cell selection bug.

## Table-Cell Selection Complication

Table-cell selection is a block-level logical selection (`type: 'table-cells'`) but behaves
differently from block selection:

- its focus target is a `.tableCell`
- decorations render on table rows/cells, not normal editable blocks
- arrow keys have table navigation semantics
- selected cells may contain nested editable blocks

Presentation key handling that only checks "not text" or "is block-level" can accidentally
catch table-cell selection. This is what happens when a table cell in a slide is selected and
`ArrowLeft` bubbles into the presentation deck: the presentation handler sees a navigation key
but lacks a central answer to "who owns this key right now?"

## Structural Issues

### 1. Selection Type Is Too Broad For Ownership Decisions

`EditorSelection` models shape, not ownership or interaction mode.

`type: 'block'` can mean:

- a whole slide is selected for presentation navigation
- a normal paragraph subtree is selected
- a block child inside a slide is selected
- a selected block group is being dragged

`type: 'table-cells'` is block-level, but should not be treated like slide block selection.

Feature code keeps reinventing predicates such as "is this the current slide selection?"
instead of asking a central selection/command router.

### 2. DOM Focus Is Used As A Proxy For Intent

`focusBlockSelectionTarget` focuses an editable element even for block selections. Presentation
code then tries to distinguish editable text from block selection using event target or active
element checks.

This is unreliable because a block-selected slide can leave focus inside the slide title, and
a deck-level key event can arrive with an editable active element.

### 3. Root-Level Event Capture Creates Accidental Coupling

The root editor captures mouse, pointer, and key events for all blocks. Embedded surfaces like
slides, tables, polls, previews, and popovers opt out with selector checks or propagation stops.

Every new framed surface creates another boundary that must be manually maintained.

### 4. Feature-Local Key Handlers Compete With Editor-Wide Selection Semantics

`SlideDeckBlock` handles presentation keys locally. `EditableBlock` handles text keys locally.
The editor root handles block selections globally. Table code handles cell navigation.

There is no central priority order like:

1. active IME/composition
2. text selection in editable content
3. table-cell selection
4. block selection
5. presentation slide selection
6. deck-level navigation fallback

Without a priority model, handlers infer from event bubbling and DOM shape.

### 5. Visual Selection And Command Selection Are Intermixed

The block-subtree highlight issue showed that selected ids for commands are not always the ids
that should render as selected. `blockLevelDecorationsForSelectionSet` now partially separates
this for block subtrees, but the distinction is not explicit in the model.

A clearer split would be:

- command selection: what operations act on
- focus selection: where keyboard commands apply
- visual selection: what gets highlighted
- presentation selection: which slide frame owns navigation

### 6. Block Selection Does Not Encode Selection Root

A block selection stores anchor/focus block ids, not an explicit selected-root id. For subtree
selection, code must recompute top-level roots from visible outline order. That is workable for
rendering but awkward for feature-specific checks like "is the selected entity exactly this slide?"

## Why The Current Slide Predicate Is Brittle

The desired predicate is not:

```ts
selection.type === 'block'
```

It is closer to:

```ts
selection.type === 'block' &&
selectedTopLevelBlockIdsForSelection(state, selection).length === 1 &&
selectedTopLevelBlockIdsForSelection(state, selection)[0] === currentSlideId
```

But even this is only a selection-shape check. It does not answer whether table cells, an
annotation body, a popover, or another nested editor surface currently owns the key event.

The table-cell bug is therefore a symptom: the slide handler is trying to be a local key router.

## Recommendations

### Short-Term Fix Direction

For presentation navigation, use a strict helper with an explicit name:

```ts
isCurrentSlideBlockSelection(state, selection, currentSlideId)
```

It should return true only when:

- `selection.type === 'block'`
- `currentSlideId` is non-null
- the selected top-level roots are exactly `[currentSlideId]`

Then `handlePresentationKeyDown` should only handle left/right/space when that helper returns
true. It should not fall back to "non-editable event target" for navigation keys unless the
product explicitly wants deck-level navigation without selection.

This will make slide navigation depend on the requested representation: the slide itself is
block-selected.

### Medium-Term Fix Direction

Introduce a central keyboard command router for editor-scope keys. It should take:

- current retained selection
- event target classification
- current mode/context, such as presentation mode
- active nested surface, such as table, annotation body, popover, or slide deck

The router should return either:

- handled command
- not handled

This would avoid feature components making independent guesses from DOM focus and selection type.

### Model Improvement

Consider separating selection concepts:

- `EditorSelection`: command target
- `SelectionFocus`: keyboard focus owner and logical focus target
- `SelectionDecorations`: visual rendering only
- `InteractionMode`: text editing, block selection, table-cell selection, presentation, drag

The current single `EditorSelection` type is doing too much.

### Event Boundary Improvement

Framed surfaces such as rendered slides should expose explicit interaction zones:

- rim/frame: block select and drag
- surface/content: normal editor content
- controls/toolbars: editor-control zone

Instead of relying on bubbling plus `target === currentTarget`, consider data attributes such as:

- `data-editor-interaction-zone="block-frame"`
- `data-editor-interaction-zone="content"`
- `data-editor-control`

Root handlers can then classify events consistently.

## Open Questions

- Should presentation mode support deck-level navigation when no slide is block-selected?
- If yes, which element owns that mode: the deck container, the selected slide, or full-screen state?
- Should entering presentation always block-select the current slide?
- Should selecting text inside a slide clear presentation slide selection immediately?
- Should table-cell selection inside a slide disable presentation navigation entirely? The current
  expectation appears to be yes.
- Should a child block selection inside a slide ever advance slides? The current expectation is no.

## Suggested Next Step

Before adding more local guards, define the presentation navigation contract in one helper and
test it directly:

- slide block selected: left/right/space navigates
- slide child block selected: does not navigate
- slide table cell selected: does not navigate
- slide text range selected: does not navigate
- no selection or caret in deck chrome: decide explicitly

Then update `SlideDeckBlock` to call that helper and remove fallback predicates based on DOM
focus or generic block-level selection.
