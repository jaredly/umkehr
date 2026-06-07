import type {EditorSelection} from './selectionModel';
import {caret, segmentText} from './selectionModel';

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
        offset += segmentText(block.childNodes[index].textContent ?? '').length;
    }
    return offset;
};

const domPointInBlockForOffset = (
    block: HTMLElement,
    wantedOffset: number,
): {node: Node; offset: number} => {
    let offset = Math.max(0, wantedOffset);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) {
        const text = current.textContent ?? '';
        const segments = segmentText(text);
        if (offset < segments.length) {
            return {node: current, offset: utf16OffsetForGraphemeOffset(text, offset)};
        }
        offset -= segments.length;
    }
    return {node: block, offset: block.childNodes.length};
};

const utf16OffsetForGraphemeOffset = (text: string, offset: number): number =>
    segmentText(text)
        .slice(0, offset)
        .join('').length;

const closestBlock = (root: HTMLElement, node: Node): HTMLElement | null => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block = element?.closest<HTMLElement>('[data-block-id]');
    return block && root.contains(block) ? block : null;
};
