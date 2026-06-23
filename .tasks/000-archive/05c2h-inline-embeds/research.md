# Research: Inline Embeds in `examples/block-rich-text`

## Goal

Support inline embeds in the block rich text example. An inline embed should behave like a single editable character for navigation, selection, delete, copy/paste, split/join, and CRDT ordering, while rendering through a plugin-defined UI. Examples include `@mention` and `date` embeds.

The task proposal fits the current CRDT shape well: store an actual character as a sentinel and attach a valued inline mark with embed metadata. Rendering can then detect the sentinel, read its `embed` mark payload, and delegate to a registry keyed by embed type.

## Current Architecture

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/domSelection.ts`
- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/charUtils.ts`
- `examples/block-rich-text/src/localTextOps.ts`
- `src/block-crdt/marks.ts`
- `src/block-crdt/types.ts`

The CRDT already has the primitives needed for embeds:

- Characters are stable Lamport-id records with arbitrary one-segment `text`.
- Marks have string `type` and JSON `data`.
- `markRangeOp` can attach metadata to a one-character range.
- `materializeFormattedBlocks` returns formatted runs with `text`, `marks`, and optional stacked marks.
- Selection and commands are offset based, using `segmentText`, so a sentinel code point can count as one logical position.

The example renders formatted runs manually in `renderRunNodes`. It does not rely on React children inside the contenteditable surface after initial mount; it uses `element.replaceChildren(...)` with DOM nodes. That means inline embed rendering should probably be DOM-node based or wrapped by a small DOM adapter, not a normal React component tree, unless the editor render path is changed more broadly.

## Existing Constraints

### Selection and Navigation

`domSelection.ts` maps DOM selections by walking text nodes under `[data-block-id]`. Nodes marked with `data-offset-sentinel="true"` are ignored and do not contribute to offsets. This is used for decorations such as retained carets, footnote references, and trailing code newline sentinels.

For embeds, this behavior is not enough. A rendered embed may be non-text and `contentEditable=false`, but it must contribute exactly one offset. Otherwise clicking around it, restoring a caret near it, measuring horizontal arrow movement, and block text length calculations will drift from CRDT offsets.

Likely needed:

- A new DOM convention such as `data-inline-embed="true"`, `data-embed-start-offset`, and/or `data-offset-width="1"`.
- Updates to `pointFromDom`, `textLengthBeforeChild`, `domPointInBlockForOffset`, and `blockTextLength` so embed elements count as one offset while existing offset sentinels still count as zero.
- Careful click behavior for `contentEditable=false` embed nodes. Browsers often place the caret before or after atomic inline elements inconsistently, so explicit mouse/pointer handling may be needed.

### Rendering

`renderRunNodes` currently chunks runs by selection decoration and syntax highlight boundaries, then creates a span with `span.textContent = chunk.text`. This would render a sentinel as an invisible/control character unless the chunker recognizes it.

Likely needed:

- Define a sentinel constant, probably in a new `inlineEmbeds.ts`, for example `INLINE_EMBED_TEXT = '\uFFFC'`.
- Do not use `\0` unless tested thoroughly. It is a valid JS string character, but it tends to be awkward in DOM text, serializers, fixtures, and debugging. `\uFFFC` (object replacement character) is the common plain-text placeholder for embedded objects.
- Add helpers to split run text into per-segment chunks when a segment is the embed sentinel.
- For a sentinel segment, inspect the marks for a valid `embed` payload and render either the registered embed renderer or an unknown fallback.
- Preserve existing mark classes around non-embed text. For embed nodes, decide whether ambient marks like bold/link/code should decorate the embed shell or be ignored.

### Commands

Most text editing commands already operate by visible offsets:

- `insertTextAtPoint` inserts one CRDT character per text segment.
- `deleteBackward` and `deleteForward` delete exactly one visible offset when collapsed.
- Range delete uses `deleteRangeOps`.
- Split/join operations are character-id based underneath and should carry a sentinel character like any other character.

That means basic atomic behavior can be obtained if the embed is one visible character. The missing command-level API is insertion/update:

- Add an `insertInlineEmbed` command that deletes the current selection, inserts the sentinel, applies an `embed` mark over that one-character range, and returns a caret after the embed.
- Add an update command for editing payloads. Since marks are immutable ops with LWW behavior per mark type, updating can be another `embed` mark over the same one-character range with a later id and new payload.
- Consider a removal command for the popover UI. Plain Backspace/Delete should work if the caret offsets are correct.

The mark should probably be singular/non-stacking, like `link` and `code`, so `materializeFormattedBlocks` will expose the latest non-removed `embed` payload at `run.marks.embed`.

### Mark Shape

A reasonable first schema:

```ts
export const INLINE_EMBED_MARK = 'embed';
export const INLINE_EMBED_TEXT = '\uFFFC';

export type InlineEmbedData = {
    type: string;
    value: JsonValue;
};
```

Validation helper:

```ts
isInlineEmbedData(value): value is InlineEmbedData
```

This keeps the CRDT generic and puts plugin semantics in the example layer. The CRDT mark `data` type is already `JsonValue`, so payloads must remain JSON serializable.

### Plugin Registry

The "pluginable" part can be an example-local registry rather than a CRDT-level plugin system.

Possible shape:

```ts
type InlineEmbedPlugin = {
    type: string;
    render(value: JsonValue, context: InlineEmbedRenderContext): HTMLElement;
    plainText?(value: JsonValue): string;
    label?(value: JsonValue): string;
    openEditor?(request: InlineEmbedEditRequest): void;
};
```

Because the editor render pipeline creates DOM nodes directly, `render` returning `HTMLElement` fits the current code. A React-based plugin API would require either mounting mini React roots into the contenteditable surface or refactoring the render path.

The first implementation should include one built-in plugin to prove the path, probably `date`, because it has a compact display and a natural edit popover.

### Popover / Editing UI

The app already has link, code, and annotation popovers with hover/click detection based on `data-*` attributes. Inline embeds can follow that pattern:

- Render embed nodes with `data-inline-embed`, `data-embed-type`, `data-embed-block-id`, `data-embed-start-offset`, and `contentEditable="false"`.
- Add `embedTriggerFromEvent` like `linkTriggerFromEvent` and `codeTriggerFromEvent`.
- Track an `EmbedPopoverState` in `EditorApp`.
- On click, open the registered editor popover for the selected embed.
- On save, resolve the current block/offset to the one-character range and write a newer `embed` mark.

Open concern: offset-based popover state can go stale after remote edits. It may be better to store the embed character id in DOM metadata and popover state, then resolve to current block/offset when applying updates. `orderedCharIdsForBlock` can map offsets to char ids, and the CRDT state can map a char id back to its current visible offset with a helper.

### Clipboard

`clipboard.ts` currently serializes selected blocks into:

- custom JSON MIME: `application/x-umkehr-block-rich-text+json`
- plain text
- HTML

It preserves `bold`, `italic`, `strikethrough`, `link`, and `annotation`. Embeds need an explicit decision.

Recommended first behavior:

- Custom JSON: preserve embed sentinel text plus an `embed` mark range with data.
- HTML: emit something like `<span data-umkehr-embed-type="date" data-umkehr-embed-value="...">display text</span>`.
- Plain text: use plugin `plainText(value)` or `label(value)`, falling back to `[unknown embed]`.
- Paste from the app's custom MIME should restore real embeds.
- Paste from external HTML can be deferred unless needed; if implemented, parse `data-umkehr-embed-*`.

Important: if plain text uses display text rather than the sentinel, external paste will intentionally degrade to normal text.

### Serialization / History

The demo history records local changes as ops, so embeds inserted as char-plus-mark ops should replay naturally. `serializeHistory` should not need special handling as long as mark payloads stay JSON.

Potential issue: any test fixtures or text export paths that assume printable text may expose `\uFFFC`. Search and update only user-visible paths.

## Implementation Plan

1. Add `inlineEmbeds.ts`
   - Constants: `INLINE_EMBED_MARK`, `INLINE_EMBED_TEXT`.
   - Types and validators for `InlineEmbedData`.
   - Registry types and a built-in `date` plugin.
   - Helpers for display/plain text and unknown fallback.

2. Add command helpers
   - `insertInlineEmbed(state, selection, data, context)`.
   - `setInlineEmbedData(state, target, data, context)` where `target` should ideally resolve by char id, not only offset.
   - Unit tests covering insertion, deletion, split, join, and payload update.

3. Update rendering
   - Teach `runRenderChunks` / `renderRunNodes` to split out sentinel segments.
   - Render valid embed nodes via registry.
   - Render invalid/missing embed mark as an "unknown embed" atom that still counts as one offset.
   - Keep retained selection/caret rendering correct at offsets before and after embeds.

4. Update DOM selection mapping
   - Count embed elements as one logical offset.
   - Restore caret before/after embeds correctly.
   - Ensure `readPointFromMouseEvent`, vertical movement helpers, and text length helpers use the same offset rules.

5. Add UI affordances
   - Add a minimal insert action for a sample embed, probably in the toolbar or a small test-only/demo control.
   - Add click-to-edit popover for the sample embed.
   - Keep plugin editor API small and example-local.

6. Update clipboard
   - Extend `ClipboardInlineMarkType` with `embed`.
   - Validate embed payloads.
   - Preserve embed marks in custom MIME.
   - Render HTML/plain text fallbacks deliberately.

7. Test
   - Unit test inline embed helpers and commands.
   - DOM tests for caret restore/read around an embed.
   - Clipboard roundtrip tests.
   - App-level test for insertion, click-to-edit, deletion, and retained selection around embed offsets.

## Risks

- Browser selection around `contentEditable=false` inline elements is inconsistent. This is the largest implementation risk.
- If embed nodes do not contribute to offset accounting everywhere, bugs will show up as off-by-one deletes, wrong caret restore, and retained selections painting the wrong range.
- A React plugin API does not fit the current direct DOM rendering path without extra lifecycle management.
- Applying ordinary inline marks to embeds could produce confusing semantics. Decide whether embeds can also be bold/link/code or whether the embed mark should dominate rendering.
- Clipboard and plain text degradation must be intentional to avoid leaking invisible sentinel characters.

## Open Questions

- Which sentinel should be used? Recommendation: `\uFFFC` over `\0`, but this should be confirmed against the intended plain-text/export behavior.
    -> \uFFFC looks great
- Should embed payloads include a stable instance id, or is the CRDT character id enough identity for editing and plugin state?
    -> CRDT character id is stable, so I think it's enough
- Should embed updates target by current block/offset, by retained selection, or by char id captured from the rendered node?
    -> char id
- Are embeds allowed inside code blocks, table titles/cells, annotations, and other virtual-parent surfaces?
    -> yes everywhere
- Can ordinary inline marks overlap embeds? If yes, should renderers receive ambient marks? If no, should commands prevent applying them to sentinel characters?
    -> sure let's have renderers receive ambient marks
- What should copy/paste do when moving content outside the app: display label, markdown-like token, or nothing?
    -> the renderer should provide a 'plain text render' function for that case
- What plugin API is expected long term: DOM renderers that fit the current editor, or React components mounted through a managed bridge?
    -> DOM renderers sounds great
- Should unknown embed payloads be editable/removable, or only displayed as an atomic fallback?
    -> displayed as atomic fallback
- Do we need external HTML paste support for embeds in the first pass, or only custom MIME roundtrip?
    -> custom MIME roundtrip for now
