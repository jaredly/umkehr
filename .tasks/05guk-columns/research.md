# Research: Rename `kanban` Block Type to `columns`

## Goal

Update `examples/block-rich-text` so the current `kanban` block type becomes a `columns` block type with metadata:

```ts
{type: 'columns'; display: 'cards' | 'blocks'; ts: HLC}
```

`display: 'cards'` should preserve the current kanban-style board behavior. `display: 'blocks'` should be the default and should render nested blocks as traditional columns where blocks keep their normal rendering rather than being wrapped as cards.

## Current Shape

`kanban` is currently a regular block metadata variant:

- `RichBlockMeta` includes `{type: 'kanban'; ts: HLC}` in `src/blockMeta.ts`.
- Document import/export recognizes `kanban` as a `DocumentBlockType` in `documentFormat.ts`.
- History import validation accepts raw CRDT metadata with `type: 'kanban'` in `history.ts`.
- The toolbar and slash menu expose a `kanban` block command.
- `convertBlockToKanban` changes the selected block's metadata to `kanban` and creates three default child blocks when no columns exist.
- Column/card structure is not a separate schema. It is ordinary nested blocks:
  - board block: `meta.type === 'kanban'`
  - board children: columns
  - column children: cards
  - card children: normal nested blocks
- Rendering is special-cased in `EditorApp.tsx`:
  - `renderBlockNode` routes `meta.type === 'kanban'` to `KanbanBlock`.
  - `KanbanBlock` renders the board title plus `.kanbanColumns`.
  - `KanbanColumn` renders each board child as a column.
  - `KanbanCard` renders each column child as a card and then renders card children normally.
- Drag/drop has special DOM hit-testing for rendered kanban columns/cards in `useBlockReorder.ts`.
- CSS has a large `.kanban*` section and a slide-specific `.slideBody > .kanbanBlock` rule.

The current model is useful for this change because columns/cards already use normal block parentage. The new `display` field can mostly decide whether descendants get the special card layout or the normal block renderer.

## Likely Implementation Plan

1. Rename metadata and menu types.
   - Replace the `RichBlockMeta` variant with `{type: 'columns'; display: 'cards' | 'blocks'; ts: HLC}`.
   - Add a `ColumnsDisplayMode` alias if useful.
   - Update `sameTypeWithTs` so it preserves `display`.
   - Replace `BlockTypeMenuValue` value `kanban` with `columns`.
   - Rename user-facing menu/slash labels to something like `Columns`.

2. Add display helpers.
   - Add a helper like:
     ```ts
     export const columnsDisplay = (meta: RichBlockMeta): 'cards' | 'blocks' | null =>
         meta.type === 'columns' ? meta.display ?? 'blocks' : null;
     ```
   - Use `display: 'blocks'` as the internal default for newly-created columns blocks.
   - Treat legacy/missing display as `blocks` once the type is `columns`.

3. Replace command helpers.
   - Rename `convertBlockToKanban` to something like `convertBlockToColumns`.
   - When triggered by the renamed toolbar/slash command, set metadata to `{type: 'columns', display: 'blocks', ts}` unless product direction says the old command should still make card boards.
   - Keep default child creation logic so a new columns block still creates starter child columns. Consider renaming `DEFAULT_KANBAN_COLUMNS` to `DEFAULT_COLUMNS`.
   - Rename helpers like `kanbanColumns`, `kanbanCards`, `kanbanColumnContext`, and `kanbanCardContext`.
   - Gate "card" semantics on `meta.type === 'columns' && meta.display === 'cards'`. For `display: 'blocks'`, children should not be treated as kanban cards.

4. Update rendering.
   - In `renderBlockNode`, route `meta.type === 'columns'` to a columns block renderer.
   - For `display: 'cards'`, preserve the current `KanbanBlock`/column/card layout, probably renamed to `ColumnsBlock`, `ColumnsColumn`, `ColumnsCard`.
   - For `display: 'blocks'`, render the parent block title normally and render each direct child as a column. Inside each column, render that column block normally and render its descendants normally, without card wrappers.
   - Important: avoid infinite recursion. The parent `columns` block needs a special container, but children should be passed back through normal `renderBlockNodeAtRelativeDepth` or equivalent.
   - Drag row registration must still work for each visible child block in block display mode.

5. Update drag/drop.
   - Keep current special hit-testing only for `display: 'cards'`, because the card-specific logic depends on `.kanbanColumn`, `.kanbanCards`, and `.kanbanCard` DOM.
   - Either rename DOM data attributes/classes from `kanban*` to `columns*`, or keep CSS class names as implementation details. A clean rename is broader but avoids stale terminology in tests.
   - For `display: 'blocks'`, normal block drag/drop should work unless the columns container needs a special horizontal column reorder target. This is one of the open UX questions.

6. Update document format.
   - Replace `kanban` in `BLOCK_TYPES` with `columns`.
   - Extend `DocumentBlockMeta` with `display?: 'cards' | 'blocks'`.
   - Parse `columns` metadata with default `display: 'blocks'`.
   - Export columns as:
     ```ts
     {type: 'columns', meta: {display: meta.display}}
     ```
     or omit `meta.display` when it is the default, depending on desired fixture readability.
   - Strongly consider accepting legacy imported document blocks with `type: 'kanban'` and normalizing them to `{type: 'columns', display: 'cards'}` so existing JSON fixtures/clipboard payloads do not break.

7. Update history and clipboard compatibility.
   - `history.ts` validates raw `RichBlockMeta`; update it for `columns` and `display`.
   - Decide whether old serialized histories with raw `{type: 'kanban'}` should still import. If yes, add normalization before validation or extend validation with a legacy path.
   - Clipboard payload parsing currently round-trips metadata. If old payloads matter, normalize legacy `kanban` metadata on paste.

8. Update fixtures and tests.
   - Rename the `kanban-board` fixture id/label if desired, or keep the id for compatibility and update its document to `type: 'columns', meta: {display: 'cards'}`.
   - Update tests in:
     - `documentFormat.test.ts`
     - `documentFixtures.test.ts`
     - `clipboard.test.ts`
     - `history.test.ts`
     - `App.test.tsx`
   - Add explicit coverage for:
     - importing `columns` without `meta.display` defaults to `blocks`
     - importing/exporting `columns` with `display: 'cards'`
     - legacy `kanban` document import maps to `columns/cards` if compatibility is kept
     - toolbar/slash conversion creates `columns/blocks` by default
     - card display still renders and drags like the current kanban behavior
     - block display renders descendants as normal blocks, not cards

## Compatibility Notes

The codebase has many tests and fixtures that use the word `kanban`. A pure rename will break serialized examples, clipboard payload tests, history exports, selectors, class names, and fixture ids. The lowest-risk migration is:

- Internal canonical type: `columns`.
- New default display: `blocks`.
- Legacy high-level document import: `type: 'kanban'` -> `type: 'columns', display: 'cards'`.
- Legacy raw history/clipboard metadata: `{type: 'kanban', ts}` -> `{type: 'columns', display: 'cards', ts}` if preserving old exports matters.
- Existing card-mode fixture can remain behaviorally the same but should be encoded as `columns/cards`.

This preserves old kanban documents while making the new model explicit.

## Open Questions

1. Should the toolbar/slash `Columns` command create `display: 'blocks'` only, or should there also be a separate `Card columns`/`Board` command that creates `display: 'cards'`?

- yeah let's have one for cards too

2. Where should users switch between `display: 'blocks'` and `display: 'cards'`? There is no current block-specific metadata control for kanban. Options include a toolbar affordance when a columns block is selected, a block action, or no UI initially beyond fixtures/imports.

- other blocks have the three-dots menu for metadata options. use that pattern

3. Should old `kanban` document/clipboard/history payloads be accepted indefinitely and normalized to `columns/cards`, or is a breaking fixture/test migration acceptable for this example?

- don't worry at all about backwards compatibility or migration

4. For `display: 'blocks'`, should columns be horizontally reorderable by dragging a column block inside the columns container, similar to card-mode kanban columns, or is normal vertical block drag/drop acceptable for now?

- yes, columns should be reorderable, and you should be able to drop in an arbitrary block as a new column

5. In `display: 'blocks'`, should column child blocks have their own visible column handles/chrome, or should they render exactly like normal blocks inside a CSS column grid?

- let's try rendering like normal blocks

6. Should exported documents include `meta: {display: 'blocks'}` for default block columns, or omit it for compactness and rely on import defaults?

- we can omit

7. Should CSS/test selectors be fully renamed from `kanban*` to `columns*`, or can the old class names remain as internal implementation names for the card layout during a smaller first pass?

- yeah let's rename
