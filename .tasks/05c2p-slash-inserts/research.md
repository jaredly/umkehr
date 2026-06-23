# Research: Slash Insert Popover

## Goal

Update `examples/block-rich-text` so typing `/` inserts an actual slash into the CRDT document and opens a command popover. Focus should move into a search input at the top of the popover. Pressing `Escape` should close the popover and let the user continue typing in the editor. Choosing a command should tombstone the slash character and then run the selected command.

Initial commands should include:

- Change the current block type.
- Insert some inline embed.

## Current Architecture

The editor entry point is `examples/block-rich-text/src/App.tsx`.

`EditorApp` owns replayable history, two replicas, undo state, and keystroke logging. It renders two `BlockEditor` instances. `BlockEditor` owns local UI state like current focus, annotation/link/code popovers, pending inline marks, retained inline mark sessions, and the visible block tree.

Text input is handled at the editable surface layer:

- `RichTextEditableSurface` installs a native `beforeinput` listener.
- For `inputType === 'insertText'`, it prevents the browser mutation and calls `onInsertText(event.data, selection)`.
- Normal block rendering passes `onInsertText` through `renderEditableBlock`.
- `BlockEditor` supplies `insertTextWithPendingMarks`, which delegates to `insertTextWithMarkdownShortcutsEverywhere` unless pending inline marks require `insertTextWithRetainedMarksEverywhere`.

This means `/` should not be intercepted in `keydown` before insertion. The correct trigger point is the insert-text path after the command has produced a CRDT insertion result.

Selections are retained as `RetainedSelectionSet` on each replica. UI code resolves them with `resolveSelectionSet`, reads live DOM selection with `readSelectionFromDom`, and restores DOM focus with `scheduleSelectionRestore` plus `restoreSelectionToDom`/`restoreCaretToDom`.

Existing command popovers:

- Link and code floating popovers are local React state in `BlockEditor`.
- They use absolute `top`/`left`, `role="dialog"`, `autoFocus` inputs, `Escape` close handling, and `onMouseDown={(event) => event.stopPropagation()}`.
- Annotation popovers use a separate `useAnnotationPopoverController`, but that controller is tied to annotation mark triggers and hover/selection behavior, so it is not the right primitive for the slash menu.

## Relevant Command Primitives

Block type commands already exist:

- `blockTypeMeta(kind, current, ts)` in `App.tsx` maps toolbar menu values to `RichBlockMeta`.
- `setBlockTypeEverywhere(state, selection, metaForBlock)` in `multiSelectionCommands.ts` runs block-meta changes across the current selection set.
- Tables are special: toolbar `onBlockType('table')` calls `convertBlockToTable(...)`, not `setBlockTypeEverywhere`, because a table needs additional child blocks.

Slash deletion should use existing text deletion operations:

- `deleteRangeOps(state, {block, startOffset, endOffset})` tombstones visible characters and returns `char:delete` ops.
- `insertText(...)` and markdown shortcuts already use this pattern when removing typed shortcut characters.

The slash menu should keep enough state to know exactly which slash to delete. A simple first pass can store `{blockId, offset}` where `offset` is the slash offset at the time it was inserted. Because the popover immediately steals focus and the example is local, that is probably enough for the UI scenario. A more CRDT-correct version would store the inserted slash character id from the `char` op returned by the insert command, then delete by id or resolve the id back to its current visible offset before applying `deleteRangeOps`.

The second approach is better because remote inserts before the slash can happen while the menu is open. The insertion result includes `ops`; for a single `/`, the inserted `char` op can be found with:

```ts
const slashChar = result.ops.find((op) => op.type === 'char' && op.char.text === '/');
```

Then, on command selection, resolve that char id against `orderedCharIdsForBlock(state, blockId, {visibleOnly: true})` or the raw `state.state.chars` parent to find the current block and visible offset. If the char is already deleted or no longer visible, skip deletion and still run the requested action.

## Proposed Implementation Shape

Add a local `SlashMenuState` to `BlockEditor`, similar to `LinkPopoverState`:

```ts
type SlashMenuState = {
    slashCharId: string;
    fallbackBlockId: string;
    fallbackOffset: number;
    top: number;
    left: number;
    query: string;
};
```

Open it from the insert path rather than `keydown`.

One clean route is to add a wrapper around the existing text insertion in `BlockEditor`:

1. For non-`/` input, keep existing behavior.
2. For `/`, run the normal `insertTextWithPendingMarks` command so the slash is inserted into the document and replicated.
3. Inspect the command result for the inserted slash char.
4. Resolve the post-insert primary selection and schedule restore as today.
5. Compute popover position from the current caret/root. Existing `linkPopoverPositionFromSelection(rootRef.current)` is likely reusable as the initial approximation.
6. Set `slashMenu` state, which renders a `SlashCommandPopover` with an auto-focused search input.

Because `runEditCommand` currently hides the command result inside the `onCommand` callback, it may be easiest to create a specialized `insertTextFromSurface` callback in `BlockEditor` that mirrors `runEditCommand` but also observes the result when `text === '/'`. Another option is to have the existing `onInsertText` handler call a new context method like `onInsertTextFromSurface(text, activeSelection)`.

Selecting a command should be a single local change when possible:

1. Resolve/delete the stored slash character first, appending `deleteRangeOps` to the ops.
2. Run the selected command against the resulting state.
3. Return combined ops and a sensible selection.

This preserves history/replay: the selection action becomes one `local-change` containing both slash tombstoning and the command.

For block type commands, selection should probably be the current retained selection, with the slash removed before applying `setBlockTypeEverywhere`. For table conversion, mirror the toolbar special case. After the operation, close the slash menu and restore focus to the editor selection returned by the command.

For `Escape`, close the menu and restore editor focus/caret to the current primary selection without deleting the slash. This matches the requirement that the slash remains typed and the user can continue typing.

## Inline Embed Options

There is no current first-class inline embed model in `RichBlockMeta` or the block CRDT op types. The CRDT supports chars and marks. Existing inline semantics, including links, code, annotations, footnotes, and popover annotations, are represented as marks over text ranges with optional JSON data.

Potential approaches:

- Placeholder text plus mark: insert a visible token such as `[embed]` or a single object-replacement-style character, then add a mark like `inline_embed` with JSON data. Render that marked run as a non-editable chip in `renderRunNodes`/`applyRunClasses`.
- Plain demo text: selecting “Inline embed” deletes `/` and inserts a simple textual placeholder. This is lowest risk but does not really implement an inline embed.
- New char-like entity: not supported by current op model and would be too large for this example task.

The placeholder-plus-mark approach fits the current architecture best, but it needs a product decision about what text should be stored and what embed data should look like.

## UI Notes

The popover should be local UI state, not CRDT state.

Expected behavior:

- `/` appears in both replicas as a normal inserted char if online.
- The menu opens only on the editor where the user typed slash.
- The search input receives focus.
- Typed query filters visible commands; it should not mutate the document.
- `Escape` closes the menu and restores focus to the editor. The slash remains.
- Selecting a command deletes the slash via CRDT ops and applies the command.
- Mouse down inside the menu should stop propagation so the editor's global mouse handling does not close unrelated state or disturb selections.

The popover should probably close on:

- `Escape`.
- Selecting a command.
- Mouse down outside editor/menu.
- Reset/history replay.
- Blur to outside both editor and menu, unless this causes problems with clicking menu items.

Positioning can start with the existing `linkPopoverPositionFromSelection(rootRef.current)`, but this should be verified visually because the search input receives focus immediately after opening, which may move the browser selection out of the contenteditable.

## Testing Plan

Add focused tests in `examples/block-rich-text/src/App.test.tsx`:

- Typing `/` through `beforeinput` inserts `/`, opens a slash command dialog, and focuses the search input.
- Pressing `Escape` closes the dialog, keeps `/` in the document, and subsequent typing appends after the slash.
- Selecting a block type command deletes `/` from both replicas and changes the current block type.
- Selecting the inline embed command deletes `/` and inserts/renders the chosen embed representation.
- Typing a query filters options without changing document text.

Add command-level tests if a helper is introduced for deleting the stored slash and applying a command. In particular, test that deleting the slash emits `char:delete` and that the slash is gone after applying the returned ops.

Run at minimum:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts
npm --prefix examples/block-rich-text run build
```

## Risks

The biggest risk is focus and selection ownership. Once the menu input has focus, `readSelectionFromDom(root)` will return null. The slash menu therefore must capture the relevant retained selection and slash character id before moving focus to the search input.

Remote/concurrent edits while the menu is open can invalidate an offset-based slash pointer. Storing the inserted char id avoids this.

Multi-selection behavior needs an explicit choice. The current insertion path can insert text into every selected range. If multiple selections are active and `/` is typed, there may be multiple slash chars. The simplest defensible behavior is to open the menu only when the resolved selection set has a single primary caret. Otherwise `/` should just insert normally.

Markdown shortcuts currently run for inserted text through `insertTextWithMarkdownShortcutsEverywhere`. `/` has no current shortcut, so there is no conflict.

Tables are a special block type command and should not be treated like ordinary metadata.

## Open Questions

1. What should “insert some inline embed” mean for this demo: a non-editable chip, an annotation-style popover mark, a link preview placeholder, or just a textual placeholder?
2. Should slash commands trigger inside code blocks, table cells, row headers, and annotation body blocks, or only normal document blocks?
3. What exact block type options should the menu include? It can mirror the toolbar, but table conversion has different behavior and may be surprising in a compact command menu.
4. Should command selection be recorded as one history action with slash deletion plus command, or two actions? One action seems better for undo, but two actions exposes the typed slash as an independent historical edit.
5. For multi-selection, should the menu be disabled, operate only on the primary selection, or delete every inserted slash and apply the command to every selection?
6. If the slash is concurrently deleted before the user chooses a command, should selection still run the chosen command or cancel silently?
