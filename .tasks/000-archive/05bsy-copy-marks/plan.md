# Plan: Copy And Paste Marks

## Decisions From Research

- Rich paste should not run markdown shortcuts. If the clipboard has the custom rich payload, preserve the copied content literally and replay its marks.
- Copy/paste should include block metadata, not only inline text marks.
- Annotation body text can itself contain annotations. Treat annotation body blocks like normal rich text during serialization and import.
- Cross-document annotation paste should allocate fresh annotation ids for now.
- Copy resolved annotations too, not only active annotation references.
- Populate `text/html` in addition to `text/plain` and the custom JSON MIME type.
- Multi-selection copy should be supported. Multiple selections should paste as adjacent new blocks.

## Phase 1: Clipboard Types And Parsing

Add a focused clipboard module, likely `examples/block-rich-text/src/clipboard.ts`.

1. Define the custom MIME constant:

   ```ts
   export const BLOCK_RICH_TEXT_MIME = 'application/x-umkehr-block-rich-text+json';
   ```

2. Define versioned payload types:

   - top-level `version`, `plainText`, `html`, `fragments`, and `annotations`;
   - fragment/block entries with `text`, `meta`, and mark ranges;
   - mark ranges for boolean marks, links, and annotation refs;
   - annotation import entries with original id, presentation/resolved state, and body fragments.

3. Add parser/validator helpers:

   - `parseBlockRichTextClipboardPayload(value: string): RichClipboardPayload | null`;
   - reject unknown versions, invalid JSON, invalid ranges, invalid mark types, missing plain text, and non-object annotation data;
   - clamp nothing silently in the parser. Invalid custom payloads should fall back to plain text paste.

4. Add tests in a new `clipboard.test.ts`:

   - valid payload parses;
   - malformed JSON returns `null`;
   - unknown version returns `null`;
   - invalid mark ranges return `null`;
   - invalid annotation entries return `null`.

## Phase 2: Serialization From Selection

Implement pure serialization from editor state to the rich clipboard payload.

1. Add a serializer such as:

   ```ts
   export const serializeSelectionToClipboardPayload = (
       state: CachedState<RichBlockMeta>,
       selection: RetainedSelectionSet,
   ): RichClipboardPayload | null;
   ```

2. Resolve and order selections deterministically.

   - Use existing retained-selection and selection-set helpers.
   - Support multi-selection immediately.
   - Sort selections by visible document order before serializing.
   - Merge or skip duplicate/overlapping ranges conservatively so copied text does not repeat unexpectedly.
   - Represent each selected range as its own fragment; when pasted, fragments become adjacent blocks.

3. Serialize selected block text and block metadata.

   - Use `materializeFormattedBlocks(state, annotationMarkBehavior)` so annotation stacked marks are available.
   - Preserve `RichBlockMeta` per copied block/fragment.
   - For partial block selections, keep the source block meta on the copied fragment unless a later UX decision says partial text should always paste as paragraphs.

4. Serialize inline marks.

   - Walk formatted runs with offsets.
   - Clip mark ranges to the selected segment.
   - Emit boolean marks for `bold`, `italic`, and `strikethrough`.
   - Emit link marks with href data.
   - Emit annotation refs using all annotation data visible on the run, including stacked annotation marks.

5. Serialize annotation payloads recursively enough to cover annotation body annotations.

   - For every annotation id referenced by copied fragments, include its body blocks.
   - Serialize body block text, meta, boolean/link marks, and annotation refs.
   - Track visited annotation ids to avoid cycles or repeated bodies.
   - Include resolved annotation references as requested.

6. Generate `plainText`.

   - For a single selection, match current selected text behavior as closely as possible.
   - For multi-selection, join fragments with newlines so the plain fallback is readable.
   - Make sure `payload.plainText` and clipboard `text/plain` match.

7. Generate `text/html`.

   - Add a small HTML serializer for copied fragments.
   - Use semantic tags where simple: `<strong>`, `<em>`, `<s>`, `<a href>`.
   - Represent annotations with `data-umkehr-annotation-id`, `data-umkehr-annotation-presentation`, and `data-umkehr-annotation-resolved` attributes.
   - Escape all text and attribute values.
   - Keep HTML best-effort; the custom JSON remains the lossless format.

8. Add serialization tests:

   - mixed plain/bold text;
   - overlapping bold/italic;
   - links;
   - block metadata;
   - annotation references plus body blocks;
   - resolved annotation references;
   - nested annotation references in annotation body text;
   - multi-selection output order and plain text.

## Phase 3: Rich Paste Command Helpers

Implement rich paste as command-layer logic before wiring React events.

1. Expose or wrap the useful plain insertion primitive.

   `pastePlainTextDetailed` currently has the destination mapping needed for mark replay but is private. Either:

   - export a carefully named helper for rich paste internals; or
   - add a new rich paste helper in `blockCommands.ts` that shares the private implementation.

2. Add a rich paste command for one selection set:

   ```ts
   export const pasteRichClipboardEverywhere = (
       state: CachedState<RichBlockMeta>,
       selection: RetainedSelectionSet,
       payload: RichClipboardPayload,
       context: CommandContext,
   ): MultiCommandResult;
   ```

3. Insert fragments without markdown shortcuts.

   - For custom rich payloads, do not call `pastePlainTextWithMarkdownShortcuts`.
   - Insert text using the plain multi-line mechanics.
   - For multi-selection payloads, paste each serialized fragment as an adjacent block group at the destination.
   - Preserve block metadata by applying `setBlockMetaOps` to inserted destination blocks after insertion.

4. Replay inline marks over inserted ranges.

   - Map payload fragment ranges to destination block ids and offsets from the insertion result.
   - Apply boolean marks with `markRangeOp(..., undefined, false, ...)`.
   - Apply links with `markRangeOp(..., LINK_MARK, href, false, ...)`.
   - Apply annotation refs after annotation id mapping is prepared.

5. Reconstruct annotation ids and bodies.

   - Build an import map from source annotation id to destination annotation id.
   - If a matching annotation id already exists in the destination, reuse it and do not overwrite or append imported body blocks.
   - Otherwise allocate a fresh annotation id using the current actor/clock.
   - Create imported annotation body blocks under the fresh annotation id, preserving body text, metadata, and marks.
   - Recursively import annotation refs used inside annotation body content.
   - Apply pasted annotation marks with rewritten `AnnotationMarkData.id`.

6. Avoid `createAnnotation` for paste reconstruction.

   Use lower-level mark and block ops so paste can:

   - reuse or allocate annotation ids intentionally;
   - import body blocks before or after reference marks as needed;
   - avoid exact-source-char matching, which only makes sense inside the original document.

7. Define final selection after paste.

   - Place the caret at the end of the pasted content.
   - For multi-fragment paste, use the end of the last inserted fragment.
   - Keep behavior consistent with current paste commands.

8. Add command tests:

   - rich paste preserves bold;
   - rich paste preserves overlapping boolean marks;
   - rich paste preserves links;
   - rich paste preserves block metadata;
   - rich paste does not trigger markdown shortcuts;
   - same-document annotation paste reuses the existing annotation id and body;
   - cross-document annotation paste allocates a fresh id and imports body text/metadata/marks;
   - existing destination annotation body is not overwritten;
   - resolved annotations are copied;
   - nested annotations in annotation body text are imported;
   - multi-selection paste creates adjacent blocks in deterministic order.

## Phase 4: React Clipboard Wiring

Wire the new command helpers into `examples/block-rich-text/src/App.tsx`.

1. Add copy handling to editable block surfaces.

   - On `copy`, serialize the current retained selection set.
   - If serialization returns a payload, `preventDefault`.
   - Write:
     - custom JSON MIME;
     - `text/plain`;
     - `text/html`.
   - If serialization fails or the selection is empty, let the browser default behavior run.

2. Add rich paste handling for main editor paste.

   - Read the custom MIME type first.
   - If valid, `preventDefault` and call `pasteRichClipboardEverywhere`.
   - If missing/invalid, preserve the current plain-text behavior with markdown shortcuts.

3. Update annotation body paste.

   - Prefer the same custom rich payload when available.
   - Route annotation-body paste through the rich paste command if the command can target body selections.
   - If that proves too invasive, add a body-specific wrapper that uses the same serializer/replay helpers for a single body block.
   - Keep existing link-like text paste behavior for plain text only.

4. Keep selection restore behavior intact.

   - Ensure rich paste commands return retained selections in the shape expected by `runEditCommand`.
   - Schedule caret restoration the same way existing paste commands do.

5. Add UI tests in `App.test.tsx`.

   - Copy writes all three clipboard formats.
   - Main editor paste prefers the custom MIME data over plain text.
   - Invalid custom data falls back to `text/plain`.
   - Rich paste preserves bold/link styling in the rendered DOM.
   - Annotation copy/paste preserves/recreates annotation body data.
   - Multi-selection copy/paste creates adjacent pasted blocks.

## Phase 5: HTML Interop

Keep HTML support useful but bounded.

1. Emit HTML on copy as part of Phase 2.

2. Do not initially parse arbitrary external HTML into rich marks unless there is already a simple path available.

   - The requirement is to populate `text/html`, not necessarily consume rich external HTML.
   - Paste from this app should use the custom JSON payload.
   - External editors will still get plain text fallback if they paste into this app.

3. Add HTML snapshot-style tests.

   - Verify escaping.
   - Verify bold/italic/strikethrough/link tags.
   - Verify annotation data attributes.

## Phase 6: Verification

Run focused tests first:

```sh
pnpm exec vitest -- run examples/block-rich-text/src/clipboard.test.ts
pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts
pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

Then run the broader block-rich-text suite:

```sh
pnpm exec vitest -- run examples/block-rich-text/src
```

Manual checks in the demo:

- Copy/paste bold, italic, strikethrough, and linked text.
- Copy/paste text with a sidebar annotation in the same document; verify both references point to the same body.
- Export/open a separate document state if available, paste annotated text, and verify a fresh annotation body is created.
- Copy/paste a resolved annotation and verify it remains resolved.
- Copy two disjoint selections and verify paste creates adjacent blocks.
- Paste rich copied text beginning with markdown shortcut syntax and verify it stays literal.

## Implementation Notes

- Keep clipboard serialization and replay mostly DOM-free. React event handlers should only move data to/from `ClipboardEvent.clipboardData`.
- Keep the custom JSON payload authoritative. `text/html` is for interoperability and inspection, not for internal lossless paste.
- Avoid changing core `block-crdt` unless a missing primitive is discovered. The example layer already has mark and block ops needed for this.
- Be careful with annotation stacked marks. Use `formattedMarkValues` or equivalent helpers instead of reading only `run.marks`.
- Fresh annotation ids should come from normal local command clock/actor paths so imported ops sync like any other local change.
- When adding exports from existing modules, keep them narrow and test-driven so internal helpers do not become a large public surface accidentally.
