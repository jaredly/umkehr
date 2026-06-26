# Research: Poll Block Config Menus

## Goal

Add reusable block-level config option menus in `examples/block-rich-text`, starting from the existing code block options menu and extending the same pattern to poll blocks.

Requested poll options:

- Answer polls (`kind: 'children'`) can switch display mode between inline options and list options.
- Answer polls can switch between select one and select all.
- Matrix polls (`kind: 'matrix'`) can switch between select one and select all.
- The customization UI should be a three-dots menu in the top-right of the block, matching the code block affordance.

## Current State

Relevant files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/pollBlocks.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/pollBlocks.test.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/style.css`

`BlockInlineControls` in `EditorApp.tsx` already implements a top-right `details` menu for code blocks:

- It is rendered as a sibling after the block body inside `BlockInput`.
- It uses `className="codeControls"` and an ellipsis summary button.
- It is absolutely positioned in the top-right of `.blockRow`.
- It stops editor pointer/mouse/click events with `stopEditorControlEvent`.
- It currently handles:
  - code language input
  - optional preview checkbox for previewable code languages

The same component also renders inline `select` controls for callout kind and image size, but those are not behind an ellipsis menu.

Poll metadata already supports the selection-mode part of the request:

```ts
export type PollChoiceMode = 'single' | 'multiple';

export type PollMeta = {
    type: 'poll';
    kind: PollKind;
    allowChange: boolean;
    choiceMode?: PollChoiceMode;
    min?: number;
    max?: number;
    votes: Record<string, PollVote>;
    ts: HLC;
};
```

Defaults are already set in `blockTypeHelpers.ts`:

- answer polls default to `choiceMode: 'single'`
- matrix polls default to `choiceMode: 'single'`

Poll voting logic already reads `choiceMode`:

- Answer polls use `multiple` votes only when `meta.kind === 'children' && meta.choiceMode === 'multiple'`.
- Matrix polls use `nextMatrixAnswers(..., currentBlock.meta.choiceMode === 'multiple')`.

Poll rendering already reads `choiceMode`:

- Answer polls set `multiple` from `meta.kind === 'children' && meta.choiceMode === 'multiple'`.
- Matrix polls set `multiple` from `meta.choiceMode === 'multiple'`.

Document import/export and clipboard validation already preserve `choiceMode`.

## Current Gap

There is no block options menu for polls.

Answer poll display mode is not represented in metadata. The current answer poll option layout is always inline/flex-wrap:

```css
.pollOptions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
```

So implementing the display mode needs a new field on `PollMeta`, document import/export support, validation, and render/CSS changes.

The existing code block options menu is named code-specifically (`codeControls`, `codeControlsButton`, `codeControlsMenu`) even though the behavior is general. Reusing infrastructure cleanly likely means renaming or adding shared classes while preserving the current code block behavior.

## Suggested Design

Add a poll display layout metadata field for answer polls:

```ts
export type PollDisplayMode = 'inline' | 'list';

export type PollMeta = {
    // existing fields...
    displayMode?: PollDisplayMode;
};
```

Use `undefined` as equivalent to `'inline'` for backward compatibility and smaller exports. Only answer polls need to expose this setting. It can be accepted on any poll meta for schema simplicity, but rendering should only use it for `kind: 'children'`.

Generalize `BlockInlineControls` into a reusable block options menu surface while keeping the component small:

- Rename CSS classes or add shared aliases:
  - `.blockOptions`
  - `.blockOptionsButton`
  - `.blockOptionsMenu`
- Keep code-specific inner classes where useful, such as `.codeLanguage`.
- Render the same `details` + `summary` pattern for code and poll blocks.

Extend `BlockInput` callbacks:

- Add `onSetPollChoiceMode(mode: PollChoiceMode): void`
- Add `onSetPollDisplayMode(mode: PollDisplayMode): void`

Wire them in the same place as code block metadata updates, using `context.runBlockControlCommand` and `setBlockMeta`:

- Read `currentBlock` by `block.id`.
- Guard that it is a poll of the expected kind.
- Preserve existing metadata and votes.
- Update `choiceMode` or `displayMode`.
- Set `ts: nextReplicaTs(current)`.

Add menu content:

- For answer polls:
  - `select` or segmented-style control for display: `Inline` / `List`
  - `select` or radio group for choices: `Select one` / `Select all`
- For matrix polls:
  - choice mode only: `Select one` / `Select all`

Implementation can start with native `select` controls, matching the existing callout/image control style and minimizing moving parts.

For answer poll layout, change `PollBlock` to add a class based on display mode:

```tsx
const displayMode = meta.kind === 'children' ? meta.displayMode ?? 'inline' : 'inline';
<div className={`pollOptions pollOptions-${displayMode}`} ...>
```

CSS:

```css
.pollOptions-inline {
    display: flex;
    flex-wrap: wrap;
}

.pollOptions-list {
    display: grid;
    gap: 8px;
    max-width: 420px;
}

.pollOptions-list .pollOption {
    justify-content: space-between;
    width: 100%;
}
```

## Data/Merge Considerations

`mergePollMeta` currently chooses the whole non-vote poll metadata from the newer poll `ts`, while merging votes per user timestamp:

```ts
const base = incoming.ts > current.ts ? incoming : current;
return {...base, votes: mergedVotes};
```

That means `choiceMode`, `displayMode`, `allowChange`, `min`, and `max` are last-writer-wins as a group. This is consistent with the existing `choiceMode` behavior. The new `displayMode` can use the same semantics.

Changing from multiple to single while existing votes contain multiple selections needs a product decision. The current code can render mixed historical votes because result helpers accept both `single` and `multiple` votes for answer polls, and matrix results accept both string and string-array answers. New votes after the mode change will use the current mode.

## Tests To Add/Update

Focused unit tests:

- `pollBlocks.test.ts`
  - validate `isPollMeta` accepts `displayMode: 'inline' | 'list'`
  - validate `isPollMeta` rejects unknown display modes
  - optionally verify `mergePollMeta` preserves the latest display mode via latest `ts`
- `documentFormat.test.ts`
  - round-trip a children poll with `displayMode: 'list'`

Render/behavior tests, likely in `App.test.tsx` if existing test setup supports it:

- Open the poll block options menu.
- Change answer poll choice mode from select one to select all.
- Vote multiple options and verify selected state/results.
- Change answer poll display mode to list and verify the list class or visible layout hook.
- Change matrix poll choice mode to select all and verify multiple cells in the same row can be selected.

Manual verification:

- Code block menu still appears in the top-right and language/preview still work.
- Poll menu appears top-right for answer and matrix polls.
- Poll menu does not appear for rating or long-answer polls unless intentionally supported.
- Menu clicks do not move the editor caret or trigger text editing.
- Mobile/narrow layout does not clip the opened menu badly.

## Open Questions

1. Should changing from `multiple` back to `single` normalize existing votes, or should historical multiple votes remain as-is and only future votes follow the new mode?
    - sure normalize
2. Should answer poll `displayMode` be exported only when it is non-default (`list`), or always exported when present? Existing metadata export tends to include optional fields when present, not when defaulted.
    - sure we can match the precedent
3. Should rating polls also eventually expose `allowChange`, range min/max, or display options through the same menu, or should this task intentionally limit menus to answer and matrix polls?
    - yeah they should expose those too (allowChange, range, and numbers vs stars)
4. Should long-answer polls expose `allowChange` through this menu later? The metadata already supports it, but the task does not request it.
    - yes please
5. Should the generalized menu replace callout and image inline selects now, or should this task only generalize the code menu enough to add poll menus without changing unrelated controls?
    - yes please
