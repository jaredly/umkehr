# Plan: Plim Side-by-Side CRDT Example

## Decisions From Research

- Build two live Plim panes, backed by independent CRDT adapter replicas.
- Use actor ids `left` and `right`.
- Use per-replica timestamp generators.
- Include online/offline toggles and queued sync.
- Remove `Remote Insert` and `Remote Split`.
- Put debug output below the editors, collapsed by default, with one debug section per side.
- Do not add special cross-pane selection visualization for now.

## Phase 1: Extract Replica Runtime Shape

Add a small local runtime model, either inside `App.tsx` or in a new helper such as `src/plimDemoRuntime.ts` if `App.tsx` gets too large.

Define:

```ts
type EditorId = 'left' | 'right';

type Replica = {
    id: EditorId;
    label: string;
    actor: EditorId;
    adapter: AdapterState;
    online: boolean;
    queue: Op<PlimBlockMeta>[][];
    ts: () => HLC;
};

type DemoState = {
    left: Replica;
    right: Replica;
};
```

Implementation notes:

- Initialize both replicas from one `createFixtureState()` result so they start identical.
- Use `makeTs(...)` once per replica, with distinct starting ranges if helpful for debugging.
- Keep queues on the source replica. If either source or peer is offline, enqueue local op batches instead of applying them to the peer.
- When toggling a replica online/offline, flush any queued batches where both source and peer are online.

Suggested helpers:

- `createDemoState(): DemoState`
- `peerId(id: EditorId): EditorId`
- `applyLocalAdapterChange(demo, id, nextAdapter, ops): DemoState`
- `toggleReplicaOnline(demo, id): DemoState`
- `flushQueues(demo): DemoState`

Acceptance criteria:

- The runtime can represent two independent adapters with independent online states.
- Local CRDT op batches can either replicate immediately or queue.
- Queued op batches flush in original order once both panes are online.

## Phase 2: Split The Plim Editor Pane Component

Extract the single-editor logic from `App.tsx` into a reusable component, tentatively `PlimReplicaEditor`.

Each pane component should own:

- its own `PlimDriver`
- its own `useEditorHandle()`
- its own `applyingFromCrdt` ref
- its own `SlashCommandMenu`
- its own `editor.setState(replica.adapter.plim)` effect

Props should include:

- `replica`
- `onTransaction(editorId, tx, postPlimState)`
- `onToggleOnline(editorId)`

Keep the existing Plim extensions and registered shortcut actions:

- `slashCommandExtension()`
- bold shortcut
- italic shortcut

Acceptance criteria:

- Rendering two panes does not share editor handles or menu state.
- Programmatic state updates do not feed back into local transaction handling.
- Each pane can independently capture local Plim transactions.

## Phase 3: Implement Two-Way Replication In App State

Replace the single `adapter` state with `demo` state.

Transaction handling rules:

1. If a transaction is programmatic, ignore it in the pane component.
2. If all ops are `setSelection`, update only the source replica's `adapter.plim` and `adapter.retainedSelection`.
3. Otherwise call `applyLocalTransaction(source.adapter, tx, {actor, ts}, postPlimState)`.
4. Apply the returned `ops` to the peer immediately if both panes are online.
5. Queue the returned `ops` on the source replica if either side is offline.
6. Preserve each side's retained selection independently.

Logging:

- Log local edit summaries as today, but include the source side: `left tx: replaceText -> 2 ops`.
- Log unsupported ops with the source side.
- Log queued sync when offline.
- Log queue flushes when panes reconnect.

Acceptance criteria:

- Editing left updates left immediately and right when connected.
- Editing right updates right immediately and left when connected.
- Offline edits remain local and queue for later.
- Re-enabling online sync flushes queued edits and both panes converge.
- Selection-only transactions remain local.

## Phase 4: Update Layout And Debug UI

Replace the current single-editor-plus-sidebar layout.

Target structure:

- `main.appShell`
- optional compact header/title
- `.editorGrid` with two `.editorPane` children
- each pane header contains:
    - label, such as `Editor A` / `Editor B`
    - actor id, `left` / `right`
    - online toggle
    - queued batch count
- collapsed debug area below the editors
- one debug `<details>` per side, each showing:
    - CRDT text
    - Plim JSON
    - queued batch count or online status
- collapsed log details, or a compact log section near the debug panels

Remove:

- `Remote Insert` button
- `Remote Split` button
- imports only used by those buttons

CSS updates:

- Make two panes usable side by side on desktop.
- Stack panes on smaller screens.
- Keep editor host heights stable.
- Keep debug output below the editors and collapsed by default.

Acceptance criteria:

- The first screen is the two-pane editor, not a debug dashboard.
- Debug data is available but not visually dominant.
- Offline state and queued work are visible per pane.
- The old remote buttons are gone.

## Phase 5: Update App Tests

Revise `examples/plim-block-crdt/src/App.test.tsx`.

Remove or replace:

- assertions for `Remote Insert`
- assertions for `Remote Split`
- tests that click scripted remote buttons
- global selectors that unintentionally target the first of two editors

Add or update tests:

1. Initial render shows two editor panes with matching fixture content.
2. Left text insertion syncs to right while both panes are online.
3. Right text insertion syncs to left while both panes are online.
4. Offline toggle queues source edits and does not update the peer until reconnect.
5. Reconnect flushes queued edits and both panes converge.
6. Bold/italic shortcut in one pane syncs mark data to the peer.
7. Selection-only changes remain local and do not reset the peer.
8. Slash command menu opens for the active pane.
9. Debug details exist per side and are collapsed by default.

Testing notes:

- Scope editor queries through pane containers, not `view.container` globally.
- Prefer accessible labels for panes and online toggles to make tests stable.
- Keep existing DOM shims unless the two-pane setup requires more Range/selection support.

Acceptance criteria:

- `npm test` in `examples/plim-block-crdt` passes.
- Tests prove bidirectional sync and queued offline behavior.
- Tests no longer rely on the removed remote buttons.

## Phase 6: Verify Build And Manual Behavior

Run:

```sh
npm test
npm run build
```

from `examples/plim-block-crdt`.

Manual checks in Vite:

- Load the example and confirm both panes render.
- Type in left; confirm right updates.
- Type in right; confirm left updates.
- Toggle one side offline; edit the other side; confirm queue count increases.
- Toggle back online; confirm queued edits flush.
- Open slash menu in each pane.
- Toggle bold/italic in one pane and confirm the other pane reflects the mark.
- Expand debug details and confirm both sides show expected CRDT/Plim state.

Acceptance criteria:

- Build and tests pass.
- Manual side-by-side editing works in both directions.
- No old scripted remote controls remain.

## Implementation Order

1. Add runtime helpers/types for two replicas and queued sync.
2. Extract the reusable pane component.
3. Wire `App` to `DemoState` and two-way replication.
4. Replace layout/debug CSS and remove remote controls.
5. Update tests around pane-scoped querying and sync behavior.
6. Run tests/build and do a quick browser pass.

## Non-Goals

- No history replay/import/export from `block-rich-text`.
- No undo/redo system.
- No special remote cursor or stale-selection rendering.
- No collaborative awareness beyond online/offline status and queued sync.
- No adapter rewrite unless a bug is exposed while wiring two replicas.
