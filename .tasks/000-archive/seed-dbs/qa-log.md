# QA implementation log

## Phase 1: seed fixture update granularity

- Reworked seeded fixture edits to go through CRDT local command generation instead of hand-written root `set` events.
- Kept root replacement for initial document creation, then switched follow-up fixture edits to specific todo fields, todo array pushes, whiteboard record entries, and whiteboard background paths.
- Added deterministic `Date.now` wrapping around seed command generation so `--date` remains stable with command-generated HLC updates.
- Fixed `whiteboard-branches` so `main` merges branch-local `layout` and `annotation` element additions instead of competing root replacements.
- Added generator tests for non-root branch edit paths and materializing `whiteboard-branches` main with merged elements.

Verification:

- `bun run build` in `examples/react-crdt`: passed.
- `bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-qa-phase1.sqlite` in `examples/react-crdt-server`: passed.
- `npm run test -- examples/react-crdt/src/lib/seed/generate.test.ts`: blocked by existing Typia transform setup in root Vitest, before tests run.

## Phase 2: merge impact analysis

- Added `MergeImpact` data to merge previews with total source updates, effective updates, already-merged updates, no-effect updates, and already-merged-through metadata.
- Merge impact now recursively collects source update events through nested merge events.
- Already-merged coverage is computed by walking target merge events and their nested source merges.
- Effective update counts are computed by applying candidate source updates over the target pre-merge document and checking whether state or CRDT metadata changes.
- Added materialization tests for fresh effective merges, already-merged no-op merges, LWW-losing source updates, and recursive source merge counts.

Verification:

- `bun run build` in `examples/react-crdt`: passed.
- `npx vitest run examples/react-crdt/src/lib/server/materialize.test.ts`: passed.

## Phase 3: merge UI impact display

- Updated the merge preview UI to lead with `Changes to bring in` from `effectiveUpdateCount`.
- Added visible counts for already-merged status, source updates, no-effect updates, already-merged updates, source paths, kept paths, and reverted paths.
- Disabled both merge buttons when the preview has zero effective updates.
- Added no-op messaging for already-merged and otherwise no-effect merge previews.
- Renamed path labels to make clear they are source changed paths, not the merge impact count.

Verification:

- `bun run build` in `examples/react-crdt`: passed.

## Phase 4: whiteboard pointer default handling

- Added `preventDefault()` to whiteboard-owned pointer starts, active drag moves, drag releases, pen drawing moves/releases, note resize starts, and minimap drag interactions.
- Preserved note textarea pointer behavior by only stopping propagation there and keeping textarea selection/editing enabled.
- Added targeted `user-select: none` and `touch-action: none` to board, element drag, resize, stroke, emoji, and minimap surfaces.
- Restored `user-select: text` and normal touch behavior on note textareas.

Verification:

- `bun run build` in `examples/react-crdt`: passed.


## Phase 5: whiteboard render subscriptions

- Removed the parent whiteboard subscription to the full `elements` record.
- Added selector-based structural subscriptions for visible element ids, visible stroke ids, visible surface element ids, and archived element ids.
- Moved per-element value subscriptions into `StrokeSlot`, `ElementSlot`, `MinimapElement`, and `ArchivedElementButton`.
- Kept drag/edit logic command-based and avoided `React.memo`.
- Parent-level operations that need the latest full board state now read from `editor.latest()` at interaction time instead of subscribing the parent to all element values.

Verification:

- `bun run build` in `examples/react-crdt`: passed.


## Phase 6: todo render subscriptions

- Removed the parent todo panel subscription to the full `todos` array.
- Added selector-based list structure subscription with `useValue(editor.$.todos, todos => todos.map(todo => todo.id))`.
- Moved completed/total count into a small `TodoSummary` subscriber.
- Added `TodoItemSlot` so each row subscribes to its own `editor.$.todos[index]` value path.
- Kept drag/reorder index math based on `editor.latest().todos` and the structural id list.
- Replaced per-row `editor.useLocalHistory()` title blame with path-scoped CRDT helpers: `useCrdtPath` returns the `CrdtPathSegment[]` for a logical path, and `useCrdtMeta` supports the title tooltip without subscribing rows to unrelated CRDT history changes.
- Removed broad `editor.useLocalHistory()` calls from document workspace wrappers that were rerendering entire CRDT panels on every history change.
- Added small CRDT/history undo/redo subscribers inside todo and whiteboard panel headers so button disabled state can update without forcing list/board children to rerender.
- Added a core render-count test proving array item field edits rerender only the changed row with the selector/id-list pattern.
- Removed the server sync `saveHistory -> replaceHistory` feedback loop that updated `ServerReadyApp` state on every local edit and recreated the provider subtree.
- Avoided provider-wide `replaceHistory` for active-branch remote update events; those now flow through `transport.receive` and path-scoped notifications.
- Active-branch merge events now derive effective source updates from the branch graph and apply them incrementally through `transport.receive`, avoiding a full provider refresh for merges too.
- Moved todo drag drop-target hover state out of `TodoPanel` React state and into an external store; each row now subscribes to its own derived drop position so pointer hover changes do not rerender the full list.
- Fixed CRDT array move no-op handling for adjacent boundaries so moving an item before its current next item or after its current previous item does not emit an unnecessary order update.
- Avoided `React.memo`.

Verification:

- `npx vitest run src/react-crdt/react-crdt.test.tsx`: passed.
- `npm run build`: passed.
- `bun run build` in `examples/react-crdt`: passed.
