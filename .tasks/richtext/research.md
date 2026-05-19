# Collaborative rich text CRDT research

This note looks at what it would take to add an in-house collaborative rich text field to umkehr without breaking the current design principle: app state is ordinary UI-facing data, and CRDT metadata stays in the CRDT layer.

The short version:

- Do not model collaborative rich text as a plain `string` with last-writer-wins replacement. That is only acceptable for commit-on-blur notes.
- The direction is an in-house, first-class "special CRDT field" whose public state value is a lightweight typed sentinel, while the authoritative document content lives in `CrdtMeta`.
- The UI layer probably does need a richer editor adapter API, but it does not need to see character IDs, tombstones, span endpoint IDs, clocks, or internal CRDT paths.
- Type-level builder support is feasible with a branded/annotated type such as `RichCollaborativeText`.
- Runtime detection should not rely on a TypeScript brand alone. The best match for the existing schema-derived architecture is a typia `tags.JsonSchemaPlugin` marker, for example `x-umkehr-crdt: "rich-text"`.
- Yjs and Automerge should be treated as prior art and interop references, not implementation dependencies.

## Current constraints

The existing CRDT implementation is schema-driven and metadata-hidden:

- `createCrdtDocument(initial, schema, options)` builds `meta` from a typia JSON schema and an initial JSON-like state.
- `CrdtMeta` mirrors the state tree with special metadata for primitives, objects, records, arrays, tagged unions, and tombstones.
- User-facing `doc.state` is materialized from metadata and contains no CRDT IDs, clocks, tombstones, or array order keys.
- Local edits are authored as ordinary umkehr patches, then translated into CRDT updates with stable CRDT path segments.
- Schema walking decides whether a path segment is an object field, record entry, array item, or tagged union branch.

That architecture is a good fit for JSON object collaboration. Rich text is different because the thing the user thinks of as one field is internally a nested CRDT: characters, marks, block markers, embeds, and span boundary behavior.

If the field remains an ordinary `string`, concurrent character edits collapse to last-writer-wins. That is not "collaborative rich text"; it is field-level replacement.

## Decision

Implement a native, Peritext-like rich text CRDT and a native editor binding. Do not embed Yjs or Automerge as the engine for rich-text fields.

The native implementation should use the same replication posture as the rest of umkehr:

- JSON-ish update payloads where possible;
- HLC timestamps and deterministic ordering;
- schema-derived field recognition;
- CRDT paths to locate the rich-text field in the larger document;
- rich-text-specific anchors inside that field;
- hidden metadata with derived render/editor views.

This gives umkehr one coherent CRDT protocol, one validation story, and one history/undo model. The cost is that the first implementation must be deliberately scoped and tested as a CRDT algorithm, not just an editor feature.

## Prior art

Yjs has `Y.Text`, described as a shared type for text and rich text. It supports insertion, deletion, range formatting, string output, and Quill Delta output via `toDelta()`. It can also be nested inside other Yjs shared types.

Yjs is useful as a benchmark for editor ergonomics, awareness/presence expectations, and Delta-style interop. It is not the chosen internal implementation because it would put a second CRDT engine inside umkehr and make rich-text updates opaque to umkehr's validation/history layers.

Automerge supports rich text on top of its document model with text marks, block markers, spans, and APIs such as `mark`, `marks`, `splitBlock`, `updateBlock`, `block`, `spans`, and `updateSpans`. Its documented model separates inline formatting marks from block markers, and has an interoperability-oriented rich text schema.

Automerge is useful as a model for the derived render/export shape: text spans plus block markers are renderable JSON and close to what editors need. It is not the chosen engine because its operations are tied to Automerge documents rather than umkehr `CrdtPathSegment`s and HLC history.

Peritext is a published rich-text CRDT algorithm. Its core idea is to store formatting spans alongside a plaintext character sequence, with span endpoints linked to stable character identifiers, then derive the final formatted text deterministically. The paper explicitly focuses on preserving rich-text editing intent under concurrency.

Peritext is the closest conceptual fit for umkehr's in-house algorithm. The implementation does not have to copy it verbatim, but it should use the same broad shape: stable character identity, tombstoned deleted characters, spans anchored to character identities, and deterministic materialization.

## Native model

The rich-text field should be a leaf in the ordinary umkehr state tree and a nested CRDT inside `CrdtMeta`:

```ts
type RichTextMeta = {
    kind: 'richText';
    created: HlcTimestamp;
    chars: Record<RichTextCharId, RichTextCharMeta>;
    spans: Record<RichTextSpanId, RichTextSpanMeta>;
    blocks: Record<RichTextBlockId, RichTextBlockMeta>;
};

type RichTextUpdate =
    | {op: 'textInsert'; path: CrdtPathSegment[]; after: Anchor; text: string; marks?: Marks; ts: HlcTimestamp}
    | {op: 'textDelete'; path: CrdtPathSegment[]; range: AnchoredRange; ts: HlcTimestamp}
    | {op: 'textMark'; path: CrdtPathSegment[]; range: AnchoredRange; name: string; value: JsonValue; expand: Expand; ts: HlcTimestamp}
    | {op: 'textBlock'; path: CrdtPathSegment[]; at: Anchor; value: BlockValue; ts: HlcTimestamp};
```

The first native surface should be narrower than a full document editor:

- plaintext characters;
- paragraph blocks;
- heading blocks if cheap;
- inline marks: `strong`, `em`, `code`, `link`;
- paste as plaintext first, then structured paste later;
- no tables, nested lists, comments, suggestions, collaborative selections, or embeds in the first pass.

Structured JSON rich text using ordinary arrays/records is still useful as a derived render/export view, but it should not be public state and should not be the replicated editing model. Text edits inside leaf strings would still be last-writer-wins, and run splitting/normalization would fight the CRDT layer.

## Public State

The public state should contain a typed sentinel, not a materialized rich-text snapshot:

```ts
type RichCollaborativeText = {
    kind: 'rich-text';
    version: 1;
    id?: string;
};
```

The sentinel's job is to make the field visible to TypeScript, typia schema generation, validation, and the patch builder. It is not the source of truth for the rich-text content.

The actual renderable document is a derived view:

```ts
type RichTextRenderView = {
    blocks: RichTextBlock[];
};

type RichTextBlock =
    | {
          type: 'paragraph';
          spans: RichTextSpan[];
      }
    | {
          type: 'heading';
          level: 1 | 2 | 3;
          spans: RichTextSpan[];
      };

type RichTextSpan = {
    text: string;
    marks?: RichTextMarks;
};
```

This avoids duplicating chars/spans/blocks between public state and CRDT metadata. Character IDs, tombstones, deleted spans, clocks, causal dependencies, and pending operations stay in `RichTextMeta`; render/export/editor views are computed from that metadata.

The public state remains clean:

```ts
import type {RichCollaborativeText} from 'umkehr/richtext';

type State = {
    title: string;
    body: RichCollaborativeText;
    comments: Record<string, {
        author: string;
        body: RichCollaborativeText;
    }>;
};
```

The tradeoff is that `doc.state` is no longer a complete content snapshot for rich-text fields. Persistence and replication already need `CrdtDocument.meta` for CRDT correctness, so this is acceptable. For export, read-only rendering, or server snapshots, provide explicit materializers such as `materializeRichText(doc, path)` or `exportRichText(doc, path)`.

Initial content should not be a special `createCrdtDocument` option. The default sentinel creates an empty rich-text document. Non-empty initial documents can be produced by dispatching the same rich-text replace command used for import, paste-over-all, migrations, and tests:

```ts
let doc = createCrdtDocument(initialState, schema, {timestamp: seedTimestamp});
doc = applyLocalRichTextCommand(doc, $.body.$text.replace(richTextFromPlainText('Hello')), ts);
```

The exact helper names can change, but the principle is that initialization is a normal timestamped rich-text operation after document creation. Peers that need the same non-empty initial content should receive/replay that first rich-text update with the rest of the CRDT log.

## Derived Views

There should be two derived views:

```ts
type RichTextRenderView = {
    blocks: RichTextBlock[];
    plainText: string;
};

type RichTextEditorView = RichTextRenderView & {
    anchors: RichTextAnchorMap;
    selection: RichTextSelectionModel;
};
```

The render view is for normal UI. It has no CRDT internals and can be serialized for export.

The editor view can expose stable view-local anchors, position mapping, and selection rebasing helpers. Those are still not raw CRDT metadata; they are an editor-facing read model derived from metadata. The key point is that the editor is not limited to `doc.state.body`, so it can update local selections correctly after remote changes.

## Metadata visibility

This case does not require exposing CRDT metadata to the end-user/UI layer.

It does require exposing rich-text operations or an editor binding. Those are not metadata; they are domain operations.

For example, the UI should be allowed to say:

```ts
editor.$.body.$text.insert(selection.anchor, 'hello');
editor.$.body.$text.mark(selection.range, 'strong', true);
editor.$.body.$text.splitBlock(selection.anchor, {type: 'paragraph'});
```

The UI should not need to say:

```ts
insert after char id "01H...";
create span endpoint before tombstoned char "01J...";
set parentCreated to "clock...";
```

That mirrors the current array design: callers use numeric array positions, while CRDT update translation uses stable array item IDs and fractional order keys internally.

## Required core changes

### Add a new metadata node kind

Extend `CrdtMeta`:

```ts
export type RichTextMeta = {
    kind: 'richText';
    created: HlcTimestamp;
    chars: Record<RichTextCharId, RichTextCharMeta>;
    spans: Record<RichTextSpanId, RichTextSpanMeta>;
    blocks: Record<RichTextBlockId, RichTextBlockMeta>;
};
```

Then update:

- `buildMeta`: if schema is a rich-text schema, build `RichTextMeta` instead of ordinary object/string metadata.
- `cloneMeta`: `structuredClone` can still work because the native metadata should stay JSON-shaped.
- `versionOf` / `createdOf`: return `created` for rich text.
- `materialize`: emit only the `RichCollaborativeText` sentinel into `doc.state`; rich-text content is materialized through explicit rich-text view helpers.
- `getChild` / path walking: rich text should be a leaf for ordinary object navigation.
- `applyCrdtUpdate`: route rich-text operations to a rich-text reducer.
- `changedNormalPathsForCrdtUpdate`: rich-text operations invalidate the owning field path.
- validation: recognize rich-text update envelopes and validate the sentinel shape plus rich-text operation invariants.

### Use stable anchors internally

The public API can accept index-based positions because that is what browser/editor selections naturally produce. The replicated update should not store those indices. Translation should resolve indices against the current rich-text metadata into stable anchors before replication.

Suggested anchor shape:

```ts
type RichTextAnchor =
    | {type: 'start'}
    | {type: 'end'}
    | {type: 'char'; id: RichTextCharId; bias?: 'before' | 'after'};

type RichTextRange = {
    start: RichTextAnchor;
    end: RichTextAnchor;
};
```

The same principle already exists for arrays: callers address array positions by numeric index, while CRDT updates address stable item IDs and order keys. Rich text should follow that pattern.

### Character storage

Use one stable ID per inserted character or per inserted run with deterministic sub-IDs. Per-character IDs are simpler and probably fine for a first version.

```ts
type RichTextCharMeta = {
    id: RichTextCharId;
    value: string;
    after: RichTextAnchor;
    ts: HlcTimestamp;
    deleted?: HlcTimestamp;
};
```

Ordering is derived by following insertion anchors plus deterministic timestamp/id tie-breaking for concurrent inserts at the same anchor. Deleted characters remain in metadata so older spans and delayed operations can still resolve anchors.

If per-character metadata becomes too large, compaction can later replace runs that are causally stable and no longer needed as anchors. That is a later optimization, not a first-pass requirement.

### Span storage

Formatting should be represented as CRDT spans, not by mutating every character:

```ts
type RichTextSpanMeta = {
    id: RichTextSpanId;
    name: string;
    value: JsonValue;
    start: RichTextAnchor;
    end: RichTextAnchor;
    expand: 'none' | 'before' | 'after' | 'both';
    ts: HlcTimestamp;
    deleted?: HlcTimestamp;
};
```

Materialization projects live spans onto live characters, splits output where marks change, and emits compact `RichTextSpan[]` inside each block. Concurrent spans with the same mark name should resolve deterministically. For boolean marks such as `strong`, same-name live spans can coalesce at render time. For scalar marks such as `link`, conflicts need a deterministic policy, probably newest span wins by HLC timestamp with ID tie-break.

### Block storage

Blocks can start as paragraph boundaries anchored into the character stream:

```ts
type RichTextBlockMeta = {
    id: RichTextBlockId;
    type: 'paragraph' | 'heading';
    attrs?: Record<string, JsonValue>;
    start: RichTextAnchor;
    ts: HlcTimestamp;
    deleted?: HlcTimestamp;
};
```

The first block can be implicit at document start. `splitBlock` inserts a new block marker at an anchor. `mergeBlock` can be represented as deleting a block marker. This is enough for paragraphs and simple headings without modeling nested document structure in the first pass.

### Add rich-text CRDT updates

Do not encode character edits as ordinary `set` on `body`.

Add variants such as:

```ts
type CrdtUpdate =
    | CrdtSetUpdate
    | CrdtDeleteUpdate
    | CrdtSetOrderUpdate
    | CrdtRichTextUpdate;

type CrdtRichTextUpdate = {
    op: 'richText';
    path: CrdtPathSegment[];
    change: RichTextChange;
    ts: HlcTimestamp;
};
```

The native change payload should stay JSON-shaped:

```ts
type RichTextChange =
    | {kind: 'insert'; at: RichTextAnchor; text: string; attrs?: Record<string, JsonValue>}
    | {kind: 'delete'; range: RichTextRange}
    | {kind: 'mark'; range: RichTextRange; name: string; value: JsonValue; expand: 'none' | 'before' | 'after' | 'both'}
    | {kind: 'block'; at: RichTextAnchor; value: RichTextBlock};
```

The path still names the rich-text field using the existing stable CRDT path machinery. The nested rich-text change then uses rich-text anchors, not ordinary umkehr paths.

### Keep replace/import semantics

The ordinary builder `$replace` method should probably remain available for the sentinel itself, but it should not be the normal rich-text content API. A replacement of the rich-text content should be explicit on the rich-text command surface:

```ts
editor.$.body.$text.replace(snapshot);
```

That means "replace the whole rich text document with this imported/exported content" and creates a new rich-text field incarnation in metadata.

This is useful for initialization, import, paste-over-all, reset, migrations, and test setup. It should not be the operation used for normal typing.

## Builder type magic

The builder can recognize rich text at the type level:

```ts
declare const richTextBrand: unique symbol;

export type RichCollaborativeText = {
    kind: 'rich-text';
    version: 1;
    id?: string;
    readonly [richTextBrand]?: never;
};

type IsRichText<T> = NonNullish<T> extends RichCollaborativeText ? true : false;
```

Then `PatchBuilderInternal` gets a branch before generic object navigation:

```ts
NonNullish<Current> extends RichCollaborativeText
    ? RichTextBuilderMethods<R>
    : NonNullish<Current> extends (infer Elem)[]
      ? ArrayBuilderMethods<Elem>
      : ...
```

The method set should be small and editor-adapter-friendly:

```ts
type RichTextBuilderMethods<R> = {
    $text: {
        replace(value: RichTextImportSnapshot, when?: ApplyTiming): R;
        insert(at: RichTextPosition, text: string, attrs?: RichTextAttrs, when?: ApplyTiming): R;
        delete(range: RichTextRange, when?: ApplyTiming): R;
        mark(range: RichTextRange, name: string, value: JsonValue, when?: ApplyTiming): R;
        unmark(range: RichTextRange, name: string, when?: ApplyTiming): R;
        splitBlock(at: RichTextPosition, block?: RichTextBlock, when?: ApplyTiming): R;
    };
};
```

These methods would produce `DraftPatch`-like rich text draft operations. `resolveAndApply` and CRDT translation can then understand them.

### Important type caveat

A TypeScript brand can make the builder ergonomic, but it is erased at runtime. The CRDT runtime still needs to know that `State["body"]` is special while walking the typia schema.

So the type should also carry a JSON schema marker.

## Schema marker options

### Best option: typia `JsonSchemaPlugin`

Typia includes `tags.JsonSchemaPlugin<Schema>`, which merges custom properties into generated JSON Schema without affecting runtime validation. That is almost exactly what umkehr needs.

Recommended type:

```ts
import type {tags} from 'typia';

declare const richTextBrand: unique symbol;

export type RichCollaborativeText = {
    kind: 'rich-text';
    version: 1;
    id?: string;
} & tags.JsonSchemaPlugin<{
        'x-umkehr-crdt': 'rich-text';
        'x-umkehr-rich-text-version': 1;
    }> & {
        readonly [richTextBrand]?: never;
    };
```

Then schema detection is:

```ts
function isRichTextSchema(schema: Schema) {
    return (schema as Record<string, unknown>)['x-umkehr-crdt'] === 'rich-text';
}
```

Benefits:

- Keeps the "derive from State type definition" story.
- Does not require users to pass a parallel map of rich-text paths.
- Gives the builder a type-level hook and the runtime a schema-level hook from the same exported type.
- Keeps the public sentinel JSON-shaped.

Risks:

- This couples the cleanest experience to typia's tag support. umkehr already depends on typia for CRDT schema derivation, so that is acceptable.
- If `RichCollaborativeText` is a complex object, the plugin marker must appear on the schema node the CRDT walker sees as the field value. Tests should lock this down.

### Acceptable fallback: runtime registration

```ts
createCrdtDocument(initial, schema, {
    timestamp,
    richText: [{path: ['body']}],
});
```

Pros:

- Does not depend on schema extensions.
- Works even if the type alias is lost.

Cons:

- Violates the current "derive everything from State" direction.
- Path strings are less type-safe.
- Easy to forget during migrations.

This is useful as an escape hatch, not the primary API.

### Not recommended: content-bearing magic object shape

```ts
type RichCollaborativeText = {
    __umkehrType: 'rich-text';
    blocks: RichTextBlock[];
};
```

Pros:

- Runtime detection is trivial and the value is directly renderable.

Cons:

- Duplicates render content in public state and authoritative CRDT metadata.
- Makes editor state noisier and easier to desynchronize.
- Users can accidentally edit content through ordinary object navigation instead of rich-text operations.

This works for non-collaborative rich text, but it undermines the no-duplication and metadata-hiding goals for collaborative rich text.

## Initial API sketch

Package exports:

```ts
// umkehr/richtext
export type RichCollaborativeText = ...
export function richText(): RichCollaborativeText;
export function richTextFromPlainText(text: string): RichTextImportSnapshot;
export function richTextFromBlocks(blocks: RichTextBlock[]): RichTextImportSnapshot;
export function materializeRichText(doc: CrdtDocument<unknown>, path: Path): RichTextRenderView;
export function createRichTextEditorView(doc: CrdtDocument<unknown>, path: Path): RichTextEditorView;
export function richTextToPlainText(view: RichTextRenderView): string;
```

State definition:

```ts
type State = {
    title: string;
    body: RichCollaborativeText;
};
```

Initial state:

```ts
const initialState: State = {
    title: 'Draft',
    body: richText(),
};
```

Non-empty initial rich text can use the same command surface:

```ts
dispatch($.body.$text.replace(richTextFromPlainText('Draft body')));
```

Builder usage:

```ts
const $ = createPatchBuilder<State>();

$.body.$text.insert({index: 0}, 'Hello');
$.body.$text.mark({start: 0, end: 5}, 'strong', true);
$.body.$text.replace(richTextFromPlainText('Reset'));
```

React usage:

```tsx
const body = editor.richText(editor.$.body);

<RichTextEditor view={body.editorView} commands={body.commands} />
```

The exact position/range types should be designed around editor bindings. For a first cut, index-based public positions are acceptable if the rich-text command layer resolves them against current rich-text metadata into stable anchors before replication, the same way current array paths resolve numeric indices into stable array item IDs.

## Undo, redo, and preview

Preview should remain local. Rich text typing generates many small operations, so the editor binding should batch them into meaningful commands:

- one command for a typing burst;
- one command for a paste;
- one command for applying a mark;
- one command for split/merge block;
- one command for delete selection.

Local undo should store command-level effects, not every keystroke as a separate undo item. This matches the existing CRDT undo research direction: command metadata or grouped local effects matter even when the underlying CRDT updates are fine-grained.

For native rich text, undo effects should be expressed as fresh rich-text changes with fresh HLC timestamps. They should not remove old rich-text CRDT operations from the log.

## Editor direction

The editor should be native too. It should use umkehr's rich-text operations as its editing model, not adapt another editor's CRDT protocol.

Recommended first editor architecture:

- Render from `RichTextEditorView`, not directly from `doc.state.body`.
- Keep DOM selection and composition state local.
- Convert browser `beforeinput`, paste, key, and toolbar actions into `$text` operations.
- Use preview for local composition/selection-sensitive UI where needed, but commit CRDT operations in meaningful command batches.
- Translate public index-based editor positions into rich-text anchors at dispatch time.
- Rebase local selection after local and remote changes by mapping through the rich-text metadata before materialization.

Avoid a contenteditable free-for-all where the DOM becomes the source of truth. The source of truth should be the rich-text CRDT state; the DOM is an editing surface projected from that state. This is more work up front, but it keeps remote changes, undo/redo, validation, and history in the same model.

The first editor can be intentionally narrow:

- plain paragraphs;
- simple headings;
- bold/italic/code/link toggles;
- plaintext paste;
- keyboard input and selection deletion;
- no markdown shortcuts, nested lists, tables, comments, or embeds.

## Open design decisions

- Exact insertion ordering: decide whether to use per-character IDs only, run IDs with offsets, or a hybrid. Per-character IDs are simplest for v1.
- Render/export view format: block-plus-span JSON is the chosen direction, but the exact mark representation still needs to be locked down.
- Block model: start with paragraphs and simple headings. Tables and nested lists should be out of scope initially.
- Anchor bias semantics: define how marks and cursor positions attach around concurrent inserts at the same anchor.
- Validation: decide how much rich-text operation validation should happen in the generic update validator versus the rich-text reducer.
- History UI: decide whether rich-text operations display as opaque "edited body" entries or as operation summaries.
- Storage compaction: rich-text CRDT metadata can grow quickly; compaction/snapshotting will matter earlier than it does for ordinary object fields.
- Editor architecture: decide how much logic lives in the generic rich-text engine versus the React editor binding.

## Implementation path

1. Add `umkehr/richtext` types and constructors.
2. Add typia schema marker detection with tests proving `RichCollaborativeText` emits `x-umkehr-crdt: "rich-text"` in the field schema.
3. Add a `richText` `CrdtMeta` kind and make ordinary state materialization emit only the `RichCollaborativeText` sentinel.
4. Add explicit render/export/editor view helpers derived from `RichTextMeta`.
5. Add `$text.replace(...)` for initialization, import, and whole-field replacement.
6. Decide how command-surface rich-text patches are applied directly after `createCrdtDocument` in setup/tests/examples.
7. Add `DraftRichTextPatch` and builder `$text` methods.
8. Add `CrdtRichTextUpdate` as a nested update variant.
9. Implement native plaintext insertion/deletion with stable anchors and deterministic convergence tests.
10. Build a narrow React editor around the public `$text` methods and `RichTextEditorView`.
11. Add inline marks, then block split/merge, with randomized convergence tests before each expansion.
12. Add remote-selection/presence separately through an ephemeral channel, not as rich-text CRDT state.
13. Add storage compaction/snapshotting once the metadata growth pattern is measurable.

## Sources

- Yjs `Y.Text` docs: https://docs.yjs.dev/api/shared-types/y.text
- Automerge rich text docs: https://automerge.org/docs/reference/documents/rich-text/
- Automerge rich text schema: https://automerge.org/docs/reference/under-the-hood/rich-text-schema/
- Peritext repository page and abstract: https://www.repository.cam.ac.uk/handle/1810/340564
- Typia `JsonSchemaPlugin` local docs: `node_modules/@typia/interface/src/tags/JsonSchemaPlugin.ts`
