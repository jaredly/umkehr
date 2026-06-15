# Research: Strikethrough and Link Marks for Block Rich Text

## Request

Add strikethrough and link marks to `examples/block-rich-text`. The marks should be non-stacking, and link targets should be editable in a small tooltip popover.

## Current State

The example already has inline mark support for `bold` and `italic`.

Key files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/style.css`
- `src/block-crdt/marks.ts`

`blockCommands.toggleMark` currently accepts only `'bold' | 'italic'`. It normalizes the current `EditorSelection` into per-block segments, decides whether to remove the mark by checking whether the whole selection already has that mark, then emits one `markRangeOp` per segment.

`multiSelectionCommands.toggleMarkEverywhere` wraps that command for retained multi-selection sets. It dedupes and merges overlapping ranges, skips carets, applies the mark command over each selected range, and returns the deduped retained selection.

Rendering runs through `materializeFormattedBlocks(replica.state, annotationMarkBehavior)` in `App.tsx`. `applyRunClasses` maps `run.marks.bold` and `run.marks.italic` to CSS classes. `renderStaticRuns` does the same for annotation bodies/sidebar/footnotes. Annotation popovers add extra classes and `data-popover-*` attributes to ordinary run spans.

The block CRDT mark engine already supports arbitrary mark type strings and arbitrary JSON mark data. `src/block-crdt/marks.ts` resolves non-stacking marks by last mark id per type. Stacking behavior only applies when `VirtualBlockParentConfig.markBehavior[type] === 'stacking'`. Today, `annotations.ts` opts only `annotation` into stacking:

```ts
export const annotationMarkBehavior: VirtualBlockParentConfig<RichBlockMeta> = {
    markBehavior: {[ANNOTATION_MARK]: 'stacking'},
};
```

Therefore `strikethrough` and `link` can remain non-stacking by simply not adding them to `markBehavior`.

## Existing Popover Architecture

There is already a general popover controller for annotation popovers:

- `useAnnotationPopoverController` tracks hover, selection, focus, and activation reasons.
- Rendered spans expose `data-popover-id` / `data-popover-ids`.
- `FloatingAnnotationPopover` is positioned with `position: fixed`.
- Pointer transitions keep the popover open while the user moves between trigger text and popover panel.

This is usable as a reference, but link editing is not the same as annotation body editing:

- Link marks are non-stacking, so one link value wins per character.
- Link target editing should update mark data, not edit a child block.
- A link popover should probably open from a selected link or clicked/hovered link span, and should contain a URL input plus remove/apply controls.

The annotation controller is fairly annotation-specific in naming and selected-popover derivation, so either add a small link-specific controller or extract a generic popover controller carefully. For this task, a local link-specific popover state in `BlockEditor` is likely lower-risk.

## Proposed Implementation Shape

### Mark command model

Generalize the command layer enough to support boolean marks and valued marks.

Likely changes:

- Widen mark types from `'bold' | 'italic'` to a local union such as:

```ts
type InlineMarkType = 'bold' | 'italic' | 'strikethrough' | 'link';
type InlineMarkValue = true | string;
```

- Keep `toggleMark` for boolean marks, or generalize it to accept `data?: JsonValue`.
- Add a `setMark`/`setLinkMark` command that applies a mark with a specific value and a separate remove command for clearing links.

For strikethrough, the existing toggle behavior is enough:

- Apply `markRangeOp(..., 'strikethrough', undefined, false, id)`.
- Remove with `markRangeOp(..., 'strikethrough', undefined, true, id)`.

For links, use mark data as the URL string:

- Apply/update: `markRangeOp(..., 'link', href, false, id)`.
- Remove: `markRangeOp(..., 'link', undefined, true, id)`.

Because link marks are non-stacking, updating the URL over the selected range can be represented by a new non-remove `link` mark with later id. The latest non-remove link mark wins for each covered character.

### Selection behavior

The simple first version should apply links to non-collapsed selections only, matching existing mark commands that ignore carets.

For editing an existing link target from a popover, the command needs to know the target range. Options:

- Use the current user selection if it still covers the link.
- Derive the contiguous link range around the clicked/selected run and store `{blockId, startOffset, endOffset, href}` in popover state.

The second option is more robust because clicking into an input inside the popover will move DOM focus away from the editor and may disturb the live selection. It also lets users edit a whole contiguous link even when only the caret/selection is inside it.

Needed helper:

- Given `FormattedBlock.runs`, a block id, and an offset or run boundary, find the contiguous run range whose `run.marks.link` is the same string.

### Rendering

Update both dynamic and static rendering:

- `applyRunClasses` should add `markStrikethrough` when `run.marks.strikethrough` is truthy.
- `applyRunClasses` should add `markLink` when `typeof run.marks.link === 'string'`, and set link target data attributes such as `data-link-href`.
- `renderStaticRuns` should include the same strikethrough/link classes.

Do not render actual `<a href>` inside the contenteditable surface unless navigation is intentionally handled. Plain spans with `data-link-href` avoid accidental navigation and preserve the existing DOM selection mapping assumptions.

CSS additions:

- `.markStrikethrough { text-decoration: line-through; }`
- `.markLink { color: ...; text-decoration: underline; text-underline-offset: ...; cursor: pointer; }`

If strikethrough and link overlap, CSS needs to preserve both decorations. A combined rule may be needed because separate `text-decoration` declarations can overwrite each other:

```css
.markStrikethrough.markLink {
    text-decoration-line: underline line-through;
}
```

### Toolbar and keyboard shortcuts

Toolbar currently exposes Undo, Redo, Bold, Italic, Comment, Footnote, Popover, and block type.

Add:

- Strikethrough button.
- Link button that opens the link tooltip popover for the current selection.

Keyboard shortcut choices:

- `Mod+B` and `Mod+I` already toggle bold/italic inside editable blocks and annotation bodies.
- Browser/platform conventions often use `Mod+K` for link editing.
- Strikethrough has no universal browser shortcut. Common choices include `Mod+Shift+X` or toolbar-only.

### Link tooltip popover

The popover can live in `BlockEditor`, parallel to annotation popovers.

State shape could be:

```ts
type LinkPopoverState = {
    blockId: string;
    startOffset: number;
    endOffset: number;
    href: string;
    top: number;
    left: number;
};
```

Open paths:

- Toolbar Link button opens for the current non-collapsed selection, using selected text range and existing full-range link value if consistent.
- Clicking or focusing an existing link span opens for the contiguous link range.
- Optional: selection change over an existing link can open or update the popover.

Popover controls:

- URL input.
- Apply button or Enter submits.
- Remove button clears the link mark over the stored range.
- Escape closes without applying.

Implementation detail: `onMouseDown={(event) => event.preventDefault()}` is already used on toolbar buttons to avoid stealing editor selection. The link popover input must intentionally take focus, so it should rely on stored range state instead of live DOM selection after opening.

### Tests

Add command-level tests first:

- `toggleMark` applies strikethrough and removes it when the full selection already has it.
- Link apply/update stores string data on formatted runs.
- Link remove clears the mark.
- Link is non-stacking: later link over the same range wins, with no `stackedMarks.link`.
- Cross-block selections produce per-block link marks.
- Multi-selection link application applies to all selected ranges and ignores carets.

Add render/UI tests if existing test utilities make it straightforward:

- Toolbar strikethrough button marks selected text and renders `.markStrikethrough`.
- Link popover opens for selected text, applying a URL renders `.markLink`.
- Editing an existing link changes the URL mark.
- Removing a link clears `.markLink`.

Existing test files to extend:

- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

## Risks and Edge Cases

- Link editing from a popover moves focus out of the editor. Store a retained or explicit block range before focusing the input.
- Links across multiple blocks are possible through existing selection segmentation. A single popover state may need to store multiple ranges if toolbar-created links can span blocks.
- Existing `selectionFullyHasMark` checks boolean `true` semantics. Link value detection needs either "all selected chars have some link" or "all selected chars have the same link" depending on UI behavior.
- Non-stacking link conflicts are last-id-wins per character. Concurrent different link edits over overlapping ranges may split runs by final per-character winners, which is expected under the current mark model.
- Rendering link spans as `<a>` could break selection and accidental navigation. Prefer spans unless product explicitly wants real anchors in editing mode.
- Annotation body mark support currently only handles bold/italic. Decide whether strikethrough/link should also work inside annotation body editors.

## Open Questions

1. Should links be allowed across multiple blocks from one toolbar action, or should the UI restrict link creation/editing to a single block?
    - UI should allow the selection, but create one mark per block
2. When editing an existing link, should a click inside the link edit the whole contiguous link range automatically?
    - yes
3. Should `Mod+K` open the link popover?
    - yes. also pasting a link-like over a selection should create the link instead of replacing the selection
    - also if the selection is link-like, it should just make the link instead of opening the popover
4. What shortcut, if any, should strikethrough use?
    - mod-shift-x
5. Should strikethrough and links also be supported inside annotation body editors, sidebar comments, footnotes, and annotation popovers?
    - yup, everywhere
6. Should the link target be validated or normalized, for example adding `https://` when no scheme is present?
    - no
7. Should a collapsed caret inside an existing link allow editing that link, while a collapsed caret outside a link does nothing?
    - sure
