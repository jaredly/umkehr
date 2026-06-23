# Research: Image Upload Blocks in `examples/block-rich-text`

## Goal

Add image upload support to `examples/block-rich-text` as a first-class block type.

The CRDT state should store only presentation metadata:

- an attachment id
- an optional presentation size, likely `small | medium | large | original`
- the normal block text as the image description/caption rendered under the image

The actual image bytes, blob URLs, upload lifecycle, and file management should stay outside the CRDT document state.

## Current Architecture

The example already has a local rich block metadata layer in `examples/block-rich-text/src/blockMeta.ts`:

```ts
export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | ...
    | {type: 'table'; ts: HLC};
```

The core block CRDT only requires block metadata to include a timestamp:

```ts
export type TimestampedBlockMeta = {ts: HLC};
export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    order: BlockOrder;
    deleted: boolean;
};
```

This means image block support does not need a core CRDT schema change. The example can add another `RichBlockMeta` variant and the existing `block` / `block:meta` ops will sync it.

Blocks are rendered through `materializeFormattedBlocks(...)` in `App.tsx`, then dispatched by `renderBlockNode(...)` / `renderEditableBlock(...)`. Tables, blockquotes, and callouts already prove that block rendering can branch on `meta.type` while still using the block's text content.

Text selection, retained selection, undo, multi-selection commands, and rich text formatting operate on the block's character contents. If an image description is stored as ordinary block text, most editor behavior should continue to work without a separate caption CRDT model.

## Recommended Data Model

Add an image metadata variant:

```ts
export type ImagePresentationSize = 'small' | 'medium' | 'large' | 'original';

export type RichBlockMeta =
    | ...
    | {
          type: 'image';
          attachmentId: string;
          size: ImagePresentationSize;
          ts: HLC;
      };
```

Notes:

- `attachmentId` should be stable, opaque, and JSON-safe.
- `size` belongs in CRDT metadata because it is collaborative document presentation state.
- Dimensions discovered from the local file may be useful for rendering, but storing width/height in CRDT metadata is only necessary if layout stability across devices matters before the attachment manager resolves the image.
- The description should remain block contents, not metadata. That keeps text editing, retained selections, marks, copy/paste text, undo, and history replay aligned with existing code.

`sameTypeWithTs(...)`, history import validation, and clipboard validation currently switch over all known block types, so they must be updated for `image`.

## Attachment Store Boundary

The image file should live outside CRDT state. For the example, a small in-memory store is enough:

```ts
type ImageAttachment = {
    id: string;
    file?: File;
    objectUrl: string;
    name?: string;
    mimeType?: string;
    width?: number;
    height?: number;
};

type AttachmentStore = Map<string, ImageAttachment>;
```

The demo has two in-memory replicas in one React app. For a first pass, one shared attachment store at the `EditorApp` level is the simplest model: both panels can render the same uploaded image after the CRDT op containing `attachmentId` syncs.

The important boundary is:

- CRDT op: creates or updates an image block with `{attachmentId, size, ts}`.
- Attachment store: maps `attachmentId` to a blob URL or remote URL.
- Missing attachment: render a stable placeholder with the description still editable.

Object URLs should be revoked when attachments are removed from the store or when the app unmounts.

## Insertion Flow

Add a toolbar button and/or hidden file input in `App.tsx`.

Suggested command behavior:

1. User chooses or drops an image file.
2. The UI creates an attachment record outside the CRDT.
3. The editor command inserts an image block near the current selection.
4. Selection moves to the new block description at offset `0`.

The command should live in `blockCommands.ts`, alongside `createTable(...)` and `insertParagraphAfterBlock(...)` style helpers. It can use `insertBlockOps(...)` with the same parent/sibling anchoring pattern used by table creation:

- If the current selection is in a block, insert the image block adjacent to that block.
- If the selection is a range, decide whether to delete the selection first or preserve it. Existing text commands delete selected text; image insertion probably should also replace the current selection.
- For image blocks inside table cells or annotation bodies, either support it through existing parent resolution or deliberately disallow it in the UI for the first pass.

Open implementation detail: whether inserting an image at a non-empty paragraph should split the paragraph around the caret. A document-editor-feeling behavior would be:

- caret in empty block: convert current block to `image`
- caret at block start/end: insert image before/after
- caret in middle of text: split and insert image between the two text blocks

A narrower first pass can insert after the current block and leave text unchanged.

## Rendering

Add an `ImageBlock` rendering path in `EditableBlock` or just above it:

- image preview area using `attachmentStore.get(meta.attachmentId)`
- size class derived from `meta.size`
- description editable surface using the existing `RichTextEditableSurface`
- inline controls for size, similar to `codeLanguage` and `calloutKind`

The description should continue to use:

- `data-block-id`
- `role="textbox"`
- `aria-label="Block text"` or a more specific label if tests are updated
- existing selection decorations
- existing beforeinput/key handlers

This avoids writing a separate caption editor and preserves keyboard behavior.

Rendering must handle missing attachments:

- show a placeholder area
- keep the caption editable
- avoid throwing if the local store does not know the id, especially after history import

## Editing Behavior

`isEditableBlock(...)` currently returns `true` for all rich block types. Keeping image blocks editable is correct if the caption is normal text.

The main special cases are keyboard navigation and deletion:

- Arrow movement should treat the image block as a block with caption text. Existing block-to-block movement can still use `pointTextLength(...)`.
- Backspace/Delete at caption boundaries should probably behave like normal block joins/deletes, but joining image metadata into a paragraph could be surprising.
- Splitting an image caption on Enter should probably create a paragraph after the image, not duplicate image metadata.

Today `splitBlock(...)` tends to preserve or derive metadata from the current block. Image blocks likely need a special case:

- Enter in image caption creates a paragraph after the image.
- Shift+Enter might insert a newline in the description only if multiline descriptions are desired.

Deletion/join behavior needs testing. In particular, deleting backward from the paragraph after an image should not accidentally turn the paragraph into an image block or lose the image attachment metadata.

## Clipboard and Paste

There is an existing rich clipboard payload in `clipboard.ts` with fragments containing `{text, meta, marks}`. It validates `RichBlockMeta` explicitly and emits HTML with `data-umkehr-block-type`.

For image blocks:

- Add `image` to clipboard meta validation if rich-copy should preserve image blocks.
- Decide whether copying an image block copies only its description or also the image block metadata.
- If preserving image metadata, only the `attachmentId` will copy. That id may not resolve in another browser/session unless the attachment store also exports/imports the file.
- For plain HTML clipboard, image blocks could emit `<figure><img ...><figcaption>...</figcaption></figure>` when an attachment URL is available, but avoid embedding blob URLs in CRDT history.

For paste/upload:

- Pasting image files from the OS clipboard should use `event.clipboardData.files` / `items`, create attachment records, and insert image blocks.
- Existing `onPaste` handlers currently prevent default and only read `text/plain`; image paste will need to check files/items first, then fall back to text.
- Drag-and-drop image upload can be added later using the same insertion command.

## History Export and Replay

`history.ts` serializes CRDT ops and validates rich block metadata during import. Add `image` support to `isRichBlockMeta(...)`.

Important limitation: history export should not include image bytes if the goal is to keep file management outside CRDT state. Therefore, replaying an exported history containing image blocks will reconstruct `attachmentId`s but not the actual local image files.

Recommended behavior for first pass:

- History replay preserves image blocks and captions.
- If an attachment is missing, render a missing-image placeholder.
- Export status or documentation can mention that image files are not included.

If richer demo portability is desired later, add a separate non-CRDT attachment bundle/export path.

## Tests to Add

Focused tests should cover the model and UI edges:

- `blockMeta`/history validation accepts image metadata and rejects invalid image sizes or missing `attachmentId`.
- Inserting an image creates a block with `meta.type === 'image'`, `attachmentId`, default size, and empty description.
- Two online replicas both receive the image block metadata after insertion.
- Missing attachment id renders a placeholder without crashing.
- Size control emits `block:meta` and syncs to the peer.
- Typing in the image description syncs as normal block text.
- Pressing Enter in an image description creates a paragraph after the image.
- Copy/paste behavior is explicit: either image metadata is preserved in rich clipboard payloads or intentionally downgraded to caption text.

## Likely Files to Touch

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts` if insertion needs retained multi-selection support
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/*.test.ts`

No core files under `src/block-crdt` should be necessary unless a hidden assumption requires every block to be text-only, which the existing table/callout rendering suggests is not the case.

## Open Questions

1. Should image insertion convert an empty current block, insert after the current block, or split the current block at the caret?
2. Are image blocks allowed inside tables, annotations, blockquotes, and callouts?
3. Should descriptions support inline marks and links, or be plain text only? The easiest path is to support existing rich text.
4. What should Enter do inside an image description: create a paragraph after the image, insert a caption newline, or split the caption?
5. What is the expected attachment id source: random UUID, content hash, server id, or demo-local id?
6. Should attachment metadata outside CRDT include dimensions, alt text fallback, MIME type, file name, or upload status?
7. Should history export/import include a separate attachment bundle, or is a missing-image placeholder acceptable?
8. Should rich clipboard copy preserve image blocks when pasting within the same app session, or should it copy only description text?
9. What conflict behavior is desired when two users concurrently change image size? Existing `block:meta` last-writer-wins by timestamp is probably acceptable.
10. What should deletion do with orphaned attachments? Since file management is outside CRDT state, attachment garbage collection should be a separate store concern, not part of document ops.
