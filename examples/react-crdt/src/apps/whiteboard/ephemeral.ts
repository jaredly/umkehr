import typia from 'typia';
import type {EphemeralMessage} from 'umkehr/react-crdt';
import type {Path} from 'umkehr';
import {elementPath} from './helpers';

export type WhiteboardElementPreviewData = {
    type: 'element-preview';
    elementId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
};

export type WhiteboardStrokePreviewData = {
    type: 'stroke-preview';
    strokeId: string;
    points: [number, number, number?][];
    color: string;
    width: number;
};

export type WhiteboardSelectionData = {
    type: 'selection';
    elementIds: string[];
    bounds?: {x: number; y: number; width: number; height: number};
};

export type WhiteboardEphemeralData =
    | WhiteboardElementPreviewData
    | WhiteboardStrokePreviewData
    | WhiteboardSelectionData;

export const validateWhiteboardEphemeralData = typia.createIs<WhiteboardEphemeralData>();

export function elementPreviewMessage(
    actor: string,
    elementId: string,
    transform: Omit<WhiteboardElementPreviewData, 'type' | 'elementId'>,
): EphemeralMessage<WhiteboardEphemeralData> {
    return {
        kind: 'whiteboard:element-preview',
        id: elementPreviewId(actor, elementId),
        actor,
        path: elementPath(elementId),
        data: {
            type: 'element-preview',
            elementId,
            ...transform,
        },
    };
}

export function strokePreviewMessage({
    actor,
    strokeId,
    points,
    color,
    width,
}: {
    actor: string;
    strokeId: string;
    points: [number, number, number?][];
    color: string;
    width: number;
}): EphemeralMessage<WhiteboardEphemeralData> {
    return {
        kind: 'whiteboard:stroke-preview',
        id: strokePreviewId(actor, strokeId),
        actor,
        path: elementPath(strokeId),
        data: {
            type: 'stroke-preview',
            strokeId,
            points,
            color,
            width,
        },
    };
}

export function selectionMessage({
    actor,
    elementIds,
    bounds,
}: {
    actor: string;
    elementIds: string[];
    bounds?: {x: number; y: number; width: number; height: number};
}): EphemeralMessage<WhiteboardEphemeralData> {
    return {
        kind: 'whiteboard:selection',
        id: selectionId(actor),
        actor,
        path: selectionPath(elementIds),
        data: {
            type: 'selection',
            elementIds,
            bounds,
        },
    };
}

export function clearEphemeralMessage(
    actor: string,
    id: string,
): EphemeralMessage<WhiteboardEphemeralData> {
    return {
        kind: 'whiteboard:clear',
        id,
        actor,
        clear: true,
        data: {
            type: 'selection',
            elementIds: [],
        },
    };
}

export function elementPreviewId(actor: string, elementId: string) {
    return `whiteboard:element-preview:${actor}:${elementId}`;
}

export function strokePreviewId(actor: string, strokeId: string) {
    return `whiteboard:stroke-preview:${actor}:${strokeId}`;
}

export function selectionId(actor: string) {
    return `whiteboard:selection:${actor}`;
}

function selectionPath(elementIds: string[]): Path | undefined {
    if (elementIds.length === 1) return elementPath(elementIds[0]);
    if (elementIds.length > 1) return [{type: 'key', key: 'elements'}];
    return undefined;
}
