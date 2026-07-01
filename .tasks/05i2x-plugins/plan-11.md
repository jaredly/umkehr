# Plan 11: Phase 11 Heavy Structural Plugins

## Context

Phases 1-10 moved most low- and medium-risk rich text features behind plugin declarations. The registry can now express metadata, commands, rendering ownership, option panels, CRDT hooks, clipboard hooks, and executable selection behavior. Phase 10 also moved `table-cells` selection behavior behind a transitional table selection adapter while leaving table rendering, commands, keyboard behavior, and drag/drop central.

Phase 11 is larger than the original `plan.md` entry implies. It covers four high-coupling structural systems:

- `polls`
- `columns`
- `slides`
- `table`

These should not be implemented as one broad rewrite. Each feature touches a different mix of metadata, CRDT hooks, rendering, editor-local UI state, command services, clipboard behavior, selection constraints, and drag/drop. This document breaks Phase 11 into subphases that can be implemented and verified independently.

## Goal

Move the remaining heavy structural features out of `legacyRichTextBlocksPlugin`, `legacyRichTextUiPlugin`, `legacyStructuralCrdtPlugin`, and editor-local ownership while preserving current behavior under `legacyRichTextPlugins`.

The result should be:

- `pollsPlugin` owns poll metadata, commands, rendering ownership, option panels, toolbar/slash entries, and poll metadata merge behavior.
- `columnsPlugin` owns columns metadata, commands, rendering ownership, option panels, toolbar/slash entries, and columns/card-columns movement ownership.
- `slidesPlugin` owns slide deck and slide metadata, commands, rendering ownership, option panels, toolbar/slash entries, presentation UI declarations, and selection constraints.
- `tablePlugin` owns table metadata, table virtual parents, table-cell selection integration, table rendering ownership, toolbar/slash entries, keyboard navigation, drag/drop ownership, row/column/cell commands, and table clipboard behavior.
- The legacy preset composes these plugins instead of relying on a structural legacy aggregate.
- Core keeps generic block tree, text editing, selection set, command application, history, and CRDT application primitives.

## Non-Goals

- Do not redesign `RichBlockMeta` into third-party extensible metadata in this phase.
- Do not require full generic React renderer execution for every structural feature if registry-gated central rendering is still the safer intermediate path.
- Do not move global editor layout, selection restoration, history, or replica synchronization into plugin APIs.
- Do not extract styles into plugin CSS files; that is Phase 12.
- Do not remove compatibility exports immediately if examples and tests still depend on them.
- Do not combine unrelated structural plugins in one implementation slice unless a shared helper forces it.

## Current Ownership To Untangle

Legacy plugin aggregates:

- `legacyRichTextBlocksPlugin` still declares:
  - `table`
  - `columns`
  - `slide_deck`
  - `slide`
  - `poll`
- `legacyRichTextUiPlugin` still owns toolbar/slash entries for:
  - `table`
  - `columns`
  - `card-columns`
  - `slide-deck`
  - `slide`
  - `poll-rating`
  - `poll-children`
  - `poll-matrix`
  - `poll-long`
- `legacyStructuralCrdtPlugin` still owns table virtual parents.
- `legacyPollsCrdtPlugin` still owns poll metadata merge behavior.

Metadata and block type helpers:

- `blockTypeHelpers.ts` maps remaining structural menu values to metadata or command placeholders.
- `blockMeta.ts` defines poll, columns, slide deck, slide, and table metadata types and validators/helpers.
- `legacyRichTextBlocks.ts` validates all remaining structural metadata in one switch.

Central editor rendering and options:

- `BlockRichTextEditor.tsx` centrally renders poll controls, columns/card layouts, slide decks/slides, and tables.
- `BlockOptions` centrally renders poll, columns, slide deck, and slide option panels.
- Poll voting, poll display/edit mode, slide presentation mode, fullscreen behavior, and table UI state are editor-local.

Commands:

- `blockCommands.ts` owns structural commands for converting/creating tables, columns, slide decks, slides, and table row/column/cell operations.
- `multiSelectionCommands.ts` owns multi-selection behavior and table rich paste behavior.
- Many structural command paths still use full-feature compatibility helpers such as annotation/table virtual parent configs.

Selection and clipboard:

- `tableSelectionPlugin` now owns `table-cells` selection behavior, but table rendering and commands still call compatibility table-selection helpers.
- `clipboard.ts` and `multiSelectionCommands.ts` still contain table-specific clipboard and paste behavior.
- `slidePresentationSelection.ts` centrally constrains selection during fullscreen presentation mode.

## Shared Foundation Work

### 1. Structural Plugin Declaration Helpers

Add small local helpers for structural plugins rather than repeating verbose declarations:

- block type specs with validators and `withTs`
- toolbar and slash block-type entries
- renderer ownership declarations
- option panel ownership declarations
- command id declarations

Keep these helpers internal to `src/block-editor/plugins` unless there is a clear public API need.

### 2. Command Boundary Policy

For this phase, prefer the established intermediate pattern:

- plugin owns command ids and feature availability
- existing editor-local command implementations remain where generic command context is not rich enough
- direct command call sites are gated by plugin command/block/renderer/option ownership

Only move command implementations into plugin modules when the command can run with the existing `BlockEditorCommandContext` without pulling in editor-local services.

### 3. Renderer Boundary Policy

Keep central rendering as the implementation when needed, but derive availability from registry declarations.

Each structural plugin should declare renderer ownership so:

- unsupported block types do not render specialized UI
- option panels and interaction controls are hidden when the plugin is absent
- Phase 14 cleanup can replace central switches with generic renderer execution if desired

### 4. Legacy Preset Migration

After each subphase:

- add the new plugin to `legacyRichTextPlugins`
- remove its metadata/UI/CRDT declarations from transitional legacy plugins
- preserve existing full-feature behavior in examples

Avoid leaving duplicate ownership in both a new plugin and a legacy aggregate.

## Subphase 11a: Polls Plugin

### Boundary

`pollsPlugin` owns:

- block type: `poll`
- poll metadata validation
- poll metadata merge hook for CRDT conflict resolution
- toolbar items:
  - `block-type:poll-rating`
  - `block-type:poll-children`
  - `block-type:poll-matrix`
  - `block-type:poll-long`
- slash commands for poll creation, if existing UX exposes them
- block renderer ownership for poll blocks
- option panel ownership for poll blocks
- command declarations for:
  - vote/answer poll
  - clear/delete vote where applicable
  - set choice mode
  - set display mode
  - set allow-change
  - set rating maximum
  - set rating presentation
- poll result helpers and validators, likely moved from `pollBlocks.ts`

Editor-owned for now:

- active user id source
- local poll editor mode UI state, unless a narrow plugin-local UI state hook already exists
- command application/history pipeline

### Slices

1. Add `pollsPlugin` declarations and move `poll` metadata out of `legacyRichTextBlocksPlugin`.
2. Move poll toolbar/slash entries out of `legacyRichTextUiPlugin`.
3. Move `legacyPollsCrdtPlugin` merge hook into `pollsPlugin`.
4. Gate poll rendering, voting controls, and poll option panel by registry ownership.
5. Move pure poll helpers/tests near the plugin where practical.

### Tests

- Poll metadata validates only when `pollsPlugin` is registered.
- Poll vote merges still choose the latest per-user vote.
- Rating, children, matrix, and long-answer polls render unchanged under the legacy preset.
- Poll vote, answer, allow-change, display mode, choice mode, max, and presentation changes behave unchanged.
- Poll controls are absent or inert when `pollsPlugin` is absent.

## Subphase 11b: Columns Plugin

### Boundary

`columnsPlugin` owns:

- block type: `columns`
- columns metadata validation
- toolbar items:
  - `block-type:columns`
  - `block-type:card-columns`
- slash commands for columns/card columns
- block renderer ownership for columns blocks
- option panel ownership for columns display mode
- command declarations for:
  - convert block to columns/cards
  - set columns display
  - move blocks into/out of columns where current command surfaces expose this
- columns/card-columns drop behavior ownership declarations, even if central drag/drop still performs the work

Editor-owned for now:

- generic block drag/drop state and geometry
- central drag transaction application
- global block affordances

### Slices

1. Add `columnsPlugin` declarations and move `columns` metadata out of `legacyRichTextBlocksPlugin`.
2. Move columns/card-columns toolbar and slash entries out of `legacyRichTextUiPlugin`.
3. Gate columns rendering/classes and columns option panel by plugin ownership.
4. Gate columns display changes and columns-specific move/drop paths by command/block renderer availability.
5. Document remaining central drag/drop paths for Phase 14 cleanup if they cannot move cleanly.

### Tests

- Columns and card columns metadata validate only when `columnsPlugin` is registered.
- Columns/card columns creation and conversion behave unchanged.
- Display mode option changes still replicate as metadata updates.
- Moving blocks into/out of columns behaves unchanged.
- Columns-specific rendering and option UI are absent when `columnsPlugin` is absent.

## Subphase 11c: Slides Plugin

### Boundary

`slidesPlugin` owns:

- block types:
  - `slide_deck`
  - `slide`
- slide deck and slide metadata validation
- toolbar items:
  - `block-type:slide-deck`
  - `block-type:slide`
- slash commands for slide deck and slide
- block renderer ownership for slide deck and slide blocks
- option panel ownership for slide deck and slide options
- command declarations for:
  - create/convert slide deck
  - add slide
  - set slide deck size
  - set slide deck footer
  - set slide title visibility
  - set slide transition
  - set presentation/overview modes if command-routed
- selection constraint ownership for fullscreen presentation mode
- presentation UI declarations for deck overview/presentation/fullscreen behavior, even if central rendering remains initially

Editor-owned for now:

- fullscreen browser API calls
- global keyboard focus and selection restoration
- global editor layout outside the deck component

### Slices

1. Add `slidesPlugin` declarations and move `slide_deck`/`slide` metadata out of `legacyRichTextBlocksPlugin`.
2. Move slide toolbar/slash entries out of `legacyRichTextUiPlugin`.
3. Gate slide deck/slide rendering and option panels by plugin ownership.
4. Move or wrap slide selection constraints so they are activated only when `slidesPlugin` is registered.
5. Gate presentation controls, fullscreen behavior, add-slide controls, and slide option commands by plugin ownership.
6. Preserve central slide rendering if generic renderer context cannot yet own UI state.

### Tests

- Slide deck and slide metadata validate only when `slidesPlugin` is registered.
- Slide deck creation, slide creation, add-slide, and conversion behavior remain unchanged.
- Overview/presentation/fullscreen modes remain unchanged.
- Fullscreen selection constraint still keeps selection inside the active slide.
- Slide deck size/footer and slide title/transition options still update metadata.
- Slide-specific UI is absent when `slidesPlugin` is absent.

## Subphase 11d: Table Plugin

### Boundary

`tablePlugin` owns:

- block type: `table`
- table metadata validation
- table virtual parent CRDT hook
- dependency or composition with `tableSelectionPlugin`
- toolbar item:
  - `block-type:table`
- slash command for table
- block renderer ownership for table blocks
- row/column/cell command declarations:
  - create/convert table
  - create missing cell
  - add row
  - add column
  - move row
  - move cell
  - move cell rectangle
  - delete selected cells/rows/columns
  - clear cells
  - split/delete row header
  - table keyboard navigation
- table drag/drop ownership declarations
- table clipboard behavior:
  - table-cell source selection type
  - TSV serialization
  - rich paste into cells
  - row/column paste behavior

Editor-owned for now:

- generic pointer tracking and block drag session state, unless table drag/drop can be cleanly encapsulated
- command application/history pipeline
- global DOM event routing

### Dependency Decision

Prefer:

- `tablePlugin.requires = ['table-selection']`

or merge the transitional selection plugin into `tablePlugin` only if that does not create churn. Since Phase 10 already introduced a dedicated transitional `table-selection` plugin, requiring it is the lower-risk path.

### Slices

1. Add `tablePlugin` declarations and move `table` metadata out of `legacyRichTextBlocksPlugin`.
2. Move table toolbar/slash entries out of `legacyRichTextUiPlugin`.
3. Move table virtual parent CRDT hook out of `legacyStructuralCrdtPlugin` and into `tablePlugin`.
4. Add `requires: ['table-selection']` and update `legacyRichTextPlugins` ordering.
5. Gate table rendering, add-row/add-column affordances, table block classes, and table option surfaces by plugin ownership.
6. Gate table keyboard navigation and deletion paths by table command availability.
7. Gate table drag/drop paths by table command/render ownership.
8. Move table clipboard/TSV helpers behind table plugin ownership or a narrow table clipboard adapter.
9. Document any central rendering/drag/drop command paths that remain for Phase 14 cleanup.

### Tests

- Table metadata validates only when `tablePlugin` is registered.
- `tablePlugin` without `tableSelectionPlugin` fails registry construction.
- Table virtual parents still materialize rows/cells as before.
- Table creation/conversion/add row/add column behavior remains unchanged.
- Table cell selection, deletion, clearing, movement, arrow navigation, tab navigation, and drag/drop remain unchanged.
- Table-cell copy includes fragments and TSV.
- Rich paste into selected cells/rows/columns remains unchanged.
- Table UI is absent or inert when `tablePlugin` is absent.

## Recommended Implementation Order

1. Polls.
2. Columns.
3. Slides.
4. Table.
5. Remove or shrink remaining transitional structural aggregates.

Rationale:

- Polls have a CRDT merge hook but minimal structural selection/drag behavior.
- Columns are structural but do not introduce a custom selection type.
- Slides add editor-local UI state and selection constraints, but less table-like grid editing.
- Table is the highest-risk extraction and should consume the Phase 10 selection adapter after other structural plugin patterns are proven.

## Shared Cleanup Slice

After subphases 11a-11d:

- Remove structural block types from `legacyRichTextBlocksPlugin`.
- Remove structural toolbar/slash entries from `legacyRichTextUiPlugin`.
- Remove `legacyStructuralCrdtPlugin` if table virtual parents are fully plugin-owned.
- Remove `legacyPollsCrdtPlugin` if poll merge is fully plugin-owned.
- Ensure `legacyRichTextPlugins` composes:
  - `pollsPlugin`
  - `columnsPlugin`
  - `slidesPlugin`
  - `tableSelectionPlugin`
  - `tablePlugin`
- Update implementation logs with any central compatibility wrappers left for Phase 14.

## Test Matrix

Registry and compatibility:

- Each structural plugin declares its block types.
- Duplicate structural block ownership fails.
- Missing structural plugins produce compatibility issues for persisted structural blocks.
- `legacyRichTextPlugins` accepts all existing rich fixture documents.
- Removing a structural plugin hides its toolbar/slash/option/rendering surfaces.

CRDT:

- Poll vote metadata merge remains stable under concurrent votes.
- Table virtual parents remain stable for table rows and cells.
- Structural metadata timestamp updates preserve existing fields.

Commands:

- Structural block creation/conversion works for all structural block types.
- Option panel commands update metadata correctly.
- Command paths no-op or are unavailable when the owning plugin is absent.

Rendering:

- Polls, columns/card columns, slide decks/slides, and tables render unchanged under the legacy preset.
- Unsupported structural blocks degrade or fail according to existing compatibility policy rather than rendering partial controls.

Clipboard:

- Structural block copy/paste remains unchanged.
- Table-cell copy/paste and TSV behavior remain unchanged.
- Unsupported structural block metadata is filtered/degraded consistently with existing clipboard policy.

Examples:

- Full rich fixtures import/export unchanged.
- Existing app tests for polls, columns, slides, and tables pass under the legacy preset.
- Focused plugin tests cover each structural plugin independently.

## Risks

- Doing all four plugins together will obscure regressions. Keep subphases independently testable.
- Table rendering, selection, keyboard navigation, clipboard, and drag/drop are tightly coupled. Defer table until the other structural plugin patterns are established.
- Polls require CRDT merge behavior; forgetting to move the merge hook into `pollsPlugin` will cause subtle concurrent vote regressions.
- Slides mix block rendering with editor-local presentation state and fullscreen APIs. Keep browser/global concerns editor-owned unless a narrow plugin UI context already exists.
- Columns and tables both use structural drag/drop. Avoid inventing a broad drag/drop plugin API unless current ownership declarations and command gating are insufficient.
- Existing tests may rely on compatibility exports and central helper names. Preserve wrappers until the plugin-owned replacements are proven.

## Completion Criteria

- `legacyRichTextBlocksPlugin` no longer owns poll, columns, slide deck, slide, or table metadata.
- `legacyRichTextUiPlugin` no longer owns poll, columns, slide, or table toolbar/slash entries.
- Poll merge behavior is owned by `pollsPlugin`.
- Table virtual parent behavior is owned by `tablePlugin`.
- `tablePlugin` depends on or includes table selection behavior from Phase 10.
- Central rendering/commands are registry-gated for all structural features, with any remaining hard-coded execution paths documented.
- Existing behavior for polls, columns/card columns, slides, and tables is preserved under `legacyRichTextPlugins`.
