# Implementation Log

## Phase 1: Peritext Core Types And IDs

- Added `src/peritext` public barrel, core operation/state types, and opId helpers.
- Implemented branch-aware Peritext opIds in the form `${counter}@${sessionId}:${branchId}`.
- Implemented numeric counter comparison with actor-id tie break.
- Implemented next-counter and consecutive opId allocation based on all operation counters present in rich-text metadata, including mark op-sets.
- Added unit tests for parsing, formatting, comparison, allocation, and malformed ids.
- Verification: `npx vitest run src/peritext/ids.test.ts` passed.

## Phase 2: Plain Text CRDT Sequence

- Added sequence state helpers, insert/remove application, tombstone retention, plain-text materialization, and visible index/range mapping.
- Stored `afterId` on character metadata so the sequence can be deterministically re-linearized from Peritext insertion parent links.
- Implemented deterministic sibling ordering by Peritext opId, with descendants kept under their inserted parent.
- Added a pending queue for nested Peritext dependencies so inserts/removes that arrive before their referenced character are retried when dependencies arrive.
- Added tests for insert/remove, idempotent removes, insertion after tombstones, concurrent same-anchor insertion ordering, descendant ordering, and index/range mapping.
- Verification: `npx vitest run src/peritext/ids.test.ts src/peritext/sequence.test.ts` passed.

## Phase 3: Mark Operations And Op-Sets

- Added Peritext mark op-set application for `addMark` and `removeMark`.
- Mark operations attach to before/after anchors, copy the nearest preceding op-set when needed, propagate through existing op-sets in the marked range, and initialize end op-sets without the new operation.
- Added render materialization that derives current mark state per span using greatest-opId-wins per mark type.
- Added tests for compact mark spans, overlapping marks applied in either order, add/remove conflict resolution, and tombstoned-only formatted spans.
- Verification: `npx vitest run src/peritext/ids.test.ts src/peritext/sequence.test.ts src/peritext/marks.test.ts` passed.

## Phase 4: Boundary Semantics

- Added mark range anchor compilation for `inclusive`, `exclusive`, and `none` presets.
- Inclusive marks compile to before/before or before/end-of-text anchors so inserts at the trailing edge remain inside the mark.
- Exclusive marks compile to before/after anchors so inserts at the trailing edge stay outside link/comment-like marks.
- Added a formatting-aware insertion anchor helper that can choose a tombstone boundary char when deleted text carries formatting boundary op-sets.
- Added tests for inclusive trailing insert behavior, exclusive trailing insert behavior, and tombstone boundary anchor selection.
- Corrected same-parent sequence linearization to descending opId order so later insertions before an existing successor land at the requested position.
- Verification: `npx vitest run src/peritext/ids.test.ts src/peritext/sequence.test.ts src/peritext/marks.test.ts src/peritext/boundaries.test.ts` passed.

## Phase 5: Peritext Validation And Import

- Added nested Peritext operation validation for action shape, opIds, single-character inserts, anchors, mark types, and optional state-based anchor ordering/reference checks.
- Added block/span snapshot import helpers that generate ordinary Peritext insert and addMark operations; no native `replace` operation was added to the core union.
- Added export helpers for converting render views back to import snapshots.
- Added tests for operation validation, malformed inserts/anchors, plain-text import, marked span import, export, and malformed snapshots.
- Verification: `npx vitest run src/peritext/*.test.ts` passed.
- Verification: `npm run typecheck` passed.

## Phase 6: Public Rich Text API

- Added `src/richtext` with the public `RichCollaborativeText` sentinel, `richText()`, import snapshot helpers, `materializeRichText`, and `richTextToPlainText`.
- Added typia `JsonSchemaPlugin` marker metadata to `RichCollaborativeText`.
- Added package export `./richtext` and Vitest alias.
- Added public API tests for sentinel/snapshot helpers and typia schema marker emission.
- Updated package smoke tests to cover the built rich-text entry point.
- Verification: `npx vitest run src/richtext/index.test.ts src/peritext/*.test.ts` passed.
- Verification: `npm run typecheck` passed.

## Phase 7: CRDT Metadata Integration

- Added `RichTextMeta` to `CrdtMeta`.
- Added schema marker detection with `isRichTextSchema`.
- Updated `buildMeta` to create rich-text metadata from `RichCollaborativeText` schema fields.
- Updated metadata timestamp helpers and public state materialization so rich-text fields materialize only the sentinel.
- Added CRDT tests proving `createCrdtDocument` builds rich-text metadata and `materializeRichText` reads an explicit rich-text view.
- Verification: `npx vitest run src/crdt/richtext.test.ts src/richtext/index.test.ts src/peritext/*.test.ts` passed.
- Verification: `npm run typecheck` passed.

## Phase 8: Builder And Patch Surface

- Added `RichTextPatch` / `RichTextPatchChange` to the patch unions.
- Added type-level `$text` methods for `RichCollaborativeText` fields.
- Added runtime `$text.insert`, `$text.delete`, `$text.mark`, `$text.unmark`, and `$text.replace` proxy methods.
- Updated draft realization/resolution so rich-text patches pass through without mutating public state.
- Added explicit runtime rejection for rich-text patches in non-CRDT history.
- Added builder tests for patch creation, resolve pass-through, and non-CRDT rejection.
- Verification: `npx vitest run src/richtext/builder.test.ts src/richtext/index.test.ts src/crdt/richtext.test.ts src/peritext/*.test.ts` passed.
- Verification: `npm run typecheck` passed.

## Phase 9: CRDT Update Translation And Apply

- Added `CrdtRichTextUpdate` with nested Peritext operations.
- Translated rich-text draft insert/delete/mark/unmark/replace helpers into `op: 'richText'` updates.
- Derived Peritext actor ids from HLC node and suffix as `${node}:${suffix ?? 'main'}`.
- Routed `op: 'richText'` through `applyCrdtUpdate` into the Peritext reducer.
- Added rich-text changed-path invalidation and validator support.
- Added CRDT integration tests for insert translation/application, mark application, changed paths, and update validation.
- Verification: `npx vitest run src/crdt/richtext.test.ts src/richtext/builder.test.ts src/richtext/index.test.ts src/peritext/*.test.ts` passed.
- Verification: `npm run typecheck` passed.

## Full-Suite Checkpoint

- Verification: `npm test` passed, including build, package smoke tests, CRDT tests, rich-text tests, and Peritext tests.
