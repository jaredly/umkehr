# Seed DB QA research

This note follows up on `.tasks/seed-dbs/qa-notes.md`. It focuses on likely causes and implementation options, not fixes.

## 1. Merge UI should show already-merged/no-op state

### Current behavior

`ServerHistoryView` can preview a merge and shows:

- source through event index;
- changed path count;
- applied count;
- reverted count.

The changed path count comes from `mergePreview.changedPaths`, which is built by `pathsForBranchThrough(...)` in `server/materialize.ts`. That function lists paths touched by the source branch through the selected event index. It does not currently distinguish:

- paths already present in the target because the source was already merged;
- source updates that lose due to CRDT timestamp ordering;
- source updates that touch the same path but would produce no state difference;
- paths whose source branch event has already been included by an earlier target merge event.

So the UI can imply a merge has meaningful effects even when materializing the merge would not change the target state.

### Recommended direction

Add a merge impact analysis helper beside `buildMergePathPreview`.

Useful output shape:

```ts
type MergeImpact = {
    sourceEventCount: number;
    alreadyMergedEventCount: number;
    candidatePathCount: number;
    effectivePathCount: number;
    noEffectPathCount: number;
    effectivePaths: CrdtPathSegment[][];
    noEffectPaths: CrdtPathSegment[][];
    alreadyMerged: boolean;
};
```

The robust definition of “effective” should compare materialized target state before and after preview merge:

1. Materialize target before merge.
2. Materialize target with preview merge.
3. Compare state/meta at each candidate path.
4. Count only paths whose materialized value actually differs as “changes that would be brought in”.

For “already merged”, inspect target branch merge events recursively. If target already has a merge from the same source branch through an equal or greater event index, label the source as already merged. That is separate from no-op due to CRDT LWW conflict.

### UI changes

Make the merge panel prominently show:

- `Changes to bring in: N`
- `Already merged: M events` or `Already merged through event X`
- `No effect: N paths`

Disable or de-emphasize “Accept merge” when effective changes are zero. If accepting a no-op merge is still useful as provenance, the button text should make that explicit, for example “Record no-op merge”.

## 2. `whiteboard: branches` fixture merge state is confusing

### Likely cause

The seed generator currently emits root-level `set` CRDT updates for fixture states. In `whiteboardBranches`, the rough event shape is:

1. main sets the base board;
2. layout branch sets a full board containing the layout sticky;
3. annotations branch sets a full board containing the annotation;
4. main sets a full board with only a background change;
5. main records merge events from layout and annotations.

Because these are root-level `set` updates, CRDT last-writer-wins applies at the root. The main branch background update has a later HLC timestamp than the branch root updates, so when the merge materializer applies branch root updates later, they are older than the current root and are discarded. The merge event exists, but the branch additions do not appear in the merged main materialization.

That matches the QA observation: main does not show the annotation or second sticky after viewing the merge state.

### Recommended direction

Seed fixtures should use granular CRDT updates instead of root-level state replacement for branch examples.

For whiteboard:

- initial fixture can set root once;
- branch additions should use record-entry/object-field updates for `elements[id]`;
- background changes should update only `background`;
- note position/text changes should update only those fields.

For todos:

- initial fixture can set root once;
- item additions should use array item adds or at least targeted array replacement;
- done/title changes should target the specific todo item fields.

This will make branch merges behave like real user edits and also make the merge path UI more useful than showing `<root>` for most seeded branch changes.

### Alternative

Keep root-level fixture events but ensure main does not perform a later root update before merges. This is cheaper but less representative and still leaves merge previews coarse.

## 3. Whiteboard drag should prevent browser selection

### Current behavior

`startElementDrag(...)` calls `event.stopPropagation()` but does not call `event.preventDefault()`. Board pointer handlers also generally do not prevent default for drag/pan/pen start and pointer move.

The window pointermove listener is registered with `{passive: false}`, but the move handler does not call `preventDefault()` during whiteboard drags.

### Recommended direction

Call `preventDefault()` for pointer interactions that are owned by the whiteboard:

- element move start;
- note resize start;
- board pan start and move;
- pen stroke start and move;
- minimap drag start and move.

Also consider CSS:

```css
.whiteboardViewport,
.whiteboardCanvas,
.whiteboardNoteHandle,
.whiteboardResize {
    user-select: none;
    touch-action: none;
}
```

Textarea editing should remain selectable/editable, so do not blanket-disable selection inside note textareas.

## 4. Whiteboard perf: every `NoteView` updates while dragging one

### Current behavior

`WhiteboardPanel` subscribes to `editor.$.elements`:

```ts
const elementsRecord = useValue(editor.$.elements);
const state = useMemo(() => ({background: editor.latest().background, elements: elementsRecord}), ...);
const elements = useMemo(() => orderedElements(state), [state]);
```

During drag preview, the dragged note’s `position` changes under `elements[id].position`. Because the parent is subscribed at `elements`, the parent rerenders. It recomputes `orderedElements`, maps every element, and passes every element object through props. Even if unchanged element object references are stable, React still calls every child function unless children are memoized.

`NoteView`, `EmojiView`, and `StrokeView` are not wrapped in `React.memo`, and several inline callbacks are recreated during each parent render.

### Recommended direction

Use path-level subscriptions per element and memoized row/view components.

Potential structure:

- Parent subscribes only to element ids/order/archive state needed to decide which views exist.
- Each element view subscribes to `editor.$.elements[id]` internally.
- Wrap element views in `React.memo`.
- Use stable callbacks keyed by id where possible, or pass `id` and let the child call stable handlers.

For drag preview specifically, an even better approach is to avoid writing preview state into the document-shaped tree on every pointer move. Keep the active drag transform in local component state and render an overlay/transform for the active element. Commit one CRDT update on pointerup. This also aligns with the shared-preview research direction.

### Lower-effort mitigation

Wrap `NoteView`, `EmojiView`, and `StrokeView` in `React.memo` and reduce inline prop churn. This may help but will not eliminate parent work or minimap recomputation.

## 5. Todo perf: every todo updates when updating one todo

### Current behavior

`TodoPanel` subscribes to the entire array:

```ts
const todos = useValue(editor.$.todos);
```

Then it maps every `TodoItem`. `TodoItem` receives the todo value as a prop. Updating one todo changes the array value and rerenders the parent. As with whiteboard, every child function is called unless memoized.

`TodoItem` also calls `editor.useLocalHistory()` when available to compute blame. That subscribes each row to whole local history changes, so even if todo values were memoized, every row may still update when history changes.

### Recommended direction

Split list structure from row data:

- Parent subscribes to a lightweight projection of ids/order, e.g. `useValue(editor.$.todos, todos => todos.map(todo => todo.id))`.
- Each `TodoItem` receives `id` and `index`, then subscribes to its own row path with `useValue(editor.$.todos[index])`.
- Wrap `TodoItem` in `React.memo`.
- Move blame computation out of every row or cache it by history/update timestamp and todo id.

Important caveat: array indexes are unstable under reorder/remove. For robust per-row subscriptions, the CRDT layer may need an id-based lookup helper or the UI needs to recompute id-to-index carefully and accept row remounts on reorder.

### Lower-effort mitigation

Use `React.memo(TodoItem)` and avoid passing unstable props. This should reduce child render cost for unchanged todo object references, but parent array subscription and blame history subscriptions will still be broad.

## Suggested priority

1. Fix whiteboard fixture generation for branch merges. This directly undermines the seeded DB evaluation goal.
2. Add merge impact/no-op analysis and clearer merge UI counts.
3. Fix whiteboard drag default handling with `preventDefault` and targeted CSS.
4. Address whiteboard perf with local drag overlays or per-element subscriptions.
5. Address todo perf with per-row subscriptions and cached blame.

## Open questions

- Should accepting a no-op/already-merged merge be allowed as explicit provenance, or should it be disabled?
  - disabled
- Should merge impact count paths, events, or user-facing domain objects? For users, “2 elements” or “3 todos” may be clearer than “2 CRDT paths”.
  - hmm it should count # of CRDTUpdates that have an impact
- Should seed fixtures use the exact same command paths as UI interactions, even if that requires more generator complexity?
  - yeah
- Is perf work intended only for examples, or should it drive new library helper APIs for id-based CRDT subscriptions?
  - I'm interested in helper APIs to make a "pit of success"
