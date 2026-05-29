import React, {
    useState,
    useSyncExternalStore,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import {useValue, type Updater} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {AppEditorContext, CrdtEditorContext} from '../../lib/crdtApp';
import {initialForNickname, lastEditStatusKind} from '../../lib/server/presence';
import type {ServerLastEditStatusData} from '../../lib/server/types';
import type {ExternalStore} from '../../lib/store';
import {formatTodoTitleBlame, titleBlameForTodoMeta} from './blame';
import type {Todo, TodoState} from './model';
import type {TodoDropTarget} from './useTodoReorder';

export type TodoItemDropPosition = 'before' | 'after' | null;

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
    isDragging = false,
    dropPosition = null,
    cursors = [],
    dragEnabled = false,
    onDoneChange,
    onTitleCommit,
    onDelete,
    onDragStart,
    registerRow,
    extraActions,
}: {
    id: string;
    title: string;
    done: boolean;
    titleSuffix?: ReactNode;
    details?: ReactNode;
    titleTooltip?: string;
    readOnly: boolean;
    isDragging?: boolean;
    dropPosition?: TodoItemDropPosition;
    cursors?: TodoItemPresenceCursor[];
    dragEnabled?: boolean;
    onDoneChange(done: boolean): void;
    onTitleCommit(title: string): void;
    onDelete(): void;
    onDragStart?(id: string, event: ReactPointerEvent<HTMLElement>): void;
    registerRow?(id: string, element: HTMLLIElement | null): void;
    extraActions?: ReactNode;
}) {
    const [editingTitle, setEditingTitle] = useState<null | string>(null);

    const commit = () => {
        if (editingTitle === null) return;
        const next = editingTitle.trim();
        setEditingTitle(null);
        if (readOnly || !next || next === title) {
            return;
        }
        onTitleCommit(next);
    };

    const className = [
        'todoItem',
        done ? 'done' : '',
        isDragging ? 'dragging' : '',
        dropPosition === 'before' ? 'dropBefore' : '',
        dropPosition === 'after' ? 'dropAfter' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const showDragHandle = editingTitle === null && dragEnabled && onDragStart;

    return (
        <li
            ref={(element) => registerRow?.(id, element)}
            className={className}
            title={titleTooltip}
        >
            {showDragHandle ? (
                <button
                    type="button"
                    className="dragHandle"
                    aria-label={`Move ${title}`}
                    title="Move"
                    onPointerDown={(event) => onDragStart?.(id, event)}
                    disabled={readOnly}
                >
                    <span aria-hidden="true">::</span>
                </button>
            ) : (
                <span className="dragHandleSpacer" aria-hidden="true" />
            )}
            <div className="todoContent">
                <label>
                    <input
                        type="checkbox"
                        checked={done}
                        onChange={(event) => onDoneChange(event.target.checked)}
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
                        <span className="todoTitle">
                            {title}
                            {titleSuffix}
                        </span>
                    )}
                </label>
                {details ? <div className="todoDetails">{details}</div> : null}
            </div>
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
                                {cursor.initial}
                            </span>
                        ))}
                    </div>
                ) : null}
                {extraActions}
                <button
                    type="button"
                    onClick={() => setEditingTitle(title)}
                    disabled={readOnly}
                >
                    Edit
                </button>
                <button type="button" onClick={onDelete} disabled={readOnly}>
                    Delete
                </button>
            </div>
        </li>
    );
}

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
    const presenceStatuses = useStatuses(path, {
        kinds: [lastEditStatusKind],
    });
    const titleMeta = hasPathScopedCrdtMeta(editor) ? editor.useCrdtMeta(path.title) : null;
    const titleBlame = titleBlameForTodoMeta(titleMeta ?? undefined);
    const titleTooltip = formatTodoTitleBlame(titleBlame);
    const cursors = presenceStatuses
        .map((status) => status.data)
        .filter(isLastEditStatusData)
        .map((cursor) => ({
            actor: cursor.actor,
            nickname: cursor.nickname,
            color: cursor.color,
            initial: initialForNickname(cursor.nickname),
        }));

    return (
        <TodoItemView
            id={todo.id}
            title={todo.title}
            done={todo.done}
            titleTooltip={titleTooltip}
            readOnly={readOnly}
            isDragging={isDragging}
            dropPosition={dropPosition}
            cursors={cursors}
            dragEnabled={!readOnly}
            onDoneChange={(next) => {
                if (readOnly) return;
                path.done(next);
            }}
            onTitleCommit={(next) => {
                if (readOnly || next === todo.title) return;
                path.title(next);
            }}
            onDelete={() => {
                if (readOnly) return;
                path.$remove();
            }}
            onDragStart={onDragStart}
            registerRow={registerRow}
        />
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
