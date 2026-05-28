import '../../../../../src/react/test-dom';

import {cleanup, fireEvent, render, within} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {createInitialHistory, withDisabledEphemeral} from '../../lib/crdtApp';
import {
    todoV1App,
    todoV1HistoryRuntime,
    todoV3App,
    todoV3HistoryRuntime,
} from './TodoVersionApps';

afterEach(() => {
    cleanup();
});

describe('todo version apps', () => {
    it('lets the v1 panel add, edit, check, archive, and delete todos', () => {
        function TestApp() {
            const editor = todoV1HistoryRuntime.useEditorContext();
            return todoV1App.renderPanel({
                editor: withDisabledEphemeral(editor),
                actor: 'test',
                title: 'Todos v1',
            });
        }

        const view = render(
            <todoV1HistoryRuntime.Provider initial={createInitialHistory(todoV1App)}>
                <TestApp />
            </todoV1HistoryRuntime.Provider>,
        );

        fireEvent.change(view.getByPlaceholderText('New todo'), {
            target: {value: '  Added v1 todo  '},
        });
        fireEvent.click(view.getByRole('button', {name: 'Add'}));

        const addedRow = rowForText(view.container, 'Added v1 todo');
        fireEvent.click(within(addedRow).getByRole('button', {name: 'Edit'}));
        const titleInput = view.getByDisplayValue('Added v1 todo');
        fireEvent.change(titleInput, {target: {value: 'Edited v1 todo'}});
        fireEvent.blur(titleInput);

        const editedRow = rowForText(view.container, 'Edited v1 todo');
        fireEvent.click(within(editedRow).getAllByRole('checkbox')[0]);
        fireEvent.click(within(editedRow).getByRole('checkbox', {name: 'Archived'}));

        expect(within(editedRow).getByText(/archived/)).toBeTruthy();

        fireEvent.click(within(editedRow).getByRole('button', {name: 'Delete'}));
        expect(view.queryByText('Edited v1 todo')).toBeNull();
    });

    it('lets the v3 panel add, edit, check, update priority and notes, and delete todos', () => {
        function TestApp() {
            const editor = todoV3HistoryRuntime.useEditorContext();
            return todoV3App.renderPanel({
                editor: withDisabledEphemeral(editor),
                actor: 'test',
                title: 'Todos v3',
            });
        }

        const view = render(
            <todoV3HistoryRuntime.Provider initial={createInitialHistory(todoV3App)}>
                <TestApp />
            </todoV3HistoryRuntime.Provider>,
        );

        fireEvent.change(view.getByPlaceholderText('New todo'), {
            target: {value: 'Added v3 todo'},
        });
        fireEvent.click(view.getByRole('button', {name: 'Add'}));

        const addedRow = rowForText(view.container, 'Added v3 todo');
        fireEvent.click(within(addedRow).getByRole('button', {name: 'Edit'}));
        const titleInput = view.getByDisplayValue('Added v3 todo');
        fireEvent.change(titleInput, {target: {value: 'Edited v3 todo'}});
        fireEvent.blur(titleInput);

        const editedRow = rowForText(view.container, 'Edited v3 todo');
        fireEvent.click(within(editedRow).getAllByRole('checkbox')[0]);
        fireEvent.change(within(editedRow).getByRole('combobox', {name: 'Priority'}), {
            target: {value: 'high'},
        });
        fireEvent.change(view.getByLabelText('Notes for Edited v3 todo'), {
            target: {value: 'Updated notes'},
        });

        expect(within(editedRow).getByText(/\[high\]/)).toBeTruthy();
        expect((view.getByLabelText('Notes for Edited v3 todo') as HTMLInputElement).value).toBe(
            'Updated notes',
        );

        fireEvent.click(within(editedRow).getByRole('button', {name: 'Delete'}));
        expect(view.queryByText('Edited v3 todo')).toBeNull();
    });
});

function rowForText(container: HTMLElement, text: string) {
    const element = within(container).getByText(text);
    const row = element.closest('li');
    if (!row) {
        throw new Error(`No todo row found for ${text}`);
    }
    return row;
}
