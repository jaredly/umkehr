# Collaborative rich text CRDT research

This note looks at what it would take to add a collaborative rich text field to umkehr without breaking the current design principle: app state is ordinary UI-facing data, and CRDT metadata stays in the CRDT layer.

The short version:

- Do not model collaborative rich text as a plain `string` with last-writer-wins replacement. That is only acceptable for commit-on-blur notes.
- The cleanest fit is a first-class "special CRDT field" whose public value is a serializable rich-text snapshot, while its CRDT metadata is stored beside the existing `CrdtMeta` tree.
- The UI layer probably does need a richer editor adapter API, but it does not need to see character IDs, tombstones, span endpoint IDs, clocks, or internal CRDT paths.
- Type-level builder support is feasible with a branded/annotated type such as `RichCollaborativeText`.
- Runtime detection should not rely on a TypeScript brand alone. The best match for the existing schema-derived architecture is a typia `tags.JsonSchemaPlugin` marker, for example `x-umkehr-crdt: "rich-text"`.

## Current constraints

The existing CRDT implementation is schema-driven and metadata-hidden:

- `createCrdtDocument(initial, schema, options)` builds `meta` from a typia JSON schema and an initial JSON-like state.
- `CrdtMeta` mirrors the state tree with special metadata for primitives, objects, records, arrays, tagged unions, and tombstones.
- User-facing `doc.state` is materialized from metadata and contains no CRDT IDs, clocks, tombstones, or array order keys.
- Local edits are authored as ordinary umkehr patches, then translated into CRDT updates with stable CRDT path segments.
- Schema walking decides whether a path segment is an object field, record entry, array item, or tagged union branch.

That architecture is a good fit for JSON object collaboration. Rich text is different because the thing the user thinks of as one field is internally a nested CRDT: characters, marks, block markers, embeds, and span boundary behavior.

If the field remains an ordinary `string`, concurrent character edits collapse to last-writer-wins. That is not "collaborative rich text"; it is field-level replacement.

## External options

### Option 1: Yjs-backed rich text field

Yjs has `Y.Text`, described as a shared type for text and rich text. It supports insertion, deletion, range formatting, string output, and Quill Delta output via `toDelta()`. It can also be nested inside other Yjs shared types.

Potential umkehr mapping:

```ts
type RichCollaborativeText = RichTextSnapshot & RichTextBrand;

type RichTextSnapshot = {
    format: 'yjs-delta-v1';
    delta: RichTextDelta;
};
```

Internally, a rich text `CrdtMeta` node stores Yjs update bytes or an encoded Yjs document fragment. `materialize` returns a plain snapshot or editor-friendly value.

Pros:

- Mature ecosystem.
- Existing editor integrations for ProseMirror/Tiptap, Slate-like stacks, Quill, CodeMirror-adjacent text flows, awareness/presence, and transport providers.
- Good choice if the goal is "make a practical collaborative editor work soon."

Cons:

- It introduces a second CRDT engine inside umkehr's CRDT engine.
- Yjs updates are binary and Yjs-specific, so umkehr's current JSON update validation story needs an escape hatch.
- Undo/redo, history display, and schema validation become less transparent unless umkehr treats rich-text updates as opaque nested operations.
- Full document sync might need a Yjs document lifecycle per field, not just per state document.

API fit:

- Good as an optional adapter package, for example `umkehr/richtext-yjs`.
- Less good as the core internal representation if umkehr wants one coherent, inspectable CRDT format.

### Option 2: Automerge rich text semantics

Automerge supports rich text on top of its document model with text marks, block markers, spans, and APIs such as `mark`, `marks`, `splitBlock`, `updateBlock`, `block`, `spans`, and `updateSpans`. Its documented model separates inline formatting marks from block markers, and has an interoperability-oriented rich text schema.

Potential umkehr mapping:

```ts
type RichTextSnapshot = {
    format: 'automerge-spans-v1';
    spans: RichTextSpan[];
};
```

Internally, umkehr could either embed Automerge for just that field or copy a similar span/block model.

Pros:

- The model is close to the shape a document editor actually needs: text spans plus block markers.
- The public snapshot format can be JSON, which is friendlier to umkehr's validation and persistence posture than opaque binary.
- The schema gives a concrete answer for common marks and blocks.

Cons:

- Embedding Automerge also means running another CRDT engine inside umkehr.
- Automerge's rich-text API is tied to Automerge document paths and change semantics, not umkehr `CrdtPathSegment`s.
- If copied rather than embedded, the hard part is still the rich-text CRDT merge algorithm.

API fit:

- Strong inspiration for umkehr's native model.
- Reasonable as an adapter if the application already wants Automerge-style rich text.

### Option 3: Native Peritext-like field

Peritext is a published rich-text CRDT algorithm. Its core idea is to store formatting spans alongside a plaintext character sequence, with span endpoints linked to stable character identifiers, then derive the final formatted text deterministically. The paper explicitly focuses on preserving rich-text editing intent under concurrency.

Potential umkehr mapping:

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

Pros:

- Best conceptual fit for umkehr: one CRDT engine, one HLC/order model, one validation pipeline, one history model.
- Internal metadata remains hidden just like array IDs and tombstones.
- Rich-text updates can be JSON, path-addressed, validated, logged, replayed, and inspected.
- Enables umkehr-native undo/redo and history display later.

Cons:

- Highest implementation cost.
- Requires careful randomized/property testing.
- Editor bindings are non-trivial. The CRDT is only half the product; editor reconciliation and selection anchoring are the other half.
- The initial version must deliberately limit scope: paragraphs, headings, basic inline marks, links, and maybe embeds. Tables, nested lists, comments, suggestions, and collaborative selections should wait.

API fit:

- Best long-term fit if rich text is intended as a core umkehr capability.
- Risky as a first implementation unless the supported surface is narrow.

### Option 4: Structured JSON rich text with existing arrays/records

Represent rich text directly in normal State:

```ts
type RichTextDoc = {
    blocks: RichTextBlock[];
};

type RichTextBlock = {
    type: 'paragraph' | 'heading';
    children: RichTextInline[];
};

type RichTextInline = {
    text: string;
    marks?: Record<string, JsonValue>;
};
```

Pros:

- Requires no new CRDT metadata kind.
- Builder and schema machinery already understand objects, arrays, records, and tagged unions.
- Easy to validate and render.

Cons:

- Text edits inside each leaf string are still last-writer-wins.
- Splitting/merging text runs creates many structural edits that do not preserve rich-text intent under concurrency.
- Array index churn and run normalization can fight the CRDT layer.

API fit:

- Good for non-realtime rich text, comments, import/export, or a "poor man's rich text" editor.
- Not enough for Google Docs-style concurrent editing inside the same paragraph.

## Recommendation

Use a staged design:

1. Define the first-class public type and builder API now.
2. Implement the runtime as a special CRDT field with an adapter boundary.
3. Start with a limited native rich-text model or a Yjs-backed prototype behind the same public API.

The important API decision is not whether the first engine is Yjs or native. The important API decision is that a rich text field should be a distinct semantic field type, not just `string`.

## Public state shape

The public state should still be clean:

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

At runtime, `doc.state.body` should be a serializable snapshot:

```ts
type RichCollaborativeText = RichTextSnapshot & RichTextTypeMarker;

type RichTextSnapshot = {
    kind: 'rich-text';
    version: 1;
    spans: RichTextSpan[];
};
```

This is not CRDT metadata. It is the materialized value the UI/editor can render, persist in snapshots, and validate. Character IDs, tombstones, deleted spans, clocks, causal dependencies, and pending operations stay in `CrdtMeta`.

An even more ergonomic UI layer can hide the snapshot too:

```tsx
<RichTextEditor value={editor.latest().body} bind={editor.$.body} />
```

But the underlying state value still needs a deterministic JSON representation for persistence, initial state, server snapshots, and non-React consumers.

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
    value: RichTextInternalState;
};
```

Then update:

- `buildMeta`: if schema is a rich-text schema, build `RichTextMeta` instead of ordinary object/string metadata.
- `cloneMeta`: `structuredClone` can still work if internal state is JSON; binary adapter payloads need explicit handling.
- `versionOf` / `createdOf`: return `created` for rich text.
- `materialize`: convert `RichTextMeta` into `RichCollaborativeText`.
- `getChild` / path walking: rich text should be a leaf for ordinary object navigation.
- `applyCrdtUpdate`: route rich-text operations to a rich-text reducer.
- `changedNormalPathsForCrdtUpdate`: rich-text operations invalidate the owning field path.
- validation: recognize rich-text update envelopes and validate values against the rich-text public schema.

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

For a Yjs adapter, `change` could initially be:

```ts
type RichTextChange = {
    engine: 'yjs';
    update: string; // base64 bytes
};
```

For a native engine:

```ts
type RichTextChange =
    | {kind: 'insert'; at: RichTextAnchor; text: string; attrs?: Record<string, JsonValue>}
    | {kind: 'delete'; range: RichTextRange}
    | {kind: 'mark'; range: RichTextRange; name: string; value: JsonValue; expand: 'none' | 'before' | 'after' | 'both'}
    | {kind: 'block'; at: RichTextAnchor; value: RichTextBlock};
```

The path still names the rich-text field using the existing stable CRDT path machinery. The nested rich-text change then uses rich-text anchors, not ordinary umkehr paths.

### Keep ordinary replacement semantics

`editor.$.body.$replace(newSnapshot)` should still exist. It means "replace the whole rich text document with this snapshot" and creates a new rich-text field incarnation.

This is useful for import, paste-over-all, reset, migrations, and test setup. It should not be the operation used for normal typing.

## Builder type magic

The builder can recognize rich text at the type level:

```ts
declare const richTextBrand: unique symbol;

export type RichCollaborativeText = RichTextSnapshot & {
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

export type RichCollaborativeText = RichTextSnapshot &
    tags.JsonSchemaPlugin<{
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
- Keeps the public value JSON-shaped.

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

### Not recommended: magic object shape

```ts
type RichCollaborativeText = {
    __umkehrType: 'rich-text';
    spans: RichTextSpan[];
};
```

Pros:

- Runtime detection is trivial.

Cons:

- Leaks implementation tagging into user data.
- Makes editor state noisier.
- Users can accidentally edit the marker through ordinary object navigation.

This works, but it undermines the metadata-hiding goal.

## Initial API sketch

Package exports:

```ts
// umkehr/richtext
export type RichCollaborativeText = ...
export function richTextFromPlainText(text: string): RichCollaborativeText;
export function richTextFromSpans(spans: RichTextSpan[]): RichCollaborativeText;
export function richTextToPlainText(value: RichCollaborativeText): string;
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
    body: richTextFromPlainText(''),
};
```

Builder usage:

```ts
const $ = createPatchBuilder<State>();

$.body.$text.insert({index: 0}, 'Hello');
$.body.$text.mark({start: 0, end: 5}, 'strong', true);
$.body.$replace(richTextFromPlainText('Reset'));
```

React usage:

```tsx
<RichTextEditor value={editor.latest().body} update={editor.$.body.$text} />
```

The exact position/range types should be designed around editor bindings. For a first cut, index-based public positions are acceptable if translation resolves them against current rich-text metadata into stable anchors before replication, the same way current array paths resolve numeric indices into stable array item IDs.

## Undo, redo, and preview

Preview should remain local. Rich text typing generates many small operations, so the editor binding should batch them into meaningful commands:

- one command for a typing burst;
- one command for a paste;
- one command for applying a mark;
- one command for split/merge block;
- one command for delete selection.

Local undo should store command-level effects, not every keystroke as a separate undo item. This matches the existing CRDT undo research direction: command metadata or grouped local effects matter even when the underlying CRDT updates are fine-grained.

For native rich text, undo effects should be expressed as fresh rich-text changes with fresh HLC timestamps. They should not remove old rich-text CRDT operations from the log.

## Open design decisions

- Native vs adapter first: Yjs gets to a working demo faster; native is cleaner for long-term umkehr semantics.
- Public snapshot format: Automerge-like spans are a good candidate because they are renderable JSON and close to editor output.
- Block model: start with paragraphs/headings/lists only. Tables should be out of scope initially.
- Anchor model: public API can use indices; replicated operations need stable anchors.
- Validation: decide whether rich text update validation validates the public snapshot only or also validates rich-text internal operation invariants.
- History UI: decide whether rich-text operations display as opaque "edited body" entries or as operation summaries.
- Storage compaction: rich-text CRDT metadata can grow quickly; compaction/snapshotting will matter earlier than it does for ordinary object fields.

## Implementation path

1. Add `umkehr/richtext` types and constructors.
2. Add typia schema marker detection with tests proving `RichCollaborativeText` emits `x-umkehr-crdt: "rich-text"` in the field schema.
3. Add a `richText` `CrdtMeta` kind and make it materialize back to `RichCollaborativeText`.
4. Add whole-field replace support for rich text.
5. Add `DraftRichTextPatch` and builder `$text` methods.
6. Add `CrdtRichTextUpdate` as a nested update variant.
7. Implement either:
   - a Yjs-backed adapter with opaque base64 update payloads, or
   - a minimal native plaintext-plus-marks CRDT.
8. Build one React editor binding around the public `$text` methods.
9. Add randomized convergence tests before expanding the feature set.

## Sources

- Yjs `Y.Text` docs: https://docs.yjs.dev/api/shared-types/y.text
- Automerge rich text docs: https://automerge.org/docs/reference/documents/rich-text/
- Automerge rich text schema: https://automerge.org/docs/reference/under-the-hood/rich-text-schema/
- Peritext repository page and abstract: https://www.repository.cam.ac.uk/handle/1810/340564
- Typia `JsonSchemaPlugin` local docs: `node_modules/@typia/interface/src/tags/JsonSchemaPlugin.ts`
