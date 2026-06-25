# Plan: Poll Edit/View Toggle

## Decisions

- Mode is UI-only state.
- Mode is per poll block, defaulting to `view`.
- Only child-backed polls get the toggle: answer polls (`kind === 'children'`) and matrix polls (`kind === 'matrix'`).
- The toggle lives inline in the poll block, not in the persisted block options menu.
- View mode hides all child blocks and shows the rendered poll.
- Edit mode shows child blocks and hides the rendered poll controls.
- The poll question remains visible/editable in both modes.
- Switching from edit to view moves the caret to the parent poll block if the active selection is inside the subtree being hidden.
- Rating and long-answer polls are unchanged.

## Phase 1: Add Local Mode State

Files:

- `examples/block-rich-text/src/EditorApp.tsx`

Tasks:

1. Add a local type near the render/editor UI types:

   ```ts
   type PollEditorMode = 'view' | 'edit';
   ```

2. Add `pollModesByBlockId` state inside `EditorPane`.

   ```ts
   const [pollModesByBlockId, setPollModesByBlockId] =
       useState<Record<string, PollEditorMode>>({});
   ```

3. Add helpers:

   - `pollModeForBlock(blockId): PollEditorMode`, returning `pollModesByBlockId[blockId] ?? 'view'`
   - `setPollModeForBlock(blockId, mode)`, updating the record

4. Extend `RenderBlockContext` with those helpers and pass them where `renderBlockNode` is called.

Expected result:

- Poll mode changes are local to one `EditorPane`.
- No CRDT ops, document metadata, history actions, or remote replica sync happen when the mode changes.

## Phase 2: Gate Poll Children In The Render Tree

Files:

- `examples/block-rich-text/src/EditorApp.tsx`

Tasks:

1. Add a helper or inline condition for child-backed polls:

   ```ts
   const isChildBackedPoll =
       meta.type === 'poll' && (meta.kind === 'children' || meta.kind === 'matrix');
   ```

2. In `renderBlockNode`, compute the current poll mode for child-backed polls.

3. Pass the poll mode and mode setter through `renderEditableBlock` options into `EditableBlock` and then into `PollBlock`.

4. Gate child rendering:

   - render children normally for non-child-backed blocks
   - render answer/matrix poll children only in `edit` mode
   - hide all matrix children in `view` mode, including extra children that are not represented in the matrix grid

Expected result:

- View mode eliminates duplicate answer/matrix poll content.
- Edit mode restores the child subtree for option/row/column editing.

## Phase 3: Render The Inline Toggle

Files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/style.css`

Tasks:

1. Add optional poll editor mode props to `EditableBlock` / `PollBlock`:

   ```ts
   editorMode?: PollEditorMode;
   onSetEditorMode?(mode: PollEditorMode): void;
   ```

2. Render an inline segmented toggle only for answer and matrix polls.

   Suggested markup:

   - wrapper: `.pollEditorMode`
   - buttons: `.pollEditorModeButton`
   - selected button: `.selected`
   - `aria-pressed` on each button
   - `contentEditable={false}` on the wrapper
   - `onMouseDown={(event) => event.preventDefault()}` on buttons to avoid stealing editor selection

3. In answer and matrix poll render paths:

   - Always render `{question}`.
   - Always render the inline toggle.
   - In `view`, render existing poll controls.
   - In `edit`, omit `.pollControls` / `.matrixPollControls`.

4. Leave rating and long-answer poll rendering unchanged.

Expected result:

- The toggle is visible and usable on answer/matrix polls.
- It is visually separate from `BlockOptions`, which remain persisted metadata controls.

## Phase 4: Handle Selection When Hiding Children

Files:

- `examples/block-rich-text/src/EditorApp.tsx`

Tasks:

1. When changing a child-backed poll from `edit` to `view`, determine whether the active primary selection is inside that poll's descendant subtree.

   Useful existing pieces:

   - `visibleSubtreeBlockIds`
   - `primarySelection`
   - `focusPoint`
   - `firstPointForSelection`
   - `caret`
   - existing selection update helpers in `EditorPane`

2. If the selection is inside the hidden subtree, move it to the parent poll block.

   Recommended target:

   - `caret(parentPollBlockId, pointTextLength(replica.state, parentPollBlockId))`

3. Use existing selection update pathways so DOM restoration remains consistent.

4. Do not change selection when:

   - switching from `view` to `edit`
   - switching to `view` while selection is outside the hidden subtree
   - toggling a non-child-backed poll, which should not be possible from UI

Expected result:

- The editor never leaves the visible active caret inside a hidden child block.

## Phase 5: Tests

Files:

- `examples/block-rich-text/src/App.test.tsx`

Tasks:

1. Add answer poll tests:

   - Load the `answer-polls` fixture.
   - Assert default view mode shows poll option buttons.
   - Assert option child block rows are not visible as standalone editable children.
   - Toggle to edit mode.
   - Assert `.pollOptions` is hidden.
   - Assert child option text appears as editable child blocks.
   - Toggle back to view and assert the poll controls return.

2. Add matrix poll tests:

   - Load the `matrix-polls` fixture.
   - Assert default view mode shows `.matrixPollGrid`.
   - Assert row/column setup blocks and the `Ignored extra child` fixture content are hidden.
   - Toggle to edit mode.
   - Assert `.matrixPollGrid` is hidden.
   - Assert row/column setup blocks and extra child content are visible.
   - Toggle back to view and assert matrix controls return.

3. Add UI-only behavior coverage:

   - Toggle a poll in the left pane and assert the right pane remains in its default mode.
   - If there is a stable history/status assertion, verify no command/history entry is created by the toggle.

4. Add selection behavior coverage if feasible in jsdom:

   - Put caret in an answer/matrix child while in edit mode.
   - Toggle to view.
   - Assert the parent poll block becomes the active visible selection target.

Expected result:

- Tests cover default behavior, both mode transitions, per-pane state, and the hidden-selection edge case.

## Phase 6: Verification

Commands:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

If the full file is too slow or noisy, start with targeted tests using the poll-related test names, then run the full file before finishing.

Manual checks if running the app:

1. Load `answer-polls`.
2. Confirm poll option buttons are visible and child option rows are hidden.
3. Toggle to edit and confirm the child option rows appear while rendered poll controls disappear.
4. Load `matrix-polls`.
5. Confirm the matrix grid is visible and all child configuration blocks are hidden.
6. Toggle to edit and confirm row/column child blocks appear while the matrix grid disappears.
7. Confirm toggling in one pane does not toggle the other pane.

## Out Of Scope

- Persisting edit/view mode in poll metadata or document format.
- Changing poll vote semantics.
- Changing answer poll display metadata (`inline` / `list`).
- Adding the toggle to rating or long-answer polls.
- Reworking matrix poll child schema or extra-child handling beyond hiding all children in view mode.
