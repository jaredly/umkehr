import {describe, expect, it} from 'vitest';

import {calculateSlideScale, slideFooterText} from './slideRenderer';

describe('slide renderer helpers', () => {
    it('calculates slide scale from viewport and deck size', () => {
        expect(calculateSlideScale({width: 960, height: 540}, {width: 1920, height: 1080})).toBe(0.5);
        expect(calculateSlideScale({width: 1000, height: 400}, {width: 1000, height: 1000})).toBe(0.4);
    });

    it('falls back to scale 1 for invalid or empty dimensions', () => {
        expect(calculateSlideScale({width: 0, height: 540}, {width: 1920, height: 1080})).toBe(1);
        expect(calculateSlideScale({width: 960, height: 540}, {width: 0, height: 1080})).toBe(1);
        expect(calculateSlideScale({width: 960, height: -1}, {width: 1920, height: 1080})).toBe(1);
    });

    it('formats slide footers', () => {
        expect(slideFooterText('none', 'Deck', 1, 3)).toBe('');
        expect(slideFooterText('deck-title', 'Deck', 1, 3)).toBe('Deck');
        expect(slideFooterText('slide-number', 'Deck', 1, 3)).toBe('2/3');
        expect(slideFooterText('deck-title-and-slide-number', 'Deck', 1, 3)).toBe('Deck · 2/3');
        expect(slideFooterText('deck-title-and-slide-number', '', 1, 0)).toBe('');
    });
});
