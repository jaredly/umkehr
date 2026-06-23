# Plan: Markdown Shortcuts On Paste

## Decisions From Research

- Paste conversion should trigger only when the pasted content itself begins at block offset `0`.
- Keep scope limited to the existing markdown shortcut prefixes, not full Markdown import.
- Do not preserve ordered-list source numbers; ordered list display remains derived from block order.
- Pasted indented list items should create nested block structure.
- Table row headers should support paste markdown shortcuts.
- Annotation body paste should support markdown shortcuts too.

## Phase 1: Refactor Shortcut Detection

Centralize shortcut matching in `examples/block-rich-text/src/blockCommands.ts` so typed and pasted shortcut paths share the same prefix rules.

Tasks:

- Replace or wrap `markdownShortcutMeta` with a helper that returns both marker length and converted metadata:

```ts
const markdownShortcutPrefix = (
    text: string,
    currentMeta: RichBlockMeta,
    nextTs: CommandContext['nextTs'],
): {length: number; meta: RichBlockMeta} | null
```

- Preserve current typed behavior by requiring the typed caret to be exactly after the matched prefix.
- Keep the existing accepted prefixes:
  - `- ` and `* `
  - positive ordered prefixes like `1. ` and `12. `
  - `# `, `## `, `### `
  - `[ ] `, `[x] `, `[X] `
- Keep the existing eligibility rules:
  - paragraph blocks can convert to list, heading, or todo;
  - unordered list items can convert to todo;
  - ordered list items and code blocks stay literal for todo/list/heading shortcuts.

Tests:

- Existing typed shortcut tests should continue to pass unchanged.
- Add focused tests for the prefix helper indirectly through typed commands if it remains private.

## Phase 2: Add Paste-Aware Block Command

Add a new command-level paste path that runs existing paste behavior first, then applies markdown shortcut conversion only to blocks whose pasted content began at offset `0`.

Tasks:

- Add `pastePlainTextWithMarkdownShortcuts` next to `pastePlainText`.
- Track the blocks and insertion start offsets touched by the paste. Conversion should only run for a touched block when that block's pasted line began at offset `0`.
- Run conversion after both paste branches:
  - normal `insertText`/`splitBlock` loop;
  - optimized `pastePlainTextAtBlockEnd`.
- For each eligible touched block:
  - inspect current visible block text;
  - match a shortcut prefix at offset `0`;
  - delete only the marker prefix;
  - set the block metadata;
  - append deletion and metadata ops to the paste ops.
- Keep paste plus conversion as one `CommandResult` so undo/history sees one local edit.
- Adjust the final selection when marker deletion happens in the final selection block. For `- item`, the caret should end after `item`, not jump to `0`.

Implementation notes:

- It may be easiest for `pastePlainText` internals to expose touched block metadata to the wrapper, or for the new command to inline a small amount of paste orchestration.
- Avoid disabling the optimized paste path unless tracking touched blocks there becomes too invasive.
- Do not convert when the marker is created by pasting later text after an existing prefix at offset `2`; the pasted content did not begin at block offset `0`.

Tests in `blockCommands.test.ts`:

- `- item` -> unordered list item with text `item`.
- `* item` -> unordered list item.
- `12. item` -> ordered list item with text `item`.
- `# Heading`, `## Heading`, `### Heading` -> heading blocks.
- `[ ] todo`, `[x] todo`, `[X] todo` -> todo blocks with correct checked state.
- `- ` -> empty unordered list item.
- Multi-line paste converts every eligible line.
- Mixed multi-line paste converts only matching lines.
- Pasting markdown-looking text into a code block stays literal.
- Pasting at nonzero offset stays literal, even if the final block starts with a marker created earlier.
- Selection lands after the remaining pasted text.
- Applying generated ops to a peer replica produces the same text and metadata.

## Phase 3: Support Indented List Paste

Extend the paste post-processing for list-like shortcuts so indentation creates nested block structure.

Tasks:

- Parse leading indentation for pasted lines before shortcut matching.
- Apply nesting only to list/todo lines. Keep heading indentation literal unless a specific rule is added later.
- Treat indentation conservatively:
  - tabs count as one nesting level;
  - groups of leading spaces can be mapped to levels, likely two or four spaces. Pick one convention and cover it in tests.
- After inserting and converting all lines, move converted list/todo blocks under the nearest preceding converted list/todo block at the previous indentation level.
- Do not preserve the pasted ordered-list number.
- If indentation skips a level with no valid parent, clamp to the deepest available valid parent rather than creating placeholder blocks.
- Keep table internals safe: do not indent blocks under a table row/cell in a way that violates existing table parent constraints.

Tests in `blockCommands.test.ts`:

- Pasting:

```md
- one
  - two
  - three
- four
```

creates `two` and `three` as children of `one`, with `four` back at the root/current parent level.

- Mixed ordered/unordered/todo indentation nests under the previous list/todo parent.
- Indentation without a previous parent stays at the current paste level.
- Peer sync preserves text, metadata, and parent structure.

## Phase 4: Multi-Selection And App Wiring

Wire the new command into normal editor paste paths.

Tasks:

- Add `pastePlainTextWithMarkdownShortcutsEverywhere` in `multiSelectionCommands.ts`.
- Use it in the main block `onPasteText` path in `App.tsx`.
- Preserve existing link-like paste-over-range behavior by keeping that branch before markdown paste.
- Use the shortcut-aware paste command for table row headers too.
- Keep code block paste literal through command eligibility, not UI special casing.

Tests:

- Add `multiSelectionCommands.test.ts` coverage for pasting a markdown-prefixed line into two cursors.
- Add `App.test.tsx` coverage for:
  - main editor paste of `- item` converts locally and syncs to the peer;
  - multi-line paste converts peer blocks;
  - link-like paste over selected text still applies a link mark;
  - table row header paste supports an eligible markdown shortcut.

## Phase 5: Annotation Body Paste

Annotation bodies currently use `replaceAnnotationBodySelection`, which inserts plain text into one body block and does not expose block metadata in the rendered annotation body UI. Supporting markdown paste there needs a dedicated path.

Tasks:

- Add an annotation-body paste command in `examples/block-rich-text/src/annotations.ts`, likely:

```ts
export const pasteAnnotationBodyTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult
```

- For single-line paste at offset `0`, reuse the block shortcut conversion helper to remove the marker and set body block metadata.
- For multi-line paste, split into multiple annotation body blocks rather than inserting raw newline text if block-level markdown conversion is expected.
- Apply the same "pasted content begins at block offset `0`" trigger rule.
- Preserve existing link-like paste-over-range behavior in annotation bodies.
- Update annotation body rendering so converted body blocks visibly reflect their metadata. Minimal options:
  - render list/todo markers in `AnnotationBodyBlock`; or
  - reuse a constrained version of the main block affordance without drag behavior.
- Keep annotation body keyboard Enter behavior unchanged unless multi-line pasted body blocks require follow-up navigation support.

Tests:

- Command-level annotation tests, either in `blockCommands.test.ts` or a new `annotations.test.ts`, for single-line and multi-line annotation body paste.
- `App.test.tsx` coverage that pasting `- note` into an annotation body removes the marker and visibly renders as a list item.
- Regression that link-like paste over selected annotation body text still creates a link.

## Phase 6: History, Performance, And Regression Pass

Validate the feature across the behaviors most likely to regress.

Tasks:

- Add or update history tests to prove paste plus markdown conversion undoes/redoes as one local edit.
- Keep the existing large-paste performance expectations intact. If shortcut scanning adds overhead, restrict scans to touched block starts and bail quickly when the first characters cannot match a shortcut.
- Run focused tests first, then broader block-rich-text tests.

Verification commands:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/history.test.ts
```

Final manual/browser checks if the app is already running:

- Paste a flat markdown list into the main editor.
- Paste an indented list into the main editor.
- Paste a heading shortcut into a table row header.
- Paste a list shortcut into an annotation body.
- Paste a URL over selected main-editor and annotation-body text to confirm link behavior still wins.
