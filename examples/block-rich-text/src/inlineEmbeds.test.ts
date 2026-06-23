import '../../../src/react/test-dom';

import {describe, expect, it} from 'vitest';
import {
    INLINE_EMBED_TEXT,
    inlineEmbedPlugins,
    isInlineEmbedData,
    isInlineEmbedText,
    plainTextForInlineEmbed,
    renderInlineEmbed,
} from './inlineEmbeds';

describe('inline embed helpers', () => {
    it('uses the object replacement character as the embed text', () => {
        expect(INLINE_EMBED_TEXT).toBe('\uFFFC');
        expect(isInlineEmbedText('\uFFFC')).toBe(true);
        expect(isInlineEmbedText('x')).toBe(false);
    });

    it('validates embed payloads as typed JSON values', () => {
        expect(isInlineEmbedData({type: 'date', value: '2026-06-23'})).toBe(true);
        expect(isInlineEmbedData({type: 'date', value: {date: '2026-06-23'}})).toBe(true);
        expect(isInlineEmbedData({type: '', value: '2026-06-23'})).toBe(false);
        expect(isInlineEmbedData({type: 'date', value: undefined})).toBe(false);
        expect(isInlineEmbedData({type: 'date', value: Number.NaN})).toBe(false);
    });

    it('formats date embeds for plain text', () => {
        expect(
            plainTextForInlineEmbed(
                {type: 'date', value: '2026-06-23'},
                inlineEmbedPlugins,
                {ambientMarks: {}},
            ),
        ).toBe('06/23/2026');
    });

    it('falls back for unknown embeds', () => {
        expect(
            plainTextForInlineEmbed(
                {type: 'missing', value: 'x'},
                inlineEmbedPlugins,
                {ambientMarks: {}},
            ),
        ).toBe('[unknown embed]');

        const element = renderInlineEmbed(null, inlineEmbedPlugins, {
            blockId: '1-left',
            charId: '2-left',
            startOffset: 0,
            ambientMarks: {},
            plainText: '[unknown embed]',
        });
        expect(element.dataset.inlineEmbed).toBe('true');
        expect(element.dataset.embedCharId).toBe('2-left');
        expect(element.querySelector('.inlineEmbedLabel')?.textContent).toBe('[unknown embed]');
    });
});
