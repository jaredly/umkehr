# Todo Reuse Plan

## Goal

Split `TodoItem` and `TodoAddForm` into reusable JSX-only view components plus editor-aware wrappers, then use those views in `TodoVersionApps.tsx` so the v1 and v3 todo fixture panels are interactive.

Target behavior from the answered open questions:

- Version panels should support add, delete, check/uncheck, and title/text edit.
- v1 `archived` should be editable.
- v3 `priority` and `notes` should be editable.
- `TodoItemView` may own local inline-edit draft state.
- Version-panel id generation does not need a new global convention; use the existing panel `actor` prop as the local id prefix where available.

## Phase 1: Extract `TodoAddFormView`

File: `examples/react-crdt/src/apps/todos/TodoAddForm.tsx`

1. Add an exported presentational component, probably `TodoAddFormView`.
2. Props should be plain UI state and callbacks only:
   - `draftTitle: string`
   - `placeholder?: string`
   - `readOnly: boolean`
   - `onDraftTitleChange(value: string): void`
   - `onSubmit(): void`
3. Keep form markup and existing classes stable:
   - `.addForm`
   - existing input/button layout
4. The view should only:
   - prevent default form submit;
   - render input/button;
   - call `onDraftTitleChange`;
   - call `onSubmit`.
5. Leave trimming, validation, todo creation, editor writes, and draft clearing in wrappers.
6. Rewrite the existing exported `TodoAddForm` as the v2 wrapper:
   - keep `draftTitle` state;
   - ignore submit if read-only or trimmed title is empty;
   - push `{id, title, done: false, priority: 'normal'}`;
   - keep current `id: `${replicaId}-${crypto.randomUUID()}``;
   - clear the draft only after a successful push.

Acceptance check:

- `TodoPanel` should not need call-site changes beyond import compatibility.
- The main v2 add form should behave exactly as before.

## Phase 2: Extract `TodoItemView`

File: `examples/react-crdt/src/apps/todos/TodoItem.tsx`

1. Add exported plain view types:
   - `TodoItemPresenceCursor` for already-normalized cursor display data.
   - optional `TodoItemDropPosition = 'before' | 'after' | null`.
   - optional prop type for `TodoItemView`.
2. Add an exported presentational `TodoItemView`.
3. Keep JSX markup and CSS classes stable:
   - `.todoItem`
   - `.done`
   - `.dragging`
   - `.dropBefore`
   - `.dropAfter`
   - `.dragHandle`
   - `.dragHandleSpacer`
   - `.titleInput`
   - `.todoTitle`
   - `.itemActions`
   - `.presenceCursorStack`
   - `.presenceCursor`
4. The view should know only about primitives, React nodes, and callbacks. Suggested props:
   - `id: string`
   - `title: string`
   - `done: boolean`
   - `titleSuffix?: React.ReactNode`
   - `details?: React.ReactNode`
   - `titleTooltip?: string`
   - `readOnly: boolean`
   - `isDragging?: boolean`
   - `dropPosition?: TodoItemDropPosition`
   - `cursors?: TodoItemPresenceCursor[]`
   - `dragEnabled?: boolean`
   - `onDoneChange(done: boolean): void`
   - `onTitleCommit(title: string): void`
   - `onDelete(): void`
   - `onDragStart?(id: string, event: ReactPointerEvent<HTMLElement>): void`
   - `registerRow?(id: string, element: HTMLLIElement | null): void`
   - optional `extraActions?: React.ReactNode` for version-specific controls.
5. Let the view own local `editingTitle` state.
6. Preserve existing edit behavior:
   - `Edit` sets the draft to the current title.
   - blur commits;
   - Enter blurs;
   - Escape cancels;
   - whitespace-only titles do not call through, or wrappers no-op them consistently.
7. Preserve drag behavior:
   - show drag handle only when not editing and `dragEnabled` is true;
   - use spacer when editing or drag is disabled;
   - call `onDragStart(id, event)` when the handle starts.
8. Render `titleSuffix`, `details`, and `extraActions` without coupling to v1/v3 types.

Then rewrite the existing internal `TodoItem` wrapper or inline its adapter logic into `TodoItemSlot`:

1. Keep `TodoItemSlot` exported and memoized.
2. Keep `useValue(path)` subscription by row.
3. Keep `useDropPosition(...)`.
4. Keep presence and CRDT blame logic in the wrapper.
5. Normalize cursors before passing to the view:
   - include actor key;
   - include color;
   - include nickname;
   - include `initialForNickname(...)` result.
6. Implement wrapper callbacks with the v2 path:
   - done: `path.done(next)`
   - title: trim/no-op if empty, read-only, or unchanged, then `path.title(next)`
   - delete: `path.$remove()`
7. Pass `dragEnabled={!readOnly}` and existing drag props from `TodoList`.

Acceptance check:

- `TodoList` and `TodoPanel` behavior should be unchanged.
- Row subscription and drop-target subscription boundaries should stay intact.
- The presentational view should not import `umkehr`, `umkehr/react-crdt`, `AppEditorContext`, or todo model types.

## Phase 3: Make `TodoVersionApps` Use The Reusable Views

File: `examples/react-crdt/src/apps/todos/TodoVersionApps.tsx`

1. Update `todoV1App.renderPanel` and `todoV3App.renderPanel` to destructure `actor` and pass it into their panels.
2. Import:
   - `useState` if needed for version add wrappers;
   - `TodoAddFormView`;
   - `TodoItemView`.
3. Replace static duplicated `<li>` markup with version-specific item slots.

### v1 panel

1. In `TodoV1Panel`, keep existing header summary:
   - done count;
   - total count;
   - `legacyFilter` display.
2. Add a v1 add form above the list:
   - local draft state;
   - submit creates `{id: `${actor}-${crypto.randomUUID()}`, text: next, done: false, archived: false}`;
   - push through `editor.$.todos.$push(...)`;
   - clear draft after success.
3. Render list by stable ids:
   - subscribe to `todoIds` with `useValue(editor.$.todos, todos => todos.map(todo => todo.id))`;
   - map `id, index` to `TodoV1ItemSlot`.
4. `TodoV1ItemSlot` should:
   - subscribe with `useValue(path)`;
   - pass `todo.text` as `title`;
   - pass archived state as display and editable UI;
   - call `path.done(next)`;
   - call `path.text(next)` for title commits;
   - call `path.archived(next)` for archived changes;
   - call `path.$remove()` for delete.
5. Make archived editable through `extraActions`, likely a compact labeled checkbox using existing button/input styles as much as practical.
6. Preserve `readOnly` by disabling add, check, edit, archived toggle, and delete.

### v3 panel

1. In `TodoV3Panel`, keep existing header summary:
   - done count;
   - total count;
   - `view` display.
2. Add a v3 add form above the list:
   - local draft state;
   - submit creates `{id: `${actor}-${crypto.randomUUID()}`, title: next, done: false, priority: 'normal', notes: ''}`;
   - push through `editor.$.todos.$push(...)`;
   - clear draft after success.
3. Render list by stable ids and `TodoV3ItemSlot`.
4. `TodoV3ItemSlot` should:
   - subscribe with `useValue(path)`;
   - pass `todo.title` as `title`;
   - call `path.done(next)`;
   - call `path.title(next)`;
   - call `path.$remove()`;
   - expose priority editing;
   - expose notes editing.
5. Make priority editable through `extraActions`, likely a `<select>` with values `normal` and `high`.
6. Make notes editable through `details`, likely an input bound to `todo.notes`.
7. Preserve `readOnly` by disabling add, check, edit, priority, notes, and delete.

Acceptance check:

- `TodoVersionApps.tsx` should not duplicate the main row/form JSX.
- v1 should write only v1 fields.
- v3 should write only v3 fields.
- The version panels should not import or depend on the v2 `Todo` type.

## Phase 4: Styling Polish For New Version Controls

File: `examples/react-crdt/src/style.css`

1. Check whether existing layout handles `extraActions` and `details` cleanly.
2. Add minimal styles only if needed for:
   - archived checkbox control;
   - priority select;
   - notes input/details row.
3. Keep changes scoped to todo classes.
4. Avoid class renames that would affect current behavior.
5. Confirm small widths do not cause row controls to overlap.

Possible class names:

- `.todoDetails`
- `.todoExtraControl`
- `.todoNotesInput`
- `.todoPrioritySelect`

Acceptance check:

- Main v2 rows still look unchanged.
- v1/v3 controls fit inside the existing row layout at desktop and narrow widths.

## Phase 5: Verification

Run focused automated checks:

1. `pnpm --dir examples/react-crdt build`
2. If available and not too slow, `pnpm --dir examples/react-crdt test:e2e`

Manual smoke in the React CRDT example:

1. Main v2 todos:
   - add;
   - edit title;
   - check/uncheck;
   - delete;
   - drag reorder;
   - verify read-only still disables controls.
2. v1 todos:
   - add;
   - edit text;
   - check/uncheck;
   - toggle archived;
   - delete;
   - verify new rows do not include v2-only fields.
3. v3 todos:
   - add;
   - edit title;
   - check/uncheck;
   - change priority;
   - edit notes;
   - delete;
   - verify new rows include `priority: 'normal'` and `notes: ''`.
4. Confirm whitespace-only titles are ignored across all versions.

## Implementation Notes

- Prefer keeping all wrappers near the schemas they adapt. v2 wrappers stay in `TodoItem.tsx` and `TodoAddForm.tsx`; v1/v3 wrappers can live in `TodoVersionApps.tsx` unless the file gets too large.
- Keep view component names explicit: `TodoItemView` and `TodoAddFormView`.
- Keep editor writes out of the view components. The views can own transient UI state only.
- Use `actor` from `AppPanelProps` for version-panel id prefixes. No shared app contract change should be needed.
- Preserve memoization and subscription boundaries where they already exist.
