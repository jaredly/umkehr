# Todo Reuse Research

## Task

Refactor `TodoItem` and `TodoAddForm` so each has:

- an inner JSX-only component that knows nothing about editor context, umkehr `Updater`s, CRDT/presence APIs, or concrete `Todo` fixture types;
- a wrapper component that owns the editor/type-specific behavior and feeds plain props to the inner component.

The immediate reason is reuse in `TodoVersionApps.tsx`, where the v1 and v3 migration fixture panels currently render static todo list markup directly. After the split, those panels can use the same inner row/form UI and become interactive.

## Current Shape

Relevant files:

- `examples/react-crdt/src/apps/todos/TodoItem.tsx`
- `examples/react-crdt/src/apps/todos/TodoAddForm.tsx`
- `examples/react-crdt/src/apps/todos/TodoList.tsx`
- `examples/react-crdt/src/apps/todos/TodoPanel.tsx`
- `examples/react-crdt/src/apps/todos/TodoVersionApps.tsx`
- `examples/migration-fixtures/todos.ts`

`TodoAddForm` is currently both stateful UI and editor adapter:

- owns `draftTitle`;
- trims the submitted title;
- creates a v2 todo with `id`, `title`, `done: false`, and `priority: 'normal'`;
- writes through `editor.$.todos.$push(...)`;
- clears the draft after a successful submit.

`TodoItem.tsx` currently has two layers, but the inner `TodoItem` is still type/editor aware:

- `TodoItemSlot` subscribes to one row by `Updater<Todo>` path and isolates drop-target subscriptions.
- `TodoItem` renders the row, owns inline title editing state, computes CSS classes, reads presence statuses, reads CRDT title metadata, formats title blame, writes through `path.title(...)`, `path.done(...)`, and `path.$remove()`, and registers row DOM nodes for drag/reorder.

`TodoVersionApps.tsx` currently duplicates a subset of row markup for fixture versions:

- v1 rows use `todo.text` and can show ` (archived)`.
- v3 rows use `todo.title`, show `[priority]`, and show `notes` in the actions area.
- both versions render checkbox inputs as read-only, and there is no add/edit/delete behavior in the version panels today.

## Fixture Differences

The active todo app uses the v2 fixture shape:

```ts
type TodoFixtureV2 = {
    id: string;
    title: string;
    done: boolean;
    priority: 'normal' | 'high';
};
```

The version demo panels use:

- v1: `{id, text, done, archived?}` plus state fields `bgcolor` and `legacyFilter?`;
- v3: `{id, title, done, priority, notes}` plus state fields `bgcolor` and `view`.

Because these shapes differ, the reusable inner item should not take a `todo` object. It should take display and behavior props such as `id`, `title`, `done`, `titleSuffix`, `details`, `readOnly`, and callbacks. Each wrapper can map its own schema into that shape.

## Recommended Component Split

### TodoAddForm

Create an exported presentational form, for example:

```ts
export function TodoAddFormView({
    draftTitle,
    placeholder = 'New todo',
    readOnly,
    onDraftTitleChange,
    onSubmit,
}: {
    draftTitle: string;
    placeholder?: string;
    readOnly: boolean;
    onDraftTitleChange(value: string): void;
    onSubmit(): void;
}) {
    // JSX only: form/input/button/classes, preventDefault, callback dispatch.
}
```

Keep `TodoAddForm` as the v2 wrapper:

- owns `draftTitle`;
- trims before submit;
- creates the v2 todo payload with replica-prefixed `crypto.randomUUID()`;
- pushes through `editor.$.todos.$push(...)`;
- clears the draft only after a non-empty, non-read-only submit.

For version panels, add small local wrappers in `TodoVersionApps.tsx` or near `TodoAddForm.tsx` that reuse `TodoAddFormView` but create the correct fixture row:

- v1 submit should probably create `{id, text, done: false}` and maybe `archived: false`;
- v3 submit should create `{id, title, done: false, priority: 'normal', notes: ''}`.

### TodoItem

Create an exported presentational item, for example:

```ts
export type TodoItemPresenceCursor = {
    actor: string;
    nickname: string;
    color: string;
    initial: string;
};

export function TodoItemView({
    id,
    title,
    done,
    titleSuffix,
    details,
    titleTooltip,
    readOnly,
    isDragging,
    dropPosition,
    cursors,
    dragEnabled,
    onDoneChange,
    onTitleCommit,
    onDelete,
    onDragStart,
    registerRow,
}: {
    // Plain primitives, JSX content, and callbacks only.
}) {
    // JSX/local edit state only; no editor context, no Todo type, no Updater.
}
```

The view can still own UI-only inline editing state (`editingTitle`) because that state is independent of umkehr and fixture schema. It should call `onTitleCommit(nextTitle)` after trimming/validation rules that are purely UI-level. Schema/editor wrappers should remain responsible for deciding whether to write.

Keep `TodoItemSlot` as the v2 controlled wrapper:

- subscribe with `useValue(path)`;
- compute row-specific drop position with `useDropPosition(...)`;
- compute presence cursors with `useStatuses(path, {kinds: [lastEditStatusKind]})`;
- compute title blame from `editor.useCrdtMeta(path.title)` when available;
- pass `todo.id`, `todo.title`, `todo.done`, drag/read-only state, and callbacks into `TodoItemView`;
- implement callbacks with `path.done(...)`, `path.title(...)`, and `path.$remove()`.

This preserves the important subscription boundary from the existing `TodoItemSlot`: only each row subscribes to its path, and drop-target changes should not rerender the whole list.

## Reusing In TodoVersionApps

`TodoVersionApps.tsx` can become interactive without importing v2 `Todo` types by creating version-specific row wrappers:

- `TodoV1ItemSlot` subscribes to `editor.$.todos[index]`, maps `text` to `title`, maps `archived` to a suffix/details display, and writes `path.done(...)`, `path.text(...)`, and `path.$remove()`.
- `TodoV3ItemSlot` subscribes to `editor.$.todos[index]`, maps `title`, `priority`, and `notes` to display props, and writes `path.done(...)`, `path.title(...)`, and `path.$remove()`.
- Both panels can map stable ids to slots in the same style as `TodoList`, though they do not need drag/reorder unless desired.
- Both panels can use `TodoAddFormView` through version-specific add wrappers.

The version panels do not currently include `replicaId` in `renderPanel(...)`. If new rows need replica-prefixed ids like the main v2 todo app, `AppDefinition.renderPanel` callers may need to pass `replicaId`, or the version panels need a different id strategy.

## Styling Impact

Existing CSS classes are already shared enough for the inner components:

- `.addForm`
- `.todoList`
- `.todoItem`
- `.todoItem.done`
- `.todoItem.dragging`
- `.todoItem.dropBefore`
- `.todoItem.dropAfter`
- `.dragHandle`
- `.dragHandleSpacer`
- `.todoTitle`
- `.titleInput`
- `.itemActions`
- `.presenceCursorStack`
- `.presenceCursor`
- `.presenceEmpty`

The refactor should keep these class names stable. The presentational components can accept optional `titleSuffix`/`details` JSX so version-specific metadata can be displayed without new row markup duplication.

## Testing Notes

Recommended checks after implementation:

- `pnpm --dir examples/react-crdt build`
- `pnpm --dir examples/react-crdt test:e2e` if the version panels are made interactive in browser-visible flows.
- Root or package test commands if TypeScript/build scripts are not enough for component coverage.

Manual smoke checks:

- Main v2 todo app: add, edit, check, delete, drag reorder, title blame tooltip, and recent editor cursors still work.
- Read-only mode disables add/edit/delete/check/drag in both main and version panels.
- v1 version panel can check/uncheck, edit text, delete, and add rows without writing v2-only fields.
- v3 version panel can check/uncheck, edit title, delete, and add rows while preserving `priority` and `notes` defaults.
- Empty or whitespace-only titles are not committed.
- Editing still hides the drag handle and Escape cancels the edit.

## Risks

- Passing `todo` objects into the inner view would make it reusable in name only; the view should stay schema-neutral.
- Moving presence/blame into the view would couple the JSX layer back to CRDT concepts and block reuse in fixture panels.
- Flattening `TodoItemSlot` into parent list rendering could regress row subscription behavior and cause broad rerenders.
- Version fixture paths have different field names (`text` vs `title`), so generic callbacks should talk in UI terms (`onTitleCommit`) while wrappers map to schema fields.
- New row id generation for version panels needs a deliberate choice; unlike `TodoPanel`, `TodoVersionApps` is not currently passed `replicaId`.

## Open Questions

- Should `TodoVersionApps` support full row deletion and inline title editing, or only add/check behavior? The task says "fully interactive", which likely means add, edit, check, and delete.
  - yeah add/delete/check/edit would be great
- Should version panel add forms generate ids with the same `replicaId-randomUUID` convention as the main app? If yes, `renderPanel` needs access to `replicaId` or another stable actor/session id.
  - doesn't matter
- Should v1 rows expose archived state as editable, display-only, or omitted for newly added rows? Existing UI only displays archived rows with a suffix.
  - editable would be gret
- Should v3 rows expose `notes` and `priority` editing, or should the reused todo item only edit the title/done/delete fields and preserve/default the extra fields?
  - editable would be great
- Should the presentational `TodoItemView` own inline edit draft state, or should even that be lifted into wrappers? Keeping it in the view seems consistent with "JSX-only" as long as all persisted writes are callback-driven.
  - it can own it
