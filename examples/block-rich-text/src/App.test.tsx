import '../../../src/react/test-dom';

import {act, cleanup, fireEvent, render, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {App} from './App';
import {BLOCK_RICH_TEXT_MIME, htmlWithClipboardPayload, type RichClipboardPayload} from './clipboard';

const mermaidMock = vi.hoisted(() => ({
    initialize: vi.fn(),
    render: vi.fn(async () => ({svg: '<svg data-testid="mermaid-render"></svg>'})),
}));

vi.mock('mermaid', () => ({
    default: {
        initialize: mermaidMock.initialize,
        render: mermaidMock.render,
    },
}));

Object.defineProperty(globalThis, 'NodeFilter', {
    value: window.NodeFilter,
    configurable: true,
});

Object.defineProperty(globalThis, 'CSS', {
    value: {escape: (value: string) => value.replace(/"/g, '\\"')},
    configurable: true,
});

let restoreCaretGeometry: (() => void) | null = null;

beforeEach(() => {
    mermaidMock.initialize.mockReset();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({svg: '<svg data-testid="mermaid-render"></svg>'});
});

afterEach(() => {
    restoreCaretGeometry?.();
    restoreCaretGeometry = null;
    vi.restoreAllMocks();
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

const tableBlocks = (panel: HTMLElement): HTMLElement[] =>
    Array.from(
        within(panel)
            .getByRole('table', {name: 'Table block'})
            .querySelectorAll<HTMLElement>('.tableCell [role="textbox"][aria-label="Block text"]'),
    );

const tableBlockTexts = (panel: HTMLElement): string[] =>
    tableBlocks(panel).map(blockText);

const tableCells = (panel: HTMLElement): HTMLElement[] =>
    tableBlocks(panel).map((block) => block.closest<HTMLElement>('.tableCell')!);

const tableTitleBlock = (panel: HTMLElement): HTMLElement => {
    const title = panel.querySelector<HTMLElement>('.tableTitleRow [role="textbox"]');
    if (!title) throw new Error('missing table title');
    return title;
};

const kanbanBoards = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>('.kanbanBlock'));

const kanbanColumns = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>('.kanbanColumn'));

const kanbanCards = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>('.kanbanCard'));

const kanbanColumnTitle = (column: HTMLElement): string => {
    const title = column.querySelector<HTMLElement>('.kanbanColumnTitle[role="textbox"]');
    if (!title) throw new Error('missing kanban column title');
    return blockText(title);
};

const kanbanCardTitle = (card: HTMLElement): string => {
    const title = card.querySelector<HTMLElement>('.kanbanCardTitle[role="textbox"]');
    if (!title) throw new Error('missing kanban card title');
    return blockText(title);
};

const kanbanColumnCardTexts = (column: HTMLElement): string[] => {
    const cards = column.querySelector<HTMLElement>('.kanbanCards');
    if (!cards) throw new Error('missing kanban cards container');
    return Array.from(cards.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('kanbanCard'))
        .map(kanbanCardTitle);
};

const tableRowHeaders = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>('.tableRowHeaderText[role="textbox"]'));

const stubTableCellRects = (panel: HTMLElement, columnCount = 2) => {
    tableCells(panel).forEach((cell, index) => {
        const rowIndex = Math.floor(index / columnCount);
        const columnIndex = index % columnCount;
        cell.getBoundingClientRect = () =>
            ({
                left: 40 + columnIndex * 100,
                top: rowIndex * 50,
                right: 140 + columnIndex * 100,
                bottom: rowIndex * 50 + 50,
                width: 100,
                height: 50,
                x: 40 + columnIndex * 100,
                y: rowIndex * 50,
                toJSON: () => ({}),
            }) as DOMRect;
    });
};

const keyPerfMonitor = (view: ReturnType<typeof render>): HTMLElement =>
    view.getByLabelText('Keypress performance monitor');

const keyPerfBars = (view: ReturnType<typeof render>): HTMLElement[] =>
    Array.from(view.container.querySelectorAll<HTMLElement>('[data-testid="key-perf-bar"]'));

const keyPerfBarMs = (bar: HTMLElement): number => {
    const title = bar.getAttribute('title') ?? '';
    const match = title.match(/: ([\d.]+) ms$/);
    if (!match) throw new Error(`missing duration in key perf bar title: ${title}`);
    return Number(match[1]);
};

const rainbowNodes = (block: HTMLElement): HTMLElement[] =>
    Array.from(block.querySelectorAll<HTMLElement>('*')).filter(
        (element) => element.style.backgroundColor,
    );

const latestKeyPerfBarMs = async (view: ReturnType<typeof render>, label: string): Promise<number> => {
    const prefix = `${label}: `;
    const bar = await waitFor(() => {
        const found = keyPerfBars(view).findLast((candidate) =>
            (candidate.getAttribute('title') ?? '').startsWith(prefix),
        );
        if (!found) throw new Error(`missing key perf sample ${label}`);
        return found;
    });
    return keyPerfBarMs(bar);
};

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

const repeatedText = (length: number): string =>
    Array.from({length}, (_, index) => String.fromCharCode(97 + (index % 26))).join('');

const seventyWordsWithEveryFifthBold = (): {
    text: string;
    boldRanges: Array<{type: 'bold'; startOffset: number; endOffset: number}>;
} => {
    let offset = 0;
    const words: string[] = [];
    const boldRanges: Array<{type: 'bold'; startOffset: number; endOffset: number}> = [];
    for (let index = 0; index < 70; index++) {
        const word = `word${String(index).padStart(2, '0')}`;
        if (index % 5 === 0) {
            boldRanges.push({type: 'bold', startOffset: offset, endOffset: offset + word.length});
        }
        words.push(word);
        offset += word.length + 1;
    }
    return {text: words.join(' '), boldRanges};
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
            types: ['text/plain'],
            getData: () => text,
        },
    });
};

const pasteClipboard = (block: HTMLElement, data: Record<string, string>) => {
    fireEvent.paste(block, {
        clipboardData: {
            types: Object.keys(data),
            getData: (type: string) => data[type] ?? '',
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
    const range = rangeAtBlockOffset(block, offset);
    selection.removeAllRanges();
    selection.addRange(range);
};

const setDomRange = (block: HTMLElement, start: number, end: number) => {
    const selection = window.getSelection()!;
    const range = rangeAtBlockOffset(block, start);
    const endRange = rangeAtBlockOffset(block, end);
    range.setEnd(endRange.startContainer, endRange.startOffset);
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

const popoverDialogs = (panel: HTMLElement): HTMLElement[] =>
    within(panel).getAllByRole('dialog', {name: 'Popover'});

const queryPopoverDialogs = (panel: HTMLElement): HTMLElement[] =>
    within(panel).queryAllByRole('dialog', {name: 'Popover'});

const popoverMarks = (scope: HTMLElement): HTMLElement[] =>
    Array.from(scope.querySelectorAll<HTMLElement>('.markPopover'));

const footnoteReferences = (scope: HTMLElement): HTMLElement[] =>
    Array.from(scope.querySelectorAll<HTMLElement>('.footnoteReferenceNumber'));

const commentDots = (scope: HTMLElement): HTMLElement[] =>
    within(scope).queryAllByRole('button', {name: /Open comment on/});

const waitForPopoverDialogs = async (panel: HTMLElement, count: number): Promise<HTMLElement[]> =>
    waitFor(() => {
        const dialogs = popoverDialogs(panel);
        if (dialogs.length !== count) {
            throw new Error(`expected ${count} popovers, received ${dialogs.length}`);
        }
        return dialogs;
    });

const createPopoverOnMainText = async (
    panel: HTMLElement,
    text: string,
    start: number,
    end: number,
) => {
    selectCaret(blocks(panel)[0], 0);
    beforeInputText(blocks(panel)[0], text);
    await waitFor(() => expect(blocks(panel)[0].textContent).toBe(text));

    selectRange(blocks(panel)[0], start, end);
    fireEvent.click(within(panel).getByRole('button', {name: 'Popover'}));

    const mark = await waitFor(() => {
        const found = popoverMarks(blocks(panel)[0])[0];
        if (!found) throw new Error('missing inline popover mark');
        return found;
    });
    const popover = await waitFor(() => within(panel).getByRole('dialog', {name: 'Popover'}));
    return {mark, popover, body: within(popover).getByRole('textbox', {name: 'Annotation body'})};
};

const openPopoverFromMark = async (panel: HTMLElement, mark: HTMLElement): Promise<HTMLElement> => {
    fireEvent.mouseOver(mark);
    return waitFor(() => within(panel).getByRole('dialog', {name: 'Popover'}));
};

const typePopoverBody = async (popover: HTMLElement, text: string): Promise<HTMLElement> => {
    const body = within(popover).getByRole('textbox', {name: 'Annotation body'});
    selectCaret(body, 0);
    beforeInputText(body, text);
    await waitFor(() => expect(body.textContent).toBe(text));
    return within(popover).getByRole('textbox', {name: 'Annotation body'});
};

const createChildPopover = async (
    panel: HTMLElement,
    parentPopover: HTMLElement,
    start: number,
    end: number,
) => {
    const parentBody = within(parentPopover).getByRole('textbox', {name: 'Annotation body'});
    selectRange(parentBody, start, end);
    fireEvent.click(within(panel).getByRole('button', {name: 'Popover'}));
    const dialogs = await waitForPopoverDialogs(panel, 2);
    return {
        parentBody: within(parentPopover).getByRole('textbox', {name: 'Annotation body'}),
        childPopover: dialogs[1],
        childBody: within(dialogs[1]).getByRole('textbox', {name: 'Annotation body'}),
    };
};

const closePopoversBySelectingMainBlock = async (panel: HTMLElement) => {
    const block = blocks(panel)[0];
    fireEvent.mouseDown(block);
    selectCaret(block, 0);
    fireEvent.mouseUp(block);
    await waitFor(() => expect(queryPopoverDialogs(panel)).toHaveLength(0));
};

const pinElementRect = (
    element: HTMLElement,
    rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
) => {
    Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({...rect, x: rect.left, y: rect.top, toJSON: () => rect}),
    });
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

const dragElementTo = (element: HTMLElement, clientX: number, clientY: number) => {
    const handle = element as HTMLElement & {setPointerCapture?: (pointerId: number) => void};
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, {
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId: 1,
        clientX,
        clientY: clientY + 8,
    });
    fireEvent.pointerMove(window, {
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

const withCaretRangeFromPoints = (
    points: Array<{maxY: number; block: HTMLElement; offset: number}>,
    run: () => void,
) => {
    const documentWithCaretRange = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;
    Object.defineProperty(document, 'caretRangeFromPoint', {
        value: (_x: number, y: number) => {
            const point = points.find((candidate) => y <= candidate.maxY) ?? points[points.length - 1];
            if (!point) return null;
            const range = rangeAtBlockOffset(point.block, point.offset);
            range.collapse(true);
            return range;
        },
        configurable: true,
    });
    try {
        run();
    } finally {
        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: previousCaretRangeFromPoint,
            configurable: true,
        });
    }
};

const dragBlockHandle = (panel: HTMLElement, fromIndex: number, clientX: number, clientY: number) => {
    const handles = within(panel).getAllByRole('button', {name: 'Move block'});
    dragElementTo(handles[fromIndex], clientX, clientY);
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

    it('replaces the document from a fixture in both editors', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'simple-mixed-blocks'},
        });

        await waitFor(() => expect(view.getByText('Loaded fixture: Simple mixed blocks.')).toBeTruthy());
        expect(blockTexts(left).slice(0, 2)).toEqual([
            'Fixture document',
            'This paragraph has bold text, italic text, a link, and a popover note.',
        ]);
        expect(blockTexts(right).slice(0, 2)).toEqual(blockTexts(left).slice(0, 2));
    });

    it('loads generated fixture images and leaves missing images visible', async () => {
        const view = render(<App />);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'code-callouts-images'},
        });

        await waitFor(() => expect(view.getByText('Loaded fixture: Code, callouts, and images.')).toBeTruthy());
        expect(view.container.querySelectorAll('.imagePreview').length).toBeGreaterThan(0);
        expect(view.getAllByText('Missing image').length).toBeGreaterThan(0);
    });

    it('renders the large table fixture', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'large-table'},
        });

        await waitFor(() => expect(view.getByText('Loaded fixture: Large table.')).toBeTruthy());
        expect(tableBlocks(left)).toHaveLength(35);
        expect(tableBlocks(right)).toHaveLength(35);
    });

    it('renders the kanban board fixture', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'kanban-board'},
        });

        await waitFor(() => expect(view.getByText('Loaded fixture: Kanban board.')).toBeTruthy());
        expect(kanbanBoards(left)).toHaveLength(1);
        expect(kanbanBoards(right)).toHaveLength(1);
        expect(kanbanColumns(left)).toHaveLength(3);
        expect(kanbanCards(left).length).toBeGreaterThanOrEqual(6);
        expect(blockTexts(left)).toContain('Launch board');
        expect(blockTexts(left)).toContain('Draft release notes');
        expect(within(left).getAllByRole('button', {name: 'Move card'}).length).toBeGreaterThan(0);
    });

    it('drags a kanban card between columns through normal block movement', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'kanban-board'},
        });
        await waitFor(() => expect(view.getByText('Loaded fixture: Kanban board.')).toBeTruthy());

        const columns = kanbanColumns(left);
        const sourceCard = columns[0].querySelector<HTMLElement>('.kanbanCard')!;
        const targetCard = columns[1].querySelector<HTMLElement>('.kanbanCard')!;
        targetCard.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                right: 240,
                bottom: 48,
                width: 240,
                height: 48,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [targetCard];
        dragElementTo(within(sourceCard).getByRole('button', {name: 'Move card'}), 120, 40);
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() =>
            expect(kanbanColumnCardTexts(kanbanColumns(left)[1]).slice(0, 2)).toEqual([
                'QA import/export',
                'Draft release notes',
            ]),
        );
        expect(kanbanColumnCardTexts(kanbanColumns(left)[0])).not.toContain('Draft release notes');
    });

    it('shows only the child drop target when hovering a kanban card child zone', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'kanban-board'},
        });
        await waitFor(() => expect(view.getByText('Loaded fixture: Kanban board.')).toBeTruthy());

        const columns = kanbanColumns(left);
        const sourceCard = columns[0].querySelector<HTMLElement>('.kanbanCard')!;
        const targetCard = columns[1].querySelector<HTMLElement>('.kanbanCard')!;
        targetCard.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                right: 240,
                bottom: 48,
                width: 240,
                height: 48,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [targetCard];
        try {
            const handle = within(sourceCard).getByRole('button', {name: 'Move card'}) as HTMLElement & {
                setPointerCapture?: (pointerId: number) => void;
            };
            handle.setPointerCapture = () => {};
            fireEvent.pointerDown(handle, {
                button: 0,
                buttons: 1,
                isPrimary: true,
                pointerId: 1,
                clientX: 120,
                clientY: 32,
            });
            fireEvent.pointerMove(window, {
                button: 0,
                buttons: 1,
                isPrimary: true,
                pointerId: 1,
                clientX: 120,
                clientY: 24,
            });

            await waitFor(() => {
                expect(targetCard.classList.contains('dropAfter')).toBe(false);
                expect(targetCard.querySelector('.blockRow.dropAfter')).toBeTruthy();
            });

            fireEvent.pointerUp(window, {
                button: 0,
                buttons: 0,
                isPrimary: true,
                pointerId: 1,
                clientX: 120,
                clientY: 24,
            });
        } finally {
            document.elementsFromPoint = originalElementsFromPoint;
        }
    });

    it('shows only the block-row drop target when hovering before a kanban card', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'kanban-board'},
        });
        await waitFor(() => expect(view.getByText('Loaded fixture: Kanban board.')).toBeTruthy());

        const columns = kanbanColumns(left);
        const sourceCard = columns[0].querySelector<HTMLElement>('.kanbanCard')!;
        const targetCard = columns[1].querySelector<HTMLElement>('.kanbanCard')!;
        targetCard.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                right: 240,
                bottom: 48,
                width: 240,
                height: 48,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [targetCard];
        try {
            const handle = within(sourceCard).getByRole('button', {name: 'Move card'}) as HTMLElement & {
                setPointerCapture?: (pointerId: number) => void;
            };
            handle.setPointerCapture = () => {};
            fireEvent.pointerDown(handle, {
                button: 0,
                buttons: 1,
                isPrimary: true,
                pointerId: 1,
                clientX: 20,
                clientY: 18,
            });
            fireEvent.pointerMove(window, {
                button: 0,
                buttons: 1,
                isPrimary: true,
                pointerId: 1,
                clientX: 20,
                clientY: 12,
            });

            await waitFor(() => {
                expect(targetCard.classList.contains('dropBefore')).toBe(false);
                expect(targetCard.querySelector('.blockRow.dropBefore')).toBeTruthy();
            });

            fireEvent.pointerUp(window, {
                button: 0,
                buttons: 0,
                isPrimary: true,
                pointerId: 1,
                clientX: 20,
                clientY: 12,
            });
        } finally {
            document.elementsFromPoint = originalElementsFromPoint;
        }
    });

    it('drags a kanban column before another column through normal block movement', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'kanban-board'},
        });
        await waitFor(() => expect(view.getByText('Loaded fixture: Kanban board.')).toBeTruthy());

        const columns = kanbanColumns(left);
        const doneColumn = columns[2];
        const todoColumn = columns[0];
        todoColumn.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                right: 260,
                bottom: 180,
                width: 260,
                height: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [todoColumn];
        dragElementTo(within(doneColumn).getByRole('button', {name: 'Move column'}), 20, 40);
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() =>
            expect(kanbanColumns(left).map(kanbanColumnTitle)).toEqual(['done', 'todo', 'in progress']),
        );
    });

    it('opens populated mermaid fixture blocks in preview mode', async () => {
        const view = render(<App />);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'mermaid-diagram'},
        });

        await waitFor(() => expect(view.getByText('Loaded fixture: Mermaid diagram.')).toBeTruthy());
        const mermaidBlocks = Array.from(view.container.querySelectorAll<HTMLElement>('.previewCodeBlock'));
        expect(mermaidBlocks).toHaveLength(2);
        for (const block of mermaidBlocks) {
            expect(within(block).getByRole('button', {name: 'Preview'}).getAttribute('aria-pressed')).toBe('true');
            expect(within(block).queryByRole('textbox', {name: 'Block text'})).toBeNull();
        }
        await waitFor(() => expect(view.container.querySelectorAll('[data-testid="mermaid-render"]')).toHaveLength(2));
    });

    it('opens empty mermaid blocks in edit mode', () => {
        const view = render(<App />);
        const {left} = panels(view);

        setBlockType(left, 'mermaid');

        const mermaidBlock = left.querySelector<HTMLElement>('.previewCodeBlock');
        if (!mermaidBlock) throw new Error('missing mermaid block');
        expect(within(mermaidBlock).getByRole('button', {name: 'Edit'}).getAttribute('aria-pressed')).toBe('true');
        expect(within(mermaidBlock).getByRole('textbox', {name: 'Block text'})).toBeTruthy();
    });

    it('shows the preview checkbox only for previewable code languages', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        setBlockType(left, 'code');
        expect(within(left).queryByRole('checkbox', {name: 'Preview code'})).toBeNull();

        const language = within(left).getByRole('textbox', {name: 'Code language'});
        fireEvent.change(language, {target: {value: 'mermaid'}});

        const previewToggle = await waitFor(() =>
            within(left).getByRole('checkbox', {name: 'Preview code'}),
        );
        expect((previewToggle as HTMLInputElement).checked).toBe(false);
        fireEvent.click(previewToggle);

        await waitFor(() => {
            expect(left.querySelector('.previewCodeBlock')).toBeTruthy();
            expect(right.querySelector('.previewCodeBlock')).toBeTruthy();
        });
    });

    it('shows editor and preview together in split mode', async () => {
        const view = render(<App />);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'mermaid-diagram'},
        });

        await waitFor(() => expect(view.container.querySelectorAll('[data-testid="mermaid-render"]')).toHaveLength(2));
        const previewBlock = view.container.querySelector<HTMLElement>('.previewCodeBlock');
        if (!previewBlock) throw new Error('missing preview code block');

        fireEvent.click(within(previewBlock).getByRole('button', {name: 'Split'}));

        expect(within(previewBlock).getByRole('textbox', {name: 'Block text'})).toBeTruthy();
        expect(previewBlock.querySelector('[data-testid="mermaid-render"]')).toBeTruthy();
    });

    it('keeps the previous mermaid render visible while remote updates render', async () => {
        let pendingUpdateResolve: (() => void) | null = null;
        mermaidMock.render.mockImplementation(async () => {
            if (mermaidMock.render.mock.calls.length <= 2) {
                return {svg: '<svg data-testid="mermaid-render" data-render="initial"></svg>'};
            }
            return new Promise((resolve) => {
                pendingUpdateResolve = () =>
                    resolve({svg: '<svg data-testid="mermaid-render" data-render="updated"></svg>'});
            });
        });
        const view = render(<App />);
        const {left, right} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'mermaid-diagram'},
        });

        await waitFor(() => expect(view.container.querySelectorAll('[data-render="initial"]')).toHaveLength(2));
        const leftMermaid = left.querySelector<HTMLElement>('.previewCodeBlock');
        const rightMermaid = right.querySelector<HTMLElement>('.previewCodeBlock');
        if (!leftMermaid || !rightMermaid) throw new Error('missing mermaid block');

        fireEvent.click(within(leftMermaid).getByRole('button', {name: 'Edit'}));
        const editor = within(leftMermaid).getByRole('textbox', {name: 'Block text'});
        selectCaret(editor, blockText(editor).length);
        typeText(editor, ' ');

        await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(3));
        expect(within(rightMermaid).queryByText('Rendering diagram...')).toBeNull();
        expect(rightMermaid.querySelector('[data-render="initial"]')).toBeTruthy();

        await act(async () => {
            pendingUpdateResolve?.();
        });
        await waitFor(() => expect(rightMermaid.querySelector('[data-render="updated"]')).toBeTruthy());
    });

    it('keeps the previous mermaid render visible with an error overlay when remote updates fail', async () => {
        mermaidMock.render.mockImplementation(async () => {
            if (mermaidMock.render.mock.calls.length <= 2) {
                return {svg: '<svg data-testid="mermaid-render" data-render="initial"></svg>'};
            }
            throw new Error('Parse failed');
        });
        const view = render(<App />);
        const {left, right} = panels(view);

        fireEvent.change(view.getByLabelText('Replace document from fixture'), {
            target: {value: 'mermaid-diagram'},
        });

        await waitFor(() => expect(view.container.querySelectorAll('[data-render="initial"]')).toHaveLength(2));
        const leftMermaid = left.querySelector<HTMLElement>('.previewCodeBlock');
        const rightMermaid = right.querySelector<HTMLElement>('.previewCodeBlock');
        if (!leftMermaid || !rightMermaid) throw new Error('missing mermaid block');

        fireEvent.click(within(leftMermaid).getByRole('button', {name: 'Edit'}));
        const editor = within(leftMermaid).getByRole('textbox', {name: 'Block text'});
        selectCaret(editor, blockText(editor).length);
        typeText(editor, ' ');

        await waitFor(() => expect(within(rightMermaid).getByText('Parse failed')).toBeTruthy());
        expect(rightMermaid.querySelector('[data-render="initial"]')).toBeTruthy();
        expect(rightMermaid.querySelector('.codePreviewErrorOverlay')).toBeTruthy();
        expect(rightMermaid.querySelector('.codePreviewError')).toBeNull();

        typeText(editor, '!');

        await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(4));
        expect(within(rightMermaid).getByText('Parse failed')).toBeTruthy();
        expect(rightMermaid.querySelector('[data-render="initial"]')).toBeTruthy();
        expect(rightMermaid.querySelector('.codePreviewErrorOverlay')).toBeTruthy();
        expect(rightMermaid.querySelector('.codePreviewError')).toBeNull();
    });

    it('tracks empty editable blocks for the empty-block indicator', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        let block = blocks(left)[0];

        expect(block.getAttribute('data-empty')).toBe('true');

        selectCaret(block, 0);
        typeText(block, 'a');
        await waitFor(() => expect(block.getAttribute('data-empty')).toBeNull());

        selectCaret(block, 1);
        beforeInputDeleteBackward(block);
        await waitFor(() => expect(block.getAttribute('data-empty')).toBe('true'));

        block = blocks(left)[0];
        selectCaret(block, 0);
        beforeInputText(block, ' ');
        await waitFor(() => expect(block.getAttribute('data-empty')).toBeNull());
    });

    it('marks empty table editables for the empty-block indicator', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        expect(tableTitleBlock(left).getAttribute('data-empty')).toBe('true');
        expect(tableBlocks(left)[0].getAttribute('data-empty')).toBe('true');
        expect(within(left).getByRole('textbox', {name: 'Row header 1'}).getAttribute('data-empty')).toBe('true');
    });

    it('converts a block to a table from the block type menu', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Schedule');

        setBlockType(left, 'table');

        await waitFor(() => {
            expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy();
            expect(within(right).getByRole('table', {name: 'Table block'})).toBeTruthy();
        });
        expect(within(left).queryByRole('button', {name: 'Table'})).toBeNull();
        expect(blockText(tableTitleBlock(left))).toBe('Schedule');
        expect(blockText(tableTitleBlock(right))).toBe('Schedule');
        expect(tableBlocks(left)).toHaveLength(4);

        selectCaret(tableBlocks(left)[3], 0);
        fireEvent.keyDown(tableBlocks(left)[3], {key: 'Tab'});
        await waitFor(() => expect(tableBlocks(right)).toHaveLength(6));

        fireEvent.click(within(left).getByRole('button', {name: 'Add column 3'}));
        await waitFor(() => expect(tableBlocks(right)).toHaveLength(9));
    });

    it('converts a block to a kanban board from the block type menu', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Board');

        setBlockType(left, 'kanban');

        await waitFor(() => {
            expect(kanbanBoards(left)).toHaveLength(1);
            expect(kanbanBoards(right)).toHaveLength(1);
        });
        expect(kanbanColumns(left)).toHaveLength(3);
        expect(blockTexts(left).slice(0, 4)).toEqual(['Board', 'todo', 'in progress', 'done']);
        expect(within(left).getAllByRole('button', {name: 'Move column'})).toHaveLength(3);
    });

    it('converts a selected table header back to a normal block from the block type menu', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Schedule');
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableTitleBlock(left), 0);
        setBlockType(left, 'paragraph');

        await waitFor(() => {
            expect(within(left).queryByRole('table', {name: 'Table block'})).toBeNull();
            expect(within(right).queryByRole('table', {name: 'Table block'})).toBeNull();
        });
        expect(blockTexts(left)).toContain('Schedule');
        expect(blockTexts(right)).toContain('Schedule');
    });

    it('edits and splits the table title into a following paragraph', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        const title = tableTitleBlock(left);
        selectCaret(title, 0);
        typeText(title, 'AlphaBeta');
        await waitFor(() => expect(blockText(tableTitleBlock(right))).toBe('AlphaBeta'));

        selectCaret(tableTitleBlock(left), 5);
        fireEvent.keyDown(tableTitleBlock(left), {key: 'Enter'});

        await waitFor(() => {
            expect(blockText(tableTitleBlock(left))).toBe('Alpha');
            expect(blockTexts(left)).toContain('Beta');
        });
        expect(blockText(tableTitleBlock(right))).toBe('Alpha');
        expect(blockTexts(right)).toContain('Beta');
    });

    it('uses row-number placeholders and gutter row drag handles', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        expect(within(left).getByRole('textbox', {name: 'Row header 1'}).getAttribute('data-placeholder')).toBe('1');
        expect(within(left).getByRole('textbox', {name: 'Row header 2'}).getAttribute('data-placeholder')).toBe('2');
        expect(within(left).getByRole('button', {name: 'Move row 1'}).textContent).toBe('⋮');
        expect(within(left).getByRole('button', {name: 'Move row 2'}).textContent).toBe('⋮');
        expect(within(within(left).getByRole('table', {name: 'Table block'})).queryAllByRole('button', {name: 'Move block'})).toHaveLength(1);
    });

    it('highlights the active cell and drags a focused cell from its border', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        const firstCellBlock = tableBlocks(left)[0];
        selectCaret(firstCellBlock, 0);
        fireEvent.mouseUp(firstCellBlock);
        const firstCell = firstCellBlock.closest<HTMLElement>('.tableCell')!;
        expect(firstCell.classList.contains('activeTableCell')).toBe(true);

        const rows = Array.from(left.querySelectorAll<HTMLElement>('[data-row-id]'));
        rows.forEach((row, rowIndex) => {
            row.getBoundingClientRect = () =>
                ({
                    left: 0,
                    top: rowIndex * 50,
                    right: 340,
                    bottom: rowIndex * 50 + 50,
                    width: 340,
                    height: 50,
                    x: 0,
                    y: rowIndex * 50,
                    toJSON: () => ({}),
                }) as DOMRect;
            Array.from(row.querySelectorAll<HTMLElement>('.tableCell[data-cell-id]')).forEach((cell, cellIndex) => {
                cell.getBoundingClientRect = () =>
                    ({
                        left: 40 + cellIndex * 100,
                        top: rowIndex * 50,
                        right: 140 + cellIndex * 100,
                        bottom: rowIndex * 50 + 50,
                        width: 100,
                        height: 50,
                        x: 40 + cellIndex * 100,
                        y: rowIndex * 50,
                        toJSON: () => ({}),
                    }) as DOMRect;
            });
        });
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = (_x: number, y: number) => [rows[y >= 50 ? 1 : 0]];
        (firstCell as HTMLElement & {setPointerCapture?: (pointerId: number) => void}).setPointerCapture = () => {};

        fireEvent.pointerDown(firstCell, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        await waitFor(() => expect(firstCell.classList.contains('draggingCell')).toBe(true));
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 170,
            clientY: 70,
        });
        expect(left.querySelector('.cellDropBefore, .cellDropAfter')).toBeTruthy();
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 170,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['B', 'C', 'A', 'D']));
    });

    it('drags a normal block into a table cell boundary', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Title');
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});
        await waitFor(() => expect(blocks(left)).toHaveLength(2));
        selectCaret(blocks(left)[1], 0);
        typeText(blocks(left)[1], 'Outside');
        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'A');
        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe('A'));

        stubTableCellRects(left);
        const targetCell = tableCells(left)[0];
        const outsideBlock = blocks(left).find((block) => blockText(block) === 'Outside');
        if (!outsideBlock) throw new Error('missing outside block');
        const handle = outsideBlock.closest<HTMLElement>('.blockRow')?.querySelector<HTMLElement>('button[aria-label="Move block"]');
        if (!handle) throw new Error('missing outside block handle');
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [targetCell];
        dragElementTo(handle, 130, 20);
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left).slice(0, 2)).toEqual(['A', 'Outside']));
    });

    it('drags a selected table cell out to a normal block drop target', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Title');
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});
        await waitFor(() => expect(blocks(left)).toHaveLength(2));
        selectCaret(blocks(left)[1], 0);
        typeText(blocks(left)[1], 'Outside');
        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'A');
        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe('A'));

        stubTableCellRects(left);
        const firstCell = tableCells(left)[0];
        selectCaret(tableBlocks(left)[0], 0);
        fireEvent.mouseUp(tableBlocks(left)[0]);
        await waitFor(() => expect(firstCell.classList.contains('cellDragCandidate')).toBe(true));
        const outsideBlock = blocks(left).find((block) => blockText(block) === 'Outside');
        if (!outsideBlock) throw new Error('missing outside block');
        const outsideRowFor = () =>
            blocks(left)
                .find((block) => blockText(block) === 'Outside')
                ?.closest<HTMLElement>('.blockRow') ?? null;
        const outsideRow = outsideRowFor();
        if (!outsideRow) throw new Error('missing outside row');
        outsideRow.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 160,
                right: 340,
                bottom: 200,
                width: 340,
                height: 40,
                x: 0,
                y: 160,
                toJSON: () => ({}),
            }) as DOMRect;
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [outsideRow];

        fireEvent.pointerDown(firstCell, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 190,
        });
        await waitFor(() => expect(outsideRowFor()?.classList.contains('dropAfter')).toBe(true));
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 190,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => {
            const moved = blocks(left).find(
                (block) => blockText(block) === 'A' && !block.closest('.tableCell'),
            );
            expect(moved).toBeTruthy();
        });
    });

    it('drags selected cells into a row gap as a compact new row', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const rows = Array.from(left.querySelectorAll<HTMLElement>('.tableRow[data-row-id]'));
        rows.forEach((row, rowIndex) => {
            row.getBoundingClientRect = () =>
                ({
                    left: 0,
                    top: rowIndex * 50,
                    right: 340,
                    bottom: rowIndex * 50 + 50,
                    width: 340,
                    height: 50,
                    x: 0,
                    y: rowIndex * 50,
                    toJSON: () => ({}),
                }) as DOMRect;
        });
        selectCaret(tableBlocks(left)[0], 0);
        fireEvent.mouseUp(tableBlocks(left)[0]);
        const firstCell = tableCells(left)[0];
        const rowGap = left.querySelector<HTMLElement>('.tableRowInsertControl[data-after-row-id]');
        if (!rowGap) throw new Error('missing row gap');
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [rowGap];

        fireEvent.pointerDown(firstCell, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 52,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 52,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['B', 'A', 'C', 'D']));
    });

    it('tabs from a table cell into a single-cell block selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableBlocks(left)[0], 0);
        fireEvent.keyDown(tableBlocks(left)[0], {key: 'Tab'});
        fireEvent.keyUp(tableBlocks(left)[1], {key: 'Tab'});

        const secondCell = tableBlocks(left)[1].closest<HTMLElement>('.tableCell')!;
        await waitFor(() => {
            expect(secondCell.classList.contains('cellSelected')).toBe(true);
            expect(secondCell.classList.contains('cellSelectionFocus')).toBe(true);
        });
        expect(document.activeElement).toBe(secondCell);
        expect(window.getSelection()?.rangeCount).toBe(0);

        fireEvent.keyDown(secondCell, {key: 'X'});
        await waitFor(() => expect(tableBlockTexts(left)[1]).toBe('X'));
    });

    it('selects a table cell from its border', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        const targetCell = tableBlocks(left)[1].closest<HTMLElement>('.tableCell')!;
        targetCell.getBoundingClientRect = () =>
            ({
                left: 40,
                top: 0,
                right: 140,
                bottom: 50,
                width: 100,
                height: 50,
                x: 40,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        fireEvent.pointerDown(targetCell, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });

        await waitFor(() => {
            expect(targetCell.classList.contains('cellSelected')).toBe(true);
            expect(targetCell.classList.contains('cellSelectionFocus')).toBe(true);
        });
        expect(document.activeElement).toBe(targetCell);

        expect(targetCell.classList.contains('cellDragCandidate')).toBe(true);
        expect(targetCell.querySelectorAll('.tableCellDragEdge')).toHaveLength(2);
    });

    it('shows the cell drag affordance when text inside a table cell is selected', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'Cell text');
        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe('Cell text'));

        selectRange(tableBlocks(left)[0], 0, 4);
        fireEvent.mouseUp(tableBlocks(left)[0]);

        const activeCell = tableCells(left)[0];
        await waitFor(() => expect(activeCell.classList.contains('activeTableCell')).toBe(true));
        expect(activeCell.classList.contains('cellDragCandidate')).toBe(true);
        expect(activeCell.querySelectorAll('.tableCellDragEdge')).toHaveLength(2);
    });

    it('undoes while a table cell block selection is focused', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'A');
        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe('A'));

        stubTableCellRects(left);
        const targetCell = tableCells(left)[1];
        fireEvent.pointerDown(targetCell, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });

        await waitFor(() => {
            expect(targetCell.classList.contains('cellSelected')).toBe(true);
            expect(document.activeElement).toBe(targetCell);
        });

        fireEvent.keyDown(document.activeElement ?? targetCell, {key: 'z', metaKey: true});

        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe(''));
    });

    it('drags across table cell borders to create a rectangular cell selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        const cells = tableBlocks(left).map((block) => block.closest<HTMLElement>('.tableCell')!);
        cells.forEach((cell, index) => {
            const rowIndex = Math.floor(index / 2);
            const columnIndex = index % 2;
            cell.getBoundingClientRect = () =>
                ({
                    left: 40 + columnIndex * 100,
                    top: rowIndex * 50,
                    right: 140 + columnIndex * 100,
                    bottom: rowIndex * 50 + 50,
                    width: 100,
                    height: 50,
                    x: 40 + columnIndex * 100,
                    y: rowIndex * 50,
                    toJSON: () => ({}),
                }) as DOMRect;
        });

        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(cells[1].classList.contains('cellSelected')).toBe(true));

        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = (_x: number, y: number) => [cells[y >= 50 ? 2 : 1]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => {
            const selectedCells = tableBlocks(left).map((block) => block.closest<HTMLElement>('.tableCell')!);
            expect(selectedCells.map((cell) => cell.classList.contains('cellSelected'))).toEqual([
                true,
                true,
                true,
                true,
            ]);
            expect(selectedCells[2].classList.contains('cellSelectionFocus')).toBe(true);
        });
    });

    it('clears a partial table cell selection with Delete', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        fireEvent.keyDown(tableBlocks(left)[1], {key: 'Delete'});

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', '', 'C', 'D']));
    });

    it('deletes a full selected table row with Delete', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        let cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => {
            cells = tableCells(left);
            expect(cells[0].classList.contains('cellSelected')).toBe(true);
            expect(cells[1].classList.contains('cellSelected')).toBe(true);
        });

        fireEvent.keyDown(tableBlocks(left)[0], {key: 'Delete'});
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['C', 'D']));
    });

    it('deletes a full selected table column with Delete', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[2], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        await waitFor(() => expect(tableCells(left)[2].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => {
            const selectedCells = tableCells(left);
            expect(selectedCells[0].classList.contains('cellSelected')).toBe(true);
            expect(selectedCells[2].classList.contains('cellSelected')).toBe(true);
        });

        fireEvent.keyDown(tableBlocks(left)[0], {key: 'Delete'});
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['B', 'D']));
    });

    it('pastes a structured row below a full selected table row', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'X\tY',
            html: '<p>X</p><p>Y</p>',
            fragments: [
                {text: 'X', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
                {text: 'Y', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
            ],
            annotations: [],
            tsv: 'X\tY',
        };
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => expect(tableCells(left)[0].classList.contains('cellSelected')).toBe(true));

        pasteClipboard(tableBlocks(left)[0], {
            [BLOCK_RICH_TEXT_MIME]: JSON.stringify(payload),
            'text/plain': payload.plainText,
        });

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'X', 'Y', 'C', 'D']));
    });

    it('pastes a structured column beside a full selected table column', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'X\nY',
            html: '<p>X</p><p>Y</p>',
            fragments: [
                {text: 'X', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
                {text: 'Y', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
            ],
            annotations: [],
            tsv: 'X\nY',
        };
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[2], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        await waitFor(() => expect(tableCells(left)[2].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => expect(tableCells(left)[0].classList.contains('cellSelected')).toBe(true));

        pasteClipboard(tableBlocks(left)[0], {
            [BLOCK_RICH_TEXT_MIME]: JSON.stringify(payload),
            'text/plain': payload.plainText,
        });

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'X', 'B', 'C', 'Y', 'D']));
    });

    it('drags a full selected table column as a column', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[2], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        await waitFor(() => expect(tableCells(left)[2].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => expect(tableCells(left)[0].classList.contains('cellSelected')).toBe(true));

        const rows = Array.from(left.querySelectorAll<HTMLElement>('[data-row-id]'));
        document.elementsFromPoint = () => [rows[0]];
        fireEvent.pointerDown(tableCells(left)[0], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 2,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 2,
            clientX: 230,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 2,
            clientX: 230,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['B', 'A', 'D', 'C']));
    });

    it('drags a selected table rectangle as cell contents', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;
        await waitFor(() => {
            expect(tableCells(left)[0].classList.contains('cellSelected')).toBe(true);
            expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true);
        });

        const rows = Array.from(left.querySelectorAll<HTMLElement>('[data-row-id]'));
        document.elementsFromPoint = () => [rows[1]];
        fireEvent.pointerDown(tableCells(left)[0], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 2,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 2,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 2,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['', '', 'A', 'B']));
        expect(tableCells(left)[2].classList.contains('cellSelected')).toBe(true);
        expect(tableCells(left)[3].classList.contains('cellSelectionFocus')).toBe(true);
    });

    it('drags every table cell touched by a text selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        selectCaret(blocks(left)[0], 0);

        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());
        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        selectCrossBlockRange(tableBlocks(left)[0], 0, tableBlocks(left)[1], 1);
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellDragCandidate')).toBe(true));

        const rows = Array.from(left.querySelectorAll<HTMLElement>('[data-row-id]'));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [rows[1]];
        fireEvent.pointerDown(tableCells(left)[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['', '', 'A', 'B']));
        expect(tableCells(left)[2].classList.contains('cellSelected')).toBe(true);
        expect(tableCells(left)[3].classList.contains('cellSelectionFocus')).toBe(true);
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

    it('renders recipe ingredient line highlighting from the toolbar', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '1 cup flour, chopped');
        setBlockType(left, 'recipe-ingredient');

        await waitFor(() => {
            expect(blocks(left)[0].classList.contains('recipeIngredientBlock')).toBe(true);
            expect(blocks(left)[0].querySelector('.ingredient-amount')?.textContent).toBe('1');
            expect(blocks(left)[0].querySelector('.ingredient-unit')?.textContent).toBe('cup');
            expect(blocks(left)[0].querySelector('.ingredient-name')?.textContent).toBe('flour');
            expect(blocks(left)[0].querySelector('.ingredient-prep')?.textContent).toBe('chopped');
        });
        expect(blockText(blocks(left)[0])).toBe('1 cup flour, chopped');
        expect(blocks(right)[0].querySelector('.ingredient-name')?.textContent).toBe('flour');
        expect(within(left).getAllByRole('button', {name: 'Move block'})[0].textContent).toBe('🥕');

        selectRange(blocks(left)[0], 6, 11);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));
        await waitFor(() => {
            const ingredient = blocks(left)[0].querySelector('.ingredient-name');
            expect(ingredient?.textContent).toBe('flour');
            expect(ingredient?.classList.contains('markBold')).toBe(true);
        });

        setBlockType(left, 'paragraph');
        await waitFor(() => expect(blocks(left)[0].querySelector('.ingredient-name')).toBeNull());
    });

    it('opens a slash command menu after inserting a slash and closes it with Escape', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        const search = within(dialog).getByRole('textbox', {name: 'Search slash commands'});
        expect(document.activeElement).toBe(search);
        await waitForBlockTexts(left, ['/']);
        await waitForBlockTexts(right, ['/']);

        fireEvent.keyDown(dialog, {key: 'Escape'});
        await waitFor(() =>
            expect(within(left).queryByRole('dialog', {name: 'Slash commands'})).toBeNull(),
        );
        beforeInputText(blocks(left)[0], 'x');
        await waitForBlockTexts(left, ['/x']);
        await waitForBlockTexts(right, ['/x']);
    });

    it('filters slash commands without changing document text', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'date'},
        });

        expect(within(dialog).getByRole('option', {name: /Date/})).toBeTruthy();
        expect(within(dialog).queryByRole('option', {name: /Heading 2/})).toBeNull();
        await waitForBlockTexts(left, ['/']);
    });

    it('runs a slash block type command as slash deletion plus command', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.click(within(dialog).getByRole('option', {name: /Heading 2/}));

        await waitForBlockTexts(left, ['']);
        await waitFor(() => expect(blocks(left)[0].classList.contains('headingLevel2')).toBe(true));
        await waitForBlockTexts(right, ['']);
        expect(blocks(right)[0].classList.contains('headingLevel2')).toBe(true);
    });

    it('runs the slash ingredient command', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'ingredient'},
        });
        fireEvent.click(within(dialog).getByRole('option', {name: /Ingredient/}));

        await waitForBlockTexts(left, ['']);
        await waitFor(() => expect(blocks(left)[0].classList.contains('recipeIngredientBlock')).toBe(true));
        expect(blocks(right)[0].classList.contains('recipeIngredientBlock')).toBe(true);
    });

    it('runs a slash preview command and shows the URL empty state', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'preview'},
        });
        fireEvent.click(within(dialog).getByRole('option', {name: /Preview/}));

        await waitForBlockTexts(left, ['']);
        await waitFor(() => expect(within(left).getByRole('textbox', {name: 'Preview URL'})).toBeTruthy());
        expect(within(right).getByRole('textbox', {name: 'Preview URL'})).toBeTruthy();
    });

    it('runs a slash kanban command and creates default columns', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'kanban'},
        });
        fireEvent.click(within(dialog).getByRole('option', {name: /Kanban board/}));

        await waitFor(() => {
            expect(kanbanBoards(left)).toHaveLength(1);
            expect(kanbanBoards(right)).toHaveLength(1);
        });
        expect(blockTexts(left).slice(0, 4)).toEqual(['', 'todo', 'in progress', 'done']);
        expect(kanbanColumns(left)).toHaveLength(3);
    });

    it('converts a block to preview from the toolbar and rejects invalid URLs', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'preview');

        const input = await waitFor(() => within(left).getByRole('textbox', {name: 'Preview URL'}));
        fireEvent.change(input, {target: {value: 'example.test'}});
        fireEvent.keyDown(input, {key: 'Enter'});

        expect(within(left).getByText('Enter an absolute URL.')).toBeTruthy();
        expect(within(left).getByRole('textbox', {name: 'Preview URL'})).toBeTruthy();
    });

    it('commits preview URLs to both replicas', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('', {status: 404, statusText: 'Not Found'}),
        );
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'preview');

        const input = await waitFor(() => within(left).getByRole('textbox', {name: 'Preview URL'}));
        fireEvent.change(input, {target: {value: 'https://example.test/path#hash'}});
        fireEvent.keyDown(input, {key: 'Enter'});

        await waitFor(() => {
            expect(left.querySelector<HTMLAnchorElement>('.previewCardLink')?.href).toBe('https://example.test/path');
            expect(right.querySelector<HTMLAnchorElement>('.previewCardLink')?.href).toBe('https://example.test/path');
        });
    });

    it('stores fetched preview metadata in block meta and replicates the card', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                `
                    <html>
                        <head>
                            <meta property="og:title" content="Fetched Title">
                            <meta property="og:description" content="Fetched Description">
                            <meta property="og:site_name" content="Fetched Site">
                        </head>
                    </html>
                `,
                {status: 200},
            ),
        );
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'Local subtitle');
        setBlockType(left, 'preview');

        const input = await waitFor(() => within(left).getByRole('textbox', {name: 'Preview URL'}));
        fireEvent.change(input, {target: {value: 'https://example.test/card'}});
        fireEvent.keyDown(input, {key: 'Enter'});

        await waitFor(() => {
            expect(within(left).getByText('Fetched Title')).toBeTruthy();
            expect(within(right).getByText('Fetched Title')).toBeTruthy();
        });
        expect(blockTexts(left)).toEqual(['Local subtitle']);
        expect(blockTexts(right)).toEqual(['Local subtitle']);
    });

    it('edits an existing preview URL from the options menu', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('', {status: 404, statusText: 'Not Found'}),
        );
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'preview');

        let input = await waitFor(() => within(left).getByRole('textbox', {name: 'Preview URL'}));
        fireEvent.change(input, {target: {value: 'https://old.example'}});
        fireEvent.keyDown(input, {key: 'Enter'});
        await waitFor(() => expect(left.querySelector<HTMLAnchorElement>('.previewCardLink')?.href).toBe('https://old.example/'));

        fireEvent.click(within(left).getByRole('button', {name: 'Preview options'}));
        fireEvent.click(within(left).getByRole('menuitem', {name: 'Edit URL'}));
        input = await waitFor(() => within(left).getByRole('textbox', {name: 'Preview URL'}));
        fireEvent.change(input, {target: {value: 'https://new.example'}});
        fireEvent.keyDown(input, {key: 'Enter'});

        await waitFor(() => {
            expect(left.querySelector<HTMLAnchorElement>('.previewCardLink')?.href).toBe('https://new.example/');
            expect(right.querySelector<HTMLAnchorElement>('.previewCardLink')?.href).toBe('https://new.example/');
        });
    });

    it('runs a slash date embed command and tombstones the slash', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'date'},
        });
        fireEvent.click(within(dialog).getByRole('option', {name: /Date/}));

        await waitFor(() => {
            const embed = blocks(left)[0].querySelector<HTMLElement>('[data-inline-embed="true"]');
            expect(embed?.dataset.embedType).toBe('date');
            expect(embed?.querySelector('.inlineEmbedLabel')?.textContent).toBe('06/23/2026');
            expect(blockText(blocks(left)[0])).not.toContain('/');
        });
        await waitFor(() =>
            expect(
                blocks(right)[0]
                    .querySelector<HTMLElement>('[data-inline-embed="true"]')
                    ?.querySelector('.inlineEmbedLabel')?.textContent,
            ).toBe('06/23/2026'),
        );
    });

    it('runs slash commands across multiple cursors and deletes every inserted slash', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 3);

        beforeInputText(blocks(left)[0], '/');
        await waitForBlockTexts(left, ['a/bc/d']);

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.click(within(dialog).getByRole('option', {name: /Heading 2/}));

        await waitForBlockTexts(left, ['abcd']);
        await waitFor(() => expect(blocks(left)[0].classList.contains('headingLevel2')).toBe(true));
        expect(blockTexts(right)).toEqual(['abcd']);
        expect(blocks(right)[0].classList.contains('headingLevel2')).toBe(true);
    });

    it('inserts date embeds from slash commands across multiple cursors', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        selectCaret(blocks(left)[0], 1);
        addCaret(blocks(left)[0], 3);

        beforeInputText(blocks(left)[0], '/');
        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Search slash commands'}), {
            target: {value: 'date'},
        });
        fireEvent.click(within(dialog).getByRole('option', {name: /Date/}));

        await waitFor(() => {
            const embeds = blocks(left)[0].querySelectorAll('[data-inline-embed="true"]');
            expect(embeds).toHaveLength(2);
            expect(blockText(blocks(left)[0])).not.toContain('/');
        });
        await waitFor(() =>
            expect(blocks(right)[0].querySelectorAll('[data-inline-embed="true"]')).toHaveLength(2),
        );
    });

    it('does not open slash commands in code blocks', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'code');
        beforeInputText(blocks(left)[0], '/');

        await waitForBlockTexts(left, ['/']);
        await waitForBlockTexts(right, ['/']);
        expect(within(left).queryByRole('dialog', {name: 'Slash commands'})).toBeNull();
    });

    it('opens slash commands in table cells and row headers', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));

        selectCaret(tableBlocks(left)[0], 0);
        beforeInputText(tableBlocks(left)[0], '/');
        let dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        expect(dialog).toBeTruthy();
        fireEvent.keyDown(dialog, {key: 'Escape'});
        await waitFor(() =>
            expect(within(left).queryByRole('dialog', {name: 'Slash commands'})).toBeNull(),
        );

        selectCaret(tableRowHeaders(left)[0], 0);
        beforeInputText(tableRowHeaders(left)[0], '/');
        dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));
        expect(dialog).toBeTruthy();
    });

    it('still runs a slash command if the slash was already deleted', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], '/');
        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Slash commands'}));

        selectCaret(blocks(left)[0], 1);
        beforeInputDeleteBackward(blocks(left)[0]);
        await waitForBlockTexts(left, ['']);

        fireEvent.click(within(dialog).getByRole('option', {name: /Heading 2/}));
        await waitFor(() => expect(blocks(left)[0].classList.contains('headingLevel2')).toBe(true));
        expect(blockTexts(right)).toEqual(['']);
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

    it('shows trailing code newlines and exits code after two trailing blank lines', async () => {
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

        await waitForBlockTexts(left, ['ab\n\n']);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitForBlockTexts(left, ['ab\n', '']);
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

    it('keeps code Enter and Tab behavior inside table cells', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'ab');
        setBlockType(left, 'code');
        selectCaret(tableBlocks(left)[0], 1);
        fireEvent.keyDown(tableBlocks(left)[0], {key: 'Enter'});
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['a\nb', '', '', '']));

        selectCaret(tableBlocks(left)[0], 2);
        fireEvent.keyDown(tableBlocks(left)[0], {key: 'Tab'});
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['a\n    b', '', '', '']));
        expect(tableBlockTexts(right)).toEqual(['a\n    b', '', '', '']);
    });

    it('moves ArrowDown between table rows in the same column', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));
        installMockCaretGeometry(left);
        selectCaret(tableBlocks(left)[1], 0);
        typeText(tableBlocks(left)[1], 'abcd');
        selectCaret(tableBlocks(left)[3], 0);
        typeText(tableBlocks(left)[3], 'xy');

        selectCaret(tableBlocks(left)[1], 3);
        fireEvent.keyDown(tableBlocks(left)[1], {key: 'ArrowDown'});

        await waitFor(() => expect(domSelectionBlock()).toBe(tableBlocks(left)[3]));
        expect(domCaretOffset(tableBlocks(left)[3])).toBe(2);

        beforeInputText(tableBlocks(left)[3], 'X');
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['', 'abcd', '', 'xyX']));
        expect(tableBlockTexts(right)).toEqual(['', 'abcd', '', 'xyX']);
    });

    it('extends Shift+ArrowDown between table rows in the same column', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));
        installMockCaretGeometry(left);
        selectCaret(tableBlocks(left)[1], 0);
        typeText(tableBlocks(left)[1], 'abcd');
        selectCaret(tableBlocks(left)[3], 0);
        typeText(tableBlocks(left)[3], 'xy');

        selectCaret(tableBlocks(left)[1], 3);
        fireEvent.keyDown(tableBlocks(left)[1], {key: 'ArrowDown', shiftKey: true});
        fireEvent.keyUp(tableBlocks(left)[1], {key: 'ArrowDown', shiftKey: true});

        await waitFor(() => expect(domSelectionBlock()).toBe(tableBlocks(left)[3]));
        expect(domSelectionOffsets(tableBlocks(left)[3]).focus).toBe(2);
    });

    it('moves ArrowLeft from the first table cell to the row header', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));
        selectCaret(tableRowHeaders(left)[0], 0);
        typeText(tableRowHeaders(left)[0], 'Row');

        selectCaret(tableBlocks(left)[0], 0);
        fireEvent.keyDown(tableBlocks(left)[0], {key: 'ArrowLeft'});

        await waitFor(() => expect(domSelectionBlock()).toBe(tableRowHeaders(left)[0]));
        expect(domCaretOffset(tableRowHeaders(left)[0])).toBe(3);

        beforeInputText(tableRowHeaders(left)[0], '!');
        await waitFor(() => expect(blockText(tableRowHeaders(left)[0])).toBe('Row!'));
        expect(blockText(tableRowHeaders(right)[0])).toBe('Row!');
    });

    it('navigates with arrow keys from table row headers', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));
        installMockCaretGeometry(left);
        selectCaret(tableRowHeaders(left)[0], 0);
        typeText(tableRowHeaders(left)[0], 'abcd');
        selectCaret(tableRowHeaders(left)[1], 0);
        typeText(tableRowHeaders(left)[1], 'xy');
        selectCaret(tableBlocks(left)[1], 0);
        typeText(tableBlocks(left)[1], 'cell');

        selectCaret(tableRowHeaders(left)[0], 4);
        fireEvent.keyDown(tableRowHeaders(left)[0], {key: 'ArrowRight'});
        await waitFor(() => expect(domSelectionBlock()).toBe(tableBlocks(left)[0]));
        expect(domCaretOffset(tableBlocks(left)[0])).toBe(0);

        selectCaret(tableRowHeaders(left)[0], 3);
        fireEvent.keyDown(tableRowHeaders(left)[0], {key: 'ArrowDown'});
        await waitFor(() => expect(domSelectionBlock()).toBe(tableRowHeaders(left)[1]));
        expect(domCaretOffset(tableRowHeaders(left)[1])).toBe(2);

        fireEvent.keyDown(tableRowHeaders(left)[1], {key: 'ArrowUp'});
        await waitFor(() => expect(domSelectionBlock()).toBe(tableRowHeaders(left)[0]));
        expect(domCaretOffset(tableRowHeaders(left)[0])).toBe(3);

        selectCaret(tableRowHeaders(left)[1], 0);
        fireEvent.keyDown(tableRowHeaders(left)[1], {key: 'ArrowLeft'});
        await waitFor(() => expect(domSelectionBlock()).toBe(tableBlocks(left)[1]));
        expect(domCaretOffset(tableBlocks(left)[1])).toBe(4);

        beforeInputText(tableBlocks(left)[1], '!');
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['', 'cell!', '', '']));
        expect(tableBlockTexts(right)).toEqual(['', 'cell!', '', '']);
    });

    it('removes an empty table row with Backspace from its empty row header', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableRowHeaders(left)).toHaveLength(2));

        selectCaret(tableRowHeaders(left)[1], 0);
        fireEvent.keyDown(tableRowHeaders(left)[1], {key: 'Backspace'});

        await waitFor(() => expect(tableRowHeaders(left)).toHaveLength(1));
        expect(tableBlocks(left)).toHaveLength(2);
        expect(tableRowHeaders(right)).toHaveLength(1);
        expect(tableBlocks(right)).toHaveLength(2);
    });

    it('keeps a non-empty table row when Backspace starts in its empty row header', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableBlocks(left)).toHaveLength(4));
        selectCaret(tableBlocks(left)[2], 0);
        beforeInputText(tableBlocks(left)[2], 'cell');
        await waitFor(() => expect(tableBlockTexts(left)[2]).toBe('cell'));

        selectCaret(tableRowHeaders(left)[1], 0);
        fireEvent.keyDown(tableRowHeaders(left)[1], {key: 'Backspace'});

        await waitFor(() => expect(tableRowHeaders(left)).toHaveLength(2));
        expect(tableBlocks(left)).toHaveLength(4);
        expect(tableBlockTexts(left)[2]).toBe('cell');
        expect(tableRowHeaders(right)).toHaveLength(2);
        expect(tableBlocks(right)).toHaveLength(4);
        expect(tableBlockTexts(right)[2]).toBe('cell');
        await waitFor(() => expect(domSelectionBlock()).toBe(tableRowHeaders(left)[0]));
    });

    it('uses normal block shortcuts in table row headers', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableRowHeaders(left)).toHaveLength(2));

        const rowHeader = tableRowHeaders(left)[0];
        selectCaret(rowHeader, 0);
        beforeInputText(rowHeader, 'Row');
        await waitFor(() => expect(blockText(rowHeader)).toBe('Row'));

        selectRange(rowHeader, 0, 3);
        fireEvent.keyDown(rowHeader, {key: 'x', metaKey: true, shiftKey: true});

        await waitFor(() =>
            expect(tableRowHeaders(left)[0].querySelector('.markStrikethrough')?.textContent).toBe('Row'),
        );
        expect(tableRowHeaders(right)[0].querySelector('.markStrikethrough')?.textContent).toBe('Row');
    });

    it('changes table row header block types through the normal toolbar', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(tableRowHeaders(left)).toHaveLength(2));

        selectCaret(tableRowHeaders(left)[0], 0);
        setBlockType(left, 'heading2');

        await waitFor(() => expect(tableRowHeaders(left)[0].classList.contains('headingLevel2')).toBe(true));
        expect(tableRowHeaders(right)[0].classList.contains('headingLevel2')).toBe(true);
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

    it('renders code syntax highlighting with marks and retained selections', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'const answer = "yes";');
        setBlockType(left, 'code');
        const language = within(left).getByRole('textbox', {name: 'Code language'});
        fireEvent.change(language, {target: {value: 'js'}});

        await waitFor(() => {
            expect(blocks(left)[0].querySelector('.syntax-keyword')?.textContent).toBe('const');
            expect(blocks(left)[0].querySelector('.syntax-string')?.textContent).toBe('"yes"');
            expect(blocks(right)[0].querySelector('.syntax-keyword')?.textContent).toBe('const');
        });

        selectRange(blocks(left)[0], 0, 5);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));
        await waitFor(() => {
            const bold = blocks(left)[0].querySelector('.markBold');
            expect(bold?.textContent).toBe('const');
            expect(bold?.classList.contains('syntax-keyword')).toBe(true);
        });

        selectRange(blocks(right)[0], 15, 20);
        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'let ');

        await waitFor(() => {
            expect(retainedHighlightText(blocks(right)[0])).toBe('"yes"');
            expect(blocks(right)[0].querySelector('.retainedSelectionHighlight')?.classList.contains('syntax-string')).toBe(true);
        });

        fireEvent.change(language, {target: {value: 'made-up-language'}});
        await waitFor(() => {
            expect(blocks(left)[0].querySelector('.syntax-keyword')).toBeNull();
            expect(blocks(right)[0].querySelector('.syntax-keyword')).toBeNull();
            expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('const');
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

    it('selects a block from its drag handle', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'a\nb');
        await waitForBlockTexts(left, ['a', 'b']);

        const handle = within(left).getAllByRole('button', {name: 'Move block'})[1];
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});

        await waitFor(() =>
            expect(blocks(left)[1].closest('.blockRow')?.classList.contains('blockSelected')).toBe(true),
        );
        expect(blocks(left)[1].closest('.blockRow')?.classList.contains('blockSelectionFocus')).toBe(true);
        expect(document.activeElement).toBe(blocks(left)[1]);
    });

    it('types into a block selection at the end of the selected block', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        const handle = within(left).getByRole('button', {name: 'Move block'});
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});
        await waitFor(() =>
            expect(blocks(left)[0].closest('.blockRow')?.classList.contains('blockSelected')).toBe(true),
        );
        expect(document.activeElement).toBe(blocks(left)[0]);

        fireEvent.keyDown(blocks(left)[0], {key: 'X'});

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcX'));
        expect(blocks(right)[0].textContent).toBe('abcX');
    });

    it('pastes plain text into a block selection at the end of the selected block', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        const handle = within(left).getByRole('button', {name: 'Move block'});
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});
        await waitFor(() =>
            expect(blocks(left)[0].closest('.blockRow')?.classList.contains('blockSelected')).toBe(true),
        );
        expect(document.activeElement).toBe(blocks(left)[0]);

        pasteText(blocks(left)[0], 'X');

        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcX'));
        expect(blocks(right)[0].textContent).toBe('abcX');
    });

    it('creates a block after a block selection with Enter', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abc');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abc'));

        const handle = within(left).getByRole('button', {name: 'Move block'});
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});
        expect(document.activeElement).toBe(blocks(left)[0]);
        fireEvent.keyDown(blocks(left)[0], {key: 'Enter'});

        await waitForBlockTexts(left, ['abc', '']);
    });

    it('deletes a block selection with Delete', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'a\nb');
        await waitForBlockTexts(left, ['a', 'b']);

        const handle = within(left).getAllByRole('button', {name: 'Move block'})[0];
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});
        expect(document.activeElement).toBe(blocks(left)[0]);
        fireEvent.keyDown(blocks(left)[0], {key: 'Delete'});

        await waitForBlockTexts(left, ['b']);
        expect(blockTexts(right)).toEqual(['b']);
    });

    it('applies block type changes to a block selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'a\nb');
        await waitForBlockTexts(left, ['a', 'b']);

        const handle = within(left).getAllByRole('button', {name: 'Move block'})[1];
        fireEvent.pointerDown(handle, {button: 0, buttons: 1, isPrimary: true, pointerId: 1});
        fireEvent.pointerUp(window, {button: 0, buttons: 0, isPrimary: true, pointerId: 1});
        await waitFor(() =>
            expect(blocks(left)[1].closest('.blockRow')?.classList.contains('blockSelected')).toBe(true),
        );

        setBlockType(left, 'heading2');

        await waitFor(() => {
            expect(blocks(left)[0].classList.contains('headingLevel2')).toBe(false);
            expect(blocks(left)[1].classList.contains('headingLevel2')).toBe(true);
        });
    });

    it('drags every block touched by a text selection as a group', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'a\nb\nc\nd');
        await waitForBlockTexts(left, ['a', 'b', 'c', 'd']);
        installMockBlockRowGeometry(left);

        selectCrossBlockRange(blocks(left)[1], 0, blocks(left)[2], 1);
        dragBlockHandle(left, 1, 20, 200);

        await waitForBlockTexts(left, ['a', 'd', 'b', 'c']);
        expect(blockTexts(right)).toEqual(['a', 'd', 'b', 'c']);
        selectCaret(blocks(right)[0], 0);
        await waitFor(() => expect(retainedHighlightText(blocks(left)[2])).toBe('b'));
        expect(retainedHighlightText(blocks(left)[3])).toBe('c');
    });

    it('uses unordered list bullets as block drag handles', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        pasteText(blocks(left)[0], 'a\nb\nc');
        await waitForBlockTexts(right, ['a', 'b', 'c']);
        for (let index = 0; index < 3; index++) {
            selectCaret(blocks(right)[index], 0);
            setBlockType(right, 'unordered');
        }
        await waitFor(() => {
            expect([...right.querySelectorAll<HTMLButtonElement>('.blockAffordanceMarker')].map((marker) => marker.textContent)).toEqual([
                '•',
                '•',
                '•',
            ]);
        });

        installMockBlockRowGeometry(right);
        dragElementTo(right.querySelectorAll<HTMLElement>('.blockAffordanceMarker')[2], 20, 5);

        await waitForBlockTexts(right, ['c', 'a', 'b']);
        expect(blockTexts(left)).toEqual(['c', 'a', 'b']);
    });

    it('converts typed markdown bullet shortcuts through beforeinput', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];

        selectCaret(leftBlock, 0);
        beforeInputText(leftBlock, '- ');

        await waitForBlockTexts(left, ['']);
        expect(left.querySelector<HTMLElement>('.blockAffordanceMarker')?.textContent).toBe('•');
        expect(right.querySelector<HTMLElement>('.blockAffordanceMarker')?.textContent).toBe('•');
    });

    it('converts pasted markdown bullet shortcuts and syncs them to the peer', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], '- item');

        await waitForBlockTexts(left, ['item']);
        expect(left.querySelector<HTMLElement>('.blockAffordanceMarker')?.textContent).toBe('•');
        await waitForBlockTexts(right, ['item']);
        expect(right.querySelector<HTMLElement>('.blockAffordanceMarker')?.textContent).toBe('•');
    });

    it('copies block rich text data with plain text and HTML fallbacks', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const setData = vi.fn();

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'hello');
        selectRange(blocks(left)[0], 0, 5);

        fireEvent.copy(blocks(left)[0], {clipboardData: {setData}});

        expect(setData).toHaveBeenCalledWith('text/plain', 'hello');
        expect(setData).toHaveBeenCalledWith('text/html', expect.stringContaining('hello'));
        expect(setData).toHaveBeenCalledWith(
            'text/html',
            expect.stringContaining('<!--umkehr-block-rich-text:'),
        );
        expect(setData).toHaveBeenCalledWith(
            BLOCK_RICH_TEXT_MIME,
            expect.stringContaining('"plainText":"hello"'),
        );
    });

    it('copies selected table cells with TSV and rich clipboard data', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const setData = vi.fn();

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[2]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => {
            const selected = tableCells(left);
            expect(selected[0].classList.contains('cellSelected')).toBe(true);
            expect(selected[1].classList.contains('cellSelected')).toBe(true);
            expect(selected[2].classList.contains('cellSelected')).toBe(true);
            expect(selected[3].classList.contains('cellSelected')).toBe(true);
        });

        const activeElement = document.activeElement;
        expect(activeElement).toBe(tableCells(left)[1]);
        fireEvent.copy(activeElement as HTMLElement, {clipboardData: {setData}});

        expect(setData).toHaveBeenCalledWith('text/plain', 'A\tB\nC\tD');
        expect(setData).toHaveBeenCalledWith('text/tab-separated-values', 'A\tB\nC\tD');
        expect(setData).toHaveBeenCalledWith(
            'text/html',
            expect.stringContaining('<!--umkehr-block-rich-text:'),
        );
        expect(setData).toHaveBeenCalledWith(
            'text/html',
            expect.stringContaining('%22tsv%22%3A%22A%5CtB%5CnC%5CtD%22'),
        );
    });

    it('writes selected table cells to the clipboard on Cmd-C', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {writeText},
        });
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[2]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableCells(left)[3].classList.contains('cellSelected')).toBe(true));
        expect(document.activeElement).toBe(tableCells(left)[1]);
        fireEvent.keyDown(document.activeElement ?? tableCells(left)[1], {
            key: 'c',
            code: 'KeyC',
            metaKey: true,
        });

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('A\tB\nC\tD'));
    });

    it('pastes plain clipboard text from a native paste event with selected table cells', async () => {
        const readText = vi.fn();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {readText},
        });
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[2]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 70,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableCells(left)[3].classList.contains('cellSelected')).toBe(true));
        expect(document.activeElement).toBe(tableCells(left)[1]);
        fireEvent.paste(document.activeElement ?? tableCells(left)[1], {
            clipboardData: {
                types: ['text/plain'],
                getData: (type: string) => (type === 'text/plain' ? 'X' : ''),
            },
        });

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'CX', 'D']));
        expect(readText).not.toHaveBeenCalled();
    });

    it('pastes rich HTML clipboard data from a native paste event with a selected table row', async () => {
        const read = vi.fn();
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'X\nY',
            html: '<p>X</p><p>Y</p>',
            fragments: [
                {text: 'X', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
                {text: 'Y', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
            ],
            annotations: [],
            tsv: 'X\tY',
        };
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {read},
        });
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            selectCaret(tableBlocks(left)[index], 0);
            typeText(tableBlocks(left)[index], text);
        });
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'C', 'D']));

        stubTableCellRects(left);
        const cells = tableCells(left);
        fireEvent.pointerDown(cells[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true));
        const originalElementsFromPoint = document.elementsFromPoint;
        document.elementsFromPoint = () => [tableCells(left)[0]];
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 42,
            clientY: 20,
        });
        document.elementsFromPoint = originalElementsFromPoint;

        await waitFor(() => expect(tableCells(left)[0].classList.contains('cellSelected')).toBe(true));
        expect(document.activeElement).toBe(tableCells(left)[1]);
        fireEvent.paste(document.activeElement ?? tableCells(left)[1], {
            clipboardData: {
                types: ['text/html', 'text/plain'],
                getData: (type: string) =>
                    type === 'text/html'
                        ? htmlWithClipboardPayload(payload)
                        : type === 'text/plain'
                          ? payload.plainText
                          : '',
            },
        });

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['A', 'B', 'X', 'Y', 'C', 'D']));
        expect(read).not.toHaveBeenCalled();
    });

    it('pastes rich HTML clipboard data as children of a single selected table cell', async () => {
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'X\nY',
            html: '<p>X</p><p>Y</p>',
            fragments: [
                {text: 'X', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
                {text: 'Y', meta: {type: 'paragraph', ts: 'copy-ts'}, marks: []},
            ],
            annotations: [],
        };
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        setBlockType(left, 'table');
        await waitFor(() => expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy());

        selectCaret(tableBlocks(left)[0], 0);
        typeText(tableBlocks(left)[0], 'cell');
        await waitFor(() => expect(tableBlockTexts(left)[0]).toBe('cell'));

        stubTableCellRects(left);
        fireEvent.pointerDown(tableCells(left)[1], {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 142,
            clientY: 20,
        });
        await waitFor(() => {
            expect(tableCells(left)[1].classList.contains('cellSelected')).toBe(true);
            expect(document.activeElement).toBe(tableCells(left)[1]);
        });

        fireEvent.paste(tableCells(left)[1], {
            clipboardData: {
                types: ['text/html', 'text/plain'],
                getData: (type: string) =>
                    type === 'text/html'
                        ? htmlWithClipboardPayload(payload)
                        : type === 'text/plain'
                          ? payload.plainText
                          : '',
            },
        });

        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['cell', '', 'X', 'Y', '', '']));

        fireEvent.click(within(left).getByText('Undo'));
        await waitFor(() => expect(tableBlockTexts(left)).toEqual(['cell', '', '', '']));
    });

    it('pastes custom block rich text before falling back to plain text', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'rich',
            html: '<p><strong>rich</strong></p>',
            fragments: [
                {
                    text: 'rich',
                    meta: {type: 'paragraph', ts: 'copy-ts'},
                    marks: [{type: 'bold', startOffset: 0, endOffset: 4}],
                },
            ],
            annotations: [],
        };

        selectCaret(blocks(left)[0], 0);
        pasteClipboard(blocks(left)[0], {
            'text/html': htmlWithClipboardPayload(payload),
            'text/plain': 'plain',
        });

        await waitForBlockTexts(left, ['rich']);
        expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('rich');
    });

    it('nests indented pasted markdown list items', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], '- one\n  - two\n- three');

        await waitForBlockTexts(left, ['one', 'two', 'three']);
        expect(blockDepth(blocks(left)[0])).toBe('0');
        expect(blockDepth(blocks(left)[1])).toBe('1');
        expect(blockDepth(blocks(left)[2])).toBe('0');
        await waitForBlockTexts(right, ['one', 'two', 'three']);
        expect(blockDepth(blocks(right)[1])).toBe('1');
    });

    it('strips pasted markdown markers in table row headers', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        setBlockType(left, 'table');
        const leftRowHeader = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Row header 1'}),
        );

        selectCaret(leftRowHeader, 0);
        pasteText(leftRowHeader, '# Header');

        await waitFor(() => expect(blockText(leftRowHeader)).toBe('Header'));
        expect(blockText(within(right).getByRole('textbox', {name: 'Row header 1'}))).toBe('Header');
        expect(within(left).getByRole('table', {name: 'Table block'})).toBeTruthy();
    });

    it('uses ordered list numbers as block drag handles', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        pasteText(blocks(left)[0], 'a\nb\nc');
        await waitForBlockTexts(left, ['a', 'b', 'c']);
        for (let index = 0; index < 3; index++) {
            selectCaret(blocks(left)[index], 0);
            setBlockType(left, 'ordered');
        }
        await waitFor(() => {
            expect([...left.querySelectorAll<HTMLButtonElement>('.blockAffordanceMarker')].map((marker) => marker.textContent)).toEqual([
                '1.',
                '2.',
                '3.',
            ]);
        });

        installMockBlockRowGeometry(left);
        dragElementTo(left.querySelectorAll<HTMLElement>('.blockAffordanceMarker')[2], 20, 5);

        await waitForBlockTexts(left, ['c', 'a', 'b']);
    });

    it('uses one leading affordance slot for paragraph rows', () => {
        const view = render(<App />);
        const {left} = panels(view);
        const row = blocks(left)[0].closest<HTMLElement>('.blockRow')!;

        expect(row.querySelectorAll('.blockAffordance')).toHaveLength(1);
        expect(row.querySelector('.blockAffordanceHandle')).toBeTruthy();
        expect(row.querySelector('.dragHandle')).toBeNull();
        expect(row.querySelector('.blockMarker')).toBeNull();
    });

    it('toggles todos on click and drags them from the checkbox slot', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        pasteText(blocks(left)[0], 'a\nb');
        await waitForBlockTexts(right, ['a', 'b']);
        selectCaret(blocks(right)[0], 0);
        setBlockType(right, 'todo');

        const checkbox = within(right).getByRole('checkbox', {name: 'Toggle todo'}) as HTMLInputElement;
        (checkbox as HTMLInputElement & {setPointerCapture?: (pointerId: number) => void}).setPointerCapture = () => {};
        fireEvent.pointerDown(checkbox, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 8,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 8,
        });
        fireEvent.click(checkbox);
        await waitFor(() => expect(checkbox.checked).toBe(true));

        installMockBlockRowGeometry(right);
        const slot = checkbox.closest<HTMLElement>('[data-block-drag-affordance="todo"]')!;
        fireEvent.pointerDown(checkbox, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 88,
        });
        fireEvent.pointerMove(window, {
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 80,
        });
        fireEvent.pointerUp(window, {
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: 20,
            clientY: 80,
        });
        fireEvent.click(checkbox);

        await waitForBlockTexts(right, ['b', 'a']);
        expect(blockTexts(left)).toEqual(['b', 'a']);
        expect((within(right).getByRole('checkbox', {name: 'Toggle todo'}) as HTMLInputElement).checked).toBe(true);
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

    it('records DOM selection updates after a click starts in the performance monitor', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const documentWithCaretRange = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;

        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: () => rangeAtBlockOffset(blocks(left)[0], 0),
            configurable: true,
        });

        try {
            selectCaret(blocks(left)[0], 0);
            fireEvent.mouseDown(blocks(left)[0], {clientX: 10, clientY: 10});
            fireEvent(document, new window.Event('selectionchange'));

            await waitFor(() =>
                expect(within(keyPerfMonitor(view)).getByText('DOM selection')).toBeTruthy(),
            );
            expect(keyPerfBars(view)).toHaveLength(1);
        } finally {
            Object.defineProperty(document, 'caretRangeFromPoint', {
                value: previousCaretRangeFromPoint,
                configurable: true,
            });
        }
    });

    it('does not rewrite an already selected empty block when it is clicked again', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);
        const leftBlock = blocks(left)[0];
        const rightBlock = blocks(right)[0];
        const documentWithCaretRange = document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const previousCaretRangeFromPoint = documentWithCaretRange.caretRangeFromPoint;

        Object.defineProperty(document, 'caretRangeFromPoint', {
            value: () => rangeAtBlockOffset(leftBlock, 0),
            configurable: true,
        });

        try {
            selectCaret(leftBlock, 0);
            fireEvent.mouseUp(leftBlock);
            selectCaret(rightBlock, 0);
            fireEvent.mouseUp(rightBlock);

            await waitFor(() =>
                expect(leftBlock.querySelector('[data-retained-selection="caret"]')).toBeTruthy(),
            );

            const replaceChildren = vi.spyOn(HTMLElement.prototype, 'replaceChildren');
            const started = performance.now();
            fireEvent.mouseDown(leftBlock, {clientX: 10, clientY: 10});
            setDomCaret(leftBlock, 0);
            fireEvent.mouseUp(leftBlock, {clientX: 10, clientY: 10});
            const elapsed = performance.now() - started;

            expect(replaceChildren).not.toHaveBeenCalled();
            expect(elapsed).toBeLessThan(20);
        } finally {
            Object.defineProperty(document, 'caretRangeFromPoint', {
                value: previousCaretRangeFromPoint,
                configurable: true,
            });
        }
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

    it('shows an empty keypress performance monitor on initial render', () => {
        const view = render(<App />);
        const monitor = keyPerfMonitor(view);

        expect(within(monitor).getByText('Event ms')).toBeTruthy();
        expect(within(monitor).getByText('-- ms')).toBeTruthy();
        expect(within(monitor).getByText('No samples')).toBeTruthy();
        expect(
            (within(monitor).getByRole('checkbox', {name: 'Rainbow IDs'}) as HTMLInputElement)
                .checked,
        ).toBe(false);
        expect(keyPerfBars(view)).toHaveLength(0);
    });

    it('records printable text input in the keypress performance monitor', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');

        await waitFor(() => expect(keyPerfBars(view).length).toBeGreaterThanOrEqual(4));
        expect(within(keyPerfMonitor(view)).getByText(/\d(?:\.\d+)? ms$/)).toBeTruthy();
        expect(within(keyPerfMonitor(view)).getByText('Render b')).toBeTruthy();
    });

    it('keeps a single printable input in an empty document under the perf budget', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'a');

        await waitForBlockTexts(left, ['a']);
        expect(await latestKeyPerfBarMs(view, 'Render a')).toBeLessThan(5);
    });

    it('records handled keydown input in the keypress performance monitor', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'ab');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('ab'));

        selectCaret(blocks(left)[0], 2);
        fireEvent.keyDown(blocks(left)[0], {key: 'Backspace', code: 'Backspace'});

        await waitFor(() => expect(within(keyPerfMonitor(view)).getByText('Backspace')).toBeTruthy());
    });

    it('records paste input in the keypress performance monitor', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'hello');

        await waitFor(() => expect(within(keyPerfMonitor(view)).getByText('Paste')).toBeTruthy());
        expect(keyPerfBars(view).length).toBeGreaterThan(0);
    });

    it('keeps React render after typing in a 70 word block with every fifth word bolded close to plain text', async () => {
        const measureRenderAfterTyping = async (withMarks: boolean): Promise<number> => {
            const view = render(<App />);
            const {left} = panels(view);
            const {text, boldRanges} = seventyWordsWithEveryFifthBold();
            const payload: RichClipboardPayload = {
                version: 1,
                plainText: text,
                html: `<p>${text}</p>`,
                fragments: [
                    {
                        text,
                        meta: {type: 'paragraph', ts: 'copy-ts'},
                        marks: withMarks ? boldRanges : [],
                    },
                ],
                annotations: [],
            };

            selectCaret(blocks(left)[0], 0);
            pasteClipboard(blocks(left)[0], {
                [BLOCK_RICH_TEXT_MIME]: JSON.stringify(payload),
                'text/plain': text,
            });

            await waitForBlockTexts(left, [text]);
            if (withMarks) {
                expect(blocks(left)[0].querySelectorAll('.markBold')).toHaveLength(14);
            }
            selectCaret(blocks(left)[0], text.length);
            typeText(blocks(left)[0], 'Z');

            await waitForBlockTexts(left, [`${text}Z`]);
            const ms = await latestKeyPerfBarMs(view, 'Render Z');
            view.unmount();
            return ms;
        };

        await measureRenderAfterTyping(false);
        await measureRenderAfterTyping(true);
        const plainRenderMs = await measureRenderAfterTyping(false);
        const markedRenderMs = await measureRenderAfterTyping(true);

        expect(markedRenderMs).toBeLessThan(Math.max(1, plainRenderMs * 8));
    }, 30_000);

    it('toggles rainbow Lamport ID backgrounds per visible character', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        typeText(block, 'abc');
        await waitFor(() => expect(blockText(block)).toBe('abc'));
        expect(rainbowNodes(block)).toHaveLength(0);

        fireEvent.click(within(keyPerfMonitor(view)).getByRole('checkbox', {name: 'Rainbow IDs'}));

        await waitFor(() => expect(rainbowNodes(block).map((node) => node.textContent)).toEqual(['a', 'b', 'c']));
        expect(rainbowNodes(block).map((node) => node.style.backgroundColor)).toEqual([
            'rgb(255, 21, 0)',
            'rgb(255, 43, 0)',
            'rgb(255, 64, 0)',
        ]);

        fireEvent.click(within(keyPerfMonitor(view)).getByRole('checkbox', {name: 'Rainbow IDs'}));
        await waitFor(() => expect(rainbowNodes(block)).toHaveLength(0));
    });

    it('splits formatted runs per character in rainbow Lamport ID mode', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        typeText(block, 'abc');
        await waitFor(() => expect(blockText(block)).toBe('abc'));
        selectRange(block, 0, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));
        await waitFor(() => expect(block.querySelector('.markBold')?.textContent).toBe('abc'));

        fireEvent.click(within(keyPerfMonitor(view)).getByRole('checkbox', {name: 'Rainbow IDs'}));

        await waitFor(() => expect(rainbowNodes(block).map((node) => node.textContent)).toEqual(['a', 'b', 'c']));
        expect(rainbowNodes(block).every((node) => node.classList.contains('markBold'))).toBe(true);
    });

    it('colors inline embeds in rainbow Lamport ID mode', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.click(within(left).getByRole('button', {name: 'Date'}));

        const embed = await waitFor(() => {
            const found = blocks(left)[0].querySelector<HTMLElement>('[data-inline-embed="true"]');
            if (!found) throw new Error('missing inline embed');
            return found;
        });
        expect(embed.style.backgroundColor).toBe('');

        fireEvent.click(within(keyPerfMonitor(view)).getByRole('checkbox', {name: 'Rainbow IDs'}));

        await waitFor(() => {
            const colored = blocks(left)[0].querySelector<HTMLElement>('[data-inline-embed="true"]');
            expect(colored?.style.backgroundColor).toBe('rgb(255, 21, 0)');
        });
    });

    it('caps keypress performance bars to the latest samples', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], repeatedText(65));

        await waitFor(() => expect(keyPerfBars(view)).toHaveLength(60));
    });

    it('keeps keypress performance samples out of history export', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        let exportedBlob: Blob | null = null;
        const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            exportedBlob = blob as Blob;
            return 'blob:history';
        });
        const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const clickSpy = vi
            .spyOn(window.HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'a');
        await waitFor(() => expect(keyPerfBars(view).length).toBeGreaterThanOrEqual(2));
        expect(view.getByText('1 / 1')).toBeTruthy();

        fireEvent.click(view.getByText('Export'));

        expect(exportedBlob).toBeTruthy();
        const exported = JSON.parse(await exportedBlob!.text());
        expect(exported.keystrokes).toEqual([]);
        expect(exported.keyPerfSamples).toBeUndefined();

        createUrlSpy.mockRestore();
        revokeUrlSpy.mockRestore();
        clickSpy.mockRestore();
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

    it('inserts and edits a date inline embed from the toolbar', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'due ');
        fireEvent.click(within(left).getByRole('button', {name: 'Date'}));

        await waitFor(() => {
            const embed = blocks(left)[0].querySelector<HTMLElement>('[data-inline-embed="true"]');
            expect(embed?.dataset.embedType).toBe('date');
            expect(embed?.dataset.embedCharId).toBeTruthy();
            expect(embed?.querySelector('.inlineEmbedLabel')?.textContent).toBe('06/23/2026');
        });
        await waitFor(() =>
            expect(
                blocks(right)[0]
                    .querySelector<HTMLElement>('[data-inline-embed="true"]')
                    ?.querySelector('.inlineEmbedLabel')?.textContent,
            ).toBe('06/23/2026'),
        );

        fireEvent.click(blocks(left)[0].querySelector<HTMLElement>('[data-inline-embed="true"]')!);
        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Date embed'}));
        const input = within(dialog).getByLabelText('Date value') as HTMLInputElement;
        fireEvent.change(input, {target: {value: '2026-07-04'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Apply'}));

        await waitFor(() =>
            expect(
                blocks(left)[0]
                    .querySelector('[data-inline-embed="true"]')
                    ?.querySelector('.inlineEmbedLabel')?.textContent,
            ).toBe('07/04/2026'),
        );
        await waitFor(() =>
            expect(
                blocks(right)[0]
                    .querySelector<HTMLElement>('[data-inline-embed="true"]')
                    ?.querySelector('.inlineEmbedLabel')?.textContent,
            ).toBe('07/04/2026'),
        );
    });

    it('keeps a caret before an inline embed visible and editable', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        typeText(blocks(left)[0], 'due ');
        fireEvent.click(within(left).getByRole('button', {name: 'Date'}));

        const block = blocks(left)[0];
        const embed = await waitFor(() => {
            const element = block.querySelector<HTMLElement>('[data-inline-embed="true"]');
            expect(element).toBeTruthy();
            return element!;
        });

        const selection = window.getSelection()!;
        const range = document.createRange();
        const embedIndex = Array.prototype.indexOf.call(block.childNodes, embed);
        range.setStart(block, embedIndex);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        fireEvent.select(block);

        beforeInputText(block, 'now ');

        await waitFor(() => expect(blockText(block)).toBe(`due now \uFFFC`));
        expect(block.querySelector<HTMLElement>('[data-inline-embed="true"]')).toBeTruthy();
        expect(domSelectionBlock()).toBe(block);
        expect(domCaretOffset(block)).toBe(8);
    });

    it('uses Cmd+B as a pending bold style at a collapsed caret', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'a');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('a'));

        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});
        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('true'),
        );

        beforeInputText(blocks(left)[0], 'bc');

        await waitFor(() => expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('bc'));
        expect(blockText(blocks(left)[0])).toBe('abc');

        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});
        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('false'),
        );
        beforeInputText(blocks(left)[0], 'd');

        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('abcd'));
        expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('bc');
    });

    it('toggles pending bold off before typing', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});
        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});
        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('false'),
        );

        beforeInputText(blocks(left)[0], 'a');

        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('a'));
        expect(blocks(left)[0].querySelector('.markBold')).toBeNull();
    });

    it('keeps pending bold active when the caret moves', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.keyDown(blocks(left)[0], {key: 'b', metaKey: true});
        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('true'),
        );

        setDomCaret(blocks(left)[0], 0);
        fireEvent.mouseUp(blocks(left)[0]);
        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('true'),
        );

        beforeInputText(blocks(left)[0], 'a');

        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('a'));
        await waitFor(() => expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('a'));
    });

    it('uses Ctrl+B for pending bold at a collapsed caret', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.keyDown(blocks(left)[0], {key: 'b', ctrlKey: true});
        beforeInputText(blocks(left)[0], 'a');

        await waitFor(() => expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('a'));
    });

    it('uses pending italic and strikethrough at a collapsed caret', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        fireEvent.keyDown(blocks(left)[0], {key: 'i', metaKey: true});
        fireEvent.click(within(left).getByRole('button', {name: 'Strikethrough'}));
        beforeInputText(blocks(left)[0], 'a');

        await waitFor(() => {
            expect(blocks(left)[0].querySelector('.markItalic')?.textContent).toBe('a');
            expect(blocks(left)[0].querySelector('.markStrikethrough')?.textContent).toBe('a');
        });
    });

    it('applies inline code to ranges and pending collapsed typing', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Code'}));
        await waitFor(() => expect(blocks(left)[0].querySelector('.markCode')?.textContent).toBe('bc'));

        selectCaret(blocks(left)[0], 4);
        fireEvent.keyDown(blocks(left)[0], {key: 'e', metaKey: true});
        beforeInputText(blocks(left)[0], 'x');

        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('abcdx'));
        expect([...blocks(left)[0].querySelectorAll('.markCode')].map((node) => node.textContent)).toEqual([
            'bc',
            'x',
        ]);
    });

    it('edits inline code language from hover actions and highlights the marked range', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'const answer = 1;');
        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('const answer = 1;'));

        selectRange(blocks(left)[0], 0, 'const'.length);
        fireEvent.click(within(left).getByRole('button', {name: 'Code'}));
        await waitFor(() => expect(blocks(left)[0].querySelector('.markCode')).toBeTruthy());
        const code = blocks(left)[0].querySelector<HTMLElement>('.markCode')!;

        fireEvent.mouseOver(code);
        const actions = await waitFor(() => within(left).getByRole('dialog', {name: 'Inline code actions'}));
        fireEvent.click(within(actions).getByRole('button', {name: 'Edit'}));

        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Inline code language'}));
        const input = within(dialog).getByRole('textbox', {name: 'Code language'});
        fireEvent.change(input, {target: {value: 'ts'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Apply'}));

        await waitFor(() =>
            expect(blocks(left)[0].querySelector<HTMLElement>('.markCode')?.dataset.codeLanguage).toBe(
                'typescript',
            ),
        );
        expect(blocks(left)[0].querySelector('.syntax-keyword')?.textContent).toBe('const');

        fireEvent.mouseOver(blocks(left)[0].querySelector<HTMLElement>('.markCode')!);
        const updatedActions = await waitFor(() => within(left).getByRole('dialog', {name: 'Inline code actions'}));
        fireEvent.click(within(updatedActions).getByRole('button', {name: 'Edit'}));
        const clearDialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Inline code language'}));
        fireEvent.click(within(clearDialog).getByRole('button', {name: 'Clear language'}));

        await waitFor(() =>
            expect(blocks(left)[0].querySelector<HTMLElement>('.markCode')?.dataset.codeLanguage).toBe(''),
        );
    });

    it('shows toolbar pressed state when the next typed character will inherit a mark', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));
        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));
        await waitFor(() => expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('bc'));

        setDomCaret(blocks(left)[0], 2);
        fireEvent.mouseUp(blocks(left)[0]);

        await waitFor(() =>
            expect(within(left).getByRole('button', {name: 'B'}).getAttribute('aria-pressed')).toBe('true'),
        );

        beforeInputText(blocks(left)[0], 'X');

        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('abXcd'));
        expect(blocks(left)[0].querySelector('.markBold')?.textContent).toBe('bXc');
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

    it('toggles strikethrough with Cmd+Shift+X', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.keyDown(blocks(left)[0], {key: 'x', metaKey: true, shiftKey: true});

        await waitFor(() =>
            expect(blocks(left)[0].querySelector('.markStrikethrough')?.textContent).toBe('bc'),
        );
    });

    it('turns a link-like selection into a link with Cmd+K', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'https://example.test');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('https://example.test'));

        selectRange(blocks(left)[0], 0, 'https://example.test'.length);
        fireEvent.keyDown(blocks(left)[0], {key: 'k', metaKey: true});

        await waitFor(() => {
            const link = blocks(left)[0].querySelector<HTMLElement>('.markLink');
            expect(link?.textContent).toBe('https://example.test');
            expect(link?.dataset.linkHref).toBe('https://example.test');
        });
        expect(within(left).queryByRole('dialog', {name: 'Link'})).toBeNull();
    });

    it('does not open link or code popovers from direct mark clicks', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'https://example.test code');
        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('https://example.test code'));

        selectRange(blocks(left)[0], 0, 'https://example.test'.length);
        fireEvent.keyDown(blocks(left)[0], {key: 'k', metaKey: true});
        await waitFor(() => expect(blocks(left)[0].querySelector('.markLink')).toBeTruthy());

        const codeStart = 'https://example.test '.length;
        selectRange(blocks(left)[0], codeStart, codeStart + 'code'.length);
        fireEvent.click(within(left).getByRole('button', {name: 'Code'}));
        await waitFor(() => expect(blocks(left)[0].querySelector('.markCode')).toBeTruthy());

        fireEvent.click(blocks(left)[0].querySelector<HTMLElement>('.markLink')!);
        fireEvent.click(blocks(left)[0].querySelector<HTMLElement>('.markCode')!);

        expect(within(left).queryByRole('dialog', {name: 'Link'})).toBeNull();
        expect(within(left).queryByRole('dialog', {name: 'Link actions'})).toBeNull();
        expect(within(left).queryByRole('dialog', {name: 'Inline code language'})).toBeNull();
        expect(within(left).queryByRole('dialog', {name: 'Inline code actions'})).toBeNull();
    });

    it('pastes a link-like target over selected text as a link', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'link text');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('link text'));

        selectRange(blocks(left)[0], 0, 4);
        pasteText(blocks(left)[0], 'https://example.test');

        await waitFor(() => {
            expect(blocks(left)[0].textContent).toBe('link text');
            const link = blocks(left)[0].querySelector<HTMLElement>('.markLink');
            expect(link?.textContent).toBe('link');
            expect(link?.dataset.linkHref).toBe('https://example.test');
        });
    });

    it('shows link hover actions and edits/removes an existing link', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'https://example.test');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('https://example.test'));

        selectRange(blocks(left)[0], 0, 'https://example.test'.length);
        fireEvent.keyDown(blocks(left)[0], {key: 'k', metaKey: true});
        await waitFor(() => expect(blocks(left)[0].querySelector('.markLink')).toBeTruthy());

        const originalLink = blocks(left)[0].querySelector<HTMLElement>('.markLink')!;
        fireEvent.mouseOver(originalLink);
        const actions = await waitFor(() => within(left).getByRole('dialog', {name: 'Link actions'}));
        const url = within(actions).getByRole('link', {name: 'https://example.test'});
        expect(url.getAttribute('href')).toBe('https://example.test');
        expect(url.getAttribute('target')).toBe('_blank');
        expect(url.getAttribute('rel')).toBe('noreferrer');

        vi.useFakeTimers();
        fireEvent.mouseOut(originalLink);
        act(() => vi.advanceTimersByTime(99));
        expect(within(left).getByRole('dialog', {name: 'Link actions'})).toBeTruthy();
        act(() => vi.advanceTimersByTime(1));
        expect(within(left).queryByRole('dialog', {name: 'Link actions'})).toBeNull();
        vi.useRealTimers();

        fireEvent.mouseOver(originalLink);
        const editActions = await waitFor(() => within(left).getByRole('dialog', {name: 'Link actions'}));
        fireEvent.click(within(editActions).getByRole('button', {name: 'Edit'}));
        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Link'}));
        const input = within(dialog).getByRole('textbox', {name: 'Link target'});
        expect((input as HTMLInputElement).value).toBe('https://example.test');

        fireEvent.change(input, {target: {value: 'https://updated.test'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Apply'}));
        await waitFor(() =>
            expect(blocks(left)[0].querySelector<HTMLElement>('.markLink')?.dataset.linkHref).toBe(
                'https://updated.test',
            ),
        );

        fireEvent.mouseOver(blocks(left)[0].querySelector<HTMLElement>('.markLink')!);
        const updatedActions = await waitFor(() => within(left).getByRole('dialog', {name: 'Link actions'}));
        fireEvent.click(within(updatedActions).getByRole('button', {name: 'Edit'}));
        const removeDialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Link'}));
        fireEvent.click(within(removeDialog).getByRole('button', {name: 'Remove'}));

        await waitFor(() => expect(blocks(left)[0].querySelector('.markLink')).toBeNull());
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

    it('keeps remotely-created comments collapsed until a gutter dot is clicked', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(right)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        const leftBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        expect(domSelectionBlock()).toBe(leftBody);

        await waitFor(() => expect(commentDots(right)).toHaveLength(1));
        expect(within(right).queryByRole('textbox', {name: 'Annotation body'})).toBeNull();

        fireEvent.click(commentDots(right)[0]);
        const rightBody = await waitFor(() =>
            within(right).getByRole('textbox', {name: 'Annotation body'}),
        );
        expect(domSelectionBlock()).toBe(rightBody);
    });

    it('opens the collapsed sidebar and focuses a new local comment body', async () => {
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
        expect(domSelectionBlock()).toBe(commentBody);
        expect(commentDots(left)).toHaveLength(0);
    });

    it('splits a comment body with Enter and focuses the new sibling body', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blockText(blocks(left)[0])).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        const commentBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        selectCaret(commentBody, 0);
        beforeInputText(commentBody, 'note');
        await waitFor(() => expect(blockText(commentBody)).toBe('note'));

        selectCaret(commentBody, 2);
        fireEvent.keyDown(commentBody, {key: 'Enter'});

        const bodies = await waitFor(() => {
            const found = within(left).getAllByRole('textbox', {name: 'Annotation body'});
            expect(found).toHaveLength(2);
            expect(found.map(blockText)).toEqual(['no', 'te']);
            return found;
        });
        expect(domSelectionBlock()).toBe(bodies[1]);
        expect(domSelectionOffsets(bodies[1])).toEqual({anchor: 0, focus: 0});
        expect(document.activeElement).toBe(bodies[1]);
    });

    it('pastes 2000 characters into a comment body after commenting large text in less than 50ms', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const mainText = repeatedText(2000);
        const commentText = repeatedText(2000).replace(/^./, '1');

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], mainText);
        await waitForBlockTexts(left, [mainText]);

        selectRange(blocks(left)[0], 0, 10);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));
        const commentBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );

        selectCaret(commentBody, 0);
        const started = performance.now();
        pasteText(commentBody, commentText);
        const elapsed = performance.now() - started;

        await waitFor(() => expect(blockText(commentBody)).toBe(commentText));
        expect(elapsed).toBeLessThan(50);
    });

    it('shows one gutter dot per annotation and refocuses the most recently edited body', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));
        await waitFor(() =>
            expect(within(left).getAllByRole('textbox', {name: 'Annotation body'})).toHaveLength(1),
        );

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));
        let bodies = await waitFor(() => {
            const found = within(left).getAllByRole('textbox', {name: 'Annotation body'});
            expect(found).toHaveLength(2);
            return found;
        });
        expect(domSelectionBlock()).toBe(bodies[1]);

        selectCaret(bodies[0], 0);
        beforeInputText(bodies[0], 'first');
        await waitFor(() => expect(bodies[0].textContent).toBe('first'));

        fireEvent.click(within(left).getByRole('button', {name: 'Close comments'}));
        await waitFor(() => expect(commentDots(left)).toHaveLength(1));

        fireEvent.click(commentDots(left)[0]);
        bodies = await waitFor(() => {
            const found = within(left).getAllByRole('textbox', {name: 'Annotation body'});
            expect(found).toHaveLength(2);
            return found;
        });
        expect(domSelectionBlock()).toBe(bodies[0]);
    });

    it('supports strikethrough and links in comment body text', async () => {
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
        fireEvent.keyDown(commentBody, {key: 'x', metaKey: true, shiftKey: true});
        await waitFor(() => expect(commentBody.querySelector('.markStrikethrough')?.textContent).toBe('ot'));

        selectRange(commentBody, 0, 4);
        fireEvent.keyDown(commentBody, {key: 'k', metaKey: true});
        const dialog = await waitFor(() => within(left).getByRole('dialog', {name: 'Link'}));
        const input = within(dialog).getByRole('textbox', {name: 'Link target'});
        fireEvent.change(input, {target: {value: 'https://note.test'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Apply'}));

        await waitFor(() => {
            const links = [...commentBody.querySelectorAll<HTMLElement>('.markLink')];
            expect(links.map((link) => link.textContent).join('')).toBe('note');
            expect(links.every((link) => link.dataset.linkHref === 'https://note.test')).toBe(true);
        });
    });

    it('converts pasted markdown shortcuts in comment body text', async () => {
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
        pasteText(commentBody, '- note');

        await waitFor(() => expect(blockText(commentBody)).toBe('note'));
        expect(left.querySelector<HTMLElement>('.annotationBodyMarker')?.textContent).toBe('•');
    });

    it('pastes a link-like target over selected comment body text as a link', async () => {
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
        await waitFor(() => expect(blockText(commentBody)).toBe('note'));

        selectRange(commentBody, 0, 4);
        pasteText(commentBody, 'https://note.test');

        await waitFor(() => {
            expect(blockText(commentBody)).toBe('note');
            const links = [...commentBody.querySelectorAll<HTMLElement>('.markLink')];
            expect(links.map((link) => link.textContent).join('')).toBe('note');
            expect(links.every((link) => link.dataset.linkHref === 'https://note.test')).toBe(true);
        });
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

    it('renders inline footnote numbers in visible reference order', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'first second');
        await waitFor(() => expect(blockText(block)).toBe('first second'));

        selectRange(block, 6, 12);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));
        selectRange(block, 0, 5);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        await waitFor(() => {
            expect(footnoteReferences(block).map((node) => node.textContent)).toEqual(['1', '2']);
        });
        expect(blockText(block)).toBe('first second');
        expect(within(left).getAllByRole('listitem')).toHaveLength(2);
    });

    it('renders one footnote number after a multi-run reference', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcde');
        await waitFor(() => expect(blockText(block)).toBe('abcde'));

        selectRange(block, 1, 5);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));
        selectRange(block, 2, 4);
        fireEvent.click(within(left).getByRole('button', {name: 'B'}));

        await waitFor(() => {
            const references = footnoteReferences(block);
            expect(references.map((node) => node.textContent)).toEqual(['1']);
            expect(references[0].previousSibling?.textContent).toBe('e');
        });
    });

    it('keeps a caret before a footnote number when recording arrow navigation', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcd');
        await waitFor(() => expect(blockText(block)).toBe('abcd'));

        selectRange(block, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        const reference = await waitFor(() => {
            const found = footnoteReferences(block)[0];
            if (!found) throw new Error('missing footnote reference');
            return found;
        });

        setDomCaretBeforeNode(reference);
        expect(isDomCaretBeforeNode(reference)).toBe(true);

        fireEvent.keyUp(block, {key: 'ArrowLeft'});

        await waitFor(() => expect(isDomCaretBeforeNode(reference)).toBe(true));
        expect(domSelectionOffsets(block)).toEqual({anchor: 3, focus: 3});
    });

    it('keeps a caret after a footnote number when recording arrow navigation', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcd');
        await waitFor(() => expect(blockText(block)).toBe('abcd'));

        selectRange(block, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        const reference = await waitFor(() => {
            const found = footnoteReferences(block)[0];
            if (!found) throw new Error('missing footnote reference');
            return found;
        });

        setDomCaretAfterNode(reference);
        expect(isDomCaretAfterNode(reference)).toBe(true);

        fireEvent.keyUp(block, {key: 'ArrowRight'});

        await waitFor(() => expect(isDomCaretAfterNode(reference)).toBe(true));
        expect(domSelectionOffsets(block)).toEqual({anchor: 3, focus: 3});
    });

    it('renders overlapping footnote numbers at their respective boundaries', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcdef');
        await waitFor(() => expect(blockText(block)).toBe('abcdef'));

        selectRange(block, 1, 4);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));
        selectRange(block, 2, 5);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        await waitFor(() => {
            const references = footnoteReferences(block);
            expect(references.map((node) => node.textContent)).toEqual(['1', '2']);
            expect(references[0].previousSibling?.textContent?.endsWith('d')).toBe(true);
            expect(references[1].previousSibling?.textContent).toBe('e');
        });
    });

    it('renders inline footnote numbers inside annotation body editors', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcd');
        await waitFor(() => expect(blockText(block)).toBe('abcd'));

        selectRange(block, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Comment'}));

        const commentBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        selectCaret(commentBody, 0);
        beforeInputText(commentBody, 'note');
        await waitFor(() => expect(blockText(commentBody)).toBe('note'));

        selectRange(commentBody, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        await waitFor(() => {
            const references = footnoteReferences(commentBody);
            expect(references.map((node) => node.textContent)).toEqual(['1']);
            expect(blockText(commentBody)).toBe('note');
        });
    });

    it('splits a footnote body with Enter and focuses the new sibling body', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const block = blocks(left)[0];

        selectCaret(block, 0);
        beforeInputText(block, 'abcd');
        await waitFor(() => expect(blockText(block)).toBe('abcd'));

        selectRange(block, 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Footnote'}));

        const footnoteBody = await waitFor(() =>
            within(left).getByRole('textbox', {name: 'Annotation body'}),
        );
        selectCaret(footnoteBody, 0);
        beforeInputText(footnoteBody, 'note');
        await waitFor(() => expect(blockText(footnoteBody)).toBe('note'));

        selectCaret(footnoteBody, 2);
        fireEvent.keyDown(footnoteBody, {key: 'Enter'});

        const bodies = await waitFor(() => {
            const found = within(left).getAllByRole('textbox', {name: 'Annotation body'});
            expect(found).toHaveLength(2);
            expect(found.map(blockText)).toEqual(['no', 'te']);
            return found;
        });
        expect(domSelectionBlock()).toBe(bodies[1]);
        expect(domSelectionOffsets(bodies[1])).toEqual({anchor: 0, focus: 0});
        expect(document.activeElement).toBe(bodies[1]);
    });

    it('renders popover annotations inline as editable transition-managed popovers', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {mark: popoverMark, popover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        expect(popoverMark.textContent).toBe('bc');
        expect(popoverMark.dataset.popoverId).toBeTruthy();
        expect(within(left).queryByLabelText('Popovers')).toBeNull();

        const popoverBody = await typePopoverBody(popover, 'note');

        const {childPopover, childBody: childPopoverBody} = await createChildPopover(left, popover, 1, 3);
        const popoversWithChild = popoverDialogs(left);
        expect(popoversWithChild[0]).toBe(popover);
        expect(popoversWithChild[1]).toBe(childPopover);

        fireEvent.mouseOut(popoverMark, {relatedTarget: document.body});
        expect(popoverDialogs(left)).toHaveLength(2);

        fireEvent.mouseEnter(popover);
        expect(popoverDialogs(left)).toHaveLength(2);

        fireEvent.focus(childPopoverBody);
        fireEvent.mouseLeave(popover, {relatedTarget: document.body});
        expect(popoverDialogs(left)).toHaveLength(2);

        fireEvent.blur(childPopoverBody, {relatedTarget: document.body});
        expect(popoverDialogs(left)).toEqual([popover]);

        await closePopoversBySelectingMainBlock(left);
    });

    it('splits a popover body with Enter and focuses the new sibling body', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const {popover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        const popoverBody = await typePopoverBody(popover, 'note');

        selectCaret(popoverBody, 2);
        fireEvent.keyDown(popoverBody, {key: 'Enter'});

        const bodies = await waitFor(() => {
            const found = within(popover).getAllByRole('textbox', {name: 'Annotation body'});
            expect(found).toHaveLength(2);
            expect(found.map(blockText)).toEqual(['no', 'te']);
            return found;
        });
        expect(domSelectionBlock()).toBe(bodies[1]);
        expect(domSelectionOffsets(bodies[1])).toEqual({anchor: 0, focus: 0});
        expect(document.activeElement).toBe(bodies[1]);
    });

    it('keeps a hover popover open briefly when the pointer leaves toward it', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const popoverMark = popoverMarks(blocks(left)[0])[0];
        if (!popoverMark) throw new Error('missing inline popover mark');
        pinElementRect(popoverMark, {
            left: 100,
            top: 100,
            right: 140,
            bottom: 120,
            width: 40,
            height: 20,
        });

        const popover = await openPopoverFromMark(left, popoverMark);

        vi.useFakeTimers();
        fireEvent.mouseOut(popoverMark, {
            relatedTarget: document.body,
            clientX: 120,
            clientY: 124,
        });

        expect(popoverDialogs(left)).toEqual([popover]);
        act(() => vi.advanceTimersByTime(99));
        expect(popoverDialogs(left)).toEqual([popover]);

        fireEvent.mouseEnter(popover);
        act(() => vi.advanceTimersByTime(100));

        expect(popoverDialogs(left)).toEqual([popover]);
    });

    it('closes a hover popover immediately when the pointer leaves away from it', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const popoverMark = popoverMarks(blocks(left)[0])[0];
        if (!popoverMark) throw new Error('missing inline popover mark');
        pinElementRect(popoverMark, {
            left: 100,
            top: 100,
            right: 140,
            bottom: 120,
            width: 40,
            height: 20,
        });

        await openPopoverFromMark(left, popoverMark);

        fireEvent.mouseOut(popoverMark, {
            relatedTarget: document.body,
            clientX: 20,
            clientY: 124,
        });

        expect(queryPopoverDialogs(left)).toHaveLength(0);
    });

    it('keeps a parent popover visible when clicking a child popover', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const currentParentMark = popoverMarks(blocks(left)[0])[0];
        if (!currentParentMark) throw new Error('missing current parent popover mark');
        const reopenedParentPopover = await openPopoverFromMark(left, currentParentMark);
        const parentBody = await typePopoverBody(reopenedParentPopover, 'note');

        const {childPopover, childBody} = await createChildPopover(left, reopenedParentPopover, 1, 3);

        let dialogs = popoverDialogs(left);
        expect(dialogs).toHaveLength(2);
        expect(dialogs[0]).toBe(reopenedParentPopover);

        fireEvent.blur(parentBody, {relatedTarget: childBody});
        selectCaret(childBody, 0);
        fireEvent.mouseLeave(reopenedParentPopover, {relatedTarget: childPopover});
        fireEvent.mouseDown(childPopover);
        fireEvent.click(childPopover);

        dialogs = popoverDialogs(left);
        expect(dialogs).toHaveLength(2);
        expect(dialogs[0]).toBe(reopenedParentPopover);
    });

    it('keeps a parent popover visible when clicking a child popover mark', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const currentParentMark = popoverMarks(blocks(left)[0])[0];
        if (!currentParentMark) throw new Error('missing current parent popover mark');
        const parentPopover = await openPopoverFromMark(left, currentParentMark);
        await typePopoverBody(parentPopover, 'note');

        await createChildPopover(left, parentPopover, 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const reopenedParentMark = popoverMarks(blocks(left)[0])[0];
        if (!reopenedParentMark) throw new Error('missing reopened parent popover mark');
        const reopenedParentPopover = await openPopoverFromMark(left, reopenedParentMark);
        const reopenedParentBody = within(reopenedParentPopover).getByRole('textbox', {
            name: 'Annotation body',
        });
        const childMark = popoverMarks(reopenedParentBody)[0];
        if (!childMark) throw new Error('missing child popover mark');
        fireEvent.click(childMark);

        expect(popoverDialogs(left)).toHaveLength(2);
        expect(popoverDialogs(left)[0]).toBe(reopenedParentPopover);
    });

    it('hides a child popover when leaving the parent popover after hovering the child mark', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {popover: parentPopover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        await typePopoverBody(parentPopover, 'note');
        await createChildPopover(left, parentPopover, 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const parentMark = popoverMarks(blocks(left)[0])[0];
        if (!parentMark) throw new Error('missing parent popover mark');
        const reopenedParentPopover = await openPopoverFromMark(left, parentMark);
        const reopenedParentBody = within(reopenedParentPopover).getByRole('textbox', {
            name: 'Annotation body',
        });
        const childMark = popoverMarks(reopenedParentBody)[0];
        if (!childMark) throw new Error('missing child popover mark');

        fireEvent.mouseOver(childMark);
        await waitForPopoverDialogs(left, 2);

        fireEvent.mouseOut(childMark, {relatedTarget: document.body});
        fireEvent.mouseLeave(reopenedParentPopover, {relatedTarget: document.body});

        expect(queryPopoverDialogs(left)).toHaveLength(0);
    });

    it('hides the parent when leaving a child popover and the parent has no remaining reason', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {popover: parentPopover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        await typePopoverBody(parentPopover, 'note');
        await createChildPopover(left, parentPopover, 1, 3);
        await closePopoversBySelectingMainBlock(left);

        const parentMark = popoverMarks(blocks(left)[0])[0];
        if (!parentMark) throw new Error('missing parent popover mark');
        const reopenedParentPopover = await openPopoverFromMark(left, parentMark);
        const childMark = popoverMarks(
            within(reopenedParentPopover).getByRole('textbox', {name: 'Annotation body'}),
        )[0];
        if (!childMark) throw new Error('missing child popover mark');

        fireEvent.mouseOver(childMark);
        const childPopover = (await waitForPopoverDialogs(left, 2))[1];

        fireEvent.mouseLeave(childPopover, {relatedTarget: document.body});

        expect(queryPopoverDialogs(left)).toHaveLength(0);
    });

    it('hides a child hover popover when the parent popover has focus but the child mark is not selected', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {popover: parentPopover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        await typePopoverBody(parentPopover, 'note');
        await createChildPopover(left, parentPopover, 1, 3);

        const parentBodyWithChildMark = within(parentPopover).getByRole('textbox', {
            name: 'Annotation body',
        });
        selectCaret(parentBodyWithChildMark, 0);
        fireEvent.focus(parentBodyWithChildMark);
        const childMark = popoverMarks(parentBodyWithChildMark)[0];
        if (!childMark) throw new Error('missing child popover mark');

        fireEvent.mouseOver(childMark);
        await waitForPopoverDialogs(left, 2);

        fireEvent.mouseOut(childMark, {relatedTarget: parentBodyWithChildMark});

        const dialogs = popoverDialogs(left);
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]).toBe(parentPopover);

        fireEvent.mouseOver(childMark);
        expect(popoverDialogs(left)).toHaveLength(2);

        fireEvent.mouseOut(childMark, {relatedTarget: document.body});
        fireEvent.mouseLeave(parentPopover, {relatedTarget: document.body});

        const dialogsAfterLeavingParent = popoverDialogs(left);
        expect(dialogsAfterLeavingParent).toHaveLength(1);
        expect(dialogsAfterLeavingParent[0]).toBe(parentPopover);
    });

    it('closes a child popover when focus returns to the parent unless its mark is selected', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {popover: parentPopover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        const parentBody = await typePopoverBody(parentPopover, 'note');
        await createChildPopover(left, parentPopover, 1, 3);

        const childPopover = popoverDialogs(left)[1];
        const childBody = within(childPopover).getByRole('textbox', {name: 'Annotation body'});
        fireEvent.focus(childBody);
        expect(popoverDialogs(left)).toHaveLength(2);

        selectCaret(parentBody, 0);
        fireEvent.focus(parentBody);
        await waitFor(() =>
            expect(popoverDialogs(left)).toHaveLength(1),
        );
        expect(popoverDialogs(left)[0]).toBe(parentPopover);

        const childMark = popoverMarks(parentBody)[0];
        if (!childMark) throw new Error('missing child popover mark');
        fireEvent.click(childMark);
        await waitForPopoverDialogs(left, 2);

        const parentBodyWithSelectedChildMark = within(parentPopover).getByRole('textbox', {
            name: 'Annotation body',
        });
        selectRange(parentBodyWithSelectedChildMark, 1, 3);
        await waitForPopoverDialogs(left, 2);
    });

    it('opens every overlapping popover on hover and range selection', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        selectCaret(blocks(left)[0], 0);
        beforeInputText(blocks(left)[0], 'abcd');
        await waitFor(() => expect(blocks(left)[0].textContent).toBe('abcd'));

        selectRange(blocks(left)[0], 1, 3);
        fireEvent.click(within(left).getByRole('button', {name: 'Popover'}));
        await waitForPopoverDialogs(left, 1);

        selectRange(blocks(left)[0], 2, 4);
        fireEvent.click(within(left).getByRole('button', {name: 'Popover'}));
        await waitForPopoverDialogs(left, 1);

        const overlappingMark = async () =>
            waitFor(() => {
                const mark = popoverMarks(blocks(left)[0]).find(
                    (candidate) =>
                        candidate.textContent === 'c' &&
                        (candidate.dataset.popoverIds?.split(/\s+/).length ?? 0) === 2,
                );
                if (!mark) throw new Error('missing overlapping popover mark');
                return mark;
            });

        await overlappingMark();

        await closePopoversBySelectingMainBlock(left);
        fireEvent.mouseOver(await overlappingMark());
        let dialogs = await waitForPopoverDialogs(left, 2);
        expect(dialogs.map((dialog) => dialog.dataset.popoverId)).toEqual([
            expect.any(String),
            expect.any(String),
        ]);
        expect(new Set(dialogs.map((dialog) => dialog.dataset.popoverId)).size).toBe(2);

        await closePopoversBySelectingMainBlock(left);
        selectRange(blocks(left)[0], 1, 4);
        dialogs = await waitForPopoverDialogs(left, 2);
        expect(new Set(dialogs.map((dialog) => dialog.dataset.popoverId)).size).toBe(2);
    });

    it('closes popovers immediately when clicking outside the editor', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        expect(popoverDialogs(left)).toHaveLength(1);

        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(queryPopoverDialogs(left)).toHaveLength(0));
    });

    it('closes one editor popovers when switching focus to the other editor', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        await createPopoverOnMainText(left, 'abcd', 1, 3);
        expect(popoverDialogs(left)).toHaveLength(1);

        fireEvent.mouseDown(blocks(right)[0]);
        selectCaret(blocks(right)[0], 0);
        fireEvent.mouseUp(blocks(right)[0]);

        await waitFor(() => expect(queryPopoverDialogs(left)).toHaveLength(0));
    });

    it('closes nested popovers from deepest to parent with Escape', async () => {
        const view = render(<App />);
        const {left} = panels(view);

        const {popover: parentPopover} = await createPopoverOnMainText(left, 'abcd', 1, 3);
        await typePopoverBody(parentPopover, 'note');
        const {childBody} = await createChildPopover(left, parentPopover, 1, 3);
        expect(popoverDialogs(left)).toHaveLength(2);

        fireEvent.keyDown(childBody, {key: 'Escape'});
        await waitFor(() => expect(popoverDialogs(left)).toEqual([parentPopover]));

        fireEvent.keyDown(parentPopover, {key: 'Escape'});
        await waitFor(() => expect(queryPopoverDialogs(left)).toHaveLength(0));
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

    it('pastes 2000 characters into a single block in less than 100ms', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const text = repeatedText(2000);

        selectCaret(blocks(left)[0], 0);
        const started = performance.now();
        pasteText(blocks(left)[0], text);
        const elapsed = performance.now() - started;

        await waitForBlockTexts(left, [text]);
        expect(elapsed).toBeLessThan(100);
    });

    it('handles Enter at the end of the second 400 character pasted block in less than 50ms', async () => {
        const view = render(<App />);
        const {left} = panels(view);
        const lines = [repeatedText(400), repeatedText(400).replace(/^./, '1')];

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], lines.join('\n'));
        await waitForBlockTexts(left, lines);

        selectCaret(blocks(left)[1], 400);
        const started = performance.now();
        fireEvent.keyDown(blocks(left)[1], {key: 'Enter'});
        const elapsed = performance.now() - started;

        await waitForBlockTexts(left, [...lines, '']);
        expect(elapsed).toBeLessThan(50);
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

    it('plain-drags across blocks to create a text selection', async () => {
        const view = render(<App />);
        const {left, right} = panels(view);

        selectCaret(blocks(left)[0], 0);
        pasteText(blocks(left)[0], 'abcd\nwxyz');
        await waitForBlockTexts(left, ['abcd', 'wxyz']);

        withCaretRangeFromPoints(
            [
                {maxY: 20, block: blocks(left)[0], offset: 1},
                {maxY: 80, block: blocks(left)[1], offset: 2},
            ],
            () => {
                fireEvent.pointerDown(blocks(left)[0], {
                    button: 0,
                    buttons: 1,
                    isPrimary: true,
                    pointerId: 1,
                    clientX: 10,
                    clientY: 10,
                });
                fireEvent.pointerMove(window, {
                    button: 0,
                    buttons: 1,
                    isPrimary: true,
                    pointerId: 1,
                    clientX: 12,
                    clientY: 60,
                });
                fireEvent.pointerUp(window, {
                    button: 0,
                    buttons: 0,
                    isPrimary: true,
                    pointerId: 1,
                    clientX: 12,
                    clientY: 60,
                });
            },
        );
        selectCaret(blocks(right)[0], 0);

        await waitFor(() => expect(retainedHighlightText(blocks(left)[0])).toBe('bcd'));
        expect(retainedHighlightText(blocks(left)[1])).toBe('wx');
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
    let current: Text | null;
    while ((current = walker.nextNode() as Text | null)) {
        if (!isTestOffsetSentinel(current)) return current;
    }
    return null;
};

const rangeAtBlockOffset = (block: HTMLElement, offset: number): Range => {
    const range = document.createRange();
    let remaining = offset;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Text | null;
    while ((current = walker.nextNode() as Text | null)) {
        if (isTestOffsetSentinel(current)) continue;
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

const isDomCaretBeforeNode = (node: Node): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const before = document.createRange();
    before.setStartBefore(node);
    before.collapse(true);
    if (range.compareBoundaryPoints(0, before) === 0) return true;
    if (range.compareBoundaryPoints(0, before) > 0) return false;
    const between = document.createRange();
    between.setStart(range.startContainer, range.startOffset);
    between.setEnd(before.startContainer, before.startOffset);
    return between.toString() === '';
};

const isDomCaretAfterNode = (node: Node): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    if (range.compareBoundaryPoints(0, after) === 0) return true;
    if (range.compareBoundaryPoints(0, after) < 0) return false;
    const between = document.createRange();
    between.setStart(after.startContainer, after.startOffset);
    between.setEnd(range.startContainer, range.startOffset);
    return between.toString() === '';
};

const setDomCaretBeforeNode = (node: Node) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStartBefore(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
};

const setDomCaretAfterNode = (node: Node) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
};

const domPointOffset = (block: HTMLElement, node: Node | null, nodeOffset: number): number => {
    if (!node || !block.contains(node)) return -1;
    if (node === block) {
        let offset = 0;
        for (let index = 0; index < nodeOffset && index < block.childNodes.length; index++) {
            if (isTestOffsetSentinel(block.childNodes[index])) continue;
            offset += block.childNodes[index].textContent?.length ?? 0;
        }
        return offset;
    }
    let offset = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isTestOffsetSentinel(current)) continue;
        if (current === node) return offset + nodeOffset;
        offset += current.textContent?.length ?? 0;
    }
    return -1;
};

const isTestOffsetSentinel = (node: Node): boolean => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return Boolean(element?.closest('[data-offset-sentinel="true"]'));
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
