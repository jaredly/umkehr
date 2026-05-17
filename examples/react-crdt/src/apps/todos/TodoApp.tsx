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
    tagKey: 'type',
    schema: todoSchema,
    validateState: validateTodoState,
    initialState: initialTodoState,
    initialTimestamp: initialTodoTimestamp,
    renderPanel({editor, actor, title, gridSlot}) {
        return (
            <TodoPanel
                editor={editor}
                replicaId={actor}
                title={title}
                gridSlot={gridSlot}
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
