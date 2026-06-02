import {describe, expect, it} from 'vitest';
import {applyRichTextOperations, emptyRichTextState, validateRichTextOperation} from './index.js';

describe('peritext validation', () => {
    it('accepts valid operations', () => {
        expect(
            validateRichTextOperation({
                action: 'insert',
                opId: '1@alice:main',
                afterId: null,
                char: 'x',
            }),
        ).toMatchObject({success: true});
    });

    it('rejects malformed op ids and multi-character inserts', () => {
        const result = validateRichTextOperation({
            action: 'insert',
            opId: 'bad',
            afterId: null,
            char: 'xy',
        });

        expect(result.success).toBe(false);
        expect(result.success ? [] : result.errors.map((error) => error.path)).toEqual([
            'opId',
            'char',
        ]);
    });

    it('validates mark anchor references and ordering when state is provided', () => {
        const state = applyRichTextOperations(emptyRichTextState(), [
            {action: 'insert', opId: '1@alice:main', afterId: null, char: 'a'},
            {action: 'insert', opId: '2@alice:main', afterId: '1@alice:main', char: 'b'},
        ]);

        expect(
            validateRichTextOperation(
                {
                    action: 'addMark',
                    opId: '3@alice:main',
                    start: {type: 'before', opId: '2@alice:main'},
                    end: {type: 'before', opId: '1@alice:main'},
                    markType: 'strong',
                },
                state,
            ),
        ).toMatchObject({success: false});
        expect(
            validateRichTextOperation(
                {
                    action: 'addMark',
                    opId: '3@alice:main',
                    start: {type: 'before', opId: '9@alice:main'},
                    end: {type: 'endOfText'},
                    markType: 'strong',
                },
                state,
            ),
        ).toMatchObject({success: false});
    });
});
