# Research: Markdown Shortcuts On Paste

## Goal

Extend `examples/block-rich-text` so markdown shortcuts that already work while typing also work when text is pasted.

Today, typed shortcut conversion is intentionally narrow: typing the final space in a recognized prefix at the start of a block converts the block metadata and deletes the marker text. Paste currently inserts literal text through the plain paste path.

## Current State

Relevant files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `.tasks/000-archive/054b2-markdown-shortcuts/research.md`

Typed markdown shortcut support is implemented in `insertTextWithMarkdownShortcuts`:

- It delegates to `insertText`.
- It only checks shortcuts when the inserted text is exactly `' '`.
- It reads the block text before the resulting caret.
- `markdownShortcutMeta` recognizes:
  - `- ` and `* ` as unordered list items
  - positive-number ordered list prefixes like `1. ` and `12. `
  - `# `, `## `, and `### ` as headings
  - `[ ] ` as unchecked todo
  - `[x] ` and `[X] ` as checked todo
- Most shortcuts only convert paragraph blocks.
- Todo shortcuts also convert unordered list items, but not ordered list items.
- On a match, it deletes the prefix, applies `setBlockMetaOps`, and returns the insertion, deletion, and metadata ops as one command result.

The command is wired into regular typing through `insertTextWithMarkdownShortcutsEverywhere` in `multiSelectionCommands.ts`, and `App.tsx` calls that path from `insertTextWithPendingMarks` when no pending inline marks are active.

Paste currently uses a separate command:

```ts
export const pastePlainText = (
    state,
    selection,
    text,
    context,
): CommandResult => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const appended = pastePlainTextAtBlockEnd(state, selection, lines, context);
    if (appended) return appended;

    let result = insertText(state, selection, lines[0] ?? '', context);
    const ops = [...result.ops];

    for (let index = 1; index < lines.length; index++) {
        const splitResult = splitBlock(result.state, result.selection, context);
        ops.push(...splitResult.ops);
        const inserted = insertText(splitResult.state, splitResult.selection, lines[index], context);
        ops.push(...inserted.ops);
        result = inserted;
    }

    return {...result, ops};
};
```

There is also an optimized `pastePlainTextAtBlockEnd` branch for multi-line paste at the end of a top-level non-code block. That path manually appends text and inserts sibling blocks for performance.

UI paste wiring:

- Normal block rows call `onPasteText(event.clipboardData.getData('text/plain'))`.
- `onPasteText` applies link-like paste over a selected range as a link mark, otherwise calls `pastePlainTextEverywhere`.
- Table row headers call `pastePlainTextEverywhere` directly.
- Annotation body editors use a separate annotation body text model and `replaceAnnotationBodySelection`; block-level markdown shortcut conversion likely should not apply there unless requested separately.

## Implementation Direction

The cleanest implementation surface is the command layer, not DOM paste handlers.

Add a paste-aware command that preserves existing paste behavior, then post-processes each block touched by the paste for markdown prefixes. Likely shape:

```ts
export const pastePlainTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const pasted = pastePlainText(state, selection, text, context);
    return applyMarkdownShortcutsAfterPaste(pasted, context);
};
```

Then add:

```ts
export const pastePlainTextWithMarkdownShortcutsEverywhere = (...) =>
    runReplacingCommand(state, selection, (working, entry) =>
        pastePlainTextWithMarkdownShortcuts(
            working,
            resolveSelection(working, entry.selection),
            text,
            context,
        ),
    );
```

Finally update the normal block paste paths in `App.tsx` from `pastePlainTextEverywhere` to the shortcut-aware paste command, while keeping link-like paste-over-range behavior ahead of plain paste.

To avoid duplicating conversion logic, refactor the existing typed shortcut code into a reusable helper that can run against a block after text is already present. A useful internal helper would take a block id and inspect the current visible text prefix:

```ts
const applyMarkdownShortcutAtBlockStart = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult | null
```

The helper should:

1. Look at the block's current visible text.
2. Find a recognized prefix only at offset `0`.
3. Confirm the block metadata is eligible via the existing `markdownShortcutMeta`.
4. Delete exactly the matched prefix.
5. Apply the converted metadata.
6. Return ops that can be appended to the paste ops.

`markdownShortcutMeta` currently requires the full prefix string, which is fine for typed text because the caret is immediately after the prefix. For paste, the pasted line may be `- item`, `# Heading`, or `[x] task`, so the helper needs a "prefix match" form rather than an exact whole-text match. One approach is to add:

```ts
const markdownShortcutPrefix = (
    text: string,
    currentMeta: RichBlockMeta,
    nextTs: CommandContext['nextTs'],
): {length: number; meta: RichBlockMeta} | null
```

Typed shortcut handling can call this helper and additionally require `length === point.offset`.

## Scope Decisions

The user request says "when pasting in text", which could mean either:

- Pasting a complete markdown-looking line such as `- task` should create an unordered list item with text `task`.
- Pasting only the marker text `- ` into an empty paragraph should convert to an empty unordered list item.

Both should fall out naturally from a block-start prefix helper.

For multi-line paste, the useful behavior is probably per-line conversion:

```md
- one
- two
1. three
[x] done
```

should produce four blocks with corresponding metadata and marker text removed.

Do not parse general Markdown in this task. The existing shortcut surface is block-prefix conversion, not full markdown import/export. Nested markdown indentation, inline emphasis, links, blockquotes, fenced code, ordered list renumbering semantics, and mixed rich HTML paste are separate product scope.

## Edge Cases

Pasting into the middle of an existing block should only convert if the resulting block starts with a recognized prefix. For example, pasting `- ` at offset `3` in `abc` should stay literal. Pasting `item` after an existing `- ` at offset `2` is less obvious: the final text starts with `- item`, but the user did not paste the marker in this command. A conservative implementation can still convert based on the resulting block text; a stricter implementation would only convert blocks whose inserted text starts at offset `0`.

Pasting over a selected range should be allowed to convert if the post-paste block starts with a recognized prefix. This mirrors typing over a selection, where insertion can create a valid prefix.

Multi-selection paste should behave like existing `pastePlainTextEverywhere`: each retained selection receives the same pasted text, and each inserted/replaced block should be checked independently.

Code blocks should stay literal. Existing optimized paste already skips `pastePlainTextAtBlockEnd` for code blocks, and `markdownShortcutMeta` does not convert code metadata.

Table cells are paragraph blocks and typed shortcuts already work there. Paste shortcut conversion should probably work there too. Table row headers use normal editable blocks with `table_row` metadata, so they should stay literal unless a future task wants row-header-specific behavior.

Annotation body paste should remain unchanged for now. Annotation bodies use separate helpers, do not have `RichBlockMeta` block types, and should not unexpectedly become list blocks.

The optimized top-level multi-line paste path needs special care. If shortcut conversion is implemented only by wrapping the non-optimized loop, large multi-line paste at block end will bypass conversion. Either run the post-processing after both branches, or deliberately disable the optimized branch for markdown-looking paste. Post-processing after both branches is better because it keeps the existing performance path.

Selection after paste should remain at the end of pasted content, not jump to the start of a converted block. Typed shortcuts return caret offset `0` because the marker is the entire typed content. For paste of `- item`, the natural caret position is after `item`. The conversion helper must adjust the final selection when it deletes marker text in the selection's final block. Existing retained-selection utilities may be useful, but for command-level paste it may be enough to subtract the removed prefix length when the final caret is in the converted block after the deleted prefix.

Undo/history should treat paste plus conversions as one local edit, as typed shortcuts do today. Returning one command result with the original paste ops plus all shortcut deletion/meta ops should preserve that behavior.

## Tests

Command-level tests in `blockCommands.test.ts` should cover:

- Pasting `- item` into an empty paragraph creates an unordered list item with text `item`.
- Pasting `* item` creates an unordered list item.
- Pasting `12. item` creates an ordered list item.
- Pasting `# Heading`, `## Heading`, and `### Heading` creates heading blocks.
- Pasting `[ ] todo`, `[x] todo`, and `[X] todo` creates todos with the right checked state.
- Pasting only `- ` creates an empty unordered list item.
- Pasting multiple markdown-prefixed lines creates multiple converted blocks.
- Pasting mixed lines converts only matching lines.
- Pasting into a non-paragraph block stays literal except the existing unordered-list-to-todo case.
- Pasting markdown-looking text into a code block stays literal.
- Pasting a markdown prefix away from block start stays literal if that is the chosen behavior.
- Generated ops sync correctly to a peer replica.
- Final selection accounts for deleted marker text.

Multi-selection tests in `multiSelectionCommands.test.ts` should cover pasting a markdown-prefixed line into two cursors if the new multi-command wrapper is added.

UI tests in `App.test.tsx` should cover:

- Pasting `- item` into the main editor converts locally and syncs to the peer.
- Pasting multiple list-looking lines creates converted peer blocks.
- Link-like paste over selected text still applies a link mark rather than becoming literal block text.

Useful test commands:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

## Open Questions

- Should paste conversion trigger whenever the resulting block starts with a markdown prefix, or only when the pasted content itself begins at block offset `0`?
    - only when the pasted content itself begins at block offset `0`
- Should multi-line paste support only the existing shortcut prefixes, or is this the start of a fuller markdown import path?
    - we can keep it limited for the moment
- Should ordered paste preserve the pasted number in metadata anywhere, or is the current ordered-list rendering model enough because list numbers are derived from block order?
    - no need to preserve the pasted number
- Should pasted indented markdown list items create nested block structure, or stay as plain text after the first recognized marker?
    - yes please
- Should table row headers ever support markdown paste conversion, or should only cell/normal paragraph blocks convert?
    - yes please
- Should annotation body paste get any markdown shortcut behavior, or remain a separate plain rich-text body model?
    - yes please
