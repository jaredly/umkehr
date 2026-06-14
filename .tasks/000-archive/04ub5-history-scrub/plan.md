# Plan: Block Rich Text History Scrub

## Product Decisions

These decisions come from the answered open questions in `research.md`:

- Do not record selection-only captures as history actions.
- Export the action list as the authoritative replay source, plus a derived final snapshot for inspection.
- Import should replace current history and always jump to the end of the imported history.
- Debug logs should remain UI/debug-only and should not be part of imported/exported replay state.
- Do not add explicit action labels to the history model.
- Use `confirm()` before import or reset would discard the current history.

## Phase 1: Add Pure History Runtime

Create a new example-local module, likely `examples/block-rich-text/src/history.ts`, that owns the serializable history model and replay helpers.

Define the core types:

```ts
type HistoryAction =
    | {
          type: 'local-change';
          editorId: EditorId;
          ops: Op[];
          selection: RetainedSelectionSet;
      }
    | {
          type: 'toggle-online';
          editorId: EditorId;
      };

type HistoryState = {
    actions: HistoryAction[];
    cursor: number;
};
```

Implement helpers:

- `initialHistoryState()`
- `replayHistory(actions, cursor?)`
- `appendHistoryAction(history, action)`
- `setHistoryCursor(history, cursor)`
- `resetHistoryState()`

Replay details:

- Start from `createDemoState()`.
- For `local-change`, apply recorded `ops` to the source replica state with `applyMany()`, then pass the result through `applyLocalChange()` so queueing and peer delivery remain faithful.
- For `toggle-online`, call `toggleOnline()`.
- Clamp cursor to `0..actions.length`.
- Treat appending while scrubbed into the past as branching: drop actions after the cursor before appending.
- Advance each replayed replica's `clock` past every Lamport/HLC count emitted by that actor in recorded ops. New edits after scrubbing or importing must not reuse timestamps or Lamport ids already present in replayed history.

## Phase 2: Add Import/Export Serialization

Keep serialization in the history module or a small sibling module if the file gets crowded.

Use a versioned JSON envelope:

```ts
type ExportedHistory = {
    version: 1;
    app: 'examples/block-rich-text';
    actions: HistoryAction[];
    finalSnapshot: HistorySnapshot;
};
```

Implement:

- `serializeHistory(history): string`
- `parseHistoryExport(text): {history: HistoryState} | {error: string}`
- A compact `HistorySnapshot` shape for human inspection of the final replay state. It should be derived from materialized/visible block APIs and include visible block text/order, online flags, queue lengths, deleted block count, join count, and any other cheap summary data that helps a bug report without becoming the replay source.
- Runtime validation for envelope shape, `version`, `app`, `editorId`, action `type`, `ops`, retained selection sets, and final snapshot shape if present.
- Op validation should match the current block CRDT shape:
  - Accept `join-record` and `block:delete`.
  - Do not accept the removed `block:status` op.
  - Validate block records with `deleted: boolean`, not `status`.
  - Validate block order as `{id, path, index, ts}`.
  - Validate `State` snapshots or diagnostics with `joins`.
  - Allow tuple timestamps for `CharParentTs` and `BlockOrderTs`.
- Import cursor behavior: always set `cursor` to `actions.length`.

Validation does not need to prove every CRDT op is semantically valid before replay. It should reject malformed JSON and obviously wrong shapes, then let replay exercise the CRDT code.

## Phase 3: Refactor App State Around History

Replace `demo` React state in `App.tsx` with history state:

```ts
const [history, setHistory] = useState<HistoryState>(() => initialHistoryState());
const demo = useMemo(() => replayHistory(history.actions, history.cursor), [history]);
```

Because selection-only captures are not history actions, add transient UI selection state:

```ts
const [transientSelections, setTransientSelections] = useState<Partial<Record<EditorId, RetainedSelectionSet>>>({});
```

Before rendering editors and before running commands, derive display replicas by overlaying transient selections onto the replayed `demo`. This preserves the existing inactive selection/caret display during live editing and ensures the next edit command sees the current selection set without making selection-only captures part of exported history.

Update `runCommand`:

- Read the current display replica for `editorId`, including transient selection overlays.
- Run the command against that replica.
- Store the returned `RetainedSelectionSet` directly; command results already use the runtime selection-set shape.
- Append a `local-change` action with `editorId`, `ops`, and retained `selection` only when the command produced document ops.
- For commands with no document ops, update `transientSelections[editorId]` instead of appending history.
- When a document-op action is appended, clear that editor's transient selection because replayed history now includes the resulting retained selection.
- `captureSelection` should only update `transientSelections`.

Update online toggles:

- Append a `toggle-online` action instead of directly mutating `demo`.

Clear transient selections and pending DOM selection restore refs when the user changes the history cursor, imports history, or resets history. Slider movement should only change replay position; it should not create new history actions.

## Phase 4: Build History Controls

Add a compact history control band near the top of the app, above the editor grid.

Controls:

- HTML range input with `min=0`, `max=history.actions.length`, and `value=history.cursor`.
- Count label like `12 / 45`.
- Export button.
- Import button backed by a hidden file input.
- Reset button.
- Small status/error message area for import/export feedback.

UI behavior:

- Moving the slider updates only `history.cursor`.
- Export downloads the current history envelope as JSON, including the action list and derived final snapshot.
- Import reads a selected file, validates it, asks for confirmation when current history is non-empty, replaces history, jumps to the end, and shows success or error status.
- Reset asks for confirmation when current history is non-empty, then returns to an empty history and initial document state.
- Editing while scrubbed into the past branches by truncating future actions.

Keep styling consistent with the existing restrained toolbar/panel look in `style.css`.

## Phase 5: Add Tests

Add focused pure tests for history replay and serialization, likely in `examples/block-rich-text/src/history.test.ts`.

Runtime test cases:

- Replaying local insert actions produces the expected text in both editors.
- Replaying offline toggle, offline edits, and online toggle reproduces queued delivery.
- Cursor `0`, an intermediate cursor, and end cursor derive the expected states.
- Appending while cursor is in the past drops future actions.
- Selection-only captures are not appended to history.
- Serialized history includes a final snapshot and parses back to a history whose final replay state matches it.
- Invalid import JSON and invalid envelopes return errors.
- Replaying or importing histories containing `join-record`, `block:delete`, nested `block:move` order paths, and incidental block order timestamps works.
- Editing after scrubbing/importing uses fresh actor clocks and does not duplicate Lamport ids or HLC strings already present in the replayed history.
- Concurrent join and block-move cycle-hardening histories replay to the same materialized block output after export/import.

Add targeted `App.test.tsx` coverage:

- Slider moves the visible document backward and forward.
- Online/offline toggles appear in the history count and replay correctly.
- Editing from an intermediate cursor branches and updates the max range.
- Import confirms replacement, replaces existing history, and jumps to the end.
- Invalid import leaves existing history untouched and displays an error.
- Reset confirms before clearing existing history.

## Phase 6: Verify Manually And With Existing Tests

Run the relevant automated tests:

```sh
npm exec vitest examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/App.test.tsx
```

Then run the example build if practical:

```sh
cd examples/block-rich-text
npm run build
```

Manual smoke test in the browser:

- Type in Editor A and scrub back to empty, then forward to final state.
- Take Editor A offline, type, verify Editor B stays stale, scrub through the offline actions, then toggle online and verify queued delivery.
- Export a session, reset, import it, and verify the final state and scrub range are restored.
- Scrub into the past, type a new edit, and verify future actions are dropped.

## Phase 7: Cleanup

Review for accidental coupling between live DOM state and replay state:

- Slider/import/reset should not restore stale pending carets.
- Debug logs should not be serialized.
- Exported JSON should be readable and reasonably compact.
- Final snapshots should be clearly treated as diagnostic metadata, not as replay authority.
- History should treat CRDT ops as opaque replay data except for shallow import validation and actor-clock advancement.

Keep the public `umkehr/block-crdt` API unchanged unless implementation proves a missing primitive is necessary.
