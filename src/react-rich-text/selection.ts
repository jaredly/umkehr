export type TextRange = {start: number; end: number};

export function selectionInside(root: HTMLElement) {
    const selection = root.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    return nodeInside(root, selection.anchorNode) && nodeInside(root, selection.focusNode);
}

export function selectionRangeIn(root: HTMLElement): TextRange | null {
    const selection = root.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    if (!nodeInside(root, selection.anchorNode) || !nodeInside(root, selection.focusNode)) {
        return null;
    }

    const range = selection.getRangeAt(0);
    return {
        start: textOffsetForDomPoint(root, range.startContainer, range.startOffset),
        end: textOffsetForDomPoint(root, range.endContainer, range.endOffset),
    };
}

export function restoreSelection(root: HTMLElement, range: TextRange) {
    const selection = root.ownerDocument.defaultView?.getSelection();
    if (!selection) return;
    const start = domPointForTextOffset(root, range.start);
    const end = domPointForTextOffset(root, range.end);
    const domRange = root.ownerDocument.createRange();
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(domRange);
}

export function domPointForTextOffset(root: HTMLElement, offset: number): {node: Node; offset: number} {
    const target = Math.max(0, offset);
    let remaining = target;
    let last: Text | null = null;
    for (const node of textNodes(root)) {
        last = node;
        if (remaining <= node.data.length) {
            return {node, offset: remaining};
        }
        remaining -= node.data.length;
    }
    if (last) return {node: last, offset: last.data.length};
    return {node: root, offset: 0};
}

function textOffsetForDomPoint(root: HTMLElement, container: Node, offset: number) {
    let total = 0;
    for (const node of textNodes(root)) {
        if (node === container) return total + offset;
        if (node.contains(container)) {
            return total + textOffsetInside(node, container, offset);
        }
        total += node.data.length;
    }
    return total;
}

function textOffsetInside(root: Node, container: Node, offset: number): number {
    if (root === container) return offset;
    let total = 0;
    for (const child of Array.from(root.childNodes)) {
        if (child === container) return total + offset;
        if (child.contains(container)) return total + textOffsetInside(child, container, offset);
        total += child.textContent?.length ?? 0;
    }
    return total;
}

function textNodes(root: HTMLElement): Text[] {
    const showText = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = root.ownerDocument.createTreeWalker(root, showText);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }
    return nodes;
}

function nodeInside(root: HTMLElement, node: Node | null) {
    return node === root || (node !== null && root.contains(node));
}
