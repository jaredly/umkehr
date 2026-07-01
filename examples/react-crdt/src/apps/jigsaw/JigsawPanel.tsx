import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type RefObject,
    type PointerEvent,
} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {currentJigsawBoard, currentJigsawImage, type JigsawBoardArtifact, type PieceBounds} from './artifacts';
import type {Coord, JigsawEphemeralData, JigsawState, PathSegment} from './model';
import {
    add,
    arrangeUnplacedPieces,
    buildPuzzleLayout,
    canonicalTorusPoint,
    connectionPatch,
    distance,
    estimatedPieceSize,
    isInsideTorusViewport,
    outerPosition,
    nearestEquivalentPoint,
    positionPatch,
    positiveModulo,
    snapCandidates,
    snapThreshold,
    subtract,
    surfacePosition,
    torusPieceCopies,
    unplacedPieces,
    validConnections,
    wrappedDistance,
    type ComponentPlacementSpace,
} from './jigsaw';
import {JigsawMinimap, type JigsawBoardSpace, type JigsawViewport} from './JigsawMinimap';

type DragState = {
    pointerId: number;
    component: number[];
    anchor: number;
    currentPointer: Coord;
    pointerOffset: Coord;
    pieceOffsets: Map<number, Coord>;
    originSpace: DragSpace;
    previewSpace: DragSpace;
};

type DragSpace = 'outer' | 'surface';

type PanState = {
    pointerId: number;
    mode: 'outer' | 'torus';
    startX: number;
    startY: number;
    panX: number;
    panY: number;
};

type TorusViewport = {
    panX: number;
    panY: number;
};

type LocalLayoutState = {
    seed: number;
    positions: Map<number, Coord>;
};

type SnapPulse = {
    id: number;
    pieces: Set<number>;
};

const minZoom = 0.1;
const maxZoom = 2.5;
const wheelZoomInFactor = 1.08;
const wheelZoomOutFactor = 0.92;
const remoteMoveAnimationMs = 240;
const maxCanvasBackingScale = 4;

export function JigsawPanel({
    editor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<JigsawState, 'type', JigsawEphemeralData>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const board = currentJigsawBoard();
    const positions = useValue(editor.$.positions);
    const connections = useValue(editor.$.connections);
    const sourceImage = useJigsawSourceCanvas(board);
    const isTorusBoard = board.surface === 'torus';
    const state = useMemo(() => ({positions, connections}), [connections, positions]);
    const layout = useMemo(() => buildPuzzleLayout(board, state), [board, state]);
    const pieceSize = useMemo(() => estimatedPieceSize(board), [board]);
    const boardGeometry = useMemo(() => boardSpaceFor(board.imageSize, pieceSize), [board.imageSize, pieceSize]);
    const threshold = useMemo(() => snapThreshold(board), [board]);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const pieceRefs = useRef(new Map<number, HTMLElement>());
    const pieceElementRefs = useMemo(
        () =>
            board.pieces.map(
                (_piece, index) => (element: HTMLButtonElement | null) =>
                    setPieceElement(pieceRefs.current, index, element),
            ),
        [board],
    );
    const [viewportSize, setViewportSize] = useState({width: 1, height: 1});
    const [viewport, setViewport] = useState<JigsawViewport>({panX: 0, panY: 0, zoom: 1});
    const [torusViewport, setTorusViewport] = useState<TorusViewport>({panX: 0, panY: 0});
    const [viewportInitialized, setViewportInitialized] = useState(false);
    const [localLayout, setLocalLayout] = useState<LocalLayoutState>(() => ({
        seed: 1,
        positions: new Map(),
    }));
    const [drag, setDrag] = useState<DragState | null>(null);
    const [pan, setPan] = useState<PanState | null>(null);
    const [draggingMinimap, setDraggingMinimap] = useState(false);
    const [snapPulse, setSnapPulse] = useState<SnapPulse | null>(null);
    const [localMoveAnimationNonce, setLocalMoveAnimationNonce] = useState(0);
    const [showPreviewImage, setShowPreviewImage] = useState(false);
    const unplaced = useMemo(() => unplacedPieces(board, layout), [board, layout]);
    const localPositions = localLayout.positions;

    useEffect(() => {
        setTorusViewport({panX: 0, panY: 0});
    }, [board.imageSize.height, board.imageSize.width, isTorusBoard]);

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
        if (viewportInitialized || viewportSize.width <= 1 || viewportSize.height <= 1) return;
        const fitZoom = clamp(
            Math.min(
                viewportSize.width / boardGeometry.boardSpace.width,
                viewportSize.height / boardGeometry.boardSpace.height,
            ) * 0.96,
            minZoom,
            1,
        );
        setViewport({
            zoom: fitZoom,
            panX: (viewportSize.width - boardGeometry.boardSpace.width * fitZoom) / 2,
            panY: (viewportSize.height - boardGeometry.boardSpace.height * fitZoom) / 2,
        });
        setViewportInitialized(true);
    }, [boardGeometry.boardSpace.height, boardGeometry.boardSpace.width, viewportInitialized, viewportSize]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                const rect = element.getBoundingClientRect();
                const before = screenToCanvas(event.clientX, event.clientY, rect, viewport);
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
                return;
            }
            setViewport((current) => ({
                ...current,
                panX: current.panX - event.deltaX,
                panY: current.panY - event.deltaY,
            }));
        };
        element.addEventListener('wheel', onWheel, {passive: false});
        return () => element.removeEventListener('wheel', onWheel);
    }, [board.imageSize.height, board.imageSize.width, isTorusBoard, viewport]);

    useEffect(() => {
        setLocalLayout((current) => {
            const unplacedSet = new Set(unplaced);
            const nextPositions = new Map<number, Coord>();
            let changed = false;

            for (const piece of unplaced) {
                const existing = current.positions.get(piece);
                if (existing) nextPositions.set(piece, existing);
            }
            if (nextPositions.size !== current.positions.size) changed = true;

            const missing = unplaced.filter((piece) => !nextPositions.has(piece));
            if (missing.length) {
                const generated = arrangeLocalUnplacedPieces(
                    board,
                    unplaced,
                    current.seed,
                );
                for (const piece of missing) {
                    const position = generated.get(piece);
                    if (position) nextPositions.set(piece, position);
                }
                changed = true;
            }

            for (const piece of current.positions.keys()) {
                if (!unplacedSet.has(piece)) changed = true;
            }

            return changed ? {...current, positions: nextPositions} : current;
        });
    }, [board, unplaced]);

    useEffect(() => {
        if (!snapPulse) return;
        const timeout = window.setTimeout(() => setSnapPulse(null), 200);
        return () => window.clearTimeout(timeout);
    }, [snapPulse]);

    const activeComponent = useMemo(() => new Set(drag?.component ?? []), [drag]);
    const dragPositions = useMemo(() => (drag ? positionsForDrag(drag) : null), [drag]);
    const renderedSurfacePlacedPositions = useMemo(() => {
        const result = new Map<number, Coord>();
        for (const [piece, position] of layout.positions) {
            if (activeComponent.has(piece)) continue;
            if (layout.pieceSpaces.get(piece) === 'surface') result.set(piece, position);
        }
        if (drag?.previewSpace === 'surface' && dragPositions) {
            for (const [piece, position] of dragPositions) result.set(piece, position);
        }
        return result;
    }, [activeComponent, drag, dragPositions, layout.pieceSpaces, layout.positions]);
    const renderedOuterPlacedPositions = useMemo(() => {
        const result = new Map<number, Coord>();
        for (const [piece, position] of layout.positions) {
            if (activeComponent.has(piece)) continue;
            if (!isTorusBoard || layout.pieceSpaces.get(piece) === 'outer') result.set(piece, position);
        }
        if (drag?.previewSpace === 'outer' && dragPositions) {
            for (const [piece, position] of dragPositions) {
                if (layout.positions.has(piece)) result.set(piece, position);
            }
        }
        return result;
    }, [activeComponent, drag, dragPositions, isTorusBoard, layout.pieceSpaces, layout.positions]);
    const renderedUnplacedPositions = useMemo(() => {
        const result = new Map<number, Coord>();
        for (const [piece, position] of localPositions) {
            if (!activeComponent.has(piece)) result.set(piece, position);
        }
        if (drag?.previewSpace === 'outer' && dragPositions) {
            for (const [piece, position] of dragPositions) {
                if (!layout.positions.has(piece)) result.set(piece, position);
            }
        }
        return result;
    }, [activeComponent, drag, dragPositions, layout.positions, localPositions]);
    const renderedPositions = useMemo(() => {
        const result = new Map<number, Coord>(localPositions);
        for (const [piece, position] of layout.positions) result.set(piece, position);
        if (dragPositions) {
            for (const [piece, position] of dragPositions) {
                result.set(piece, position);
            }
        }
        return result;
    }, [dragPositions, layout.positions, localPositions]);
    const minimapPositions = useMemo(() => {
        if (!isTorusBoard) return renderedPositions;
        const result = new Map<number, Coord>(renderedUnplacedPositions);
        for (const [piece, position] of renderedOuterPlacedPositions) {
            result.set(piece, position);
        }
        for (const [piece, position] of renderedSurfacePlacedPositions) {
            result.set(piece, canonicalTorusPoint(position, board.imageSize));
        }
        return result;
    }, [
        board.imageSize,
        isTorusBoard,
        renderedOuterPlacedPositions,
        renderedPositions,
        renderedSurfacePlacedPositions,
        renderedUnplacedPositions,
    ]);
    usePieceMoveAnimation(renderedPositions, pieceRefs, {
        disabled: Boolean(drag) || isTorusBoard,
        durationMs: remoteMoveAnimationMs,
        localMoveAnimationNonce,
    });
    const placedPieces = useMemo(() => new Set(layout.positions.keys()), [layout.positions]);
    const totalConnections = board.pieces.reduce((sum, piece) => sum + piece.neighbors.length, 0) / 2;
    const solvedConnections = validConnections(board, connections).length;

    const startDrag = (piece: number, event: PointerEvent<HTMLButtonElement>) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        const placed = layout.positions.has(piece);
        const originSpace: DragSpace =
            isTorusBoard && placed && layout.pieceSpaces.get(piece) === 'surface' ? 'surface' : 'outer';
        const componentIndex = layout.pieceToComponent.get(piece);
        const component = componentIndex === undefined ? [piece] : layout.components[componentIndex] ?? [piece];
        const anchor = componentIndex === undefined ? piece : layout.anchors.get(componentIndex) ?? piece;
        const initialPositions = new Map<number, Coord>();
        for (const componentPiece of component) {
            const position = renderedPositions.get(componentPiece);
            if (position) initialPositions.set(componentPiece, position);
        }
        if (!initialPositions.has(anchor)) {
            const fallback = renderedPositions.get(piece);
            if (fallback) initialPositions.set(anchor, fallback);
        }
        const anchorPosition = initialPositions.get(anchor);
        if (!anchorPosition) return;
        const pointer = pointerForDragSpace(event, originSpace, anchorPosition);
        if (!pointer) return;
        const pieceOffsets = new Map<number, Coord>();
        for (const [componentPiece, position] of initialPositions) {
            pieceOffsets.set(componentPiece, subtract(position, anchorPosition));
        }
        viewportRef.current?.setPointerCapture(event.pointerId);
        setDrag({
            pointerId: event.pointerId,
            component,
            anchor,
            currentPointer: pointer,
            pointerOffset: subtract(pointer, anchorPosition),
            pieceOffsets,
            originSpace,
            previewSpace: originSpace,
        });
    };
    const startDragRef = useRef(startDrag);
    startDragRef.current = startDrag;
    const handlePiecePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
        const piece = Number(event.currentTarget.dataset.piece);
        if (!Number.isInteger(piece)) return;
        startDragRef.current(piece, event);
    }, []);

    const startPan = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary || drag) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const mode = isTorusBoard && eventTargetIsInTorusViewport(event.target) ? 'torus' : 'outer';
        setPan({
            pointerId: event.pointerId,
            mode,
            startX: event.clientX,
            startY: event.clientY,
            panX: mode === 'torus' ? torusViewport.panX : viewport.panX,
            panY: mode === 'torus' ? torusViewport.panY : viewport.panY,
        });
    };

    const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (pan && event.pointerId === pan.pointerId) {
            event.preventDefault();
            if (pan.mode === 'torus') {
                setTorusViewport({
                    panX: positiveModulo(pan.panX + (event.clientX - pan.startX) / viewport.zoom, board.imageSize.width),
                    panY: positiveModulo(pan.panY + (event.clientY - pan.startY) / viewport.zoom, board.imageSize.height),
                });
                return;
            }
            setViewport((current) => ({
                ...current,
                panX: pan.panX + event.clientX - pan.startX,
                panY: pan.panY + event.clientY - pan.startY,
            }));
            return;
        }
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        const previewSpace = torusPointerIsInside(event) ? 'surface' : 'outer';
        const pointer = pointerForDragSpace(event, previewSpace, drag.currentPointer);
        if (!pointer) return;
        setDrag({
            ...drag,
            currentPointer: pointer,
            previewSpace,
        });
    };

    const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (pan && event.pointerId === pan.pointerId) {
            event.preventDefault();
            releasePointerCapture(event);
            setPan(null);
            return;
        }
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        releasePointerCapture(event);
        const latest = editor.latest();
        const latestLayout = buildPuzzleLayout(board, latest);
        const draggedPieces = new Set(drag.component);
        const torusDropInside = torusPointerIsInside(event);
        const dropSpace: DragSpace = torusDropInside ? 'surface' : 'outer';
        const dropPointer = pointerForDragSpace(event, dropSpace, drag.currentPointer);
        const draggedPositions = dropPointer ? positionsForDrag(drag, dropPointer) : positionsForDrag(drag);
        const anchorPosition = draggedPositions.get(drag.anchor);
        if (!anchorPosition) {
            setDrag(null);
            return;
        }

        const snapSpace: ComponentPlacementSpace = !isTorusBoard
            ? 'plane'
            : dropSpace === 'surface'
                ? 'surface'
                : 'outer';
        const allPositions = positionsForSnap(latestLayout, localPositions, snapSpace);
        for (const [piece, position] of draggedPositions) allPositions.set(piece, position);
        const candidates = snapCandidates({
            board,
            layout: latestLayout,
            draggedPieces,
            draggedPositions,
            allPositions,
            snapThreshold: threshold,
            distanceBetween:
                isTorusBoard && dropSpace === 'surface'
                    ? (a, b) => wrappedDistance(a, b, board.imageSize)
                    : distance,
        });
        const newConnections = candidates.filter(
            (candidate) => latest.connections[candidate.key] === undefined,
        );
        const storedAnchorPosition = isTorusBoard
            ? dropSpace === 'surface'
                ? surfacePosition(canonicalTorusPoint(anchorPosition, board.imageSize))
                : outerPosition(anchorPosition)
            : anchorPosition;
        const patches = [
            positionPatch(latest, drag.anchor, storedAnchorPosition),
            ...newConnections.map(connectionPatch),
        ];
        suppressLocalMoveAnimation();
        editor.dispatch(patches);
        if (newConnections.length) {
            setSnapPulse({
                id: window.performance.now(),
                pieces: new Set(newConnections.flatMap((connection) => [connection.from, connection.to])),
            });
        }
        setDrag(null);
    };

    const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
        releasePointerCapture(event);
        setDrag(null);
        setPan(null);
    };

    const recenterFromMinimap = (point: Coord) => {
        setViewport((current) => ({
            ...current,
            panX: viewportSize.width / 2 - point.x * current.zoom,
            panY: viewportSize.height / 2 - point.y * current.zoom,
        }));
    };

    const renderPiece = ({
        index,
        position,
        placed,
        layer,
        keyPrefix,
        copyKey,
        copyPrimary = true,
        elementRef = pieceElementRefs[index],
    }: {
        index: number;
        position: Coord;
        placed: boolean;
        layer: 'outer' | 'torus';
        keyPrefix: string;
        copyKey?: string;
        copyPrimary?: boolean;
        elementRef?: (element: HTMLButtonElement | null) => void;
    }) => {
        const piece = board.pieces[index];
        if (!piece) return null;
        const canvasPosition = layer === 'outer' ? imageToCanvas(position, boardGeometry.imageOffset) : position;
        const componentIndex = layout.pieceToComponent.get(index);
        const component =
            componentIndex === undefined
                ? [index]
                : layout.components[componentIndex] ?? [index];
        const anchor =
            componentIndex === undefined ? undefined : layout.anchors.get(componentIndex);
        const active = activeComponent.has(index);
        const snapped = snapPulse?.pieces.has(index) ?? false;
        return (
            <JigsawPieceView
                key={`${keyPrefix}-${index}${copyKey ? `-${copyKey}` : ''}`}
                elementRef={elementRef}
                piece={index}
                copyKey={copyKey}
                copyPrimary={copyPrimary}
                left={canvasPosition.x + piece.bounds.left}
                top={canvasPosition.y + piece.bounds.top}
                width={piece.bounds.width}
                height={piece.bounds.height}
                zIndex={pieceZIndex({
                    piece: index,
                    component,
                    anchor,
                    placed,
                    active,
                })}
                placed={placed}
                active={active}
                snapped={snapped}
                snapPulseId={snapPulse?.id}
                readOnly={readOnly}
                source={sourceImage}
                pieceCenterX={piece.center.x}
                pieceCenterY={piece.center.y}
                bounds={piece.bounds}
                mask={piece.mask}
                onPointerDown={handlePiecePointerDown}
            />
        );
    };

    return (
        <section
            className={`jigsawPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
            data-testid="jigsaw-panel"
        >
            <header className="jigsawHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {board.title} · {solvedConnections}/{totalConnections} joins
                    </p>
                </div>
                <div className="jigsawActions">
                    <button
                        type="button"
                        className={showPreviewImage ? 'active' : undefined}
                        aria-pressed={showPreviewImage}
                        onClick={() => setShowPreviewImage((current) => !current)}
                    >
                        {showPreviewImage ? 'Hide preview' : 'Show preview'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            suppressLocalMoveAnimation();
                            setLocalLayout((current) => {
                                const seed = current.seed + 1;
                                return {
                                    seed,
                                    positions: arrangeLocalUnplacedPieces(
                                        board,
                                        unplaced,
                                        seed,
                                    ),
                                };
                            });
                        }}
                    >
                        Reshuffle
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            suppressLocalMoveAnimation();
                            editor.undo();
                        }}
                        disabled={readOnly || !editor.canUndo()}
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            suppressLocalMoveAnimation();
                            editor.redo();
                        }}
                        disabled={readOnly || !editor.canRedo()}
                    >
                        Redo
                    </button>
                </div>
            </header>

            <div
                ref={viewportRef}
                className="jigsawViewport"
                data-testid="jigsaw-viewport"
                onPointerDown={startPan}
                onPointerMove={updateDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
            >
                <div
                    className="jigsawCanvas"
                    data-testid="jigsaw-canvas"
                    style={{
                        width: boardGeometry.boardSpace.width,
                        height: boardGeometry.boardSpace.height,
                        transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                    }}
                >
                    {isTorusBoard ? (
                        <>
                            <div
                                className="jigsawTorusViewport"
                                data-testid="jigsaw-torus-viewport"
                                style={{
                                    left: boardGeometry.imageOffset.x,
                                    top: boardGeometry.imageOffset.y,
                                    width: board.imageSize.width,
                                    height: board.imageSize.height,
                                }}
                            >
                                <div
                                    className="jigsawTorusCanvas"
                                    data-testid="jigsaw-torus-canvas"
                                    style={{
                                        width: board.imageSize.width,
                                        height: board.imageSize.height,
                                    }}
                                >
                                    {showPreviewImage
                                        ? torusImageTiles(torusViewport, board.imageSize).map((offset) => (
                                              <SolvedImageCanvas
                                                  key={`${offset.x}:${offset.y}`}
                                                  source={sourceImage}
                                                  offset={offset}
                                              />
                                          ))
                                        : null}
                                    {board.pieces.flatMap((_piece, index) => {
                                        const position = renderedSurfacePlacedPositions.get(index);
                                        if (!position) return [];
                                        return torusPieceCopies({
                                            board,
                                            piece: index,
                                            position,
                                            pan: torusPanCoord(torusViewport),
                                        }).map((copy) =>
                                            renderPiece({
                                                index,
                                                position: copy.position,
                                                placed: layout.positions.has(index),
                                                layer: 'torus',
                                                keyPrefix: 'torus',
                                                copyKey: copy.key,
                                                copyPrimary: copy.primary,
                                                elementRef: copy.primary ? pieceElementRefs[index] : undefined,
                                            }),
                                        );
                                    })}
                                </div>
                            </div>
                            {board.pieces.map((_piece, index) => {
                                const position = renderedOuterPlacedPositions.get(index);
                                if (!position) return null;
                                return renderPiece({
                                    index,
                                    position,
                                    placed: true,
                                    layer: 'outer',
                                    keyPrefix: 'outer-placed',
                                });
                            })}
                            {board.pieces.map((_piece, index) => {
                                const position = renderedUnplacedPositions.get(index);
                                if (!position) return null;
                                return renderPiece({
                                    index,
                                    position,
                                    placed: false,
                                    layer: 'outer',
                                    keyPrefix: 'outer',
                                });
                            })}
                        </>
                    ) : (
                        <>
                            {showPreviewImage ? (
                                <SolvedImageCanvas source={sourceImage} offset={boardGeometry.imageOffset} />
                            ) : null}
                            {board.pieces.map((_piece, index) => {
                                const position = renderedPositions.get(index);
                                if (!position) return null;
                                return renderPiece({
                                    index,
                                    position,
                                    placed: layout.positions.has(index),
                                    layer: 'outer',
                                    keyPrefix: 'plane',
                                });
                            })}
                        </>
                    )}
                </div>
                <JigsawMinimap
                    board={board}
                    boardSpace={boardGeometry.boardSpace}
                    imageOffset={boardGeometry.imageOffset}
                    imageSize={board.imageSize}
                    renderedPositions={minimapPositions}
                    placedPieces={placedPieces}
                    viewport={viewport}
                    viewportSize={viewportSize}
                    torus={
                        isTorusBoard
                            ? {
                                  panX: torusViewport.panX,
                                  panY: torusViewport.panY,
                                  imageSize: board.imageSize,
                              }
                            : undefined
                    }
                    dragging={draggingMinimap}
                    setDragging={setDraggingMinimap}
                    recenter={recenterFromMinimap}
                />
            </div>
        </section>
    );

    function pointerToBoard(event: PointerEvent<HTMLElement>): Coord | null {
        const viewportElement = viewportRef.current;
        if (!viewportElement) return null;
        const rect = viewportElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return canvasToImage(
            screenToCanvas(event.clientX, event.clientY, rect, viewport),
            boardGeometry.imageOffset,
        );
    }

    function pointerToTorusLocal(event: PointerEvent<HTMLElement>): Coord | null {
        const viewportElement = viewportRef.current;
        if (!viewportElement) return null;
        const rect = viewportElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return subtract(
            screenToCanvas(event.clientX, event.clientY, rect, viewport),
            boardGeometry.imageOffset,
        );
    }

    function pointerToTorusImage(
        event: PointerEvent<HTMLElement>,
        reference?: Coord,
    ): Coord | null {
        const local = pointerToTorusLocal(event);
        if (!local) return null;
        const raw = subtract(local, torusPanCoord(torusViewport));
        const canonical = canonicalTorusPoint(raw, board.imageSize);
        return reference ? nearestEquivalentPoint(canonical, reference, board.imageSize) : canonical;
    }

    function torusPointerIsInside(event: PointerEvent<HTMLElement>) {
        if (!isTorusBoard) return false;
        const local = pointerToTorusLocal(event);
        return local ? isInsideTorusViewport(local, board.imageSize) : false;
    }

    function pointerForDragSpace(
        event: PointerEvent<HTMLElement>,
        space: DragSpace,
        reference?: Coord,
    ) {
        return space === 'surface' ? pointerToTorusImage(event, reference) : pointerToBoard(event);
    }

    function pieceZIndex({
        piece,
        component,
        anchor,
        placed,
        active,
    }: {
        piece: number;
        component: number[];
        anchor?: number;
        placed: boolean;
        active: boolean;
    }) {
        if (active) return 5000;
        const base = placed ? 1000 : 0;
        return base + Math.max(...component, anchor ?? piece);
    }

    function suppressLocalMoveAnimation() {
        setLocalMoveAnimationNonce((current) => current + 1);
    }
}

function usePieceMoveAnimation(
    positions: Map<number, Coord>,
    refs: RefObject<Map<number, HTMLElement>>,
    {
        disabled,
        durationMs,
        localMoveAnimationNonce,
    }: {
        disabled: boolean;
        durationMs: number;
        localMoveAnimationNonce: number;
    },
) {
    const previousPositions = useRef(new Map<number, Coord>());
    const previousLocalMoveAnimationNonce = useRef(localMoveAnimationNonce);

    useLayoutEffect(() => {
        const skipLocalMoveAnimation = previousLocalMoveAnimationNonce.current !== localMoveAnimationNonce;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!disabled && !skipLocalMoveAnimation && !reduceMotion) {
            for (const [piece, next] of positions) {
                const previous = previousPositions.current.get(piece);
                const element = refs.current?.get(piece);
                if (!previous || !element) continue;
                const deltaX = previous.x - next.x;
                const deltaY = previous.y - next.y;
                if (Math.hypot(deltaX, deltaY) < 1) continue;
                element.getAnimations().forEach((animation) => animation.cancel());
                element.animate(
                    [
                        {transform: `translate(${deltaX}px, ${deltaY}px)`},
                        {transform: 'translate(0, 0)'},
                    ],
                    {
                        duration: durationMs,
                        easing: 'cubic-bezier(0.2, 0, 0, 1)',
                    },
                );
            }
        }

        previousLocalMoveAnimationNonce.current = localMoveAnimationNonce;
        previousPositions.current = new Map(positions);
    }, [disabled, durationMs, localMoveAnimationNonce, positions, refs]);
}

function setPieceElement(
    refs: Map<number, HTMLElement>,
    piece: number,
    element: HTMLElement | null,
) {
    if (element) {
        refs.set(piece, element);
        return;
    }
    refs.delete(piece);
}

type JigsawPieceViewProps = {
    elementRef?: (element: HTMLButtonElement | null) => void;
    piece: number;
    copyKey?: string;
    copyPrimary?: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
    zIndex: number;
    placed: boolean;
    active: boolean;
    snapped: boolean;
    snapPulseId?: number;
    readOnly: boolean;
    source: HTMLCanvasElement;
    pieceCenterX: number;
    pieceCenterY: number;
    bounds: PieceBounds;
    mask: PathSegment[];
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
};

const JigsawPieceView = memo(function JigsawPieceView({
    elementRef,
    piece,
    copyKey,
    copyPrimary = true,
    left,
    top,
    width,
    height,
    zIndex,
    placed,
    active,
    snapped,
    snapPulseId,
    readOnly,
    source,
    pieceCenterX,
    pieceCenterY,
    bounds,
    mask,
    onPointerDown,
}: JigsawPieceViewProps) {
    return (
        <button
            ref={elementRef}
            type="button"
            className={`jigsawPiece ${placed ? 'placed' : 'unplaced'} ${active ? 'dragging' : ''} ${
                snapped ? 'snapped' : ''
            }`}
            data-piece={piece}
            data-piece-copy={copyKey}
            data-snap-pulse={snapped ? snapPulseId : undefined}
            disabled={readOnly}
            tabIndex={copyPrimary ? undefined : -1}
            aria-hidden={copyPrimary ? undefined : true}
            onPointerDown={onPointerDown}
            style={
                {
                    '--piece-left': `${left}px`,
                    '--piece-top': `${top}px`,
                    '--piece-width': `${width}px`,
                    '--piece-height': `${height}px`,
                    '--piece-z': zIndex,
                } as CSSProperties
            }
            aria-label={`Piece ${piece + 1}`}
        >
            <PieceCanvas
                source={source}
                pieceCenter={{x: pieceCenterX, y: pieceCenterY}}
                bounds={bounds}
                mask={mask}
            />
        </button>
    );
}, areJigsawPieceViewPropsEqual);

function areJigsawPieceViewPropsEqual(previous: JigsawPieceViewProps, next: JigsawPieceViewProps) {
    return (
        previous.elementRef === next.elementRef &&
        previous.piece === next.piece &&
        previous.copyKey === next.copyKey &&
        previous.copyPrimary === next.copyPrimary &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.zIndex === next.zIndex &&
        previous.placed === next.placed &&
        previous.active === next.active &&
        previous.snapped === next.snapped &&
        previous.snapPulseId === next.snapPulseId &&
        previous.readOnly === next.readOnly &&
        previous.source === next.source &&
        previous.pieceCenterX === next.pieceCenterX &&
        previous.pieceCenterY === next.pieceCenterY &&
        previous.bounds === next.bounds &&
        previous.mask === next.mask &&
        previous.onPointerDown === next.onPointerDown
    );
}

function SolvedImageCanvas({source, offset}: {source: HTMLCanvasElement; offset: Coord}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const backingScale = canvasBackingScale();
    const backingWidth = Math.max(1, Math.round(source.width * backingScale));
    const backingHeight = Math.max(1, Math.round(source.height * backingScale));

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = backingWidth;
        canvas.height = backingHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, source.width, source.height, 0, 0, canvas.width, canvas.height);
    }, [backingHeight, backingWidth, source]);
    return (
        <canvas
            ref={canvasRef}
            className="jigsawSolvedImage"
            width={backingWidth}
            height={backingHeight}
            style={{left: offset.x, top: offset.y, width: source.width, height: source.height}}
            aria-hidden="true"
        />
    );
}

function PieceCanvas({
    source,
    pieceCenter,
    bounds,
    mask,
    className = 'jigsawPieceCanvas',
}: {
    source: HTMLCanvasElement;
    pieceCenter: Coord;
    bounds: PieceBounds;
    mask: PathSegment[];
    className?: string;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const backingScale = canvasBackingScale();
    const logicalWidth = Math.max(1, Math.round(bounds.width));
    const logicalHeight = Math.max(1, Math.round(bounds.height));
    const backingWidth = Math.max(1, Math.round(bounds.width * backingScale));
    const backingHeight = Math.max(1, Math.round(bounds.height * backingScale));

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = backingWidth;
        canvas.height = backingHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.scale(backingScale, backingScale);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.save();
        drawMaskPath(context, mask, bounds);
        context.clip();
        const sourceX = pieceCenter.x + bounds.left;
        const sourceY = pieceCenter.y + bounds.top;
        drawWrappedImageRegion(context, source, sourceX, sourceY, bounds.width, bounds.height);
        context.restore();

    }, [backingHeight, backingScale, backingWidth, bounds, mask, pieceCenter.x, pieceCenter.y, source]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            width={backingWidth}
            height={backingHeight}
            style={{width: logicalWidth, height: logicalHeight}}
            aria-hidden="true"
        />
    );
}

function canvasBackingScale() {
    if (typeof window === 'undefined') return 1;
    return Math.max(1, Math.min(maxCanvasBackingScale, Math.ceil(window.devicePixelRatio * maxZoom)));
}

function drawWrappedImageRegion(
    context: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    sourceX: number,
    sourceY: number,
    width: number,
    height: number,
) {
    if (source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) return;

    let drawnX = 0;
    while (drawnX < width - 1e-6) {
        const tileX = positiveModulo(sourceX + drawnX, source.width);
        const chunkWidth = Math.min(width - drawnX, source.width - tileX);
        let drawnY = 0;
        while (drawnY < height - 1e-6) {
            const tileY = positiveModulo(sourceY + drawnY, source.height);
            const chunkHeight = Math.min(height - drawnY, source.height - tileY);
            context.drawImage(
                source,
                tileX,
                tileY,
                chunkWidth,
                chunkHeight,
                drawnX,
                drawnY,
                chunkWidth,
                chunkHeight,
            );
            drawnY += chunkHeight;
        }
        drawnX += chunkWidth;
    }
}

function useJigsawSourceCanvas(board: JigsawBoardArtifact) {
    const stockSource = useMemo(() => createStockHueCanvas(board.imageSize), [board.imageSize]);
    const [artifactSource, setArtifactSource] = useState<HTMLCanvasElement | null>(null);
    const imageArtifact = board.image === 'artifact:image' ? currentJigsawImage() : null;
    const imageDataUrl = imageArtifact?.dataUrl;

    useEffect(() => {
        if (board.image !== 'artifact:image' || !imageDataUrl) {
            setArtifactSource(null);
            return;
        }
        let cancelled = false;
        void canvasFromImageDataUrl(imageDataUrl, board.imageSize).then(
            (canvas) => {
                if (!cancelled) setArtifactSource(canvas);
            },
            () => {
                if (!cancelled) setArtifactSource(null);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [board.image, board.imageSize, imageDataUrl]);

    return board.image === 'artifact:image' ? artifactSource ?? stockSource : stockSource;
}

function canvasFromImageDataUrl(
    dataUrl: string,
    size: {width: number; height: number},
): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('Could not render jigsaw image.'));
                return;
            }
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, size.width, size.height);
            resolve(canvas);
        };
        image.onerror = () => reject(new Error('Could not load jigsaw image.'));
        image.src = dataUrl;
    });
}

function createStockHueCanvas(size: {width: number; height: number}) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    const image = context.createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y++) {
        const lightness = 30 + (y / Math.max(1, size.height - 1)) * 40;
        for (let x = 0; x < size.width; x++) {
            const hue = (x / Math.max(1, size.width - 1)) * 360;
            const [r, g, b] = hslToRgb(hue, 78, lightness);
            const offset = (y * size.width + x) * 4;
            image.data[offset] = r;
            image.data[offset + 1] = g;
            image.data[offset + 2] = b;
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    return canvas;
}

function drawMaskPath(
    context: CanvasRenderingContext2D,
    mask: PathSegment[],
    bounds: PieceBounds,
) {
    context.beginPath();
    const [first, ...rest] = mask;
    if (!first) {
        context.rect(0, 0, bounds.width, bounds.height);
        return;
    }
    context.moveTo(first.to.x - bounds.left, first.to.y - bounds.top);
    for (const segment of rest) {
        if (segment.type === 'Quadratic') {
            context.quadraticCurveTo(
                segment.control.x - bounds.left,
                segment.control.y - bounds.top,
                segment.to.x - bounds.left,
                segment.to.y - bounds.top,
            );
        } else if (segment.type === 'Cubic') {
            context.bezierCurveTo(
                segment.control1.x - bounds.left,
                segment.control1.y - bounds.top,
                segment.control2.x - bounds.left,
                segment.control2.y - bounds.top,
                segment.to.x - bounds.left,
                segment.to.y - bounds.top,
            );
        } else {
            context.lineTo(segment.to.x - bounds.left, segment.to.y - bounds.top);
        }
    }
    context.closePath();
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
    const h = (((hue % 360) + 360) % 360) / 360;
    const s = saturation / 100;
    const l = lightness / 100;
    if (s === 0) {
        const value = Math.round(l * 255);
        return [value, value, value] as const;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
        Math.round(hueToRgb(p, q, h) * 255),
        Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    ] as const;
}

function hueToRgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function releasePointerCapture(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
}

function eventTargetIsInTorusViewport(target: EventTarget | null) {
    return typeof Element !== 'undefined' && target instanceof Element
        ? Boolean(target.closest('.jigsawTorusViewport'))
        : false;
}

function torusPanCoord(pan: TorusViewport): Coord {
    return {x: pan.panX, y: pan.panY};
}

function positionsForDrag(drag: DragState, pointer = drag.currentPointer) {
    const result = new Map<number, Coord>();
    const anchorPosition = subtract(pointer, drag.pointerOffset);
    for (const [piece, offset] of drag.pieceOffsets) {
        result.set(piece, add(anchorPosition, offset));
    }
    return result;
}

function positionsForSnap(
    layout: ReturnType<typeof buildPuzzleLayout>,
    localPositions: Map<number, Coord>,
    space: ComponentPlacementSpace,
) {
    const result = new Map<number, Coord>();
    if (space === 'plane') {
        for (const [piece, position] of localPositions) result.set(piece, position);
        for (const [piece, position] of layout.positions) result.set(piece, position);
        return result;
    }
    if (space === 'outer') {
        for (const [piece, position] of localPositions) result.set(piece, position);
    }
    for (const [piece, position] of layout.positions) {
        if (layout.pieceSpaces.get(piece) === space) result.set(piece, position);
    }
    return result;
}

function torusImageTiles(
    pan: TorusViewport,
    imageSize: {width: number; height: number},
): Coord[] {
    const base = {
        x: positiveModulo(pan.panX, imageSize.width),
        y: positiveModulo(pan.panY, imageSize.height),
    };
    return [
        {x: base.x - imageSize.width, y: base.y - imageSize.height},
        {x: base.x, y: base.y - imageSize.height},
        {x: base.x + imageSize.width, y: base.y - imageSize.height},
        {x: base.x - imageSize.width, y: base.y},
        {x: base.x, y: base.y},
        {x: base.x + imageSize.width, y: base.y},
        {x: base.x - imageSize.width, y: base.y + imageSize.height},
        {x: base.x, y: base.y + imageSize.height},
        {x: base.x + imageSize.width, y: base.y + imageSize.height},
    ];
}

function boardSpaceFor(
    imageSize: {width: number; height: number},
    pieceSize: {width: number; height: number},
) {
    const padding = Math.max(pieceSize.width, pieceSize.height) * 1.45;
    const imageOffset = {x: padding, y: padding};
    const boardSpace: JigsawBoardSpace = {
        width: imageSize.width + padding * 2,
        height: imageSize.height + padding * 2,
    };
    return {boardSpace, imageOffset};
}

function arrangeLocalUnplacedPieces(
    board: JigsawBoardArtifact,
    pieces: number[],
    seed: number,
) {
    const arranged = arrangeUnplacedPieces(board, pieces, board.imageSize, seed);
    const result = new Map<number, Coord>();
    for (const [piece, position] of arranged) {
        result.set(piece, position);
    }
    return result;
}

function imageToCanvas(point: Coord, imageOffset: Coord) {
    return add(point, imageOffset);
}

function canvasToImage(point: Coord, imageOffset: Coord) {
    return subtract(point, imageOffset);
}

function screenToCanvas(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    viewport: JigsawViewport,
) {
    return {
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
