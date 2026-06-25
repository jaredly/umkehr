# Plan: Preview Card Blocks

## Decisions From Research

- Render one preview card presentation, not a separate chip/card mode.
- Skip configurable CORS proxy support for the first pass.
- Skip well-known-site special cases for the first pass.
- Accept absolute `http:` and `https:` URLs only.
- Store the URL and fetched preview metadata in block meta.
- Use block text content as the subtitle.
- Make preview available from both the slash menu and toolbar block-type dropdown.
- Allow preview blocks everywhere the editor currently allows normal block types, including table cells and annotation body blocks.
- If a remote URL edit arrives while a user is editing a local draft, the local draft wins when committed through normal LWW metadata.

## Phase 1: Block Metadata Model

Update `examples/block-rich-text/src/blockMeta.ts`.

- Add a `PreviewMetadata` type for fetched card data:
  - `title?: string`
  - `description?: string`
  - `siteName?: string`
  - `imageUrl?: string`
  - `resolvedUrl?: string`
  - `fetchedAt?: string`
- Add a `preview` variant to `RichBlockMeta`:
  - `type: 'preview'`
  - `url: string`
  - `preview: PreviewMetadata | null`
  - `ts: HLC`
- Update `sameTypeWithTs` to preserve `url` and cached preview metadata.
- Keep `isEditableBlock` returning true so the standard text surface can be the subtitle.
- Do not add preview to `isWholeSubtreeStyledBlock`.

## Phase 2: Commands And CRDT Updates

Update `examples/block-rich-text/src/blockCommands.ts`.

- Add `insertPreviewBlock(state, selection, url, context)`.
- Mirror `insertImageBlock` behavior:
  - If selection is a range, delete it first.
  - If the target block is empty, convert it to preview metadata.
  - If the target block is non-empty, insert a new preview block after it.
  - Return caret selection in the preview block.
- Add a helper for updating preview URL and cached metadata through `setBlockMeta`.
- Treat preview like image when splitting: `Enter` on a preview block should create a paragraph after the preview block instead of splitting preview metadata.

Update `examples/block-rich-text/src/multiSelectionCommands.ts` only if a multi-selection wrapper is useful. Otherwise use existing `runSelectionCommandEverywhere` from `App.tsx` for slash insertion and toolbar conversion.

## Phase 3: Preview Metadata Fetching

Add `examples/block-rich-text/src/previewMetadata.ts`.

- Export URL validation/normalization:
  - Accept only absolute `http:` and `https:` URLs.
  - Reject empty strings, relative URLs, javascript/data/blob URLs, and malformed URLs.
- Export an async fetch function that:
  - Fetches the URL directly.
  - Parses returned HTML with `DOMParser`.
  - Extracts Open Graph fields:
    - `og:title`
    - `og:description`
    - `og:site_name`
    - `og:image`
    - `og:url`
  - Falls back to `<title>` for title.
  - Resolves relative `og:image` / `og:url` against the page URL.
  - Returns a typed loaded/failed/invalid result.
- Keep the fetcher deterministic and dependency-free.
- Do not add CORS proxy configuration in this phase; fetch failure should produce a stable fallback card.

Because metadata is stored in block meta, the UI needs to commit fetch results back through normal block metadata ops. Guard this carefully:

- Only write fetched metadata if the block still exists.
- Only write fetched metadata if the block is still `type: 'preview'`.
- Only write fetched metadata if the block URL still matches the URL that was fetched.
- Use the current replica timestamp when writing fetched metadata.

## Phase 4: App UI Integration

Update `examples/block-rich-text/src/App.tsx`.

Block type plumbing:

- Add `'preview'` to `BlockTypeMenuValue`.
- Add `Preview` to `SLASH_COMMANDS`.
- Add a `Preview` option to the toolbar block-type dropdown.
- Update `blockTypeMeta` and `blockTypeMenuValue`.
- For slash command selection, run `insertPreviewBlock` with `url: ''` rather than generic `setBlockTypeEverywhere`, so creation can focus the URL input.

Rendering:

- Extend `EditableBlock` props with preview-specific callbacks:
  - `onSetPreviewUrl(url: string): void`
  - `onSetPreviewMetadata(url: string, metadata: PreviewMetadata | null): void`
- Render preview blocks as:
  - A card wrapper.
  - Empty state URL textbox when `meta.url === ''`.
  - Loaded/fallback card when `meta.url` is non-empty.
  - Standard `RichTextEditableSurface` as the subtitle area.
  - A top-right three-dot menu for editing the URL.
- Use `contentEditable={false}` on URL input, card action buttons, menu, and preview image.
- Stop pointer/mouse/click/key propagation from URL input and menu controls.

URL editing behavior:

- Empty state focuses URL input after creating a preview block from slash or toolbar.
- `Enter` commits a valid absolute URL.
- `Escape` cancels edit and restores the previous URL/draft.
- Invalid URLs should not commit; show inline invalid state in the URL input area.
- If editing an existing preview URL, keep a local draft and commit it through metadata on submit.
- If a remote URL change arrives while editing, leave the local draft intact; committing the draft writes normal LWW metadata and wins if its timestamp is newer.

Fetching behavior:

- When a preview block has a valid URL and missing cached metadata, start fetch.
- While fetching, show a loading card with the normalized URL/domain.
- On success, write fetched metadata into block meta and render it.
- On failure, write `preview: null` or leave existing metadata unchanged depending on whether there was prior metadata:
  - For first fetch failure, render fallback from URL/domain.
  - If existing metadata exists and refresh fails, keep the existing metadata to avoid visual regression.

## Phase 5: Clipboard And Import/Export

Update `examples/block-rich-text/src/clipboard.ts`.

- Add preview metadata validation to `isRichBlockMeta`.
- Ensure preview block metadata survives rich clipboard payload parsing.
- Update HTML serialization so preview blocks copy as a normal link/card fallback using stored URL and title when available.
- Ensure plain text copy still includes the block text subtitle as normal editor text.

Update relevant tests in `clipboard.test.ts`.

## Phase 6: Styling

Update `examples/block-rich-text/src/style.css`.

- Add `.blockType-preview` styling.
- Add preview card styles:
  - Bordered card with compact, document-editor styling.
  - Stable dimensions for image thumbnail area to avoid layout jump.
  - Top-right menu button with predictable hit target.
  - URL empty state input.
  - Loading, invalid, and failed fallback states.
- Make the card responsive within editor panels and table cells.
- Avoid nested-card styling; the preview card itself is the block surface.
- Ensure subtitle text has enough spacing but still behaves like normal editable text.

## Phase 7: Tests

Unit tests in `blockCommands.test.ts`:

- Converts an empty block to a preview block with empty URL.
- Inserts a preview block after a non-empty block and preserves original text as subtitle source.
- Syncs preview metadata to the peer replica.
- Updates preview URL through metadata.
- Splitting a preview creates a paragraph after it.

Unit tests for `previewMetadata.ts`:

- Accepts absolute `http:` and `https:` URLs.
- Rejects relative and non-http URLs.
- Parses Open Graph title, description, site name, image, and URL.
- Falls back to `<title>`.
- Resolves relative image URLs.
- Returns failed/invalid states without throwing into React.

Clipboard tests in `clipboard.test.ts`:

- Parses preview block metadata.
- Serializes preview block metadata in rich clipboard payload.
- Emits a useful HTML fallback link/card.

App tests in `App.test.tsx`:

- Slash menu includes `Preview`; selecting it deletes `/` and shows the URL textbox.
- Toolbar dropdown can convert a block to preview.
- Entering a valid absolute URL updates both replicas.
- Existing block text renders as subtitle in the preview block.
- Invalid URL is rejected in the URL textbox.
- Three-dot menu reopens URL editing and commits a changed URL.
- Preview metadata fetch success is written into block meta and replicated.
- Fetch failure renders URL/domain fallback.
- Preview blocks work inside table cells.

Mock network fetches in tests. Do not perform real network requests.

## Phase 8: Verification

Run focused tests first:

```sh
npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/App.test.tsx
```

Run the example build:

```sh
npm run build --workspace examples/block-rich-text
```

If workspace scripts do not support that exact command, run the equivalent from `examples/block-rich-text`.

Manual checks:

- Create preview from slash menu.
- Create preview from toolbar.
- Paste valid and invalid URLs.
- Edit URL from three-dot menu.
- Confirm fetched metadata appears and syncs to the other replica.
- Confirm fallback card is usable when fetch fails.
- Confirm subtitle editing, selection, undo/redo, copy/paste, and split behavior still feel normal.
