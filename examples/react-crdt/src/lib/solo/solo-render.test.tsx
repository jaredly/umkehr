import '../../../../../src/react/test-dom';

import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {blankHistory} from 'umkehr';
import {createHistoryContext, Updater, useValue} from 'umkehr/react';
import type {HistoryEditorContext} from '../crdtApp';
import {withDisabledEphemeral} from '../crdtApp';
import type {Todo, TodoState} from '../../apps/todos/model';
import {TodoPanel} from '../../apps/todos/TodoPanel';

afterEach(() => {
    cleanup();
});

describe('solo todo render subscriptions', () => {
    it('rerenders only the edited todo row when a title changes', () => {
        const renders = {
            list: 0,
            controls: 0,
            history: 0,
            rows: new Map<string, number>(),
        };
        const [Provider, useEditorContext] = createHistoryContext<TodoState, never, 'type'>(
            'type',
        );
        const initial = blankHistory<TodoState, never>({
            bgcolor: '#fff',
            todos: [
                {id: 'a', title: 'Alpha', done: false},
                {id: 'b', title: 'Bravo', done: false},
                {id: 'c', title: 'Charlie', done: false},
            ],
        });

        function TestApp() {
            const editor = useEditorContext();
            return (
                <>
                    <HistoryObserver editor={editor} renders={renders} />
                    <UnsubscribedControls renders={renders} />
                    <TodoRows editor={editor} renders={renders} />
                </>
            );
        }

        const view = render(
            <Provider initial={initial}>
                <TestApp />
            </Provider>,
        );

        expect(renders.list).toBe(1);
        expect(renders.controls).toBe(1);
        expect(renders.history).toBe(1);
        expect(Object.fromEntries(renders.rows)).toEqual({
            a: 1,
            b: 1,
            c: 1,
        });

        fireEvent.click(view.getByRole('button', {name: 'edit b'}));

        expect(view.getByTestId('title-b').textContent).toBe('Bravo edited');
        expect(view.getByTestId('title-a').textContent).toBe('Alpha');
        expect(view.getByTestId('title-c').textContent).toBe('Charlie');
        expect(renders.list).toBe(1);
        expect(renders.controls).toBe(1);
        expect(renders.history).toBe(2);
        expect(Object.fromEntries(renders.rows)).toEqual({
            a: 1,
            b: 2,
            c: 1,
        });
    });

    it('updates todo titles after undo and redo in the real todo panel', () => {
        window.matchMedia ??= () =>
            ({
                matches: false,
                addEventListener() {},
                removeEventListener() {},
            }) as unknown as MediaQueryList;
        const [Provider, useEditorContext] = createHistoryContext<TodoState, never, 'type'>(
            'type',
        );
        const initial = blankHistory<TodoState, never>({
            bgcolor: '#fff',
            todos: [
                {id: 'a', title: 'Alpha', done: false},
                {id: 'b', title: 'Bravo', done: false},
                {id: 'c', title: 'Charlie', done: false},
            ],
        });

        function TestApp() {
            const editor = useEditorContext();
            return (
                <TodoPanel
                    editor={withDisabledEphemeral(editor)}
                    replicaId="solo"
                    title="Todos"
                />
            );
        }

        const view = render(
            <Provider initial={initial}>
                <TestApp />
            </Provider>,
        );

        fireEvent.click(view.getAllByRole('button', {name: 'Edit'})[1]);
        const input = view.getByDisplayValue('Bravo');
        fireEvent.change(input, {target: {value: 'Bravo edited'}});
        fireEvent.blur(input);

        expect(view.getByText('Bravo edited')).toBeTruthy();

        fireEvent.click(view.getByRole('button', {name: 'Undo'}));
        expect(view.getByText('Bravo')).toBeTruthy();

        fireEvent.click(view.getByRole('button', {name: 'Redo'}));
        expect(view.getByText('Bravo edited')).toBeTruthy();
    });

    it('updates todo titles when undoing a title edit after undoing a later reorder', () => {
        const [Provider, useEditorContext] = createHistoryContext<TodoState, never, 'type'>(
            'type',
        );
        const initial = blankHistory<TodoState, never>({
            bgcolor: '#fff',
            todos: [
                {id: 'a', title: 'Alpha', done: false},
                {id: 'b', title: 'Bravo', done: false},
                {id: 'c', title: 'Charlie', done: false},
            ],
        });

        function TestApp() {
            const editor = useEditorContext();
            return (
                <>
                    <TodoRows editor={editor} renders={{list: 0, rows: new Map()}} />
                    <button type="button" onClick={() => editor.$.todos[1].title('Bravo edited')}>
                        edit b directly
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            editor.$.todos.$move({fromIdx: 1, targetIdx: 0, after: false})
                        }
                    >
                        move b first
                    </button>
                    <button type="button" onClick={() => editor.undo()}>
                        undo
                    </button>
                    <button type="button" onClick={() => editor.redo()}>
                        redo
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={initial}>
                <TestApp />
            </Provider>,
        );

        fireEvent.click(view.getByRole('button', {name: 'edit b directly'}));
        expect(todoTitles(view)).toEqual(['Alpha', 'Bravo edited', 'Charlie']);

        fireEvent.click(view.getByRole('button', {name: 'move b first'}));
        expect(todoTitles(view)).toEqual(['Bravo edited', 'Alpha', 'Charlie']);

        fireEvent.click(view.getByRole('button', {name: 'undo'}));
        expect(todoTitles(view)).toEqual(['Alpha', 'Bravo edited', 'Charlie']);

        fireEvent.click(view.getByRole('button', {name: 'undo'}));
        expect(todoTitles(view)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });
});

function todoTitles(view: ReturnType<typeof render>) {
    return view.getAllByTestId(/^title-/).map((node) => node.textContent);
}

function HistoryObserver({
    editor,
    renders,
}: {
    editor: HistoryEditorContext<TodoState>;
    renders: {history: number};
}) {
    editor.useHistory();
    renders.history += 1;
    return null;
}

function UnsubscribedControls({renders}: {renders: {controls: number}}) {
    renders.controls += 1;
    return null;
}

function TodoRows({
    editor,
    renders,
}: {
    editor: HistoryEditorContext<TodoState>;
    renders: {list: number; rows: Map<string, number>};
}) {
    renders.list += 1;
    const todoIds = useValue(editor.$.todos, (todos) => todos.map((todo) => todo.id));
    return (
        <ul>
            {todoIds.map((id, index) => (
                <TodoRow
                    key={id}
                    id={id}
                    path={editor.$.todos[index]}
                    renders={renders.rows}
                />
            ))}
        </ul>
    );
}

function TodoRow({
    id,
    path,
    renders,
}: {
    id: string;
    path: Updater<Todo>;
    renders: Map<string, number>;
}) {
    renders.set(id, (renders.get(id) ?? 0) + 1);
    const todo = useValue(path);
    return (
        <li>
            <span data-testid={`title-${id}`}>{todo.title}</span>
            <button type="button" onClick={() => path.title(`${todo.title} edited`)}>
                edit {id}
            </button>
        </li>
    );
}
