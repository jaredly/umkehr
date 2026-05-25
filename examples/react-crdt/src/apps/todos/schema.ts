import typia from 'typia';
import {hlc} from 'umkehr/crdt';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type TodoState = {
    bgcolor: string;
    todos: Todo[];
};

export const TODO_DOC_ID = 'umkehr-react-crdt-todos-v1';
export const todoSchema = typia.json.schemas<[TodoState], '3.1'>();
export const validateTodoState = typia.createValidate<TodoState>();

export const initialTodoState: TodoState = {
    bgcolor: '#fff',
    todos: [
        {id: 'one', title: '1. Write README', done: true},
        {id: 'two', title: '2. Try CRDT sync', done: false},
        {id: 'three', title: '3. A secret third thing', done: false},
        {id: 'four', title: '4. horses', done: false},
    ],
};

export const initialTodoTimestamp = hlc.pack(hlc.init('seed', 0));
