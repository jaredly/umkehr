import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent} from 'react';
import type {MoveTarget, TableCellSlotTarget} from './blockCommands';

const DRAG_START_THRESHOLD_PX = 4;

export type BlockOutlineItem = {
    id: string;
    depth: number;
    parentId: string;
};

export type DropTarget = {
    command: BlockReorderCommand;
    indicatorBlockId: string;
    indicatorPlacement: 'before' | 'after';
    indicatorDepth: number;
};

export type BlockReorderCommand =
    | MoveTarget
    | {type: 'table-cell-slot'; target: TableCellSlotTarget};

type PendingDrag = {
    id: string;
    ids: string[];
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
    onMove(blockIds: string[], target: BlockReorderCommand): void;
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());
    const blocksRef = useRef(blocks);
    const draggingRef = useRef<string | null>(null);
    const draggingIdsRef = useRef<string[]>([]);
    const pendingDragRef = useRef<PendingDrag | null>(null);
    const [hasPointerGesture, setHasPointerGesture] = useState(false);

    blocksRef.current = blocks;

    const draggingSubtreeIds = useMemo(
        () => (draggingId ? subtreeIdsForRoots(blocks, draggingIdsRef.current) : new Set<string>()),
        [blocks, draggingId],
    );

    const registerRow = useCallback((id: string, element: HTMLElement | null) => {
        if (element) rowRefs.current.set(id, element);
        else rowRefs.current.delete(id);
    }, []);

    const findDropTarget = useCallback((clientX: number, clientY: number): DropTarget | null => {
        const dragged = draggingRef.current;
        const draggedIds = draggingIdsRef.current;
        const currentBlocks = blocksRef.current;
        const rows = currentBlocks
            .map((block) => {
                const element = rowRefs.current.get(block.id);
                return element ? {block, rect: element.getBoundingClientRect()} : null;
            })
            .filter((row) => row !== null);
        if (!rows.length) return null;

        const cellTarget = resolveCellDropTarget(currentBlocks, clientX, clientY, {
            dragged,
            draggedIds,
        });
        if (cellTarget) return cellTarget;

        const kanbanTarget = resolveKanbanDropTarget(currentBlocks, clientX, clientY, {
            dragged,
            draggedIds,
        });
        if (kanbanTarget) return kanbanTarget;

        const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
        if (containing) {
            return resolveDropTarget(currentBlocks, containing.block, {
                clientX,
                clientY,
                rect: containing.rect,
                dragged,
                draggedIds,
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
                draggedIds,
            });
        }
        const last = rows[rows.length - 1].block;
        return normalizeDropTarget(currentBlocks, last, {
            command: {type: 'after', targetBlockId: last.id},
            indicatorBlockId: last.id,
            indicatorPlacement: 'after',
            indicatorDepth: last.depth,
            dragged,
            draggedIds,
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
                draggingIdsRef.current = pending.ids;
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
            const draggedIds = draggingIdsRef.current;
            pendingDragRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
            setHasPointerGesture(false);
            draggingRef.current = null;
            draggingIdsRef.current = [];
            if (!dragged || !target) return;
            onMove(draggedIds.length ? draggedIds : [dragged], target.command);
        };
        const onPointerCancel = () => {
            pendingDragRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
            setHasPointerGesture(false);
            draggingRef.current = null;
            draggingIdsRef.current = [];
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

    const startDrag = useCallback((id: string, event: PointerEvent<HTMLElement>, ids: string[] = [id]) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pendingDragRef.current = {
            id,
            ids: ids.length ? ids : [id],
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            source: event.currentTarget,
        };
        draggingRef.current = null;
        draggingIdsRef.current = [];
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
        draggedIds,
    }: {
        clientX: number;
        clientY: number;
        rect: DOMRect;
        dragged: string | null;
        draggedIds: string[];
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
            draggedIds,
        });
    }

    if (ratio < 0.5) {
        return normalizeDropTarget(blocks, hovered, {
            command: {type: 'before', targetBlockId: hovered.id},
            indicatorBlockId: hovered.id,
            indicatorPlacement: 'before',
            indicatorDepth: hovered.depth,
            dragged,
            draggedIds,
        });
    }

    const afterSubtree = targetAfterSubtree(blocks, hovered);
    return normalizeDropTarget(blocks, hovered, {...afterSubtree, dragged, draggedIds});
};

const resolveKanbanDropTarget = (
    blocks: BlockOutlineItem[],
    clientX: number,
    clientY: number,
    {
        dragged,
        draggedIds,
    }: {
        dragged: string | null;
        draggedIds: string[];
    },
): DropTarget | null => {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const elements = document.elementsFromPoint(clientX, clientY);
    const column = elements
        .map((element) => element.closest<HTMLElement>('[data-kanban-column-id]'))
        .find((element): element is HTMLElement => !!element?.dataset.kanbanColumnId);
    const draggedRootIds = draggedIds.length ? draggedIds : dragged ? [dragged] : [];
    const draggingColumn =
        draggedRootIds.length === 1 && isRenderedKanbanColumn(draggedRootIds[0]);

    if (draggingColumn && column) {
        const columnId = column.dataset.kanbanColumnId;
        const hovered = columnId ? blocks.find((block) => block.id === columnId) : null;
        if (!columnId || !hovered) return null;
        const rect = column.getBoundingClientRect();
        const placement = rect.width > 0 && clientX > rect.left + rect.width / 2 ? 'after' : 'before';
        return normalizeDropTarget(blocks, hovered, {
            command:
                placement === 'after'
                    ? {type: 'after', targetBlockId: columnId}
                    : {type: 'before', targetBlockId: columnId},
            indicatorBlockId: columnId,
            indicatorPlacement: placement,
            indicatorDepth: hovered.depth,
            dragged,
            draggedIds,
        });
    }

    const card = elements
        .map((element) => element.closest<HTMLElement>('[data-kanban-card-id]'))
        .find((element): element is HTMLElement => !!element?.dataset.kanbanCardId);
    if (card) {
        const cardId = card.dataset.kanbanCardId;
        const hovered = cardId ? blocks.find((block) => block.id === cardId) : null;
        if (!cardId || !hovered) return null;
        return resolveDropTarget(blocks, hovered, {
            clientX,
            clientY,
            rect: card.getBoundingClientRect(),
            dragged,
            draggedIds,
        });
    }

    if (column) {
        const columnId = column.dataset.kanbanColumnId;
        const hovered = columnId ? blocks.find((block) => block.id === columnId) : null;
        if (!columnId || !hovered) return null;
        return normalizeDropTarget(blocks, hovered, {
            command: {type: 'child', parentBlockId: columnId, at: 'end'},
            ...targetChildIndicator(blocks, hovered, 'end'),
            dragged,
            draggedIds,
        });
    }

    const columnsContainer = elements
        .map((element) => element.closest<HTMLElement>('.kanbanColumns[data-kanban-board-id]'))
        .find((element): element is HTMLElement => !!element?.dataset.kanbanBoardId);
    if (!columnsContainer || !draggingColumn) return null;
    const boardId = columnsContainer.dataset.kanbanBoardId;
    const columns = Array.from(
        columnsContainer.querySelectorAll<HTMLElement>(':scope > [data-kanban-column-id]'),
    );
    const lastColumnId = columns[columns.length - 1]?.dataset.kanbanColumnId;
    const lastColumn = lastColumnId ? blocks.find((block) => block.id === lastColumnId) : null;
    const board = boardId ? blocks.find((block) => block.id === boardId) : null;
    if (lastColumnId && lastColumn) {
        return normalizeDropTarget(blocks, lastColumn, {
            command: {type: 'after', targetBlockId: lastColumnId},
            indicatorBlockId: lastColumnId,
            indicatorPlacement: 'after',
            indicatorDepth: lastColumn.depth,
            dragged,
            draggedIds,
        });
    }
    if (boardId && board) {
        return normalizeDropTarget(blocks, board, {
            command: {type: 'child', parentBlockId: boardId, at: 'end'},
            ...targetChildIndicator(blocks, board, 'end'),
            dragged,
            draggedIds,
        });
    }
    return null;
};

const isRenderedKanbanColumn = (blockId: string): boolean =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-kanban-column-id]')).some(
        (element) => element.dataset.kanbanColumnId === blockId,
    );

const resolveCellDropTarget = (
    blocks: BlockOutlineItem[],
    clientX: number,
    clientY: number,
    {
        dragged,
        draggedIds,
    }: {
        dragged: string | null;
        draggedIds: string[];
    },
): DropTarget | null => {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const cell = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>('.tableCell'))
        .find((element): element is HTMLElement => !!element);
    if (!cell) return null;
    const row = cell.closest<HTMLElement>('[data-row-id]');
    const rowId = row?.dataset.rowId;
    const cells = row
        ? Array.from(row.children).filter(
              (child): child is HTMLElement =>
                  child instanceof HTMLElement && child.matches('.tableCell'),
          )
        : [];
    const cellIndex = cells.indexOf(cell);
    if (!rowId || cellIndex < 0) return null;
    const cellId = cell.dataset.cellId;
    const hovered = blocks.find((block) => block.id === cellId);
    const rect = cell.getBoundingClientRect();
    const placement = rect.width > 0 && clientX > rect.left + rect.width / 2 ? 'after' : 'before';
    if (!cellId || !hovered) {
        const targetIndex = placement === 'after' ? cellIndex + 1 : cellIndex;
        return {
            command: {type: 'table-cell-slot', target: {rowId, index: targetIndex}},
            indicatorBlockId: `${rowId}:${targetIndex}`,
            indicatorPlacement: placement,
            indicatorDepth: blocks.find((block) => block.id === rowId)?.depth ?? 0,
        };
    }
    return normalizeDropTarget(blocks, hovered, {
        command:
            placement === 'after'
                ? {type: 'after', targetBlockId: cellId}
                : {type: 'before', targetBlockId: cellId},
        indicatorBlockId: cellId,
        indicatorPlacement: placement,
        indicatorDepth: hovered.depth,
        dragged,
        draggedIds,
    });
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
    target: DropTarget & {dragged: string | null; draggedIds: string[]},
): DropTarget | null => {
    const {dragged, draggedIds, ...dropTarget} = target;
    if (!dragged) return dropTarget;
    const draggedSubtree = subtreeIdsForRoots(blocks, draggedIds.length ? draggedIds : [dragged]);
    if (draggedSubtree.has(hovered.id)) return null;
    if (moveTargetTouchesSubtree(dropTarget.command, draggedSubtree)) return null;
    if ((draggedIds.length <= 1) && isNoop(blocks, dragged, dropTarget.command)) return null;
    return dropTarget;
};

const moveTargetTouchesSubtree = (target: BlockReorderCommand, subtree: Set<string>): boolean => {
    if (target.type === 'table-cell-slot') return subtree.has(target.target.rowId);
    if (target.type === 'child') return subtree.has(target.parentBlockId);
    return subtree.has(target.targetBlockId);
};

const isNoop = (blocks: BlockOutlineItem[], dragged: string, target: BlockReorderCommand): boolean => {
    if (target.type === 'table-cell-slot') return false;
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

const subtreeIdsForRoots = (blocks: BlockOutlineItem[], rootIds: string[]): Set<string> => {
    const ids = new Set<string>();
    for (const rootId of rootIds) {
        for (const id of subtreeIds(blocks, rootId)) ids.add(id);
    }
    return ids;
};
