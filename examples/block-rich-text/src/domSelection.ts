import type {BlockPoint, DecorationAffinity, EditorSelection} from './selectionModel';
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
        return {type: 'caret', point: focus};
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
    if (selection.type !== 'caret' && selection.type !== 'range') return;

    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = selection.type === 'caret' ? selection.point : selection.focus;
    const anchorDom = domPointForOffset(root, anchor);
    const focusDom = domPointForOffset(root, focus);
    if (!anchorDom || !focusDom) return;

    const range = document.createRange();
    range.setStart(anchorDom.node, anchorDom.offset);
    range.collapse(true);
    domSelection.removeAllRanges();
    domSelection.addRange(range);
    domSelection.extend(focusDom.node, focusDom.offset);
};

export const restoreCaretToDom = (block: HTMLElement, point: BlockPoint) => {
    const domSelection = window.getSelection();
    if (!domSelection) return;
    const domPoint = domPointInBlockForOffset(block, point.offset, point.visualAffinity);
    const range = document.createRange();
    range.setStart(domPoint.node, domPoint.offset);
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
): BlockPoint | null => {
    if (!node) return null;
    const block = closestBlock(root, node);
    if (!block) return null;
    if (node === block) {
        return withDecorationAffinity(
            block,
            node,
            nodeOffset,
            {blockId: block.dataset.blockId!, offset: textLengthBeforeChild(block, nodeOffset)},
        );
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        return withDecorationAffinity(block, node, nodeOffset, {
            blockId: block.dataset.blockId!,
            offset: textLengthBeforeDomPoint(block, node, nodeOffset),
        });
    }

    let offset = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isOffsetSentinel(current)) {
            if (current === node) {
                return withDecorationAffinity(block, node, nodeOffset, {blockId: block.dataset.blockId!, offset});
            }
            continue;
        }
        if (current === node) {
            return withDecorationAffinity(block, node, nodeOffset, {
                blockId: block.dataset.blockId!,
                offset: offset + textGraphemeLengthBeforeUtf16Offset(current.textContent ?? '', nodeOffset),
            });
        }
        offset += textGraphemeLength(current.textContent ?? '');
    }

    return {blockId: block.dataset.blockId!, offset};
};

const textLengthBeforeChild = (block: HTMLElement, childOffset: number): number => {
    let offset = 0;
    for (let index = 0; index < childOffset && index < block.childNodes.length; index++) {
        const child = block.childNodes[index];
        if (isInlineEmbedElement(child)) {
            offset += 1;
            continue;
        }
        if (isOffsetSentinel(child)) continue;
        offset += textGraphemeLength(child.textContent ?? '');
    }
    return offset;
};

const textLengthBeforeDomPoint = (block: HTMLElement, node: Node, nodeOffset: number): number => {
    let offset = 0;

    const visit = (current: Node): boolean => {
        if (isOffsetSentinel(current)) return false;
        if (current === node) {
            for (let index = 0; index < nodeOffset && index < current.childNodes.length; index++) {
                offset += textLengthForSubtree(current.childNodes[index]);
            }
            return true;
        }
        if (current.nodeType === Node.TEXT_NODE) {
            offset += textGraphemeLength(current.textContent ?? '');
            return false;
        }
        if (isInlineEmbedElement(current)) {
            offset += 1;
            return false;
        }
        for (let index = 0; index < current.childNodes.length; index++) {
            if (visit(current.childNodes[index])) return true;
        }
        return false;
    };

    visit(block);
    return offset;
};

const textLengthForSubtree = (node: Node): number => {
    if (isOffsetSentinel(node)) return 0;
    if (isInlineEmbedElement(node)) return 1;
    if (node.nodeType === Node.TEXT_NODE) return textGraphemeLength(node.textContent ?? '');
    let length = 0;
    for (let index = 0; index < node.childNodes.length; index++) {
        length += textLengthForSubtree(node.childNodes[index]);
    }
    return length;
};

const withDecorationAffinity = (
    block: HTMLElement,
    node: Node,
    nodeOffset: number,
    point: BlockPoint,
): BlockPoint => {
    const visualAffinity = decorationAffinityForDomPoint(block, node, nodeOffset, point.offset);
    return visualAffinity ? {...point, visualAffinity} : point;
};

const decorationAffinityForDomPoint = (
    block: HTMLElement,
    node: Node,
    nodeOffset: number,
    offset: number,
): DecorationAffinity | null => {
    const decorations = decorationsAtOffset(block, offset);
    if (!decorations.length) return null;

    const current = collapsedRangeAt(node, nodeOffset);
    const before = collapsedRangeBefore(decorations[0]);
    const after = collapsedRangeAfter(decorations[decorations.length - 1]);

    if (isSameOrVisuallyEmptyBefore(current, before)) return 'beforeDecorations';
    if (isSameOrVisuallyEmptyBefore(after, current)) return 'afterDecorations';
    return null;
};

const documentWithCaretPoint = (): Document & {
    caretPositionFromPoint?: (
        x: number,
        y: number,
    ) => {offsetNode: Node; offset: number} | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
} => document;

const domPointForOffset = (root: HTMLElement, point: BlockPoint): {node: Node; offset: number} | null => {
    const block =
        root.dataset.blockId === point.blockId
            ? root
            : root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(point.blockId)}"]`);
    if (!block) return null;
    return domPointInBlockForOffset(block, point.offset, point.visualAffinity);
};

const domPointInBlockForOffset = (
    block: HTMLElement,
    wantedOffset: number,
    visualAffinity?: DecorationAffinity,
): {node: Node; offset: number} => {
    let offset = Math.max(0, wantedOffset);
    const decorationBoundary = visualAffinity
        ? decorationBoundaryForOffset(block, offset, visualAffinity)
        : null;
    if (decorationBoundary) return decorationBoundary;

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        if (isOffsetSentinel(current)) continue;
        const inlineEmbed = closestInlineEmbed(block, current);
        if (inlineEmbed) {
            const boundary = childBoundaryAroundInlineEmbed(inlineEmbed, offset <= 0 ? 'before' : 'after');
            if (offset <= 1 && boundary) return boundary;
            offset -= 1;
            continue;
        }
        const text = current.textContent ?? '';
        const length = textGraphemeLength(text);
        if (offset === length && text.endsWith('\n') && hasTrailingCodeNewlineTarget(block)) {
            offset -= length;
            continue;
        }
        if (offset === length) {
            return {node: current, offset: text.length};
        }
        if (offset <= length) {
            return {node: current, offset: utf16OffsetForGraphemeOffset(text, offset)};
        }
        offset -= length;
    }
    const trailingCodeNewline = block.querySelector<HTMLElement>('[data-trailing-code-newline="true"]');
    const trailingText = trailingCodeNewline?.firstChild;
    if (trailingText?.nodeType === Node.TEXT_NODE) {
        return {node: trailingText, offset: trailingText.textContent?.length ?? 0};
    }
    return {node: block, offset: block.childNodes.length};
};

const decorationBoundaryForOffset = (
    block: HTMLElement,
    offset: number,
    visualAffinity: DecorationAffinity,
): {node: Node; offset: number} | null => {
    const decorations = decorationsAtOffset(block, offset);
    const decoration =
        visualAffinity === 'beforeDecorations'
            ? decorations[0]
            : decorations[decorations.length - 1];
    if (!decoration) return null;
    return boundaryAroundNode(decoration, visualAffinity === 'beforeDecorations' ? 'before' : 'after');
};

const decorationsAtOffset = (block: HTMLElement, offset: number): HTMLElement[] => {
    const decorations = Array.from(
        block.querySelectorAll<HTMLElement>('[data-offset-sentinel="true"]'),
    ).filter(isZeroWidthDecorationElement);
    return decorations.filter((decoration) => {
        const parent = decoration.parentNode;
        if (!parent) return false;
        const index = Array.prototype.indexOf.call(parent.childNodes, decoration);
        return index >= 0 && textLengthBeforeDomPoint(block, parent, index) === offset;
    });
};

const isZeroWidthDecorationElement = (element: HTMLElement): boolean =>
    !element.closest('[data-inline-embed="true"]') &&
    element.dataset.trailingCodeNewline !== 'true';

const boundaryAroundNode = (
    node: Node,
    side: 'before' | 'after',
): {node: Node; offset: number} | null => {
    const parent = node.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    if (index < 0) return null;
    return {node: parent, offset: side === 'before' ? index : index + 1};
};

const collapsedRangeAt = (node: Node, offset: number): Range => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    return range;
};

const collapsedRangeBefore = (node: Node): Range => {
    const range = document.createRange();
    range.setStartBefore(node);
    range.collapse(true);
    return range;
};

const collapsedRangeAfter = (node: Node): Range => {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    return range;
};

const isSameOrVisuallyEmptyBefore = (start: Range, end: Range): boolean => {
    const order = start.compareBoundaryPoints(0, end);
    if (order === 0) return true;
    if (order > 0) return false;
    const between = document.createRange();
    between.setStart(start.startContainer, start.startOffset);
    between.setEnd(end.startContainer, end.startOffset);
    return between.toString() === '';
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
        length += textGraphemeLength(current.textContent ?? '');
    }
    return length;
};

export const caretRectForBlockOffset = (block: HTMLElement, offset: number): CaretRect => {
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
    isAsciiText(text)
        ? Math.min(offset, text.length)
        : segmentText(text)
              .slice(0, offset)
              .join('').length;

const textGraphemeLength = (text: string): number =>
    isAsciiText(text) ? text.length : segmentText(text).length;

const textGraphemeLengthBeforeUtf16Offset = (text: string, offset: number): number =>
    isAsciiText(text) ? Math.min(offset, text.length) : segmentText(text.slice(0, offset)).length;

const isAsciiText = (text: string): boolean => {
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) > 0x7f) return false;
    }
    return true;
};

const closestBlock = (root: HTMLElement, node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block = element?.closest<HTMLElement>('[data-block-id]');
    return block && root.contains(block) ? block : null;
};

const isOffsetSentinel = (node: Node): boolean => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return Boolean(element?.closest('[data-offset-sentinel="true"]'));
};

const isInlineEmbedElement = (node: Node): node is HTMLElement =>
    node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.inlineEmbed === 'true';

const closestInlineEmbed = (block: HTMLElement, node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const inlineEmbed = element?.closest<HTMLElement>('[data-inline-embed="true"]') ?? null;
    return inlineEmbed && block.contains(inlineEmbed) ? inlineEmbed : null;
};

const childBoundaryAroundInlineEmbed = (
    inlineEmbed: HTMLElement,
    side: 'before' | 'after',
): {node: Node; offset: number} | null => {
    const parent = inlineEmbed.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, inlineEmbed);
    if (index < 0) return null;
    return {node: parent, offset: side === 'before' ? index : index + 1};
};

const hasTrailingCodeNewlineTarget = (block: HTMLElement): boolean =>
    Boolean(block.querySelector('[data-trailing-code-newline="true"]'));
