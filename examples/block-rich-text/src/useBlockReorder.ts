import {useCallback, useEffect, useRef, useState, type PointerEvent} from 'react';

export type DropTarget = {targetBlockId: string; after: boolean};

export function useBlockReorder({
    blockIds,
    onMove,
}: {
    blockIds: string[];
    onMove(blockId: string, target: DropTarget): void;
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());
    const blockIdsRef = useRef(blockIds);
    const draggingRef = useRef<string | null>(null);

    blockIdsRef.current = blockIds;

    const registerRow = useCallback((id: string, element: HTMLElement | null) => {
        if (element) rowRefs.current.set(id, element);
        else rowRefs.current.delete(id);
    }, []);

    const findDropTarget = useCallback((clientY: number): DropTarget | null => {
        const rows = blockIdsRef.current
            .map((id) => {
                const element = rowRefs.current.get(id);
                return element ? {id, rect: element.getBoundingClientRect()} : null;
            })
            .filter((row) => row !== null);
        if (!rows.length) return null;

        const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
        if (containing) {
            return {
                targetBlockId: containing.id,
                after: clientY > containing.rect.top + containing.rect.height / 2,
            };
        }
        const before = rows.find(({rect}) => clientY < rect.top);
        return before ? {targetBlockId: before.id, after: false} : {targetBlockId: rows[rows.length - 1].id, after: true};
    }, []);

    useEffect(() => {
        if (!draggingId) return;

        const onPointerMove = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            setDropTarget(findDropTarget(event.clientY));
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target = findDropTarget(event.clientY) ?? dropTarget;
            const dragged = draggingRef.current;
            setDraggingId(null);
            setDropTarget(null);
            draggingRef.current = null;
            if (!dragged || !target || isNoop(blockIdsRef.current, dragged, target)) return;
            onMove(dragged, target);
        };
        const onPointerCancel = () => {
            setDraggingId(null);
            setDropTarget(null);
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
    }, [draggingId, dropTarget, findDropTarget, onMove]);

    const startDrag = useCallback((id: string, event: PointerEvent<HTMLElement>) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = id;
        setDraggingId(id);
        setDropTarget({targetBlockId: id, after: false});
    }, []);

    return {draggingId, dropTarget, registerRow, startDrag};
}

const isNoop = (ids: string[], dragged: string, target: DropTarget): boolean => {
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(target.targetBlockId);
    return from < 0 || to < 0 || from === to || (!target.after && to === from + 1) || (target.after && to === from - 1);
};
