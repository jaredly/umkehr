import type {KeyboardEvent, MouseEvent} from 'react';

import type {EditorSelection} from './selectionModel';
import type {BlockSelectionDecorations} from './selectionSet';

export const stopEditorControlEvent = (event: {stopPropagation(): void}) => {
    event.stopPropagation();
};

export const isJsdom = () => navigator.userAgent.includes('jsdom');

export const imageFilesFromDataTransfer = (dataTransfer: DataTransfer): File[] => {
    const files = Array.from(dataTransfer.files ?? []).filter(isImageFile);
    if (files.length) return files;
    return Array.from(dataTransfer.items ?? [])
        .filter((item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')))
        .map((item) => item.getAsFile())
        .filter((file): file is File => {
            if (!file) return false;
            return isImageFile(file);
        });
};

export const isImageFile = (file: File): boolean =>
    file.type.startsWith('image/') || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name);

export const isPlainArrowKey = (key: string) =>
    key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

export const isSameClick = (
    start: {x: number; y: number},
    event: MouseEvent | KeyboardEvent,
): event is MouseEvent => {
    if (event.type !== 'mouseup' || !('clientX' in event) || !('clientY' in event)) return false;
    return Math.abs(event.clientX - start.x) <= 3 && Math.abs(event.clientY - start.y) <= 3;
};

export const removePrimaryDecorations = (
    decorations: BlockSelectionDecorations | null,
): BlockSelectionDecorations | null => {
    if (!decorations) return decorations;
    if (
        !decorations.carets.some((caret) => caret.primary) &&
        !decorations.segments.some((segment) => segment.primary)
    ) {
        return decorations;
    }

    const nextDecorations = {
        carets: decorations.carets.filter((caret) => !caret.primary),
        segments: decorations.segments.filter((segment) => !segment.primary),
    };
    return nextDecorations.carets.length || nextDecorations.segments.length
        ? nextDecorations
        : null;
};

export const sameSelectionRange = (one: EditorSelection, two: EditorSelection) => {
    if (one.type !== 'range' || two.type !== 'range') return false;
    return (
        one.anchor.blockId === two.anchor.blockId &&
        one.anchor.offset === two.anchor.offset &&
        one.focus.blockId === two.focus.blockId &&
        one.focus.offset === two.focus.offset
    );
};

export const numberRecordEquals = (one: Record<string, number>, two: Record<string, number>) => {
    const oneKeys = Object.keys(one);
    const twoKeys = Object.keys(two);
    if (oneKeys.length !== twoKeys.length) return false;
    return oneKeys.every((key) => one[key] === two[key]);
};

export const editorSelectionKey = (selection: EditorSelection): string => {
    if (selection.type === 'caret') {
        return `caret:${selection.point.blockId}:${selection.point.offset}`;
    }
    if (selection.type === 'block') {
        return `block:${selection.anchorBlockId}:${selection.focusBlockId}`;
    }
    if (selection.type === 'table-cells') {
        return `table-cells:${selection.tableId}:${selection.anchorCellId}:${selection.focusCellId}`;
    }
    if (selection.type === 'range') {
        return [
            'range',
            selection.anchor.blockId,
            selection.anchor.offset,
            selection.focus.blockId,
            selection.focus.offset,
        ].join(':');
    }
    return `plugin:${selection.type}:${JSON.stringify(selection)}`;
};

export const measureInput = (
    onInputMeasured: ((label: string, ms: number) => void) | undefined,
    label: string,
    action: () => void,
) => {
    const started = performance.now();
    try {
        action();
    } finally {
        onInputMeasured?.(label, performance.now() - started);
    }
};

export const measureTextInput = (
    onInputMeasured: ((label: string, ms: number) => void) | undefined,
    onDisplayInputRenderStarted: ((label: string, started: number) => void) | undefined,
    text: string,
    action: () => void,
) => {
    const started = performance.now();
    const label = textInputLabel(text);
    try {
        action();
    } finally {
        const handledAt = performance.now();
        onInputMeasured?.(label, handledAt - started);
        if (isDisplayableKeyText(text)) {
            onDisplayInputRenderStarted?.(label, performance.now());
        }
    }
};

export const textInputLabel = (text: string): string =>
    text.length <= 2 && !/\s/.test(text) ? text : 'text';

const isDisplayableKeyText = (text: string): boolean =>
    text.length > 0 && !/[\u0000-\u001f\u007f]/.test(text);

export const beforeInputLabel = (event: InputEvent): string => {
    if (event.inputType === 'insertText' && event.data) {
        return textInputLabel(event.data);
    }
    if (event.inputType === 'deleteContentBackward') return 'Backspace';
    if (event.inputType === 'deleteContentForward') return 'Delete';
    return event.inputType || 'input';
};

export const keyboardEventLabel = (event: KeyboardEvent): string => {
    const modifiers = [
        event.metaKey ? 'Meta' : '',
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    return [...modifiers, event.key].join('+') + (event.repeat ? ' repeat' : '');
};
