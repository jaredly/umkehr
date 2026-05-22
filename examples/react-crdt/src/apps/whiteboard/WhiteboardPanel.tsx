import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {useValue} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {initialForNickname, whiteboardSelectionStatusKind} from '../../lib/server/presence';
import {
    BOARD_HEIGHT,
    BOARD_WIDTH,
    archivedElements,
    boardToScreen,
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
    const elementsRecord = useValue(editor.$.elements);
    const state = useMemo<WhiteboardState>(
        () => ({background: editor.latest().background, elements: elementsRecord}),
        [editor, elementsRecord],
    );
    const elements = useMemo(() => orderedElements(state), [state]);
    const archived = useMemo(() => archivedElements(state), [state]);
    const latestState = useRef(state);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [tool, setTool] = useState<Tool>('select');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<(typeof emojiChoices)[number]>('👍');
    const [noteColor, setNoteColor] = useState<(typeof noteColors)[number]>('#fff7b8');
    const [viewport, setViewport] = useState<Viewport>({panX: 80, panY: 70, zoom: 0.75});
    const [activeStroke, setActiveStroke] = useState<StrokePoint[] | null>(null);
    const [drag, setDrag] = useState<DragState>(null);
    const [showArchive, setShowArchive] = useState(false);
    const [viewportSize, setViewportSize] = useState({width: 1, height: 1});
    const [draggingMinimap, setDraggingMinimap] = useState(false);
    const [focusNoteId, setFocusNoteId] = useState<string | null>(null);

    latestState.current = state;

    useEffect(() => {
        if (!readOnly) return;
        editor.clearPreview();
        setActiveStroke(null);
        setDrag(null);
        if (tool !== 'pan') setTool('select');
    }, [editor, readOnly, tool]);

    useEffect(() => {
        setPresenceSelection?.(readOnly ? null : selectedId);
    }, [readOnly, selectedId, setPresenceSelection]);

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
            const element = latestState.current.elements[drag.id];
            if (!element) return;
            if (drag.kind === 'move') {
                editor.dispatch(
                    {
                        op: 'replace',
                        path: elementFieldPath(drag.id, 'position'),
                        value: {x: point.x - drag.offsetX, y: point.y - drag.offsetY},
                    },
                    'preview',
                );
            } else if (drag.kind === 'resize-note' && element.type === 'note') {
                editor.dispatch(
                    {
                        op: 'replace',
                        path: elementFieldPath(drag.id, 'size'),
                        value: {
                            width: Math.max(120, point.x - drag.originX),
                            height: Math.max(96, point.y - drag.originY),
                        },
                    },
                    'preview',
                );
            }
        };
        const onPointerUp = (event: PointerEvent) => {
            if (event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) {
                setDrag(null);
                editor.clearPreview();
                return;
            }
            if (drag.kind === 'pan') {
                setDrag(null);
                return;
            }
            if (readOnly) {
                setDrag(null);
                editor.clearPreview();
                return;
            }
            const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
            const element = latestState.current.elements[drag.id];
            setDrag(null);
            editor.clearPreview();
            if (!element) return;
            if (drag.kind === 'move') {
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(drag.id, 'position'),
                    value: {x: point.x - drag.offsetX, y: point.y - drag.offsetY},
                });
            } else if (drag.kind === 'resize-note' && element.type === 'note') {
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(drag.id, 'size'),
                    value: {
                        width: Math.max(120, point.x - drag.originX),
                        height: Math.max(96, point.y - drag.originY),
                    },
                });
            }
        };
        const onCancel = () => {
            setDrag(null);
            editor.clearPreview();
        };
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onCancel);
        };
    }, [drag, editor, readOnly, viewport]);

    const makeBase = useCallback(
        (type: WhiteboardElement['type'], x: number, y: number) => {
            const id = `wb-${crypto.randomUUID()}`;
            return {
                type,
                id,
                position: {x, y},
                rotation: 0,
                zOrder: nextTopZOrder(elements),
                createdBy: actor,
                createdAt: new Date().toISOString(),
                archived: false,
            };
        },
        [actor, elements],
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
        (points: StrokePoint[]) => {
            const simplified = simplifyStroke(points);
            if (simplified.length < 2) return;
            const first = simplified[0];
            const localPoints = simplified.map((point) => ({
                ...point,
                x: point.x - first.x,
                y: point.y - first.y,
            }));
            addElement({
                ...makeBase('stroke', first.x, first.y),
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
            {op: 'replace', path: elementFieldPath(selectedId, 'archivedAt'), value: new Date().toISOString()},
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
            const current = orderedElements(latestState.current);
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
                editor.dispatch({op: 'replace', path: elementFieldPath(selectedId, 'zOrder'), value: next});
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
            setActiveStroke([point]);
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
        setActiveStroke((current) => (current ? [...current, point] : current));
    };

    const onBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (readOnly || !activeStroke) return;
        event.preventDefault();
        commitStroke(activeStroke);
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
                {op: 'replace', path: elementFieldPath(element.id, 'archivedAt'), value: new Date().toISOString()},
            ]);
            setSelectedId(null);
            return;
        }
        setSelectedId(element.id);
        if (tool !== 'select') return;
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = screenToBoard(event.clientX, event.clientY, rect, viewport);
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
                    <p>{elements.length} visible</p>
                </div>
                <div className="whiteboardActions">
                    <button type="button" onClick={() => editor.undo()} disabled={readOnly || !editor.canUndo()}>
                        Undo
                    </button>
                    <button type="button" onClick={() => editor.redo()} disabled={readOnly || !editor.canRedo()}>
                        Redo
                    </button>
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
                            className={noteColor === color ? 'whiteboardSwatch active' : 'whiteboardSwatch'}
                            style={{backgroundColor: color}}
                            onClick={() => setNoteColor(color)}
                            aria-label={`Note color ${color}`}
                            disabled={readOnly}
                        />
                    ))}
                </div>
                <select
                    value={selectedEmoji}
                    onChange={(event) => setSelectedEmoji(event.target.value as typeof selectedEmoji)}
                    aria-label="Emoji stamp"
                    disabled={readOnly}
                >
                    {emojiChoices.map((emoji) => (
                        <option key={emoji} value={emoji}>
                            {emoji}
                        </option>
                    ))}
                </select>
                <button type="button" onClick={() => setLayer('back')} disabled={readOnly || !selectedId}>
                    Back
                </button>
                <button type="button" onClick={() => setLayer('backward')} disabled={readOnly || !selectedId}>
                    Down
                </button>
                <button type="button" onClick={() => setLayer('forward')} disabled={readOnly || !selectedId}>
                    Up
                </button>
                <button type="button" onClick={() => setLayer('front')} disabled={readOnly || !selectedId}>
                    Front
                </button>
                <button type="button" onClick={archiveSelected} disabled={readOnly || !selectedId}>
                    Archive
                </button>
                <button type="button" onClick={() => setShowArchive((value) => !value)}>
                    Recover ({archived.length})
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
                    {archived.length ? (
                        archived.map((element) => (
                            <button
                                key={element.id}
                                type="button"
                                onClick={() => recover(element.id)}
                                disabled={readOnly}
                            >
                                Recover {nameForElement(element)}
                            </button>
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
                        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill={state.background} />
                        {elements.map((element) =>
                            element.type === 'stroke' ? (
                                <StrokeView
                                    key={element.id}
                                    element={element}
                                    selected={selectedId === element.id}
                                    onPointerDown={(event) => startElementDrag(element, event)}
                                    editor={editor}
                                />
                            ) : null,
                        )}
                        {activeStroke ? (
                            <path
                                className="whiteboardActiveStroke"
                                d={strokePath(activeStroke)}
                                fill="none"
                                stroke="#17202a"
                                strokeWidth={4}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}
                    </svg>

                    {elements.map((element) =>
                        element.type === 'note' ? (
                            <NoteView
                                key={element.id}
                                element={element}
                                selected={selectedId === element.id}
                                editor={editor}
                                readOnly={readOnly}
                                autoFocus={focusNoteId === element.id}
                                onAutoFocused={() => setFocusNoteId(null)}
                                onPointerDown={(event) => startElementDrag(element, event)}
                                onResizePointerDown={(event) => {
                                    if (readOnly) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setSelectedId(element.id);
                                    setDrag({
                                        kind: 'resize-note',
                                        id: element.id,
                                        pointerId: event.pointerId,
                                        originX: element.position.x,
                                        originY: element.position.y,
                                    });
                                }}
                            />
                        ) : element.type === 'emoji' ? (
                            <EmojiView
                                key={element.id}
                                element={element}
                                selected={selectedId === element.id}
                                editor={editor}
                                onPointerDown={(event) => startElementDrag(element, event)}
                            />
                        ) : null,
                    )}
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
                        {elements.map((element) => (
                            <rect
                                key={element.id}
                                x={element.position.x}
                                y={element.position.y}
                                width={element.type === 'note' ? element.size.width : element.type === 'emoji' ? element.size : 40}
                                height={element.type === 'note' ? element.size.height : element.type === 'emoji' ? element.size : 24}
                                fill={element.type === 'note' ? element.color : '#94a3b8'}
                            />
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

function NoteView({
    element,
    selected,
    editor,
    readOnly,
    autoFocus,
    onAutoFocused,
    onPointerDown,
    onResizePointerDown,
}: {
    element: StickyNoteElement;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    readOnly: boolean;
    autoFocus: boolean;
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
            editor.dispatch({op: 'replace', path: elementFieldPath(element.id, 'text'), value: draft});
        }
    };

    return (
        <article
            className={selected ? 'whiteboardNote selected' : 'whiteboardNote'}
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
    onPointerDown,
}: {
    element: EmojiStampElement;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <div
            className={selected ? 'whiteboardEmoji selected' : 'whiteboardEmoji'}
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
    editor,
    onPointerDown,
}: {
    element: StrokeElement;
    selected: boolean;
    editor: AppEditorContext<WhiteboardState>;
    onPointerDown(event: ReactPointerEvent<SVGPathElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <g transform={`translate(${element.position.x} ${element.position.y})`}>
            <path
                className={selected ? 'whiteboardStroke selected' : 'whiteboardStroke'}
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

function elementStyle(
    element: WhiteboardElement,
    extra?: CSSProperties,
): CSSProperties {
    return {
        position: 'absolute',
        left: element.position.x,
        top: element.position.y,
        transform: `rotate(${element.rotation}deg)`,
        ...extra,
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
