# Research: Block Links via Inline `link` Marks

## Goal

Update `examples/block-rich-text` so the existing inline `link` mark can point to another block in the same document. The user-facing workflow should be:

1. Block-select a block.
2. Copy it with Cmd-C.
3. Select text elsewhere.
4. Paste.

When a rich clipboard payload that represents a block selection is pasted over a text range, the editor should apply a `link` mark to the selected text instead of replacing the selected text with copied block contents.

The requested href shape can be a fragment-style string such as `#<block-id>`, where `<block-id>` is the copied block's stable block id.

## Current State

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/clipboard.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

Inline links already exist as a valued mark:

```ts
export const LINK_MARK = 'link';
```

`setLinkMark` writes `markRangeOp(..., 'link', href, false, ...)`, and `removeLinkMark` removes it. The multi-selection wrapper is `setLinkMarkEverywhere`.

Clipboard serialization already preserves inline links:

- `ClipboardMarkRange` supports `{type: 'link', data: string}`.
- `appendRunMarks` emits link marks when `run.marks[LINK_MARK]` is a string.
- `wrapHtmlText` renders link marks as `<a href="...">...</a>`.
- `parseMarks` requires link mark `data` to be a string.
- Rich paste applies serialized link marks in `clipboardMarkOp`.

Plain text paste already has one link special case in `EditorApp.tsx`: if pasted plain text is URL-like and the current selection is a text range, it applies a link mark instead of replacing text. This is close to the desired behavior, but it only works for plain text values accepted by `isLinkLikeText`, currently `http(s)` and `mailto`.

Block-level copy currently serializes selected blocks as normal clipboard fragments:

- `serializeSelectionToClipboardPayload` resolves the selection set.
- For `block` or `table-cells` selections, it visits selected blocks and calls `fragmentForRange(block, 0, blockLength)`.
- The resulting `RichClipboardPayload` has `fragments`, `plainText`, `html`, annotations, and attachments.
- It does not currently record the source block ids for those fragments or whether the payload came from a block-level selection.

Rich paste currently inserts copied block fragments when the destination is a text selection:

- `pasteFromClipboard` prefers rich payloads over plain text.
- `pasteRichPayload` calls `pasteRichClipboardEverywhere`.
- `pasteRichClipboardEverywhere` only branches for block/table-cell destination selections through `pasteRichClipboardIntoBlockSelection`.
- For normal text selections, it calls `pasteRichClipboardAtSelection`.
- `pasteRichClipboardAtSelection` joins fragment text with newlines, calls `pastePlainTextDetailed`, sets pasted block metadata/styles to match the fragments, then reapplies clipboard marks.

This means the requested workflow currently follows the rich paste path and replaces selected text with copied block contents.

## Block Ids and DOM Ids

Blocks already have stable CRDT ids rendered as strings via `lamportToString`. Those ids are used throughout the example as `block.id`, selection `blockId`, and clipboard internals.

The task also says "make sure that the blocks have `id` set." That probably means rendered block DOM elements need an HTML `id` attribute so a fragment link such as `#0001-left` can navigate to the target block. The app already renders block rows and editable block elements with many data attributes; the implementation should find the main per-block DOM node and set a stable `id`, likely using a prefix to avoid CSS selector and HTML-id edge cases:

```ts
id={`block-${block.id}`}
```

If the href uses the prefixed DOM id, the mark value should be `#block-${block.id}`. If the href uses the raw CRDT id, rendered DOM ids must exactly match that raw id. A prefix is safer for DOM uniqueness and future non-Lamport ids, but it changes the literal href shape from `#<block-id>` to `#block-<block-id>`.

## Recommended Design

Add explicit source-block metadata to rich clipboard payloads rather than inferring from fragment text or HTML.

One conservative payload extension:

```ts
export type ClipboardFragment = {
    text: string;
    meta: RichBlockMeta;
    style?: RichBlockDocumentStyle;
    marks: ClipboardMarkRange[];
    sourceBlockId?: string;
};

export type RichClipboardPayload = {
    version: 1;
    plainText: string;
    html: string;
    fragments: ClipboardFragment[];
    annotations: ClipboardAnnotation[];
    attachments?: SerializedImageAttachment[];
    tsv?: string;
    sourceSelectionType?: 'text' | 'block' | 'table-cells';
};
```

`sourceSelectionType` lets paste distinguish "the user copied blocks" from "the user copied text whose range happens to include whole blocks." `sourceBlockId` gives a precise block target.

The paste special case should live before normal rich paste insertion. A helper could return a href only when all of these are true:

- Payload came from a block selection.
- Payload has exactly one targetable copied block, or a defined rule chooses the first block.
- Destination primary selection is a non-collapsed text range.
- Destination is not a block/table-cell selection.
- The target block still exists and is visible in the current state, unless dangling local fragment links are acceptable.

Then paste applies `setLinkMarkEverywhere(current.state, selection, href, context)` and skips `pasteRichClipboardEverywhere`.

This mirrors the existing plain-text URL behavior and keeps link application in the same command stack, undo, CRDT op, and selection-retention flow as other link edits.

## Implementation Notes

`clipboard.ts`:

- Extend `ClipboardFragment` parsing and serialization to carry an optional `sourceBlockId`.
- Extend `RichClipboardPayload` with optional `sourceSelectionType`.
- During `serializeSelectionToClipboardPayload`, set `sourceSelectionType` from the resolved selection:
  - `'block'` if any resolved entry is `block`.
  - `'table-cells'` if any resolved entry is `table-cells`.
  - `'text'` otherwise, or omit for backward compatibility.
- When building a fragment from a concrete source block, include `sourceBlockId: block.id`.
- Keep parser backward compatible with existing payloads by treating missing fields as valid.
- Validate `sourceBlockId` as a non-empty string if present.

`EditorApp.tsx`:

- Add a rich-paste preflight similar to the plain-text URL paste special case.
- Resolve the current selection before pasting.
- If the rich payload represents a single copied block and the current primary selection is `range`, call `setLinkMarkEverywhere` with the block href.
- Otherwise fall through to existing `pasteRichPayload`.

`multiSelectionCommands.ts`:

- No major change is required if the special case lives in `EditorApp.tsx`.
- If tests should avoid React/UI plumbing, a pure helper could be exported from `clipboard.ts` or `multiSelectionCommands.ts`, for example `blockLinkHrefForClipboardPayload(state, payload)`.

Rendering:

- Add stable HTML `id` attributes to rendered block containers or editable block elements.
- Ensure ids exist for nested blocks, table cells, annotation body blocks, and non-editable blocks if they can be copied or linked.
- If only top-level document blocks should be linkable, make that explicit in the helper.

Navigation:

- Existing link hover/popover logic treats href as a string and exposes it via `data-link-href`.
- Browser default anchor navigation may not happen because the editable spans are not real anchors in the editor rendering; links are styled spans with data attributes.
- The current link popover may already include actions for opening/copying links. Block links may need a special click/open path that calls `document.getElementById(id)?.scrollIntoView(...)` for `#...` hrefs.
- If the only requirement is storing/rendering the mark, navigation can be deferred.

## Test Plan

Focused unit tests:

- `clipboard.test.ts`: serializing a block selection records `sourceSelectionType: 'block'` and `sourceBlockId`.
- `clipboard.test.ts`: parser accepts payloads with valid `sourceBlockId` and rejects invalid typed values.
- `multiSelectionCommands` or a new helper test: block-link detection returns `#...` only for a single copied block and text-range destination.
- Command-level test: applying the special case marks the selected destination text with `LINK_MARK` and does not replace the selected text.
- Regression: normal rich text paste over a range still replaces text when payload is not a block-selection payload.
- Regression: plain text URL paste over a range still applies a link mark.
- React/App test if practical: copy block selection, select text, paste, assert the selected text has `markLink` and `data-link-href` set.

Manual checks:

- Copy one block, paste over text selection.
- Copy multiple blocks, paste over text selection.
- Copy a table cell/block, paste over text selection.
- Paste block payload at a caret.
- Paste block payload over a block selection.
- Click/open a block link if navigation is implemented.

## Open Questions

1. What exact href should be stored: `#<raw-block-id>` or `#block-<raw-block-id>`?
    - `#block-<id>` is great
2. Should copying multiple selected blocks and pasting over text link to the first block, reject the special case, or create some other aggregate behavior?
    - link the first block
3. Should table cell selections be linkable to a cell block, or should only normal block selections trigger block-link paste?
    - yes
4. Should block links navigate inside the editor immediately, or is storing/rendering the `link` mark enough for this task?
    - the navigation should already be in place, no further work needed
5. Should links to blocks survive copy/paste across documents? A raw block id from another document may not resolve locally.
    - we should render such dead links with a different color
6. What should happen if the target block was deleted before paste: fall back to normal rich paste, create a dangling fragment link, or no-op?
    - no-op
7. Should annotation body blocks, slide blocks, table rows/cells, columns, images, and other non-text blocks all receive DOM ids and be valid link targets?
    - all blocks are valid
8. Should existing plain text paste treat `#block-id` or `#id-href` strings as link-like when pasted over text, or should block-link creation only use rich block copy/paste?
    - only rich copy/paste
