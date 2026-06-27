# Plan: Empty Block Indicator

## Decisions From Research

- The indicator applies to every empty editable surface, including table titles, table cells, and table row headers.
- Empty code blocks do not need a separate style or exception.
- Focus styling replaces the empty indicator while the editable surface is focused.
- The indicator should be a subtle ellipsis at 50% opacity.
- Whitespace counts as non-empty, matching the existing CRDT-visible text behavior.

## Phase 1: CSS Indicator

Update `examples/block-rich-text/src/style.css`.

Tasks:

- Replace the current 1px empty-block pseudo-element with a visible ellipsis:

```css
.editableBlock[data-empty="true"]::before {
    content: "...";
    opacity: 0.5;
}
```

- Preserve the selector `.editableBlock[data-empty="true"]::before` so every `RichTextEditableSurface` gets the behavior automatically.
- Keep the pseudo-element CSS-only. Do not add React children for the ellipsis because `RichTextEditableSurface` imperatively manages editable children with `replaceChildren(...)`.
- Ensure the ellipsis does not make empty rows taller than current editable block min-heights.
- Confirm the ellipsis is present for all empty editable surfaces through the shared `data-empty` attribute.

## Phase 2: Focus-State Styling

Adjust focus styles in `examples/block-rich-text/src/style.css` so focus replaces the empty indicator.

Tasks:

- Hide the empty pseudo-element while the editable block is focused:

```css
.editableBlock[data-empty="true"]:focus::before {
    content: "";
}
```

- Keep existing `.editableBlock:focus` background and inset box-shadow intact.
- Check whether clearing `content` is enough for caret targeting in focused empty blocks. If browser behavior regresses, keep `content: ""` with the smallest inline-block needed for caret placement.

## Phase 3: Regression Tests

Add focused tests in `examples/block-rich-text/src/App.test.tsx`.

Tasks:

- Assert the initial empty editable block has `data-empty="true"`.
- Type text into an empty block and assert `data-empty` is removed.
- Delete the text and assert `data-empty="true"` returns.
- Convert or create a table if existing helpers make this straightforward, then assert an empty table title or cell has `data-empty="true"`.

Notes:

- Do not try to assert the pseudo-element ellipsis in jsdom. CSS generated content is a visual behavior, not a reliable DOM assertion.
- Existing helper behavior treats whitespace as text, so a block containing spaces should keep `data-empty` absent. Add this as a regression only if the test setup is cheap.

## Phase 4: Visual Verification

Run the example app and verify the actual CSS behavior in a browser.

Check:

- Empty paragraphs, headings, list items, todos, blockquotes, callouts, table titles, table row headers, and table cells show a 50% opacity ellipsis.
- Focused empty blocks show the existing focus styling instead of the ellipsis.
- Typing any visible text removes the ellipsis.
- Blocks containing whitespace do not show the ellipsis.
- Empty code blocks use the same shared empty-surface behavior without a special override.
- Clicking an empty block still places the caret correctly.

## Phase 5: Verification Commands

Run focused app tests:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

Run the example build/typecheck:

```sh
npm --prefix examples/block-rich-text run build
```

If visual verification is needed, start the example:

```sh
npm run dev -- --host 127.0.0.1
```

Expected result:

- Empty editable surfaces are visibly indicated with a subtle ellipsis.
- Focused empty surfaces rely on focus styling.
- No CRDT, command, or selection-model changes are needed.
