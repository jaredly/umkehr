# Plan: Inline Embeds

## Decisions From Research

- Use `\uFFFC` as the inline embed sentinel character.
- Store embed metadata as a singular `embed` inline mark over the sentinel character.
- Use the CRDT character id as the stable embed instance identity.
- Target embed updates by char id, not by stale block/offset.
- Allow embeds everywhere the editor can contain inline text, including code blocks, tables, and annotation bodies.
- Allow ordinary inline marks to overlap embeds; pass ambient marks to embed renderers.
- Use a DOM-based plugin API, matching the existing `renderRunNodes` rendering path.
- For external plain text copy, ask the embed plugin for a plain text rendering.
- Unknown embeds render as atomic fallback nodes.
- Preserve rich embeds through the app custom MIME clipboard format only; external HTML embed paste can wait.

## Phase 1: Embed Model and Helpers

Add `examples/block-rich-text/src/inlineEmbeds.ts`.

Define:

- `INLINE_EMBED_MARK = 'embed'`
- `INLINE_EMBED_TEXT = '\uFFFC'`
- `InlineEmbedData = {type: string; value: JsonValue}`
- `InlineEmbedPlugin`
- `InlineEmbedRenderContext`
- `InlineEmbedPlainTextContext`
- `InlineEmbedTarget = {charId: string}`

Implement helpers:

- `isInlineEmbedData(value)`
- `isInlineEmbedText(text)`
- `inlineEmbedDataForRun(run)`
- `plainTextForInlineEmbed(data, plugins, context)`
- `renderUnknownInlineEmbed(data | null, context)`
- `inlineEmbedPluginForType(type)`

Add a first built-in `date` plugin:

- Render as an atomic inline chip.
- Interpret `value` as an ISO date string or an object with a date string field, whichever is simplest and documented in the helper.
- Plain text render should return the displayed date.
- Invalid values should render through the unknown/fallback path or a date-specific invalid state.

Tests:

- Validate accepted/rejected embed payloads.
- Validate date plain text formatting.
- Validate unknown fallback behavior.

## Phase 2: Command Support

Update `examples/block-rich-text/src/blockCommands.ts`.

Add:

- `insertInlineEmbed(state, selection, data, context): CommandResult`
- `setInlineEmbedDataByCharId(state, charId, data, context): CommandResult | OptionalCommandResult`
- Helper to resolve a visible char id to `{blockId, offset}`.
- Helper to resolve an embed char id to the current one-character selection/range.

Insertion behavior:

1. Delete the current selection using existing selection deletion logic.
2. Insert `INLINE_EMBED_TEXT` at the resulting point.
3. Apply an `embed` mark over the inserted one-character range.
4. Return the caret after the embed.

Update behavior:

1. Find the current visible location for the char id.
2. Verify the character text is `INLINE_EMBED_TEXT`.
3. Apply a newer `embed` mark over that one-character range.
4. Preserve the current selection where possible.

Deletion behavior should not require special commands if DOM offsets are correct. Existing Backspace/Delete should delete one visible offset.

Tests:

- Insert embed into empty paragraph.
- Insert embed over selected text.
- Backspace/Delete removes one embed atom.
- Updating by char id still works after preceding text insertions.
- Split and join keep the embed character and mark reachable.
- Embeds can be inserted in code blocks, tables, and annotation bodies if current command helpers cover those surfaces.

## Phase 3: DOM Offset Mapping

Update `examples/block-rich-text/src/domSelection.ts`.

Introduce a single offset accounting convention:

- `data-offset-sentinel="true"` means width `0`.
- `data-inline-embed="true"` means width `1`.
- Normal text nodes count by `segmentText`.

Update:

- `pointFromDom`
- `textLengthBeforeChild`
- `domPointInBlockForOffset`
- `blockTextLength`
- any local helper that scans text nodes and assumes all non-sentinel content is text.

Caret restoration around embeds:

- Offset before an embed should resolve to a DOM point before the embed node.
- Offset after an embed should resolve to a DOM point after the embed node.
- If browser APIs cannot place the caret exactly around `contentEditable=false` atoms, add zero-width text caret anchors around embeds, marked so they do not affect logical offsets.

Mouse/click behavior:

- Clicking the left/right side of an embed should set the caret before/after the embed or open the embed editor, depending on exact target behavior.
- Clicking the embed body should open the embed editor and keep the embed atomic.

Tests:

- `readSelectionFromDom` returns expected offsets before and after an embed.
- `restoreCaretToDom` can restore offsets before and after an embed.
- `closestCaretOffsetForHorizontalIntent` treats the embed as one offset.
- Existing offset sentinels still count as zero.

## Phase 4: Rendering

Update `examples/block-rich-text/src/App.tsx` render helpers.

Modify the run chunking/render path so sentinel segments become embed nodes:

- Split chunks at embed sentinel boundaries.
- For non-embed chunks, preserve current span rendering and mark classes.
- For embed chunks, render one atomic DOM node with:
  - `contentEditable = 'false'`
  - `data-inline-embed = 'true'`
  - `data-embed-type`
  - `data-embed-char-id`
  - `data-embed-block-id`
  - `data-embed-start-offset`
  - accessible label from plugin/plain text/fallback
- Pass ambient marks to the plugin render context.
- Render unknown or missing `embed` mark data as an atomic fallback.

Important implementation detail:

- The current `FormattedRun` does not expose char ids. Rendering needs char ids for each embed node. Add a local helper that walks `orderedCharIdsForBlock(state, blockId, {visibleOnly: true})` and aligns them to formatted run offsets, or extend render context for each block with `charIdsByOffset`.
- Prefer a local example helper first. Avoid changing `materializeFormattedBlocks` unless the local mapping becomes too awkward.

Retained selection:

- Selection highlights should be able to cover an embed as one logical offset.
- Carets before/after embed offsets should render correctly.

Tests:

- Render valid date embed.
- Render missing/invalid mark as unknown embed.
- Verify embed DOM dataset includes char id.
- Verify retained selection highlight can include an embed.

## Phase 5: App UI and Popover

Add minimal user-facing controls in `EditorApp`.

Insertion:

- Add a toolbar button/menu item for inserting a sample date embed.
- Use the current primary selection.
- Insert default value, probably today or a fixed test-friendly date.

Editing:

- Add `EmbedPopoverState` keyed by char id.
- Add `embedTriggerFromEvent(root, target)`.
- On embed click, read `data-embed-char-id`, current plugin type/value, and anchor element rect.
- Render a small popover for the `date` plugin with an `<input type="date">`.
- On save/change, call `setInlineEmbedDataByCharId`.
- If the char id no longer resolves, close the popover.

Event behavior:

- Embed controls must stop propagation where appropriate so editing UI does not corrupt editor selection.
- Opening the embed popover should not allow selecting inside the embed node.

Tests:

- App-level test inserts a date embed from the toolbar.
- Clicking the date embed opens the editor popover.
- Changing the date updates the rendered chip.
- Remote/concurrent preceding text edits do not break editing by char id.

## Phase 6: Clipboard

Update `examples/block-rich-text/src/clipboard.ts`.

Custom MIME:

- Extend `ClipboardInlineMarkType` with `'embed'`.
- Preserve `embed` marks and payloads in `ClipboardMarkRange`.
- Validate embed mark data with `isInlineEmbedData`.
- Existing paste from custom MIME should recreate sentinel text plus mark ranges.

Plain text:

- When serializing selected text, replace embed sentinel characters with plugin `plainText`.
- Unknown embeds should use a clear fallback such as `[unknown embed]`.
- Do not leak raw `\uFFFC` into external plain text.

HTML:

- For copy, emit readable fallback HTML for embeds using plugin plain text and `data-umkehr-embed-*` attributes if straightforward.
- For paste, do not implement external HTML embed reconstruction in this pass. Only custom MIME needs to roundtrip real embeds.

Tests:

- Custom MIME copy/paste roundtrips date embed payload.
- Plain text copy uses plugin plain text.
- Plain text copy of unknown embed uses fallback text.
- Existing mark and annotation clipboard tests still pass.

## Phase 7: Styling and Polish

Update `examples/block-rich-text/src/style.css`.

Add styles for:

- Inline embed chip base.
- Date embed.
- Unknown embed fallback.
- Focus/hover/active states.
- Retained selection highlighting when an embed is selected.
- Embed popover controls.

Constraints:

- Keep the embed compact and inline with surrounding text.
- Do not let chip text resize line height dramatically.
- Make the unknown fallback visibly atomic but not visually loud.
- Ensure embed UI works inside code blocks and table cells without layout breakage.

Manual checks:

- Paragraph, heading, list item, todo, blockquote, callout, code block.
- Table title/cell.
- Annotation body.
- Side-by-side replicas with retained selection visible.

## Phase 8: Regression Pass

Run focused tests first:

- `examples/block-rich-text/src/inlineEmbeds.test.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/clipboard.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/retainedSelection.test.ts`

Then run the full block rich text test suite if practical.

Manual/browser verification:

- Start the example app.
- Insert a date embed.
- Navigate across it with arrow keys.
- Select across it by mouse and keyboard.
- Backspace/Delete it.
- Split/join around it.
- Copy/paste within the app.
- Copy plain text outside the app.
- Edit the embed after remote text insertion before it.

## Suggested Delivery Order

1. Model/helpers and command insertion/update.
2. Rendering plus DOM offset accounting.
3. Minimal date UI and click-to-edit.
4. Clipboard.
5. Broader tests and polish.

The highest-risk dependency is DOM offset accounting. The implementation should not add the visible app UI until render and selection behavior around a static embed is covered by tests.
