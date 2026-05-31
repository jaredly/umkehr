# Seed DB QA implementation plan

## Goal

Address the QA findings from `qa-notes.md` after seeded DB manual testing.

Targets:

- merge UI makes no-op/already-merged merges obvious and disables accepting them;
- merge impact counts CRDT updates that would actually affect the target branch;
- seeded fixtures use the same command/update paths as UI interactions;
- whiteboard dragging does not trigger browser selection;
- whiteboard and todo examples move toward per-item/per-element render subscriptions;
- perf improvements should inform helper APIs that make efficient usage the easy path.

## Decisions

- No-op/already-merged merges should be disabled, not recorded as provenance.
- Merge impact should count CRDT updates with an actual effect, not only paths or domain objects.
- Seed fixtures should use the same command paths as UI interactions, even if generator complexity increases.
- Do not use `React.memo` as the fix for broad rerenders. It hides the symptom without fixing the subscription shape.
- The preferred record-key pattern is selector-based `useValue`, for example `useValue(editor.$.elements, (elements) => Object.keys(elements))`.
- Performance work should not stay purely ad hoc in examples. Look for helper APIs only where selector-based `useValue` and path subscriptions are not enough.

## Phase 1: Fix Seed Fixture Update Granularity

The current generator mostly emits root-level `set` updates. This makes branch fixtures unrealistic and breaks the `whiteboard: branches` expected merge result.

Likely files:

- `examples/react-crdt/src/lib/seed/generate.ts`
- `examples/react-crdt/src/lib/seed/generate.test.ts`
- possibly shared seed helper modules under `examples/react-crdt/src/lib/seed/`

Work:

- Replace root-level fixture updates with command-like granular CRDT updates.
- Use the same logical paths as UI interactions:
  - todo title/done changes update the specific todo field;
  - todo additions use the same array add/push path behavior as the UI;
  - whiteboard element additions update `elements[id]`;
  - whiteboard background changes update `background`;
  - whiteboard note moves/resizes/text edits update the specific element fields.
- Keep an initial root set only where it represents initial document creation.
- Ensure `whiteboard-branches` main materializes with branch additions after merges:
  - annotation from `annotations`;
  - second sticky from `layout`.
- Keep `--date` deterministic behavior.

Tests:

- Generator test asserts branch fixture events include non-root paths for branch edits.
- Materialize generated `whiteboard-branches` main and assert merged branch elements are present.
- Determinism test still passes.
- `bun run seed:test -- --date ... --size small` still imports successfully.

Acceptance:

- The seeded `whiteboard: branches` document makes visual sense on `main`.
- Merge preview path labels are more specific than `<root>` for branch fixtures.

## Phase 2: Merge Impact Analysis

Add merge analysis that distinguishes candidate source updates from updates that actually affect the target.

Likely files:

- `examples/react-crdt/src/lib/server/materialize.ts`
- `examples/react-crdt/src/lib/server/materialize.test.ts`
- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`

Work:

- Add a `MergeImpact` type.
- Extend `MergePathPreview` or return a sibling `impact` field from `buildMergePathPreview`.
- Count source CRDT updates through the selected source event index.
- Determine already-merged source coverage by walking target merge events recursively:
  - if target already merged the same source branch through an equal or greater event index, mark already merged;
  - count source events already covered by prior merges.
- Determine effective CRDT updates by applying source updates one by one to the target pre-merge doc and checking whether each update changes state/meta.
- Treat source updates that are discarded by CRDT LWW or duplicate history as no-effect.
- Keep path information for display, but make the primary count `effectiveUpdateCount`.

Tests:

- Fresh source branch reports effective updates.
- Source branch already merged through the same index reports zero effective updates and `alreadyMerged: true`.
- Older source update that loses to target LWW is counted as no-effect.
- Merge event from a source branch recursively counts nested source updates.

Acceptance:

- Merge preview can answer: “How many CRDT updates would this merge bring in?”
- Already-merged/no-effect cases are represented in data before UI changes.

## Phase 3: Merge UI Updates

Use merge impact data in the history panel.

Likely files:

- `examples/react-crdt/src/lib/server/ServerHistoryView.tsx`
- `examples/react-crdt/src/style.css`

Work:

- Prominently display:
  - `Changes to bring in: N`
  - `Already merged: yes/no` or `Already merged through event X`
  - `No-effect updates: N`
- Rename or de-emphasize existing “Changed paths” count so it does not imply impact.
- Disable merge buttons when `effectiveUpdateCount === 0`.
- Show explanatory copy for disabled no-op merges:
  - already merged;
  - no CRDT updates would change the current branch.
- Keep revert-path controls only for effective paths or clearly label no-effect paths.

Tests:

- Component-level testing is optional if setup cost is high, but add pure helper tests for labels/button state if extracted.
- Manual check against seeded branch fixtures.

Acceptance:

- User can tell before clicking whether a merge would do anything.
- Already-merged branches cannot be accepted again.

## Phase 4: Whiteboard Pointer Default Handling

Fix browser selection during drag/pan/draw interactions.

Likely files:

- `examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx`
- `examples/react-crdt/src/style.css`

Work:

- Call `preventDefault()` for whiteboard-owned pointer starts and moves:
  - element move;
  - note resize;
  - board pan;
  - pen stroke;
  - minimap drag.
- Preserve textarea editing behavior.
- Add targeted CSS:
  - `user-select: none`;
  - `touch-action: none`;
  - only on board/handles/resizers, not note textarea content.

Tests:

- Add a focused unit/helper test only if event handlers are extracted.
- Otherwise verify manually in browser.

Acceptance:

- Dragging notes, resizing notes, panning, drawing, and minimap dragging do not select page text or trigger browser gestures.
- Text inside note textareas remains editable/selectable.

## Phase 5: Whiteboard Render Performance

Reduce full whiteboard rerenders during active element updates.

Likely files:

- `examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx`
- `src/react-core/index.ts`
- possibly `src/react-crdt/react-crdt.tsx` or a new helper entrypoint

Work:

- Short-term example changes:
  - remove the parent subscription to the full `elements` record;
  - use selector-based subscriptions for structure, e.g. `useValue(editor.$.elements, (elements) => Object.keys(elements))`;
  - subscribe each element view to its own path, e.g. `useValue(editor.$.elements[id])`;
  - keep event handlers stable enough to avoid forcing broad parent state through every child, but do not rely on `React.memo` as the fix;
  - consider rendering active drag via local overlay/transform instead of document preview updates on every pointermove.
- Better API direction:
  - document selector-based `useValue` as the first-line pattern for structural subscriptions;
  - evaluate whether `useValue` needs ergonomics or equality improvements for selectors;
  - only add new helper APIs for cases selector-based `useValue` cannot express cleanly.
- Avoid broad recomputation for minimap if possible:
  - compute minimap data from stable element projections;
  - subscribe to only the fields needed for minimap bounds.

Tests:

- Existing behavior tests should still pass.
- Add render-count tests only if a stable test harness already exists or can be introduced cheaply.

Acceptance:

- Dragging one note should not rerender every note view.
- The example code demonstrates selector-based structure subscriptions plus per-element value subscriptions.

## Phase 6: Todo Render Performance

Reduce full todo list item rerenders when updating one todo.

Likely files:

- `examples/react-crdt/src/apps/todos/TodoPanel.tsx`
- `src/react-core/index.ts`
- possibly `src/react-crdt/react-crdt.tsx`

Work:

- Short-term example changes:
  - remove the parent subscription to full todo item values where possible;
  - use selector-based subscriptions for list structure, e.g. `useValue(editor.$.todos, (todos) => todos.map((todo) => todo.id))`;
  - have each row subscribe to its own data path;
  - avoid passing broad changing props through the parent;
  - avoid `editor.useLocalHistory()` inside every row.
- Better API direction:
  - selector-based `useValue` is the preferred starting point for list structure;
  - investigate helper APIs only for the hard part: subscribing to array items by stable id or CRDT item id instead of fragile index;
  - provide a first-class pattern for “render list structure, subscribe row content independently”;
  - cache blame computation by history version/timestamp and todo id.
- Handle reorder/remove carefully because array indexes are unstable.

Tests:

- Existing todo behavior tests should pass.
- Add render-count tests only if practical.
- Add tests for any new subscription helper API.

Acceptance:

- Updating one todo should not rerender every visible todo row in normal use.
- The example should model the intended library pattern for efficient lists.

## Phase 7: Manual QA Pass

Run the seeded flow again after fixes.

Checklist:

- `bun run seed:test -- --date 2026-01-02 --size small`
- `bun run dev:test`
- React app server mode:
  - inspect `whiteboard: branches` main state;
  - preview merges from branch docs;
  - verify no-op/already-merged merge buttons are disabled;
  - drag/resize/pan/draw whiteboard without browser selection;
  - update one todo and observe render behavior if instrumentation is available;
  - drag one note and observe render behavior if instrumentation is available.

## Implementation Order

1. Fix seed generator granularity and whiteboard branch fixture correctness.
2. Add merge impact analysis and tests.
3. Update merge UI to use impact data and disable no-op merges.
4. Fix whiteboard pointer defaults.
5. Improve whiteboard render pattern and identify reusable helper API.
6. Improve todo render pattern and identify reusable helper API.
7. Run manual QA pass and update `qa-notes.md` or implementation log with outcomes.

## Open Design Work

- Exact helper API names and shapes for efficient list/record subscriptions.
- Whether merge impact should surface only update counts or also grouped domain labels.
- Whether revert controls should operate at path level, update level, or grouped domain level once impact analysis is update-based.
