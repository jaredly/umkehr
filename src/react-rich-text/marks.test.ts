import {describe, expect, it} from 'vitest';
import {linkValueForRange, rangeHasMark} from './marks.js';

describe('react rich text mark helpers', () => {
    it('requires every selected character to have a mark', () => {
        const view = {
            plainText: 'hello',
            spans: [
                {text: 'he', marks: {strong: true}},
                {text: 'llo'},
            ],
        };

        expect(rangeHasMark(view, {start: 0, end: 2}, 'strong')).toBe(true);
        expect(rangeHasMark(view, {start: 0, end: 3}, 'strong')).toBe(false);
        expect(rangeHasMark(view, {start: 2, end: 2}, 'strong')).toBe(false);
    });

    it('returns a link value only when the full range has a consistent link', () => {
        const view = {
            plainText: 'hello',
            spans: [
                {text: 'he', marks: {link: 'https://example.test'}},
                {text: 'll', marks: {link: 'https://example.test'}},
                {text: 'o', marks: {link: 'https://other.test'}},
            ],
        };

        expect(linkValueForRange(view, {start: 0, end: 4})).toBe('https://example.test');
        expect(linkValueForRange(view, {start: 0, end: 5})).toBeUndefined();
    });
});
