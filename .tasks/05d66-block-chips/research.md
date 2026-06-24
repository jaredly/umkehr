# Research: Preview Chips/Cards Block Type

## Goal

Add a `Preview` block type to `examples/block-rich-text`. A preview block stores a URL in block metadata, renders a rich URL preview card/chip, uses the block text as an optional subtitle/description, and supports editing the URL after creation through a small top-right menu.

The preview data should come from site-specific resolvers where useful, then fall back to Open Graph metadata. Fetching should support an optional configurable CORS proxy because direct browser fetches of arbitrary URLs will often fail.

## Current Architecture

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/clipboard.test.ts`
- `examples/block-rich-text/src/style.css`

Block type data is already modeled as `RichBlockMeta` in `blockMeta.ts`. Every variant includes `ts: HLC`, and block metadata is updated through `setBlockMetaOps`, so this fits the existing LWW metadata model.

Current block meta variants include paragraph, heading, list item, todo, blockquote, code, callout, table, and image:

```ts
export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    // ...
    | {type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC};
```

The preview block should be another metadata variant, probably:

```ts
type PreviewPresentation = 'card' | 'chip';

type PreviewBlockMeta = {
    type: 'preview';
    url: string;
    presentation: PreviewPresentation;
    ts: HLC;
};
```

If only one visual form is desired initially, omit `presentation` and render one responsive card that collapses visually on small width. The task says "chips/cards", so this is an open product choice.

## Existing UI Integration Points

`App.tsx` owns the example UI. It already has the main extension points needed for preview blocks:

- `BlockTypeMenuValue` controls toolbar/slash block type values.
- `SLASH_COMMANDS` defines the slash menu.
- `blockTypeMeta` converts a menu value into `RichBlockMeta`.
- `blockTypeMenuValue` maps metadata back to the toolbar selected value.
- `renderEditableBlock` / `EditableBlock` special-case non-plain block rendering, currently image blocks.
- `BlockInlineControls` renders per-block controls for code, callout, and image.

The slash flow is:

1. User types `/`.
2. `insertTextWith...Everywhere` inserts the slash and opens `SlashCommandPopover`.
3. `runSlashCommand` deletes the slash with `deleteSlashTriggers`.
4. Block commands run via `setBlockTypeEverywhere` or a special command such as table/date.

Preview likely needs a special command rather than only `setBlockTypeEverywhere`, because selecting `Preview` should focus an empty URL input. For consistency with image insertion, add a command like `insertPreviewBlock` or `setPreviewBlockUrl` in `blockCommands.ts`.

## Recommended Implementation Shape

Add metadata support:

- Extend `RichBlockMeta` with `{type: 'preview'; url: string; ts: HLC}`.
- Update `sameTypeWithTs`.
- Decide whether `isEditableBlock` remains true for preview blocks. It can remain true if the block text is the subtitle and still uses the standard rich text editable surface.
- Update `isWholeSubtreeStyledBlock` only if preview children should visually group, which does not seem necessary.

Add commands:

- `insertPreviewBlock(state, selection, url, context)` or `setPreviewBlock(state, blockId, url, context)`.
- Mirror `insertImageBlock`: if current block is empty, convert it; if non-empty, insert a new preview block after the current block.
- Add URL edit command via `setBlockMeta`, preserving type and updating `ts`.
- When creating from the slash menu, use `url: ''` and select/focus the URL input.

Add UI:

- Add `'preview'` to `BlockTypeMenuValue`.
- Add slash command `{type: 'block', value: 'preview', label: 'Preview', ...}`.
- Add toolbar option only if preview should be reachable from the toolbar; the task only requires the slash menu.
- In `EditableBlock`, render `meta.type === 'preview'` as a preview container plus the standard editable surface for subtitle text.
- Empty state: if `meta.type === 'preview' && !meta.url`, render a URL textbox in the preview container. This should be `contentEditable={false}` and stop pointer/mouse/click propagation like existing inline controls.
- Filled state: render metadata result, plus a three-dot menu in the top-right with an edit URL action.
- Keep the rich text surface below or inside the card as the subtitle/description. If no text content exists, show normal placeholder behavior rather than storing fetched descriptions in CRDT text.

Add preview fetching:

- Keep fetched Open Graph data out of CRDT state unless there is a deliberate need to make previews deterministic/offline. The task says the URL is stored on block meta and text content is the subtitle, so fetched title/image/site name should be derived view state.
- Create a small `previewMetadata.ts` module with:
  - URL normalization/validation.
  - Known-site resolvers.
  - Open Graph HTML parsing fallback.
  - Optional proxy URL builder.
  - Cache keyed by normalized URL.
- The fetch layer should return states: idle, loading, loaded, failed, invalid.
- Use `AbortController` in the React effect so stale fetches from rapid URL edits do not update the wrong card.

Known-site special cases can start small and deterministic:

- YouTube: derive thumbnail/title-ish presentation from URL shape only, or use oEmbed if allowed by CORS/proxy.
- GitHub: parse repo/issue/PR paths and display owner/repo/path.
- X/Twitter, Bluesky, Figma, Notion, etc. should probably wait unless there is a concrete requirement, because special cases can become maintenance-heavy.

## CORS Proxy Design

Direct `fetch(url)` from the browser will often fail because arbitrary pages do not allow cross-origin reads. The implementation should not treat that as exceptional UX.

Suggested configuration:

- Add an optional app-level constant or prop, e.g. `previewCorsProxy?: (url: string) => string`.
- If omitted, try direct fetch and show a concise unavailable state when blocked.
- If provided, fetch `previewCorsProxy(normalizedUrl)`.
- Do not bake in a public proxy service by default.

For local tests, avoid network. Mock the metadata loader or inject a test resolver.

## Clipboard / Serialization

`clipboard.ts` validates block metadata in `isRichBlockMeta`. Add the preview case there or rich clipboard paste will reject preview fragments.

The HTML serializer already emits block metadata attributes for several types. Preview should preserve at least the URL in the rich clipboard payload. For plain HTML copied into external apps, render a normal link/card-ish fallback, but do not depend on fetched metadata.

Existing clipboard tests cover block metadata serialization and parser validation; add preview-specific cases.

## Selection, Editing, and Keyboard Behavior

Preview blocks can reuse the existing `RichTextEditableSurface` for subtitle text. The URL input and three-dot menu must stop editor events with `stopEditorControlEvent`, otherwise selection tracking, drag selection, slash menu closure, and keyboard handlers may interpret control interaction as editor edits.

Potential key behavior:

- `Enter` in the URL input should commit URL and focus the subtitle/editor surface.
- `Escape` should cancel URL editing and restore focus to the block.
- `Backspace/Delete` inside URL input should not run block text delete commands.
- Splitting a preview block should probably behave like image blocks: create a paragraph after it, rather than splitting preview metadata.

`splitBlock` already has image-specific behavior. Add preview to the same branch if preview should be atomic at the block level.

## Tests To Add

Focused unit tests:

- `blockCommands.test.ts`: converts an empty block to preview with empty URL.
- `blockCommands.test.ts`: inserts a preview block after a non-empty block.
- `blockCommands.test.ts`: syncs preview metadata to the peer replica.
- `blockCommands.test.ts`: splitting a preview creates a paragraph after it.
- `clipboard.test.ts`: preview block metadata parses and serializes.

App tests:

- Slash menu includes `Preview` and selecting it deletes `/`.
- Selecting `Preview` renders a URL textbox empty state.
- Entering a URL updates both replicas via metadata sync.
- Existing block text appears as the preview subtitle.
- Three-dot edit control reopens URL editing and updates the URL.
- Failed metadata fetch renders a stable fallback with the URL/domain.

Mock preview fetching in App tests rather than doing real network I/O.

## Open Questions

- Should the preview visual be one responsive card, a selectable `card`/`chip` presentation, or a heuristic based on viewport/content?
- Where should the optional CORS proxy be configured in this example: hardcoded constant, `App` prop, environment variable, or toolbar/debug setting?
- Should fetched Open Graph data be purely ephemeral view state, or should successful metadata be cached/stored in block meta for deterministic offline replay?
- Which well-known sites should be special-cased for the initial implementation?
- Should converting an existing non-empty paragraph with `/ Preview` preserve that text as the subtitle, or should the slash command always create an empty preview block with a URL box?
- Should toolbar block-type selection include `Preview`, or should preview creation be slash-menu only?
- What URL validation should be accepted: only absolute `http(s)` URLs, or should bare domains like `example.com` be normalized?
- Should the preview card be allowed inside table cells and annotation body blocks, or should slash command availability exclude those contexts?
- If a remote edit changes the URL while the local user is editing the URL textbox, should the local draft win on commit or should the UI surface the remote update?
