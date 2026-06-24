# Research: Block Rich Text JSON Import Format

## Goal

Add an example-layer "document import format" for `examples/block-rich-text` that lets callers describe a document as JSON blocks with metadata, child blocks, flat text content, and inline marks by grapheme index. Import JSON should not contain CRDT block ids or char ids. The importer should generate ids through normal CRDT ops.

Example target shape:

```json
[
  {"type": "paragraph", "content": "Hello world"},
  {
    "type": "todo",
    "meta": {"checked": true},
    "content": "Write a list",
    "children": [
      {"type": "paragraph", "content": "add a block"},
      {"content": "type in it", "marks": [{"type": "bold", "start": 0, "end": 4}]}
    ]
  }
]
```

`type` should be optional and default to `paragraph`.

## Relevant Current Model

The example's app-specific block metadata lives in `examples/block-rich-text/src/blockMeta.ts`:

```ts
export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
    | {type: 'todo'; checked: boolean; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'code'; language: string; ts: HLC}
    | {type: 'callout'; kind: 'info' | 'warning' | 'error'; ts: HLC}
    | {type: 'recipe_ingredient'; ts: HLC}
    | {type: 'table'; ts: HLC}
    | {type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC}
    | {type: 'preview'; url: string; preview: PreviewMetadata | null; ts: HLC};
```

Core CRDT operations already expose the building blocks the importer needs:

- `insertBlockOps` creates a block under a parent with before/after sibling anchors and generated Lamport ids.
- `insertTextOps` inserts text into a block by visible grapheme offset.
- `markRangeOp` / `markRangesOps` creates marks by visible block offsets.
- `applyMany` applies ops and updates cache.
- Text insertion segments by grapheme using `Intl.Segmenter` in `src/block-crdt/changes.ts`.
- Existing block commands apply ops incrementally after each operation, usually with `annotationVirtualParents(working)`.

`examples/block-rich-text/src/clipboard.ts` has a different JSON shape for internal copy/paste. It serializes full `RichBlockMeta` including `ts`, uses `text` rather than `content`, has flat `fragments`, and does not preserve a nested `children` tree. It is useful validation precedent, but it is not the desired import format.

## Recommended Import Shape

Keep the input intentionally app-level and stable:

```ts
export type ImportDocument = ImportBlock[];

export type ImportBlock = {
    type?: ImportBlockType;
    meta?: Record<string, unknown>;
    content?: string;
    marks?: ImportMark[];
    children?: ImportBlock[];
};

export type ImportBlockType =
    | 'paragraph'
    | 'heading'
    | 'list_item'
    | 'todo'
    | 'blockquote'
    | 'code'
    | 'callout'
    | 'recipe_ingredient'
    | 'table'
    | 'image'
    | 'preview';

export type ImportMark = {
    type: 'bold' | 'italic' | 'strikethrough' | 'code' | 'link';
    start: number;
    end: number;
    data?: unknown;
};
```

Notes:

- `content` defaults to `''`.
- `children` defaults to `[]`.
- Mark offsets are grapheme offsets into `content`, not UTF-16 indices.
- `start` is inclusive and `end` is exclusive, matching existing `markRangeOp` and clipboard mark validation.
- Mark ranges should be within one block. This matches `markRangesOps`, which rejects cross-block ranges.
- The importer should reject `children` entries that are not objects. It should not silently coerce malformed trees.

## Metadata Mapping

The import format should omit `ts`; the importer should add timestamps via `context.nextTs()`.

Suggested mapping:

- omitted `type` -> `{type: 'paragraph', ts}`
- `paragraph` -> `{type: 'paragraph', ts}`
- `heading` -> `{type: 'heading', level, ts}` with `meta.level` defaulting to `1`
- `list_item` -> `{type: 'list_item', kind, ts}` with `meta.kind` defaulting to `'unordered'`
- `todo` -> `{type: 'todo', checked, ts}` with `meta.checked` defaulting to `false`
- `blockquote` -> `{type: 'blockquote', ts}`
- `code` -> `{type: 'code', language, ts}` with `meta.language` defaulting to `''`
- `callout` -> `{type: 'callout', kind, ts}` with `meta.kind` defaulting to `'info'`
- `recipe_ingredient` -> `{type: 'recipe_ingredient', ts}`
- `table` -> `{type: 'table', ts}`
- `image` -> `{type: 'image', attachmentId, size, ts}`; require `meta.attachmentId`, default `size` to `'medium'`
- `preview` -> `{type: 'preview', url, preview: null, ts}`; require or default `url` is an open question

This keeps the import JSON concise but still maps cleanly onto the existing `RichBlockMeta` union.

## Implementation Sketch

Create a new helper in the example, likely `examples/block-rich-text/src/documentImport.ts`, rather than adding this to `src/block-crdt`. The format depends on `RichBlockMeta`, inline mark names, and UI-level block types.

Recommended public API:

```ts
export type ImportDocumentResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    blockIds: string[];
};

export function importDocument(
    state: CachedState<RichBlockMeta>,
    document: unknown,
    context: CommandContext,
    options?: {parentBlockId?: string; replaceExisting?: boolean},
): ImportDocumentResult;
```

Basic algorithm:

1. Parse and validate `document` as `ImportBlock[]`.
2. Convert each block's `type` + `meta` to `RichBlockMeta` with fresh `ts`.
3. Insert blocks depth-first using `insertBlockOps`, applying each op immediately.
4. Preserve sibling order by keeping the previously inserted sibling as `before` and `after: null`.
5. Insert `content` into the new block at offset `0` with `insertTextOps`.
6. Apply marks after the content is inserted, using `markRangeOp` with offsets from the import JSON.
7. Recurse into `children`, using the inserted block as the parent.

Pseudo-code for child insertion:

```ts
let previousSibling: string | null = null;
for (const child of children) {
    const blockOps = insertBlockOps(working, {
        actor: context.actor,
        parent,
        before: previousSibling ? working.state.blocks[previousSibling].id : null,
        after: null,
        meta: toRichBlockMeta(child, context),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, blockOps, annotationVirtualParents(working));
    const blockId = lamportToString(insertedBlockFromOps(blockOps).id);
    previousSibling = blockId;
    // insert content, marks, then children
}
```

For importing into an empty initial document, either:

- replace the initial empty paragraph with the first imported block's meta/content and insert remaining root blocks after it, or
- delete/ignore the initial block and insert all imported blocks under root.

The first option gives a better editing history for app-level import into the current example, but it is more code because the first block is not created through the same recursive path.

## Marks

Existing inline mark constants:

- boolean marks: `bold`, `italic`, `strikethrough`
- code mark: `code`, with optional language data support elsewhere
- link mark: `link`, with string data
- embeds and annotations exist but should probably not be part of the first document import format unless there is a clear need.

Validation should mirror clipboard mark rules:

- `start` and `end` must be integers.
- `0 <= start < end <= graphemeLength(content)`.
- Boolean marks may omit `data` or use `true`.
- `link` requires string `data` or a clearer field such as `href`.
- `code` may use no data, `true`, or possibly a language string if we want parity with stored code mark values.

Open-ended marks should not be part of this format; import should create bounded marks only.

## Tests To Add

Add focused tests near the example tests, likely `examples/block-rich-text/src/documentImport.test.ts`:

- default block type is paragraph.
- imports multiple root blocks in order.
- imports nested children in order and under the expected parent.
- imports todo metadata, heading level, list kind, code language, and callout kind.
- validates mark offsets by grapheme index, including emoji or combining-character content.
- applies boolean marks and link marks to the correct visible ranges, verified via `materializeFormattedBlocks`.
- rejects unknown block type, invalid metadata, non-string content, invalid children, and out-of-range marks.
- handles empty documents predictably.

## Open Questions

1. Should import replace the whole current document, append under root, or support both? The task says "document import format", which suggests whole-document replacement, but the example command layer often works as insert/paste.
    - replace the whole document
2. What should happen to the initial empty paragraph from `initialStateWithMeta` when importing a full document?
    - drop it
3. Should invalid import input throw detailed errors, return a structured validation result, or skip invalid blocks? For a document import format, fail-fast with path-aware errors seems best.
    - throw detailed errors. we should do strong validation on block metadata (maybe via typia?)
4. Should `type: 'list_item'` be the JSON spelling, or should the importer also accept friendlier aliases like `bulleted_list_item`, `ordered_list_item`, `bullet`, and `numbered`?
    - just match the current block type names. no need to complicate things
5. Should `marks` use `{type, start, end, data}` or special fields like `{type: 'link', href, start, end}`? The generic `data` shape matches CRDT marks, but `href` is nicer JSON for links.
    - yeah href is nice
6. Should rich block types that need external resources be included initially? `image` needs an attachment id, and `preview` may need preview metadata fetching elsewhere.
    - yeah let's support attachments. the fetching would be done by the client, and the preview metadata passed in with the example json. the importer should not do any fetches.
7. Should tables be represented as ordinary nested blocks, or should there be a stricter table-specific JSON shape with rows/cells? Current table behavior is encoded as a `table` block with child row blocks and child cell blocks, but row/cell metadata is not distinct.
    - normal nested blocks, nothing fancy
8. Should mark offsets be explicitly documented as grapheme offsets everywhere in UI copy/API naming, for example `startGrapheme`/`endGrapheme`, to avoid confusion with JavaScript string indices?
    - start/end, but document that it's graphemes
9. Do we need an export function for the same format now, or only import?
    - sure export would be great too
