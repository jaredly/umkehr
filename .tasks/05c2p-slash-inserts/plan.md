# Plan: Slash Insert Popover

## Decisions

These decisions come from the answered questions in `research.md`:

- Include the existing `date` inline embed command from `05c2h-inline-embeds`.
- Trigger slash commands everywhere except syntax-highlighted code blocks.
- Mirror the toolbar block type options.
- Selecting a command records one history action that deletes the slash and applies the command.
- Multi-selection should apply to every selection.
- If a slash was already deleted by the time a command is selected, still run the selected command.

## Phase 1: Slash Trigger State and Insertion Hook

Add slash menu state in `examples/block-rich-text/src/App.tsx`, owned by `BlockEditor`.

Model the state around the inserted slash characters, not only offsets:

- Track one entry per inserted slash for multi-selection support.
- Store each slash char id when available.
- Store a fallback block id and offset for each slash in case char id resolution fails.
- Store the retained selection set from immediately after `/` insertion.
- Store popover position and search query.

Hook slash opening into the text insertion path after CRDT insertion succeeds.

Implementation notes:

- Do not intercept `/` in `keydown`; `RichTextEditableSurface` already funnels real text through `beforeinput`.
- Wrap or replace the existing `insertTextWithPendingMarks` call path so the result is observable when `text === '/'`.
- For `/`, insert normally first, schedule selection restore as today, then inspect the returned `char` ops for slash characters.
- Open the menu only when the active block is allowed. Syntax-highlighted code blocks should just insert `/` normally.
- If multiple selections inserted multiple slashes, store all inserted slash char ids and open one menu for the active editor.

Deliverable:

- Typing `/` still inserts `/` and syncs to the peer.
- Slash menu state opens only for eligible surfaces.

## Phase 2: Popover UI and Focus Behavior

Add a `SlashCommandPopover` component in `App.tsx`, near the existing link/code/date popovers.

Expected UI:

- `role="dialog"` with an accessible name such as `Slash commands`.
- Search input at the top with `autoFocus`.
- Filterable command list below.
- Commands grouped or labeled clearly enough to scan.
- Mouse/pointer events inside the popover stop propagation.

Commands:

- Block type options mirroring the toolbar:
  - Paragraph
  - Heading 1
  - Heading 2
  - Heading 3
  - Bulleted list
  - Numbered list
  - Todo
  - Blockquote
  - Code
  - Info callout
  - Warning callout
  - Error callout
  - Table
- Inline embed:
  - Date

Focus rules:

- Opening the menu focuses the search input.
- `Escape` closes the menu, keeps the slash characters, restores focus/caret to the editor selection after the slash insertion, and allows continued typing.
- Query typing filters commands and does not modify the document.
- Arrow/Enter navigation can be simple in the first pass, but clicking and Enter on focused buttons/options should work.

Close the menu on:

- `Escape`.
- Command selection.
- Reset/history replay.
- Mouse down outside the popover/editor where existing popovers are already closed.

Deliverable:

- A usable command menu opens from `/`, focuses search, filters commands, and closes without deleting `/` on `Escape`.

## Phase 3: Slash Deletion Helper

Add local helper logic, probably in `App.tsx` unless it becomes reusable enough for `blockCommands.ts`.

Responsibilities:

- Resolve each stored slash char id to its current visible `{blockId, offset}`.
- Use `orderedCharIdsForBlock(state, blockId, {visibleOnly: true})` to find the current visible offset.
- Fall back to the stored `{blockId, offset}` only if char id resolution fails and the fallback still points at a visible `/`.
- Delete each resolvable slash with `deleteRangeOps`.
- Apply the delete ops immediately to the working state before running the selected command.
- Skip missing or already-deleted slash entries and continue.

Multi-selection requirements:

- Delete every slash inserted by the triggering `/` action.
- Preserve a selection set that still represents the intended command target after slash deletion.
- Prefer resolving from the retained post-insert selection set, then moving each primary/entry caret back by one when its slash was deleted immediately before it.

Deliverable:

- Selecting any command tombstones all tracked slash chars that still exist.
- Missing slashes do not prevent the command from running.

## Phase 4: Command Application

Implement slash command handlers that combine slash deletion plus the selected command into one `onCommand` result.

Block type commands:

- Use `setBlockTypeEverywhere` for ordinary block types.
- Use the existing toolbar mapping via `blockTypeMeta`.
- Preserve `todo` checked state behavior and code language behavior by reusing `blockTypeMeta`.

Table command:

- Mirror toolbar behavior.
- For the primary selection, call `convertBlockToTable`.
- Decide carefully how multi-selection should behave for tables. The user asked that slash commands apply to every selection; if table conversion cannot safely apply to every selected block with existing helpers, document the limitation in `implementation-log.md` and implement a focused fallback.

Date embed command:

- Use existing `insertInlineEmbed`.
- Insert `{type: 'date', value: '2026-06-23'}` to match the current toolbar Date behavior.
- Apply across every selection, matching multi-selection behavior.

History:

- Return a single `MultiCommandResult` containing slash delete ops plus selected command ops.
- Do not create a separate transient command for deletion.
- After applying, close the menu and schedule selection restore to the returned primary selection.

Deliverable:

- Block type, table, and date embed commands run from the slash menu as one history action.

## Phase 5: Surface Coverage

Wire slash insertion/menu behavior through all editable surfaces where commands should be supported:

- Normal document blocks.
- Table cells.
- Table row headers.
- Annotation body blocks, if they use compatible command plumbing.

Do not open slash commands in syntax-highlighted code blocks.

Important checks:

- Some surfaces pass custom `onInsertText` and command handlers.
- Annotation bodies use separate command helpers and local selection state, so they may need either a small adapter or an explicit scoped implementation.
- Table row headers and cells should share the same command path where possible.

Deliverable:

- Slash menu works in every supported text surface and degrades to normal `/` insertion in unsupported or excluded surfaces.

## Phase 6: Styling and Interaction Polish

Add styles in `examples/block-rich-text/src/style.css`.

Style goals:

- Match existing floating popovers (`linkFloatingPopover`, `embedFloatingPopover`) rather than introducing a separate visual language.
- Keep width stable and compact.
- Make filtered command rows easy to scan.
- Ensure the popover does not cover the typed caret more than necessary.
- Support mobile/narrow editor panels.

Interaction polish:

- Highlight the first filtered result.
- Enter chooses the highlighted result if focus is in the search box.
- Arrow Up/Down moves the highlighted result.
- Empty results state is visible but compact.

Deliverable:

- Popover feels like part of the existing editor UI and remains usable in both side-by-side panels.

## Phase 7: Tests

Add app-level tests in `examples/block-rich-text/src/App.test.tsx`.

Core tests:

- Typing `/` via `beforeinput` inserts `/`, syncs to the peer, opens the slash command dialog, and focuses the search input.
- Pressing `Escape` closes the dialog, keeps `/`, restores editor focus, and subsequent typing appends after `/`.
- Search query filters options without changing document text.
- Selecting Heading 2 deletes `/` in both replicas and changes the block type.
- Selecting Date deletes `/` and inserts a date inline embed.
- Selecting a command after manually deleting the slash still runs the command.

Multi-selection tests:

- With multiple carets, typing `/` inserts slashes at every caret and opens one menu.
- Selecting a block type deletes every inserted slash and applies the block command across selections.
- Selecting Date deletes every inserted slash and inserts date embeds at every selection.

Surface tests:

- Slash menu opens in a table cell.
- Slash menu opens in a table row header.
- Slash menu does not open in a code block, but `/` remains inserted.
- Add annotation body coverage if implementation supports it in this phase.

Regression tests:

- Existing link/code/date popovers still open and close normally.
- Existing markdown shortcuts still work.
- Undo treats slash command selection as one edit action.

Run:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts
npm --prefix examples/block-rich-text run build
```

If changes touch inline embed helpers, also run:

```sh
npm exec vitest -- run examples/block-rich-text/src/inlineEmbeds.test.ts
```

## Phase 8: Manual Verification

Start the example app and verify in the browser:

- Type `/` in Editor A and select Heading 2.
- Type `/`, search `date`, select Date, then click/edit the date embed.
- Type `/`, press `Escape`, continue typing.
- Repeat in Editor B.
- Repeat while one editor is offline, then reconnect.
- Try table cells and row headers.
- Confirm code blocks insert `/` without opening the menu.

Record any issues or intentional limitations in `implementation-log.md`.

## Known Risks

- Focus moves to the search input, so all editor selection state needed for command execution must be captured before opening the menu.
- Multi-selection slash tracking must not confuse older slash chars with the slashes inserted by the triggering input.
- Table conversion across multiple selections may need extra care because existing toolbar behavior is primary-selection oriented.
- Annotation body support may require a separate adapter because annotation body editing does not use exactly the same command path as main blocks.
- Positioning based on the editor selection may become stale after the search input receives focus; compute position before focusing the input.
