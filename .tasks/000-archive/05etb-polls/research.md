# Research: In-Document Poll Blocks

## Goal

Explore how `examples/block-rich-text` can support poll-like blocks inside the document.

Requested shape:

- A poll block whose rich-text content is the question, with rendered voting controls below it.
- A simple 1-5 rating poll where users vote once, then see percentages.
- Optional metadata to allow users to change their vote.
- A child-answer poll where child blocks are answer options.
- A matrix poll where the poll block has two children: one grouping row names and one grouping column headers; grandchildren become rows/columns.
- Long-answer polls as a possible later variant.
- Add a per-editor user id input above each pane. Defaults: `Ulrich` on the left and `Uwe` on the right. In this example, username and user id can be the same and should be normalized to lowercase.

## Current Architecture

The example stores all block-specific behavior in `RichBlockMeta` in `examples/block-rich-text/src/blockMeta.ts`.

Current metadata types include paragraphs, headings, list items, todos, code blocks, callouts, tables, kanban, images, and previews. Every meta value carries a single `ts` field. `block:meta` ops replace the whole metadata value when the incoming `meta.ts` is newer than the current one.

Important files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockEditorTypes.ts`
- `examples/block-rich-text/src/blockTypeHelpers.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/history.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/types.ts`

The rendering model already supports special block UIs:

- `todo` renders a checkbox affordance and stores `checked` in block metadata.
- `preview`, `image`, and previewable `code` wrap the editable block content in custom UI.
- `table` and `kanban` use the normal block hierarchy as structured content, not a separate nested data model.

That pattern is a good fit for poll question text and answer labels. The question can remain the poll block's editable rich text. Child-answer and matrix poll labels can remain normal child/grandchild blocks.

## Key Constraint: Votes Are Not Safe as Naive Whole-Block Metadata

`setBlockMetaOps` emits a whole-value `block:meta` op:

```ts
{type: 'block:meta', id: block, meta}
```

`applyBlockMeta` in `src/block-crdt/apply.ts` ignores the op unless `op.meta.ts > current.meta.ts`, then replaces `current.meta` with `op.meta`.

This means a simple shape like this is vulnerable to lost concurrent votes:

```ts
{
    type: 'poll',
    ts,
    votes: {
        ulrich: {optionId: '5', ts},
        uwe: {optionId: '4', ts},
    },
}
```

Failure case:

1. Left and right start with an empty poll.
2. Ulrich votes while offline, producing meta with `{ulrich: ...}`.
3. Uwe votes while offline, producing meta with `{uwe: ...}`.
4. When replicas reconnect, whichever `meta.ts` wins replaces the whole `votes` object.
5. One user's vote disappears.

So the main implementation decision is how to represent responses with merge semantics.

## Representation Options

### Option A: Store Votes in Poll Metadata, With Explicit Merge on Remote Apply

Add poll metadata with per-field timestamps:

```ts
export type PollVoteValue =
    | {type: 'single'; optionId: string; ts: HLC}
    | {type: 'multiple'; optionIds: string[]; ts: HLC}
    | {type: 'matrix'; answers: Record<string, string | string[]>; ts: HLC}
    | {type: 'long'; text: string; ts: HLC};

export type PollVotes = Record<string, PollVoteValue>;
```

Then add an app-layer helper for remote poll meta ops before calling `applyMany`. When a remote `block:meta` op targets the same poll block, merge vote records by user id using each vote's inner `ts`, while still allowing normal poll configuration fields to follow block-level `meta.ts`.

Pros:

- Smallest change to the CRDT core.
- Easy to inspect in exported history.
- Works naturally with the existing per-block UI model.

Cons:

- Special-cases one metadata type outside the CRDT core's normal last-writer-wins behavior.
- Undo/redo semantics need care. Undoing a vote should produce a newer per-user vote tombstone or replacement, not restore an older whole metadata object that drops other users' votes.
- History import validation must understand the nested vote shape.

### Option B: Add a New CRDT Operation for Poll Responses

Extend `Op` with something like:

```ts
{
    type: 'poll:vote',
    poll: Lamport,
    userId: string,
    response: JsonValue | null,
    ts: HLC
}
```

Store poll votes in a separate state map keyed by poll block id and user id. Apply per-user last-writer-wins semantics.

Pros:

- Correct merge semantics are explicit.
- Avoids overloading block metadata with high-churn response data.
- Cleaner long-term if polls become a core example of custom CRDT data.

Cons:

- Wider change: `types.ts`, `apply.ts`, history parsing, undo, export/import, tests, maybe cache/initial state.
- More than this example may want right now.

### Option C: Store Votes as Hidden/Virtual Child Blocks

Represent each vote as a child block or mark whose id encodes/contains the user response.

Pros:

- Reuses existing block or mark CRDT mechanics.
- Concurrent votes from different users do not overwrite each other.

Cons:

- Awkward to hide from normal editing, dragging, selection, export, and clipboard behavior.
- User ids and responses do not naturally map to text blocks.
- Likely more invasive in rendering and traversal than it first appears.

## Recommended First Slice

Implement a simple rating poll as an example feature, but choose the response merge model deliberately before coding.

Suggested metadata shape for the first slice:

```ts
type PollKind = 'rating';

type PollVote = {
    optionId: string;
    ts: HLC;
    deleted?: boolean;
};

type RatingPollMeta = {
    type: 'poll';
    kind: 'rating';
    min: 1;
    max: 5;
    allowChange: boolean;
    votes: Record<string, PollVote>;
    ts: HLC;
};
```

For the UI:

- The poll block's editable text is the question.
- Render buttons/radio controls for 1 through 5 under the editable question.
- The current editor's normalized user id decides whether the user can vote.
- If the user has not voted, hide results and enable voting controls.
- If the user has voted, disable voting unless `allowChange` is true and show percentages.
- Percentages should be derived from non-deleted votes in the current replica state.

For user ids:

- Add user id state at the `EditorApp` level, keyed by `EditorId`.
- Pass `userId` into each `BlockEditor`.
- Render a text input above each editor pane, near the online/offline controls or pane header.
- Defaults can display as `Ulrich` / `Uwe`, but stored value should be normalized with `trim().toLowerCase()`.
- Empty input needs a fallback or validation. A practical fallback is to keep the last non-empty normalized id and show the raw input separately, but the simpler first pass can coerce empty to the editor id (`left`/`right`) or block voting until non-empty.

## Files Likely To Change

Core example types:

- `blockMeta.ts`: add poll metadata types, update `sameTypeWithTs`.
- `blockEditorTypes.ts`: add block type menu values such as `poll-rating` if polls should be insertable from the toolbar.
- `blockTypeHelpers.ts`: map the menu value to poll metadata and back.

Commands:

- `blockCommands.ts`: add a poll vote command/helper. If metadata remains whole-block, this is where local vote updates can preserve the existing votes object and add a new per-user vote.
- `multiSelectionCommands.ts`: likely only if polls are exposed through generic block type conversion or multi-selection block type commands.

Rendering:

- `EditorApp.tsx`: pass user id through `BlockEditor` and `RenderBlockContext`; render `PollBlock` or a poll-specific branch around `editableSurface`.
- `style.css`: add compact poll controls/results styling.
- `Toolbar.tsx`: add a poll type option if desired.

Persistence and fixtures:

- `documentFormat.ts`: add `poll` to import/export block types, parse poll meta, and export poll meta.
- `history.ts`: update `isRichBlockMeta` so history import accepts poll metadata.
- `documentFixtures.ts`: add a poll fixture that covers unvoted, voted, and perhaps allow-change states.

Tests:

- `documentFormat.test.ts`: poll import/export.
- `history.test.ts`: poll metadata in history import/replay.
- `App.test.tsx`: voting behavior, result visibility, user id normalization, offline concurrent votes.
- Possibly `blockCommands.test.ts`: pure vote command merge behavior.

## Open Questions

1. Should poll responses be example-only metadata, or should the CRDT core learn a first-class response/vote operation?

- the CRDT core should learn about custom merge semantics for block metadata. the default is LWW, but the client can supply a custom merge function to operate on a specific type of block

2. If we keep votes in metadata, is it acceptable to add poll-specific merge behavior in `blockEditorRuntime.applyRemoteOps`, or should metadata stay pure last-writer-wins everywhere?

- see #1

3. What should undo mean for a vote?
   - Remove the current user's vote?
   - Restore their previous vote?
   - Never include votes in editor undo history?

- restore previous vote if it exists, otherwise clear it

4. Should users be allowed to change their vote by default, or should `allowChange` default to `false` as described?

- yeah let's have allowChange true by default

5. For single-choice child-answer polls, should option identity be the child block id? That is the most CRDT-friendly choice, but it means deleting/recreating an answer creates a distinct option even if the text is the same.

- yeah, block id

6. If an answer child block is deleted after receiving votes, should results hide that option, keep it as an archived result row, or reassign those votes to an "deleted option" bucket?

- keep it as an archived result row

7. For matrix polls, how strict should the structure be?
   - Exactly two children under the poll block, first for rows and second for columns.
   - Or metadata fields pointing to the row-group and column-group block ids.

- first child, second child. if there are more children they are ignored

8. Should matrix cells support single choice only, multiple choice, or both?

- both

9. For long-answer polls, are responses visible after voting, visible to everyone immediately, or only aggregated/exported?

- visible after voting

10. Should poll votes be included in document export/import, or are they session/runtime state for the demo?

- yes, definitely persisted

11. How should user id changes behave after a vote?
    - Treat the new user id as a different voter.
    - Migrate the vote from old id to new id.
    - Prevent changing user id while that editor has voted.

- new user id is a different voter

12. Are usernames case-insensitive forever? The task says enforce lowercase for simplicity, so `Ulrich`, `ulrich`, and `ULRICH` should all map to `ulrich`.

- yes lowercase

## Suggested Implementation Order

1. Add user id inputs and plumb normalized `userId` into block rendering.
2. Add `poll` metadata and document/history validation support without voting yet.
3. Render a rating poll block using derived vote totals.
4. Add a local vote command.
5. Decide and implement the merge strategy for concurrent offline votes.
6. Add tests for user id normalization, vote visibility, blocked revote, allow-change, export/import, and concurrent offline votes.
7. Add child-answer polls after the response storage model is proven.
8. Add matrix and long-answer variants as separate slices.
