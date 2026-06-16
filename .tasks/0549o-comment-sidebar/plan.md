# Plan: Collapsible Comment Sidebar

Goal: move sidebar comments in `examples/block-rich-text` into a collapsible right-hand sidebar. The sidebar should default collapsed per editor panel, show one vertically-aligned gutter dot per sidebar annotation while collapsed, open and focus the relevant comment when a dot is clicked, and open/focus the new comment body after local comment creation.

## Decisions From Research

- Sidebar default: collapsed.
- Sidebar state: local per editor panel, not synchronized through CRDT/history.
- Remote-created comments: do not automatically open the receiving editor's sidebar.
- Collapsed gutter: one dot per annotation.
- Dot placement: vertically align with referenced text/block as much as possible, while preventing dot overlap.
- Multiple body blocks under one annotation: a gutter dot focuses the most recently edited body block.
- `createAnnotation` should return the annotation id explicitly so UI focus does not need to infer it from operation shapes.

## Phase 1: Extend Annotation Command Result

Update annotation creation so callers can reliably know which annotation was created or reused.

Tasks:

- Add a narrow result type in `examples/block-rich-text/src/annotations.ts`, for example:

```ts
type CreateAnnotationResult = CommandResult & {
    annotationId: Lamport | null;
    bodyBlockId: string | null;
};
```

- Change `createAnnotation` to return:
  - `annotationId`: the existing exact annotation id when adding a body block to an exact annotation, or the new mark id for a new annotation.
  - `bodyBlockId`: the newly inserted annotation body block id when one is created.
  - `null` ids when no annotation is created because the selection has no segments.
- Keep existing `state`, `ops`, and `selection` fields unchanged so current callers continue to work with minimal changes.
- Add or update `annotations.test.ts` coverage for:
  - brand-new annotation returns its annotation id and body block id.
  - exact-overlap annotation returns the existing annotation id and the new body block id.
  - empty/non-actionable selection returns no ops and null ids.

Notes:

- Prefer deriving `bodyBlockId` from the `insertBlockOps` result or resulting virtual children immediately after insertion, not from UI-rendered annotations.
- Avoid changing the underlying CRDT op model; this is an example-layer command result improvement.

## Phase 2: Sidebar State And Focus Requests

Add local view state and a reusable way for the parent sidebar to focus a comment body.

Tasks:

- In `BlockEditor`, add:
  - `commentsOpen`, default `false`.
  - a focus request, preferably token-based so the same block can be focused repeatedly:

```ts
type CommentFocusRequest = {blockId: string; token: number};
```

- Track the most recently edited body block per annotation in local state:

```ts
const [lastEditedCommentBodyByAnnotation, setLastEditedCommentBodyByAnnotation] =
    useState<Record<string, string>>({});
```

- When `AnnotationBodyBlock` edits or changes selection, let the parent know which annotation/body is active so the map can be updated.
- Pass a focus request down through `AnnotationSidebar` to `AnnotationBodyBlock`.
- In `AnnotationBodyBlock`, handle a matching focus request by:
  - setting local selection to `caret(block.id, block.text.length)`.
  - setting `pendingCaretRestoreBlockIdRef.current = block.id`.
  - calling `onBodySelectionChange` with the caret.
  - clearing/acknowledging the focus request after it has been consumed.
- Preserve the existing body-editor selection restore behavior for rich text edits, links, and nested annotations.

Notes:

- A token-based request avoids ignoring a second click on the same gutter dot after the first request was cleared too early or reissued.
- If the last-edited body for an annotation no longer exists, fall back to the annotation's last body block, then first body block.

## Phase 3: Restructure Layout

Move comments from above the blocks into a right-hand sidebar/gutter that shares a content row with the document.

Tasks:

- Derive `sidebarAnnotations` once in `BlockEditor`.
- Replace the current render order where `<AnnotationSidebar />` appears above `.blockList`.
- Introduce an editor content wrapper:

```tsx
<div className={commentsOpen ? 'editorContent commentsOpen' : 'editorContent commentsCollapsed'}>
    <div className="documentColumn">
        <div ref={rootRef} className="blockList">...</div>
        <Footnotes ... />
    </div>
    <AnnotationSidebar ... />
</div>
```

- Keep floating popovers and link popovers outside the content wrapper if needed for positioning, but keep footnotes with the document column.
- Keep rendering the sidebar/gutter even when there are no comments only if a collapse/expand control needs to be visible. Otherwise no-comments can render nothing or a minimal collapsed rail.
- Add a clear toggle control for opening/closing comments. It should have stable accessible labels, for example `Open comments` and `Close comments`.

Notes:

- The sidebar is per editor panel; Editor A and Editor B can be open/collapsed independently.
- The right rail should not reduce the document column below a usable width in the existing two-column editor grid.

## Phase 4: Collapsed Gutter Dots And Vertical Alignment

Render one collapsed dot per sidebar annotation, aligned as close as practical to the referenced text.

Tasks:

- Add sidebar-specific ids to rendered annotation reference spans so they can be measured:
  - Existing annotation spans already get `.markAnnotation`.
  - Popover spans get `data-popover-id`.
  - Add a sidebar annotation data attribute such as `data-sidebar-annotation-ids="id1 id2"` when a run contains sidebar annotations.
- In `BlockEditor`, keep a map of gutter dot vertical positions keyed by annotation id.
- Measure positions in a layout effect when:
  - sidebar annotations change.
  - block content/layout changes.
  - the sidebar opens/collapses.
  - window resizes.
- Measurement approach:
  - Find the first visible reference element for each annotation id inside `rootRef`.
  - Compute its vertical center relative to the editor content wrapper or block list.
  - If no reference element is available, fall back to annotation order spacing.
- Prevent overlap:
  - Sort dots by desired top.
  - Enforce a minimum vertical gap equal to dot size plus spacing.
  - Clamp positions within the visible block list/content area.
- Render collapsed gutter buttons with inline `top` styles or CSS variables.
- Clicking a dot should:
  - set `commentsOpen` to `true`.
  - focus the most recently edited body block for that annotation, falling back as described in Phase 2.

Notes:

- This is best-effort alignment. It should not require exact text-range geometry for every overlap case.
- Overlapping annotations may share the same reference span; the overlap resolver should stack dots cleanly.

## Phase 5: Local Comment Creation Opens And Focuses

Wire toolbar comment creation into the new sidebar/focus path.

Tasks:

- In the toolbar `onAnnotation` handler, special-case `presentation === 'sidebar'`.
- For local sidebar comment creation from main text or annotation body text:
  - call `createAnnotation` as today.
  - if it returns ops and a body block id, set `commentsOpen` to `true`.
  - issue a focus request for the returned body block id.
  - update `lastEditedCommentBodyByAnnotation` for the returned annotation id.
- Do not auto-open for remote ops or history replay.
- Preserve current selection behavior for the main editor after comment creation where possible; the focus request intentionally moves focus into the comment body only for local sidebar comments.
- Leave footnote and popover annotation creation behavior unchanged.

Notes:

- Since `runCommand` callbacks are synchronous, setting React state from inside the command callback is acceptable but should be kept narrowly scoped. If it becomes awkward, return the command result and schedule UI state immediately outside the command wrapper through a small helper.

## Phase 6: Styling And Responsive Behavior

Update CSS so the comment area behaves like a real right-hand sidebar/gutter.

Tasks:

- Replace the current top-flow `.annotationSidebar` styling with right-side layout styles:
  - `.editorContent`
  - `.documentColumn`
  - `.commentSidebar`
  - `.commentSidebarOpen`
  - `.commentSidebarCollapsed`
  - `.commentSidebarToggle`
  - `.commentGutter`
  - `.commentGutterDot`
- Use stable dimensions for the gutter and dots so hover/focus states do not shift layout.
- Keep cards compact and readable in a two-replica layout; target a sidebar width around `220px-280px`.
- Use visible focus rings on gutter dots and toggle buttons.
- Keep `.annotationBodyEditor` usable in the sidebar with existing rich text/link/popover affordances.
- At the existing `max-width: 980px` breakpoint:
  - keep the sidebar on the right side of each editor panel.
  - reduce open sidebar width if needed.
  - ensure block text and tables remain usable.

Notes:

- Avoid making the editor panel a card-within-card layout. The sidebar is part of the editor work surface.
- The collapsed gutter should be visible enough to signal comments without covering editable text.

## Phase 7: Tests And Verification

Add focused tests for the new behavior and run the relevant suite.

Tests to add/update:

- `annotations.test.ts`
  - `createAnnotation` returns annotation/body ids for new annotation.
  - `createAnnotation` returns existing annotation id and new body id for exact overlap.

- `App.test.tsx`
  - Sidebar comments default collapsed after creating/importing initial content, with comment body hidden and a gutter dot visible.
  - Clicking a gutter dot opens the sidebar and focuses the expected annotation body textbox.
  - Creating a sidebar comment while collapsed opens the sidebar and focuses the new body textbox.
  - Exact-overlap comment creation while collapsed opens and focuses the newly-created body block.
  - One gutter dot renders per annotation, not per body block.
  - A dot for an annotation with multiple body blocks focuses the most recently edited body block.
  - Footnotes and popovers still render independently of comment sidebar open/collapsed state.

Verification commands:

```sh
pnpm exec vitest -- run examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/App.test.tsx
```

If the repo uses the example package script instead, use the existing project test command that covers these files.

Manual/browser verification:

- Start the block-rich-text example.
- In each editor panel, create two comments on different lines and verify dots align near their reference text.
- Verify dots do not overlap when comments are close together.
- Verify Editor A's sidebar state does not affect Editor B.
- Verify remote-created comments appear as dots but do not auto-open the receiving sidebar.
- Verify creating a local comment while collapsed opens the sidebar and places the caret in the new comment body.

## Implementation Order

1. Extend `createAnnotation` result and test it.
2. Add focus request plumbing without changing layout.
3. Move sidebar into the right-side content layout.
4. Implement collapsed gutter dots with click-to-open/focus.
5. Add vertical measurement and overlap avoidance.
6. Wire local comment creation to open/focus.
7. Polish CSS and responsive behavior.
8. Add/update UI tests and run verification.
