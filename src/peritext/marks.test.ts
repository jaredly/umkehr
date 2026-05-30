import {describe, expect, it} from 'vitest';
import {applyRichTextOperations, emptyRichTextState, materializeRichTextState} from './index.js';
import type {RichTextOperation} from './types.js';

const insert = (
    opId: `${number}@${string}:${string}`,
    afterId: `${number}@${string}:${string}` | null,
    char: string,
): RichTextOperation => ({action: 'insert', opId, afterId, char});

const addMark = (
    opId: `${number}@${string}:${string}`,
    start: RichTextOperation extends never ? never : {type: 'before' | 'after'; opId: `${number}@${string}:${string}`},
    end: {type: 'before' | 'after'; opId: `${number}@${string}:${string}`} | {type: 'endOfText'},
    markType = 'strong',
): RichTextOperation => ({action: 'addMark', opId, start, end, markType});

const removeMark = (
    opId: `${number}@${string}:${string}`,
    start: {type: 'before' | 'after'; opId: `${number}@${string}:${string}`},
    end: {type: 'before' | 'after'; opId: `${number}@${string}:${string}`} | {type: 'endOfText'},
    markType = 'strong',
): RichTextOperation => ({action: 'removeMark', opId, start, end, markType});

const baseText = () =>
    applyRichTextOperations(emptyRichTextState(), [
        insert('1@alice:main', null, 'a'),
        insert('2@alice:main', '1@alice:main', 'b'),
        insert('3@alice:main', '2@alice:main', 'c'),
        insert('4@alice:main', '3@alice:main', 'd'),
    ]);

describe('peritext marks', () => {
    it('materializes compact spans for a mark range', () => {
        const state = applyRichTextOperations(baseText(), [
            addMark(
                '5@alice:main',
                {type: 'before', opId: '2@alice:main'},
                {type: 'before', opId: '4@alice:main'},
            ),
        ]);

        expect(materializeRichTextState(state)).toEqual({
            plainText: 'abcd',
            spans: [
                {text: 'a'},
                {text: 'bc', marks: {strong: true}},
                {text: 'd'},
            ],
        });
    });

    it('combines overlapping marks independent of application order', () => {
        const strong = addMark(
            '5@alice:main',
            {type: 'before', opId: '1@alice:main'},
            {type: 'before', opId: '3@alice:main'},
            'strong',
        );
        const emphasis = addMark(
            '5@bob:main',
            {type: 'before', opId: '2@alice:main'},
            {type: 'endOfText'},
            'em',
        );

        const left = applyRichTextOperations(baseText(), [strong, emphasis]);
        const right = applyRichTextOperations(baseText(), [emphasis, strong]);

        expect(materializeRichTextState(left)).toEqual(materializeRichTextState(right));
        expect(materializeRichTextState(left).spans).toEqual([
            {text: 'a', marks: {strong: true}},
            {text: 'b', marks: {strong: true, em: true}},
            {text: 'cd', marks: {em: true}},
        ]);
    });

    it('resolves add/remove conflicts by greatest op id per mark type', () => {
        const state = applyRichTextOperations(baseText(), [
            addMark(
                '5@alice:main',
                {type: 'before', opId: '1@alice:main'},
                {type: 'endOfText'},
            ),
            removeMark(
                '6@alice:main',
                {type: 'before', opId: '2@alice:main'},
                {type: 'before', opId: '4@alice:main'},
            ),
        ]);

        expect(materializeRichTextState(state).spans).toEqual([
            {text: 'a', marks: {strong: true}},
            {text: 'bc'},
            {text: 'd', marks: {strong: true}},
        ]);
    });

    it('does not emit tombstoned-only formatted spans', () => {
        const state = applyRichTextOperations(baseText(), [
            addMark(
                '5@alice:main',
                {type: 'before', opId: '2@alice:main'},
                {type: 'before', opId: '3@alice:main'},
            ),
            {action: 'remove', opId: '6@alice:main', removedId: '2@alice:main'},
        ]);

        expect(materializeRichTextState(state)).toEqual({
            plainText: 'acd',
            spans: [{text: 'acd'}],
        });
    });
});
