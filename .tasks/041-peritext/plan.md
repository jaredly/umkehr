# Peritext implementation plan

Goal: implement a faithful Peritext core in `src/peritext`, then integrate it into umkehr as a special CRDT leaf field. The faithful core should model Peritext operations directly: one opId per character insertion, tombstoned deletes, before/after mark anchors, and `markOpsBefore` / `markOpsAfter` op-sets.

Do not start with a generic span CRDT or a string-run CRDT. Those are materially different from Peritext.

## Phase 1: Peritext Core Types And IDs

Add `src/peritext` with the core type definitions and opId helpers.

Files:

- `src/peritext/types.ts`
- `src/peritext/ids.ts`
- `src/peritext/index.ts`
- `src/peritext/ids.test.ts`

Define:

```ts
type RichTextActorId = `${string}:${string}`; // sessionId:branchId
type RichTextOpId = `${number}@${RichTextActorId}`;

type RichTextAnchor =
    | {type: 'startOfText'}
    | {type: 'endOfText'}
    | {type: 'before' | 'after'; opId: RichTextOpId};

type RichTextOperation =
    | {action: 'insert'; opId: RichTextOpId; afterId: RichTextOpId | null; char: string}
    | {action: 'remove'; opId: RichTextOpId; removedId: RichTextOpId}
    | {action: 'addMark'; opId: RichTextOpId; start: RichTextAnchor; end: RichTextAnchor; markType: string; value?: JsonValue}
    | {action: 'removeMark'; opId: RichTextOpId; start: RichTextAnchor; end: RichTextAnchor; markType: string};
```

Implement:

- parse/format opIds.
- compare opIds by numeric counter, then actor id string.
- compute next counter as one greater than the largest counter of any existing rich-text operation in the metadata, including tombstones and mark operations.
- allocate consecutive opIds for typed/pasted text.

Acceptance:

- `compareOpIds('10@a:b', '2@z:y') > 0`.
- concurrent same-counter ids sort deterministically by actor id.
- allocating `"hello"` from counter 42 produces `42@...` through `46@...`.
- invalid opIds are rejected by parser/validator.

## Phase 2: Plain Text CRDT Sequence

Implement Peritext's underlying RGA/Causal Trees-style character sequence.

Files:

- `src/peritext/sequence.ts`
- `src/peritext/apply.ts`
- `src/peritext/materialize.ts`
- `src/peritext/sequence.test.ts`

Metadata:

```ts
type RichTextCharMeta = {
    opId: RichTextOpId;
    char: string;
    deleted: boolean;
    markOpsBefore?: RichTextMarkOperation[];
    markOpsAfter?: RichTextMarkOperation[];
};

type RichTextState = {
    chars: RichTextCharMeta[];
};
```

Implement:

- empty state.
- apply single-character `insert`.
- apply single-character `remove`.
- retain tombstones.
- insert at beginning with `afterId: null`.
- insert after tombstoned characters.
- deterministic ordering for concurrent inserts with the same `afterId` using opId ordering.
- materialize plain text from non-deleted chars.
- map visible index to insertion anchor and visible range to char ids for editor-facing commands.

Acceptance:

- single-character insert and remove work.
- applying the same remove twice is idempotent.
- inserting after a deleted char still resolves.
- concurrent inserts at the same `afterId` converge regardless of delivery order.
- randomized insert/remove delivery orders converge.

## Phase 3: Mark Operations And Op-Sets

Implement the core Peritext formatting algorithm.

Files:

- `src/peritext/marks.ts`
- `src/peritext/marks.test.ts`

Implement:

- apply `addMark` and `removeMark` to `markOpsBefore` / `markOpsAfter`.
- start anchor handling:
  - if the target op-set exists, add the operation.
  - if absent, scan backward to nearest existing op-set, copy it, and add the operation.
- forward propagation:
  - add the new operation to every encountered op-set until the end anchor.
  - initialize the end op-set from the closest preceding active set, without the new operation.
- process `addMark` and `removeMark` using the same op-set mechanics.
- derive active mark state per span.
- mutually exclusive mark types use greatest-opId-wins.
- leave a hook for multi-value mark types, but do not implement comments in v1 unless needed.

Acceptance:

- overlapping bold/italic ranges materialize as compact spans.
- add/remove of the same mark type resolves by greatest opId.
- applying concurrent mark operations in either order produces identical op-sets and identical materialized spans.
- adjacent spans with equal current marks are merged in the render view.
- tombstoned-only spans are not emitted.

## Phase 4: Boundary Semantics

Implement Peritext's formatting-boundary behavior faithfully.

Files:

- `src/peritext/boundaries.ts`
- `src/peritext/boundaries.test.ts`

Implement:

- public/editor mark presets compile to correct before/after anchors:
  - inclusive marks such as bold/italic/code use Peritext's growing behavior.
  - exclusive marks such as link/comment-like annotations use non-growing end behavior.
- insertion at a normal span boundary inherits the preceding character's formatting.
- insertion at start of text can inherit successor formatting by generating additional mark operations if needed.
- tombstone boundary special case: when inserting at a position with tombstones, scan tombstones for before/after anchors used by formatting operations and place the new char after the last relevant tombstone when required.

Acceptance:

- text inserted at the end of bold remains bold.
- text inserted at the end of a link is not linked.
- replacing deleted linked text inserts outside the link when the deleted boundary char carries the relevant anchor.
- start-of-text insertion can inherit successor formatting when expected.

## Phase 5: Peritext Validation And Import

Add validation and import helpers while keeping `replace` outside the core operation log.

Files:

- `src/peritext/validation.ts`
- `src/peritext/importExport.ts`
- `src/peritext/validation.test.ts`
- `src/peritext/importExport.test.ts`

Implement:

- validate operation shape.
- validate opId format and anchor references.
- validate single-character inserts.
- validate mark type/value shape.
- import block/span JSON by generating ordinary insert and addMark operations for a fresh empty rich-text state.
- export current render view as spans, plus a public block/span wrapper if needed by `umkehr/richtext`.

Acceptance:

- invalid opIds, missing anchors, range inversions, malformed mark operations, and multi-character insert ops are rejected.
- importing block/span JSON produces the expected materialized view using normal Peritext operations.
- no native Peritext `replace` operation exists in the core operation union.

## Phase 6: Public Rich Text API

Add the public sentinel, schema marker, command types, and view helpers.

Files:

- `src/richtext/index.ts`
- package export `./richtext`
- package smoke test update
- schema/type tests

Implement:

- `RichCollaborativeText` as a singleton-style sentinel type.
- `richText(): RichCollaborativeText`.
- typia `tags.JsonSchemaPlugin` marker, e.g. `x-umkehr-crdt: "rich-text"`.
- `RichTextImportSnapshot` as block/span JSON.
- `richTextFromBlocks(...)`.
- `richTextFromPlainText(...)` as a convenience wrapper.
- `materializeRichText(doc, path)`.
- `richTextToPlainText(view)`.

Acceptance:

- `import {richText, type RichCollaborativeText} from 'umkehr/richtext'` typechecks.
- generated typia schema includes the rich-text marker at the field schema.
- package smoke tests see the new export.
- public state uses only the sentinel; content is accessed through explicit helpers.

## Phase 7: CRDT Metadata Integration

Teach umkehr CRDT metadata about rich-text leaf fields.

Files:

- `src/crdt/types.ts`
- `src/crdt/schema.ts`
- `src/crdt/metadata.ts`
- `src/crdt/materialize.ts`
- `src/crdt/path.ts`
- CRDT metadata tests

Implement:

- `RichTextMeta` as `kind: 'richText'`.
- `isRichTextSchema(schema)`.
- `buildMeta` detects rich-text schema and creates empty Peritext metadata with the sentinel.
- `materialize` returns only the sentinel for rich text.
- `cloneMeta`, `versionOf`, `createdOf` handle rich text.
- path traversal treats rich text as a leaf for ordinary navigation.

Acceptance:

- `createCrdtDocument` builds `RichTextMeta` for `RichCollaborativeText` fields.
- `doc.state.body` remains the sentinel.
- ordinary CRDT paths can locate the rich-text field but cannot navigate into characters or marks.
- replacing/deleting the containing field still follows existing parent timestamp behavior.

## Phase 8: Builder And Patch Surface

Expose `$text` on rich-text fields and reject non-CRDT use for now.

Files:

- `src/types.ts`
- `src/helper.ts`
- `src/make.ts`
- builder/type tests
- non-CRDT runtime tests

Implement:

- `DraftRichTextPatch`.
- type-level detection of `RichCollaborativeText` before generic object navigation.
- `$text.insert(at, text, options?, when?)`.
- `$text.delete(range, when?)`.
- `$text.mark(range, markType, value, preset?, when?)`.
- `$text.unmark(range, markType, preset?, when?)`.
- `$text.replace(snapshot, when?)` as an import/reset helper.
- `resolveAndApply` carries rich-text draft patches through without applying ordinary JSON patch operations.
- using `$text` through non-CRDT local history throws a clear runtime error.

Acceptance:

- rich-text fields expose `$text`.
- non-rich-text fields do not expose `$text`.
- `$text.insert('hello')` creates draft intent that can later expand to five Peritext insert operations.
- `$text.replace(snapshot)` is represented as a helper/import patch, not a core Peritext operation.

## Phase 9: CRDT Update Translation And Apply

Add the outer `op: 'richText'` update envelope and wire it through local/remote CRDT flow.

Files:

- `src/crdt/types.ts`
- `src/crdt/updates.ts`
- `src/crdt/apply.ts`
- `src/crdt/path.ts`
- `src/crdt/validation.ts`
- `src/crdt/history.ts`
- CRDT integration tests

Implement:

- `CrdtRichTextUpdate`.
- translate draft rich-text patches to one or more `CrdtRichTextUpdate`s.
- assign Peritext opIds using actor/session/branch context.
- keep outer HLC `ts` for umkehr history/command ordering.
- apply `op: 'richText'` by routing to `src/peritext/apply`.
- pending handling for missing rich-text field incarnation.
- `changedNormalPathsForCrdtUpdate` invalidates the rich-text field path.
- update validators:
  - outer validator checks envelope, path, `ts`, command, and target schema.
  - peritext validator checks nested operation.
- `latestCrdtUpdateTimestamp`, command stamping, and actor extraction include rich-text updates.

Acceptance:

- local `$text.insert({index: 0}, 'hello')` emits five rich-text insert updates.
- remote rich-text updates converge through existing CRDT history flow.
- applying duplicate rich-text updates is idempotent.
- changed paths include the owning rich-text field.
- malformed nested operations are rejected by validation.

## Phase 10: Undo/Redo And Command Grouping

Integrate rich text with existing command metadata and local effects.

Files:

- `src/crdt/history.ts`
- history tests

Implement:

- rich-text local effect capture.
- undo for inserted text generates remove operations for inserted characters.
- undo for removes generates fresh insert operations only if the original characters can be reconstructed, or uses a documented snapshot-based v1 fallback.
- undo for marks generates corresponding add/remove mark operations with fresh opIds.
- redo replays fresh rich-text operations.
- caller-provided command grouping through existing `command?` metadata determines undo unit boundaries.

Acceptance:

- undo/redo works for inserts.
- undo/redo works for marks.
- command grouping can batch multiple character inserts into one undo item.
- undo/redo never deletes historical Peritext operations from the log.

## Phase 11: React And Custom Contenteditable

Build the first editor target after the core engine is proven by tests.

Files:

- `src/react-crdt` or a small rich-text React submodule
- example updates
- React tests

Implement:

- derive a `RichTextEditorView`.
- render spans into a custom contenteditable surface.
- translate browser input/paste/delete/selection events into `$text` operations.
- keep DOM selection and composition state local.
- rebase selection after local/remote changes using view mapping.
- start with inline marks only; defer block editing.

Acceptance:

- example can type, delete, bold/italic/link text.
- remote edits update the editor view.
- local command grouping works for typing bursts or explicit command groups.
- the DOM is not the source of truth; the editor renders from CRDT-derived view.

## Phase 12: Migration And Persistence

Make rich-text updates survive existing migration/replay paths.

Files:

- `src/migration/index.ts`
- migration tests

Implement:

- migration helpers preserve, rename, or drop `op: 'richText'` by owning field path.
- dropped/replaced containing fields behave like sub-object updates under dropped/replaced objects.
- parent timestamps keep causal linking to the field incarnation.
- persistence/serialization round-trips rich-text metadata and updates.

Acceptance:

- replaying a history with rich-text updates after schema migration works.
- dropping a rich-text field drops or invalidates its nested updates according to existing CRDT path semantics.
- serialization tests cover rich-text metadata and updates.

## Deferred Work

- block split/merge and headings.
- nested lists/tables/embeds.
- comments as multi-value marks.
- presence/remote selections.
- compaction/snapshotting.
- optimized sequence/index data structures.
- incremental patch minimization beyond what the first contenteditable adapter needs.
