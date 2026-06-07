# Research: Block Rich Text History Scrub

## Goal

Add a replayable history layer to `examples/block-rich-text` so users can scrub through every action made in either editor. The history should include document edits and online/offline toggles, expose a HTML range input for replay, and support import/export so bug reports can include a reproducible session.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/style.css`

The app keeps the demo state in React:

```ts
const [demo, setDemo] = useState<DemoState>(() => createDemoState());
```

`DemoState` is two `Replica` objects:

```ts
type Replica = {
    id: EditorId;
    actor: EditorId;
    state: CachedState;
    selection: RetainedSelection;
    online: boolean;
    queue: Op[][];
    clock: number;
};
```

Local edits flow through `runCommand` in `App.tsx`. The command returns a new CRDT state, emitted ops, and an offset selection. `runCommand` then stores a retained selection and calls `applyLocalChange`.

Connectivity toggles currently bypass edit commands:

```ts
onToggleOnline={() => setDemo((current) => toggleOnline(current, 'left'))}
```

`blockEditorRuntime.ts` is already a good boundary for replay because it contains:

- `createDemoState()`
- `applyLocalChange()`
- `toggleOnline()`
- `flushQueues()`
- `makeCommandContext()`

The CRDT ops are plain JSON-compatible data. `RetainedSelection` is also JSON-compatible. `CachedState` can be rebuilt by replaying actions from `createDemoState()`, so exported history does not need to include full state snapshots as the source of truth.

## Recommended Model

Introduce an example-local history state that wraps `DemoState`.

Suggested types:

```ts
type HistoryAction =
    | {
          type: 'local-change';
          editorId: EditorId;
          ops: Op[];
          selection: RetainedSelection;
      }
    | {
          type: 'toggle-online';
          editorId: EditorId;
      };

type HistoryState = {
    actions: HistoryAction[];
    cursor: number; // number of actions applied, from 0 to actions.length
};
```

The currently displayed `DemoState` should be derived by replaying `actions.slice(0, cursor)` from `createDemoState()`.

This is simpler and more reproducible than mutating `demo` independently while trying to keep a parallel log in sync. Exporting the same action list lets a bug reporter send the exact sequence that produced their issue, including offline queues and flush timing.

## Replay Semantics

Replay should use the same runtime functions as live interaction:

```ts
const replayHistory = (actions: HistoryAction[], cursor = actions.length): DemoState => {
    let demo = createDemoState();
    for (const action of actions.slice(0, cursor)) {
        if (action.type === 'local-change') {
            const current = demo[action.editorId];
            demo = applyLocalChange(demo, {
                editorId: action.editorId,
                state: applyMany(current.state, action.ops),
                selection: action.selection,
                ops: action.ops,
            });
        } else {
            demo = toggleOnline(demo, action.editorId);
        }
    }
    return demo;
};
```

The important detail is that a recorded local change should be applied to the source replica first, then passed through `applyLocalChange()` so peer sync or offline queuing behaves exactly like the original run.

Do not replay by only applying ops to both replicas. That would skip online/offline behavior and would fail to reproduce queueing bugs.

## Recording Live Actions

Replace the independent `demo` state with `history`, then derive `demo`:

```ts
const [history, setHistory] = useState<HistoryState>({actions: [], cursor: 0});
const demo = useMemo(() => replayHistory(history.actions, history.cursor), [history]);
```

When the user performs a new action while scrubbed into the past, append should truncate future actions first:

```ts
const appendAction = (action: HistoryAction) =>
    setHistory((current) => {
        const prefix = current.actions.slice(0, current.cursor);
        const actions = [...prefix, action];
        return {actions, cursor: actions.length};
    });
```

`runCommand` should record only commands that produce meaningful state or selection changes. There are two viable choices:

1. Record every command invocation, including selection-only captures with `ops: []`.
2. Record only document ops and online/offline toggles.

The task says "all actions", so the first option is more literal. It also preserves retained selections for reproduction. The UI may need compact labels so frequent `captureSelection` actions do not make the history unusable.

For a local command:

```ts
const result = command(replica);
appendAction({
    type: 'local-change',
    editorId,
    ops: result.ops,
    selection: retainSelection(result.state, result.selection),
});
```

For a toggle:

```ts
appendAction({type: 'toggle-online', editorId});
```

Because `demo` is derived, handlers must read the current derived replica when building the action. This is straightforward as long as handlers close over `demo` from render rather than using `setDemo((current) => ...)`.

## Import/Export

Use a versioned JSON envelope:

```ts
type ExportedHistory = {
    version: 1;
    app: 'examples/block-rich-text';
    actions: HistoryAction[];
    cursor?: number;
};
```

Export can create a Blob and click a temporary download link. Import can use a hidden file input, `File.text()`, `JSON.parse`, and a small validator before replacing history.

Recommended import behavior:

- Validate `version`, `app`, and action shapes.
- Validate `editorId` is `left` or `right`.
- Validate `ops` is an array, then rely on replay applying CRDT ops.
- Reset `cursor` to `actions.length` by default unless the file includes a valid cursor.
- Surface parse/validation errors in a small status message near the controls.

Imported history should not merge with existing local history. Replace it so reproduction starts from the same initial state.

## UI Shape

Add a history control band above the two editors or in the top bar:

- Range input:
  - `min={0}`
  - `max={history.actions.length}`
  - `value={history.cursor}`
  - `onChange` updates `cursor`
- Numeric label like `12 / 45`
- Export button
- Import button
- Optional reset button

When `cursor < actions.length`, the app is viewing the past. Editing from that point should branch by truncating future actions, matching common timeline behavior.

The current debug logs are separate from application state. They are useful during development but should not be part of exported reproduction state unless explicitly desired later.

## Testing Plan

Add focused tests for a pure replay helper, preferably in a new `blockEditorRuntime.test.ts` or `history.test.ts`.

Useful cases:

- Replaying two local insert actions produces the same text in both editors.
- Replaying an offline toggle, edit, and online toggle reproduces queued delivery.
- Scrubbing to cursor `0`, an intermediate cursor, and the end shows the expected state.
- Appending while `cursor < actions.length` drops future actions.
- Exported JSON imports and replays to the same final state.
- Invalid import JSON is rejected without replacing current history.

Add UI coverage in `App.test.tsx` for the range input and import/export controls only where the DOM integration matters.

## Implementation Notes

`makeCommandContext()` currently mutates `replica.clock`:

```ts
nextTs: () => `${replica.actor}-${String(replica.clock++).padStart(5, '0')}`,
```

This works today because commands receive the live mutable replica object. With replay-derived state, recorded ops already contain concrete timestamps and ids, so replay does not need `makeCommandContext()`. Live command execution still does.

If history replay derives `demo` with `useMemo`, avoid calling command functions inside `setHistory` updaters because the updater only has history, not the rendered `demo`. Build the action first from the current rendered `demo`, then append it.

`pendingCaretRestoreBlockIdRef` and `pendingSelectionRestoreRef` in `App.tsx` are live editing concerns. Scrubbing history should probably clear pending restore refs or avoid setting them for replay-only state changes, otherwise moving the slider could try to restore a stale DOM selection.

Range input changes should not call command handlers or record history actions.

## Open Questions

1. Should selection-only captures be included in "all actions"? Including them improves reproduction of retained-selection bugs but may make the scrubber noisy because mouse/key selection updates are frequent.
2. Should the exported file include only the action list, or also include derived final snapshots for easier human inspection? The action list should remain authoritative either way.
3. Should import preserve the exported cursor, or always jump to the end of the imported history? For bug reproduction, jumping to the end is likely the default users expect.
4. Should history include debug log messages? They are not needed for deterministic replay, but they may help diagnose bug reports.
5. Should there be explicit action labels in the history model, such as `insert "a"` or `toggle bold`, for a future visible action list? The scrubber only needs indices, but labels would make exports easier to inspect.
6. What should happen to unsaved current history on import or reset? A confirmation may be useful later, but the first implementation can keep replacement simple.
