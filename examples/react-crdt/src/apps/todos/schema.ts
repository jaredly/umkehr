import {hlc} from 'umkehr/crdt';
import {
    todoFixtureInitialV1,
    todoFixtureV2Metadata,
    todoFixtureV2Schema,
    type TodoFixtureStateV2,
    type TodoFixtureV2,
} from '../../../../migration-fixtures/todos';

export type Todo = TodoFixtureV2;
export type TodoState = TodoFixtureStateV2;

export const TODO_DOC_ID = 'umkehr-react-crdt-todos-v2';
export const todoSchema = todoFixtureV2Schema;
export const validateTodoState = todoFixtureV2Metadata.validateState;

export const initialTodoState: TodoState = {
    bgcolor: todoFixtureInitialV1.bgcolor,
    todos: todoFixtureInitialV1.todos
        .filter((todo) => !todo.archived)
        .map((todo) => ({
            id: todo.id,
            title: todo.text,
            done: todo.done,
            priority: 'normal',
        })),
};

export const initialTodoTimestamp = hlc.pack(hlc.init('seed', 0));
