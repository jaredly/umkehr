# Peritext implementation research

## Summary

We should implement a small, native Peritext-inspired engine in `src/peritext` rather than importing the Ink & Switch prototype directly.

The reference implementation is useful as prior art, but its own README says the core Peritext algorithm lives in `src/peritext.ts` as an extension to Micromerge, with the editor bridge in `src/bridge.ts` translating between Micromerge operations/patches and ProseMirror transactions. That coupling is exactly the mismatch for umkehr: umkehr already has its own CRDT document, HLC timestamps, path model, validation, history, undo/redo, migration, and React surfaces.

The right shape for umkehr is:

- `src/peritext`: a pure TypeScript engine for rich-text CRDT metadata, operations, reducers, materializers, and editor-facing patches.
- `src/richtext` or `umkehr/richtext`: public sentinel/types/helpers that expose the feature ergonomically.
- `src/crdt/*`: integration points that treat rich text as a special leaf metadata kind with nested rich-text operations.

This expands the `.tasks/richtext` placeholder plan into an actual Peritext-like implementation path. The placeholder LWW plain-text phase can still be useful as wiring scaffolding, but it should be clearly separated from the real algorithm so it does not become the long-term replicated model.

## Reference Peritext takeaways

Peritext models rich text as formatting spans over a CRDT character sequence. Formatting operations are never removed; new add/remove mark operations update the effective formatting of a range. Range endpoints attach to stable character IDs with before/after handles, not transient numeric indices.

Important ideas to carry over:

- Replicated operations use stable IDs/anchors. Editor patches can use numeric indexes because they are local projections applied sequentially to the editor.
- Deleted characters remain as tombstones so old anchors and delayed operations can still resolve.
- Inline formatting is represented as historical add/remove mark operations that become active over spans.
- Mark boundary behavior matters. Some marks should grow when text is inserted at an edge, while links usually should not grow at the trailing edge.
- Materialization derives contiguous formatted spans from internal metadata. The internal op sets are not the render model.
- Incremental patches are important for editor integration. Replacing the whole editor document after every operation loses selection and editor-local state.

Things not to carry over directly:

- Micromerge/Automerge-style object operation storage.
- ProseMirror transaction coupling.
- The exact reference file/module boundaries.
- Any assumption that rich-text operations are the top-level CRDT document protocol.

## Fit With Umkehr

Umkehr currently stores CRDT behavior in metadata, not in user state:

- `createCrdtDocument` builds `CrdtMeta` from a typia schema and initial state.
- `doc.state` is materialized from `meta`.
- local patches become CRDT updates through `createCrdtUpdates`.
- `applyCrdtUpdate` updates metadata and rematerializes state.
- `changedNormalPathsForCrdtUpdate` drives React invalidation.
- `history.ts` captures local effects for undo/redo.

Rich text should preserve that architecture. A rich-text field should be an ordinary field in the user state type, but its content should live inside a rich-text metadata node. Public `doc.state.body` should remain a sentinel; render/editor content should come from explicit helpers.

Recommended public state:

```ts
import {richText, type RichCollaborativeText} from 'umkehr/richtext';

type State = {
    title: string;
    body: RichCollaborativeText;
};

const initial: State = {
    title: 'Draft',
    body: richText(),
};
```

Recommended command surface:

```ts
$.body.$text.insert({index: 0}, 'Hello');
$.body.$text.delete({start: 0, end: 5});
$.body.$text.mark({start: 0, end: 5}, 'strong', true);
$.body.$text.replace(richTextFromPlainText('Reset'));
```

The builder can accept index-based positions because those are natural for browser/editor selections. The CRDT update must resolve them to stable rich-text anchors before replication, just as array updates currently translate numeric indexes into stable array item IDs.

## Proposed `src/peritext` Module

Keep the engine independent of typia, React, ProseMirror, and `CrdtDocument<T>` where possible. The CRDT layer should adapt into this engine.

Proposed files:

- `src/peritext/types.ts`: internal metadata, operation, anchor, range, mark, block, view, and patch types.
- `src/peritext/ids.ts`: rich-text char/span/block ID creation and deterministic comparison.
- `src/peritext/sequence.ts`: character insertion ordering, tombstones, visible index mapping, anchor resolution.
- `src/peritext/marks.ts`: add/remove mark application, active mark calculation, conflict resolution, mark expansion rules.
- `src/peritext/blocks.ts`: paragraph/heading block markers, split/merge behavior.
- `src/peritext/apply.ts`: apply one rich-text operation to `RichTextMeta`.
- `src/peritext/materialize.ts`: derive `RichTextRenderView` and `RichTextEditorView`.
- `src/peritext/patches.ts`: incremental editor patch derivation.
- `src/peritext/importExport.ts`: plain text and block/span import/export helpers.
- `src/peritext/validation.ts`: rich-text operation validation that is independent of the outer CRDT envelope.
- `src/peritext/*.test.ts`: deterministic examples and randomized convergence tests.

The outer CRDT integration can import this module, but `src/peritext` should not import `src/react-*`.

## Metadata Shape

Add a `richText` metadata node to `CrdtMeta`:

```ts
export type RichTextMeta = {
    kind: 'richText';
    created: HlcTimestamp;
    sentinel: RichCollaborativeText;
    chars: RichTextCharMeta[];
};
```

Use Peritext character metadata directly: one character per insert opId, plus tombstone state and optional mark op-sets on the before/after gaps.

```ts
type RichTextCharMeta = {
    opId: RichTextOpId;
    char: string;
    deleted: boolean;
    markOpsBefore?: RichTextMarkOperation[];
    markOpsAfter?: RichTextMarkOperation[];
};

type RichTextAnchor =
    | {type: 'startOfText'}
    | {type: 'endOfText'}
    | {type: 'before' | 'after'; opId: RichTextOpId};
```

Formatting should be represented as historical operations stored in the mark op-sets, not by mutating every character:

```ts
type RichTextMarkOperation = {
    action: 'addMark' | 'removeMark';
    opId: RichTextOpId;
    start: RichTextAnchor;
    end: RichTextAnchor;
    markType: string;
    value?: JsonValue;
};
```

Scope for the faithful v1 core should be inline marks within a single text sequence, matching Peritext. Paragraphs/headings/blocks are an umkehr extension and should be deferred or layered above the core.

## Operation Shape

Add a first-class outer CRDT update variant:

```ts
type CrdtRichTextUpdate = {
    op: 'richText';
    path: CrdtPathSegment[];
    change: RichTextChange;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};
```

The nested operation should be JSON-shaped and anchored:

```ts
type RichTextChange =
    | {action: 'insert'; opId: RichTextOpId; afterId: RichTextOpId | null; char: string}
    | {action: 'remove'; opId: RichTextOpId; removedId: RichTextOpId}
    | {action: 'addMark'; opId: RichTextOpId; start: RichTextAnchor; end: RichTextAnchor; markType: string; value?: JsonValue}
    | {action: 'removeMark'; opId: RichTextOpId; start: RichTextAnchor; end: RichTextAnchor; markType: string};
```

Editor-facing commands can still accept strings, ranges, mark presets, and block/span snapshots. Those commands should compile into the faithful Peritext operations above. `replace` is useful for initialization, imports, migrations, and test setup, but it should be an umkehr helper that expands into Peritext operations in a fresh rich-text field incarnation, not a native Peritext operation.

## Materialization

The public state materializer should return the sentinel only:

```ts
materialize(meta.kind === 'richText') => meta.sentinel
```

Renderable/editor content should be explicit:

```ts
type RichTextRenderView = {
    spans: RichTextSpan[];
    plainText: string;
};

type RichTextSpan = {
    text: string;
    marks?: Record<string, JsonValue>;
};
```

An umkehr block/span import/export layer can wrap these spans into blocks later. The faithful Peritext core should first produce the current text with inline formatting spans.

Editor views can add mapping helpers and stable view-local positions:

```ts
type RichTextEditorView = RichTextRenderView & {
    positions: RichTextPositionMap;
};
```

The view should hide tombstones, raw char IDs, historical mark operation sets, and HLC timestamps.

## Required Umkehr Integration

Core type/schema work:

- Add `src/richtext/index.ts` with `RichCollaborativeText`, `richText()`, import/export snapshot helpers, and view helpers.
- Add package export `./richtext`.
- Use a typia `tags.JsonSchemaPlugin` marker on `RichCollaborativeText`, for example `x-umkehr-crdt: "rich-text"`.
- Add schema detection, probably `isRichTextSchema(schema)`, near `src/crdt/schema.ts`.

CRDT metadata work:

- Extend `CrdtMeta` with `RichTextMeta`.
- Update `buildMeta` to detect rich-text schema and build empty or imported rich-text metadata.
- Update `cloneMeta`, `versionOf`, `createdOf`, and `materialize`.
- Ensure `getChild`, `getMetaAtPath`, `crdtPathForExisting`, and `normalPathForCrdtPath` treat rich text as a leaf.

Patch/builder work:

- Add `DraftRichTextPatch` to `src/types.ts`.
- Extend `PatchBuilderInternal` so `RichCollaborativeText` exposes `$text` before generic object navigation.
- Extend `createPatchDispatcher` to produce rich-text draft patches.
- Extend `realizeDraftPatch` and `resolveAndApply` so rich-text draft patches do not try to apply through ordinary JSON patch operations.

Update/apply work:

- Extend `CrdtUpdate` with `CrdtRichTextUpdate`.
- Extend `createCrdtUpdates` to translate draft rich-text patches into anchored rich-text CRDT updates.
- Extend `applyCrdtUpdate` to route `op: 'richText'` to `src/peritext/apply`.
- Extend `latestCrdtUpdateTimestamp`, command stamping, update actor extraction, pending handling, and validation.
- Extend `changedNormalPathsForCrdtUpdate` so rich-text changes invalidate the owning field path.

History/undo work:

- Add a rich-text `LocalEffect` kind or capture before/after rich-text snapshots for v1.
- Undo/redo should create fresh rich-text operations with fresh HLC timestamps. It should not delete historical rich-text operations.
- Decide batching behavior before React integration. Typing every character as a separate undo command will be a poor editor experience.

Migration work:

- Decide whether generic CRDT migrations need helpers for rich-text paths.
- Validate that migration replay can tolerate `op: 'richText'`.
- Add default behavior to preserve rich-text updates unless a migration explicitly rewrites/drops their owning path.

React/editor work:

- Add a narrow React helper around `RichTextEditorView` and `$text` commands.
- Start with a controlled rich-text editing surface only after the core engine has deterministic tests.
- Avoid making the DOM the source of truth. DOM/editor input should become rich-text operations; the rendered view should come from rich-text metadata.

## Testing Plan

Algorithm tests in `src/peritext`:

- concurrent inserts at the same anchor converge deterministically.
- deletes are idempotent and tombstones continue to resolve anchors.
- insert after deleted anchor resolves consistently.
- add/remove marks commute for overlapping ranges.
- mark conflicts with the same mark name resolve deterministically.
- link-style non-growing end behavior differs from bold-style growing behavior.
- tombstones at formatting boundaries preserve link/comment boundary behavior.
- mark operations create and propagate `markOpsBefore`/`markOpsAfter` op-sets independent of application order.
- materialization produces compact spans and omits tombstones.
- randomized operation schedules converge.

CRDT integration tests:

- typia schema for `RichCollaborativeText` includes the rich-text marker.
- `createCrdtDocument` builds `RichTextMeta`.
- `doc.state.body` remains the sentinel.
- `$text.insert/delete/mark/replace` produce draft rich-text patches.
- `createCrdtUpdates` produces `op: 'richText'`.
- `applyCrdtUpdate` applies rich-text updates and remains idempotent.
- changed paths include the rich-text field path.
- validation accepts valid rich-text updates and rejects malformed anchors/ranges.
- undo/redo works for at least insert and mark.
- migration replay preserves rich-text updates.

Property/fuzz tests should be added earlier than for typical features. Rich-text CRDT mistakes often pass simple examples and fail when operations are delivered in different orders.

## Decisions From Open Questions

- Implement marks in v1. Do not stop at plaintext insert/delete, though plaintext operations can still be the first incremental milestone.
- `replace` should accept block/span JSON at the public umkehr layer. The faithful Peritext core should still receive ordinary insert/addMark operations produced from that snapshot.
- `RichCollaborativeText` does not need a stable per-field ID. It can be a singleton-style sentinel; the CRDT path and parent timestamps identify the field incarnation.
- Mark expansion presets are an implementation-design detail. They should compile to Peritext before/after anchors, not be stored as an `expand` field. Recommended defaults:
  - `inclusive`: bold/italic/code-like marks grow when typing at either edge.
  - `exclusive`: link-like marks do not grow at the trailing edge.
  - `none`: useful for exact imported ranges.
- Rich-text character IDs should preserve grouping/sequential properties for inserted runs.
- Undo batching should use caller-provided command grouping through the existing `command?` attribute.
- `$text` operations should require CRDT history for now. Using them in non-CRDT local history mode can be a runtime error.
- Validation should be split pragmatically: the generic CRDT validator validates the outer envelope, path, timestamp, command info, and rich-text target schema; `src/peritext/validation.ts` validates anchors, ranges, marks, blocks, and snapshot content.
- The first editor target is a custom contenteditable surface.
- Compaction/snapshotting is future work.
- Migrations should treat rich-text updates like sub-object updates under a dropped or replaced object. Parent timestamps provide the causal link to the containing field incarnation.

## Remaining Design Notes

The earlier question "Should HLC timestamps double as rich-text operation IDs?" was imprecise. The concrete design issue is how to identify an inserted run and the individual characters within it.

Use Peritext-style Lamport operation IDs for rich-text internals, not HLC timestamps. The original Peritext implementation uses IDs like `${counter}@${sessionId}`, where `counter` is one greater than the largest counter currently visible to that editing session. That shape is important because the ID order encodes causal visibility in the rich-text sequence itself. HLC timestamps can remain the outer umkehr update timestamp for history, command grouping, and last-writer-wins behavior outside the rich-text engine.

For branch-safe umkehr IDs, use a branch-aware actor component:

```ts
type RichTextActorId = `${sessionId}:${branchId}`;
type RichTextOpId = `${counter}@${RichTextActorId}`;
type RichTextCharId = RichTextOpId;
```

An insert of `hello` where the next visible counter is `42` creates one operation ID per character:

```ts
42@session:branch // h
43@session:branch // e
44@session:branch // l
45@session:branch // l
46@session:branch // o
```

This keeps sequential grouping for characters from the same inserted text while matching the original Peritext model: each character insertion has its own opId. The branch suffix avoids collisions if two branches fork from the same session and both create the next counter. An equivalent structured representation is also fine:

```ts
type RichTextOpId = {
    counter: number;
    sessionId: string;
    branchId: string;
};
```

The string form is compact and close to Peritext, but the engine should compare IDs by parsed fields rather than relying on raw lexicographic string order.

## Peritext Fidelity Corrections

To stay faithful to the original algorithm, keep the following constraints. These are places where the initial research note was too loose or drifted toward a custom rich-text CRDT.

- Inserts are single-character operations. A user paste/type of `"hello"` is represented as five insert operations with consecutive opIds, not as one string operation with a run ID.
- Character identity is the insert opId. There is no separate character ID layer.
- Deletes are single-character remove operations by `removedId`. A range delete is a local/editor convenience that expands to one remove operation per visible character.
- Rich-text operation ordering and mark conflict resolution use Peritext opId ordering, not umkehr HLC timestamps. HLC timestamps remain useful for the outer CRDT update envelope, history, and command metadata.
- Formatting operation anchors should use Peritext's exact model: `startOfText`, `endOfText`, or `{type: 'before' | 'after'; opId}`. The earlier generic `bias` anchor wording should be avoided.
- Mark boundary behavior is encoded by choosing `before` or `after` anchors. It should not be represented as an `expand` field in the replicated operation. Public API presets can exist, but they must compile to the correct Peritext anchors.
- `addMark` and `removeMark` are separate operation actions. A combined `{kind: 'mark'; action: ...}` draft shape is fine internally, but the stored Peritext operation should preserve the add/remove distinction.
- The internal mark state should follow the op-set model: each character has optional `markOpsBefore` and `markOpsAfter` sets. Applying a mark operation creates/copies/extends these sets as in Peritext, rather than only storing a global span record and resolving from scratch.
- Current mark rendering is derived per `markType` from the active op-set. Mutually exclusive mark types use greatest-opId-wins. Multi-value mark types, such as comments, need separate semantics that retain all live values not removed by a corresponding remove operation.
- Inserted text at tombstone-heavy boundaries needs the Peritext special case: if tombstones at the insertion position carry before/after anchors for formatting operations, insertion may need to happen after the last relevant tombstone so link/comment boundary intent is preserved.
- Text inserted at the start of a paragraph/start of text may need extra formatting operations to inherit the successor's formatting. Do not assume preceding-character inheritance covers all cases.
- Peritext's published scope is inline formatting within a single paragraph. Blocks/headings are an umkehr extension and should be deferred or layered outside the faithful core algorithm.
- `replace` is not a native Peritext operation. It should be a local helper for import/reset that expands into ordinary Peritext insert/addMark operations in a fresh rich-text field incarnation, or it should be clearly marked as an umkehr-level import primitive outside the faithful operation log.

## Suggested Implementation Order

1. Add `src/peritext` type skeleton, metadata constructors, materializer, and deterministic ID comparison.
2. Add `umkehr/richtext` public sentinel and typia marker tests.
3. Add `RichTextMeta` as a CRDT leaf and materialize only the sentinel.
4. Add `op: 'richText'` envelope validation and path invalidation.
5. Implement anchored plaintext insert/delete in `src/peritext` with convergence tests.
6. Wire `$text.insert/delete/replace` through builder, update creation, apply, and history.
7. Add render/editor view helpers.
8. Add mark add/remove operations and Peritext boundary behavior.
9. Add undo/redo support and batching semantics.
10. Add a narrow React editor helper.
11. Add block/span import/export at the umkehr layer.
12. Defer block split/merge until after the inline Peritext core is correct.
13. Add compaction/snapshot design once the metadata profile is visible.

## Sources

- Ink & Switch Peritext essay: https://www.inkandswitch.com/peritext/
- Ink & Switch Peritext repository: https://github.com/inkandswitch/peritext
- Earlier umkehr rich text research: `.tasks/richtext/research.md`
- Earlier umkehr rich text wiring plan: `.tasks/richtext/plan.md`
