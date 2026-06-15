import '../../../src/react/test-dom';

import {act, cleanup, fireEvent, render, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
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
    vi.useRealTimers();
    cleanup();
    window.history.pushState({}, '', '/');
});

const editor = (view: ReturnType<typeof render>, name: 'Editor A' | 'Editor B') =>
    view.getByRole('article', {name: ''}).querySelector(`[aria-label="${name}"]`);

const panels = (view: ReturnType<typeof render>) => {
    const articles = view.container.querySelectorAll<HTMLElement>('.editorPanel');
    return {left: articles[0], right: articles[1]};
};

const blocks = (panel: HTMLElement) => within(panel).getAllByRole('textbox', {name: 'Block text'});

const blockTexts = (panel: HTMLElement): string[] =>
    blocks(panel).map(blockText);

const blockText = (block: HTMLElement): string => {
    let text = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (current.parentElement?.closest('[data-offset-sentinel="true"]')) continue;
        text += current.textContent ?? '';
    }
    return text;
};

const blockDepth = (block: HTMLElement): string =>
    block.closest<HTMLElement>('.blockRow')?.style.getPropertyValue('--block-depth') ?? '';

const setBlockType = (panel: HTMLElement, value: string) => {
    const select = within(panel).getByRole('combobox', {name: 'Block type'});
    fireEvent.change(select, {target: {value}});
};

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

const selectCrossBlockRange = (
    startBlock: HTMLElement,
    startOffset: number,
    endBlock: HTMLElement,
    endOffset: number,
) => {
    endBlock.focus();
    setDomCrossBlockRange(startBlock, startOffset, endBlock, endOffset);
    fireEvent.mouseUp(endBlock);
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

const setDomCrossBlockRange = (
    startBlock: HTMLElement,
    startOffset: number,
    endBlock: HTMLElement,
    endOffset: number,
) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    const startText = firstTextNode(startBlock);
    const endText = firstTextNode(endBlock);
    if (startText) {
        range.setStart(startText, Math.min(startOffset, startText.textContent?.length ?? 0));
    } else {
        range.setStart(startBlock, 0);
    }
    if (endText) {
        range.setEnd(endText, Math.min(endOffset, endText.textContent?.length ?? 0));
    } else {
        range.setEnd(endBlock, 0);
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

const installMockBlockRowGeometry = (panel: HTMLElement) => {
    const rows = blocks(panel).map((block) => block.closest<HTMLElement>('.blockRow')!);
    rows.forEach((row, index) => {
        row.getBoundingClientRect = () =>
            ({
                left: 0,
                top: index * 40,
                width: 320,
                height: 40,
                right: 320,
                bottom: index * 40 + 40,
                x: 0,
                y: index * 40,
                toJSON: () => ({}),
            }) as DOMRect;
    });
};

const dragBlockHandle = (panel: HTMLElement, fromIndex: number, clientX: number, clientY: number) => {
    const handles = within(panel).getAllByRole('button', {name: 'Move block'});
    const handle = handles[fromIndex] as HTMLElement & {setPointerCapture?: (pointerId: number) => void};
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, {
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId: 1,
        clientX,
        clientY,
    });
    fireEvent.pointerUp(window, {
        button: 0,
        buttons: 0,
        isPrimary: true,
        pointerId: 1,
        clientX,
        clientY,
    });
};

describe('Block rich text example UI', () => {
    it('renders the blog visual demo gallery for the demos query', () => {
        window.history.pushState({}, '', '/?demos');
        const view = render(<App />);

        expect(view.getByRole('heading', {name: 'Blog visual demos'})).toBeTruthy();
        expect(view.getAllByRole('img')).toHaveLength(8);
        expect(view.container.querySelectorAll('.editorPanel')).toHaveLength(0);
        expect(view.queryByLabelText('History position')).toBeNull();
    });

    it('renders formerly staged demo states at once without rendering the editor UI', () => {
        window.history.pushState({}, '', '/?demos');
        const view = render(<App />);

        expect(view.getByText('dog.parent := tail(red)')).toBeTruthy();
        expect(view.getByText('red.parent := B2')).toBeTruthy();
        expect(view.getByText('1. reparent dog onto the end of red')).toBeTruthy();
        expect(view.getByText('2. reparent red to B2')).toBeTruthy();
        expect(view.getAllByText('Replica A: split before dog')).toHaveLength(2);
        expect(view.getByText('Replica B: split before red')).toBeTruthy();
        expect(view.getByText('Replica B: tagged split before red')).toBeTruthy();
        expect(view.getAllByText('B1: the red').length).toBeGreaterThan(0);
        expect(view.getByText('plain LWW merge')).toBeTruthy();
        expect(view.queryByRole('button', {name: 'After split'})).toBeNull();
        expect(view.container.querySelectorAll('.editorPanel')).toHaveLength(0);
    });

    it('renders two synced editors', () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        expect(within(left).getByText('Editor A')).toBeTruthy();
        expect(within(right).getByText('Editor B')).toBeTruthy();
        expect(blocks(left)).toHaveLength(1);
        expect(blocks(right)).toHaveLength(1);
    });

    it('applies block type metadata from the toolbar to both replicas', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Heading');
        setBlockType(left, 'heading2');

        await waitFor(() => {
            expect(blocks(left)[0].classList.contains('headingLevel2')).toBe(true);
        });
        expect(blocks(right)[0].classList.contains('headingLevel2')).toBe(true);
    });

    it('reflects the selected block type in the toolbar dropdown', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const typeSelect = within(left).getByRole('combobox', {name: 'Block type'}) as HTMLSelectElement;

        pasteText(blocks(left)[0], 'title\nbody');
        await waitForBlockTexts(left, ['title', 'body']);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'heading1');
        await waitFor(() => expect(typeSelect.value).toBe('heading1'));

        selectCaret(blocks(left)[1], 0);
        fireEvent.mouseUp(blocks(left)[1]);
        await waitFor(() => expect(typeSelect.value).toBe('paragraph'));

        setBlockType(left, 'callout-warning');
        await waitFor(() => expect(typeSelect.value).toBe('callout-warning'));

        selectCaret(blocks(left)[0], 0);
        fireEvent.mouseUp(blocks(left)[0]);
        await waitFor(() => expect(typeSelect.value).toBe('heading1'));
    });

    it('wraps blockquote descendants in one grouped subtree container', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        pasteText(blocks(left)[0], 'quote\nchild');
        await waitForBlockTexts(left, ['quote', 'child']);
        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'blockquote');
        selectCaret(blocks(left)[1], 0);
        fireEvent.keyDown(blocks(left)[1], {key: 'Tab'});

        await waitFor(() => {
            const group = left.querySelector<HTMLElement>('.blockquoteGroup');
            expect(group).toBeTruthy();
            expect(within(group!).getAllByRole('textbox', {name: 'Block text'}).map((block) => block.textContent)).toEqual([
                'quote',
                'child',
            ]);
        });
    });

    it('changes callout kind from the inline dropdown', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Heads up');
        setBlockType(left, 'callout-info');

        await waitFor(() => expect(left.querySelector('.calloutGroup')).toBeTruthy());
        const kind = within(left).getByRole('combobox', {name: 'Callout kind'});
        fireEvent.mouseDown(kind);
        fireEvent.change(kind, {target: {value: 'warning'}});

        await waitFor(() => {
            expect(left.querySelector('.calloutWarning')).toBeTruthy();
        });
        expect(right.querySelector('.calloutWarning')).toBeTruthy();
    });

    it('keeps code Enter and Tab inside the same block', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        setBlockType(left, 'code');
        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});
        await waitForBlockTexts(left, ['a\nb']);

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Tab'});

        await waitForBlockTexts(left, ['a\n    b']);
        expect(blockTexts(right)).toEqual(['a\n    b']);
    });

    it('shows trailing code newlines and exits code on a second Enter', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        setBlockType(left, 'code');
        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitForBlockTexts(left, ['ab\n']);
        expect(blocks(left)[0].dataset.trailingNewline).toBe('true');
        const trailingTarget = blocks(left)[0].querySelector('[data-trailing-code-newline="true"]');
        await waitFor(() => {
            expect(trailingTarget?.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
        });

        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitForBlockTexts(left, ['ab', '']);
        expect(blocks(right).map((block) => block.classList.contains('codeBlock'))).toEqual([true, false]);
    });

    it('keeps Shift+Enter as a newline inside a code trailing blank line', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        setBlockType(left, 'code');
        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});
        await waitForBlockTexts(left, ['ab\n']);

        fireEvent.keyDown(blocks(left)[0], {key: 'Enter', shiftKey: true});

        await waitForBlockTexts(left, ['ab\n\n']);
        expect(blockTexts(right)).toEqual(['ab\n\n']);
    });

    it('keeps focus in the code language field while typing', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'code');
        const language = within(left).getByRole('textbox', {name: 'Code language'});

        language.focus();
        fireEvent.change(language, {target: {value: 't'}});
        await waitFor(() => expect(document.activeElement).toBe(language));

        fireEvent.change(language, {target: {value: 'ts'}});
        await waitFor(() => {
            expect(document.activeElement).toBe(language);
            expect((within(right).getByRole('textbox', {name: 'Code language'}) as HTMLInputElement).value).toBe('ts');
        });
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

    it('drags a peer-created third block to the top on the first attempt', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        pasteText(blocks(left)[0], 'a\nb\nc');
        await waitForBlockTexts(right, ['a', 'b', 'c']);
        installMockBlockRowGeometry(right);

        dragBlockHandle(right, 2, 20, 5);

        await waitForBlockTexts(right, ['c', 'a', 'b']);
        expect(blockTexts(left)).toEqual(['c', 'a', 'b']);
    });

    it('undoes and redoes text through editor toolbar buttons', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        typeText(leftBlock, 'a');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));

        fireEvent.click(within(left).getByText('Undo'));
        await waitFor(() => expect(blocks(left)[0].textContent).toBe(''));
        expect(blocks(right)[0].textContent).toBe('');

        fireEvent.click(within(left).getByText('Redo'));
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));
        expect(blocks(right)[0].textContent).toBe('a');
    });

    it('queues undo while offline and flushes it when online', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const online = within(left).getByLabelText('Online');

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'a');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('a'));

        fireEvent.click(online);
        fireEvent.click(within(left).getByText('Undo'));

        await waitFor(() => expect(blocks(left)[0].textContent).toBe(''));
        expect(blocks(right)[0].textContent).toBe('a');
        expect(within(left).getByText(/queued 1/)).toBeTruthy();

        fireEvent.click(online);
        await waitFor(() => expect(blocks(right)[0].textContent).toBe(''));
    });

    it('scrubs document history backward and forward', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const slider = view.getByLabelText('History position') as HTMLInputElement;

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'abc');
        await waitFor(() => expect(slider.value).toBe('3'));

        fireEvent.change(slider, {target: {value: '1'}});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));
        expect(blocks(right)[0].textContent).toBe('a');

        fireEvent.change(slider, {target: {value: '3'}});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));
        expect(blocks(right)[0].textContent).toBe('abc');
    });

    it('branches history when editing from the past', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const slider = view.getByLabelText('History position') as HTMLInputElement;

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        await waitFor(() => expect(slider.value).toBe('2'));

        fireEvent.change(slider, {target: {value: '1'}});
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));
        selectCaret(blocks(left)[0], 1);
        typeText(blocks(left)[0], 'c');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ac'));
        expect(blocks(right)[0].textContent).toBe('ac');
        expect(slider.max).toBe('2');
        expect(slider.value).toBe('2');
        expect(view.getByText('2 / 2')).toBeTruthy();
    });

    it('does not add selection-only captures to history', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const slider = view.getByLabelText('History position') as HTMLInputElement;

        selectCaret(blocks(left)[0], 0);
        fireEvent.mouseUp(blocks(left)[0]);

        await waitFor(() => expect(slider.max).toBe('0'));
        expect(view.getByText('0 / 0')).toBeTruthy();
    });

    it('records keydown events in a collapsed keystroke log', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const details = view.container.querySelector<HTMLDetailsElement>('.keystrokeLog')!;

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ab'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace', code: 'Backspace'});

        await waitFor(() => expect(view.getByText('Keystrokes (1)')).toBeTruthy());
        expect(details.open).toBe(false);

        fireEvent.click(details.querySelector('summary')!);
        expect(within(details).getByText('Backspace')).toBeTruthy();
        expect(within(details).getByText('Editor A')).toBeTruthy();
    });

    it('reports invalid history imports without replacing current history', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const input = view.getByLabelText('Import history file') as HTMLInputElement;
        const file = new File(['not json'], 'history.json', {type: 'application/json'});

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'a');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('a'));

        fireEvent.change(input, {target: {files: [file]}});

        await waitFor(() => expect(view.getByText('Import file is not valid JSON.')).toBeTruthy());
        expect(blocks(left)[0].textContent).toBe('a');
        expect(blocks(right)[0].textContent).toBe('a');
        expect(confirmSpy).toHaveBeenCalled();
        confirmSpy.mockRestore();
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

    it('indents and unindents with Tab away from the block start', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);

        selectCaret(blocks(left)[1], 2);
        fireEvent.keyDown(blocks(left)[1], {key: 'Tab'});

        await waitFor(() => expect(blockDepth(blocks(left)[1])).toBe('1'));
        expect(domSelectionBlock()).toBe(blocks(left)[1]);
        expect(domCaretOffset(blocks(left)[1])).toBe(2);

        fireEvent.keyDown(blocks(left)[1], {key: 'Tab', shiftKey: true});

        await waitFor(() => expect(blockDepth(blocks(left)[1])).toBe('0'));
        expect(domSelectionBlock()).toBe(blocks(left)[1]);
        expect(domCaretOffset(blocks(left)[1])).toBe(2);
    });

    it('indents and unindents every block with a selected caret', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo\nthree\nfour');
        await waitForBlockTexts(left, ['one', 'two', 'three', 'four']);

        selectCaret(blocks(left)[1], 1);
        addCaret(blocks(left)[2], 2);
        fireEvent.keyDown(blocks(left)[2], {key: 'Tab'});

        await waitFor(() => {
            expect(blockDepth(blocks(left)[1])).toBe('1');
            expect(blockDepth(blocks(left)[2])).toBe('1');
        });

        fireEvent.keyDown(blocks(left)[2], {key: 'Tab', shiftKey: true});

        await waitFor(() => {
            expect(blockDepth(blocks(left)[1])).toBe('0');
            expect(blockDepth(blocks(left)[2])).toBe('0');
        });
    });

    it('indents every block spanned by a range selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo\nthree\nfour');
        await waitForBlockTexts(left, ['one', 'two', 'three', 'four']);

        selectCrossBlockRange(blocks(left)[1], 1, blocks(left)[2], 2);
        fireEvent.keyDown(blocks(left)[2], {key: 'Tab'});

        await waitFor(() => {
            expect(blockDepth(blocks(left)[1])).toBe('1');
            expect(blockDepth(blocks(left)[2])).toBe('1');
        });
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

    it('custom-handles Shift+ArrowDown and leaves edge-block vertical arrows alone', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown', shiftKey: true});
        expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 1});

        selectCaret(blocks(left)[0], 1);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowUp'});
        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 1});

        selectCaret(blocks(left)[1], 1);
        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowDown'});
        expect(domCaretPosition(left)).toEqual({blockIndex: 1, offset: 1});
    });

    it('extends a single selection across blocks with Shift+ArrowRight', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowRight', shiftKey: true});
        fireEvent.keyUp(blocks(left)[0], {key: 'ArrowRight', shiftKey: true});

        expect(domSelectionBlock()).toBe(blocks(left)[1]);
        expect(domSelectionOffsets(blocks(left)[1])).toEqual({anchor: -1, focus: 0});
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([3]);
        expect(retainedCaretOffsets(blocks(left)[1])).toEqual([0]);

        fireEvent.keyDown(blocks(left)[1], {key: 'Backspace'});

        await waitForBlockTexts(left, ['onetwo']);
        expect(blockTexts(right)).toEqual(['onetwo']);
        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 3});
    });

    it('extends a single selection backward across blocks with Shift+ArrowLeft', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'one\ntwo');
        await waitForBlockTexts(left, ['one', 'two']);

        selectCaret(blocks(left)[1], 0);
        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowLeft', shiftKey: true});
        fireEvent.keyUp(blocks(left)[1], {key: 'ArrowLeft', shiftKey: true});
        beforeInputText(blocks(left)[0], 'X');

        await waitForBlockTexts(left, ['oneXtwo']);
        expect(blockTexts(right)).toEqual(['oneXtwo']);
        expect(domCaretPosition(left)).toEqual({blockIndex: 0, offset: 4});
    });

    it('extends Shift+ArrowDown using visual horizontal intent', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nxy\nmnopqrst');
        await waitForBlockTexts(left, ['abcd', 'xy', 'mnopqrst']);
        installMockCaretGeometry(left);

        selectCaret(blocks(left)[0], 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowDown', shiftKey: true});
        fireEvent.keyUp(blocks(left)[0], {key: 'ArrowDown', shiftKey: true});

        await waitFor(() => expect(domSelectionBlock()).toBe(blocks(left)[1]));
        expect(domSelectionOffsets(blocks(left)[1])).toEqual({anchor: -1, focus: 2});

        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowDown', shiftKey: true});
        fireEvent.keyUp(blocks(left)[1], {key: 'ArrowDown', shiftKey: true});

        await waitFor(() => expect(domSelectionBlock()).toBe(blocks(left)[2]));
        expect(domSelectionOffsets(blocks(left)[2])).toEqual({anchor: -1, focus: 3});
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

    it('keeps the selected comment body range after Cmd+B', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        const commentBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        selectCaret(commentBody, 0);
        beforeInputText(commentBody, 'note');
        await waitFor(() => expect(commentBody.textContent).toBe('note'));

        selectRange(commentBody, 1, 3);
        fireEvent.keyDown(commentBody, {key: 'b', metaKey: true});

        await waitFor(() => expect(commentBody.querySelector('.markBold')?.textContent).toBe('ot'));
        expect(domSelectionBlock()).toBe(commentBody);
        expect(domSelectionOffsets(commentBody)).toEqual({anchor: 1, focus: 3});
    });

    it('creates a comment on selected comment body text', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        const commentBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        selectCaret(commentBody, 0);
        beforeInputText(commentBody, 'note');
        await waitFor(() => expect(commentBody.textContent).toBe('note'));

        selectRange(commentBody, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        await waitFor(() => expect(within(left).getByText('Comment on “ot”')).toBeTruthy());
    });

    it('renders popover annotations inline as editable delayed-hide popovers', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Popover'}));

        const popoverMark = await waitFor(() => {
            const mark = blocks(left)[0].querySelector<HTMLElement>('.markPopover');
            if (!mark) throw new Error('missing inline popover mark');
            return mark;
        });
        expect(popoverMark.textContent).toBe('bc');
        expect(popoverMark.dataset.popoverId).toBeTruthy();
        expect(within(left).queryByLabelText('Popovers')).toBeNull();

        fireEvent.mouseOver(popoverMark);
        const popover = await waitFor(() =>
            within(left).getByRole('dialog', {name: 'Popover'}),
        );
        const popoverBody = within(popover).getByRole('textbox', {name: 'Annotation body'});

        selectCaret(popoverBody, 0);
        beforeInputText(popoverBody, 'note');
        await waitFor(() => expect(popoverBody.textContent).toBe('note'));

        vi.useFakeTimers();
        fireEvent.mouseOut(popoverMark, {relatedTarget: document.body});
        act(() => vi.advanceTimersByTime(200));
        expect(within(left).getByRole('dialog', {name: 'Popover'})).toBe(popover);

        fireEvent.mouseEnter(popover);
        act(() => vi.advanceTimersByTime(300));
        expect(within(left).getByRole('dialog', {name: 'Popover'})).toBe(popover);

        fireEvent.mouseLeave(popover, {relatedTarget: document.body});
        act(() => vi.advanceTimersByTime(300));
        expect(within(left).queryByRole('dialog', {name: 'Popover'})).toBeNull();
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

    it('Cmd-click adds a cursor in a block that already has a retained cursor', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.paste(blocks(left)[0], {
            clipboardData: {
                getData: () => 'abcd\nwxyz',
            },
        });
        await waitFor(() => expect(blockTexts(left)).toEqual(['abcd', 'wxyz']));

        selectCaret(blocks(left)[1], 1);
        addCaret(blocks(left)[0], 1);

        const documentWithCaretRange = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;
        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: () => rangeAtBlockOffset(blocks(left)[1], 3),
            configurable: true,
        });

        try {
            fireEvent.mouseDown(blocks(left)[1], {
                metaKey: true,
                clientX: 10,
                clientY: 10,
            });
            setDomCaret(blocks(left)[0], 1);
            fireEvent.mouseUp(blocks(left)[1], {
                metaKey: true,
                clientX: 10,
                clientY: 10,
            });

            await waitFor(() => expect(domSelectionBlock()).toBe(blocks(left)[1]));
            expect(domCaretOffset(blocks(left)[1])).toBe(3);

            beforeInputText(blocks(left)[1], 'X');

            await waitFor(() => expect(blockTexts(left)).toEqual(['aXbcd', 'wXxyXz']));
            expect(blockTexts(right)).toEqual(['aXbcd', 'wXxyXz']);
        } finally {
            Object.defineProperty(document, 'caretRangeFromPoint', {
                value: previousCaretRangeFromPoint,
                configurable: true,
            });
        }
    });

    it('keeps non-primary cursors visible while focusing their block', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.paste(blocks(left)[0], {
            clipboardData: {
                getData: () => 'abcd\nwxyz',
            },
        });
        await waitFor(() => expect(blockTexts(left)).toEqual(['abcd', 'wxyz']));

        selectCaret(blocks(left)[1], 1);
        addCaret(blocks(left)[0], 1);
        expect(retainedCaretOffsets(blocks(left)[1])).toEqual([1]);

        fireEvent.focus(blocks(left)[1]);

        expect(retainedCaretOffsets(blocks(left)[1])).toEqual([1]);
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

    it('moves every cursor with Option+ArrowRight', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'one two three');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('one two three'));

        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 5);

        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowRight', altKey: true});
        fireEvent.keyUp(blocks(left)[0], {key: 'ArrowRight', altKey: true});

        await waitFor(() => expect(domCaretOffset(blocks(left)[0])).toBe(7));
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([3]);
    });

    it('moves every cursor with Cmd+ArrowLeft', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nwxyz');
        await waitForBlockTexts(left, ['abcd', 'wxyz']);

        selectCaret(blocks(left)[0], 3);
        addCaret(blocks(left)[1], 2);

        fireEvent.keyDown(blocks(left)[1], {key: 'ArrowLeft', metaKey: true});
        fireEvent.keyUp(blocks(left)[1], {key: 'ArrowLeft', metaKey: true});

        await waitFor(() => expect(domCaretOffset(blocks(left)[1])).toBe(0));
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([0]);
    });

    it('moves every cursor with End', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nwxyz');
        await waitForBlockTexts(left, ['abcd', 'wxyz']);

        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[1], 2);

        fireEvent.keyDown(blocks(left)[1], {key: 'End'});
        fireEvent.keyUp(blocks(left)[1], {key: 'End'});

        await waitFor(() => expect(domCaretOffset(blocks(left)[1])).toBe(4));
        expect(retainedCaretOffsets(blocks(left)[0])).toEqual([4]);
    });

    it('extends every cursor with Shift+ArrowRight', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 3);

        fireEvent.keyDown(blocks(left)[0], {key: 'ArrowRight', shiftKey: true});
        fireEvent.keyUp(blocks(left)[0], {key: 'ArrowRight', shiftKey: true});
        selectCaret(blocks(right)[0], 0);

        await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('bd'));
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

const rangeAtBlockOffset = (block: HTMLElement, offset: number): Range => {
    const range = document.createRange();
    let remaining = offset;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Text | null;
    while ((current = walker.nextNode() as Text | null)) {
        const length = current.textContent?.length ?? 0;
        if (remaining <= length) {
            range.setStart(current, remaining);
            range.collapse(true);
            return range;
        }
        remaining -= length;
    }
    range.setStart(block, block.childNodes.length);
    range.collapse(true);
    return range;
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
