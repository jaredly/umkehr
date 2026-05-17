import typia from 'typia';
import {hlc} from 'umkehr/crdt';
import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type TodoState = {
    todos: Todo[];
};

export const TODO_DOC_ID = 'umkehr-react-crdt-todos-v1';
export const todoSchema = typia.json.schemas<[TodoState], '3.1'>();
export const validateTodoState = typia.createValidate<TodoState>();
export const [ProvideTodoHistory, useTodoHistory] = createHistoryContext<TodoState, never, 'type'>(
    'type',
);
export const [ProvideTodos, useTodos] = createSyncedContext<TodoState>('type');

export const initialTodoState: TodoState = {
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Try CRDT sync', done: false},
    ],
};

export const initialTodoTimestamp = hlc.pack(hlc.init('seed', 0));
