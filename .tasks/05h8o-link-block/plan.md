# Plan: Block Links via Copy/Paste

## Decisions

- Store block-link hrefs as `#block-<sourceBlockId>`.
- When multiple blocks are copied, pasting over text links to the first copied block.
- Table cells and all other block types are valid link targets.
- If the copied target block no longer exists at paste time, do nothing.
- Do not treat plain-text `#block-...` paste as link creation; only rich block copy/paste triggers this workflow.
- Existing link navigation is assumed sufficient. The implementation only needs to ensure target block DOM ids exist.
- Dead links from cross-document paste or later deletion should render with a distinct color.

## Phase 1: Clipboard Source Metadata

Goal: make rich clipboard payloads carry enough source identity to know which block was copied.

Tasks:

- Extend `ClipboardFragment` in `examples/block-rich-text/src/clipboard.ts` with optional `sourceBlockId?: string`.
- Extend `RichClipboardPayload` with optional `sourceSelectionType?: 'text' | 'block' | 'table-cells'`.
- Update `serializeSelectionToClipboardPayload` so each fragment created from a concrete block includes `sourceBlockId: block.id`.
- Set `sourceSelectionType` during serialization:
  - `'block'` when the resolved selection includes a block selection.
  - `'table-cells'` when the resolved selection includes table cells but no block selection.
  - omit or use `'text'` for ordinary text selections. Omitting is slightly more backward-compatible.
- Update `parseBlockRichTextClipboardPayload` and `parseFragments` to accept the new optional fields.
- Validate `sourceBlockId` as a non-empty string when present.
- Preserve backward compatibility for existing payloads that do not include these fields.

Tests:

- Add `clipboard.test.ts` coverage for block-selection serialization including `sourceSelectionType` and `sourceBlockId`.
- Add parser tests for valid and invalid `sourceBlockId`.
- Add a table-cell copy serialization case if existing test helpers make that cheap.

## Phase 2: Block-Link Detection Helper

Goal: centralize the rule for when a rich clipboard payload should become a block link instead of normal pasted content.

Tasks:

- Add a pure helper, likely in `clipboard.ts` or a small nearby module, such as:

```ts
export const blockLinkHrefForClipboardPayload = (
    state: CachedState<RichBlockMeta>,
    payload: RichClipboardPayload,
): string | null => { /* ... */ };
```

- The helper should:
  - Return `null` unless `payload.sourceSelectionType` is `'block'` or `'table-cells'`.
  - Find the first fragment with a `sourceBlockId`.
  - Return `null` if no source block id exists.
  - Return `null` if `state.state.blocks[sourceBlockId]` is missing or deleted.
  - Return `#block-${sourceBlockId}` otherwise.
- Do not inspect or special-case `payload.plainText`; plain `#block-...` strings should not create links.

Tests:

- Helper returns `#block-<id>` for a live copied block.
- Helper uses the first copied block when multiple fragments have source ids.
- Helper returns `null` for text-selection payloads.
- Helper returns `null` for missing/deleted target blocks.

## Phase 3: Rich Paste Special Case

Goal: implement the requested user workflow without disturbing normal rich paste behavior.

Tasks:

- In `examples/block-rich-text/src/EditorApp.tsx`, update `pasteRichPayload`.
- Before calling `pasteRichClipboardEverywhere`, resolve the current paste selection the same way the existing rich paste path does.
- If the current primary selection is a non-collapsed text `range`, call the block-link helper.
- If the helper returns an href:
  - Apply `setLinkMarkEverywhere(current.state, selection, href, makeCommandContext(current))`.
  - Restore the primary resulting selection as current link-mark commands do.
  - Do not insert or replace text.
- If the helper returns `null`, fall through to existing rich paste behavior.
- Preserve existing behavior for:
  - Rich paste at a caret.
  - Rich paste over block/table-cell selections.
  - Rich paste of ordinary rich text.
  - Plain-text URL paste over a selected text range.

Tests:

- Command/UI-level test: copy a block, select text, paste, and assert the selected text remains unchanged and has `LINK_MARK` with `#block-<copiedId>`.
- Multiple copied blocks link to the first copied block.
- Deleted target block before paste results in no text replacement and no mark.
- Normal rich text payload over text still replaces the selected text.

## Phase 4: DOM Ids for Block Targets

Goal: ensure `#block-<id>` hrefs have matching in-document targets.

Tasks:

- Locate the primary rendered element for every block in `EditorApp.tsx`.
- Add `id={`block-${block.id}`}` to a stable per-block container.
- Include all rendered block types, including nested blocks, table cells, image blocks, columns/slides/polls, and annotation body blocks if they use a separate renderer path.
- Avoid duplicate ids if the same block can be rendered in multiple simultaneous surfaces, such as previews or presentation views. If duplicate rendering exists, prefer ids only on the main editor surface and use data attributes elsewhere.
- Confirm no existing `id` prop is overwritten.

Tests/manual checks:

- App test or DOM assertion that a rendered block has `id="block-<id>"`.
- Manual click/open check for an inline link whose href is `#block-<id>`.

## Phase 5: Dead Link Styling

Goal: distinguish block links whose target does not exist in the current rendered document.

Tasks:

- Add a helper for detecting block-link hrefs, e.g. parse `#block-<id>`.
- While rendering inline runs, detect `LINK_MARK` values that are block-link hrefs.
- If the target block id is absent, deleted, or not currently visible/materialized, add a class such as `markLinkDead`.
- Keep live block links styled like normal links, or add a live block-link class only if useful.
- Add CSS in `examples/block-rich-text/src/style.css` for `markLinkDead` with a distinct color.
- Ensure external links and `mailto:` links are unaffected.

Tests:

- Rendering test if available: dead block link gets `markLinkDead`.
- Existing normal link rendering remains unchanged.
- Live block link does not get dead styling.

## Phase 6: Verification

Run focused tests first:

```sh
npm exec vitest -- run examples/block-rich-text/src/clipboard.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

Then run broader affected suites if time allows:

```sh
npm exec vitest -- run examples/block-rich-text/src
```

Manual workflow checks:

- Block-select one block, copy, select text, paste: text becomes linked to `#block-<id>`.
- Block-select multiple blocks, copy, select text, paste: text links to the first selected block.
- Copy a table cell/block, select text, paste: text links to that block.
- Delete copied target before paste, then paste over text: no-op.
- Paste ordinary rich text over selected text: replacement still works.
- Paste URL plain text over selected text: URL link behavior still works.
- Paste `#block-...` as plain text over selected text: no block link is created.
- Existing link popover/open behavior still works for block links.
