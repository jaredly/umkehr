import {describe, expect, it} from 'vitest';
import {
    boundsForElement,
    boundsForElements,
    boundsForPreview,
    elementPreviewData,
    strokePreviewPoints,
} from './geometry';
import type {
    EmojiStampElement,
    StickyNoteElement,
    StrokeElement,
    WhiteboardElement,
    WhiteboardState,
} from './model';

describe('whiteboard geometry helpers', () => {
    it('computes bounds for notes, emoji, and translated strokes', () => {
        expect(boundsForElement(note('note-1'))).toEqual({
            x: 10,
            y: 20,
            width: 220,
            height: 150,
        });
        expect(boundsForElement(emoji('emoji-1'))).toEqual({
            x: 30,
            y: 40,
            width: 48,
            height: 48,
        });
        expect(boundsForElement(stroke('stroke-1'))).toEqual({
            x: 100,
            y: 195,
            width: 30,
            height: 30,
        });
    });

    it('computes preview bounds with resized notes, emoji fallback size, and stroke position', () => {
        expect(
            boundsForPreview(note('note-1'), {
                type: 'element-preview',
                elementId: 'note-1',
                x: 50,
                y: 60,
                width: 300,
                height: 180,
            }),
        ).toEqual({x: 50, y: 60, width: 300, height: 180});
        expect(
            boundsForPreview(emoji('emoji-1'), {
                type: 'element-preview',
                elementId: 'emoji-1',
                x: 70,
                y: 80,
            }),
        ).toEqual({x: 70, y: 80, width: 48, height: 48});
        expect(
            boundsForPreview(stroke('stroke-1'), {
                type: 'element-preview',
                elementId: 'stroke-1',
                x: 5,
                y: 10,
            }),
        ).toEqual({x: 5, y: 5, width: 30, height: 30});
    });

    it('combines bounds while ignoring missing and archived elements', () => {
        const archived = {...emoji('archived'), archived: true};
        const state: WhiteboardState = {
            background: '#fff',
            elements: {
                'note-1': note('note-1'),
                'emoji-1': emoji('emoji-1'),
                archived,
            },
        };

        expect(boundsForElements(state, ['note-1', 'missing', 'emoji-1', 'archived'])).toEqual({
            x: 10,
            y: 20,
            width: 220,
            height: 150,
        });
        expect(boundsForElements(state, ['missing', 'archived'])).toBeNull();
    });

    it('builds preview data with element size where applicable', () => {
        expect(elementPreviewData(note('note-1'), {x: 99})).toMatchObject({
            type: 'element-preview',
            elementId: 'note-1',
            x: 99,
            y: 20,
            width: 220,
            height: 150,
        });
        expect(elementPreviewData(emoji('emoji-1'))).toMatchObject({
            elementId: 'emoji-1',
            width: 48,
            height: 48,
        });
        expect(elementPreviewData(stroke('stroke-1'))).not.toHaveProperty('width');
    });

    it('preserves optional pressure in stroke preview points', () => {
        expect(
            strokePreviewPoints([
                {x: 1, y: 2},
                {x: 3, y: 4, pressure: 0.5},
            ]),
        ).toEqual([
            [1, 2],
            [3, 4, 0.5],
        ]);
    });
});

function base(id: string): Omit<WhiteboardElement, 'type'> {
    return {
        id,
        position: {x: 0, y: 0},
        rotation: 0,
        zOrder: 'a0',
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        archived: false,
    };
}

function note(id: string): StickyNoteElement {
    return {
        ...base(id),
        type: 'note',
        position: {x: 10, y: 20},
        size: {width: 220, height: 150},
        color: '#fff7b8',
        text: '',
    };
}

function emoji(id: string): EmojiStampElement {
    return {
        ...base(id),
        type: 'emoji',
        position: {x: 30, y: 40},
        emoji: '👍',
        size: 48,
    };
}

function stroke(id: string): StrokeElement {
    return {
        ...base(id),
        type: 'stroke',
        position: {x: 100, y: 200},
        color: '#17202a',
        strokeWidth: 4,
        points: [
            {x: 0, y: 0},
            {x: 30, y: -5},
            {x: 20, y: 25},
        ],
    };
}
