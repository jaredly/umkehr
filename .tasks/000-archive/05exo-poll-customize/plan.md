# Plan: Poll Block Config Menus

## Decisions From Research

- Switching a poll from multiple-choice back to single-choice should normalize existing votes.
- Answer poll `displayMode` should follow existing export precedent: preserve/export optional metadata when present, default it on import where appropriate.
- Rating polls should also get menu controls for:
  - `allowChange`
  - numeric range
  - numbers vs stars presentation
- Long-answer polls should expose `allowChange`.
- The generalized three-dots menu should also replace the current inline callout and image controls.

## Phase 1: Metadata And Format Support

Update `examples/block-rich-text/src/blockMeta.ts`.

- Add `PollDisplayMode = 'inline' | 'list'`.
- Add `PollRatingPresentation = 'numbers' | 'stars'`.
- Extend `PollMeta` with:
  - `displayMode?: PollDisplayMode`
  - `ratingPresentation?: PollRatingPresentation`
- Keep `undefined` backward-compatible:
  - answer poll display defaults to inline
  - rating presentation defaults to numbers

Update `examples/block-rich-text/src/pollBlocks.ts`.

- Extend `isPollMeta` validation:
  - `displayMode` must be `inline` or `list` when present
  - `ratingPresentation` must be `numbers` or `stars` when present
- Add helper functions for vote normalization when changing choice mode:
  - answer poll multiple-to-single: convert each active `multiple` vote to a `single` vote using the first selected option, or delete/clear the vote if empty
  - matrix multiple-to-single: convert each row answer array to the first selected column, omitting rows with no selected columns
  - preserve vote timestamps or stamp normalized votes with the config-change timestamp; prefer stamping changed vote records with the config-change timestamp so undo/merge order is clear
- Add focused tests for these helpers.

Update `examples/block-rich-text/src/documentFormat.ts`.

- Import/export `displayMode` and `ratingPresentation`.
- Validate imported values with clear `DocumentFormatError` messages.
- Preserve optional values in `documentBlockForMeta` when present.

Update clipboard/history validators if needed.

- `clipboard.ts` already delegates poll meta validation through `isPollMeta`, so this should mostly come for free.
- `history.ts` may only need type coverage if it serializes `PollMeta` through `isPollMeta`.

## Phase 2: Generalize Block Options Menu Infrastructure

Update `examples/block-rich-text/src/EditorApp.tsx`.

- Rename `BlockInlineControls` to a more general name, such as `BlockOptions`.
- Keep rendering it as a sibling after the block body inside `BlockInput`.
- Replace code-specific wrapper classes with shared classes:
  - `.blockOptions`
  - `.blockOptionsButton`
  - `.blockOptionsMenu`
- Keep specific input classes where useful:
  - `.codeLanguage`
  - `.blockOptionsSelect`
  - `.blockOptionsNumber`
  - `.blockOptionsToggle`
- Preserve event suppression:
  - `onPointerDown={stopEditorControlEvent}`
  - `onMouseDown={stopEditorControlEvent}`
  - `onMouseUp={stopEditorControlEvent}`
  - `onClick={stopEditorControlEvent}`
- Keep the code block menu behavior equivalent:
  - language field
  - preview toggle for previewable languages

Update `examples/block-rich-text/src/style.css`.

- Move existing `.codeControls*` styles to `.blockOptions*`.
- Keep compatibility aliases during the refactor if it reduces risk.
- Style shared menu rows/labels/selects/number inputs/toggles.
- Ensure the menu remains top-right, visible on hover/focus/open, and above poll controls.

## Phase 3: Move Existing Non-Code Controls Into The Menu

Update `BlockOptions` for existing block controls.

- Callout blocks:
  - Move the current callout kind `select` into the menu.
  - Keep the same `onSetCalloutKind` callback and metadata update.
- Image blocks:
  - Move the current image size `select` into the menu.
  - Keep the same `onSetImageSize` callback and metadata update.
- Remove old top-level `.calloutKind` and `.imageSizeControl` placement assumptions from CSS.
- Preserve behavior in table cells and nested blocks.

Verification for this phase:

- Callout kind still updates.
- Image size still updates.
- Code menu still works.
- No old inline selects remain outside the menu for callout/image.

## Phase 4: Add Poll Config Callbacks And Menus

Update `BlockInput` props and call sites in `EditorApp.tsx`.

- Add callbacks:
  - `onSetPollChoiceMode(mode: PollChoiceMode): void`
  - `onSetPollDisplayMode(mode: PollDisplayMode): void`
  - `onSetPollAllowChange(allowChange: boolean): void`
  - `onSetRatingPollRange(min: number, max: number): void`
  - `onSetRatingPollPresentation(presentation: PollRatingPresentation): void`
- Wire each callback with `context.runBlockControlCommand`.
- Use `setBlockMeta` and `nextReplicaTs(current)`.
- Guard against stale/non-poll blocks.
- Preserve existing votes unless the choice-mode change requires normalization.

Add poll menu contents in `BlockOptions`.

- Rating polls:
  - `Allow vote changes` toggle
  - min number input
  - max number input
  - presentation select: `Numbers` / `Stars`
- Answer polls:
  - display select: `Inline` / `List`
  - choice mode select: `Select one` / `Select all`
  - `Allow vote changes` toggle
- Matrix polls:
  - choice mode select: `Select one` / `Select all`
  - `Allow vote changes` toggle
- Long-answer polls:
  - `Allow answer changes` toggle

Implementation notes:

- Clamp/sanitize rating min/max before storing:
  - integers only
  - keep a practical range, for example `0..10` or `1..10`
  - if min exceeds max, either swap or adjust the edited side; choose one behavior and cover it with a test
- When switching choice mode from `multiple` to `single`, normalize existing votes in the same metadata update.
- When switching from `single` to `multiple`, existing single votes can remain as-is because result/render helpers already handle mixed historical vote shapes.

## Phase 5: Poll Rendering Updates

Update `PollBlock` in `EditorApp.tsx`.

- For answer polls, derive:
  - `const displayMode = meta.displayMode ?? 'inline'`
  - add `pollOptions-${displayMode}` to the options container
- Preserve current inline behavior as the default.
- For list mode:
  - stack options vertically
  - make option buttons full-width within a readable max width
  - keep result text aligned cleanly

Update rating poll rendering.

- For `ratingPresentation === 'stars'`, show star labels for each rating option while keeping the underlying `optionId` as the numeric string.
- Keep result calculations unchanged.
- Ensure accessible button text remains meaningful. If the visible label is stars, include an `aria-label` such as `3 stars`.

CSS updates.

- Replace base `.pollOptions` layout with mode-specific classes:
  - `.pollOptions-inline`
  - `.pollOptions-list`
- Add styling for star rating labels if needed.
- Confirm matrix layout is unaffected.

## Phase 6: Tests

Unit tests.

- `pollBlocks.test.ts`
  - `isPollMeta` accepts valid `displayMode` and `ratingPresentation`.
  - `isPollMeta` rejects invalid `displayMode` and `ratingPresentation`.
  - choice-mode normalization converts answer poll multiple votes to single votes.
  - choice-mode normalization converts matrix row arrays to single row answers.
  - merge behavior keeps latest non-vote poll settings while merging per-user votes.

- `documentFormat.test.ts`
  - round-trip answer poll with `displayMode: 'list'`.
  - round-trip rating poll with `ratingPresentation: 'stars'`.
  - reject invalid imported poll display/presentation values.

UI tests in `App.test.tsx`.

- Code block options menu still opens and edits code language/preview.
- Callout options menu changes callout kind.
- Image options menu changes image size.
- Answer poll options menu:
  - changes display mode to list
  - changes choice mode to select all
  - allows selecting multiple answer options
- Matrix poll options menu:
  - changes choice mode to select all
  - allows multiple selections in the same row
- Rating poll options menu:
  - changes range
  - changes numbers/stars presentation
  - toggles `allowChange`
- Long-answer poll options menu toggles `allowChange`.

Manual checks.

- Menus open in the top-right of each supported block.
- Menu interactions do not move the caret or edit block text.
- Poll menus do not appear on unsupported block types.
- List-mode answer polls look correct at desktop and narrow widths.
- Existing fixtures still load.

## Phase 7: Verification Commands

Run focused tests first:

```sh
npm exec vitest -- run src/pollBlocks.test.ts src/documentFormat.test.ts
```

Run relevant UI tests:

```sh
npm exec vitest -- run src/App.test.tsx
```

If the full UI test file is too slow during iteration, run by test name pattern for the new block options tests, then run the full file before finalizing.

Optionally run the example locally for manual QA:

```sh
npm run dev
```

## Risks

- `details` menus inside editable/editor rows can accidentally affect selection if event suppression is incomplete.
- Normalizing existing votes on mode change can interact with undo/redo if not represented as one coherent metadata update.
- Rating min/max edits need clear constraints to avoid empty option ranges or huge UI.
- Moving callout/image controls into the menu changes existing UI affordances; tests should cover that these controls remain discoverable by accessible labels.

