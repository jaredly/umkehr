import '../../../src/react/test-dom';

import {cleanup, fireEvent, render, waitFor, within} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {App} from './App';

Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
});

Object.defineProperty(globalThis, 'DOMRect', {
    value: window.DOMRect,
    configurable: true,
});

Object.defineProperty(globalThis, 'NodeFilter', {
    value: window.NodeFilter,
    configurable: true,
});

Object.defineProperty(globalThis, 'Range', {
    value: window.Range,
    configurable: true,
});

Object.defineProperty(globalThis, 'CSS', {
    value: {escape: (value: string) => value.replace(/"/g, '\\"')},
    configurable: true,
});

HTMLElement.prototype.scrollIntoView ??= function () {};
window.Range.prototype.getClientRects ??= function () {
    return [new DOMRect(0, 0, 1, 16)] as unknown as DOMRectList;
};
window.Range.prototype.getBoundingClientRect ??= function () {
    return new DOMRect(12, 12, 80, 18);
};

afterEach(() => {
    cleanup();
});

describe('Plim block CRDT example app', () => {
    it('renders two initial CRDT-backed editor panes and collapsed debug panes', async () => {
        const view = render(<App />);

        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        expect(view.queryByRole('button', {name: 'Remote Insert'})).toBeNull();
        expect(view.queryByRole('button', {name: 'Remote Split'})).toBeNull();
        for (const pane of [left, right]) {
            expect(editorText(pane)).toContain('Hello 👩‍💻');
            expect(editorText(pane)).toContain('Roadmap');
            expect(editorText(pane)).toContain('Ship adapter');
            expect(within(pane).getByText('0 queued')).toBeTruthy();
        }
        expect(debugDetails(view, 'Editor A').open).toBe(false);
        expect(debugDetails(view, 'Editor B').open).toBe(false);
        expect(debugSection(view, 'Editor A', 'CRDT Text').textContent).toContain('Hello 👩‍💻');
        expect(debugSection(view, 'Editor B', 'Plim JSON').textContent).toContain('"type": "heading"');
    });

    it('syncs text inserted in the left pane to the right pane', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        fireBeforeInput(firstContent(left), 'X');

        await waitFor(() => {
            expect(editorText(left)).toContain('XHello 👩‍💻');
            expect(editorText(right)).toContain('XHello 👩‍💻');
            expect(debugSection(view, 'Editor A', 'CRDT Text').textContent).toContain('XHello 👩‍💻');
            expect(debugSection(view, 'Editor B', 'CRDT Text').textContent).toContain('XHello 👩‍💻');
        });
        expect(plimState(view, 'Editor A').selection.head.offset).toBe(1);
        expect(logDetails(view).textContent).toContain('left tx: replaceText');
        expect(logDetails(view).textContent).toContain('left sync -> right');
    });

    it('undoes and redoes a local edit through CRDT ops', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        fireBeforeInput(firstContent(left), 'U');
        await waitFor(() => {
            expect(editorText(left)).toContain('UHello 👩‍💻');
            expect(editorText(right)).toContain('UHello 👩‍💻');
        });

        fireEvent.click(within(left).getByRole('button', {name: 'Undo'}));
        await waitFor(() => {
            expect(editorText(left)).not.toContain('UHello 👩‍💻');
            expect(editorText(right)).not.toContain('UHello 👩‍💻');
            expect((within(left).getByRole('button', {name: 'Redo'}) as HTMLButtonElement).disabled).toBe(false);
        });
        expect(logDetails(view).textContent).toContain('left undo replaceText');

        fireEvent.click(within(left).getByRole('button', {name: 'Redo'}));
        await waitFor(() => {
            expect(editorText(left)).toContain('UHello 👩‍💻');
            expect(editorText(right)).toContain('UHello 👩‍💻');
        });
        expect(logDetails(view).textContent).toContain('left redo replaceText');
    });

    it('handles keyboard undo in the active pane', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');
        const content = firstContent(left);

        fireBeforeInput(content, 'K');
        await waitFor(() => expect(editorText(right)).toContain('KHello 👩‍💻'));

        const editor = content.closest<HTMLElement>('.plim-editor');
        editor?.focus();
        fireEvent.keyDown(editor ?? content, {key: 'z', code: 'KeyZ', ctrlKey: true});

        await waitFor(() => {
            expect(editorText(left)).not.toContain('KHello 👩‍💻');
            expect(editorText(right)).not.toContain('KHello 👩‍💻');
        });
    });

    it('undoes a markdown list shortcut and then the restored marker text', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        setDomCaretAtEnd(content);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => expect(plimState(view, 'Editor A').selection.head.offset).toBe('Hello 👩‍💻'.length));

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        const empty = await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([1]);
            return blockContent(left, state.doc.children[1].id);
        });

        fireBeforeInput(empty, '-');
        const marker = await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].text?.map((span) => span.text).join('')).toBe('-');
            return blockContent(left, state.doc.children[1].id);
        });
        fireBeforeInput(marker, ' ');

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].type).toBe('bulleted_list_item');
            expect(state.doc.children[1].text).toEqual([]);
        });

        const editor = left.querySelector<HTMLElement>('.plim-editor');
        editor?.focus();
        fireEvent.keyDown(editor ?? left, {key: 'z', code: 'KeyZ', ctrlKey: true});

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].type).toBe('paragraph');
            expect(state.doc.children[1].text?.map((span) => span.text).join('')).toBe('- ');
        });

        fireEvent.keyDown(editor ?? left, {key: 'z', code: 'KeyZ', ctrlKey: true});

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].type).toBe('paragraph');
            expect(state.doc.children[1].text?.map((span) => span.text).join('')).toBe('-');
            expect(logDetails(view).textContent).not.toContain('undo skipped: no effect');
        });
    });

    it('does not move focus to the peer pane after an online sync', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');
        const content = firstContent(left);

        setDomCaret(content, 0);
        content.closest<HTMLElement>('.plim-editor')?.focus();

        fireBeforeInput(content, 'F');

        await waitFor(() => {
            expect(editorText(right)).toContain('FHello 👩‍💻');
            expect(left.contains(document.activeElement)).toBe(true);
            const selection = window.getSelection();
            expect(selection?.focusNode ? left.contains(selection.focusNode) : false).toBe(true);
            expect(selection?.focusNode ? right.contains(selection.focusNode) : false).toBe(false);
        });
    });

    it('syncs text inserted in the right pane to the left pane', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        fireBeforeInput(firstContent(right), 'Z');

        await waitFor(() => {
            expect(editorText(right)).toContain('ZHello 👩‍💻');
            expect(editorText(left)).toContain('ZHello 👩‍💻');
        });
        expect(plimState(view, 'Editor B').selection.head.offset).toBe(1);
        expect(logDetails(view).textContent).toContain('right sync -> left');
    });

    it('queues edits while a peer is offline and flushes them on reconnect', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        fireEvent.click(within(right).getByRole('button', {name: 'Online'}));
        expect(within(right).getByRole('button', {name: 'Offline'})).toBeTruthy();

        fireBeforeInput(firstContent(left), 'Q');

        await waitFor(() => {
            expect(editorText(left)).toContain('QHello 👩‍💻');
            expect(editorText(right)).not.toContain('QHello 👩‍💻');
            expect(within(left).getByText('1 queued')).toBeTruthy();
        });
        expect(logDetails(view).textContent).toContain('left queued');

        fireEvent.click(within(right).getByRole('button', {name: 'Offline'}));

        await waitFor(() => {
            expect(editorText(right)).toContain('QHello 👩‍💻');
            expect(within(left).getByText('0 queued')).toBeTruthy();
        });
        expect(logDetails(view).textContent).toContain('left flushed 1 batch -> right');
    });

    it('queues undo while a peer is offline and flushes it on reconnect', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        fireBeforeInput(firstContent(left), 'O');
        await waitFor(() => expect(editorText(right)).toContain('OHello 👩‍💻'));

        fireEvent.click(within(right).getByRole('button', {name: 'Online'}));
        fireEvent.click(within(left).getByRole('button', {name: 'Undo'}));

        await waitFor(() => {
            expect(editorText(left)).not.toContain('OHello 👩‍💻');
            expect(editorText(right)).toContain('OHello 👩‍💻');
            expect(within(left).getByText('1 queued')).toBeTruthy();
        });

        fireEvent.click(within(right).getByRole('button', {name: 'Offline'}));

        await waitFor(() => {
            expect(editorText(right)).not.toContain('OHello 👩‍💻');
            expect(within(left).getByText('0 queued')).toBeTruthy();
        });
    });

    it('opens the Plim slash command menu for the active pane', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        setDomCaret(content, 0);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        fireEvent.keyDown(content, {key: '/', code: 'Slash'});

        await waitFor(() => {
            expect(document.body.querySelector('.slash-menu')).not.toBeNull();
        });
        expect(within(document.body).getByRole('listbox')).toBeTruthy();
        expect(document.body.textContent).toContain('Basic blocks');
        expect(document.body.textContent).toContain('Heading 1');
    });

    it('shows the floating formatting toolbar and syncs a code mark from it', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        content.closest<HTMLElement>('.plim-editor')?.focus();
        setDomSelection(content, 0, 5);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));

        const toolbar = await waitFor(() => within(document.body).getByRole('toolbar', {name: 'Formatting'}));
        expect(within(toolbar).getByRole('button', {name: /Bold/})).toBeTruthy();
        expect(within(toolbar).getByRole('button', {name: /Italic/})).toBeTruthy();
        expect(within(toolbar).getByRole('button', {name: /Code/})).toBeTruthy();
        expect(within(toolbar).getByRole('button', {name: /Link/})).toBeTruthy();

        fireEvent.click(within(toolbar).getByRole('button', {name: /Code/}));

        await waitFor(() => {
            expect(firstSpanMarks(view, 'Editor A')).toContain('code');
            expect(firstSpanMarks(view, 'Editor B')).toContain('code');
        });
    });

    it('syncs bold and italic shortcuts to the peer pane', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        setDomSelection(content, 0, 5);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));

        await waitFor(() => {
            expect(plimState(view, 'Editor A').selection.anchor.offset).toBe(0);
            expect(plimState(view, 'Editor A').selection.head.offset).toBe(5);
        });

        fireEvent.keyDown(content, {key: 'i', code: 'KeyI', metaKey: true});

        await waitFor(() => {
            expect(firstSpanMarks(view, 'Editor A')).toContain('italic');
            expect(firstSpanMarks(view, 'Editor B')).toContain('italic');
        });

        fireEvent.keyDown(content, {key: 'b', code: 'KeyB', metaKey: true});

        await waitFor(() => {
            expect(firstSpanMarks(view, 'Editor A')).not.toContain('bold');
            expect(firstSpanMarks(view, 'Editor B')).not.toContain('bold');
            expect(firstSpanMarks(view, 'Editor B')).toContain('italic');
        });
        expect(logDetails(view).textContent).toContain('left tx: toggleMark');
    });

    it('applies bold shortcuts across a multi-block selection and syncs the result', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');

        const contents = await waitFor(() => {
            const nodes = [...left.querySelectorAll<HTMLElement>('[data-block-content]')];
            if (nodes.length < 3) throw new Error('missing Plim content nodes');
            return nodes;
        });
        const first = contents[0];
        const heading = contents.find((node) => node.textContent === 'Roadmap');
        if (!heading) throw new Error('missing heading content');

        setDomSelectionBetween(first, 0, heading, 'Roadmap'.length);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));

        await waitFor(() => {
            const selection = plimState(view, 'Editor A').selection;
            expect(selection.anchor.path).toEqual([0]);
            expect(selection.head.path).toEqual([1]);
        });

        fireEvent.keyDown(first, {key: 'b', code: 'KeyB', metaKey: true});

        await waitFor(() => {
            const leftState = plimState(view, 'Editor A');
            const rightState = plimState(view, 'Editor B');
            expect(blockSpansHaveMark(leftState.doc.children[0], 'bold')).toBe(true);
            expect(blockSpansHaveMark(leftState.doc.children[0].children?.[0], 'bold')).toBe(true);
            expect(blockSpansHaveMark(leftState.doc.children[1], 'bold')).toBe(true);
            expect(blockSpansHaveMark(rightState.doc.children[1], 'bold')).toBe(true);
        });
    });

    it('preserves a peer selection across remote rematerialization', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');

        const heading = headingContent(right);
        setDomCaret(heading, 4);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));

        await waitFor(() => {
            const selection = plimState(view, 'Editor B').selection;
            expect(selection.head.path).toEqual([1]);
            expect(selection.head.offset).toBe(4);
        });

        fireBeforeInput(firstContent(left), 'X');

        await waitFor(() => {
            expect(editorText(right)).toContain('XHello 👩‍💻');
            const selection = plimState(view, 'Editor B').selection;
            expect(selection.head.path).toEqual([1]);
            expect(selection.head.offset).toBe(4);
        });
    });

    it('keeps selection in the new block after splitting with Enter', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        setDomCaret(content, 5);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => expect(plimState(view, 'Editor A').selection.head.offset).toBe(5));

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([1]);
            expect(state.selection.head.offset).toBe(0);
            const active = left.querySelector<HTMLElement>('[data-caret-active="true"]');
            expect(active?.dataset.blockId).toBe(state.doc.children[1].id);
            expect(active?.dataset.blockId).not.toBe('0000-alice');
            expect(plimState(view, 'Editor B').doc.children[1].id).toBe(state.doc.children[1].id);
        });
    });

    it('moves selection to the new block after pressing Enter in an empty block', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = firstContent(left);

        setDomCaretAtEnd(content);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => expect(plimState(view, 'Editor A').selection.head.offset).toBe('Hello 👩‍💻'.length));

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        const firstEmpty = await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([1]);
            expect(state.selection.head.offset).toBe(0);
            return blockContent(left, state.doc.children[1].id);
        });

        fireEvent(
            firstEmpty,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
            const active = left.querySelector<HTMLElement>('[data-caret-active="true"]');
            expect(active?.dataset.blockId).toBe(state.doc.children[2].id);
            expect(plimState(view, 'Editor B').doc.children[2].text).toEqual([]);
        });
    });

    it('joins the current empty block into the previous block on Backspace', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');
        const content = firstContent(left);

        setDomCaretAtEnd(content);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => expect(plimState(view, 'Editor A').selection.head.offset).toBe('Hello 👩‍💻'.length));

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        const firstEmpty = await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([1]);
            return blockContent(left, state.doc.children[1].id);
        });

        fireEvent(
            firstEmpty,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        const secondEmpty = await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.doc.children.length).toBeGreaterThanOrEqual(4);
            return blockContent(left, state.doc.children[2].id);
        });

        secondEmpty.closest<HTMLElement>('.plim-editor')?.focus();
        setDomCaretAtEnd(secondEmpty);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
        });

        fireEvent(
            secondEmpty,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'deleteContentBackward',
            }),
        );

        await waitFor(() => {
            const leftState = plimState(view, 'Editor A');
            const rightState = plimState(view, 'Editor B');
            expect(leftState.selection.head.path).toEqual([1]);
            expect(leftState.selection.head.offset).toBe(0);
            expect(leftState.doc.children.length).toBe(rightState.doc.children.length);
            expect(leftState.doc.children[2].text?.map((span) => span.text).join('')).toBe('Roadmap');
            expect(editorText(right)).toContain('Roadmap');
        });
    });

    it('restores the pre-split selection when undoing a split', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const right = await editorPane(view, 'Editor B');
        const content = firstContent(left);

        setDomCaret(content, 5);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => expect(plimState(view, 'Editor A').selection.head.offset).toBe(5));

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        await waitFor(() => {
            expect(plimState(view, 'Editor A').selection.head.path).toEqual([1]);
            expect(editorText(right)).toContain('Hello');
        });

        fireEvent.click(within(left).getByRole('button', {name: 'Undo'}));

        await waitFor(() => {
            const leftState = plimState(view, 'Editor A');
            expect(leftState.selection.head.path).toEqual([0]);
            expect(leftState.selection.head.offset).toBe(5);
            expect(leftState.selection.anchor).toEqual(leftState.selection.head);
            expect(leftState.doc.children[0].text?.map((span) => span.text).join('')).toBe('Hello 👩‍💻');
            expect(plimState(view, 'Editor B').doc.children[0].text?.map((span) => span.text).join('')).toBe('Hello 👩‍💻');
        });
    });

    it('restores the pre-join selection when undoing a join', async () => {
        const view = render(<App />);
        const left = await editorPane(view, 'Editor A');
        const content = headingContent(left);

        setDomCaret(content, 4);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([1]);
            expect(state.selection.head.offset).toBe(4);
        });

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertParagraph',
            }),
        );

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
        });

        const splitContent = await waitFor(() => {
            const nodes = [...left.querySelectorAll<HTMLElement>('[data-block-content]')];
            const node = nodes.find((item) => item.textContent === 'map');
            if (!node) throw new Error('missing split block content');
            return node;
        });
        splitContent.closest<HTMLElement>('.plim-editor')?.focus();
        setDomCaret(splitContent, 0);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));
        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
        });

        fireEvent(
            splitContent,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'deleteContentBackward',
            }),
        );

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[2].type).toBe('paragraph');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
        });
        const convertedContent = await waitFor(() => {
            const nodes = [...left.querySelectorAll<HTMLElement>('[data-block-content]')];
            const node = nodes.find((item) => item.textContent === 'map');
            if (!node) throw new Error('missing converted split block content');
            return node;
        });

        fireEvent(
            convertedContent,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'deleteContentBackward',
            }),
        );

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].text?.map((span) => span.text).join('')).toBe('Roadmap');
            expect(state.selection.head.path).toEqual([1]);
            expect(state.selection.head.offset).toBe(4);
        });

        fireEvent.click(within(left).getByRole('button', {name: 'Undo'}));

        await waitFor(() => {
            const state = plimState(view, 'Editor A');
            expect(state.doc.children[1].text?.map((span) => span.text).join('')).toBe('Road');
            expect(state.doc.children[2].text?.map((span) => span.text).join('')).toBe('map');
            expect(state.selection.head.path).toEqual([2]);
            expect(state.selection.head.offset).toBe(0);
            expect(state.selection.anchor).toEqual(state.selection.head);
        });
    });
});

const editorPane = async (view: ReturnType<typeof render>, label: string): Promise<HTMLElement> =>
    waitFor(() => view.getByRole('region', {name: label}));

const debugDetails = (view: ReturnType<typeof render>, label: string): HTMLDetailsElement => {
    const summary = view.getByText(`${label} Debug`);
    const details = summary.closest('details');
    if (!details) throw new Error(`missing debug details for ${label}`);
    return details as HTMLDetailsElement;
};

const debugSection = (view: ReturnType<typeof render>, label: string, heading: string): HTMLElement => {
    const details = debugDetails(view, label);
    const title = within(details).getByText(heading);
    const section = title.closest('section');
    if (!section) throw new Error(`missing section ${heading}`);
    return section as HTMLElement;
};

const logDetails = (view: ReturnType<typeof render>): HTMLElement => {
    const summary = view.getByText(/^Log \(/);
    const details = summary.closest('details');
    if (!details) throw new Error('missing log details');
    return details as HTMLElement;
};

const editorText = (container: HTMLElement): string =>
    [...container.querySelectorAll<HTMLElement>('[data-block-content]')]
        .map((node) => node.textContent ?? '')
        .join('\n');

const firstContent = (container: HTMLElement): HTMLElement => {
    const node = container.querySelector<HTMLElement>('[data-block-content]');
    if (!node) throw new Error('missing Plim content node');
    return node;
};

const headingContent = (container: HTMLElement): HTMLElement => {
    const node = [...container.querySelectorAll<HTMLElement>('[data-block-content]')].find(
        (item) => item.textContent === 'Roadmap',
    );
    if (!node) throw new Error('missing heading content');
    return node;
};

const blockContent = (container: HTMLElement, blockId: string): HTMLElement => {
    const block = container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    const content = block?.querySelector<HTMLElement>(':scope > [data-block-content]');
    if (!content) throw new Error(`missing content for block ${blockId}`);
    return content;
};

const plimState = (view: ReturnType<typeof render>, label: string) =>
    JSON.parse(debugSection(view, label, 'Plim JSON').querySelector('pre')?.textContent ?? '{}') as {
        doc: {
            children: Array<{
                id: string;
                children?: Array<{text?: Array<{text: string; marks?: Array<{type: string}>}>}>;
                text?: Array<{text: string; marks?: Array<{type: string}>}>;
            }>;
        };
        selection: {head: {path: number[]; offset: number}; anchor: {path: number[]; offset: number}};
    };

const firstSpanMarks = (view: ReturnType<typeof render>, label: string): string[] =>
    plimState(view, label).doc.children[0].text?.[0].marks?.map((mark) => mark.type) ?? [];

const blockSpansHaveMark = (
    block: {text?: Array<{text: string; marks?: Array<{type: string}>}>} | undefined,
    markType: string,
): boolean => !!block?.text?.length && block.text.every((span) => span.marks?.some((mark) => mark.type === markType));

const fireBeforeInput = (node: HTMLElement, text: string) => {
    fireEvent(
        node,
        new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text,
        }),
    );
};

const setDomCaret = (node: HTMLElement, offset: number) => {
    const text = firstTextNode(node);
    const selection = window.getSelection();
    if (!text || !selection) throw new Error('cannot set DOM caret');
    const range = document.createRange();
    range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
};

const setDomCaretAtEnd = (node: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection) throw new Error('cannot set DOM caret');
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
};

const setDomSelection = (node: HTMLElement, from: number, to: number) => {
    const text = firstTextNode(node);
    const selection = window.getSelection();
    if (!text || !selection) throw new Error('cannot set DOM selection');
    const range = document.createRange();
    range.setStart(text, Math.min(from, text.textContent?.length ?? 0));
    range.setEnd(text, Math.min(to, text.textContent?.length ?? 0));
    selection.removeAllRanges();
    selection.addRange(range);
};

const setDomSelectionBetween = (fromNode: HTMLElement, from: number, toNode: HTMLElement, to: number) => {
    const start = firstTextNode(fromNode);
    const end = firstTextNode(toNode);
    const selection = window.getSelection();
    if (!start || !end || !selection) throw new Error('cannot set DOM selection');
    const range = document.createRange();
    range.setStart(start, Math.min(from, start.textContent?.length ?? 0));
    range.setEnd(end, Math.min(to, end.textContent?.length ?? 0));
    selection.removeAllRanges();
    selection.addRange(range);
};

const firstTextNode = (node: Node): Text | null => {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
    for (const child of node.childNodes) {
        const text = firstTextNode(child);
        if (text) return text;
    }
    return null;
};
