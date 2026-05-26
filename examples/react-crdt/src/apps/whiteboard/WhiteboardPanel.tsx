import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import type {EphemeralMessage, EphemeralQuery, EphemeralRecord} from 'umkehr';
import {useValue} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {
    AppEditorContext,
    CrdtEditorContext,
    GridSlot,
    HistoryEditorContext,
} from '../../lib/crdtApp';
import {initialForNickname, whiteboardSelectionStatusKind} from '../../lib/server/presence';
import {
    BOARD_HEIGHT,
    BOARD_WIDTH,
    byZOrderThenId,
    clamp,
    elementFieldPath,
    elementPath,
    nextBottomZOrder,
    nextTopZOrder,
    orderedElements,
    screenToBoard,
    simplifyStroke,
    strokePath,
    zOrderBetween,
    type Viewport,
} from './helpers';
import {
    clearEphemeralMessage,
    elementPreviewId,
    elementPreviewMessage,
    selectionId,
    selectionMessage,
    strokePreviewId,
    strokePreviewMessage,
    whiteboardEphemeralKinds,
    type WhiteboardElementPreviewData,
    type WhiteboardEphemeralData,
    type WhiteboardSelectionData,
    type WhiteboardStrokePreviewData,
} from './model';
import type {
    EmojiStampElement,
    StickyNoteElement,
    StrokeElement,
    StrokePoint,
    WhiteboardElement,
    WhiteboardState,
} from './model';

const noteColors = ['#fff7b8', '#fed7aa', '#bbf7d0', '#bfdbfe', '#fbcfe8'] as const;
const emojiChoices = ['👍', '⭐', '💡', '✅', '❗', '❤️'] as const;

type Tool = 'select' | 'note' | 'pen' | 'emoji' | 'erase' | 'pan';
type ActiveStroke = {
    id: string;
    points: StrokePoint[];
};
type LocalElementPreview = WhiteboardElementPreviewData;
type DragState =
    | null
    | {
          kind: 'move';
          id: string;
          pointerId: number;
          offsetX: number;
          offsetY: number;
      }
    | {
          kind: 'resize-note';
          id: string;
          pointerId: number;
          originX: number;
          originY: number;
      }
    | {
          kind: 'pan';
          pointerId: number;
          startX: number;
          startY: number;
          panX: number;
          panY: number;
      };

export function WhiteboardPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
    setPresenceSelection,
}: {
    editor: AppEditorContext<WhiteboardState>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
    setPresenceSelection?: (elementId: string | null) => void;
}) {
    const background = useValue(editor.$.background);
    const visibleElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived)
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const visibleStrokeIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived && element.type === 'stroke')
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const visibleSurfaceElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived && element.type !== 'stroke')
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const archivedElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => element.archived)
            .sort(
                (a, b) =>
                    (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') ||
                    a.id.localeCompare(b.id),
            )
            .map((element) => element.id),
    );
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [tool, setTool] = useState<Tool>('select');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<(typeof emojiChoices)[number]>('👍');
    const [noteColor, setNoteColor] = useState<(typeof noteColors)[number]>('#fff7b8');
    const [viewport, setViewport] = useState<Viewport>({panX: 80, panY: 70, zoom: 0.75});
    const [activeStroke, setActiveStroke] = useState<ActiveStroke | null>(null);
    const [drag, setDrag] = useState<DragState>(null);
    const [localElementPreview, setLocalElementPreview] = useState<LocalElementPreview | null>(
        null,
    );
    const [showArchive, setShowArchive] = useState(false);
    const [viewportSize, setViewportSize] = useState({width: 1, height: 1});
    const [draggingMinimap, setDraggingMinimap] = useState(false);
    const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
    const pendingEphemeralRef = useRef<EphemeralMessage<WhiteboardEphemeralData>[] | null>(null);
    const publishFrameRef = useRef<number | null>(null);
    const remoteEphemeralRecords = useWhiteboardEphemeral(editor);

    const publishEphemeral = useCallback(
        (messages: EphemeralMessage<WhiteboardEphemeralData>[], mode: 'now' | 'frame' = 'now') => {
            if (!hasWhiteboardEphemeral(editor)) return;
            if (mode === 'now') {
                if (publishFrameRef.current !== null) {
                    cancelAnimationFrame(publishFrameRef.current);
                    publishFrameRef.current = null;
                    pendingEphemeralRef.current = null;
                }
                editor.publishEphemeral(messages);
                return;
            }
            pendingEphemeralRef.current = messages;
            if (publishFrameRef.current !== null) return;
            publishFrameRef.current = requestAnimationFrame(() => {
                publishFrameRef.current = null;
                const pending = pendingEphemeralRef.current;
                pendingEphemeralRef.current = null;
                if (pending) editor.publishEphemeral(pending);
            });
        },
        [editor],
    );

    useEffect(() => {
        if (!readOnly) return;
        editor.clearPreview();
        setActiveStroke(null);
        setDrag(null);
        setLocalElementPreview(null);
        publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
        if (tool !== 'pan') setTool('select');
    }, [actor, editor, publishEphemeral, readOnly, tool]);

    useEffect(() => {
        return () => {
            if (publishFrameRef.current !== null) cancelAnimationFrame(publishFrameRef.current);
        };
    }, []);

    useEffect(() => {
        setPresenceSelection?.(readOnly ? null : selectedId);
    }, [readOnly, selectedId, setPresenceSelection]);

    useEffect(() => {
        if (readOnly || !selectedId) {
            publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
            return;
        }
        const element = editor.latest().elements[selectedId];
        publishEphemeral([
            selectionMessage({
                actor,
                elementIds: [selectedId],
                bounds: element ? boundsForElement(element) : undefined,
            }),
        ]);
        return () => {
            publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
        };
    }, [actor, editor, publishEphemeral, readOnly, selectedId]);

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
                    width: Math.max(120, point.x - drag.originX),
                    height: Math.max(96, point.y - drag.originY),
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
                    width: Math.max(120, point.x - drag.originX),
                    height: Math.max(96, point.y - drag.originY),
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

    const makeBase = useCallback(
        (
            type: WhiteboardElement['type'],
            x: number,
            y: number,
            id = `wb-${crypto.randomUUID()}`,
        ) => {
            return {
                type,
                id,
                position: {x, y},
                rotation: 0,
                zOrder: nextTopZOrder(orderedElements(editor.latest())),
                createdBy: actor,
                createdAt: new Date().toISOString(),
                archived: false,
            };
        },
        [actor, editor],
    );

    const addElement = useCallback(
        (element: WhiteboardElement) => {
            if (readOnly) return;
            editor.dispatch({op: 'add', path: elementPath(element.id), value: element});
            setSelectedId(element.id);
            setTool('select');
        },
        [editor, readOnly],
    );

    const addNote = useCallback(
        (x: number, y: number) => {
            const note: StickyNoteElement = {
                ...makeBase('note', x, y),
                type: 'note',
                size: {width: 220, height: 150},
                color: noteColor,
                text: '',
            };
            addElement(note);
            setFocusNoteId(note.id);
        },
        [addElement, makeBase, noteColor],
    );

    const addEmoji = useCallback(
        (x: number, y: number) => {
            addElement({
                ...makeBase('emoji', x, y),
                type: 'emoji',
                emoji: selectedEmoji,
                size: 48,
            });
        },
        [addElement, makeBase, selectedEmoji],
    );

    const commitStroke = useCallback(
        (id: string, points: StrokePoint[]) => {
            const simplified = simplifyStroke(points);
            if (simplified.length < 2) return;
            const first = simplified[0];
            const localPoints = simplified.map((point) => ({
                ...point,
                x: point.x - first.x,
                y: point.y - first.y,
            }));
            addElement({
                ...makeBase('stroke', first.x, first.y, id),
                type: 'stroke',
                color: '#17202a',
                strokeWidth: 4,
                points: localPoints,
            });
        },
        [addElement, makeBase],
    );

    const archiveSelected = useCallback(() => {
        if (readOnly || !selectedId) return;
        editor.dispatch([
            {op: 'replace', path: elementFieldPath(selectedId, 'archived'), value: true},
            {op: 'replace', path: elementFieldPath(selectedId, 'archivedBy'), value: actor},
            {
                op: 'replace',
                path: elementFieldPath(selectedId, 'archivedAt'),
                value: new Date().toISOString(),
            },
        ]);
        setSelectedId(null);
    }, [actor, editor, readOnly, selectedId]);

    const recover = useCallback(
        (id: string) => {
            if (readOnly) return;
            editor.dispatch([
                {op: 'replace', path: elementFieldPath(id, 'archived'), value: false},
                {op: 'remove', path: elementFieldPath(id, 'archivedBy')},
                {op: 'remove', path: elementFieldPath(id, 'archivedAt')},
            ]);
            setSelectedId(id);
            setShowArchive(false);
        },
        [editor, readOnly],
    );

    const setLayer = useCallback(
        (placement: 'front' | 'back' | 'forward' | 'backward') => {
            if (readOnly || !selectedId) return;
            const current = orderedElements(editor.latest());
            const selected = current.find((element) => element.id === selectedId);
            if (!selected) return;
            const without = current.filter((element) => element.id !== selectedId);
            let next: string | null = null;
            if (placement === 'front') next = nextTopZOrder(without);
            if (placement === 'back') next = nextBottomZOrder(without);
            const index = current.findIndex((element) => element.id === selectedId);
            if (placement === 'forward' && index < current.length - 1) {
                next = zOrderBetween(current[index + 1], current[index + 2]);
            }
            if (placement === 'backward' && index > 0) {
                next = zOrderBetween(current[index - 2], current[index - 1]);
            }
            if (next && next !== selected.zOrder) {
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(selectedId, 'zOrder'),
                    value: next,
                });
            }
        },
        [editor, readOnly, selectedId],
    );

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
                        color: '#17202a',
                        width: 4,
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
                        color: '#17202a',
                        width: 4,
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

    const zoomBy = (factor: number) => {
        setViewport((current) => ({
            ...current,
            zoom: clamp(current.zoom * factor, 0.2, 2.5),
        }));
    };

    const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const before = screenToBoard(event.clientX, event.clientY, rect, viewport);
        const nextZoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 2.5);
        setViewport({
            zoom: nextZoom,
            panX: event.clientX - rect.left - before.x * nextZoom,
            panY: event.clientY - rect.top - before.y * nextZoom,
        });
    };

    const recenterFromMinimap = (clientX: number, clientY: number, rect: DOMRect) => {
        const x = (clientX - rect.left) / minimapScale;
        const y = (clientY - rect.top) / minimapScale;
        setViewport((current) => ({
            ...current,
            panX: viewportSize.width / 2 - x * current.zoom,
            panY: viewportSize.height / 2 - y * current.zoom,
        }));
    };

    const minimapScale = 120 / BOARD_WIDTH;
    const viewRect = {
        x: clamp(-viewport.panX / viewport.zoom, 0, BOARD_WIDTH),
        y: clamp(-viewport.panY / viewport.zoom, 0, BOARD_HEIGHT),
        width: clamp(viewportSize.width / viewport.zoom, 1, BOARD_WIDTH),
        height: clamp(viewportSize.height / viewport.zoom, 1, BOARD_HEIGHT),
    };

    return (
        <section
            className={`whiteboardPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="whiteboardHeader">
                <div>
                    <h1>{title}</h1>
                    <p>{visibleElementIds.length} visible</p>
                </div>
                <div className="whiteboardActions">
                    <UndoRedoButtons editor={editor} readOnly={readOnly} />
                </div>
            </header>

            <div className="whiteboardToolbar" aria-label="Whiteboard tools">
                {(['select', 'note', 'pen', 'emoji', 'erase', 'pan'] as const).map((item) => (
                    <button
                        key={item}
                        type="button"
                        className={tool === item ? 'active' : ''}
                        onClick={() => setTool(item)}
                        disabled={readOnly && item !== 'select' && item !== 'pan'}
                    >
                        {labelForTool(item)}
                    </button>
                ))}
                <div className="whiteboardSwatches" aria-label="Note color">
                    {noteColors.map((color) => (
                        <button
                            key={color}
                            type="button"
                            className={
                                noteColor === color ? 'whiteboardSwatch active' : 'whiteboardSwatch'
                            }
                            style={{backgroundColor: color}}
                            onClick={() => setNoteColor(color)}
                            aria-label={`Note color ${color}`}
                            disabled={readOnly}
                        />
                    ))}
                </div>
                <select
                    value={selectedEmoji}
                    onChange={(event) =>
                        setSelectedEmoji(event.target.value as typeof selectedEmoji)
                    }
                    aria-label="Emoji stamp"
                    disabled={readOnly}
                >
                    {emojiChoices.map((emoji) => (
                        <option key={emoji} value={emoji}>
                            {emoji}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => setLayer('back')}
                    disabled={readOnly || !selectedId}
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={() => setLayer('backward')}
                    disabled={readOnly || !selectedId}
                >
                    Down
                </button>
                <button
                    type="button"
                    onClick={() => setLayer('forward')}
                    disabled={readOnly || !selectedId}
                >
                    Up
                </button>
                <button
                    type="button"
                    onClick={() => setLayer('front')}
                    disabled={readOnly || !selectedId}
                >
                    Front
                </button>
                <button type="button" onClick={archiveSelected} disabled={readOnly || !selectedId}>
                    Archive
                </button>
                <button type="button" onClick={() => setShowArchive((value) => !value)}>
                    Recover ({archivedElementIds.length})
                </button>
                <button type="button" onClick={() => zoomBy(0.9)}>
                    -
                </button>
                <button type="button" onClick={() => zoomBy(1.1)}>
                    +
                </button>
            </div>

            {showArchive ? (
                <div className="whiteboardArchive">
                    {archivedElementIds.length ? (
                        archivedElementIds.map((id) => (
                            <ArchivedElementButton
                                key={id}
                                id={id}
                                editor={editor}
                                recover={recover}
                                readOnly={readOnly}
                            />
                        ))
                    ) : (
                        <span>No archived elements</span>
                    )}
                </div>
            ) : null}

            <div
                ref={viewportRef}
                className={`whiteboardViewport tool-${tool}`}
                onPointerDown={onBoardPointerDown}
                onPointerMove={onBoardPointerMove}
                onPointerUp={onBoardPointerUp}
                onPointerCancel={onBoardPointerCancel}
                onWheel={onWheel}
            >
                <div
                    className="whiteboardCanvas"
                    style={{
                        width: BOARD_WIDTH,
                        height: BOARD_HEIGHT,
                        transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                    }}
                >
                    <svg
                        className="whiteboardSvg"
                        width={BOARD_WIDTH}
                        height={BOARD_HEIGHT}
                        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
                    >
                        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill={background} />
                        {visibleStrokeIds.map((id) => (
                            <StrokeSlot
                                key={id}
                                id={id}
                                selected={selectedId === id}
                                suppressed={localElementPreview?.elementId === id}
                                onPointerDown={startElementDrag}
                                editor={editor}
                            />
                        ))}
                        {activeStroke ? (
                            <path
                                className="whiteboardActiveStroke"
                                d={strokePath(activeStroke.points)}
                                fill="none"
                                stroke="#17202a"
                                strokeWidth={4}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}
                    </svg>

                    {visibleSurfaceElementIds.map((id) => (
                        <ElementSlot
                            key={id}
                            id={id}
                            selected={selectedId === id}
                            editor={editor}
                            readOnly={readOnly}
                            autoFocus={focusNoteId === id}
                            suppressed={localElementPreview?.elementId === id}
                            onAutoFocused={() => setFocusNoteId(null)}
                            onPointerDown={startElementDrag}
                            onResizePointerDown={(element, event) => {
                                if (readOnly) return;
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedId(element.id);
                                const preview = elementPreviewData(element);
                                setLocalElementPreview(preview);
                                publishEphemeral(
                                    elementPreviewMessages(actor, element, preview, true),
                                    'frame',
                                );
                                setDrag({
                                    kind: 'resize-note',
                                    id: element.id,
                                    pointerId: event.pointerId,
                                    originX: element.position.x,
                                    originY: element.position.y,
                                });
                            }}
                        />
                    ))}
                    {localElementPreview ? (
                        <ElementPreviewOverlay
                            key={`local-${localElementPreview.elementId}`}
                            preview={localElementPreview}
                            editor={editor}
                            local
                        />
                    ) : null}
                    <RemoteEphemeralOverlays
                        actor={actor}
                        editor={editor}
                        records={remoteEphemeralRecords}
                    />
                </div>

                <button
                    type="button"
                    className="whiteboardMinimap"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDraggingMinimap(true);
                        recenterFromMinimap(event.clientX, event.clientY, rect);
                    }}
                    onPointerMove={(event) => {
                        if (!draggingMinimap) return;
                        event.preventDefault();
                        recenterFromMinimap(
                            event.clientX,
                            event.clientY,
                            event.currentTarget.getBoundingClientRect(),
                        );
                    }}
                    onPointerUp={(event) => {
                        event.preventDefault();
                        setDraggingMinimap(false);
                    }}
                    onPointerCancel={(event) => {
                        event.preventDefault();
                        setDraggingMinimap(false);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                    }}
                    aria-label="Recenter board"
                >
                    <svg width={120} height={80} viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}>
                        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#f8fafc" />
                        {visibleElementIds.map((id) => (
                            <MinimapElement key={id} id={id} editor={editor} />
                        ))}
                        <rect
                            x={viewRect.x}
                            y={viewRect.y}
                            width={viewRect.width}
                            height={viewRect.height}
                            fill="none"
                            stroke="#2563eb"
                            strokeWidth={20}
                        />
                    </svg>
                </button>
            </div>
        </section>
    );
}

function UndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<WhiteboardState>;
    readOnly: boolean;
}) {
    if (hasCrdtHistory(editor)) {
        return <CrdtUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    if (hasHistory(editor)) {
        return <HistoryUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    return null;
}

function CrdtUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: CrdtEditorContext<WhiteboardState>;
    readOnly: boolean;
}) {
    editor.useLocalHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function HistoryUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: HistoryEditorContext<WhiteboardState>;
    readOnly: boolean;
}) {
    editor.useHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function UndoRedoButtonPair({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<WhiteboardState>;
    readOnly: boolean;
}) {
    return (
        <>
            <button
                type="button"
                onClick={() => editor.undo()}
                disabled={readOnly || !editor.canUndo()}
            >
                Undo
            </button>
            <button
                type="button"
                onClick={() => editor.redo()}
                disabled={readOnly || !editor.canRedo()}
            >
                Redo
            </button>
        </>
    );
}

function hasCrdtHistory(
    editor: AppEditorContext<WhiteboardState>,
): editor is CrdtEditorContext<WhiteboardState> {
    return 'useLocalHistory' in editor && typeof editor.useLocalHistory === 'function';
}

function hasHistory(
    editor: AppEditorContext<WhiteboardState>,
): editor is HistoryEditorContext<WhiteboardState> {
    return 'useHistory' in editor && typeof editor.useHistory === 'function';
}

function ElementSlot({
    id,
    selected,
    editor,
    readOnly,
    autoFocus,
    suppressed,
    onAutoFocused,
    onPointerDown,
    onResizePointerDown,
}: {
    id: string;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    readOnly: boolean;
    autoFocus: boolean;
    suppressed: boolean;
    onAutoFocused(): void;
    onPointerDown(
        element: WhiteboardElement,
        event: ReactPointerEvent<HTMLElement | SVGElement>,
    ): void;
    onResizePointerDown(
        element: StickyNoteElement,
        event: ReactPointerEvent<HTMLButtonElement>,
    ): void;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived || element.type === 'stroke') return null;
    if (element.type === 'note') {
        return (
            <NoteView
                element={element}
                selected={selected}
                editor={editor}
                readOnly={readOnly}
                autoFocus={autoFocus}
                suppressed={suppressed}
                onAutoFocused={onAutoFocused}
                onPointerDown={(event) => onPointerDown(element, event)}
                onResizePointerDown={(event) => onResizePointerDown(element, event)}
            />
        );
    }
    return (
        <EmojiView
            element={element}
            selected={selected}
            editor={editor}
            suppressed={suppressed}
            onPointerDown={(event) => onPointerDown(element, event)}
        />
    );
}

function StrokeSlot({
    id,
    selected,
    suppressed,
    editor,
    onPointerDown,
}: {
    id: string;
    selected: boolean;
    suppressed: boolean;
    editor: AppEditorContext<WhiteboardState>;
    onPointerDown(
        element: WhiteboardElement,
        event: ReactPointerEvent<HTMLElement | SVGElement>,
    ): void;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived || element.type !== 'stroke') return null;
    return (
        <StrokeView
            element={element}
            selected={selected}
            suppressed={suppressed}
            onPointerDown={(event) => onPointerDown(element, event)}
            editor={editor}
        />
    );
}

function MinimapElement({id, editor}: {id: string; editor: AppEditorContext<WhiteboardState>}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived) return null;
    return (
        <rect
            x={element.position.x}
            y={element.position.y}
            width={
                element.type === 'note'
                    ? element.size.width
                    : element.type === 'emoji'
                      ? element.size
                      : 40
            }
            height={
                element.type === 'note'
                    ? element.size.height
                    : element.type === 'emoji'
                      ? element.size
                      : 24
            }
            fill={element.type === 'note' ? element.color : '#94a3b8'}
        />
    );
}

function ArchivedElementButton({
    id,
    editor,
    recover,
    readOnly,
}: {
    id: string;
    editor: AppEditorContext<WhiteboardState>;
    recover(id: string): void;
    readOnly: boolean;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || !element.archived) return null;
    return (
        <button type="button" onClick={() => recover(element.id)} disabled={readOnly}>
            Recover {nameForElement(element)}
        </button>
    );
}

function NoteView({
    element,
    selected,
    editor,
    readOnly,
    autoFocus,
    suppressed,
    onAutoFocused,
    onPointerDown,
    onResizePointerDown,
}: {
    element: StickyNoteElement;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    readOnly: boolean;
    autoFocus: boolean;
    suppressed: boolean;
    onAutoFocused(): void;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
}) {
    const [draft, setDraft] = useState(element.text);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const statuses = useSelectionStatuses(editor, element.id);
    useEffect(() => setDraft(element.text), [element.text]);
    useEffect(() => {
        if (!autoFocus || readOnly) return;
        textareaRef.current?.focus();
        onAutoFocused();
    }, [autoFocus, onAutoFocused, readOnly]);

    const commit = () => {
        if (!readOnly && draft !== element.text) {
            editor.dispatch({
                op: 'replace',
                path: elementFieldPath(element.id, 'text'),
                value: draft,
            });
        }
    };

    return (
        <article
            className={elementClassName('whiteboardNote', selected, suppressed)}
            style={elementStyle(element, {
                width: element.size.width,
                height: element.size.height,
                backgroundColor: element.color,
            })}
        >
            <div className="whiteboardNoteHandle" onPointerDown={onPointerDown} />
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                        setDraft(element.text);
                        event.currentTarget.blur();
                    }
                }}
                placeholder="Note"
                readOnly={readOnly}
            />
            <RemoteSelections statuses={statuses} />
            <button
                type="button"
                className="whiteboardResize"
                onPointerDown={onResizePointerDown}
                aria-label="Resize note"
                disabled={readOnly}
            />
        </article>
    );
}

function EmojiView({
    element,
    selected,
    editor,
    suppressed,
    onPointerDown,
}: {
    element: EmojiStampElement;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    suppressed: boolean;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <div
            className={elementClassName('whiteboardEmoji', selected, suppressed)}
            style={elementStyle(element, {
                width: element.size,
                height: element.size,
                fontSize: element.size,
            })}
            onPointerDown={onPointerDown}
        >
            {element.emoji}
            <RemoteSelections statuses={statuses} />
        </div>
    );
}

function StrokeView({
    element,
    selected,
    suppressed,
    editor,
    onPointerDown,
}: {
    element: StrokeElement;
    selected: boolean;
    suppressed: boolean;
    editor: AppEditorContext<WhiteboardState>;
    onPointerDown(event: ReactPointerEvent<SVGPathElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <g transform={`translate(${element.position.x} ${element.position.y})`}>
            <path
                className={elementClassName('whiteboardStroke', selected, suppressed)}
                d={strokePath(element.points)}
                fill="none"
                stroke={element.color}
                strokeWidth={element.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                onPointerDown={onPointerDown}
            />
            {statuses.length ? (
                <foreignObject x={0} y={-30} width={120} height={28}>
                    <RemoteSelections statuses={statuses} />
                </foreignObject>
            ) : null}
        </g>
    );
}

function useSelectionStatuses(editor: AppEditorContext<WhiteboardState>, id: string) {
    return useStatuses(editor.$.elements[id], {kinds: [whiteboardSelectionStatusKind]})
        .map((status) => status.data)
        .filter(isSelectionStatusData);
}

type WhiteboardEphemeralEditor = AppEditorContext<WhiteboardState> & {
    publishEphemeral(messages: EphemeralMessage<WhiteboardEphemeralData>[]): void;
    useEphemeral(query?: EphemeralQuery): EphemeralRecord<WhiteboardEphemeralData>[];
};

function hasWhiteboardEphemeral(
    editor: AppEditorContext<WhiteboardState>,
): editor is WhiteboardEphemeralEditor {
    return (
        'publishEphemeral' in editor &&
        typeof editor.publishEphemeral === 'function' &&
        'useEphemeral' in editor &&
        typeof editor.useEphemeral === 'function'
    );
}

function useWhiteboardEphemeral(editor: AppEditorContext<WhiteboardState>) {
    if (!hasWhiteboardEphemeral(editor)) return [];
    return editor.useEphemeral({kinds: whiteboardEphemeralKinds});
}

function RemoteEphemeralOverlays({
    actor,
    editor,
    records,
}: {
    actor: string;
    editor: AppEditorContext<WhiteboardState>;
    records: EphemeralRecord<WhiteboardEphemeralData>[];
}) {
    return (
        <>
            {records.map((record) => {
                if (record.message.actor === actor) return null;
                const data = record.message.data;
                if (data.type === 'element-preview') {
                    return (
                        <ElementPreviewOverlay
                            key={record.message.id}
                            preview={data}
                            editor={editor}
                            state={record.state}
                        />
                    );
                }
                if (data.type === 'stroke-preview') {
                    return (
                        <StrokePreviewOverlay
                            key={record.message.id}
                            preview={data}
                            state={record.state}
                        />
                    );
                }
                return (
                    <SelectionPreviewOverlay
                        key={record.message.id}
                        editor={editor}
                        preview={data}
                        state={record.state}
                    />
                );
            })}
        </>
    );
}

function ElementPreviewOverlay({
    preview,
    editor,
    state = 'active',
    local = false,
}: {
    preview: WhiteboardElementPreviewData;
    editor: AppEditorContext<WhiteboardState>;
    state?: EphemeralRecord<WhiteboardEphemeralData>['state'];
    local?: boolean;
}) {
    const element = useValue(editor.$.elements[preview.elementId]);
    if (!element || element.archived) return null;
    const className = `whiteboardPreviewOverlay ${local ? 'local' : 'remote'} ${
        state === 'stale' ? 'stale' : ''
    }`;
    if (element.type === 'stroke') {
        return (
            <svg
                className={`whiteboardPreviewSvg ${local ? 'local' : 'remote'} ${
                    state === 'stale' ? 'stale' : ''
                }`}
                width={BOARD_WIDTH}
                height={BOARD_HEIGHT}
                viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
            >
                <g transform={`translate(${preview.x} ${preview.y})`}>
                    <path
                        d={strokePath(element.points)}
                        fill="none"
                        stroke={element.color}
                        strokeWidth={element.strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </g>
            </svg>
        );
    }
    if (element.type === 'note') {
        return (
            <article
                className={`${className} whiteboardNote`}
                style={previewElementStyle(element, preview, {
                    width: preview.width ?? element.size.width,
                    height: preview.height ?? element.size.height,
                    backgroundColor: element.color,
                })}
            >
                <div className="whiteboardNoteHandle" />
                <div className="whiteboardPreviewNoteText">{element.text || 'Note'}</div>
            </article>
        );
    }
    return (
        <div
            className={`${className} whiteboardEmoji`}
            style={previewElementStyle(element, preview, {
                width: preview.width ?? element.size,
                height: preview.height ?? element.size,
                fontSize: preview.width ?? element.size,
            })}
        >
            {element.emoji}
        </div>
    );
}

function StrokePreviewOverlay({
    preview,
    state,
}: {
    preview: WhiteboardStrokePreviewData;
    state: EphemeralRecord<WhiteboardEphemeralData>['state'];
}) {
    const points = preview.points.map(([x, y, pressure]) => ({x, y, pressure}));
    if (points.length < 1) return null;
    return (
        <svg
            className={`whiteboardPreviewSvg ${state === 'stale' ? 'stale' : ''}`}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        >
            <path
                d={strokePath(points)}
                fill="none"
                stroke={preview.color}
                strokeWidth={preview.width}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function SelectionPreviewOverlay({
    editor,
    preview,
    state,
}: {
    editor: AppEditorContext<WhiteboardState>;
    preview: WhiteboardSelectionData;
    state: EphemeralRecord<WhiteboardEphemeralData>['state'];
}) {
    const bounds = preview.bounds ?? boundsForElements(editor.latest(), preview.elementIds);
    if (!bounds) return null;
    return (
        <div
            className={`whiteboardSelectionPreview ${state === 'stale' ? 'stale' : ''}`}
            style={{
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
            }}
        />
    );
}

function RemoteSelections({statuses}: {statuses: SelectionStatusData[]}) {
    if (!statuses.length) return null;
    return (
        <div className="whiteboardRemoteSelections">
            {statuses.map((status) => (
                <span
                    key={status.actor}
                    style={{backgroundColor: status.color}}
                    title={`${status.nickname} selected this`}
                >
                    {initialForNickname(status.nickname)}
                </span>
            ))}
        </div>
    );
}

type SelectionStatusData = {
    actor: string;
    nickname: string;
    color: string;
    elementId: string;
};

function isSelectionStatusData(value: unknown): value is SelectionStatusData {
    return (
        typeof value === 'object' &&
        value !== null &&
        'actor' in value &&
        'nickname' in value &&
        'color' in value &&
        'elementId' in value
    );
}

function elementPreviewData(
    element: WhiteboardElement,
    override: Partial<Omit<WhiteboardElementPreviewData, 'type' | 'elementId'>> = {},
): WhiteboardElementPreviewData {
    const size =
        element.type === 'note'
            ? {width: element.size.width, height: element.size.height}
            : element.type === 'emoji'
              ? {width: element.size, height: element.size}
              : {};
    return {
        type: 'element-preview',
        elementId: element.id,
        x: element.position.x,
        y: element.position.y,
        rotation: element.rotation,
        ...size,
        ...override,
    };
}

function elementPreviewMessages(
    actor: string,
    element: WhiteboardElement,
    preview: WhiteboardElementPreviewData,
    includeSelection: boolean,
): EphemeralMessage<WhiteboardEphemeralData>[] {
    return [
        elementPreviewMessage(actor, element.id, preview),
        ...(includeSelection
            ? [
                  selectionMessage({
                      actor,
                      elementIds: [element.id],
                      bounds: boundsForPreview(element, preview),
                  }),
              ]
            : []),
    ];
}

function strokePreviewPoints(points: StrokePoint[]): [number, number, number?][] {
    return points.map((point) =>
        point.pressure === undefined ? [point.x, point.y] : [point.x, point.y, point.pressure],
    );
}

function boundsForElement(element: WhiteboardElement) {
    if (element.type === 'note') {
        return {
            x: element.position.x,
            y: element.position.y,
            width: element.size.width,
            height: element.size.height,
        };
    }
    if (element.type === 'emoji') {
        return {
            x: element.position.x,
            y: element.position.y,
            width: element.size,
            height: element.size,
        };
    }
    const xs = element.points.map((point) => point.x + element.position.x);
    const ys = element.points.map((point) => point.y + element.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
        x: minX,
        y: minY,
        width: Math.max(1, Math.max(...xs) - minX),
        height: Math.max(1, Math.max(...ys) - minY),
    };
}

function boundsForPreview(element: WhiteboardElement, preview: WhiteboardElementPreviewData) {
    if (element.type === 'note') {
        return {
            x: preview.x,
            y: preview.y,
            width: preview.width ?? element.size.width,
            height: preview.height ?? element.size.height,
        };
    }
    if (element.type === 'emoji') {
        return {
            x: preview.x,
            y: preview.y,
            width: preview.width ?? element.size,
            height: preview.height ?? element.size,
        };
    }
    const xs = element.points.map((point) => point.x + preview.x);
    const ys = element.points.map((point) => point.y + preview.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
        x: minX,
        y: minY,
        width: Math.max(1, Math.max(...xs) - minX),
        height: Math.max(1, Math.max(...ys) - minY),
    };
}

function boundsForElements(state: WhiteboardState, ids: string[]) {
    const bounds = ids
        .map((id) => state.elements[id])
        .filter((element): element is WhiteboardElement => Boolean(element && !element.archived))
        .map(boundsForElement);
    if (!bounds.length) return null;
    const minX = Math.min(...bounds.map((item) => item.x));
    const minY = Math.min(...bounds.map((item) => item.y));
    const maxX = Math.max(...bounds.map((item) => item.x + item.width));
    const maxY = Math.max(...bounds.map((item) => item.y + item.height));
    return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
}

function elementClassName(base: string, selected: boolean, suppressed: boolean) {
    return [base, selected ? 'selected' : '', suppressed ? 'previewSuppressed' : '']
        .filter(Boolean)
        .join(' ');
}

function elementStyle(element: WhiteboardElement, extra?: CSSProperties): CSSProperties {
    return {
        position: 'absolute',
        left: element.position.x,
        top: element.position.y,
        transform: `rotate(${element.rotation}deg)`,
        ...extra,
    };
}

function previewElementStyle(
    element: WhiteboardElement,
    preview: WhiteboardElementPreviewData,
    extra?: CSSProperties,
): CSSProperties {
    return {
        ...elementStyle(element, extra),
        left: preview.x,
        top: preview.y,
        transform: `rotate(${preview.rotation ?? element.rotation}deg)`,
    };
}

function labelForTool(tool: Tool) {
    switch (tool) {
        case 'select':
            return 'Select';
        case 'note':
            return 'Note';
        case 'pen':
            return 'Pen';
        case 'emoji':
            return 'Emoji';
        case 'erase':
            return 'Erase';
        case 'pan':
            return 'Pan';
    }
}

function nameForElement(element: WhiteboardElement) {
    if (element.type === 'note') return element.text.trim() || 'note';
    if (element.type === 'emoji') return `${element.emoji} stamp`;
    return 'stroke';
}
