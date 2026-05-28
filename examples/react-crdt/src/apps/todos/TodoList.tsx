import {
    useCallback,
    useLayoutEffect,
    useRef,
    type CSSProperties,
} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext} from '../../lib/crdtApp';
import {TodoItemSlot} from './TodoItem';
import type {TodoState} from './model';
import {useTodoReorder} from './useTodoReorder';

const reorderAnimationMs = 180;

export function TodoList({
    editor,
    bgcolor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    bgcolor: string;
    readOnly: boolean;
}) {
    const todoIds = useValue(editor.$.todos, (todos) => todos.map((todo) => todo.id));
    const previousRects = useRef(new Map<string, DOMRect>());
    const todos = editor.latest().todos;
    const moveTodo = useCallback(
        ({fromIdx, targetIdx, after}: {fromIdx: number; targetIdx: number; after: boolean}) => {
            editor.$.todos.$move({fromIdx, targetIdx, after});
        },
        [editor],
    );
    const {draggingId, dropTargetStore, getRowElement, registerRow, startDrag} = useTodoReorder({
        todos,
        disabled: readOnly,
        onMove: moveTodo,
    });

    useLayoutEffect(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const nextRects = new Map<string, DOMRect>();
        for (const id of todoIds) {
            const element = getRowElement(id);
            if (element) nextRects.set(id, element.getBoundingClientRect());
        }

        if (!reduceMotion) {
            for (const [id, next] of nextRects) {
                const previous = previousRects.current.get(id);
                const element = getRowElement(id);
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
    }, [getRowElement, todoIds]);

    return (
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
    );
}
