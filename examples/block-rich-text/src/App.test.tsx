import '../../../src/react/test-dom';

import {cleanup, fireEvent, render, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {App} from './App';

Object.defineProperty(globalThis, 'NodeFilter', {
    value: window.NodeFilter,
    configurable: true,
});

Object.defineProperty(globalThis, 'CSS', {
    value: {escape: (value: string) => value.replace(/"/g, '\\"')},
    configurable: true,
});

afterEach(() => {
    cleanup();
});

const editor = (view: ReturnType<typeof render>, name: 'Editor A' | 'Editor B') =>
    view.getByRole('article', {name: ''}).querySelector(`[aria-label="${name}"]`);

const panels = (view: ReturnType<typeof render>) => {
    const articles = view.container.querySelectorAll<HTMLElement>('.editorPanel');
    return {left: articles[0], right: articles[1]};
};

const blocks = (panel: HTMLElement) => within(panel).getAllByRole('textbox', {name: 'Block text'});

const selectCaret = (block: HTMLElement, offset = 0) => {
    block.focus();
    setDomCaret(block, offset);
    fireEvent.select(block);
};

const setDomCaret = (block: HTMLElement, offset = 0) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    const text = firstTextNode(block);
    if (text) {
        range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
    } else {
        range.setStart(block, 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
};

const typeText = (block: HTMLElement, text: string) => {
    for (const char of text) {
        fireEvent(
            block,
            new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
            }),
        );
    }
};

const browserTypeText = (block: HTMLElement, text: string) => {
    for (const char of text) {
        fireEvent(
            block,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
            }),
        );
        fireEvent(
            block,
            new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
            }),
        );
    }
};

const beforeInputText = (block: HTMLElement, text: string) => {
    for (const char of text) {
        fireEvent(
            block,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
            }),
        );
    }
};

describe('Block rich text example UI', () => {
    it('renders two synced editors', () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        expect(within(left).getByText('Editor A')).toBeTruthy();
        expect(within(right).getByText('Editor B')).toBeTruthy();
        expect(blocks(left)).toHaveLength(1);
        expect(blocks(right)).toHaveLength(1);
    });

    it('types in one editor and syncs text to the other editor', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        typeText(leftBlock, 'abc');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));
        expect(blocks(right)[0].textContent).toBe('abc');
    });

    it('does not duplicate browser input after beforeinput already handled insertion', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        browserTypeText(leftBlock, 'a');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));
        expect(blocks(right)[0].textContent).toBe('a');
    });

    it('handles native beforeinput as the production insertion path', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        beforeInputText(leftBlock, 'z');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('z'));
        expect(blocks(right)[0].textContent).toBe('z');
    });

    it('queues offline edits and flushes them when the editor returns online', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const online = within(left).getByLabelText('Online');

        fireEvent.click(online);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'offline');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('offline'));
        expect(blocks(right)[0].textContent).toBe('');
        expect(within(left).getByText(/queued 7/)).toBeTruthy();

        fireEvent.click(online);
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('offline'));
        expect(within(left).getByText(/queued 0/)).toBeTruthy();
    });

    it('splits a block with Enter', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        typeText(leftBlock, 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitFor(() => expect(blocks(left).map((block) => block.textContent)).toEqual(['ab', 'cd']));
        expect(blocks(right).map((block) => block.textContent)).toEqual(['ab', 'cd']);
    });

    it('restores the caret one position left after ordinary Backspace', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace'});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ac'));
        expect(domCaretOffset(blocks(left)[0])).toBe(1);

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('aXc'));
        expect(blocks(right)[0].textContent).toBe('aXc');
    });

    it('keeps the middle Backspace caret after the browser keyup selection event', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace'});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('acd'));

        fireEvent.keyUp(blocks(left)[0], {key: 'Backspace'});
        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('aXcd'));
        expect(blocks(right)[0].textContent).toBe('aXcd');
    });

    it('uses the live DOM caret for Backspace even if selection state is stale', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        setDomCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace'});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ac'));
        expect(domCaretOffset(blocks(left)[0])).toBe(1);

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('aXc'));
        expect(blocks(right)[0].textContent).toBe('aXc');
    });

    it('keeps Backspace at the end of a block at the new end', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace'});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ab'));
        expect(domCaretOffset(blocks(left)[0])).toBe(2);

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abX'));
        expect(blocks(right)[0].textContent).toBe('abX');
    });

    it('pastes newlines as multiple synced blocks', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        fireEvent.paste(leftBlock, {
            clipboardData: {
                getData: () => 'one\ntwo',
            },
        });

        await waitFor(() => expect(blocks(left).map((block) => block.textContent)).toEqual(['one', 'two']));
        expect(blocks(right).map((block) => block.textContent)).toEqual(['one', 'two']);
    });
});

const firstTextNode = (element: HTMLElement): Text | null => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode() as Text | null;
};

const domCaretOffset = (block: HTMLElement): number => {
    const selection = window.getSelection()!;
    const node = selection.focusNode;
    if (!node || !block.contains(node)) return -1;
    if (node === block) {
        let offset = 0;
        for (let index = 0; index < selection.focusOffset && index < block.childNodes.length; index++) {
            offset += block.childNodes[index].textContent?.length ?? 0;
        }
        return offset;
    }
    let offset = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (current === node) return offset + selection.focusOffset;
        offset += current.textContent?.length ?? 0;
    }
    return -1;
};
