import {
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type WheelEvent as ReactWheelEvent,
} from 'react';
import {
    initialViewport,
    maxZoom,
    minNoteSize,
    minimapWidth,
    minZoom,
    penColor,
    strokeWidth,
    wheelZoomInFactor,
    wheelZoomOutFactor,
    type Tool,
} from './constants';
import {
    boundsForPreview,
    elementPreviewData,
    elementPreviewMessages,
    strokePreviewPoints,
} from './geometry';
import {
    BOARD_HEIGHT,
    BOARD_WIDTH,
    clamp,
    elementFieldPath,
    screenToBoard,
    type Viewport,
} from './helpers';
import {
    clearEphemeralMessage,
    elementPreviewId,
    selectionMessage,
    strokePreviewId,
    strokePreviewMessage,
} from './model';
import type {StrokePoint, WhiteboardElement} from './model';
import type {
    ActiveStroke,
    DragState,
    LocalElementPreview,
    WhiteboardEditorContext,
} from './types';
import type {PublishWhiteboardEphemeral} from './useWhiteboardEphemeral';

export function useWhiteboardGestures({
    editor,
    actor,
    readOnly,
    tool,
    selectedId,
    setSelectedId,
    addNote,
    addEmoji,
    commitStroke,
    publishEphemeral,
}: {
    editor: WhiteboardEditorContext;
    actor: string;
    readOnly: boolean;
    tool: Tool;
    selectedId: string | null;
    setSelectedId(id: string | null): void;
    addNote(x: number, y: number): void;
    addEmoji(x: number, y: number): void;
    commitStroke(id: string, points: StrokePoint[]): void;
    publishEphemeral: PublishWhiteboardEphemeral;
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState<Viewport>(initialViewport);
    const [activeStroke, setActiveStroke] = useState<ActiveStroke | null>(null);
    const [drag, setDrag] = useState<DragState>(null);
    const [localElementPreview, setLocalElementPreview] = useState<LocalElementPreview | null>(
        null,
    );
    const [viewportSize, setViewportSize] = useState({width: 1, height: 1});
    const [draggingMinimap, setDraggingMinimap] = useState(false);

    useEffect(() => {
        if (!readOnly) return;
        editor.clearPreview();
        setActiveStroke(null);
        setDrag(null);
        setLocalElementPreview(null);
    }, [editor, readOnly]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setViewportSize({
                width: entry.contentRect.width,
                height: entry.contentRect.height,
            });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!drag) return;
        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            if (readOnly && drag.kind !== 'pan') return;
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) return;
            if (drag.kind === 'pan') {
                setViewport((current) => ({
                    ...current,
                    panX: drag.panX + event.clientX - drag.startX,
                    panY: drag.panY + event.clientY - drag.startY,
                }));
                return;
            }
            const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
            const element = editor.latest().elements[drag.id];
            if (!element) return;
            if (drag.kind === 'move') {
                const preview = elementPreviewData(element, {
                    x: point.x - drag.offsetX,
                    y: point.y - drag.offsetY,
                });
                setLocalElementPreview(preview);
                publishEphemeral(
                    elementPreviewMessages(actor, element, preview, selectedId === drag.id),
                    'frame',
                );
            } else if (drag.kind === 'resize-note' && element.type === 'note') {
                const preview = elementPreviewData(element, {
                    width: Math.max(minNoteSize.width, point.x - drag.originX),
                    height: Math.max(minNoteSize.height, point.y - drag.originY),
                });
                setLocalElementPreview(preview);
                publishEphemeral(
                    elementPreviewMessages(actor, element, preview, selectedId === drag.id),
                    'frame',
                );
            }
        };
        const onPointerUp = (event: PointerEvent) => {
            if (event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) {
                setDrag(null);
                setLocalElementPreview(null);
                if (drag.kind !== 'pan') {
                    publishEphemeral([
                        clearEphemeralMessage(actor, elementPreviewId(actor, drag.id)),
                    ]);
                }
                return;
            }
            if (drag.kind === 'pan') {
                setDrag(null);
                return;
            }
            if (readOnly) {
                setDrag(null);
                setLocalElementPreview(null);
                publishEphemeral([clearEphemeralMessage(actor, elementPreviewId(actor, drag.id))]);
                return;
            }
            const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
            const element = editor.latest().elements[drag.id];
            setDrag(null);
            setLocalElementPreview(null);
            if (!element) {
                publishEphemeral([clearEphemeralMessage(actor, elementPreviewId(actor, drag.id))]);
                return;
            }
            if (drag.kind === 'move') {
                const position = {x: point.x - drag.offsetX, y: point.y - drag.offsetY};
                const preview = elementPreviewData(element, position);
                publishEphemeral([
                    clearEphemeralMessage(actor, elementPreviewId(actor, drag.id)),
                    ...(selectedId === drag.id
                        ? [
                              selectionMessage({
                                  actor,
                                  elementIds: [drag.id],
                                  bounds: boundsForPreview(element, preview),
                              }),
                          ]
                        : []),
                ]);
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(drag.id, 'position'),
                    value: position,
                });
            } else if (drag.kind === 'resize-note' && element.type === 'note') {
                const size = {
                    width: Math.max(minNoteSize.width, point.x - drag.originX),
                    height: Math.max(minNoteSize.height, point.y - drag.originY),
                };
                const preview = elementPreviewData(element, size);
                publishEphemeral([
                    clearEphemeralMessage(actor, elementPreviewId(actor, drag.id)),
                    ...(selectedId === drag.id
                        ? [
                              selectionMessage({
                                  actor,
                                  elementIds: [drag.id],
                                  bounds: boundsForPreview(element, preview),
                              }),
                          ]
                        : []),
                ]);
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(drag.id, 'size'),
                    value: size,
                });
            } else {
                publishEphemeral([clearEphemeralMessage(actor, elementPreviewId(actor, drag.id))]);
            }
        };
        const onCancel = () => {
            setDrag(null);
            setLocalElementPreview(null);
            if (drag.kind !== 'pan') {
                publishEphemeral([clearEphemeralMessage(actor, elementPreviewId(actor, drag.id))]);
            }
        };
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onCancel);
        };
    }, [actor, drag, editor, publishEphemeral, readOnly, selectedId, viewport]);

    const onBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
        if (readOnly && tool !== 'pan') {
            setSelectedId(null);
            return;
        }
        if (tool === 'note') {
            event.preventDefault();
            addNote(point.x, point.y);
            return;
        }
        if (tool === 'emoji') {
            event.preventDefault();
            addEmoji(point.x, point.y);
            return;
        }
        if (tool === 'pen') {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const stroke = {id: `wb-${crypto.randomUUID()}`, points: [point]};
            setActiveStroke(stroke);
            publishEphemeral(
                [
                    strokePreviewMessage({
                        actor,
                        strokeId: stroke.id,
                        points: strokePreviewPoints(stroke.points),
                        color: penColor,
                        width: strokeWidth,
                    }),
                ],
                'frame',
            );
            return;
        }
        if (tool === 'pan') {
            event.preventDefault();
            setDrag({
                kind: 'pan',
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                panX: viewport.panX,
                panY: viewport.panY,
            });
            return;
        }
        event.preventDefault();
        setSelectedId(null);
    };

    const onBoardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (readOnly || !activeStroke) return;
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
        setActiveStroke((current) => {
            if (!current) return current;
            const next = {...current, points: [...current.points, point]};
            publishEphemeral(
                [
                    strokePreviewMessage({
                        actor,
                        strokeId: next.id,
                        points: strokePreviewPoints(next.points),
                        color: penColor,
                        width: strokeWidth,
                    }),
                ],
                'frame',
            );
            return next;
        });
    };

    const onBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (readOnly || !activeStroke) return;
        event.preventDefault();
        commitStroke(activeStroke.id, activeStroke.points);
        publishEphemeral([clearEphemeralMessage(actor, strokePreviewId(actor, activeStroke.id))]);
        setActiveStroke(null);
    };

    const onBoardPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!activeStroke) return;
        event.preventDefault();
        publishEphemeral([clearEphemeralMessage(actor, strokePreviewId(actor, activeStroke.id))]);
        setActiveStroke(null);
    };

    const startElementDrag = (
        element: WhiteboardElement,
        event: ReactPointerEvent<HTMLElement | SVGElement>,
    ) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        if (readOnly) {
            setSelectedId(element.id);
            return;
        }
        if (tool === 'erase') {
            editor.dispatch([
                {op: 'replace', path: elementFieldPath(element.id, 'archived'), value: true},
                {op: 'replace', path: elementFieldPath(element.id, 'archivedBy'), value: actor},
                {
                    op: 'replace',
                    path: elementFieldPath(element.id, 'archivedAt'),
                    value: new Date().toISOString(),
                },
            ]);
            setSelectedId(null);
            return;
        }
        setSelectedId(element.id);
        if (tool !== 'select') return;
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
        const preview = elementPreviewData(element);
        setLocalElementPreview(preview);
        publishEphemeral(elementPreviewMessages(actor, element, preview, true), 'frame');
        setDrag({
            kind: 'move',
            id: element.id,
            pointerId: event.pointerId,
            offsetX: point.x - element.position.x,
            offsetY: point.y - element.position.y,
        });
    };

    const startNoteResize = (
        element: Extract<WhiteboardElement, {type: 'note'}>,
        event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedId(element.id);
        const preview = elementPreviewData(element);
        setLocalElementPreview(preview);
        publishEphemeral(elementPreviewMessages(actor, element, preview, true), 'frame');
        setDrag({
            kind: 'resize-note',
            id: element.id,
            pointerId: event.pointerId,
            originX: element.position.x,
            originY: element.position.y,
        });
    };

    const zoomBy = (factor: number) => {
        setViewport((current) => ({
            ...current,
            zoom: clamp(current.zoom * factor, minZoom, maxZoom),
        }));
    };

    const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const before = screenToBoard(event.clientX, event.clientY, rect, viewport);
        const nextZoom = clamp(
            viewport.zoom * (event.deltaY > 0 ? wheelZoomOutFactor : wheelZoomInFactor),
            minZoom,
            maxZoom,
        );
        setViewport({
            zoom: nextZoom,
            panX: event.clientX - rect.left - before.x * nextZoom,
            panY: event.clientY - rect.top - before.y * nextZoom,
        });
    };

    const minimapScale = minimapWidth / BOARD_WIDTH;
    const recenterFromMinimap = (clientX: number, clientY: number, rect: DOMRect) => {
        const x = (clientX - rect.left) / minimapScale;
        const y = (clientY - rect.top) / minimapScale;
        setViewport((current) => ({
            ...current,
            panX: viewportSize.width / 2 - x * current.zoom,
            panY: viewportSize.height / 2 - y * current.zoom,
        }));
    };

    const viewRect = {
        x: clamp(-viewport.panX / viewport.zoom, 0, BOARD_WIDTH),
        y: clamp(-viewport.panY / viewport.zoom, 0, BOARD_HEIGHT),
        width: clamp(viewportSize.width / viewport.zoom, 1, BOARD_WIDTH),
        height: clamp(viewportSize.height / viewport.zoom, 1, BOARD_HEIGHT),
    };

    return {
        viewportRef,
        viewport,
        activeStroke,
        localElementPreview,
        draggingMinimap,
        setDraggingMinimap,
        viewRect,
        zoomBy,
        onWheel,
        onBoardPointerDown,
        onBoardPointerMove,
        onBoardPointerUp,
        onBoardPointerCancel,
        startElementDrag,
        startNoteResize,
        recenterFromMinimap,
    };
}
