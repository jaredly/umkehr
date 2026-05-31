import {describe, expect, it} from 'vitest';
import {
    applyRichTextOperation,
    applyRichTextOperations,
    applyInsertMany,
    charIdsForVisibleRange,
    emptyRichTextState,
    insertionAfterIdForIndex,
    materializeRichTextState,
    plainText,
} from './index.js';
import type {RichTextOperation} from './types.js';

const insert = (
    opId: `${number}@${string}:${string}`,
    afterId: `${number}@${string}:${string}` | null,
    char: string,
): RichTextOperation => ({action: 'insert', opId, afterId, char});

const remove = (
    opId: `${number}@${string}:${string}`,
    removedId: `${number}@${string}:${string}`,
): RichTextOperation => ({action: 'remove', opId, removedId});

describe('peritext sequence', () => {
    it('applies single-character inserts and removes with tombstones', () => {
        let state = emptyRichTextState();
        state = applyRichTextOperation(state, insert('1@alice:main', null, 'h'));
        state = applyRichTextOperation(state, insert('2@alice:main', '1@alice:main', 'i'));
        state = applyRichTextOperation(state, remove('3@alice:main', '1@alice:main'));

        expect(plainText(state)).toBe('i');
        expect(state.chars.find((char) => char.opId === '1@alice:main')?.deleted).toBe(true);
        expect(materializeRichTextState(state)).toEqual({
            plainText: 'i',
            spans: [{text: 'i'}],
        });
    });

    it('makes repeated removes idempotent', () => {
        const inserted = applyRichTextOperation(
            emptyRichTextState(),
            insert('1@alice:main', null, 'x'),
        );
        const once = applyRichTextOperation(inserted, remove('2@alice:main', '1@alice:main'));
        const twice = applyRichTextOperation(once, remove('2@alice:main', '1@alice:main'));

        expect(twice).toEqual(once);
        expect(twice).toBe(once);
        expect(plainText(twice)).toBe('');
    });

    it('returns the same state for duplicate inserts', () => {
        const inserted = applyRichTextOperation(
            emptyRichTextState(),
            insert('1@alice:main', null, 'x'),
        );
        const duplicate = applyRichTextOperation(inserted, insert('1@alice:main', null, 'x'));

        expect(duplicate).toBe(inserted);
    });

    it('can insert after a deleted character', () => {
        let state = emptyRichTextState();
        state = applyRichTextOperation(state, insert('1@alice:main', null, 'a'));
        state = applyRichTextOperation(state, remove('2@alice:main', '1@alice:main'));
        state = applyRichTextOperation(state, insert('3@alice:main', '1@alice:main', 'b'));

        expect(plainText(state)).toBe('b');
        expect(state.chars.map((char) => char.opId)).toEqual(['1@alice:main', '3@alice:main']);
    });

    it('orders concurrent inserts at the same anchor by op id', () => {
        const base = applyRichTextOperation(
            emptyRichTextState(),
            insert('1@alice:main', null, 'a'),
        );
        const leftFirst = applyRichTextOperations(base, [
            insert('3@bob:main', '1@alice:main', 'c'),
            insert('2@alice:main', '1@alice:main', 'b'),
        ]);
        const rightFirst = applyRichTextOperations(base, [
            insert('2@alice:main', '1@alice:main', 'b'),
            insert('3@bob:main', '1@alice:main', 'c'),
        ]);

        expect(plainText(leftFirst)).toBe('acb');
        expect(leftFirst).toEqual(rightFirst);
    });

    it('applies sequential insert runs in one batch', () => {
        const state = applyInsertMany(emptyRichTextState(), [
            {action: 'insert', opId: '1@alice:main', afterId: null, char: 'h'},
            {action: 'insert', opId: '2@alice:main', afterId: '1@alice:main', char: 'e'},
            {action: 'insert', opId: '3@alice:main', afterId: '2@alice:main', char: 'y'},
        ]);

        expect(plainText(state)).toBe('hey');
        expect(state.chars.map((char) => char.opId)).toEqual([
            '1@alice:main',
            '2@alice:main',
            '3@alice:main',
        ]);
    });

    it('keeps descendants with their inserted parent when sorting concurrent inserts', () => {
        const ops = [
            insert('1@alice:main', null, 'a'),
            insert('4@bob:main', '3@bob:main', 'd'),
            insert('2@alice:main', '1@alice:main', 'b'),
            insert('3@bob:main', '1@alice:main', 'c'),
        ];
        const state = applyRichTextOperations(emptyRichTextState(), ops);

        expect(plainText(state)).toBe('acdb');
        expect(state.chars.map((char) => char.opId)).toEqual([
            '1@alice:main',
            '3@bob:main',
            '4@bob:main',
            '2@alice:main',
        ]);
        expect(state.pending).toBeUndefined();
    });

    it('retains inserts until afterId dependencies arrive', () => {
        const state = applyRichTextOperations(emptyRichTextState(), [
            insert('2@alice:main', '1@alice:main', 'b'),
            insert('1@alice:main', null, 'a'),
        ]);

        expect(plainText(state)).toBe('ab');
        expect(state.pending).toBeUndefined();
    });

    it('retains removes until removed chars arrive', () => {
        const state = applyRichTextOperations(emptyRichTextState(), [
            remove('2@alice:main', '1@alice:main'),
            insert('1@alice:main', null, 'a'),
        ]);

        expect(plainText(state)).toBe('');
        expect(state.chars.find((char) => char.opId === '1@alice:main')?.deleted).toBe(true);
        expect(state.pending).toBeUndefined();
    });

    it('maps visible indexes and ranges to stable ids', () => {
        let state = emptyRichTextState();
        state = applyRichTextOperation(state, insert('1@alice:main', null, 'a'));
        state = applyRichTextOperation(state, insert('2@alice:main', '1@alice:main', 'b'));
        state = applyRichTextOperation(state, insert('3@alice:main', '2@alice:main', 'c'));
        state = applyRichTextOperation(state, remove('4@alice:main', '2@alice:main'));

        expect(insertionAfterIdForIndex(state, 0)).toBeNull();
        expect(insertionAfterIdForIndex(state, 1)).toBe('1@alice:main');
        expect(insertionAfterIdForIndex(state, 2)).toBe('3@alice:main');
        expect(charIdsForVisibleRange(state, {start: 0, end: 2})).toEqual([
            '1@alice:main',
            '3@alice:main',
        ]);
    });
});
