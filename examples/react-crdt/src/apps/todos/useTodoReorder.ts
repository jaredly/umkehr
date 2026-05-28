import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent} from 'react';
import {createExternalStore, type ExternalStore} from '../../lib/store';
import type {Todo} from './model';

export type TodoDropTarget = {id: string; after: boolean};

export function useTodoReorder({
    todos,
    disabled,
    onMove,
}: {
    todos: readonly Todo[];
    disabled: boolean;
    onMove(move: {fromIdx: number; targetIdx: number; after: boolean}): void;
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const dropTargetStore = useMemo(() => createExternalStore<TodoDropTarget | null>(null), []);
    const rowRefs = useRef(new Map<string, HTMLLIElement>());
    const latestTodos = useRef(todos);
    const draggingIdRef = useRef<string | null>(null);
    const dropTargetRef = useRef<TodoDropTarget | null>(null);

    latestTodos.current = todos;

    useEffect(() => {
        draggingIdRef.current = draggingId;
    }, [draggingId]);

    const registerRow = useCallback((id: string, element: HTMLLIElement | null) => {
        if (element) {
            rowRefs.current.set(id, element);
        } else {
            rowRefs.current.delete(id);
        }
    }, []);

    const getRowElement = useCallback((id: string) => rowRefs.current.get(id) ?? null, []);

    const clearDrag = useCallback(() => {
        draggingIdRef.current = null;
        dropTargetRef.current = null;
        setDraggingId(null);
        dropTargetStore.setSnapshot(null);
    }, [dropTargetStore]);

    const findDropTarget = useCallback((clientY: number): TodoDropTarget | null => {
        const rows = latestTodos.current
            .map((todo) => {
                const element = rowRefs.current.get(todo.id);
                return element ? {id: todo.id, rect: element.getBoundingClientRect()} : null;
            })
            .filter((row) => row !== null);

        if (!rows.length) return null;

        const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
        if (containing) {
            return {
                id: containing.id,
                after: clientY > containing.rect.top + containing.rect.height / 2,
            };
        }

        const nextRow = rows.find(({rect}) => clientY < rect.top);
        if (nextRow) return {id: nextRow.id, after: false};
        return {id: rows[rows.length - 1].id, after: true};
    }, []);

    useEffect(() => {
        if (!draggingId) return;

        const onPointerMove = (event: globalThis.PointerEvent) => {
            if (disabled) return;
            event.preventDefault();
            const nextTarget = findDropTarget(event.clientY);
            dropTargetRef.current = nextTarget;
            setDropTarget(dropTargetStore, nextTarget);
        };

        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const draggedId = draggingIdRef.current;
            const target = findDropTarget(event.clientY) ?? dropTargetRef.current;
            clearDrag();
            if (disabled) return;
            if (!draggedId || !target) return;

            const currentTodos = latestTodos.current;
            const fromIdx = currentTodos.findIndex((todo) => todo.id === draggedId);
            const targetIdx = currentTodos.findIndex((todo) => todo.id === target.id);
            if (fromIdx < 0 || targetIdx < 0 || isNoopMove(fromIdx, targetIdx, target.after)) {
                return;
            }
            onMove({fromIdx, targetIdx, after: target.after});
        };

        const onPointerCancel = () => clearDrag();

        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [clearDrag, disabled, draggingId, dropTargetStore, findDropTarget, onMove]);

    const startDrag = useCallback(
        (id: string, event: PointerEvent<HTMLElement>) => {
            if (disabled) return;
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const initialTarget = {id, after: false};
            draggingIdRef.current = id;
            dropTargetRef.current = initialTarget;
            setDraggingId(id);
            setDropTarget(dropTargetStore, initialTarget);
        },
        [disabled, dropTargetStore],
    );

    return {
        draggingId,
        dropTargetStore,
        getRowElement,
        registerRow,
        startDrag,
    };
}

function isNoopMove(fromIdx: number, targetIdx: number, after: boolean) {
    return (
        fromIdx === targetIdx ||
        (!after && targetIdx === fromIdx + 1) ||
        (after && targetIdx === fromIdx - 1)
    );
}

function setDropTarget(store: ExternalStore<TodoDropTarget | null>, next: TodoDropTarget | null) {
    const current = store.getSnapshot();
    if (current?.id === next?.id && current?.after === next?.after) return;
    store.setSnapshot(next);
}
