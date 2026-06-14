# Collaborative rich text wiring plan

This plan intentionally punts on the real rich-text CRDT algorithm. The goal is to put the public API, schema detection, CRDT plumbing, React/editor-facing surface, and tests in place with a placeholder rich-text implementation that can later be replaced by a Peritext-like algorithm.

## Target shape

User state:

```ts
import {richText, type RichCollaborativeText} from 'umkehr/richtext';

type State = {
    title: string;
    body: RichCollaborativeText;
};

const initialState: State = {
    title: 'Draft',
    body: richText(),
};
```

Command surface:

```ts
$.body.$text.replace(richTextFromPlainText('Draft body'));
$.body.$text.insert({index: 5}, '!');
$.body.$text.delete({start: 0, end: 2});
```

For the placeholder phase:

- `RichCollaborativeText` in `doc.state` is a sentinel only.
- The authoritative placeholder content lives in `RichTextMeta`.
- `replace`, `insert`, and `delete` can operate on a plain string or simple block/span snapshot with last-writer-wins field semantics.
- `mark`, block splitting, stable anchors, tombstones, and real concurrent rich-text intent preservation are explicitly not implemented yet.

## Phase 1: Public rich-text module

Add a new export surface, probably `src/richtext/index.ts`, and package export `./richtext`.

Types and helpers:

- `RichCollaborativeText`: branded sentinel.
- `richText(id?: string): RichCollaborativeText`.
- `RichTextImportSnapshot`: placeholder import content.
- `richTextFromPlainText(text: string): RichTextImportSnapshot`.
- `richTextFromBlocks(blocks: RichTextBlock[]): RichTextImportSnapshot` if cheap; otherwise defer.
- `RichTextRenderView`: derived view for display.
- `RichTextEditorView`: can initially alias/extend `RichTextRenderView` with minimal position helpers.

Schema marker:

- Use `typia` `tags.JsonSchemaPlugin` on `RichCollaborativeText`.
- Marker: `'x-umkehr-crdt': 'rich-text'`.
- Add a small type/schema test proving typia emits the marker where `createCrdtDocument` will see it.

Acceptance:

- `import {richText, type RichCollaborativeText} from 'umkehr/richtext'` typechecks.
- Generated schema for a state containing `RichCollaborativeText` includes the rich-text marker.

## Phase 2: Builder type surface

Extend `PatchBuilderInternal` so rich-text sentinel fields expose `$text` before generic object navigation.

Add draft patch types for rich text:

```ts
type DraftRichTextPatch<T> = {
    op: 'richText';
    path: Path;
    change: DraftRichTextChange;
};

type DraftRichTextChange =
    | {kind: 'replace'; value: RichTextImportSnapshot}
    | {kind: 'insert'; at: RichTextPosition; text: string}
    | {kind: 'delete'; range: RichTextIndexRange};
```

Placeholder builder methods:

- `$text.replace(value, when?)`.
- `$text.insert(at, text, when?)`.
- `$text.delete(range, when?)`.

Leave these out for now or type them as future TODOs:

- `$text.mark`.
- `$text.unmark`.
- `$text.splitBlock`.
- `$text.mergeBlock`.

Acceptance:

- Type tests can call `$.body.$text.replace(...)`.
- Ordinary non-rich-text fields do not expose `$text`.
- Rich-text fields still allow sentinel-level `$replace(...)` only if the existing builder makes that hard to hide; document that sentinel `$replace` is not the content API.

## Phase 3: Core patch plumbing

Teach local patch realization/application about `DraftRichTextPatch`.

Decisions:

- A rich-text patch should be a first-class patch kind, not a normal `replace` of the sentinel.
- For non-CRDT local history mode, either:
  - apply it to a parallel rich-text metadata store if available, or
  - initially make rich-text command patches only supported by CRDT history.

Recommended placeholder:

- Support rich-text patches in the CRDT path first.
- Keep non-CRDT history mode unsupported for rich-text content until there is a clear storage model for rich-text metadata outside `CrdtDocument`.

Acceptance:

- Dispatching a rich-text draft patch reaches CRDT history plumbing without being interpreted as a sentinel replacement.
- Preview timing can carry through the command shape, even if preview behavior is minimal at first.

## Phase 4: CRDT metadata node

Extend `CrdtMeta`:

```ts
type RichTextMeta = {
    kind: 'richText';
    created: HlcTimestamp;
    content: RichTextPlaceholderContent;
    contentTs: HlcTimestamp;
};
```

Placeholder content can be:

```ts
type RichTextPlaceholderContent = {
    plainText: string;
};
```

Update:

- `buildMeta`: detect rich-text schema and create empty `RichTextMeta`.
- `materialize`: emit only the `RichCollaborativeText` sentinel.
- `cloneMeta`, `versionOf`, `createdOf`.
- `getMetaAtPath`, `getChild`, `normalPathForCrdtPath`, and path invalidation behavior as needed.

Acceptance:

- Creating a CRDT document with `body: richText()` builds `RichTextMeta`.
- `doc.state.body` remains a sentinel.
- The content is not duplicated into public `state`.

## Phase 5: CRDT update variant

Add `CrdtRichTextUpdate`:

```ts
type CrdtRichTextUpdate = {
    op: 'richText';
    path: CrdtPathSegment[];
    change: RichTextChange;
    ts: HlcTimestamp;
};

type RichTextChange =
    | {kind: 'replace'; value: RichTextImportSnapshot}
    | {kind: 'insert'; index: number; text: string}
    | {kind: 'delete'; start: number; end: number};
```

Placeholder semantics:

- `replace`: last-writer-wins by `ts`.
- `insert`: apply by current index if `ts` is newer than `contentTs`, then set `contentTs = ts`.
- `delete`: same.
- Concurrent edits are not a correct rich-text CRDT yet. That is acceptable for this phase as long as tests and docs name it plainly.

Update:

- `createCrdtUpdates`: translate rich-text draft patches into `CrdtRichTextUpdate`.
- `applyCrdtUpdate`: route `op: 'richText'` to placeholder reducer.
- `changedNormalPathsForCrdtUpdate`: invalidate the rich-text field path.
- validation: validate rich-text update envelope and basic change shape.
- history timestamp helpers include rich-text updates.

Acceptance:

- Rich-text replace/update operations replicate through existing CRDT update flow.
- Applying the same rich-text update twice is idempotent.
- Older placeholder rich-text updates lose to newer ones.

## Phase 6: Derived views

Add view helpers:

- `materializeRichText(doc, path): RichTextRenderView`.
- `createRichTextEditorView(doc, path): RichTextEditorView`.
- `richTextToPlainText(view)`.

Placeholder behavior:

- Render view is derived from `RichTextMeta.content.plainText`.
- Return one paragraph block containing one span.
- Editor view includes enough index mapping for simple controlled input/text area behavior.

Acceptance:

- Public `doc.state.body` remains a sentinel.
- `materializeRichText(doc, path).plainText` returns the actual placeholder content.
- Remote updates update the derived view after applying CRDT updates.

## Phase 7: React integration

Expose a rich-text-specific hook or editor helper in `react-crdt` / example runtime.

Possible shape:

```ts
const body = editor.richText(editor.$.body);

<RichTextEditor view={body.editorView} commands={body.commands} />
```

Placeholder editor:

- Start with a `<textarea>` or simple `contenteditable` wrapper.
- On change, dispatch `$text.replace(richTextFromPlainText(nextText))`.
- This is intentionally not the final editor behavior, but it proves the wiring.

Acceptance:

- Example app can edit rich-text content.
- Local edits produce CRDT updates and sync through at least the existing local/server demo path.
- Remote edits update the placeholder editor view.

## Phase 8: Tests

Core tests:

- Schema marker detection.
- `createCrdtDocument` builds `RichTextMeta`.
- `materialize` keeps sentinel only.
- `materializeRichText` reads content from metadata.
- `$text.replace` produces a rich-text draft patch.
- `createCrdtUpdates` produces `op: 'richText'`.
- `applyCrdtUpdate` applies placeholder replace/insert/delete.
- Validation accepts valid rich-text updates and rejects malformed ones.
- Changed normal paths include the rich-text field path.

Integration tests:

- Two CRDT docs converge after a placeholder `$text.replace`.
- Rich-text updates survive serialization/deserialization if existing tests cover update persistence.
- React example can render and update the derived view.

Documented limitation tests:

- Concurrent placeholder insert/delete semantics are last-writer-wins or otherwise simplistic.
- Add a test name/comment that makes clear this is not the final rich-text CRDT algorithm.

## Phase 9: Documentation and examples

Update docs/examples to show:

- `RichCollaborativeText` as a sentinel field in `State`.
- Initialize empty with `richText()`.
- Initialize non-empty by dispatching `$text.replace(richTextFromPlainText(...))` after document creation.
- Render via `materializeRichText` or the React rich-text helper.
- Do not read rich-text content from `doc.state.body`.

Add caveat:

- Current implementation wires the API and sync path only.
- The placeholder reducer does not preserve rich-text editing intent under concurrency.
- The real algorithm will replace `RichTextMeta` internals and the rich-text reducer while preserving the public command/view API.

## Suggested order

1. Public module and schema marker.
2. Metadata node and sentinel materialization.
3. `$text.replace` draft patch and CRDT update.
4. Placeholder reducer and `materializeRichText`.
5. Tests for core flow.
6. React/example placeholder editor.
7. Add `insert`/`delete` placeholder commands if still useful after replace is working.
8. Docs.
