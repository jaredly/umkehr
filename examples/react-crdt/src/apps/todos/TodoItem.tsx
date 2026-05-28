import React, {useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent} from 'react';
import {useValue, type Updater} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {AppEditorContext, CrdtEditorContext} from '../../lib/crdtApp';
import {initialForNickname, lastEditStatusKind} from '../../lib/server/presence';
import type {ServerLastEditStatusData} from '../../lib/server/types';
import type {ExternalStore} from '../../lib/store';
import {formatTodoTitleBlame, titleBlameForTodoMeta} from './blame';
import type {Todo, TodoState} from './model';
import type {TodoDropTarget} from './useTodoReorder';

export const TodoItemSlot = React.memo(function TodoItemSlot({
    editor,
    path,
    isDragging,
    dropTargetStore,
    onDragStart,
    registerRow,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    path: Updater<Todo>;
    isDragging: boolean;
    dropTargetStore: ExternalStore<TodoDropTarget | null>;
    onDragStart(id: string, event: ReactPointerEvent<HTMLElement>): void;
    registerRow(id: string, element: HTMLLIElement | null): void;
    readOnly: boolean;
}) {
    const todo = useValue(path) as Todo | undefined;
    const dropPosition = useDropPosition(dropTargetStore, todo?.id);
    if (!todo) return null;
    return (
        <TodoItem
            editor={editor}
            todo={todo}
            path={path}
            isDragging={isDragging}
            dropPosition={dropPosition}
            onDragStart={onDragStart}
            registerRow={registerRow}
            readOnly={readOnly}
        />
    );
});

function useDropPosition(store: ExternalStore<TodoDropTarget | null>, id?: string) {
    return useSyncExternalStore(
        store.subscribe,
        () => {
            const target = store.getSnapshot();
            if (!target || target.id !== id) return null;
            return target.after ? 'after' : 'before';
        },
        () => null,
    );
}

function TodoItem({
    editor,
    todo,
    path,
    isDragging,
    dropPosition,
    onDragStart,
    registerRow,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    path: Updater<Todo>;
    todo: Todo;
    isDragging: boolean;
    dropPosition: 'before' | 'after' | null;
    onDragStart(id: string, event: ReactPointerEvent<HTMLElement>): void;
    registerRow(id: string, element: HTMLLIElement | null): void;
    readOnly: boolean;
}) {
    const [editingTitle, setEditingTitle] = useState<null | string>(null);
    const presenceStatuses = useStatuses(path, {
        kinds: [lastEditStatusKind],
    });
    const titleMeta = hasPathScopedCrdtMeta(editor) ? editor.useCrdtMeta(path.title) : null;
    const titleBlame = titleBlameForTodoMeta(titleMeta ?? undefined);
    const titleTooltip = formatTodoTitleBlame(titleBlame);
    const cursors = presenceStatuses.map((status) => status.data).filter(isLastEditStatusData);

    const commit = () => {
        if (editingTitle === null) return;
        const next = editingTitle.trim();
        setEditingTitle(null);
        if (readOnly || !next || next === todo.title) {
            return;
        }
        path.title(next);
    };

    const className = [
        'todoItem',
        todo.done ? 'done' : '',
        isDragging ? 'dragging' : '',
        dropPosition === 'before' ? 'dropBefore' : '',
        dropPosition === 'after' ? 'dropAfter' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <li
            ref={(element) => registerRow(todo.id, element)}
            className={className}
            title={titleTooltip}
        >
            {editingTitle === null ? (
                <button
                    type="button"
                    className="dragHandle"
                    aria-label={`Move ${todo.title}`}
                    title="Move"
                    onPointerDown={(event) => onDragStart(todo.id, event)}
                    disabled={readOnly}
                >
                    <span aria-hidden="true">::</span>
                </button>
            ) : (
                <span className="dragHandleSpacer" aria-hidden="true" />
            )}
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => path.done(event.target.checked)}
                    disabled={readOnly}
                />
                {editingTitle !== null ? (
                    <input
                        className="titleInput"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                                setEditingTitle(null);
                            }
                        }}
                        autoFocus
                        disabled={readOnly}
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            <div className="itemActions">
                {cursors.length ? (
                    <div className="presenceCursorStack" aria-label="Recent editors">
                        {cursors.map((cursor) => (
                            <span
                                key={cursor.actor}
                                className="presenceCursor"
                                style={{backgroundColor: cursor.color}}
                                title={`${cursor.nickname} edited this todo`}
                            >
                                {initialForNickname(cursor.nickname)}
                            </span>
                        ))}
                    </div>
                ) : null}
                <button
                    type="button"
                    onClick={() => setEditingTitle(todo.title)}
                    disabled={readOnly}
                >
                    Edit
                </button>
                <button type="button" onClick={() => path.$remove()} disabled={readOnly}>
                    Delete
                </button>
            </div>
        </li>
    );
}

function hasPathScopedCrdtMeta(
    editor: AppEditorContext<TodoState>,
): editor is CrdtEditorContext<TodoState, 'type', never> {
    return 'useCrdtMeta' in editor && typeof editor.useCrdtMeta === 'function';
}

function isLastEditStatusData(value: unknown): value is ServerLastEditStatusData {
    return (
        typeof value === 'object' &&
        value !== null &&
        'actor' in value &&
        'userId' in value &&
        'sessionId' in value &&
        'nickname' in value &&
        'color' in value &&
        'timestamp' in value &&
        'receivedAt' in value
    );
}
