# Research: Comment Removal in `examples/block-rich-text`

## Goal

Add a UI path for removing/closing a sidebar comment without deleting the referenced text. The task calls out one minimum behavior: if the user empties a comment body and presses Backspace again, the comment should be removed.

## Current State

Relevant files:

- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/virtualParents.ts`
- `examples/block-rich-text/src/annotations.test.ts`
- `src/block-crdt/marks.ts`

Comments are annotations. The annotation is represented by a mark of type `annotation`; the mark data has an id and presentation:

```ts
export type AnnotationMarkData = {
    id: Lamport;
    presentation: AnnotationPresentation;
    resolved?: boolean;
};
```

The body of the comment is a normal rich-text block whose virtual parent is the annotation mark id. `richTextVirtualParents` only exposes virtual parents for non-removal annotation marks:

```ts
mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data)
    ? [(mark.data as unknown as AnnotationMarkData).id]
    : []
```

`createAnnotation` creates:

1. an `annotation` mark on the referenced text, and
2. one body block under the annotation id.

`renderedAnnotations` renders annotations by scanning live non-removal annotation marks and filtering out annotations whose live reference text is empty. This means deleting the referenced text hides the comment. It does not remove the mark or body block.

The sidebar UI is in `AnnotationSidebar`. It has an open/close toggle for the whole sidebar, but each `annotationCard` has no remove/resolve button.

Comment body editing is handled by `AnnotationBodyBlock`, which wires Backspace and Delete through:

- `deleteAnnotationBodyBackward`
- `deleteAnnotationBodyForward`
- `replaceAnnotationBodySelection`

Today `deleteAnnotationBodyBackward` does this:

- If the body selection is a range, delete the selected body text.
- If the caret is at offset `0`, return no ops.
- Otherwise delete the previous body character.

That explains the reported gap: after the body text is empty, another Backspace at offset `0` is a no-op.

## Existing CRDT Primitives

The block CRDT already has the needed mark-removal representation. A mark operation can be created with `remove: true`:

```ts
markBoundaryOp(id, start, end, type, data, remove)
markRangeOp(state, block, startOffset, endOffset, type, data, remove, id)
```

Inline mark removal uses this pattern in `blockCommands.ts`:

```ts
markRangeOp(..., markType, undefined, remove, ...)
```

For annotations, removal probably needs to target the same covered character range as the original annotation mark, not the current body selection. `visibleRangesForMark(state, mark, annotationVirtualParents(state))` can derive the visible ranges currently covered by the annotation mark, including split/join behavior handled by the CRDT. `markRangeOp(..., ANNOTATION_MARK, mark.data, true, ...)` can then create removal marks over those visible ranges.

Important detail: because annotation marks are stacking marks, the remove mark must use annotation-compatible data, not `undefined`, so it removes only the matching annotation rather than all stacked annotations on overlapping text. This should be verified in tests.

## Likely Implementation

Add an annotation-removal command in `annotations.ts`, for example:

```ts
export const removeAnnotation = (
    state: CachedState<RichBlockMeta>,
    annotationId: string,
    context: CommandContext,
): CommandResult => { ... }
```

Suggested behavior:

1. Find the live non-removal annotation mark whose `data.id` matches `annotationId`.
2. Compute its current visible ranges with `visibleRangesForMark`.
3. Emit `markRangeOp` removal ops for each visible range, using the original annotation data and `remove: true`.
4. Apply with `annotationVirtualParents`.
5. Return a stable caret selection, probably the first removed range start if available.

Add a helper for the task's minimum behavior:

```ts
export const deleteAnnotationBodyBackward = (
    state,
    selection,
    context,
    options?: {annotationId?: string},
)
```

When:

- the selection is collapsed,
- the body selection range exists,
- the body text length is `0`, and
- the caret is at `0`,

then call `removeAnnotation`. Without `annotationId`, preserve today's no-op.

In `AnnotationBodyBlock`, pass `annotationId` into the Backspace command:

```ts
onDeleteBackward={(activeSelection) =>
    run(activeSelection ?? selection, (state, selected, context) =>
        deleteAnnotationBodyBackward(state, selected, context, {annotationId}),
    )
}
```

Optional but user-visible: add a close/delete button on each sidebar comment card that calls the same `removeAnnotation` command. This directly satisfies "close/delete" instead of only the Backspace fallback.

## Test Targets

Add tests to `examples/block-rich-text/src/annotations.test.ts`:

- Removes a sidebar annotation mark when Backspace is pressed in an empty body at offset `0`.
- Does not remove the annotation when Backspace deletes the final body character; removal happens only on the next Backspace.
- Removes one overlapping annotation without removing another annotation covering some of the same reference text.
- Syncs removal to the peer replica via `applyLocalChange`.
- Leaves referenced text intact after removing the comment.

If a visible remove button is added, add or extend an `App.test.tsx` test to exercise the UI path.

## Open Questions

- Should "close" mean permanent deletion, or should it set `AnnotationMarkData.resolved = true` so resolved comments can later be shown/restored? The type already has an unused `resolved?: boolean`, but current rendering does not use it.
    - resolved sounds good
- Should removing a comment delete/archive its body blocks, or is removing the annotation mark enough? Removing the mark hides the virtual parent and body from the UI, but the body block records remain in CRDT state.
    - the blocks don't need to be touched
- Should the behavior apply only to sidebar comments, or also footnotes and popovers? The underlying annotation type is shared.
    - yeah those too
- If an annotation has multiple body blocks because the same reference was commented more than once, should empty-Backspace remove the whole annotation thread or only the active body block?
    - only the active body block. if it's the last one, then remove the annotation
- What should happen when all referenced text has already been deleted and the annotation is hidden? There is currently no visible UI path to remove that hidden annotation/body state.
    - no need
