# Plan: In-Document Poll Blocks

## Decisions From Research

- Poll votes are persisted in document/history data.
- Votes live in block metadata, but block metadata application needs custom merge support.
- The CRDT core should keep last-writer-wins as the default block metadata behavior and allow clients to supply a merge function for specific block meta types.
- Vote undo restores the current user's previous vote if one exists, otherwise clears their vote.
- `allowChange` defaults to `true`.
- Child-answer poll option identity is the child block id.
- Deleted answer options remain visible as archived result rows when they have votes.
- Matrix polls use the first child as the row group and the second child as the column group; extra children are ignored.
- Matrix cells support both single-choice and multiple-choice.
- Long-answer responses are visible after the current user votes.
- Changing user id creates a different voter.
- User ids are always normalized to lowercase.

## Phase 1: Generalize Block Metadata Merge Semantics

Goal: make the CRDT core capable of custom block metadata merges while preserving existing behavior by default.

Tasks:

1. Add a block metadata merge hook to the CRDT apply configuration.
   - Extend `VirtualBlockParentConfig` or introduce a nearby apply config field with a signature like:

     ```ts
     mergeBlockMeta?: <M extends TimestampedBlockMeta>(args: {
         current: M;
         incoming: M;
     }) => M | null;
     ```

   - `null` or `undefined` should mean "use default LWW behavior."
   - The default should remain: ignore incoming meta when `incoming.ts <= current.ts`, otherwise replace the whole meta.

2. Update `applyBlockMeta` and `applyBlock`.
   - `applyBlockMeta` should call the merge hook when the target block exists.
   - `applyBlock` should also use the merge hook when a block insert arrives for a block that already exists with different metadata. This matters for replay/import or concurrent block creation/update paths.
   - Preserve cache rebuild behavior when virtual parent config is present.

3. Add focused CRDT tests.
   - Existing no-hook behavior stays LWW.
   - A custom merge hook can combine fields from current and incoming metadata.
   - Stale incoming metadata can still contribute mergeable fields when the hook says so.
   - Duplicate or no-op merge results do not corrupt cache/state.

4. Thread the merge config through callers.
   - Existing callers can omit the hook and should continue passing current configs.
   - `examples/block-rich-text` should centralize its config so `applyMany`, import/replay, and local command application use the same virtual parents plus poll merge semantics where needed.

## Phase 2: Poll Metadata Model

Goal: define durable metadata shapes for rating, child-answer, matrix, and long-answer polls.

Tasks:

1. Add poll types in `examples/block-rich-text/src/blockMeta.ts`.
   - Suggested shape:

     ```ts
     type PollChoiceMode = 'single' | 'multiple';

     type PollVote =
         | {type: 'single'; optionId: string; ts: HLC; deleted?: boolean}
         | {type: 'multiple'; optionIds: string[]; ts: HLC; deleted?: boolean}
         | {type: 'matrix'; answers: Record<string, string | string[]>; ts: HLC; deleted?: boolean}
         | {type: 'long'; text: string; ts: HLC; deleted?: boolean};

     type PollMeta = {
         type: 'poll';
         kind: 'rating' | 'children' | 'matrix' | 'long';
         allowChange: boolean;
         choiceMode?: PollChoiceMode;
         min?: number;
         max?: number;
         votes: Record<string, PollVote>;
         ts: HLC;
     };
     ```

   - Rating polls should default to `min: 1`, `max: 5`, `allowChange: true`, `votes: {}`.
   - Child polls use direct child block ids as option ids.
   - Matrix polls derive row ids from grandchildren of the first child and column ids from grandchildren of the second child.
   - Long-answer polls store one text response per user.

2. Add helpers.
   - `defaultRatingPollMeta(ts)`.
   - `sameTypeWithTs` support for poll metadata.
   - Type guards for poll meta and vote values.
   - Derived helpers for active votes, archived option ids, percentages, and current user response.

3. Implement poll metadata merge.
   - Add a block-rich-text merge function that only handles `current.type === 'poll' && incoming.type === 'poll'`.
   - Merge poll configuration fields by outer `ts`.
   - Merge `votes` by `userId`, choosing the vote with the newer inner vote `ts`.
   - Preserve votes from both sides even when one outer meta timestamp loses.
   - If one side converts the block away from poll and has newer outer `ts`, use the newer non-poll metadata and drop poll UI behavior.

## Phase 3: User Identity UI

Goal: each editor pane has a normalized user id available to poll rendering and commands.

Tasks:

1. Add `userIds` state in `EditorApp`.
   - Defaults: display/input values can start as `Ulrich` and `Uwe`.
   - Stored normalized values should be `ulrich` and `uwe`.

2. Add a text input above each editor pane.
   - Label it as user id or voter id.
   - Normalize on change with `trim().toLowerCase()`.
   - Treat an empty normalized value as invalid for voting. The editor can still edit text, but poll controls should be disabled until a non-empty id is provided.

3. Pass `userId` into `BlockEditor`, render context, and poll command callbacks.

4. Add tests for normalization.
   - `Ulrich`, `ulrich`, and `ULRICH` all vote as `ulrich`.
   - Changing the input after voting creates a separate voter.

## Phase 4: Rating Poll First Slice

Goal: ship the simplest poll end to end before child/matrix/long variants.

Tasks:

1. Add a block type menu entry.
   - Add `poll-rating` to `BlockTypeMenuValue`.
   - Add toolbar/select display text for rating poll.
   - Add `blockTypeMeta` and `blockTypeMenuValue` support.

2. Render rating poll blocks.
   - The editable block text is the poll question.
   - Render 1-5 voting controls below the question.
   - If the current user has not voted, hide results and enable voting.
   - If the current user has voted, show percentages.
   - If `allowChange` is false, disable vote changes after voting.
   - If user id is empty, disable voting.

3. Add the vote command.
   - Update only the current user's vote entry.
   - Use a fresh HLC for the inner vote `ts` and the outer meta `ts`.
   - Preserve existing votes locally.
   - Return command info suitable for history/undo.

4. Add vote undo support.
   - Track enough command metadata to know the previous vote for that user.
   - Undo restores previous vote if present, otherwise writes a newer deleted/tombstone vote.
   - Redo restores the voted value.

5. Add tests.
   - A new rating poll can be created from the toolbar.
   - An unvoted user sees controls but not results.
   - A voted user sees results.
   - `allowChange: true` permits changing vote by default.
   - `allowChange: false` blocks subsequent vote changes.
   - Offline concurrent votes from different users merge and both appear after reconnect.
   - Undo and redo affect only the current user's vote.

## Phase 5: Persistence, Import, Export, and Fixtures

Goal: poll blocks and votes survive document export/import, history export/import, replay, and fixtures.

Tasks:

1. Update `documentFormat.ts`.
   - Add `poll` to document block types.
   - Parse poll meta and nested vote data.
   - Export poll meta and votes.
   - Ensure child-answer and matrix block structures export as normal children.

2. Update `history.ts`.
   - Validate poll metadata and vote shapes in `isRichBlockMeta`.
   - Keep exported history compatible with the current app id/version expectations.

3. Add fixtures.
   - Rating poll with no votes.
   - Rating poll with votes from `ulrich` and `uwe`.
   - Rating poll with `allowChange: false`.
   - Later, child-answer, matrix, and long-answer fixtures.

4. Add tests.
   - Document import/export round trips poll metadata and votes.
   - History export/import accepts poll metadata.
   - Replayed history preserves merged votes.

## Phase 6: Child-Answer Polls

Goal: support poll questions whose direct child blocks are answer options.

Tasks:

1. Add a `poll-children` block type/menu entry.
   - Metadata: `kind: 'children'`, `choiceMode: 'single' | 'multiple'`, `allowChange: true`, `votes: {}`.
   - Start with single-choice UI, then add multiple-choice if small.

2. Render child option controls.
   - Direct visible child blocks are active options.
   - Option id is the child block id.
   - Use the child block's rich text as the label.
   - Preserve normal editing/reordering for child blocks.

3. Archived deleted options.
   - When a vote references a child block that is no longer visible, show an archived result row if it has votes.
   - Label can use the last known exported text if available later; otherwise a neutral deleted-option label is acceptable for the first slice.

4. Tests.
   - Vote for a child answer.
   - Reorder children without changing vote identity.
   - Delete an answer with votes and keep an archived result row.
   - Single-choice and multiple-choice responses merge by user id.

## Phase 7: Matrix Polls

Goal: support matrix questions using first child for rows and second child for columns.

Tasks:

1. Add a `poll-matrix` block type/menu entry.
   - Metadata: `kind: 'matrix'`, `choiceMode: 'single' | 'multiple'`, `allowChange: true`, `votes: {}`.

2. Derive matrix structure.
   - First child under the poll block is the row group.
   - Second child under the poll block is the column group.
   - Grandchildren of the row group are row ids/labels.
   - Grandchildren of the column group are column ids/labels.
   - Ignore extra direct children.

3. Render matrix voting UI.
   - For single-choice, each row selects one column.
   - For multiple-choice, each row can select multiple columns.
   - A user's response is complete or partial; define whether partial submit is allowed before coding.

4. Results.
   - Show percentages per row/column after the current user votes.
   - Preserve archived rows/columns that still have votes.

5. Tests.
   - Structure derivation from first/second child.
   - Extra children ignored.
   - Single-choice and multiple-choice matrix voting.
   - Deleted row/column with votes remains visible in results.
   - Concurrent matrix votes merge by user id.

## Phase 8: Long-Answer Polls

Goal: support one text response per user, visible after voting.

Tasks:

1. Add a `poll-long` block type/menu entry.
   - Metadata: `kind: 'long'`, `allowChange: true`, `votes: {}`.

2. Render response UI.
   - Before voting, show a text input/textarea for the current user's response.
   - After voting, show all non-deleted long-answer responses.
   - If `allowChange` is true, allow editing/resubmitting the current user's response.

3. Decide text editing model.
   - Simple first pass: textarea content stored in the vote value as plain text.
   - Rich-text responses would need a separate block-based structure and should be a later task.

4. Tests.
   - Submit long answer.
   - Results hidden before current user submits.
   - Results visible after current user submits.
   - Concurrent long-answer responses merge.
   - Undo restores previous answer or clears it.

## Phase 9: Polish and Regression Sweep

Goal: make polls feel integrated with the existing editor.

Tasks:

1. Styling.
   - Keep controls compact and editor-like.
   - Avoid interfering with block selection, drag handles, inline controls, tables, and annotation UI.

2. Accessibility.
   - Use radio groups for single-choice controls.
   - Use checkboxes for multiple-choice controls.
   - Label result percentages clearly.
   - Ensure disabled states explain invalid empty user id or blocked revote.

3. Selection and editing behavior.
   - Poll controls should be `contentEditable={false}` where needed.
   - Clicking poll controls should not move text selection unexpectedly.
   - Dragging the poll block should still work from normal block affordances.

4. Run the focused test suite.
   - CRDT merge tests.
   - `examples/block-rich-text` document/history tests.
   - App interaction tests around polls.
   - Existing block command tests touched by metadata changes.

5. Manual verification.
   - Start the example app.
   - Create a rating poll.
   - Vote as `ulrich`, change user id, vote as a new user, and verify distinct voters.
   - Take one editor offline, vote in both panes, reconnect, and verify merged totals.
   - Export/import history and verify votes remain.
