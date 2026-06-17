# Research: Empty Block Indicator

## Goal

Update `examples/block-rich-text` so empty editable blocks render a subtle underline, making it visible that an otherwise blank block exists.

## Relevant Files

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `src/block-crdt/marks.ts`

## Current Rendering Path

The example renders editor content in `App.tsx`.

`BlockEditor` materializes visible blocks with:

```ts
materializeFormattedBlocks(replica.state, annotationMarkBehavior(replica.state))
```

`materializeFormattedBlocks` in `src/block-crdt/marks.ts` returns one `FormattedBlock` per visible block. Empty blocks are represented naturally: their `runs` array is empty because `orderedCharIdsForBlock(..., {visibleOnly: true})` has no visible chars.

Normal document blocks render through:

- `renderBlockNode`
- `renderEditableBlock`
- `EditableBlock`
- `RichTextEditableSurface`

Table row headers render directly through `RichTextEditableSurface` in `TableRowHeader`.

`RichTextEditableSurface` already tags empty surfaces:

```tsx
data-empty={runs.length === 0 ? 'true' : undefined}
```

The current CSS uses that hook only to preserve an inline caret target:

```css
.editableBlock[data-empty="true"]::before {
    content: "";
    display: inline-block;
    width: 1px;
}
```

This means the task likely does not require new CRDT state or React props. The existing `data-empty` attribute is the right styling hook.

## Recommended Implementation

Implement the indicator in `examples/block-rich-text/src/style.css` by expanding the existing empty-block pseudo-element.

A low-risk shape:

```css
.editableBlock[data-empty="true"]::before {
    content: "";
    display: inline-block;
    width: min(100%, 10rem);
    height: 1em;
    border-bottom: 1px solid #cbd5df;
    opacity: 0.7;
    vertical-align: baseline;
}
```

Details to preserve:

- Keep `content: ""`; this avoids adding text into the editable DOM and should not affect `blockText` test helpers.
- Keep the indicator on `::before`; it is already the empty-block caret affordance.
- Avoid creating a child DOM node from React for the underline. `RichTextEditableSurface` manages its children imperatively with `replaceChildren(...)`, so CSS is simpler and safer.
- Use `runs.length === 0` rather than derived text length unless the desired behavior is to also treat blocks containing only an invisible trailing newline as empty.

Potential style refinement:

- Code blocks already have a boxed gray background. If the underline feels too busy inside code blocks, add a narrower or lower-contrast override:

```css
.codeBlock[data-empty="true"]::before {
    border-bottom-color: #b9c4cf;
}
```

## Behavior Notes

Because `data-empty` is driven by rendered runs, the underline should automatically appear and disappear after edits, sync, undo/redo, replay cursor movement, table edits, split/join behavior, and any other operation that changes visible chars.

The indicator should apply to:

- Empty paragraphs.
- Empty headings.
- Empty list items and todos.
- Empty blockquotes/callouts.
- Empty table titles and table cells.
- Empty table row headers, unless explicitly scoped out.
- Empty code blocks, unless explicitly scoped out or styled separately.

The indicator should not appear for:

- Blocks containing visible text.
- Code blocks that contain only a trailing newline, under the current `runs.length === 0` check.
- Missing table cells, because those are not editable blocks and already render an add-cell button.

## Testing and Verification

Focused automated coverage can be added to `examples/block-rich-text/src/App.test.tsx`:

- Initial render has empty textboxes with `data-empty="true"`.
- Typing into an empty block removes `data-empty`.
- Deleting all text from a block restores `data-empty`.
- An empty table cell or table title also has `data-empty="true"` if table scope is intended.

CSS pseudo-element appearance is not meaningfully asserted in jsdom. Visual verification should use the example app in a browser:

- Start `examples/block-rich-text` with Vite.
- Check initial empty block indicator.
- Create empty blocks via Enter/split.
- Check nested/grouped blocks and table cells.
- Confirm caret placement still works when clicking an empty block.

## Open Questions

1. Should the underline appear for every empty editable surface, including table row headers and table titles, or only normal document blocks?
    - every editable surface
2. Should empty code blocks use the same underline style, a code-specific style, or no indicator because the code block background already marks the block?
    - no need
3. Should the indicator be visible while the block is focused, or should focus styling replace it?
    - focus styling replaces it
4. How wide should "subtle underline" be: a short text-width hint, a fixed-width cue, or nearly the full editable block width?
    - let's try 50% opacity ellipsis
5. Should a block containing only whitespace display as non-empty, matching the CRDT-visible text, or visually empty?
    - whitespace is non-empty
