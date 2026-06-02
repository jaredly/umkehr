import {describe, expect, it} from 'vitest';
import {
    anchorsForMarkRange,
    applyRichTextOperations,
    emptyRichTextState,
    insertionAfterIdForIndexPreservingBoundary,
    materializeRichTextState,
} from './index.js';
import type {RichTextOperation} from './types.js';

const insert = (
    opId: `${number}@${string}:${string}`,
    afterId: `${number}@${string}:${string}` | null,
    char: string,
): RichTextOperation => ({action: 'insert', opId, afterId, char});

const text = () =>
    applyRichTextOperations(emptyRichTextState(), [
        insert('1@alice:main', null, 'a'),
        insert('2@alice:main', '1@alice:main', 'b'),
        insert('3@alice:main', '2@alice:main', 'c'),
    ]);

describe('peritext boundary semantics', () => {
    it('compiles inclusive mark ranges so inserts at the end remain inside', () => {
        let state = text();
        const anchors = anchorsForMarkRange(state, {start: 1, end: 2}, 'inclusive');
        state = applyRichTextOperations(state, [
            {action: 'addMark', opId: '4@alice:main', ...anchors, markType: 'strong'},
            insert('5@alice:main', insertionAfterIdForIndexPreservingBoundary(state, 2), 'x'),
        ]);

        expect(materializeRichTextState(state).spans).toEqual([
            {text: 'a'},
            {text: 'bx', marks: {strong: true}},
            {text: 'c'},
        ]);
    });

    it('compiles exclusive mark ranges so inserts at the end stay outside', () => {
        let state = text();
        const anchors = anchorsForMarkRange(state, {start: 1, end: 2}, 'exclusive');
        state = applyRichTextOperations(state, [
            {action: 'addMark', opId: '4@alice:main', ...anchors, markType: 'link', value: '/b'},
            insert('5@alice:main', insertionAfterIdForIndexPreservingBoundary(state, 2), 'x'),
        ]);

        expect(materializeRichTextState(state).spans).toEqual([
            {text: 'a'},
            {text: 'b', marks: {link: '/b'}},
            {text: 'xc'},
        ]);
    });

    it('can choose a tombstone formatting boundary as the insertion anchor', () => {
        let state = text();
        const anchors = anchorsForMarkRange(state, {start: 1, end: 3}, 'exclusive');
        state = applyRichTextOperations(state, [
            {action: 'addMark', opId: '4@alice:main', ...anchors, markType: 'link', value: '/bc'},
            {action: 'remove', opId: '5@alice:main', removedId: '3@alice:main'},
        ]);

        expect(insertionAfterIdForIndexPreservingBoundary(state, 2)).toBe('3@alice:main');
    });
});
