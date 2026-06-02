import {describe, expect, it} from 'vitest';
import {
    allocateOpIds,
    compareOpIds,
    formatOpId,
    maxOpCounter,
    parseOpId,
    tryParseOpId,
} from './index.js';
import type {RichTextState} from './types.js';

describe('peritext op ids', () => {
    it('parses and formats branch-aware op ids', () => {
        expect(parseOpId('42@session:branch')).toEqual({
            counter: 42,
            actorId: 'session:branch',
        });
        expect(formatOpId(42, 'session:branch')).toBe('42@session:branch');
    });

    it('compares counters numerically before actor ids', () => {
        expect(compareOpIds('10@a:b', '2@z:y')).toBeGreaterThan(0);
        expect(compareOpIds('2@z:y', '10@a:b')).toBeLessThan(0);
    });

    it('orders concurrent same-counter ids by actor id', () => {
        expect(compareOpIds('7@a:one', '7@b:one')).toBeLessThan(0);
        expect(compareOpIds('7@b:one', '7@a:one')).toBeGreaterThan(0);
        expect(compareOpIds('7@a:one', '7@a:one')).toBe(0);
    });

    it('allocates consecutive ids after the largest existing operation counter', () => {
        const state: RichTextState = {
            chars: [
                {
                    opId: '3@alice:main',
                    afterId: null,
                    char: 'a',
                    deleted: false,
                    markOpsBefore: [
                        {
                            action: 'addMark',
                            opId: '41@bob:main',
                            start: {type: 'startOfText'},
                            end: {type: 'endOfText'},
                            markType: 'strong',
                        },
                    ],
                },
            ],
        };

        expect(maxOpCounter(state)).toBe(41);
        expect(allocateOpIds(state, 'alice:main', 5)).toEqual([
            '42@alice:main',
            '43@alice:main',
            '44@alice:main',
            '45@alice:main',
            '46@alice:main',
        ]);
    });

    it('rejects malformed ids', () => {
        expect(tryParseOpId('10@actor')).toBeNull();
        expect(tryParseOpId('x@actor:branch')).toBeNull();
        expect(tryParseOpId('10@actor:')).toBeNull();
        expect(() => parseOpId('10@actor')).toThrow(/Invalid rich text opId/);
    });
});
