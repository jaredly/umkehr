# Research: Markdown Shortcuts For Lists

## Goal

Update `examples/block-rich-text` so typing markdown-style prefixes at the start of a paragraph converts the current block into a list-like block and removes the typed prefix:

- `- ` -> unordered list item
- `* ` -> unordered list item
- `1. ` -> ordered list item
- `[ ] ` -> unchecked todo

The task specifically says "at the start of a paragraph", so the shortcut should only fire for paragraph blocks, with the caret immediately after the recognized prefix.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

The editor already supports the target block types in `RichBlockMeta`:

```ts
| {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
| {type: 'todo'; checked: boolean; ts: HLC}
```

The toolbar maps these block types through `blockTypeMeta` in `App.tsx`:

- `unordered` -> `{type: 'list_item', kind: 'unordered', ts}`
- `ordered` -> `{type: 'list_item', kind: 'ordered', ts}`
- `todo` -> `{type: 'todo', checked: current.type === 'todo' ? current.checked : false, ts}`

Rendering support already exists:

- `BlockAffordance` renders unordered/ordered list markers and todo checkboxes.
- `deriveOrderedListNumbers` numbers consecutive ordered list items per parent.

Text input is centralized enough for this feature:

- `RichTextEditableSurface` intercepts `beforeinput`.
- For `insertText`, it prevents the browser mutation and calls `onInsertText(event.data, selection)`.
- `EditableBlock` passes `onInsertText` through to `renderEditableBlock`.
- `renderEditableBlock` currently calls `insertTextEverywhere(current.state, selection, text, makeCommandContext(current))`.
- `insertTextEverywhere` resolves retained selections and delegates to `insertText` in `blockCommands.ts`.

The plain command layer is the best implementation surface because tests can run without the DOM and both `beforeinput` and jsdom fallback input paths eventually use the same command.

## Proposed Implementation

Add a command that wraps insertion and then applies the markdown shortcut when appropriate. A likely shape:

```ts
export const insertTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const inserted = insertText(state, selection, text, context);
    return applyMarkdownShortcut(inserted.state, inserted.selection, context, inserted.ops);
};
```

The shortcut check should be intentionally narrow:

- Selection must resolve to a collapsed caret after insertion.
- The inserted `text` should be a space, since all requested triggers end with a space.
- The caret must be in a paragraph block.
- The paragraph text up to the caret must exactly match one of the trigger strings.
- The trigger must begin at offset `0`.

For a match:

1. Delete the trigger text from offsets `0..trigger.length` in the same block.
2. Apply a `setBlockMetaOps` update for the block's new metadata.
3. Return a caret at offset `0`.
4. Return the insertion, deletion, and metadata ops as one command result so history/undo treat the shortcut as one user edit.

Ordering can reasonably be insert -> delete prefix -> set block meta. This mirrors the user's actual action and gives one atomic local-change history entry when run through `runCommand`.

Potential helper names:

- `insertTextWithMarkdownShortcuts`
- `markdownShortcutForParagraphPrefix`
- `applyMarkdownShortcutAfterInsert`

Then add a multi-selection wrapper in `multiSelectionCommands.ts`, analogous to `insertTextEverywhere`:

```ts
export const insertTextWithMarkdownShortcutsEverywhere = (...) =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertTextWithMarkdownShortcuts(working, resolveSelection(working, entry.selection), text, context),
    );
```

Finally update `App.tsx` so normal text insertion uses the shortcut-aware multi-selection command.

## Edge Cases

Do not fire inside non-paragraph blocks. This avoids surprising conversions inside headings, code blocks, callouts, tables, existing list items, or todos. Table cells can contain paragraph blocks, so the shortcut can still work inside a table cell paragraph unless the implementation explicitly forbids it.

Do not fire when typing in the middle of text. For example, `abc- ` or ` - ` should remain text.

Do not fire when the prefix is part of a larger typed chunk unless product wants paste/autocorrect support. The narrowest behavior is to fire only when the just-inserted text is a single space and the resulting prefix exactly matches the full block text before the caret.

Do not fire for selected ranges unless insertion collapses the range and the resulting paragraph prefix exactly matches. The existing `insertText` deletes the selected range first, so the wrapper can rely on the post-insert caret/text check.

The `1. ` shortcut should currently only recognize exactly `1. ` because the task names `1. ` specifically. Supporting `2. `, `42. `, etc. would be a product expansion.

The todo shortcut is `[ ] ` only. Checked todo markdown (`[x] ` or `[X] `) is not requested.

## Tests

Add command-level tests in `examples/block-rich-text/src/blockCommands.test.ts` for:

- Typing `-` then space at offset `0` converts a paragraph to unordered `list_item`, clears the text, and leaves caret at `0`.
- Same for `* `.
- Typing `1. ` converts to ordered `list_item`.
- Typing `[ ] ` converts to unchecked `todo`.
- Prefix text typed away from offset `0` does not convert.
- Prefix text in a non-paragraph block does not convert.
- The command's ops include both prefix deletion and metadata change, and applying them to a peer gives the same block text/meta.

Consider an `App.test.tsx` integration test if existing editor input tests are already stable for text entry. The command-level tests should cover most logic; one UI test can verify that `beforeinput` uses the shortcut-aware path.

Useful test command:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
```

## Open Questions

- Should shortcut handling apply only to typed spaces, or also to pasted/autocorrected text such as pasting `- ` into an empty paragraph?
- Should ordered-list shortcuts recognize only `1. `, or any positive number followed by `. `?
- Should `[x] ` or `[X] ` create a checked todo, or is unchecked `[ ] ` the only supported todo shortcut for now?
- Should shortcuts work inside paragraph table cells? The model allows it, but table editing has special behavior elsewhere.
