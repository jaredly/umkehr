# Plan: Inline Footnote Reference Numbers

## Decisions From Research

- Render exactly one superscript number at the end of each full footnote reference.
- For overlapping footnotes, render each number at that footnote's own end boundary.
- Footnotes created inside annotation body editors should show inline numbers too.
- Superscript numbers are visual UI only: they should be `contentEditable=false`, not selectable/copyable, and ignored by document offset calculations.
- Do not store footnote numbers in CRDT mark data. Derive them from visible reference order at render time.

## Phase 1: Derive Footnote Ordinals

Update `examples/block-rich-text/src/App.tsx`.

1. In `BlockEditor`, derive `footnoteNumberById` from the already sorted `annotations` returned by `renderedAnnotations(...)`.
2. Include only annotations where `annotation.data.presentation === 'footnote'`.
3. Assign numbers with the same 1-based order used by `<Footnotes>`.
4. Keep this as a `Map<string, number>` keyed by rendered annotation ID.

Expected result:

- Inline references and the `<ol className="footnotes">` list share the same numbering source.
- Reordering, deletion, split/join, and annotation-body references update automatically without CRDT writes.

## Phase 2: Thread Numbering Through Render Plumbing

Update the editable rendering path in `examples/block-rich-text/src/App.tsx`.

1. Add `footnoteNumberById?: Map<string, number>` to the render options passed through:
   - `renderBlockNode(...)`
   - child render helpers that call `EditableBlock`
   - `EditableBlock` props
   - every `renderRunNodes(...)` call
2. Update `serializeRuns(...)` so its JSON key includes enough footnote-number state to force DOM replacement when ordinals change.
   - Use a stable representation such as sorted `[id, number]` entries.
   - Preserve existing serialized fields for runs, stacked marks, decorations, and trailing code newline.
3. Pass the same map into focus-time rerenders, not only layout-effect rerenders.

Expected result:

- Any editable block or annotation body can render footnote numbers.
- Number-only changes rerender existing DOM.
- Existing popover and retained-selection behavior still receives its current options.

## Phase 3: Identify Footnote Marks Per Run

Add focused helpers near the existing annotation helpers in `App.tsx`.

1. Add a helper that extracts annotation mark data from both:
   - `run.stackedMarks?.annotation`
   - `run.marks.annotation`
2. Reuse or generalize the existing `hasAnnotationMark(...)`, `popoverIdsForRun(...)`, and `isAnnotationMarkData(...)` patterns.
3. Add `footnoteIdsForRun(...)` or equivalent that returns IDs whose annotation data is a footnote and whose ID exists in `footnoteNumberById`.
4. Keep popover filtering presentation-specific. The existing `isAnnotationMarkData(...)` currently checks only popovers; either rename it to clarify that behavior or split it into generic annotation-data and popover-specific helpers.

Expected result:

- Footnote logic works for scalar and stacking marks.
- Sidebar and popover annotations continue to get only highlight/underline behavior.

## Phase 4: Render Superscripts At Reference End Boundaries

Update `renderRunNodes(...)` in `App.tsx`.

1. Create normal text spans as today, preserving:
   - `.markBold`
   - `.markItalic`
   - `.markAnnotation`
   - `.markPopover`
   - retained-selection classes and `data-*`
2. While iterating visible run chunks, determine which footnote IDs are active for the current chunk and which are active for the next visible chunk.
3. Append a superscript after the current chunk for each active footnote ID that is not active in the next chunk.
4. Sort multiple ending footnotes by their assigned footnote number.
5. Render each marker as a separate non-editable superscript, for example:

   ```html
   <sup
       class="footnoteReferenceNumber"
       contenteditable="false"
       data-offset-sentinel="true"
       data-footnote-reference="true"
   >
       1
   </sup>
   ```

6. Ensure the same end-boundary logic handles both undecorated rendering and decorated rendering, since retained selections can split runs into smaller chunks.

Expected result:

- A multi-run footnote reference gets one number at its final visible boundary.
- Retained-selection chunking does not duplicate numbers.
- Overlapping footnotes render their numbers at their respective boundaries.
- The visual numbers do not become CRDT text.

## Phase 5: Style Inline Numbers

Update `examples/block-rich-text/src/style.css`.

1. Add `.footnoteReferenceNumber` styling:
   - small superscript scale
   - slight left margin
   - visually tied to the existing annotation amber color
   - `user-select: none`
2. Keep `.markAnnotation` and `.markPopover` behavior intact.

Expected result:

- Footnote numbers read as conventional superscript references while the existing highlight/underline remains visible.

## Phase 6: Tests

Update `examples/block-rich-text/src/App.test.tsx`.

1. Add a test for visible-order numbering:
   - type text with two footnote references;
   - create the later footnote first and the earlier footnote second;
   - assert inline superscripts are `1` and `2` in visible order;
   - assert the footnote list remains ordered the same way.
2. In the same test or a separate one, assert document text excludes superscript numbers.
   - Use the existing `blockText(...)` helper, which skips `[data-offset-sentinel="true"]`.
3. Add a multi-run reference test:
   - create one footnote over a range;
   - apply formatting to part of the range so it materializes as multiple runs;
   - assert only one `.footnoteReferenceNumber` appears for that reference and that it is at the end.
4. Add an overlapping footnote test:
   - create overlapping footnotes such as `bcd` and `cde`;
   - assert the first number appears after `d` and the second after `e`;
   - assert numbers are ordered by the derived footnote list numbers.
5. Add an annotation-body footnote test if it is not naturally covered by the above:
   - create a sidebar/popover annotation body;
   - create a footnote inside that body text;
   - assert the body editor renders a superscript number.

Consider a small pure test only if helper logic is moved out of component-local code. Otherwise, keep tests at DOM level because the feature is primarily rendering and selection-offset behavior.

## Phase 7: Verification

Run focused tests:

```sh
npm exec vitest -- examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/annotations.test.ts
```

Run the example build:

```sh
npm run build --workspace examples/block-rich-text
```

If workspace build syntax is not supported by this repo's package manager setup, run from the example directory instead:

```sh
cd examples/block-rich-text
npm run build
```

Manual browser check:

1. Start the block rich text example.
2. Create multiple footnotes out of order.
3. Create overlapping footnotes.
4. Create a footnote inside an annotation body.
5. Confirm numbers render once, at the expected reference ends, and caret/selection behavior around the superscripts remains stable.

## Risks And Mitigations

- Risk: Superscript DOM text affects CRDT offsets.
  Mitigation: mark it `contentEditable=false` and `data-offset-sentinel="true"`; verify with `blockText(...)` and selection tests.

- Risk: A reference spanning multiple runs gets duplicate numbers.
  Mitigation: render numbers only when a footnote ID is active in the current visible chunk and inactive in the next visible chunk.

- Risk: Number-only changes do not rerender because run text/marks are unchanged.
  Mitigation: include stable footnote-number data in `serializeRuns(...)`.

- Risk: Generic annotation helper changes break popovers.
  Mitigation: preserve popover-specific filtering and keep existing popover tests passing.
