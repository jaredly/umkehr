import '../react/test-dom';

import {describe, expect, it} from 'vitest';
import {domPointForTextOffset, restoreSelection, selectionRangeIn} from './selection.js';

describe('react rich text selection helpers', () => {
    it('maps DOM selections to plain text offsets across nested marks', () => {
        const root = document.createElement('div');
        root.innerHTML = 'he<strong>ll</strong><em>o</em>';
        document.body.append(root);
        const strongText = root.querySelector('strong')?.firstChild;
        const emText = root.querySelector('em')?.firstChild;
        if (!strongText || !emText) throw new Error('missing text nodes');

        const range = document.createRange();
        range.setStart(strongText, 0);
        range.setEnd(emText, 1);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        expect(selectionRangeIn(root)).toEqual({start: 2, end: 5});
        root.remove();
    });

    it('restores selections from plain text offsets', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span>ab</span><strong>cd</strong>';
        document.body.append(root);

        restoreSelection(root, {start: 1, end: 3});

        expect(window.getSelection()?.toString()).toBe('bc');
        root.remove();
    });

    it('returns the nearest DOM point for a text offset', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span>ab</span><strong>cd</strong>';
        document.body.append(root);

        const point = domPointForTextOffset(root, 3);

        expect(point.node.textContent).toBe('cd');
        expect(point.offset).toBe(1);
        root.remove();
    });
});
