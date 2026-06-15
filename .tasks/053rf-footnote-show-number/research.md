# Research: Show Inline Footnote Numbers

## Goal

In `examples/block-rich-text`, footnote annotation references should show the small superscript footnote number inline, in addition to the existing annotation highlight and underline.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/annotations.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/domSelection.ts`

Annotations are represented as one stacking mark type:

```ts
export const ANNOTATION_MARK = 'annotation';
```

The mark data distinguishes presentation:

```ts
export type AnnotationMarkData = {
    id: Lamport;
    presentation: 'sidebar' | 'footnote' | 'popover';
    resolved?: boolean;
};
```

`renderedAnnotations(...)` already returns annotations sorted by visible reference order. That order is used directly by `<Footnotes>` because it renders an `<ol>`, so the rendered list item number is currently the only place the footnote number exists.

Inline text rendering happens in two paths:

- Static annotation bodies use `renderStaticRuns(...)`, which returns React `<span>` nodes.
- Editable block and annotation-body text uses `renderRunNodes(...)`, which imperatively creates DOM spans and is the path that matters for main editor text.

`renderRunNodes(...)` currently:

- creates one `<span>` per formatted run or selection chunk;
- applies `.markAnnotation` to any annotation mark;
- applies `.markPopover` and popover `data-*` attributes only for popover annotations;
- does not know about footnote ordinals.

The CSS for all annotation references is currently shared:

```css
.markAnnotation {
    background: #fef3c7;
    border-bottom: 2px solid #f59e0b;
}

.markPopover {
    border-bottom-style: dotted;
}
```

## Recommended Implementation Shape

Keep footnote numbers as derived render-time state rather than storing them in CRDT mark data.

Reasoning:

- Footnote ordinals are presentation derived from visible reference order.
- `renderedAnnotations(...)` already computes the stable visible order used by the footnote list.
- Storing ordinals in mark data would make reordering, deletion, split/join, or concurrent edits require extra CRDT operations for a purely presentational value.

Suggested changes:

1. In `BlockEditor`, derive a `Map<string, number>` from the already-sorted footnote annotations:

   ```ts
   const footnoteNumberById = useMemo(() => {
       const result = new Map<string, number>();
       annotations
           .filter((annotation) => annotation.data.presentation === 'footnote')
           .forEach((annotation, index) => result.set(annotation.id, index + 1));
       return result;
   }, [annotations]);
   ```

2. Thread `footnoteNumberById` into every editable-rendering call that can render annotation marks:

   - `EditableBlock` props
   - `renderBlockNode(...)` option plumbing
   - all calls to `renderRunNodes(...)`
   - `serializeRuns(...)` so changes in footnote numbering trigger `replaceChildren(...)`

3. Extend run inspection with a helper similar to `popoverIdsForRun(...)`:

   ```ts
   const footnoteIdsForRun = (
       run: RichFormattedBlock['runs'][number],
       footnoteNumberById?: Map<string, number>,
   ): string[] => { ... };
   ```

   This should inspect both `run.stackedMarks?.annotation` and `run.marks.annotation`, then keep only annotation data where `presentation === 'footnote'` and the ID exists in `footnoteNumberById`.

4. Append a small non-editable superscript only at the end of a footnote reference, not after every run chunk.

   The important detail is that a single footnote annotation can span multiple formatted runs, or a run can be split into chunks by retained-selection decorations. Appending a superscript to every marked run would duplicate the number across one logical reference.

   A pragmatic implementation is to track active footnote IDs while walking runs/chunks in `renderRunNodes(...)` and append a number when an ID is present in the current chunk but not present in the next visible chunk. For overlapping footnotes, append all IDs that end at that boundary, ordered by their assigned footnote number.

5. Mark the superscript as non-editable and ignored by offset calculations.

   Existing selection code skips nodes under `[data-offset-sentinel="true"]`. The least invasive path is to give the footnote marker that same attribute:

   ```html
   <sup
       contenteditable="false"
       data-offset-sentinel="true"
       data-footnote-reference="true"
   >
       1
   </sup>
   ```

   This keeps `readSelectionFromDom(...)`, caret restoration, and tests that gather block text from counting the visual number as document text.

6. Add CSS for the inline marker, for example:

   ```css
   .footnoteReferenceNumber {
       margin-left: 1px;
       color: #9a5800;
       font-size: 0.72em;
       font-weight: 700;
       line-height: 0;
       vertical-align: super;
       user-select: none;
   }
   ```

## Tests To Add

Unit/model-level:

- `annotations.test.ts` already verifies footnotes are sorted by visible reference order. It probably does not need to change unless a helper for ordinal derivation is moved into `annotations.ts`.

DOM/app-level:

- Add an `App.test.tsx` case that creates two footnotes out of order and verifies:
  - the first visible reference has inline superscript text `1`;
  - the second visible reference has inline superscript text `2`;
  - the `<ol className="footnotes">` order remains unchanged.

- Add or include in the same case a check that editor document text still excludes the rendered superscript. Existing `blockText(...)` skips `[data-offset-sentinel="true"]`, so this verifies the marker does not pollute editing offsets.

- Add a case where a footnote reference spans multiple formatted runs, for example by applying bold to part of the footnote range, and verify the number appears once at the end of the reference.

Optional but useful:

- Test overlapping footnotes if the intended behavior is to support them. Current annotation marks can stack, so overlapping footnote references are possible.

Verification command:

```sh
npm exec vitest -- examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/App.test.tsx
```

## Edge Cases

- Multi-run footnote references: number should appear once, after the full reference.
- Selection decoration chunking: retained-selection rendering splits runs; number should not duplicate on each chunk.
- Overlapping footnotes: if two references end at the same text boundary, both numbers may need to render at that boundary.
- Nested annotations in annotation bodies: footnote marks can be created inside annotation body text. The number map should be derived from the same `renderedAnnotations(...)` order, so body references should be numbered consistently with main-body references.
- Deleted reference text: `renderedAnnotations(...)` filters annotations with empty reference text, so deleted references should lose both list item and inline number.
- Popover/sidebar annotations: they should keep the current highlight/underline behavior and not receive superscript numbers.

## Open Questions

- Should the superscript appear after every footnote-marked range, or only after the final character of the whole reference? The conventional footnote behavior is one number at the end of the reference; this research assumes that.
    - one number at the end
- For overlapping footnote references, should all ending numbers render at their respective boundaries, or should overlapping footnotes be disallowed/normalized in the UI?
    - at respective boundaries
- Should footnote numbers appear inside annotation-body editors when footnotes are created over annotation body text? The current model allows annotations over annotation bodies, so the simplest consistent answer is yes.
    - yes
- Should the superscript be selectable/copyable? For editing correctness it should be `contentEditable=false` and ignored by offset calculations, which also means copy behavior may not include it as plain text.
    - not selectable/copyable
