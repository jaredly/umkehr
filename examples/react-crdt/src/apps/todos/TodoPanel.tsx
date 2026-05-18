import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {useValue} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {initialForNickname, lastEditStatusKind} from '../../lib/server/presence';
import type {ServerLastEditStatusData} from '../../lib/server/types';
import {formatTodoTitleBlame, titleBlameForTodo} from './blame';
import type {Todo, TodoState} from './model';

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
}: {
    editor: AppEditorContext<TodoState>;
    replicaId: string;
    title: string;
    gridSlot?: GridSlot | 'full';
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const todos = useValue(editor.$.todos);
    const [draftTitle, setDraftTitle] = useState('');
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const rowRefs = useRef(new Map<string, HTMLLIElement>());
    const previousRects = useRef(new Map<string, DOMRect>());
    const latestTodos = useRef(todos);
    const draggingIdRef = useRef<string | null>(null);
    const dropTargetRef = useRef<DropTarget | null>(null);
    const completed = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);

    latestTodos.current = todos;

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
        setDropTarget(null);
    }, []);

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
            event.preventDefault();
            const nextTarget = findDropTarget(event.clientY);
            dropTargetRef.current = nextTarget;
            setDropTarget((current) =>
                current?.id === nextTarget?.id && current?.after === nextTarget?.after
                    ? current
                    : nextTarget,
            );
        };

        const onPointerUp = (event: PointerEvent) => {
            event.preventDefault();
            const draggedId = draggingIdRef.current;
            const target = findDropTarget(event.clientY) ?? dropTargetRef.current;
            clearDrag();
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
    }, [clearDrag, draggingId, editor, findDropTarget]);

    useLayoutEffect(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const nextRects = new Map<string, DOMRect>();
        for (const todo of todos) {
            const element = rowRefs.current.get(todo.id);
            if (element) nextRects.set(todo.id, element.getBoundingClientRect());
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
    }, [todos]);

    const startDrag = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const initialTarget = {id, after: false};
        draggingIdRef.current = id;
        dropTargetRef.current = initialTarget;
        setDraggingId(id);
        setDropTarget(initialTarget);
    }, []);

    return (
        <section
            className={`todoPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {completed}/{todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button
                        type="button"
                        onClick={() => editor.undo()}
                        disabled={!editor.canUndo()}
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        onClick={() => editor.redo()}
                        disabled={!editor.canRedo()}
                    >
                        Redo
                    </button>
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
                        onMouseEnter={() => editor.$.bgcolor(color, 'preview')}
                    />
                ))}
            </section>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftTitle.trim();
                    if (!next) return;
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
                />
                <button type="submit">Add</button>
            </form>

            <ul
                className={draggingId ? 'todoList draggingList' : 'todoList'}
                style={{'--task-bg': bgcolor} as CSSProperties}
            >
                {todos.map((todo, index) => (
                    <TodoItem
                        key={todo.id}
                        editor={editor}
                        todo={todo}
                        index={index}
                        isDragging={draggingId === todo.id}
                        dropPosition={
                            dropTarget?.id === todo.id
                                ? dropTarget.after
                                    ? 'after'
                                    : 'before'
                                : null
                        }
                        onDragStart={startDrag}
                        registerRow={registerRow}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    editor,
    todo,
    index,
    isDragging,
    dropPosition,
    onDragStart,
    registerRow,
}: {
    editor: AppEditorContext<TodoState>;
    todo: Todo;
    index: number;
    isDragging: boolean;
    dropPosition: 'before' | 'after' | null;
    onDragStart(id: string, event: ReactPointerEvent<HTMLElement>): void;
    registerRow(id: string, element: HTMLLIElement | null): void;
}) {
    const [editingTitle, setEditingTitle] = useState<null | string>(null);
    const presenceStatuses = useStatuses(editor.$.todos[index], {
        kinds: [lastEditStatusKind],
    });
    const crdtHistory =
        'useLocalHistory' in editor && typeof editor.useLocalHistory === 'function'
            ? editor.useLocalHistory()
            : null;
    const titleBlame = crdtHistory ? titleBlameForTodo(crdtHistory, index) : null;
    const titleTooltip = formatTodoTitleBlame(titleBlame);
    const cursors = presenceStatuses
        .map((status) => status.data)
        .filter(isLastEditStatusData);

    const commit = () => {
        if (editingTitle === null) return;
        const next = editingTitle.trim();
        setEditingTitle(null);
        if (!next || next === todo.title) {
            return;
        }
        editor.$.todos[index].title(next);
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
                    onChange={(event) => editor.$.todos[index].done(event.target.checked)}
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
                <button type="button" onClick={() => setEditingTitle(todo.title)}>
                    Edit
                </button>
                <button type="button" onClick={() => editor.$.todos[index].$remove()}>
                    Delete
                </button>
            </div>
        </li>
    );
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
