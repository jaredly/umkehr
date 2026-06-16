# Research: Comment Sidebar

## Goal

Move `examples/block-rich-text` sidebar comments out of the top-of-editor flow and into a collapsible right-hand sidebar. When collapsed, comments should appear as small circles in the editor's right gutter. Clicking a circle should open the sidebar and focus the matching comment body. Creating a new comment while collapsed should open the sidebar and focus the new comment body.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/annotations.test.ts`

The annotation model already distinguishes comment-like annotations from footnotes and popovers with `AnnotationPresentation` values of `sidebar`, `footnote`, and `popover`. `createAnnotation` creates an annotation mark plus one virtual child block for the annotation body. If the selected range already has an exact annotation, creating another annotation adds a new body block under the existing annotation instead of creating a duplicate mark.

`BlockEditor` materializes both normal blocks and annotation body blocks:

- `blocksWithAnnotationBodies = materializeFormattedBlocks(replica.state, annotationVirtualParents(replica.state))`
- `annotationBodyIds` collects virtual annotation body block ids.
- `blocks` filters body blocks out of the main document block list.
- `annotations = renderedAnnotations(replica.state, blocks, blocksWithAnnotationBodies)` returns all rendered annotations sorted by their visible reference position.

Current render order in `BlockEditor` is:

1. editor header
2. toolbar
3. undo status
4. `<AnnotationSidebar />`
5. `.blockList`
6. floating popovers
7. link popovers
8. `<Footnotes />`

This is why comments appear above the document blocks. The current `AnnotationSidebar` returns:

```tsx
<aside className="annotationSidebar" aria-label="Comments">
    {annotations.map((annotation) => (
        <section key={annotation.id} className="annotationCard">
            <strong>Comment on “{annotation.referenceText}”</strong>
            {annotation.bodyBlocks.map((block) => (
                <AnnotationBodyBlock ... />
            ))}
        </section>
    ))}
</aside>
```

`AnnotationBodyBlock` already has the machinery needed to focus and restore a body selection after local body edits. It uses local pending caret/range refs and passes them into `RichTextEditableSurface`. `RichTextEditableSurface` focuses the element when the pending caret or pending range matches its `blockId`.

The missing piece is external focus control: `AnnotationBodyBlock` currently only schedules focus/restoration from inside its own body-edit handlers. Parent components cannot say "focus this body block now" after opening the sidebar or after creating a comment.

## Implementation Shape

This can stay mostly inside `App.tsx` and `style.css`.

Recommended state in `BlockEditor`:

- `const [commentsOpen, setCommentsOpen] = useState(true);`
- `const [pendingCommentFocusBlockId, setPendingCommentFocusBlockId] = useState<string | null>(null);`

Use the already-derived sidebar comments:

```ts
const sidebarAnnotations = annotations.filter((item) => item.data.presentation === 'sidebar');
```

The editor body should become a two-column content area below the toolbar, for example:

```tsx
<div className={commentsOpen ? 'editorContent commentsOpen' : 'editorContent commentsCollapsed'}>
    <div className="documentColumn">
        <div ref={rootRef} className="blockList">...</div>
        <Footnotes ... />
    </div>
    <AnnotationSidebar ... />
</div>
```

The important layout change is that `AnnotationSidebar` should no longer render before `.blockList`; it should be a sibling to the document column. Footnotes should likely remain under the document column, not inside the comments sidebar.

`AnnotationSidebar` should accept:

- `open: boolean`
- `onToggle(open: boolean): void`
- `onFocusBlock(blockId: string): void` or a focused block id prop
- `pendingFocusBlockId: string | null`
- `onPendingFocusHandled(): void`

When open, render the comment cards in the right column. When closed, render a slim gutter with one button per sidebar annotation. Each button can be an accessible circle:

```tsx
<button
    type="button"
    className="commentGutterDot"
    aria-label={`Open comment on ${annotation.referenceText}`}
    onClick={() => {
        onToggle(true);
        onFocusBlock(annotation.bodyBlocks[0]?.id);
    }}
/>
```

When creating a sidebar comment, the toolbar handler should detect the new or target body block and schedule focus:

1. In the `onAnnotation('sidebar')` branch, call `createAnnotation` as today.
2. If `presentation === 'sidebar'` and `result.ops.length > 0`, derive the annotation/body to focus from `result.state`.
3. Set `commentsOpen` to `true`.
4. Set `pendingCommentFocusBlockId` to the relevant body block id.

The most robust way to find the target body block is to inspect rendered sidebar annotations after the operation and choose the most likely body:

- For a brand-new annotation, the new annotation id is usually discoverable from the inserted annotation mark op, but op shapes are not used elsewhere in UI code and may be brittle.
- A simpler UI-level approach is to compare sidebar annotation body ids before and after `createAnnotation` and focus the first new body id.
- If no new body id exists because the exact same annotation was extended with another body block, focus the last body block for the exact matching annotation.

Because `createAnnotation` returns `result.state`, this comparison can be done inside the command callback by calling `renderedAnnotations(result.state, nextBlocks, nextBlocksWithBodies)` with helper functions to avoid duplicating a lot of derivation code inline. Keep these helpers local to `App.tsx` unless they become useful in tests.

`AnnotationBodyBlock` should accept an optional focus request:

```ts
focusRequest?: {blockId: string | null; token: number}
onFocusRequestHandled?(): void
```

or simpler:

```ts
autoFocusBlockId?: string | null
onAutoFocusHandled?(): void
```

Inside `AnnotationBodyBlock`, add a layout effect that checks whether `autoFocusBlockId === block.id`, sets `pendingCaretRestoreBlockIdRef.current = block.id`, sets the local selection to `caret(block.id, block.text.length)`, calls `onBodySelectionChange`, and then clears the parent request after `RichTextEditableSurface` has had a chance to focus. A token-based request is safer if the same block is focused repeatedly; a bare id is probably enough for this task if it is cleared after handling.

## Gutter Placement

The task says collapsed comments should render as little circles along the right gutter. There are two reasonable interpretations:

1. Simple ordered gutter: render one dot per comment in the slim sidebar column, sorted in the same order as `renderedAnnotations`. This is easy, deterministic, and likely enough for the example.
2. Vertically aligned gutter: position dots near the referenced block/range. This is more visually precise but requires measuring inline annotation mark positions or block rows after render.

Recommendation: start with the simple ordered gutter unless visual alignment is explicitly required. It satisfies "along the right gutter" without introducing measurement code. If exact vertical alignment is desired, the inline rendered annotation spans already get `.markAnnotation`, and popover triggers get `data-popover-id`; sidebar marks do not currently get a sidebar-specific data attribute. A follow-up could add sidebar annotation ids into rendered spans and measure them.

## CSS Notes

Current comment styles are a top-flow yellow box:

- `.annotationSidebar`
- `.annotationCard`
- `.annotationBodyEditor`

Expected new styles:

- `.editorContent`: grid container under toolbar/undo status.
- `.documentColumn`: min-width `0`; owns `.blockList` and footnotes.
- `.commentSidebar`: right column, fixed or clamped width around `220px-280px`.
- `.commentSidebar.collapsed`: slim gutter around `32px-44px`.
- `.commentGutterDot`: circular buttons, stable dimensions, visible focus ring.
- Keep `.annotationBodyEditor` mostly reusable.

The existing responsive breakpoint is `@media (max-width: 980px)`, where the editor panels stack. The sidebar also needs a responsive decision: either remain as a right gutter inside each panel, or collapse to a top/bottom strip on narrow widths. Since the task explicitly says right-hand sidebar, prefer keeping a narrow right column and allowing cards to use a compact width when open.

## Tests To Add Or Update

`App.test.tsx` already has comment body tests around creating comments, editing comment body rich text, and nested comments.

High-value UI tests:

- Comments no longer render before `.blockList`; a sidebar comment appears in a right-hand comments region sibling to the document column.
- Toggling the comments sidebar closed hides comment body textboxes and shows one circular gutter button per sidebar annotation.
- Clicking a gutter dot opens the sidebar and focuses the corresponding `Annotation body` textbox.
- Creating a comment while the sidebar is collapsed opens the sidebar and focuses the new `Annotation body` textbox.
- Creating a second body block for an exact existing annotation while collapsed opens the sidebar and focuses the newly-added body block.
- Footnotes and popovers still render in their existing places and are not affected by the sidebar collapsed state.

Testing focus should be feasible with the existing helpers because current tests already assert `domSelectionBlock()` for annotation body editors.

## Open Questions

- Should the sidebar default to open or collapsed? The task only says collapsible; default open best preserves current visibility.
    - collapsed
- Should collapsed gutter dots align vertically with their referenced text/block, or is ordered-dot gutter behavior sufficient?
    - aligned vertically as much as possible without overlapping each other
- If an annotation has multiple body blocks, should the gutter show one dot per annotation or one dot per body block? The task says "comments" and "focus the comment block"; because exact-overlap creates multiple body blocks under one annotation, one dot per body block may be more precise, while one dot per annotation is visually cleaner.
    - one dot per annotation
- When clicking a gutter dot for an annotation with multiple body blocks, should focus go to the first body block, the last body block, or the most recently edited body block?
    - most recently edited body block
- Should opening/closing be per editor panel only, or synchronized between Editor A and Editor B? Local per-panel state seems appropriate because this is view state, not CRDT state.
    - per panel, local view state
- Should the sidebar open automatically for comments created remotely by the other replica? The task explicitly mentions "when creating a new comment", which sounds local only.
    - no

## Additional notes

let's change `createAnnotation` to return the ID explicitly so we don't have to guess.
