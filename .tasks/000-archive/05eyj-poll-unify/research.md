# Research: Poll Edit/View Toggle

## Goal

In `examples/block-rich-text`, answer polls (`meta.type === 'poll'`, `kind === 'children'`) and matrix polls (`kind === 'matrix'`) currently show their child blocks twice:

- as editable child blocks in the document tree
- as the rendered poll UI derived from those same child blocks

Add an `edit/view` mode toggle that is UI-only state. In view mode, hide the child blocks and show the poll. In edit mode, show the child blocks and hide the rendered poll.

## Current State

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/pollBlocks.ts`

Poll metadata is document state:

```ts
export type PollMeta = {
    type: 'poll';
    kind: PollKind;
    allowChange: boolean;
    choiceMode?: PollChoiceMode;
    displayMode?: PollDisplayMode;
    ratingPresentation?: PollRatingPresentation;
    max?: number;
    votes: Record<string, PollVote>;
    ts: HLC;
};
```

The requested edit/view mode should not be added here. Existing persisted metadata already covers poll semantics such as choice mode, display mode, vote changes, rating style, and votes. The new mode is presentation state for the editor UI.

The duplicate display is created in `renderBlockNode`:

```tsx
return (
    <div key={node.block.id} className="renderTreeBranch">
        {renderEditableBlock(node.block, context, {
            pollOptions:
                meta.type === 'poll' && meta.kind === 'children'
                    ? node.children.map((child) => ({
                          id: child.block.id,
                          label: blockPlainText(child.block) || 'Untitled option',
                      }))
                    : undefined,
            matrixPoll:
                meta.type === 'poll' && meta.kind === 'matrix'
                    ? matrixPollViewForNode(node)
                    : undefined,
        })}
        {node.children.map((child) => renderBlockNode(child, context))}
    </div>
);
```

For answer polls, `node.children` become `childOptions` for `PollBlock`, then the same child nodes render immediately afterward.

For matrix polls, `matrixPollViewForNode(node)` treats `node.children[0]` as a row group and `node.children[1]` as a column group. Those row/column group blocks and their descendants still render under the matrix poll. Extra children are ignored by the matrix renderer but still appear in the tree.

`PollBlock` currently always renders the question plus the poll controls for `children` and `matrix` polls:

- answer polls render `question` and `.pollControls` with `.pollOptions`
- matrix polls render `question` and `.pollControls.matrixPollControls` with `.matrixPollGrid`

Rating and long-answer polls do not use child blocks as their editable option model, so the task appears scoped away from them.

## Existing UI State Placement

`EditorPane` already owns local React UI state such as focus, drag state, popovers, slash menu, pending inline marks, and table cell drag state. It builds `renderTree` with:

```ts
const renderTree = useMemo(() => buildRenderTree(blocks), [blocks]);
```

and passes a `RenderBlockContext` into `renderBlockNode`.

That makes `EditorPane` the natural place for poll edit/view mode state. A likely shape is:

```ts
type PollEditorMode = 'view' | 'edit';
const [pollModesByBlockId, setPollModesByBlockId] = useState<Record<string, PollEditorMode>>({});
```

Use a default mode for missing block ids rather than mutating state when blocks appear. Because block ids are stable across CRDT changes, per-block UI state should survive local/remote edits while the editor pane is mounted.

## Implementation Shape

1. Add UI-only mode state to `EditorPane`.

   Recommended default: `view`, because it removes the duplicate display immediately for loaded poll fixtures and treats the rendered poll as the normal user-facing representation.

2. Extend `RenderBlockContext` with mode accessors:

   ```ts
   pollModeForBlock(blockId: string): PollEditorMode;
   setPollModeForBlock(blockId: string, mode: PollEditorMode): void;
   ```

   This keeps the tree rendering helpers pure-ish and avoids putting React hooks into non-component helper functions.

3. In `renderBlockNode`, detect child-backed poll blocks:

   ```ts
   const isChildBackedPoll =
       meta.type === 'poll' && (meta.kind === 'children' || meta.kind === 'matrix');
   const pollMode = isChildBackedPoll ? context.pollModeForBlock(node.block.id) : 'view';
   ```

4. Pass the mode and toggle handler into `renderEditableBlock` / `EditableBlock` / `PollBlock` for child-backed polls.

   The control should be `contentEditable={false}` like other poll controls and block options controls, otherwise it can interfere with rich-text selection handling.

5. Render behavior:

   - View mode: show `PollBlock` controls and hide `node.children`.
   - Edit mode: hide rendered poll controls and show `node.children`.
   - The poll question should stay editable in both modes unless product direction says otherwise. It is the parent block's text and is not the duplicate content.

   A small implementation option is to keep `PollBlock` responsible for rendering the question and add an `interactionMode` prop:

   ```tsx
   <PollBlock
       ...
       editorMode={pollMode}
       onSetEditorMode={(mode) => context.setPollModeForBlock(block.id, mode)}
   />
   ```

   Then `PollBlock`, `MatrixPollBlock`, and the answer-poll branch can omit controls in edit mode while still rendering `{question}` and the toggle.

   In `renderBlockNode`, gate the recursive child render:

   ```tsx
   {(!isChildBackedPoll || pollMode === 'edit')
       ? node.children.map((child) => renderBlockNode(child, context))
       : null}
   ```

6. Tests should cover:

   - Answer poll fixtures initially show poll option buttons but not their child editable rows in view mode.
   - Toggling an answer poll to edit mode hides `.pollOptions` and reveals the option child blocks.
   - Matrix poll fixtures initially show `.matrixPollGrid` but not the row/column setup subtree in view mode.
   - Toggling a matrix poll to edit mode hides `.matrixPollGrid` and reveals row/column child blocks.
   - The toggle is UI-only: no ops/history entry/document metadata change should be produced just by switching modes. If there is an easy test seam, assert the right replica does not mirror the left pane's mode switch.

## Styling Notes

Existing poll CSS is centered around:

- `.pollBlock`
- `.pollControls`
- `.pollOptions`
- `.matrixPollControls`
- `.matrixPollGrid`

The toggle can use a compact segmented control inside the poll block, likely near the question and before the rendered poll controls. Keep it visually distinct from persisted `BlockOptions`, because `BlockOptions` currently edits document metadata and syncs across replicas.

Potential class names:

- `.pollEditorMode`
- `.pollEditorModeButton`
- `.pollEditorModeButton.selected`

Avoid putting the toggle only in `BlockOptions`; that menu is currently a metadata editor and would make a UI-only control easy to confuse with persisted poll settings.

## Risk Areas

- Selection/caret state: hiding child blocks while the selection is inside a child may leave the active selection pointing at a non-rendered block. The simplest mitigation is to move the caret to the poll parent when switching from edit to view if the primary selection is inside the hidden subtree.
- Drag/drop affordances: view mode hides child rows, so row/column/option reordering is unavailable until edit mode. That matches the requested split, but tests should verify normal block dragging still works around the poll parent.
- Matrix extra children: the fixture includes an `Ignored extra child` under a matrix poll. In view mode it will be hidden with the rest of the matrix child subtree. In edit mode it will become visible again. That is consistent with "child blocks are hidden/shown", but it means view mode hides content that is not part of the matrix renderer.
- Archived options: archived answer/matrix choices are derived from votes, not current children. They should continue to render in view mode through `childPollOptions` and `matrixPollWithArchivedOptions`.
- Per-pane UI state: the app has left and right replicas. If the mode state lives inside each `EditorPane`, toggling left will not toggle right. That is probably correct for UI-only editor state, but it should be explicit.
- Default mode and discoverability: if default is view, users need an obvious way to enter edit mode to manage options/rows/columns. If default is edit, duplicate display remains until users switch.

## Open Questions

1. Should the edit/view mode be per poll block, per editor pane globally, or both? Recommendation: per poll block per editor pane, defaulting to view.
    - per block, default to view
2. Should the mode default be `view` for all child-backed polls? Recommendation: yes, because the task is motivated by duplicate display.
    - yes
3. When switching from edit to view with the caret inside a child block, should the caret move to the parent poll question, or should selection state remain retained but hidden? Recommendation: move the visible caret to the parent to avoid invisible active selection.
    - move to parent
4. Should matrix poll "extra children" remain visible in view mode? Recommendation: no; hide all child blocks in view mode to match the requested behavior, but be aware this hides content not represented in the matrix UI.
    - no, hide all
5. Should the toggle live inline in the poll block or in the existing block options menu? Recommendation: inline in the poll block, because the block options menu currently changes persisted metadata.
    - inline
6. Should rating and long-answer polls get the toggle too for consistency? Recommendation: no for this task, because they do not duplicate child block configuration in the same way.
    - no
