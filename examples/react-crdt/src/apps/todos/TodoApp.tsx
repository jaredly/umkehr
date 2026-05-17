import type {CrdtAppDefinition} from '../../lib/crdtApp';
import {
    TODO_DOC_ID,
    ProvideTodos,
    createTodoInitialHistory,
    todoSchema,
    useTodos,
    validateTodoState,
    type TodoState,
} from './model';
import {TodoPanel} from './TodoPanel';

export const todoApp: CrdtAppDefinition<TodoState> = {
    id: 'todos',
    title: 'Todos',
    docId: TODO_DOC_ID,
    tagKey: 'type',
    schema: todoSchema,
    validateState: validateTodoState,
    createInitialHistory: createTodoInitialHistory,
    Provider: ProvideTodos,
    useSyncedContext: useTodos,
    renderPanel({actor, title, queued, gridSlot}) {
        return <TodoPanel replicaId={actor} title={title} queued={queued} gridSlot={gridSlot} />;
    },
};
