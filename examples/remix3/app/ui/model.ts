import type {IJsonSchemaCollection} from 'typia';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type State = {
    bgcolor: string;
    todos: Todo[];
};

export const pastelColors = ['#fff', '#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;

export const initialState: State = {
    bgcolor: pastelColors[0],
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Add examples', done: false},
    ],
};

export const stateSchema = {
    version: '3.1',
    schemas: [{$ref: '#/components/schemas/State'}],
    components: {
        schemas: {
            State: {
                type: 'object',
                required: ['bgcolor', 'todos'],
                properties: {
                    bgcolor: {type: 'string'},
                    todos: {$ref: '#/components/schemas/Todos'},
                },
            },
            Todos: {
                type: 'array',
                items: {$ref: '#/components/schemas/Todo'},
            },
            Todo: {
                type: 'object',
                required: ['id', 'title', 'done'],
                properties: {
                    id: {type: 'string'},
                    title: {type: 'string'},
                    done: {type: 'boolean'},
                },
            },
        },
    },
} satisfies IJsonSchemaCollection<'3.1', [State]>;
