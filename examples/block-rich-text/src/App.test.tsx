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

let restoreCaretGeometry: (() => void) | null = null;

afterEach(() => {
    restoreCaretGeometry?.();
    restoreCaretGeometry = null;
    cleanup();
});

const editor = (view: ReturnType<typeof render>, name: 'Editor A' | 'Editor B') =>
    view.getByRole('article', {name: ''}).querySelector(`[aria-label="${name}"]`);

const panels = (view: ReturnType<typeof render>) => {
    const articles = view.container.querySelectorAll<HTMLElement>('.editorPanel');
    return {left: articles[0], right: articles[1]};
};

const blocks = (panel: HTMLElement) => within(panel).getAllByRole('textbox', {name: 'Block text'});

const blockTexts = (panel: HTMLElement): string[] =>
    blocks(panel).map((block) => block.textContent ?? '');

const waitForBlockTexts = async (panel: HTMLElement, expected: string[]) => {
    await waitFor(
        () => {
            const actual = blockTexts(panel);
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(
                    `expected block texts ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
                );
            }
        },
        {onTimeout: (error) => error},
    );
};

const pasteText = (block: HTMLElement, text: string) => {
    fireEvent.paste(block, {
        clipboardData: {
            getData: () => text,
        },
    });
};

const selectCaret = (block: HTMLElement, offset = 0) => {
    block.focus();
    setDomCaret(block, offset);
    fireEvent.select(block);
};

const selectRange = (block: HTMLElement, start: number, end: number) => {
    block.focus();
    setDomRange(block, start, end);
    fireEvent.mouseUp(block);
};

const addCaret = (block: HTMLElement, offset = 0) => {
    block.focus();
    setDomCaret(block, offset);
    fireEvent.mouseUp(block, {metaKey: true});
};

const addRange = (block: HTMLElement, start: number, end: number) => {
    block.focus();
    setDomRange(block, start, end);
    fireEvent.mouseUp(block, {metaKey: true});
};

const tripleClickRange = (block: HTMLElement, start: number, end: number) => {
    block.focus();
    setDomRange(block, start, end);
    fireEvent.mouseUp(block, {detail: 3});
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

const setDomRange = (block: HTMLElement, start: number, end: number) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    const text = firstTextNode(block);
    if (text) {
        const length = text.textContent?.length ?? 0;
        range.setStart(text, Math.min(start, length));
        range.setEnd(text, Math.min(end, length));
    } else {
        range.setStart(block, 0);
        range.setEnd(block, 0);
    }
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

const beforeInputDeleteBackward = (block: HTMLElement) =>
    fireEvent(
        block,
        new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
        }),
    );

const beforeInputDeleteForward = (block: HTMLElement) =>
    fireEvent(
        block,
        new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentForward',
        }),
    );

const retainedCaretOffset = (block: HTMLElement): number | null => {
    let offset = 0;
    for (const node of block.childNodes) {
        if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).dataset.retainedSelection === 'caret'
        ) {
            return offset;
        }
        offset += node.textContent?.length ?? 0;
    }
    return null;
};

const retainedCaretOffsets = (block: HTMLElement): number[] => {
    const offsets: number[] = [];
    let offset = 0;
    for (const node of block.childNodes) {
        if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).dataset.retainedSelection === 'caret'
        ) {
            offsets.push(offset);
        }
        offset += node.textContent?.length ?? 0;
    }
    return offsets;
};

const retainedHighlightText = (block: HTMLElement): string =>
    [...block.querySelectorAll<HTMLElement>('[data-retained-selection="highlight"]')]
        .map((element) => element.textContent ?? '')
        .join('');

const childTexts = (block: HTMLElement): string[] =>
    [...block.childNodes].map((node) => node.textContent ?? '');

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

    it('handles native beforeinput as the production deletion path', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('abc'));

        selectCaret(blocks(left)[0], 2);
        expect(beforeInputDeleteBackward(blocks(left)[0])).toBe(false);

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ac'));
        expect(blocks(right)[0].textContent).toBe('ac');
        expect(domCaretOffset(blocks(left)[0])).toBe(1);
    });

    it('handles native beforeinput as the production forward deletion path', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('abc'));

        selectCaret(blocks(left)[0], 2);
        expect(beforeInputDeleteForward(blocks(left)[0])).toBe(false);

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ab'));
        expect(blocks(right)[0].textContent).toBe('ab');
        expect(domCaretOffset(blocks(left)[0])).toBe(2);
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

    it('places the caret at the start of the new block after Enter splits a block', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitFor(() => expect(blocks(left).map((block) => block.textContent)).toEqual(['ab', 'cd']));
        expect(domSelectionBlock()).toBe(blocks(left)[1]);
        expect(domCaretOffset(blocks(left)[1])).toBe(0);
    });

    it('moves ArrowLeft from the start of a block to the previous block end', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);

        selectCaret(blocks(left)[1], 0);
        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowLeft'});

        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 3});

        beforeInputText(blocks(left)[0], 'X');
        await waitForBlockTexts(left, ['oneX', 'two']);
        expect(blockTexts(right)).toEqual(['oneX', 'two']);
    });

    it('moves ArrowRight from the end of a block to the next block start', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowRight'});

        expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 0});

        beforeInputText(blocks(left)[1], 'X');
        await waitForBlockTexts(left, ['one', 'Xtwo']);
        expect(blockTexts(right)).toEqual(['one', 'Xtwo']);
    });

    it('moves ArrowDown to the next block using the closest horizontal caret position', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nxy');
        await waitForBlockTexts(left, ['abcd', 'xy']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown'});

        await waitFor(() => expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 2}));

        beforeInputText(blocks(left)[1], 'X');
        await waitForBlockTexts(left, ['abcd', 'xyX']);
        expect(blockTexts(right)).toEqual(['abcd', 'xyX']);
    });

    it('moves ArrowUp to the previous block using the closest horizontal caret position', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nxy');
        await waitForBlockTexts(left, ['abcd', 'xy']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[1], 1);
        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowUp'});

        await waitFor(() => expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 1}));
    });

    it('preserves the original horizontal intent across repeated ArrowDown moves', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nxy\nmnopqrst');
        await waitForBlockTexts(left, ['abcd', 'xy', 'mnopqrst']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown'});
        await waitFor(() => expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 2}));

        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowDown'});

        await waitFor(() => expect(domCaretPosition(left)).toEqual({blockIndex: 2, offset: 3}));
    });

    it('lets native ArrowDown handle movement when the caret is not on the last visual line', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcdef\nnext');
        await waitForBlockTexts(left, ['abcdef', 'next']);
        installMockCaretGeometry(left, {
            topForOffset: (blockIndex, offset) => blockIndex * 40 + (blockIndex === 0 && offset >= 3 ? 20 : 0),
        });

        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown'});

        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 1});
    });

    it('does not custom-handle Shift+ArrowDown or edge-block vertical arrows', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown', shiftKey: true});
        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 1});

        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowUp'});
        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 1});

        selectCaret(blocks(left)[1], 1);
        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowDown'});
        expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 1});
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

    it('handles the Delete key without native contenteditable mutation', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('abc'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Delete'});

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ab'));
        expect(blocks(right)[0].textContent).toBe('ab');
        expect(domCaretOffset(blocks(left)[0])).toBe(2);
    });

    it('does not let an inactive editor restore its stored range over the active editor', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        expect(domSelectionBlock()).toBe(blocks(left)[0]);

        selectRange(blocks(right)[0], 1, 3);
        beforeInputText(blocks(right)[0], 'X');

        await waitFor(() => expect(blocks(right)[0].textContent).toBe('aXd'));
        expect(blocks(left)[0].textContent).toBe('aXd');
        expect(domSelectionBlock()).toBe(blocks(right)[0]);
    });

    it('shows an inactive editor caret without showing the active editor caret', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(right)[0], 0);
        beforeInputText(blocks(right)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        selectCaret(blocks(right)[0], 2);
        selectCaret(blocks(left)[0], 0);

        await waitFor(() => expect(retainedCaretOffset(blocks(right)[0])).toBe(2));
        expect(retainedCaretOffset(blocks(left)[0])).toBeNull();
    });

    it('shows an inactive editor range highlight', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(right)[0], 0);
        beforeInputText(blocks(right)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(right)[0], 1, 3);
        selectCaret(blocks(left)[0], 0);

        await waitFor(() => expect(retainedHighlightText(blocks(right)[0])).toBe('bc'));
        expect(childTexts(blocks(right)[0])).toEqual(['a', 'bc', 'd']);
    });

    it('shifts an inactive editor caret after a remote insert before it', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(right)[0], 0);
        beforeInputText(blocks(right)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        selectCaret(blocks(right)[0], 2);
        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(right)[0].textContent).toBe('Xabc'));
        expect(retainedCaretOffset(blocks(right)[0])).toBe(3);
    });

    it('shows a caret when an inactive selected range is deleted remotely', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(right)[0], 0);
        beforeInputText(blocks(right)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(right)[0], 1, 3);
        selectRange(blocks(left)[0], 1, 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace'});

        await waitFor(() => expect(blocks(right)[0].textContent).toBe('ad'));
        expect(retainedHighlightText(blocks(right)[0])).toBe('');
        expect(retainedCaretOffset(blocks(right)[0])).toBe(1);
    });

    it('keeps the selected range after clicking Bold', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));

        await waitFor(() => expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('bc'));
        expect(domSelectionBlock()).toBe(blocks(left)[0]);
        expect(domSelectionOffsets(blocks(left)[0])).toEqual({anchor: 1, focus: 3});
    });

    it('bolds the first selected range in a newly-created block with Cmd+B', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'title');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('title'));

        selectCaret(blocks(left)[0], 5);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});
        await waitFor(() => expect(blocks(left).map((block) => block.textContent)).toEqual(['title', '']));

        beforeInputText(blocks(left)[1], 'abcd');
        await waitFor(() => expect(blocks(left)[1].textContent).toBe('abcd'));

        selectRange(blocks(left)[1], 1, 3);
        fireEvent.keyDown(blocks(left)[1], {key: 'b', metaKey: true});

        await waitFor(() => expect(blocks(left)[1].querySelector('.markBold')?.textContent).toBe('bc'));
        expect(domSelectionBlock()).toBe(blocks(left)[1]);
        expect(domSelectionOffsets(blocks(left)[1])).toEqual({anchor: 1, focus: 3});
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

    it('adds a second cursor with Cmd-click and types at both cursors', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 3);
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([1]);

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('aXbcXd'));
        expect(blocks(right)[0].textContent).toBe('aXbcXd');
    });

    it('moves every cursor with plain ArrowRight before typing', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 3);

        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowRight'});
        fireEvent.keyUp(blocks(left)[0], {key: 'ArrowRight'});

        await waitFor(() => expect(domCaretOffset(blocks(left)[0])).toBe(4));
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([2]);

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abXcdX'));
        expect(blocks(right)[0].textContent).toBe('abXcdX');
    });

    it('clicking after multiselect clears secondary cursors at the clicked point', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 3);
        addCaret(blocks(left)[0], 1);
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([3]);

        const documentWithCaretRange = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;
        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: () => {
                const range = document.createRange();
                range.setStart(firstTextNode(blocks(left)[0])!, 0);
                range.collapse(true);
                return range;
            },
            configurable: true,
        });

        try {
            fireEvent.mouseDown(blocks(left)[0], {clientX: 10, clientY: 10});
            setDomCaret(blocks(left)[0], 1);
            fireEvent.mouseUp(blocks(left)[0], {clientX: 10, clientY: 10});

            await waitFor(() => expect(domCaretOffset(blocks(left)[0])).toBe(0));
            expect(retainedCaretOffsets(blocks(left)[0])).toEqual([]);

            beforeInputText(blocks(left)[0], 'X');

            await waitFor(() => expect(blocks(left)[0].textContent).toBe('Xabcd'));
            expect(blocks(right)[0].textContent).toBe('Xabcd');
        } finally {
            Object.defineProperty(document, 'caretRangeFromPoint', {
                value: previousCaretRangeFromPoint,
                configurable: true,
            });
        }
    });

    it('adds a range with Cmd-drag and shows it when inactive', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 0);
        addRange(blocks(left)[0], 1, 3);
        selectCaret(blocks(right)[0], 0);

        await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('bc'));
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([0]);
    });

    it('keeps the existing selection visible while Cmd-dragging another selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcdef');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcdef'));

        selectRange(blocks(left)[0], 1, 3);
        expect(retainedHighlightText(blocks(left)[0])).toBe('');

        fireEvent.mouseDown(blocks(left)[0], {metaKey: true});

        await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('bc'));
    });

    it('applies Cmd+B to all selected ranges', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 0, 1);
        addRange(blocks(left)[0], 2, 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});

        await waitFor(() =>
            expect([...blocks(left)[0].querySelectorAll('.markBold')].map((node) => node.textContent)).toEqual([
                'a',
                'c',
            ]),
        );
    });

    it('triple-clicks a word and selects all exact visible occurrences', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'one One one');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('one One one'));

        tripleClickRange(blocks(left)[0], 8, 11);
        selectCaret(blocks(right)[0], 0);

        await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('oneone'));
        expect(childTexts(blocks(left)[0])).toEqual(['one', ' One ', 'one']);
    });

    it('prevents native triple-click line selection from replacing occurrence selections', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'one One one');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('one One one'));

        const documentWithCaretRange = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;
        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: () => {
                const range = document.createRange();
                range.setStart(firstTextNode(blocks(left)[0])!, 8);
                range.collapse(true);
                return range;
            },
            configurable: true,
        });

        try {
            expect(
                fireEvent.mouseDown(blocks(left)[0], {
                    detail: 3,
                    clientX: 10,
                    clientY: 10,
                }),
            ).toBe(false);
            setDomRange(blocks(left)[0], 0, 11);
            fireEvent.mouseUp(blocks(left)[0], {detail: 3});
            selectCaret(blocks(right)[0], 0);

            await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('oneone'));
            expect(childTexts(blocks(left)[0])).toEqual(['one', ' One ', 'one']);
        } finally {
            Object.defineProperty(document, 'caretRangeFromPoint', {
                value: previousCaretRangeFromPoint,
                configurable: true,
            });
        }
    });
});

const firstTextNode = (element: HTMLElement): Text | null => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode() as Text | null;
};

const domSelectionBlock = (): HTMLElement | null => {
    const node = window.getSelection()?.focusNode;
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return element?.closest<HTMLElement>('[data-block-id]') ?? null;
};

const domSelectionOffsets = (block: HTMLElement): {anchor: number; focus: number} => {
    const selection = window.getSelection()!;
    return {
        anchor: domPointOffset(block, selection.anchorNode, selection.anchorOffset),
        focus: domPointOffset(block, selection.focusNode, selection.focusOffset),
    };
};

const domCaretOffset = (block: HTMLElement): number => {
    const selection = window.getSelection()!;
    return domPointOffset(block, selection.focusNode, selection.focusOffset);
};

const domCaretPosition = (panel: HTMLElement): {blockIndex: number; offset: number} => {
    const selectedBlock = domSelectionBlock();
    const editorBlocks = blocks(panel);
    const blockIndex = selectedBlock ? editorBlocks.indexOf(selectedBlock) : -1;
    return {
        blockIndex,
        offset: blockIndex >= 0 ? domCaretOffset(editorBlocks[blockIndex]) : -1,
    };
};

const domPointOffset = (block: HTMLElement, node: Node | null, nodeOffset: number): number => {
    if (!node || !block.contains(node)) return -1;
    if (node === block) {
        let offset = 0;
        for (let index = 0; index < nodeOffset && index < block.childNodes.length; index++) {
            offset += block.childNodes[index].textContent?.length ?? 0;
        }
        return offset;
    }
    let offset = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (current === node) return offset + nodeOffset;
        offset += current.textContent?.length ?? 0;
    }
    return -1;
};

const installMockCaretGeometry = (
    panel: HTMLElement,
    options: {
        xForOffset?(blockIndex: number, offset: number): number;
        topForOffset?(blockIndex: number, offset: number): number;
    } = {},
) => {
    restoreCaretGeometry?.();
    const rangePrototype = window.Range.prototype;
    const originalGetClientRects = rangePrototype.getClientRects;
    const originalGetBoundingClientRect = rangePrototype.getBoundingClientRect;
    const xForOffset = options.xForOffset ?? ((_blockIndex, offset) => offset * 10);
    const topForOffset = options.topForOffset ?? ((blockIndex) => blockIndex * 24);

    const rectForRange = (range: Range) => {
        const block = blockForNode(range.startContainer);
        if (!block) return makeDomRect(0, 0);
        const blockIndex = blocks(panel).indexOf(block);
        const offset = domPointOffset(block, range.startContainer, range.startOffset);
        return makeDomRect(xForOffset(blockIndex, offset), topForOffset(blockIndex, offset));
    };

    rangePrototype.getClientRects = function getClientRects() {
        const rect = rectForRange(this);
        return {
            0: rect,
            length: 1,
            item: (index: number) => (index === 0 ? rect : null),
            [Symbol.iterator]: function* () {
                yield rect;
            },
        } as DOMRectList;
    };
    rangePrototype.getBoundingClientRect = function getBoundingClientRect() {
        return rectForRange(this);
    };

    restoreCaretGeometry = () => {
        rangePrototype.getClientRects = originalGetClientRects;
        rangePrototype.getBoundingClientRect = originalGetBoundingClientRect;
    };
};

const blockForNode = (node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return element?.closest<HTMLElement>('[data-block-id]') ?? null;
};

const makeDomRect = (left: number, top: number): DOMRect => {
    const rect = {
        x: left,
        y: top,
        left,
        top,
        right: left,
        bottom: top + 16,
        width: 0,
        height: 16,
        toJSON: () => ({}),
    };
    return rect as DOMRect;
};
