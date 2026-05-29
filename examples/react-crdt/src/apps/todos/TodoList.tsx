import {useCallback, type CSSProperties} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext} from '../../lib/crdtApp';
import {TodoItemSlot} from './TodoItem';
import type {TodoState} from './model';
import {useReorderAnimation} from './useReorderAnimation';
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

    useReorderAnimation({
        ids: todoIds,
        getElement: getRowElement,
        durationMs: reorderAnimationMs,
    });

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
