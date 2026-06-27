# Plan: Block Rich Text JSON Import/Export

## Decisions From Research

- The JSON format is app-level, not a core `block-crdt` serialization format.
- Import replaces the whole document.
- The starter empty paragraph from `initialStateWithMeta` should be dropped.
- Invalid input should throw detailed, path-aware errors.
- Block `type` names should match current `RichBlockMeta['type']` names exactly.
- Link marks should use `href`, not generic `data`.
- Image blocks and preview blocks should be supported; preview metadata is passed in JSON, and the importer does not fetch.
- Tables are represented as normal nested blocks.
- Mark `start`/`end` names stay short, but must be documented as grapheme offsets.
- Add export for the same format.

## Phase 1: Define The Public Format

Create `examples/block-rich-text/src/documentImport.ts` or a broader `documentFormat.ts` if import and export live together.

Define exported types:

```ts
export type ImportDocument = ImportBlock[];
export type ExportDocument = ExportBlock[];
```

Use one shared block shape if practical:

```ts
export type DocumentBlock = {
    type?: DocumentBlockType;
    meta?: DocumentBlockMeta;
    content?: string;
    marks?: DocumentMark[];
    children?: DocumentBlock[];
};
```

Define exact block type names:

- `paragraph`
- `heading`
- `list_item`
- `todo`
- `blockquote`
- `code`
- `callout`
- `recipe_ingredient`
- `table`
- `image`
- `preview`

Define mark shape:

```ts
export type DocumentMark =
    | {type: 'bold' | 'italic' | 'strikethrough'; start: number; end: number}
    | {type: 'code'; start: number; end: number; language?: string}
    | {type: 'link'; start: number; end: number; href: string};
```

Keep `content`, `marks`, and `children` optional on input, defaulting to empty values. Export can omit empty optional fields for concise JSON.

## Phase 2: Validation And Metadata Conversion

Implement hand-written validation with path-aware errors, matching existing example style. Avoid adding `typia` unless we intentionally wire it into the example package/build; it is present at the repo root but not currently an example dependency.

Add an error helper:

```ts
class DocumentFormatError extends Error {
    constructor(path: string, message: string) {
        super(`${path}: ${message}`);
    }
}
```

Validation requirements:

- Root input must be an array.
- Each block must be an object.
- `type`, when present, must be a known exact block type.
- `content`, when present, must be a string.
- `marks`, when present, must be an array.
- `children`, when present, must be an array of block objects.
- Mark offsets must be integers and satisfy `0 <= start < end <= graphemeLength(content)`.
- Mark offsets are grapheme offsets, not UTF-16 indexes.
- `link.href` must be a non-empty string.
- `code.language`, when present, must be a string and should normalize through existing code-language helpers.

Metadata mapping:

- missing/`paragraph`: no metadata required.
- `heading`: `meta.level` must be `1 | 2 | 3`, default `1`.
- `list_item`: `meta.kind` must be `ordered | unordered`, default `unordered`.
- `todo`: `meta.checked` must be boolean, default `false`.
- `blockquote`: no metadata.
- `code`: `meta.language` string, default `''`, normalized with `normalizeStoredCodeLanguage`.
- `callout`: `meta.kind` must be `info | warning | error`, default `info`.
- `recipe_ingredient`: no metadata.
- `table`: no special metadata; children are normal nested blocks.
- `image`: require `meta.attachmentId`; `meta.size` defaults to `medium` and must be a valid `ImagePresentationSize`.
- `preview`: require `meta.url`; `meta.preview` may be `null` or a `PreviewMetadata` object. No fetching.

## Phase 3: Whole-Document Import

Implement:

```ts
export function importDocument(
    document: unknown,
    context: CommandContext,
): ImportDocumentResult;
```

The result should include:

```ts
export type ImportDocumentResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    blockIds: string[];
};
```

Because import replaces the whole document, the importer can create a fresh state instead of mutating an existing state:

1. Validate the input and convert it to an internal parsed tree.
2. Start from an empty cached state with no starter block.
3. Insert each root block under the CRDT root in order.
4. Insert child blocks under their parent block in order.
5. Insert content at offset `0`.
6. Apply marks after content insertion.
7. Return the final state, all ops, and root imported block ids.

Implementation detail: there is no public `emptyInitialStateWithMeta`, so either:

- add a small local empty-state constructor in the example, matching `State<RichBlockMeta>` with empty `blocks/chars/marks/splits/joins` and `maxSeenCount: 0`, then wrap with `cachedState`, or
- add a core helper if this seems generally useful.

Prefer the local helper first to keep scope tight.

When inserting siblings, preserve order by passing the previous sibling as `before` and `after: null` to `insertBlockOps`. Apply each op before creating the next so sibling anchors and generated ids are current.

Use `annotationVirtualParents(working)` consistently with existing block command behavior.

## Phase 4: Mark Import

Convert document marks to CRDT marks after block text exists.

Mapping:

- `bold`, `italic`, `strikethrough`: `markRangeOp(..., type, undefined, false, id)`
- `code` without language: `markRangeOp(..., CODE_MARK, undefined, false, id)`
- `code` with language: `markRangeOp(..., CODE_MARK, normalizedLanguage, false, id)`
- `link`: `markRangeOp(..., LINK_MARK, href, false, id)`

Use fresh Lamport ids from `working.state.maxSeenCount + 1` and the import actor for each mark op, following existing command patterns.

Do not support annotation or inline embed marks in this first format unless a later task asks for them.

## Phase 5: Export

Implement:

```ts
export function exportDocument(state: CachedState<RichBlockMeta>): ExportDocument;
```

Export should produce the same format accepted by import:

1. Walk the visible block tree, preserving child nesting with `visibleBlockChildren` or `visibleBlockOutline`.
2. Use `blockContents` for `content`.
3. Convert `RichBlockMeta` to `{type, meta}` without `ts`.
4. Omit `type` for paragraph only if we want maximally concise output; otherwise always include it for round-trip clarity. Pick one behavior and test it.
5. Use `visibleRangesForMark` or `materializeFormattedBlocks` to recover inline mark ranges.
6. Emit mark offsets as grapheme offsets.
7. Emit links as `{type: 'link', start, end, href}`.
8. Emit code marks with `language` only when stored code mark data is a string.

Export metadata mapping:

- `heading`: `{level}`
- `list_item`: `{kind}`
- `todo`: `{checked}`
- `code`: `{language}` when non-empty, or include empty string for exactness.
- `callout`: `{kind}`
- `image`: `{attachmentId, size}`
- `preview`: `{url, preview}`
- no `meta` for paragraph, blockquote, recipe ingredient, or table unless needed for consistency.

Round-trip target:

- `exportDocument(importDocument(input).state)` should be structurally equivalent to a normalized form of `input`.
- Normalization may add defaulted metadata and omit empty fields.

## Phase 6: Tests

Add `examples/block-rich-text/src/documentImport.test.ts` or `documentFormat.test.ts`.

Import tests:

- imports an empty array to an empty visible document.
- drops the initial starter paragraph by constructing a fresh imported state.
- defaults missing `type` to paragraph.
- imports multiple root blocks in order.
- imports nested children in order and under the expected parent.
- imports all metadata-bearing block types.
- imports image metadata.
- imports preview metadata and performs no fetch.
- represents tables as normal nested blocks.
- applies bold, italic, strikethrough, code, code-with-language, and link marks.
- validates mark offsets by grapheme index with emoji or combining-character content.
- throws path-aware errors for unknown block type, malformed `meta`, non-string `content`, invalid `children`, invalid mark ranges, and missing image/preview required fields.

Export tests:

- exports root blocks and nested children in order.
- exports metadata without timestamps.
- exports marks with grapheme offsets and link `href`.
- round-trips a representative document through import then export.
- round-trips image and preview block metadata.

Useful assertions:

- `rootBlockIds`
- `visibleBlockChildren`
- `blockContents`
- `materializeFormattedBlocks`
- `visibleRangesForMark`

## Phase 7: Integration Points

Decide where this is consumed in the example UI:

- If only tests need it for now, export the helpers from the module and stop there.
- If the app should expose file import/export, add UI separately so the format logic stays testable and independent.

Keep fetches, attachment storage, and preview metadata loading out of the importer. The client is responsible for providing attachment ids and preview metadata in the JSON.

## Verification

Run focused tests first:

```sh
npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts
```

Then run broader checks:

```sh
npm run typecheck:examples
npm test
```

