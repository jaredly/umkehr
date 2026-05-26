import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {Updater, useValue} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {
    AppEditorContext,
    CrdtEditorContext,
    GridSlot,
    HistoryEditorContext,
} from '../../lib/crdtApp';
import {initialForNickname, lastEditStatusKind} from '../../lib/server/presence';
import type {ServerLastEditStatusData} from '../../lib/server/types';
import {createExternalStore, type ExternalStore} from '../../lib/store';
import {formatTodoTitleBlame, titleBlameForTodoMeta} from './blame';
import type {Todo, TodoState} from './model';
import React from 'react';

const pastelColors = ['#fff', '#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;
const reorderAnimationMs = 180;

type DropTarget = {id: string; after: boolean};

function isNoopMove(fromIdx: number, targetIdx: number, after: boolean) {
    return (
        fromIdx === targetIdx ||
        (!after && targetIdx === fromIdx + 1) ||
        (after && targetIdx === fromIdx - 1)
    );
}

export function TodoPanel({
    editor,
    replicaId,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoState>;
    replicaId: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const todoIds = useValue(editor.$.todos, (todos) => todos.map((todo) => todo.id));
    const [draftTitle, setDraftTitle] = useState('');
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const dropTargetStore = useMemo(() => createExternalStore<DropTarget | null>(null), []);
    const rowRefs = useRef(new Map<string, HTMLLIElement>());
    const previousRects = useRef(new Map<string, DOMRect>());
    const latestTodos = useRef(editor.latest().todos);
    const draggingIdRef = useRef<string | null>(null);
    const dropTargetRef = useRef<DropTarget | null>(null);

    latestTodos.current = editor.latest().todos;

    useEffect(() => {
        draggingIdRef.current = draggingId;
    }, [draggingId]);

    const registerRow = useCallback((id: string, element: HTMLLIElement | null) => {
        if (element) {
            rowRefs.current.set(id, element);
        } else {
            rowRefs.current.delete(id);
        }
    }, []);

    const clearDrag = useCallback(() => {
        draggingIdRef.current = null;
        dropTargetRef.current = null;
        setDraggingId(null);
        dropTargetStore.setSnapshot(null);
    }, [dropTargetStore]);

    const findDropTarget = useCallback((clientY: number): DropTarget | null => {
        const rows = latestTodos.current
            .map((todo) => {
                const element = rowRefs.current.get(todo.id);
                return element ? {id: todo.id, rect: element.getBoundingClientRect()} : null;
            })
            .filter((row) => row !== null);

        if (!rows.length) return null;

        const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
        if (containing) {
            return {
                id: containing.id,
                after: clientY > containing.rect.top + containing.rect.height / 2,
            };
        }

        const nextRow = rows.find(({rect}) => clientY < rect.top);
        if (nextRow) return {id: nextRow.id, after: false};
        return {id: rows[rows.length - 1].id, after: true};
    }, []);

    useEffect(() => {
        if (!draggingId) return;

        const onPointerMove = (event: PointerEvent) => {
            if (readOnly) return;
            event.preventDefault();
            const nextTarget = findDropTarget(event.clientY);
            dropTargetRef.current = nextTarget;
            setDropTarget(dropTargetStore, nextTarget);
        };

        const onPointerUp = (event: PointerEvent) => {
            event.preventDefault();
            const draggedId = draggingIdRef.current;
            const target = findDropTarget(event.clientY) ?? dropTargetRef.current;
            clearDrag();
            if (readOnly) return;
            if (!draggedId || !target) return;

            const currentTodos = latestTodos.current;
            const fromIdx = currentTodos.findIndex((todo) => todo.id === draggedId);
            const targetIdx = currentTodos.findIndex((todo) => todo.id === target.id);
            if (fromIdx < 0 || targetIdx < 0 || isNoopMove(fromIdx, targetIdx, target.after)) {
                return;
            }
            editor.$.todos.$move({fromIdx, targetIdx, after: target.after});
        };

        const onPointerCancel = () => clearDrag();

        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [clearDrag, draggingId, editor, findDropTarget, readOnly]);

    useLayoutEffect(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const nextRects = new Map<string, DOMRect>();
        for (const id of todoIds) {
            const element = rowRefs.current.get(id);
            if (element) nextRects.set(id, element.getBoundingClientRect());
        }

        if (!reduceMotion) {
            for (const [id, next] of nextRects) {
                const previous = previousRects.current.get(id);
                const element = rowRefs.current.get(id);
                if (!previous || !element) continue;
                const deltaY = previous.top - next.top;
                if (Math.abs(deltaY) < 1) continue;
                element.animate(
                    [{transform: `translateY(${deltaY}px)`}, {transform: 'translateY(0)'}],
                    {
                        duration: reorderAnimationMs,
                        easing: 'cubic-bezier(0.2, 0, 0, 1)',
                    },
                );
            }
        }

        previousRects.current = nextRects;
    }, [todoIds]);

    const startDrag = useCallback(
        (id: string, event: ReactPointerEvent<HTMLElement>) => {
            if (readOnly) return;
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const initialTarget = {id, after: false};
            draggingIdRef.current = id;
            dropTargetRef.current = initialTarget;
            setDraggingId(id);
            setDropTarget(dropTargetStore, initialTarget);
        },
        [dropTargetStore, readOnly],
    );

    return (
        <section
            className={`todoPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <TodoSummary editor={editor} />
                </div>
                <div className="panelActions">
                    <UndoRedoButtons editor={editor} readOnly={readOnly} />
                </div>
            </header>

            <section
                className="colorPicker"
                aria-label="Task background color"
                onMouseLeave={() => editor.clearPreview()}
            >
                {pastelColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        className={color === bgcolor ? 'swatch selected' : 'swatch'}
                        style={{backgroundColor: color}}
                        title={color}
                        aria-label={`Use ${color}`}
                        onClick={() => editor.$.bgcolor(color)}
                        onMouseEnter={() => {
                            if (!readOnly) editor.$.bgcolor(color, 'preview');
                        }}
                        disabled={readOnly}
                    />
                ))}
            </section>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftTitle.trim();
                    if (readOnly || !next) return;
                    editor.$.todos.$push({
                        id: `${replicaId}-${crypto.randomUUID()}`,
                        title: next,
                        done: false,
                    });
                    setDraftTitle('');
                }}
            >
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    disabled={readOnly}
                />
                <button type="submit" disabled={readOnly}>
                    Add
                </button>
            </form>

            <ul
                className={draggingId ? 'todoList draggingList' : 'todoList'}
                style={{'--task-bg': bgcolor} as CSSProperties}
            >
                {todoIds.map((id, index) => (
                    <TodoItemSlot
                        key={id}
                        editor={editor}
                        path={editor.$.todos[index]}
                        isDragging={draggingId === id}
                        dropTargetStore={dropTargetStore}
                        onDragStart={startDrag}
                        registerRow={registerRow}
                        readOnly={readOnly}
                    />
                ))}
            </ul>
        </section>
    );
}

function setDropTarget(store: ExternalStore<DropTarget | null>, next: DropTarget | null) {
    const current = store.getSnapshot();
    if (current?.id === next?.id && current?.after === next?.after) return;
    store.setSnapshot(next);
}

function UndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    readOnly: boolean;
}) {
    if (hasCrdtHistory(editor)) {
        return <CrdtUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    if (hasHistory(editor)) {
        return <HistoryUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    return null;
}

function CrdtUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: CrdtEditorContext<TodoState, 'type', never>;
    readOnly: boolean;
}) {
    editor.useLocalHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function HistoryUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState> & HistoryEditorContext<TodoState>;
    readOnly: boolean;
}) {
    editor.useHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function UndoRedoButtonPair({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    readOnly: boolean;
}) {
    return (
        <>
            <button
                type="button"
                onClick={() => editor.undo()}
                disabled={readOnly || !editor.canUndo()}
            >
                Undo
            </button>
            <button
                type="button"
                onClick={() => editor.redo()}
                disabled={readOnly || !editor.canRedo()}
            >
                Redo
            </button>
        </>
    );
}

function TodoSummary({editor}: {editor: AppEditorContext<TodoState>}) {
    const summary = useValue(editor.$.todos, (todos) => ({
        completed: todos.filter((todo) => todo.done).length,
        total: todos.length,
    }));
    return (
        <p>
            {summary.completed}/{summary.total} done
        </p>
    );
}

const TodoItemSlot = React.memo(function TodoItemSlot({
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
    dropTargetStore: ExternalStore<DropTarget | null>;
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

function useDropPosition(store: ExternalStore<DropTarget | null>, id?: string) {
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

function hasCrdtHistory(
    editor: AppEditorContext<TodoState>,
): editor is CrdtEditorContext<TodoState, 'type', never> {
    return 'useLocalHistory' in editor && typeof editor.useLocalHistory === 'function';
}

function hasHistory(
    editor: AppEditorContext<TodoState>,
): editor is AppEditorContext<TodoState> & HistoryEditorContext<TodoState> {
    return 'useHistory' in editor && typeof editor.useHistory === 'function';
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
