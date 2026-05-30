import '../react/test-dom';

import {cleanup, fireEvent, render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {RichTextEditor, richTextSnapshotFromHtml} from './RichTextEditor.js';
import {restoreSelection} from './selection.js';
import type {RichTextBinding} from '../react-crdt/react-crdt.js';

afterEach(() => cleanup());

describe('RichTextEditor', () => {
    it('translates fallback text insertion to an insert command', () => {
        const binding = bindingForText('');
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        editor.textContent = 'h';

        fireEvent.input(editor);

        expect(binding.commands.insert).toHaveBeenCalledWith(0, 'h');
        expect(binding.commands.replace).not.toHaveBeenCalled();
    });

    it('translates fallback input diffs to delete and insert commands', () => {
        const binding = bindingForText('hello');
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        editor.textContent = 'heXlo';

        fireEvent.input(editor);

        expect(binding.commands.delete).toHaveBeenCalledWith(2, 3);
        expect(binding.commands.insert).toHaveBeenCalledWith(2, 'X');
        expect(binding.commands.replace).not.toHaveBeenCalled();
    });

    it('toggles bold with mod-b using the full-selection mark rule', () => {
        const binding = bindingForText('hi');
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        restoreSelection(editor, {start: 0, end: 2});

        fireEvent.keyDown(editor, {key: 'b', metaKey: true});

        expect(binding.commands.mark).toHaveBeenCalledWith(0, 2, 'strong', true, 'inclusive');
    });

    it('unmarks bold with mod-b when the whole selection is bold', () => {
        const binding = bindingForSpans([{text: 'hi', marks: {strong: true}}]);
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        restoreSelection(editor, {start: 0, end: 2});

        fireEvent.keyDown(editor, {key: 'b', metaKey: true});

        expect(binding.commands.unmark).toHaveBeenCalledWith(0, 2, 'strong', 'inclusive');
    });

    it('preserves compatible HTML marks on paste', () => {
        expect(
            richTextSnapshotFromHtml(
                document,
                '<strong>bo</strong><em>ld</em><a href="https://example.test">!</a>',
            ),
        ).toEqual({
            spans: [
                {text: 'bo', marks: {strong: true}},
                {text: 'ld', marks: {em: true}},
                {text: '!', marks: {link: 'https://example.test'}},
            ],
        });

        const binding = bindingForText('');
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        restoreSelection(editor, {start: 0, end: 0});

        const paste = new window.Event('paste', {bubbles: true, cancelable: true});
        Object.defineProperty(paste, 'clipboardData', {
            value: {
                getData: (type: string) =>
                    type === 'text/html'
                        ? '<strong>bo</strong><em>ld</em><a href="https://example.test">!</a>'
                        : 'bold!',
            },
        });
        fireEvent(editor, paste);

        expect(binding.commands.insert).toHaveBeenCalledWith(0, 'bold!');
        expect(binding.commands.mark).toHaveBeenCalledWith(0, 2, 'strong', true, 'inclusive');
        expect(binding.commands.mark).toHaveBeenCalledWith(2, 4, 'em', true, 'inclusive');
        expect(binding.commands.mark).toHaveBeenCalledWith(
            4,
            5,
            'link',
            'https://example.test',
            'exclusive',
        );
    });

    it('shows a toolbar for selected text and applies code formatting', () => {
        const binding = bindingForText('hi');
        const view = render(<RichTextEditor {...binding} />);
        const editor = view.getByRole('textbox');
        restoreSelection(editor, {start: 0, end: 2});

        fireEvent.mouseUp(editor);
        fireEvent.click(view.getByRole('button', {name: 'Code'}));

        expect(binding.commands.mark).toHaveBeenCalledWith(0, 2, 'code', true, 'inclusive');
    });

    it('applies link formatting from the toolbar prompt', () => {
        const binding = bindingForText('hi');
        const view = render(
            <RichTextEditor {...binding} promptForLink={() => 'https://example.test'} />,
        );
        const editor = view.getByRole('textbox');
        restoreSelection(editor, {start: 0, end: 2});

        fireEvent.mouseUp(editor);
        fireEvent.click(view.getByRole('button', {name: 'Link'}));

        expect(binding.commands.mark).toHaveBeenCalledWith(
            0,
            2,
            'link',
            'https://example.test',
            'exclusive',
        );
    });
});

function bindingForText(text: string) {
    return bindingForSpans(text ? [{text}] : []);
}

function bindingForSpans(spans: RichTextBinding['view']['spans']): RichTextBinding {
    return {
        view: {
            spans,
            plainText: spans.map((span) => span.text).join(''),
        },
        commands: {
            insert: vi.fn(),
            delete: vi.fn(),
            mark: vi.fn(),
            unmark: vi.fn(),
            replace: vi.fn(),
        },
    };
}
