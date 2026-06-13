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

Object.defineProperty(globalThis, 'CSS', {
    value: {escape: (value: string) => value.replace(/"/g, '\\"')},
    configurable: true,
});

afterEach(() => {
    cleanup();
});

describe('Plim block CRDT example app', () => {
    it('renders the initial CRDT document in the editor and debug panes', async () => {
        const view = render(<App />);

        await waitFor(() => expect(view.container.querySelector('[data-block-content]')).not.toBeNull());

        expect(view.getByRole('button', {name: 'Remote Insert'})).toBeTruthy();
        expect(view.getByRole('button', {name: 'Remote Split'})).toBeTruthy();
        expect(editorText(view.container)).toContain('Hello 👩‍💻');
        expect(editorText(view.container)).toContain('Roadmap');
        expect(editorText(view.container)).toContain('Ship adapter');
        expect(debugSection(view, 'CRDT Text').textContent).toContain('Hello 👩‍💻');
        expect(debugSection(view, 'Plim JSON').textContent).toContain('"type": "heading"');
        expect(debugSection(view, 'Log').textContent).toContain('Initialized CRDT-backed Plim example.');
    });

    it('applies the scripted remote insert through the adapter', async () => {
        const view = render(<App />);

        fireEvent.click(view.getByRole('button', {name: 'Remote Insert'}));

        await waitFor(() => {
            expect(debugSection(view, 'CRDT Text').textContent).toContain('Remote Hello 👩‍💻');
        });
        expect(editorText(view.container)).toContain('Remote Hello 👩‍💻');
        expect(debugSection(view, 'Log').textContent).toContain('remote insert -> applied');
    });

    it('applies the scripted remote split and rematerializes multiple Plim blocks', async () => {
        const view = render(<App />);

        fireEvent.click(view.getByRole('button', {name: 'Remote Split'}));

        await waitFor(() => {
            const text = debugSection(view, 'CRDT Text').textContent ?? '';
            expect(text).toContain('Hell');
            expect(text).toContain('o 👩‍💻');
        });
        expect(view.container.querySelectorAll('[data-block-id]').length).toBeGreaterThanOrEqual(4);
        expect(debugSection(view, 'Log').textContent).toContain('remote split -> applied');
    });

    it('translates a basic Plim beforeinput text insertion into CRDT ops', async () => {
        const view = render(<App />);

        const content = await waitFor(() => {
            const node = view.container.querySelector<HTMLElement>('[data-block-content]');
            if (!node) throw new Error('missing Plim content node');
            return node;
        });

        fireEvent(
            content,
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: 'X',
            }),
        );

        await waitFor(() => {
            expect(debugSection(view, 'CRDT Text').textContent).toContain('XHello 👩‍💻');
        });
        expect(editorText(view.container)).toContain('XHello 👩‍💻');
        expect(debugSection(view, 'Log').textContent).toContain('local tx: replaceText');
    });

    it('preserves a clicked Plim selection instead of resetting to document start', async () => {
        const view = render(<App />);

        const headingContent = await waitFor(() => {
            const node = [...view.container.querySelectorAll<HTMLElement>('[data-block-content]')].find(
                (item) => item.textContent === 'Roadmap',
            );
            if (!node) throw new Error('missing heading content');
            return node;
        });

        setDomCaret(headingContent, 4);
        fireEvent(document, new window.Event('selectionchange', {bubbles: false}));

        await waitFor(() => {
            const active = view.container.querySelector<HTMLElement>('[data-caret-active="true"]');
            expect(active?.dataset.blockType).toBe('heading');
            expect(active?.textContent).toContain('Roadmap');
        });
    });
});

const debugSection = (view: ReturnType<typeof render>, heading: string): HTMLElement => {
    const title = view.getByText(heading);
    const section = title.closest('section');
    if (!section) throw new Error(`missing section ${heading}`);
    return section as HTMLElement;
};

const editorText = (container: HTMLElement): string =>
    [...container.querySelectorAll<HTMLElement>('[data-block-content]')]
        .map((node) => node.textContent ?? '')
        .join('\n');

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

const firstTextNode = (node: Node): Text | null => {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
    for (const child of node.childNodes) {
        const text = firstTextNode(child);
        if (text) return text;
    }
    return null;
};
