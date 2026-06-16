# Plan: Strikethrough and Links in Block Rich Text

## Decisions From Research

- `strikethrough` and `link` are non-stacking marks.
- Multi-block link creation is allowed and should create one mark per block segment.
- Clicking or placing a collapsed caret inside an existing link should edit the whole contiguous link range.
- `Mod+K` opens link creation/editing.
- If the active selection text is link-like, `Mod+K` should create the link directly instead of opening the popover.
- Pasting link-like text over a selection should create a link instead of replacing the selection.
- `Mod+Shift+X` toggles strikethrough.
- Strikethrough and links should work everywhere marks currently render or edit: main editor blocks, annotation body editors, sidebar comments, footnotes, and annotation popovers.
- Link targets should not be validated or normalized.

## Phase 1: Mark Command Primitives

Update the command layer so boolean marks and valued link marks share the existing CRDT mark model.

Tasks:

- Add shared inline mark types, likely in `blockCommands.ts` or a small local helper module:
  - Boolean marks: `bold`, `italic`, `strikethrough`.
  - Valued mark: `link`.
- Widen `toggleMark` from `'bold' | 'italic'` to include `strikethrough`.
- Add link commands that can apply, update, and remove link marks over normalized selection segments:
  - `setLinkMark(state, selection, href, context)`
  - `removeLinkMark(state, selection, context)`
  - Or a generic valued mark helper if it stays simple.
- Add multi-selection wrappers in `multiSelectionCommands.ts`:
  - Toggle strikethrough everywhere.
  - Set/remove links everywhere, creating one mark per selected block segment.
  - Ignore carets unless the caller has already expanded a caret inside an existing link to a link range.
- Keep annotations as the only stacking mark by leaving `annotationMarkBehavior` unchanged.

Tests:

- Extend `blockCommands.test.ts` for strikethrough toggle on/off.
- Test link apply/update/remove.
- Test link non-stacking behavior: later link wins and `stackedMarks.link` is absent.
- Test cross-block link selection creates per-block link runs.
- Extend `multiSelectionCommands.test.ts` for link application over multiple selected ranges and ignored unrelated carets.

## Phase 2: Link Range and Link-Like Helpers

Add pure helpers for finding and creating link targets without depending on live DOM state.

Tasks:

- Add a helper to detect link-like text. Keep it intentionally permissive and non-normalizing.
  - Accept obvious URL-ish strings such as `https://...`, `http://...`, and likely `mailto:...`.
  - Decide in implementation whether bare domains count as link-like; no normalization means they should remain exactly as typed if accepted.
- Add helpers that inspect formatted runs and return:
  - The consistent link value for a selection, if every selected character has the same link.
  - The contiguous link range around a block offset for collapsed-caret/click editing.
  - The block segments for a multi-block selection, with existing selected text when needed.
- Represent stored link editing targets explicitly, not as live DOM selection:

```ts
type LinkTargetRange = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

type LinkPopoverState = {
    ranges: LinkTargetRange[];
    href: string;
    top: number;
    left: number;
};
```

Tests:

- Unit-test contiguous link range detection across adjacent runs with the same href.
- Unit-test that mixed href selections do not report a single href.
- Unit-test link-like detection, including preserving the original target string.

## Phase 3: Rendering and Styling

Render the new marks everywhere formatted runs are displayed.

Tasks:

- Update `applyRunClasses` in `App.tsx`:
  - Add `.markStrikethrough` for `run.marks.strikethrough`.
  - Add `.markLink` and `data-link-href` for string `run.marks.link`.
- Update `renderStaticRuns` with the same classes so sidebar comments, footnotes, and popover bodies render correctly.
- Add CSS:
  - `.markStrikethrough`
  - `.markLink`
  - Combined `.markStrikethrough.markLink` so underline and line-through both appear.
- Keep editable links as spans rather than anchors to avoid accidental navigation and selection-mapping changes.

Tests:

- Add or extend render tests in `App.test.tsx` for strikethrough and link classes.
- Verify overlapping link + strikethrough gets both classes.

## Phase 4: Main Editor UI and Shortcuts

Expose strikethrough and link editing in the main toolbar and keyboard handling.

Tasks:

- Add toolbar buttons:
  - Strikethrough button.
  - Link button.
- Wire `Mod+Shift+X` to toggle strikethrough in `EditableBlock`.
- Wire `Mod+K` in `EditableBlock`:
  - If the current non-collapsed selection text is link-like, apply that exact text as the link target immediately.
  - If the selection is non-collapsed but not link-like, open the link popover for all selected block segments.
  - If the caret is inside an existing link, open the popover for the whole contiguous link range.
  - If collapsed outside a link, do nothing.
- Handle paste into a non-collapsed selection:
  - If pasted plain text is link-like, prevent default and apply it as a link target to the selection.
  - Otherwise keep existing paste behavior.
- Add click/focus behavior on existing link spans:
  - Clicking inside a link opens the popover for the contiguous link range.
  - Store explicit ranges before moving focus into the popover.

Tests:

- UI test `Mod+Shift+X` toggles strikethrough.
- UI test toolbar link opens popover for selected text.
- UI test `Mod+K` with link-like selected text creates link without opening popover.
- UI test paste link-like over selection creates a link instead of replacing the text.
- UI test collapsed caret or click inside a link opens editing for the full contiguous link.

## Phase 5: Link Tooltip Popover

Implement a small link editor popover local to `BlockEditor`.

Tasks:

- Add popover state in `BlockEditor` using stored target ranges.
- Position the popover near:
  - The current DOM selection rect for toolbar/shortcut creation.
  - The clicked link span rect for existing link editing.
- Render a compact fixed-position popover with:
  - URL input initialized to the existing href or empty string.
  - Apply action.
  - Remove action.
  - Escape closes without applying.
- On apply:
  - Use the stored ranges to create one `link` mark per range with the typed href.
  - Preserve the text and restore/select the affected range where practical.
- On remove:
  - Emit remove link marks over stored ranges.
- Close the popover on outside editor/panel click, Escape, or after apply/remove.

Tests:

- UI test editing an existing link changes its `data-link-href`.
- UI test remove clears the link class and mark.
- UI test focusing the popover input does not lose the intended target range.

## Phase 6: Annotation Body Editors

Bring the same mark behavior to annotation bodies.

Tasks:

- Widen `toggleAnnotationBodyMark` to include `strikethrough`.
- Add annotation body link set/remove commands, or reuse the same range-based mark helpers against a single body block.
- Add `Mod+Shift+X` and `Mod+K` handling inside `AnnotationBodyBlock`.
- Add paste link-like-over-selection behavior inside annotation bodies.
- Reuse the same rendered classes through `renderStaticRuns`.
- Decide implementation detail for link popovers inside annotation floating popovers/sidebar:
  - Prefer one shared popover component/state shape.
  - Ensure nested annotation popovers remain open while the link popover input is focused.

Tests:

- Annotation body strikethrough command applies and renders.
- Annotation body link creation/edit/remove works in sidebar and floating popover contexts where practical.

## Phase 7: Verification and Polish

Run targeted checks and clean up behavior around focus and selection.

Tasks:

- Run focused unit tests:
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- Run broader block-rich-text tests if targeted tests pass.
- Start the example dev server and manually verify:
  - Main editor strikethrough.
  - Link toolbar and `Mod+K`.
  - Paste link-like over selection.
  - Editing/removing existing links.
  - Multi-block selection creates per-block links.
  - Annotation body behavior in sidebar, footnote, and popover surfaces.
- Check TypeScript and formatting via the repo’s existing scripts if available.

## Implementation Notes

- Keep the CRDT layer unchanged unless tests reveal a real mark-model gap.
- Avoid rendering editable links as real anchors.
- Do not normalize hrefs. Store exactly what the user typed or pasted.
- Prefer pure helpers for link range detection and URL-like detection so behavior is testable without DOM.
- Be careful with popover focus: selection should be captured before the input receives focus, and command application should use stored ranges.
