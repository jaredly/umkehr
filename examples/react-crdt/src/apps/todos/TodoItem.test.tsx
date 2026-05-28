import '../../../../../src/react/test-dom';

import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TodoItemView} from './TodoItem';

afterEach(() => {
    cleanup();
});

function renderTodoItemView(overrides: Partial<Parameters<typeof TodoItemView>[0]> = {}) {
    return render(
        <TodoItemView
            id="todo-one"
            title="Write tests"
            done={false}
            readOnly={false}
            onDoneChange={vi.fn()}
            onTitleCommit={vi.fn()}
            onDelete={vi.fn()}
            {...overrides}
        />,
    );
}

describe('TodoItemView', () => {
    it('reports checkbox and delete actions', () => {
        const onDoneChange = vi.fn();
        const onDelete = vi.fn();
        const view = renderTodoItemView({onDoneChange, onDelete});

        fireEvent.click(view.getByRole('checkbox'));
        fireEvent.click(view.getByRole('button', {name: 'Delete'}));

        expect(onDoneChange).toHaveBeenCalledWith(true);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('commits a trimmed edited title on blur', () => {
        const onTitleCommit = vi.fn();
        const view = renderTodoItemView({onTitleCommit});

        fireEvent.click(view.getByRole('button', {name: 'Edit'}));
        const input = view.getByDisplayValue('Write tests') as HTMLInputElement;
        fireEvent.change(input, {target: {value: '  Write better tests  '}});
        fireEvent.blur(input);

        expect(onTitleCommit).toHaveBeenCalledWith('Write better tests');
    });

    it('cancels title editing with Escape', () => {
        const onTitleCommit = vi.fn();
        const view = renderTodoItemView({onTitleCommit});

        fireEvent.click(view.getByRole('button', {name: 'Edit'}));
        const input = view.getByDisplayValue('Write tests') as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'Ignored'}});
        fireEvent.keyDown(input, {key: 'Escape'});

        expect(view.getByText('Write tests')).toBeTruthy();
        expect(onTitleCommit).not.toHaveBeenCalled();
    });

    it('renders cursor display data without knowing presence status shape', () => {
        const view = renderTodoItemView({
            cursors: [{actor: 'actor-one', nickname: 'Ada Lovelace', color: '#2563eb', initial: 'A'}],
        });

        expect(view.getByLabelText('Recent editors')).toBeTruthy();
        expect(view.getByTitle('Ada Lovelace edited this todo').textContent).toBe('A');
    });

    it('registers the row and reports drag starts when dragging is enabled', () => {
        const registerRow = vi.fn();
        const onDragStart = vi.fn();
        const view = renderTodoItemView({
            dragEnabled: true,
            onDragStart,
            registerRow,
        });

        expect(registerRow).toHaveBeenCalledWith('todo-one', expect.any(HTMLElement));
        expect((registerRow.mock.calls[0][1] as HTMLElement).tagName).toBe('LI');

        fireEvent.pointerDown(view.getByRole('button', {name: 'Move Write tests'}));

        expect(onDragStart).toHaveBeenCalledWith('todo-one', expect.any(Object));
    });

    it('disables row controls when read-only', () => {
        const view = renderTodoItemView({
            readOnly: true,
            dragEnabled: false,
        });

        expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
        expect((view.getByRole('button', {name: 'Edit'}) as HTMLButtonElement).disabled).toBe(true);
        expect((view.getByRole('button', {name: 'Delete'}) as HTMLButtonElement).disabled).toBe(
            true,
        );
        expect(view.queryByRole('button', {name: 'Move Write tests'})).toBeNull();
    });
});
