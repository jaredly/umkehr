# Implementation Log: Strikethrough and Links

## Phase 1: Mark Command Primitives

- Added `examples/block-rich-text/src/inlineMarks.ts` with shared inline mark types, link target range types, link-like detection, link selection text helpers, and contiguous link range detection.
- Widened `toggleMark` to support `strikethrough`.
- Added `setLinkMark` and `removeLinkMark` command helpers using the existing non-stacking CRDT mark semantics.
- Added `setLinkMarkEverywhere` and `removeLinkMarkEverywhere` for retained multi-selection sets.
- Added command tests for strikethrough toggle, link apply/update/remove, non-stacking link updates, cross-block link marks, and multi-selection link application.

Issues/workarounds:

- None so far.

## Phase 2: Link Range and Link-Like Helpers

- Added unit coverage for link-like detection, contiguous link range detection, consistent selected href detection, and selected text extraction.
- Link-like detection currently accepts explicit `http://`, `https://`, and `mailto:` targets only. Bare domains are intentionally not treated as link-like because the requested behavior says not to normalize link targets.

Issues/workarounds:

- Product wording says "link-like"; this implementation chooses explicit schemes as the least surprising no-normalization behavior.

## Phase 3: Rendering and Styling

- Updated dynamic editable run rendering to add `markStrikethrough`, `markLink`, and `data-link-href`.
- Updated static run rendering so annotation sidebar/footnote/popover surfaces display the same mark classes.
- Updated run serialization to include `strikethrough` and `link`; this is required so DOM children are replaced when only these marks change.
- Added CSS for strikethrough, links, and combined underline plus line-through decoration.

Issues/workarounds:

- No issue in the rendering layer. UI assertions will be added after the toolbar and shortcut paths exist.

## Phases 4 and 5: Main Editor UI, Shortcuts, Paste, and Link Popover

- Added toolbar controls for strikethrough and links.
- Added `Mod+Shift+X` for strikethrough and `Mod+K` for link creation/editing in main editor blocks.
- Added link-like paste handling: pasting an explicit link target over a selected range now applies a link mark to the existing text instead of replacing it.
- Added range-based link popover state in `BlockEditor`.
- Added a fixed-position link popover with URL input, Apply, Remove, and Escape-to-close behavior.
- Added collapsed-caret editing for existing links by expanding the caret to the contiguous link range.
- Added click handling on rendered link spans to open the link popover for the contiguous link range.
- Added UI tests for strikethrough, direct `Mod+K` link creation, paste-over-selection link creation, and editing/removing an existing link.

Issues/workarounds:

- Link target state is stored as explicit block ranges before the popover input receives focus. This avoids depending on live DOM selection while focus is inside the popover.
- The link target is trimmed before storage for shortcut/paste/popover apply. No URL scheme or target normalization is performed.

## Phase 6: Annotation Body Editors

- Widened annotation body mark toggling to support `strikethrough`.
- Added annotation body link apply/remove commands because annotation body blocks live under virtual parents and are not visible to the normal editable block selection helpers.
- Added `Mod+Shift+X`, `Mod+K`, link-like paste behavior, and local link popover support to annotation body editors.
- Reused the same rendering classes for sidebar comments, footnotes, and annotation popovers.
- Added UI coverage for strikethrough and link creation inside a comment body.

Issues/workarounds:

- Linked annotation body text can render as multiple adjacent `.markLink` spans when another mark splits the run. Tests assert the combined linked text and shared `data-link-href` rather than assuming one DOM node.

## Phase 7: Verification

Commands run:

- `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/inlineMarks.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/annotations.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/inlineMarks.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/App.test.tsx`
- `npm exec vitest -- run examples/block-rich-text/src`
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`
- `npm run build` from `examples/block-rich-text`
- `curl -I http://127.0.0.1:5174/`

Results:

- Focused command/helper/UI tests passed.
- All `examples/block-rich-text/src` tests passed: 10 files, 216 tests.
- Example TypeScript check passed.
- Example production build passed.
- Local Vite dev server responded with `HTTP/1.1 200 OK` at `http://127.0.0.1:5174/`.

Issues/workarounds:

- The in-app browser connector was unavailable with `Browser is not available: iab`, so visual browser verification could not use the Browser plugin.
- Fallback `pnpm exec playwright screenshot ...` failed because the `playwright` command is not installed in this workspace.
- `npm run build` printed `Error connecting to agent: Operation not permitted` before the script output, but `tsc` and `vite build` completed successfully.
- An unrelated `.tasks/Roadmap.md` modification is present in the worktree and was left untouched.

## Follow-up: Open Link Button

- Added an icon-only `Open link in new tab` button to the shared link popover.
- The button uses the current input value, opens it with `window.open(target, '_blank', 'noopener,noreferrer')`, and disables itself when the input is blank.
- Added UI test coverage for the new button.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`

## Follow-up: Link Hover Tooltip Delay and URL Display

- Changed the link hover tooltip to render the URL as a clickable anchor instead of an open-in-new-tab icon button.
- Added a 100ms delayed hide after leaving a link mark so the pointer can move into the tooltip.
- The tooltip cancels the pending hide while hovered and schedules it again on mouse leave.
- Applied the same delayed hover behavior to annotation body link tooltips.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`

## Follow-up: Link Hover Actions

- Replaced the unreliable primary click-to-edit interaction with a hover tooltip for existing link marks.
- The hover tooltip exposes `Edit` and icon-only `Open link in new tab` actions.
- `Edit` opens the existing URL editor for the contiguous link range; `Open` uses the link target directly with `noopener,noreferrer`.
- Link spans now carry rendered offset metadata so hover actions can resolve the link range without depending on click coordinates.
- The same hover action behavior is wired through annotation body editors.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit`
