# Plan: Comment Removal / Resolution

## Decisions From Research

- Closing a comment should mark the annotation as resolved, not permanently erase all annotation state.
- Annotation body blocks do not need to be deleted when the whole annotation is resolved.
- The behavior should apply to all annotation presentations: sidebar comments, footnotes, and popovers.
- If an annotation has multiple body blocks, empty-body Backspace should remove only the active body block. If it is the last body block, resolve the annotation.
- No extra UI is needed for annotations whose referenced text has already been deleted and is therefore hidden.

## Phase 1: Add Annotation Resolution Primitives

Work in `examples/block-rich-text/src/annotations.ts`.

Add helpers to find and update an annotation by id:

- `annotationIdString(data)` or equivalent local helper for comparing `AnnotationMarkData.id`.
- `findAnnotationMark(state, annotationId)` that returns the live non-remove annotation mark for the requested id.
- `visibleRangesForAnnotationMark(state, mark)` using `visibleRangesForMark(state, mark, annotationVirtualParents(state))`.

Add `resolveAnnotation(state, annotationId, context): CommandResult`.

Implementation shape:

1. Find the current annotation mark by id.
2. Compute visible ranges for that mark.
3. For each range, emit a remove mark with the original mark data:
   `markRangeOp(..., ANNOTATION_MARK, originalData, true, nextId)`.
4. For each same range, emit an add mark with the same `id` and `presentation`, plus `resolved: true`:
   `markRangeOp(..., ANNOTATION_MARK, {...originalData, resolved: true}, false, nextId)`.
5. Apply all ops with `annotationVirtualParents`.
6. Return a caret at the first affected range start when possible; otherwise keep a conservative fallback selection.

Reasoning: stacking marks remove by matching `data`. A resolved replacement needs to first remove the unresolved data, then add resolved data, otherwise both annotation values can coexist on the same text.

## Phase 2: Render Only Active Annotations

Still in `annotations.ts`, update active annotation discovery so resolved annotations are hidden from normal UI but still preserve their body blocks in CRDT state.

Likely changes:

- Keep `richTextVirtualParents` accepting resolved annotation data so existing body blocks remain materializable under the annotation id.
- Update `renderedAnnotations` to exclude resolved annotation marks:
  `mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data) && !mark.data.resolved`
- Update `exactAnnotationForSegments` to ignore resolved annotations, so creating a new annotation on the same text does not append a body to a resolved thread.

Audit `App.tsx` annotation rendering helpers:

- `hasAnnotation`
- `annotationDataForRun`
- sidebar trigger/gutter logic
- footnote/popover maps

If any of these render directly from formatted runs instead of `renderedAnnotations`, filter out `data.resolved` there too. The target behavior is that resolved annotations do not highlight referenced text, show sidebar cards, show footnotes, or show popover triggers.

## Phase 3: Remove One Body Block From Multi-Body Threads

Add `removeAnnotationBodyBlock(state, annotationId, bodyBlockId, context): CommandResult` in `annotations.ts`.

Behavior:

- Get current `annotationBodyBlockIds(state, annotationIdLamport)`.
- If the active body block is not part of that annotation, no-op.
- If there is more than one body block, delete/archive only the active body block with `deleteBlockOps(..., {mode: 'subtree', virtualParents: annotationVirtualParents(state)})`.
- Return a selection targeting a neighboring remaining body block if possible.
- If this is the last body block, call `resolveAnnotation` and do not separately delete the body block.

This keeps thread-level close behavior separate from per-body-block removal.

## Phase 4: Wire Empty-Backspace Behavior

Update `deleteAnnotationBodyBackward` in `annotations.ts` to accept annotation context:

```ts
options?: {annotationId?: string; bodyBlockId?: string}
```

Preserve current behavior for all existing cases:

- range selection deletes selected body text
- caret after offset `0` deletes previous character
- missing annotation/body context at empty offset `0` remains a no-op

New behavior:

- If the body text length is `0`, selection is collapsed, and caret is at offset `0`, call `removeAnnotationBodyBlock`.
- For a body with one remaining character, the first Backspace deletes that character and leaves the annotation visible with an empty body. The next Backspace resolves/removes according to the new rule.

Update `AnnotationBodyBlock` in `examples/block-rich-text/src/App.tsx`:

- Pass `annotationId` and `block.id` to `deleteAnnotationBodyBackward`.
- Make sure focus/selection restoration tolerates the active body block disappearing from the rendered annotation list.

## Phase 5: Optional Direct UI Control

Add a visible close/resolve control to annotation cards if desired while implementing the fallback behavior.

Suggested minimal UI:

- A small icon button in each `annotationCard`.
- Accessible label such as `Resolve comment`, `Resolve footnote`, or `Resolve annotation`.
- Calls `resolveAnnotation` for the whole annotation.

If this is added, keep it shared enough that sidebar comments, popovers, and footnotes can use the same command path even if only sidebar cards get an explicit button initially.

## Phase 6: Tests

Add unit tests in `examples/block-rich-text/src/annotations.test.ts`.

Core tests:

- `resolveAnnotation` hides the annotation from `renderedAnnotations`.
- Resolving leaves referenced text intact.
- Resolving preserves body blocks in CRDT state, even though the annotation no longer renders as active.
- Resolving syncs to the peer replica through `applyLocalChange`.
- Resolving one overlapping annotation does not hide the other overlapping annotation.
- Resolved annotations are not reused by exact-overlap `createAnnotation`.

Backspace/body tests:

- Empty-body Backspace on a single-body annotation resolves the annotation.
- Backspace on a one-character body deletes the character but does not resolve until the next Backspace.
- Empty-body Backspace on a multi-body annotation deletes/hides only the active body block.
- Empty-body Backspace on the last remaining body block resolves the annotation.

If adding the direct UI control, add an `App.test.tsx` coverage path for clicking the resolve button.

## Phase 7: Verification

Run the focused test set first:

```sh
npm exec vitest -- run examples/block-rich-text/src/annotations.test.ts
```

Then run broader example tests if the focused suite passes:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/blockCommands.test.ts
```

Manual smoke check in the block rich text demo:

1. Create a sidebar comment on text.
2. Type body text.
3. Backspace until the body is empty.
4. Press Backspace once more and confirm the annotation disappears while referenced text remains.
5. Repeat with footnote/popover annotations if there is a reachable UI path for them.
6. Create overlapping annotations and confirm resolving one leaves the other visible.
