import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
export {
    TODO_DOC_ID,
    initialTodoState,
    initialTodoTimestamp,
    todoSchema,
    validateTodoState,
    type Todo,
    type TodoState,
} from './schema';
import type {TodoState} from './schema';

export const [ProvideTodoHistory, useTodoHistory] = createHistoryContext<TodoState, never, 'type'>(
    'type',
);
export const [ProvideTodos, useTodos] = createSyncedContext<TodoState>('type');
