import {describe, expect, it} from 'vitest';
import {orderedElements, simplifyStroke, strokePath} from './helpers';
import type {WhiteboardElement, WhiteboardState} from './model';

describe('whiteboard helpers', () => {
    it('orders visible elements by z-order and id', () => {
        const state: WhiteboardState = {
            background: '#fff',
            elements: {
                b: element('b', 'b0'),
                archived: {...element('archived', 'a0'), archived: true},
                a: element('a', 'b0'),
                c: element('c', 'c0'),
            },
        };

        expect(orderedElements(state).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    });

    it('simplifies noisy straight strokes while preserving endpoints', () => {
        const points = Array.from({length: 20}, (_, index) => ({
            x: index,
            y: index % 2 === 0 ? 0 : 0.2,
        }));

        const simplified = simplifyStroke(points, 0.5);

        expect(simplified[0]).toEqual(points[0]);
        expect(simplified.at(-1)).toEqual(points.at(-1));
        expect(simplified.length).toBeLessThan(points.length);
    });

    it('creates svg path data from points', () => {
        expect(strokePath([{x: 1, y: 2}, {x: 3, y: 4}])).toBe('M 1.0 2.0 L 3.0 4.0');
    });
});

function element(id: string, zOrder: string): WhiteboardElement {
    return {
        type: 'emoji',
        id,
        position: {x: 0, y: 0},
        rotation: 0,
        zOrder,
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        archived: false,
        emoji: '👍',
        size: 24,
    };
}
