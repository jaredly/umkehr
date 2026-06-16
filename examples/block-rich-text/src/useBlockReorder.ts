import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent} from 'react';
import type {MoveTarget} from './blockCommands';

const DRAG_START_THRESHOLD_PX = 4;

export type BlockOutlineItem = {
    id: string;
    depth: number;
    parentId: string;
};

export type DropTarget = {
    command: MoveTarget;
    indicatorBlockId: string;
    indicatorPlacement: 'before' | 'after';
    indicatorDepth: number;
};

type PendingDrag = {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    source: HTMLElement;
};

export function useBlockReorder({
    blocks,
    onMove,
}: {
    blocks: BlockOutlineItem[];
    onMove(blockId: string, target: MoveTarget): void;
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());
    const blocksRef = useRef(blocks);
    const draggingRef = useRef<string | null>(null);
    const pendingDragRef = useRef<PendingDrag | null>(null);
    const [hasPointerGesture, setHasPointerGesture] = useState(false);

    blocksRef.current = blocks;

    const draggingSubtreeIds = useMemo(
        () => (draggingId ? subtreeIds(blocks, draggingId) : new Set<string>()),
        [blocks, draggingId],
    );

    const registerRow = useCallback((id: string, element: HTMLElement | null) => {
        if (element) rowRefs.current.set(id, element);
        else rowRefs.current.delete(id);
    }, []);

    const findDropTarget = useCallback((clientX: number, clientY: number): DropTarget | null => {
        const dragged = draggingRef.current;
        const currentBlocks = blocksRef.current;
        const rows = currentBlocks
            .map((block) => {
                const element = rowRefs.current.get(block.id);
                return element ? {block, rect: element.getBoundingClientRect()} : null;
            })
            .filter((row) => row !== null);
        if (!rows.length) return null;

        const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
        if (containing) {
            return resolveDropTarget(currentBlocks, containing.block, {
                clientX,
                clientY,
                rect: containing.rect,
                dragged,
            });
        }

        const before = rows.find(({rect}) => clientY < rect.top);
        if (before) {
            return normalizeDropTarget(currentBlocks, before.block, {
                command: {type: 'before', targetBlockId: before.block.id},
                indicatorBlockId: before.block.id,
                indicatorPlacement: 'before',
                indicatorDepth: before.block.depth,
                dragged,
            });
        }
        const last = rows[rows.length - 1].block;
        return normalizeDropTarget(currentBlocks, last, {
            command: {type: 'after', targetBlockId: last.id},
            indicatorBlockId: last.id,
            indicatorPlacement: 'after',
            indicatorDepth: last.depth,
            dragged,
        });
    }, []);

    useEffect(() => {
        if (!hasPointerGesture) return;

        const onPointerMove = (event: globalThis.PointerEvent) => {
            const pending = pendingDragRef.current;
            if (pending) {
                if (event.pointerId !== pending.pointerId) return;
                const deltaX = event.clientX - pending.startX;
                const deltaY = event.clientY - pending.startY;
                if (Math.hypot(deltaX, deltaY) < DRAG_START_THRESHOLD_PX) return;
                pendingDragRef.current = null;
                draggingRef.current = pending.id;
                pending.source.dataset.blockDragSuppressClick = 'true';
                window.setTimeout(() => {
                    if (pending.source.dataset.blockDragSuppressClick === 'true') {
                        delete pending.source.dataset.blockDragSuppressClick;
                    }
                }, 0);
                setDraggingId(pending.id);
            }
            if (!draggingRef.current) return;
            event.preventDefault();
            setDropTarget(findDropTarget(event.clientX, event.clientY));
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            const wasDragging = draggingRef.current !== null;
            if (wasDragging) event.preventDefault();
            const target = wasDragging
                ? findDropTarget(event.clientX, event.clientY) ?? dropTarget
                : null;
            const dragged = draggingRef.current;
            pendingDragRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
            setHasPointerGesture(false);
            draggingRef.current = null;
            if (!dragged || !target) return;
            onMove(dragged, target.command);
        };
        const onPointerCancel = () => {
            pendingDragRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
            setHasPointerGesture(false);
            draggingRef.current = null;
        };
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [dropTarget, findDropTarget, hasPointerGesture, onMove]);

    const startDrag = useCallback((id: string, event: PointerEvent<HTMLElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pendingDragRef.current = {
            id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            source: event.currentTarget,
        };
        draggingRef.current = null;
        setDraggingId(null);
        setDropTarget(null);
        setHasPointerGesture(true);
    }, []);

    return {draggingId, draggingSubtreeIds, dropTarget, registerRow, startDrag};
}

const resolveDropTarget = (
    blocks: BlockOutlineItem[],
    hovered: BlockOutlineItem,
    {
        clientX,
        clientY,
        rect,
        dragged,
    }: {
        clientX: number;
        clientY: number;
        rect: DOMRect;
        dragged: string | null;
    },
): DropTarget | null => {
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    const childIntent = clientX >= rect.left + 64;

    if (childIntent && ratio >= 0.25 && ratio <= 0.75) {
        const at = ratio < 0.5 ? 'start' : 'end';
        return normalizeDropTarget(blocks, hovered, {
            command: {type: 'child', parentBlockId: hovered.id, at},
            ...targetChildIndicator(blocks, hovered, at),
            dragged,
        });
    }

    if (ratio < 0.5) {
        return normalizeDropTarget(blocks, hovered, {
            command: {type: 'before', targetBlockId: hovered.id},
            indicatorBlockId: hovered.id,
            indicatorPlacement: 'before',
            indicatorDepth: hovered.depth,
            dragged,
        });
    }

    const afterSubtree = targetAfterSubtree(blocks, hovered);
    return normalizeDropTarget(blocks, hovered, {...afterSubtree, dragged});
};

const targetAfterSubtree = (
    blocks: BlockOutlineItem[],
    hovered: BlockOutlineItem,
): Omit<DropTarget, 'command'> & {command: MoveTarget} => {
    const index = blocks.findIndex((block) => block.id === hovered.id);
    let nextIndex = blocks.length;
    for (let i = index + 1; i < blocks.length; i++) {
        if (blocks[i].depth <= hovered.depth) {
            nextIndex = i;
            break;
        }
    }
    const next = blocks[nextIndex];
    if (next) {
        return {
            command: {type: 'before', targetBlockId: next.id},
            indicatorBlockId: next.id,
            indicatorPlacement: 'before',
            indicatorDepth: next.depth,
        };
    }

    const sameParentSiblings = blocks.filter((block) => block.parentId === hovered.parentId);
    const lastSibling = sameParentSiblings[sameParentSiblings.length - 1] ?? hovered;
    return {
        command: {type: 'after', targetBlockId: lastSibling.id},
        indicatorBlockId: lastSibling.id,
        indicatorPlacement: 'after',
        indicatorDepth: lastSibling.depth,
    };
};

const targetChildIndicator = (
    blocks: BlockOutlineItem[],
    parent: BlockOutlineItem,
    at: 'start' | 'end',
): Omit<DropTarget, 'command'> => {
    const children = blocks.filter((block) => block.parentId === parent.id);
    if (!children.length) {
        return {
            indicatorBlockId: parent.id,
            indicatorPlacement: 'after',
            indicatorDepth: parent.depth + 1,
        };
    }
    if (at === 'start') {
        const firstChild = children[0];
        return {
            indicatorBlockId: firstChild.id,
            indicatorPlacement: 'before',
            indicatorDepth: firstChild.depth,
        };
    }
    const lastChild = children[children.length - 1];
    const lastInSubtree = lastSubtreeItem(blocks, lastChild);
    return {
        indicatorBlockId: lastInSubtree.id,
        indicatorPlacement: 'after',
        indicatorDepth: parent.depth + 1,
    };
};

const lastSubtreeItem = (blocks: BlockOutlineItem[], root: BlockOutlineItem): BlockOutlineItem => {
    const index = blocks.findIndex((block) => block.id === root.id);
    let last = root;
    for (let i = index + 1; i < blocks.length && blocks[i].depth > root.depth; i++) {
        last = blocks[i];
    }
    return last;
};

const normalizeDropTarget = (
    blocks: BlockOutlineItem[],
    hovered: BlockOutlineItem,
    target: DropTarget & {dragged: string | null},
): DropTarget | null => {
    const {dragged, ...dropTarget} = target;
    if (!dragged) return dropTarget;
    const draggedSubtree = subtreeIds(blocks, dragged);
    if (draggedSubtree.has(hovered.id)) return null;
    if (moveTargetTouchesSubtree(dropTarget.command, draggedSubtree)) return null;
    if (isNoop(blocks, dragged, dropTarget.command)) return null;
    return dropTarget;
};

const moveTargetTouchesSubtree = (target: MoveTarget, subtree: Set<string>): boolean => {
    if (target.type === 'child') return subtree.has(target.parentBlockId);
    return subtree.has(target.targetBlockId);
};

const isNoop = (blocks: BlockOutlineItem[], dragged: string, target: MoveTarget): boolean => {
    const current = blocks.find((block) => block.id === dragged);
    if (!current) return true;
    if (target.type === 'child') {
        const children = blocks.filter((block) => block.parentId === target.parentBlockId);
        if (current.parentId !== target.parentBlockId) return false;
        if (target.at === 'start') return children[0]?.id === dragged;
        return children[children.length - 1]?.id === dragged;
    }

    const targetBlock = blocks.find((block) => block.id === target.targetBlockId);
    if (!targetBlock || current.parentId !== targetBlock.parentId) return false;
    const siblings = blocks.filter((block) => block.parentId === current.parentId);
    const currentIndex = siblings.findIndex((block) => block.id === dragged);
    const targetIndex = siblings.findIndex((block) => block.id === target.targetBlockId);
    if (currentIndex < 0 || targetIndex < 0) return true;
    return target.type === 'before'
        ? targetIndex === currentIndex || targetIndex === currentIndex + 1
        : targetIndex === currentIndex || targetIndex === currentIndex - 1;
};

const subtreeIds = (blocks: BlockOutlineItem[], rootId: string): Set<string> => {
    const rootIndex = blocks.findIndex((block) => block.id === rootId);
    if (rootIndex < 0) return new Set();
    const rootDepth = blocks[rootIndex].depth;
    const ids = new Set<string>([rootId]);
    for (let i = rootIndex + 1; i < blocks.length && blocks[i].depth > rootDepth; i++) {
        ids.add(blocks[i].id);
    }
    return ids;
};
