import '../../../../../src/react/test-dom';

import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {blankHistory} from 'umkehr';
import {createHistoryContext, Updater, useValue} from 'umkehr/react';
import type {HistoryEditorContext} from '../crdtApp';
import type {Todo, TodoState} from '../../apps/todos/model';

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
});

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
