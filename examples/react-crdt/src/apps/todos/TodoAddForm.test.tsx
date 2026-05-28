import '../../../../../src/react/test-dom';

import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TodoAddFormView} from './TodoAddForm';

afterEach(() => {
    cleanup();
});

describe('TodoAddFormView', () => {
    it('renders the controlled draft title and reports input changes', () => {
        const onDraftTitleChange = vi.fn();

        const view = render(
            <TodoAddFormView
                draftTitle="Buy milk"
                placeholder="Add a task"
                readOnly={false}
                onDraftTitleChange={onDraftTitleChange}
                onSubmit={vi.fn()}
            />,
        );

        const input = view.getByPlaceholderText('Add a task') as HTMLInputElement;
        expect(input.value).toBe('Buy milk');

        fireEvent.change(input, {target: {value: 'Buy oat milk'}});

        expect(onDraftTitleChange).toHaveBeenCalledWith('Buy oat milk');
    });

    it('prevents the native form submit and calls onSubmit', () => {
        const onSubmit = vi.fn();
        const view = render(
            <TodoAddFormView
                draftTitle="Ship it"
                readOnly={false}
                onDraftTitleChange={vi.fn()}
                onSubmit={onSubmit}
            />,
        );

        const defaultWasNotPrevented = fireEvent.submit(
            view.getByRole('button', {name: 'Add'}).closest('form')!,
        );

        expect(defaultWasNotPrevented).toBe(false);
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('disables the input and submit button when read-only', () => {
        const view = render(
            <TodoAddFormView
                draftTitle=""
                readOnly={true}
                onDraftTitleChange={vi.fn()}
                onSubmit={vi.fn()}
            />,
        );

        expect((view.getByPlaceholderText('New todo') as HTMLInputElement).disabled).toBe(true);
        expect((view.getByRole('button', {name: 'Add'}) as HTMLButtonElement).disabled).toBe(true);
    });
});
