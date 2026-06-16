# Plan: Markdown Shortcuts For Lists

## Decisions From Research

- Shortcuts run only on typed spaces, not paste or bulk inserted text.
- Ordered list shortcuts accept any positive number followed by `. `.
- `[ ] ` creates an unchecked todo.
- `[x] ` and `[X] ` create checked todos.
- Shortcuts work in paragraph blocks inside table cells.
- Shortcuts only convert paragraph blocks.

## Phase 1: Command-Layer Shortcut Support

Add shortcut-aware text insertion in `examples/block-rich-text/src/blockCommands.ts`.

Tasks:

- Export a new command, likely `insertTextWithMarkdownShortcuts`.
- Have it call the existing `insertText` first.
- Only inspect for shortcuts when the inserted text is exactly `' '`.
- Resolve the post-insert selection and require a collapsed caret.
- Require the caret block to exist and have `meta.type === 'paragraph'`.
- Read the current block text with `blockContents`.
- Match only prefixes that occupy the full text before the caret:
  - `- ` -> `{type: 'list_item', kind: 'unordered', ts}`
  - `* ` -> `{type: 'list_item', kind: 'unordered', ts}`
  - `/^[1-9][0-9]*\. $/` -> `{type: 'list_item', kind: 'ordered', ts}`
  - `[ ] ` -> `{type: 'todo', checked: false, ts}`
  - `[x] ` or `[X] ` -> `{type: 'todo', checked: true, ts}`
- When matched, append ops to:
  - delete offsets `0..prefix.length` with `deleteRangeOps`
  - update the block meta with `setBlockMetaOps`
- Apply each op batch to the working state with `applyMany(..., annotationVirtualParents(...))`.
- Return one `CommandResult` containing the original insertion ops plus shortcut deletion/meta ops.
- Return the selection as `caret(blockId, 0)`.

Notes:

- Keep existing `insertText` unchanged for callers that need raw text insertion.
- Use `context.nextTs()` for the metadata timestamp.
- Call `annotationVirtualParents` against the latest working state before each `applyMany` call, matching existing command patterns.

## Phase 2: Multi-Selection Wiring

Add a multi-selection wrapper in `examples/block-rich-text/src/multiSelectionCommands.ts`.

Tasks:

- Import `insertTextWithMarkdownShortcuts`.
- Export `insertTextWithMarkdownShortcutsEverywhere`.
- Implement it with `runReplacingCommand`, matching `insertTextEverywhere`.
- Resolve each retained selection before running the command.
- Let each selected caret independently convert if it is in a matching paragraph state.

Notes:

- This preserves existing multi-cursor behavior.
- The shortcut should still be a normal local edit with retained selection output.

## Phase 3: App Integration

Update `examples/block-rich-text/src/App.tsx`.

Tasks:

- Import `insertTextWithMarkdownShortcutsEverywhere`.
- In `renderEditableBlock`, change the normal `onInsertText` path from `insertTextEverywhere` to `insertTextWithMarkdownShortcutsEverywhere`.
- Leave paste handling on `pastePlainTextEverywhere`, since shortcuts should not run on pasted text.
- Leave code-block Tab insertion using `onInsertText('    ')`; the new command only reacts to a single typed space and paragraph blocks, so it will not convert code indentation.

## Phase 4: Command Tests

Add focused tests in `examples/block-rich-text/src/blockCommands.test.ts`.

Test cases:

- `- ` converts an empty paragraph to unordered `list_item`, clears text, and moves caret to offset `0`.
- `* ` converts an empty paragraph to unordered `list_item`, clears text, and moves caret to offset `0`.
- `1. ` converts to ordered `list_item`.
- A larger positive marker such as `12. ` converts to ordered `list_item`.
- `[ ] ` converts to unchecked `todo`.
- `[x] ` converts to checked `todo`.
- `[X] ` converts to checked `todo`.
- `0. ` does not convert.
- `01. ` does not convert unless the implementation intentionally treats it as positive; prefer no conversion to keep the regex simple and unambiguous.
- Prefixes away from offset `0`, such as `abc- ` or ` - `, do not convert.
- Matching text in a non-paragraph block does not convert.
- Matching text in a paragraph table cell does convert.
- Applying the returned ops to a peer replica produces the same text and metadata.

Implementation tips:

- Add a helper that simulates typing a string one character at a time through `insertTextWithMarkdownShortcuts`.
- Assert final text with `blockContents`.
- Assert metadata directly from `result.state.state.blocks[blockId].meta`.
- Assert selection with `focusPoint(result.selection)` or direct caret equality.

## Phase 5: UI/Regression Test

Add one integration test in `examples/block-rich-text/src/App.test.tsx` if the existing test utilities make text entry cheap.

Candidate test:

- Focus a paragraph block.
- Type `- `.
- Assert the text box is empty.
- Assert the block row renders an unordered list affordance marker.
- Optionally type content after conversion and assert it appears as list text.

If the UI test is brittle because of current contenteditable/jsdom behavior, rely on command tests and skip this phase.

## Phase 6: Verification

Run targeted tests first:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
```

If an app test was added, run it too:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

Then run the example typecheck/build:

```sh
npm --prefix examples/block-rich-text run build
```

Expected result:

- Markdown shortcuts work from normal typing.
- Paste remains literal.
- Undo history treats shortcut conversion as one edit command.
- Remote replicas receive text deletion and metadata ops consistently.
