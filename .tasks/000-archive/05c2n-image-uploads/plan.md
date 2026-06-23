# Plan: Image Upload Blocks

## Phase 1: Block Metadata and Validation

Add the image block type to the rich block model.

- Update `examples/block-rich-text/src/blockMeta.ts`.
  - Add `ImagePresentationSize = 'small' | 'medium' | 'large' | 'original'`.
  - Add `{type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC}` to `RichBlockMeta`.
  - Update `sameTypeWithTs(...)` to preserve `attachmentId` and `size`.
  - Keep `isEditableBlock(...)` returning `true` for image blocks so the description remains normal rich text.
- Update all exhaustive switches over `RichBlockMeta`.
  - `blockTypeMenuValue(...)` should probably return `paragraph` or a dedicated non-selectable value for image blocks. Do not let the normal block type dropdown accidentally convert an image block unless that behavior is explicitly implemented.
  - `blockTypeMeta(...)` should not synthesize image metadata from the block type dropdown.
- Update import/export validation.
  - `examples/block-rich-text/src/history.ts` `isRichBlockMeta(...)` must accept image metadata only when `attachmentId` is a non-empty string and `size` is one of the supported values.
  - `examples/block-rich-text/src/clipboard.ts` rich clipboard metadata validation must do the same.

Acceptance checks:

- TypeScript accepts the new image metadata variant.
- History import rejects malformed image metadata.
- Existing block types continue to validate and render.

## Phase 2: Attachment Store

Add an example-local attachment layer outside CRDT state.

- Create a small attachment module, likely `examples/block-rich-text/src/attachments.ts`.
- Define:

```ts
export type ImageAttachment = {
    id: string;
    file?: File;
    objectUrl: string;
    name?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    uploadStatus?: 'local' | 'uploading' | 'uploaded' | 'failed';
};

export type AttachmentStore = Map<string, ImageAttachment>;
```

- Generate ids with `crypto.randomUUID()`.
- Provide helpers for:
  - creating an attachment from a `File`
  - reading image dimensions
  - revoking object URLs
  - serializing/deserializing attachment bundles for history and clipboard
- Keep the store owned by `EditorApp` so both local replicas can resolve the same uploaded images.
- Do not garbage collect orphaned attachments for now.

Acceptance checks:

- Uploading a local image creates an attachment record with UUID, object URL, MIME type, name, and dimensions when available.
- Missing attachments are representable and do not crash rendering.
- Object URLs are revoked when replacing/resetting the store or unmounting the app.

## Phase 3: Image Insertion Command

Add a CRDT command that inserts or converts an image block.

- Implement in `examples/block-rich-text/src/blockCommands.ts`.
- Command input should include `attachmentId`, default `size`, current selection, and command context.
- Behavior:
  - If the selected/focused block is empty, convert that block to image metadata.
  - If the selected/focused block is non-empty, insert a new image block after the current block.
  - If the current selection is a range, replace/delete the selected range first if this matches existing command behavior cleanly; otherwise resolve to the focus block and insert after it.
  - Image blocks are allowed inside tables, annotations, blockquotes, and callouts.
  - Result selection should be a caret at offset `0` in the image block description.
- Add a retained-selection wrapper in `multiSelectionCommands.ts` only if the UI uses normal edit command plumbing and needs a `RetainedSelectionSet` result.
- Use existing parent/sibling helpers and `insertBlockOps(...)` / `setBlockMetaOps(...)`; no core CRDT change should be needed.

Acceptance checks:

- Empty paragraph upload turns that block into an image block.
- Non-empty paragraph upload inserts an image block after it.
- Upload inside nested contexts preserves the expected parent.
- Online peer receives the image block metadata through normal op sync.

## Phase 4: Rendering and Controls

Render image blocks as an image preview plus rich description editor.

- Update `App.tsx`.
  - Thread the attachment store or lookup function through editor/render context.
  - Add upload UI, probably a toolbar button backed by a hidden file input.
  - Add `ImageBlock` or image-specific branch in `EditableBlock`.
  - Use the existing `RichTextEditableSurface` for the description.
  - Add size control with `small | medium | large | original`, emitting `block:meta` updates with LWW semantics.
- Update `style.css`.
  - Add `.blockType-image` layout.
  - Add stable preview dimensions for missing/loading images.
  - Add size classes with predictable max widths.
  - Keep caption text aligned with the existing editor design.
- Missing attachment rendering:
  - Show a stable placeholder with file/id information when useful.
  - Keep the description editable.

Acceptance checks:

- Image previews render in both editors after upload.
- Missing attachments show a placeholder and caption editor.
- Size changes sync to the peer.
- Rich text caption editing, inline marks, links, and retained selections continue to work.

## Phase 5: Keyboard, Split, and Delete Behavior

Make image captions behave like rich text while preserving image block semantics.

- Special-case Enter in an image block.
  - Pressing Enter in the description creates a paragraph after the image.
  - Selection moves to the new paragraph at offset `0`.
  - Do not duplicate image metadata into the new block.
- Review Backspace/Delete around image boundaries.
  - Deleting text inside the caption should behave normally.
  - Backspace from the paragraph after an image should not accidentally turn that paragraph into an image block.
  - Deleting an image block should delete the CRDT block but leave the attachment record alone.
- Review arrow navigation.
  - Existing block-to-block movement should work because captions are regular block text.
  - Fix only if tests expose image-preview focus or DOM selection issues.

Acceptance checks:

- Enter in an image caption creates a following paragraph.
- Caption text edits remain synced.
- Deleting the image block removes it from the document without mutating attachment storage.

## Phase 6: Paste and Drag Uploads

Support image files through paste first, then optional drag/drop.

- Update `onPaste` handling in `App.tsx`.
  - Check `event.clipboardData.files` / `items` for image files before falling back to `text/plain`.
  - For each image file, create an attachment and insert an image block.
  - Keep existing text paste and rich text paste behavior intact.
- Consider drop support after paste works.
  - Use the same attachment creation and image insertion command.
  - Avoid interfering with existing block reorder drag handling.

Acceptance checks:

- Pasting an image file inserts an image block.
- Pasting plain text still uses existing markdown/rich text behavior.
- Multi-image paste has deterministic block order or is explicitly limited to the first image.

## Phase 7: History Export/Import Attachment Bundle

Extend history export/import with a separate attachment bundle.

- Keep CRDT actions unchanged: image blocks store only `attachmentId` and presentation size.
- Extend exported history shape with an attachment section outside CRDT state.
  - Include attachment id, name, MIME type, dimensions, status if useful, and file bytes encoded as data URL or base64.
  - Bump export version if needed.
- Update import validation.
  - Rebuild object URLs from imported attachment bytes.
  - Preserve image blocks whose attachment id is missing by rendering placeholders.
- Update replay/reset flows.
  - Resetting history should reset attachments.
  - Importing history should replace both CRDT history and attachment store after confirmation.

Acceptance checks:

- Export/import round-trips image blocks and image files.
- Imported history replays without requiring original local files.
- Older exports either import cleanly with no attachments or produce a clear unsupported-version error.

## Phase 8: Rich Clipboard with Attachments

Preserve image blocks and attachments when copying/pasting within the app.

- Extend `RichClipboardPayload`.
  - Include image fragments with metadata.
  - Include attachment records for copied image blocks.
- Update serialization.
  - When selected ranges include image blocks, preserve image metadata and caption text.
  - Include the corresponding attachment bytes/metadata when available.
- Update paste.
  - Rehydrate attachment records into the local attachment store.
  - Generate new attachment ids when needed to avoid collisions, and rewrite pasted image block metadata to the new ids.
  - Preserve rich captions and inline marks.
- Decide fallback behavior for external paste targets.
  - HTML can emit `<figure><img><figcaption>...</figcaption></figure>` when a data URL or resolvable URL is available.
  - Plain text should include the caption.

Acceptance checks:

- Copy/paste image blocks within the same session preserves images and captions.
- Copy/paste across two browser sessions works if the rich clipboard payload is available.
- Plain text fallback remains useful.

## Phase 9: Tests and Verification

Add focused unit and UI tests as implementation lands.

- `history.ts` / `clipboard.ts` validation tests for image metadata.
- Command tests in `blockCommands.test.ts`.
  - empty block conversion
  - non-empty insertion after
  - nested parent insertion
  - Enter creates paragraph after image
- App tests in `App.test.tsx`.
  - upload button/file input inserts image
  - peer sync renders image block
  - missing attachment placeholder
  - size control sync
  - caption typing and inline formatting
  - history export/import with attachment bundle
  - image clipboard paste path
- Run the existing block-rich-text test suite.
- Run TypeScript/build checks for the example.
- For final UI verification, start the Vite dev server and inspect desktop/mobile enough to verify image layout, controls, caption editing, and missing placeholders.

## Implementation Order

1. Metadata and validators.
2. Attachment store.
3. Insert command and command tests.
4. Rendering/upload UI and app tests.
5. Enter/delete keyboard semantics.
6. Paste image files.
7. History attachment bundle.
8. Rich clipboard attachment preservation.
9. Full test and browser verification pass.

This order keeps the CRDT surface small first, then layers local file handling, UI, and portability on top.
