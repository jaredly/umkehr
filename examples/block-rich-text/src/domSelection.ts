import type {BlockPoint, EditorSelection} from './selectionModel';
import {caret, segmentText} from './selectionModel';

export type CaretHorizontalIntent = {
    x: number;
};

type CaretRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
};

export const readSelectionFromDom = (root: HTMLElement): EditorSelection | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

    const anchor = pointFromDom(root, selection.anchorNode, selection.anchorOffset);
    const focus = pointFromDom(root, selection.focusNode, selection.focusOffset);
    if (!anchor || !focus) return null;
    if (anchor.blockId === focus.blockId && anchor.offset === focus.offset) {
        return caret(focus.blockId, focus.offset);
    }
    return {type: 'range', anchor, focus};
};

export const readPointFromMouseEvent = (
    root: HTMLElement,
    event: MouseEvent,
): BlockPoint | null => {
    const caretPosition = documentWithCaretPoint().caretPositionFromPoint?.(
        event.clientX,
        event.clientY,
    );
    if (caretPosition) {
        return pointFromDom(root, caretPosition.offsetNode, caretPosition.offset);
    }

    const caretRange = documentWithCaretPoint().caretRangeFromPoint?.(
        event.clientX,
        event.clientY,
    );
    if (caretRange) {
        return pointFromDom(root, caretRange.startContainer, caretRange.startOffset);
    }

    return null;
};

export const restoreSelectionToDom = (root: HTMLElement, selection: EditorSelection) => {
    const domSelection = window.getSelection();
    if (!domSelection) return;

    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = selection.type === 'caret' ? selection.point : selection.focus;
    const anchorDom = domPointForOffset(root, anchor.blockId, anchor.offset);
    const focusDom = domPointForOffset(root, focus.blockId, focus.offset);
    if (!anchorDom || !focusDom) return;

    const range = document.createRange();
    range.setStart(anchorDom.node, anchorDom.offset);
    range.collapse(true);
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    domSelection.extend(focusDom.node, focusDom.offset);
};

export const restoreCaretToDom = (block: HTMLElement, offset: number) => {
    const domSelection = window.getSelection();
    if (!domSelection) return;
    const point = domPointInBlockForOffset(block, offset);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    domSelection.removeAllRanges();
    domSelection.addRange(range);
};

export const readCaretHorizontalIntent = (root: HTMLElement): CaretHorizontalIntent | null => {
    const range = collapsedRangeIn(root);
    if (!range) return null;
    const block = closestBlock(root, range.startContainer);
    const rect = block ? caretRectForRange(range, block) : null;
    return rect ? {x: caretX(rect)} : null;
};

export const readSelectionFocusHorizontalIntent = (root: HTMLElement): CaretHorizontalIntent | null => {
    const selection = window.getSelection();
    if (!selection || !selection.focusNode || !root.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const block = closestBlock(root, selection.focusNode);
    const rect = block ? caretRectForRange(range, block) : null;
    return rect ? {x: caretX(rect)} : null;
};

export const closestCaretOffsetForHorizontalIntent = (
    block: HTMLElement,
    intent: CaretHorizontalIntent,
): number => {
    const length = blockTextLength(block);
    let closestOffset = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset <= length; offset++) {
        const rect = caretRectForBlockOffset(block, offset);
        const distance = Math.abs(caretX(rect) - intent.x);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestOffset = offset;
        }
    }

    return closestOffset;
};

export const isCaretOnFirstVisualLine = (block: HTMLElement): boolean => {
    const range = collapsedRangeIn(block);
    if (!range) return false;
    const current = caretRectForRange(range, block);
    if (!current) return true;
    const currentTop = current.top;
    const tolerance = Math.max(2, current.height / 2);

    for (let offset = 0; offset <= blockTextLength(block); offset++) {
        const candidate = caretRectForBlockOffset(block, offset);
        if (candidate.top < currentTop - tolerance) return false;
    }

    return true;
};

export const isCaretOnLastVisualLine = (block: HTMLElement): boolean => {
    const range = collapsedRangeIn(block);
    if (!range) return false;
    const current = caretRectForRange(range, block);
    if (!current) return true;
    const currentTop = current.top;
    const tolerance = Math.max(2, current.height / 2);

    for (let offset = 0; offset <= blockTextLength(block); offset++) {
        const candidate = caretRectForBlockOffset(block, offset);
        if (candidate.top > currentTop + tolerance) return false;
    }

    return true;
};

const pointFromDom = (
    root: HTMLElement,
    node: Node | null,
    nodeOffset: number,
): {blockId: string; offset: number} | null => {
    if (!node) return null;
    const block = closestBlock(root, node);
    if (!block) return null;

    let offset = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isOffsetSentinel(current)) {
            if (current === node) {
                return {blockId: block.dataset.blockId!, offset};
            }
            continue;
        }
        if (current === node) {
            return {
                blockId: block.dataset.blockId!,
                offset: offset + segmentText((current.textContent ?? '').slice(0, nodeOffset)).length,
            };
        }
        offset += segmentText(current.textContent ?? '').length;
    }

    if (node === block) {
        return {blockId: block.dataset.blockId!, offset: textLengthBeforeChild(block, nodeOffset)};
    }
    return {blockId: block.dataset.blockId!, offset};
};

const textLengthBeforeChild = (block: HTMLElement, childOffset: number): number => {
    let offset = 0;
    for (let index = 0; index < childOffset && index < block.childNodes.length; index++) {
        if (isOffsetSentinel(block.childNodes[index])) continue;
        offset += segmentText(block.childNodes[index].textContent ?? '').length;
    }
    return offset;
};

const documentWithCaretPoint = (): Document & {
    caretPositionFromPoint?: (
        x: number,
        y: number,
    ) => {offsetNode: Node; offset: number} | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
} => document;

const domPointForOffset = (
    root: HTMLElement,
    blockId: string,
    wantedOffset: number,
): {node: Node; offset: number} | null => {
    const block =
        root.dataset.blockId === blockId
            ? root
            : root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (!block) return null;
    return domPointInBlockForOffset(block, wantedOffset);
};

const domPointInBlockForOffset = (
    block: HTMLElement,
    wantedOffset: number,
): {node: Node; offset: number} => {
    let offset = Math.max(0, wantedOffset);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isOffsetSentinel(current)) continue;
        const text = current.textContent ?? '';
        const segments = segmentText(text);
        if (offset < segments.length) {
            return {node: current, offset: utf16OffsetForGraphemeOffset(text, offset)};
        }
        offset -= segments.length;
    }
    const trailingCodeNewline = block.querySelector<HTMLElement>('[data-trailing-code-newline="true"]');
    const trailingText = trailingCodeNewline?.firstChild;
    if (trailingText?.nodeType === Node.TEXT_NODE) {
        return {node: trailingText, offset: trailingText.textContent?.length ?? 0};
    }
    return {node: block, offset: block.childNodes.length};
};

const collapsedRangeIn = (root: HTMLElement): Range | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    return range;
};

const blockTextLength = (block: HTMLElement): number => {
    let length = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isOffsetSentinel(current)) continue;
        length += segmentText(current.textContent ?? '').length;
    }
    return length;
};

const caretRectForBlockOffset = (block: HTMLElement, offset: number): CaretRect => {
    const point = domPointInBlockForOffset(block, offset);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    return caretRectForRange(range, block) ?? fallbackBlockRect(block);
};

const caretRectForRange = (range: Range, fallbackBlock: HTMLElement): CaretRect | null => {
    const firstClientRect = range.getClientRects()[0];
    if (hasUsableRect(firstClientRect)) return rectLike(firstClientRect);

    const boundingRect = range.getBoundingClientRect();
    if (hasUsableRect(boundingRect)) return rectLike(boundingRect);

    const markerRect = measureTemporaryCaretMarker(range);
    if (markerRect) return markerRect;

    return fallbackBlockRect(fallbackBlock);
};

const measureTemporaryCaretMarker = (range: Range): CaretRect | null => {
    const marker = document.createElement('span');
    marker.style.display = 'inline-block';
    marker.style.width = '0';
    marker.style.height = '1em';
    marker.style.overflow = 'hidden';
    marker.textContent = '\u200b';

    const markerRange = range.cloneRange();
    markerRange.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    marker.remove();
    return hasUsableRect(rect) ? rectLike(rect) : null;
};

const fallbackBlockRect = (block: HTMLElement): CaretRect => {
    const rect = block.getBoundingClientRect();
    return rectLike(rect);
};

const hasUsableRect = (rect: DOMRect | DOMRectReadOnly | undefined): rect is DOMRect | DOMRectReadOnly =>
    !!rect && (rect.width > 0 || rect.height > 0 || rect.left !== 0 || rect.top !== 0);

const rectLike = (rect: DOMRect | DOMRectReadOnly): CaretRect => ({
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
});

const caretX = (rect: CaretRect): number => (rect.width > 0 ? rect.left + rect.width / 2 : rect.left);

const utf16OffsetForGraphemeOffset = (text: string, offset: number): number =>
    segmentText(text)
        .slice(0, offset)
        .join('').length;

const closestBlock = (root: HTMLElement, node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block = element?.closest<HTMLElement>('[data-block-id]');
    return block && root.contains(block) ? block : null;
};

const isOffsetSentinel = (node: Node): boolean => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return Boolean(element?.closest('[data-offset-sentinel="true"]'));
};
