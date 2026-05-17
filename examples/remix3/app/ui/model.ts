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
