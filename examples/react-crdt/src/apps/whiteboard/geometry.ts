import type {EphemeralMessage} from 'umkehr';
import {
    elementPreviewMessage,
    selectionMessage,
    type WhiteboardElementPreviewData,
    type WhiteboardEphemeralData,
    type StrokePoint,
    type WhiteboardElement,
    type WhiteboardState,
} from './model';

export function elementPreviewData(
    element: WhiteboardElement,
    override: Partial<Omit<WhiteboardElementPreviewData, 'type' | 'elementId'>> = {},
): WhiteboardElementPreviewData {
    const size =
        element.type === 'note'
            ? {width: element.size.width, height: element.size.height}
            : element.type === 'emoji'
              ? {width: element.size, height: element.size}
              : {};
    return {
        type: 'element-preview',
        elementId: element.id,
        x: element.position.x,
        y: element.position.y,
        rotation: element.rotation,
        ...size,
        ...override,
    };
}

export function elementPreviewMessages(
    actor: string,
    element: WhiteboardElement,
    preview: WhiteboardElementPreviewData,
    includeSelection: boolean,
): EphemeralMessage<WhiteboardEphemeralData>[] {
    return [
        elementPreviewMessage(actor, element.id, preview),
        ...(includeSelection
            ? [
                  selectionMessage({
                      actor,
                      elementIds: [element.id],
                      bounds: boundsForPreview(element, preview),
                  }),
              ]
            : []),
    ];
}

export function strokePreviewPoints(points: StrokePoint[]): [number, number, number?][] {
    return points.map((point) =>
        point.pressure === undefined ? [point.x, point.y] : [point.x, point.y, point.pressure],
    );
}

export function boundsForElement(element: WhiteboardElement) {
    if (element.type === 'note') {
        return {
            x: element.position.x,
            y: element.position.y,
            width: element.size.width,
            height: element.size.height,
        };
    }
    if (element.type === 'emoji') {
        return {
            x: element.position.x,
            y: element.position.y,
            width: element.size,
            height: element.size,
        };
    }
    const xs = element.points.map((point) => point.x + element.position.x);
    const ys = element.points.map((point) => point.y + element.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
        x: minX,
        y: minY,
        width: Math.max(1, Math.max(...xs) - minX),
        height: Math.max(1, Math.max(...ys) - minY),
    };
}

export function boundsForPreview(element: WhiteboardElement, preview: WhiteboardElementPreviewData) {
    if (element.type === 'note') {
        return {
            x: preview.x,
            y: preview.y,
            width: preview.width ?? element.size.width,
            height: preview.height ?? element.size.height,
        };
    }
    if (element.type === 'emoji') {
        return {
            x: preview.x,
            y: preview.y,
            width: preview.width ?? element.size,
            height: preview.height ?? element.size,
        };
    }
    const xs = element.points.map((point) => point.x + preview.x);
    const ys = element.points.map((point) => point.y + preview.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
        x: minX,
        y: minY,
        width: Math.max(1, Math.max(...xs) - minX),
        height: Math.max(1, Math.max(...ys) - minY),
    };
}

export function boundsForElements(state: WhiteboardState, ids: string[]) {
    const bounds = ids
        .map((id) => state.elements[id])
        .filter((element): element is WhiteboardElement => Boolean(element && !element.archived))
        .map(boundsForElement);
    if (!bounds.length) return null;
    const minX = Math.min(...bounds.map((item) => item.x));
    const minY = Math.min(...bounds.map((item) => item.y));
    const maxX = Math.max(...bounds.map((item) => item.x + item.width));
    const maxY = Math.max(...bounds.map((item) => item.y + item.height));
    return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
}
