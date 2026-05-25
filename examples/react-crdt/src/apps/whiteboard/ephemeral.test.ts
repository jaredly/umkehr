import {describe, expect, it} from 'vitest';
import {
    clearEphemeralMessage,
    elementPreviewId,
    elementPreviewMessage,
    selectionId,
    selectionMessage,
    strokePreviewId,
    strokePreviewMessage,
    validateWhiteboardEphemeralData,
} from './ephemeral';

describe('whiteboard ephemeral data', () => {
    it('validates concrete whiteboard ephemeral payloads', () => {
        expect(
            validateWhiteboardEphemeralData({
                type: 'element-preview',
                elementId: 'note-1',
                x: 10,
                y: 20,
                width: 120,
                height: 90,
                rotation: 0,
            }),
        ).toBe(true);

        expect(
            validateWhiteboardEphemeralData({
                type: 'stroke-preview',
                strokeId: 'stroke-1',
                points: [
                    [0, 0],
                    [1, 1, 0.5],
                ],
                color: '#17202a',
                width: 4,
            }),
        ).toBe(true);

        expect(
            validateWhiteboardEphemeralData({
                type: 'selection',
                elementIds: ['note-1'],
                bounds: {x: 0, y: 0, width: 100, height: 80},
            }),
        ).toBe(true);
    });

    it('rejects malformed whiteboard ephemeral payloads', () => {
        expect(
            validateWhiteboardEphemeralData({
                type: 'element-preview',
                elementId: 'note-1',
                x: '10',
                y: 20,
            }),
        ).toBe(false);
        expect(
            validateWhiteboardEphemeralData({
                type: 'stroke-preview',
                strokeId: 'stroke-1',
                points: [{x: 0, y: 0}],
                color: '#17202a',
                width: 4,
            }),
        ).toBe(false);
    });

    it('builds stable element preview messages', () => {
        expect(elementPreviewMessage('actor-1', 'note-1', {x: 10, y: 20})).toEqual({
            kind: 'whiteboard:element-preview',
            id: elementPreviewId('actor-1', 'note-1'),
            actor: 'actor-1',
            path: [
                {type: 'key', key: 'elements'},
                {type: 'key', key: 'note-1'},
            ],
            data: {
                type: 'element-preview',
                elementId: 'note-1',
                x: 10,
                y: 20,
            },
        });
    });

    it('builds stable stroke preview messages', () => {
        expect(
            strokePreviewMessage({
                actor: 'actor-1',
                strokeId: 'stroke-1',
                points: [[0, 0]],
                color: '#17202a',
                width: 4,
            }),
        ).toEqual({
            kind: 'whiteboard:stroke-preview',
            id: strokePreviewId('actor-1', 'stroke-1'),
            actor: 'actor-1',
            path: [
                {type: 'key', key: 'elements'},
                {type: 'key', key: 'stroke-1'},
            ],
            data: {
                type: 'stroke-preview',
                strokeId: 'stroke-1',
                points: [[0, 0]],
                color: '#17202a',
                width: 4,
            },
        });
    });

    it('builds path-scoped selection messages', () => {
        expect(selectionMessage({actor: 'actor-1', elementIds: ['note-1']})).toEqual({
            kind: 'whiteboard:selection',
            id: selectionId('actor-1'),
            actor: 'actor-1',
            path: [
                {type: 'key', key: 'elements'},
                {type: 'key', key: 'note-1'},
            ],
            data: {
                type: 'selection',
                elementIds: ['note-1'],
                bounds: undefined,
            },
        });

        expect(selectionMessage({actor: 'actor-1', elementIds: ['note-1', 'note-2']}).path).toEqual(
            [{type: 'key', key: 'elements'}],
        );
    });

    it('builds clear messages with valid whiteboard data', () => {
        const message = clearEphemeralMessage('actor-1', elementPreviewId('actor-1', 'note-1'));

        expect(message).toMatchObject({
            kind: 'whiteboard:clear',
            id: elementPreviewId('actor-1', 'note-1'),
            actor: 'actor-1',
            clear: true,
        });
        expect(validateWhiteboardEphemeralData(message.data)).toBe(true);
    });
});
