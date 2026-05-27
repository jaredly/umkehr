import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    TODO_DOC_ID,
    ProvideTodoHistory,
    ProvideTodos,
    initialTodoState,
    initialTodoTimestamp,
    useTodoHistory,
    todoSchema,
    useTodos,
    validateTodoState,
    type TodoState,
} from './model';
import {TodoPanel} from './TodoPanel';

export const todoApp: AppDefinition<TodoState> = {
    id: 'todos',
    title: 'Todos',
    schemaVersion: 1,
    tagKey: 'type',
    schema: todoSchema,
    validateState: validateTodoState,
    initialState: initialTodoState,
    initialTimestamp: initialTodoTimestamp,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <TodoPanel
                editor={editor}
                replicaId={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const todoCrdtRuntime: CrdtRuntime<TodoState> = {
    docId: TODO_DOC_ID,
    Provider: ProvideTodos,
    useEditorContext: useTodos,
};

export const todoHistoryRuntime: HistoryRuntime<TodoState> = {
    Provider: ProvideTodoHistory,
    useEditorContext: useTodoHistory,
};
