import {fractionalIndexBetween} from 'umkehr/crdt';
import type {Path} from 'umkehr';
import type {
    StrokePoint,
    WhiteboardElement,
    WhiteboardState,
} from './model';

export const BOARD_WIDTH = 2400;
export const BOARD_HEIGHT = 1600;

export type Viewport = {
    panX: number;
    panY: number;
    zoom: number;
};

export function elementPath(id: string): Path {
    return [
        {type: 'key', key: 'elements'},
        {type: 'key', key: id},
    ];
}

export function elementFieldPath(id: string, field: string): Path {
    return [...elementPath(id), {type: 'key', key: field}];
}

export function orderedElements(state: WhiteboardState) {
    return Object.values(state.elements)
        .filter((element) => !element.archived)
        .sort(byZOrderThenId);
}

export function archivedElements(state: WhiteboardState) {
    return Object.values(state.elements)
        .filter((element) => element.archived)
        .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.id.localeCompare(b.id));
}

export function byZOrderThenId(a: WhiteboardElement, b: WhiteboardElement) {
    return a.zOrder.localeCompare(b.zOrder) || a.id.localeCompare(b.id);
}

export function nextTopZOrder(elements: WhiteboardElement[]) {
    const top = elements.at(-1);
    return fractionalIndexBetween(top?.zOrder);
}

export function nextBottomZOrder(elements: WhiteboardElement[]) {
    const bottom = elements[0];
    return fractionalIndexBetween(undefined, bottom?.zOrder);
}

export function zOrderBetween(before?: WhiteboardElement, after?: WhiteboardElement) {
    return fractionalIndexBetween(before?.zOrder, after?.zOrder);
}

export function screenToBoard(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    viewport: Viewport,
) {
    return {
        x: clamp((clientX - rect.left - viewport.panX) / viewport.zoom, 0, BOARD_WIDTH),
        y: clamp((clientY - rect.top - viewport.panY) / viewport.zoom, 0, BOARD_HEIGHT),
    };
}

export function boardToScreen(x: number, y: number, viewport: Viewport) {
    return {
        x: x * viewport.zoom + viewport.panX,
        y: y * viewport.zoom + viewport.panY,
    };
}

export function simplifyStroke(points: StrokePoint[], tolerance = 1.8) {
    if (points.length <= 2) return points;
    const deduped: StrokePoint[] = [points[0]];
    for (const point of points.slice(1)) {
        const previous = deduped[deduped.length - 1];
        if (distance(previous, point) >= tolerance) deduped.push(point);
    }
    const last = points[points.length - 1];
    if (deduped[deduped.length - 1] !== last) deduped.push(last);
    return simplifyDouglasPeucker(deduped, tolerance);
}

export function strokePath(points: StrokePoint[]) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    const [first, ...rest] = points;
    return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ${rest
        .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(' ')}`;
}

export function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function distance(a: StrokePoint, b: StrokePoint) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function simplifyDouglasPeucker(points: StrokePoint[], tolerance: number): StrokePoint[] {
    if (points.length <= 2) return points;

    let maxDistance = 0;
    let splitIndex = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const current = perpendicularDistance(points[i], first, last);
        if (current > maxDistance) {
            maxDistance = current;
            splitIndex = i;
        }
    }

    if (maxDistance <= tolerance) return [first, last];

    const left = simplifyDouglasPeucker(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyDouglasPeucker(points.slice(splitIndex), tolerance);
    return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(point: StrokePoint, start: StrokePoint, end: StrokePoint) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return distance(point, start);
    const numerator = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x);
    return numerator / Math.hypot(dx, dy);
}
