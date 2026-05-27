import type {CSSProperties} from 'react';
import type {WhiteboardElement, WhiteboardElementPreviewData} from './model';

export function elementClassName(base: string, selected: boolean, suppressed: boolean) {
    return [base, selected ? 'selected' : '', suppressed ? 'previewSuppressed' : '']
        .filter(Boolean)
        .join(' ');
}

export function elementStyle(element: WhiteboardElement, extra?: CSSProperties): CSSProperties {
    return {
        position: 'absolute',
        left: element.position.x,
        top: element.position.y,
        transform: `rotate(${element.rotation}deg)`,
        ...extra,
    };
}

export function previewElementStyle(
    element: WhiteboardElement,
    preview: WhiteboardElementPreviewData,
    extra?: CSSProperties,
): CSSProperties {
    return {
        ...elementStyle(element, extra),
        left: preview.x,
        top: preview.y,
        transform: `rotate(${preview.rotation ?? element.rotation}deg)`,
    };
}
