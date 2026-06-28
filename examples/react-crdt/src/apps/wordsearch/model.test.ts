import {describe, expect, it} from 'vitest';
import {
    isWordsearchEphemeralData,
    WORDSEARCH_CHAT_MAX_LENGTH,
    type WordsearchChatEvent,
    type WordsearchSelectionEvent,
} from './model';

describe('wordsearch ephemeral validation', () => {
    it('accepts selection events', () => {
        const event: WordsearchSelectionEvent = {
            type: 'selection',
            start: {x: 0, y: 0},
            end: {x: 2, y: 0},
            cells: [
                {x: 0, y: 0},
                {x: 1, y: 0},
                {x: 2, y: 0},
            ],
        };

        expect(isWordsearchEphemeralData(event)).toBe(true);
    });

    it('accepts valid chat events', () => {
        const event: WordsearchChatEvent = {
            type: 'chat',
            text: 'Nice find',
            sentAt: '2026-06-27T12:00:00.000Z',
        };

        expect(isWordsearchEphemeralData(event)).toBe(true);
    });

    it('rejects empty chat text', () => {
        expect(
            isWordsearchEphemeralData({
                type: 'chat',
                text: '   ',
                sentAt: '2026-06-27T12:00:00.000Z',
            }),
        ).toBe(false);
    });

    it('rejects overlong chat text', () => {
        expect(
            isWordsearchEphemeralData({
                type: 'chat',
                text: 'x'.repeat(WORDSEARCH_CHAT_MAX_LENGTH + 1),
                sentAt: '2026-06-27T12:00:00.000Z',
            }),
        ).toBe(false);
    });

    it('rejects chat events without sentAt', () => {
        expect(
            isWordsearchEphemeralData({
                type: 'chat',
                text: 'Hello',
                sentAt: '',
            }),
        ).toBe(false);
    });
});
