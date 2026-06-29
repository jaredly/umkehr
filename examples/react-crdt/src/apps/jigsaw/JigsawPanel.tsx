import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent,
} from 'react';
import {useValue} from 'umkehr/react';
import {compareTimestamps, type HlcTimestamp} from 'umkehr/crdt';
import type {AppEditorContext, CrdtEditorContext, GridSlot} from '../../lib/crdtApp';
import {currentJigsawBoard} from './artifacts';
import type {Coord, JigsawEphemeralData, JigsawState, PathSegment} from './model';
import {
    add,
    arrangeUnplacedPieces,
    buildPuzzleLayout,
    connectionPatch,
    estimatedPieceSize,
    pieceKey,
    positionPatch,
    snapCandidates,
    snapThreshold,
    subtract,
    unplacedPieces,
    validConnections,
} from './jigsaw';

type DragState = {
    pointerId: number;
    component: number[];
    anchor: number;
    startPointer: Coord;
    initialPositions: Map<number, Coord>;
    delta: Coord;
};

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
    const sourceImage = useMemo(() => createStockHueCanvas(board.imageSize), [board.imageSize]);
    const state = useMemo(() => ({positions, connections}), [connections, positions]);
    const layout = useMemo(() => buildPuzzleLayout(board, state), [board, state]);
    const pieceSize = useMemo(() => estimatedPieceSize(board), [board]);
    const threshold = useMemo(() => snapThreshold(board), [board]);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const [shuffleSeed, setShuffleSeed] = useState(1);
    const [drag, setDrag] = useState<DragState | null>(null);
    const anchorVersions = useAnchorVersions(editor, board.pieces.length);
    const unplaced = useMemo(() => unplacedPieces(board, layout), [board, layout]);
    const localPositions = useMemo(
        () => arrangeUnplacedPieces(board, unplaced, board.imageSize, shuffleSeed),
        [board, shuffleSeed, unplaced],
    );
    const renderedPositions = useMemo(() => {
        const result = new Map<number, Coord>(localPositions);
        for (const [piece, position] of layout.positions) result.set(piece, position);
        if (drag) {
            for (const [piece, position] of drag.initialPositions) {
                result.set(piece, add(position, drag.delta));
            }
        }
        return result;
    }, [drag, layout.positions, localPositions]);
    const activeComponent = useMemo(() => new Set(drag?.component ?? []), [drag]);
    const totalConnections = board.pieces.reduce((sum, piece) => sum + piece.neighbors.length, 0) / 2;
    const solvedConnections = validConnections(board, connections).length;

    const startDrag = (piece: number, event: PointerEvent<HTMLButtonElement>) => {
        if (readOnly) return;
        const pointer = pointerToBoard(event);
        if (!pointer) return;
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
        stageRef.current?.setPointerCapture(event.pointerId);
        setDrag({
            pointerId: event.pointerId,
            component,
            anchor,
            startPointer: pointer,
            initialPositions,
            delta: {x: 0, y: 0},
        });
    };

    const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const pointer = pointerToBoard(event);
        if (!pointer) return;
        setDrag({...drag, delta: subtract(pointer, drag.startPointer)});
    };

    const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        releasePointerCapture(event);
        const latest = editor.latest();
        const latestLayout = buildPuzzleLayout(board, latest);
        const draggedPieces = new Set(drag.component);
        const draggedPositions = new Map<number, Coord>();
        for (const [piece, position] of drag.initialPositions) {
            draggedPositions.set(piece, add(position, drag.delta));
        }
        const anchorPosition = draggedPositions.get(drag.anchor);
        if (!anchorPosition) {
            setDrag(null);
            return;
        }

        const allPositions = new Map<number, Coord>(localPositions);
        for (const [piece, position] of latestLayout.positions) allPositions.set(piece, position);
        for (const [piece, position] of draggedPositions) allPositions.set(piece, position);
        const candidates = snapCandidates({
            board,
            layout: latestLayout,
            draggedPieces,
            draggedPositions,
            allPositions,
            snapThreshold: threshold,
        });
        const patches = [
            positionPatch(latest, drag.anchor, anchorPosition),
            ...candidates
                .filter((candidate) => latest.connections[candidate.key] === undefined)
                .map(connectionPatch),
        ];
        editor.dispatch(patches);
        setDrag(null);
    };

    const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
        releasePointerCapture(event);
        setDrag(null);
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
                    <button type="button" onClick={() => setShuffleSeed((seed) => seed + 1)}>
                        Reshuffle
                    </button>
                    <button type="button" onClick={() => editor.undo()} disabled={readOnly || !editor.canUndo()}>
                        Undo
                    </button>
                    <button type="button" onClick={() => editor.redo()} disabled={readOnly || !editor.canRedo()}>
                        Redo
                    </button>
                </div>
            </header>

            <div
                ref={stageRef}
                className="jigsawStage"
                style={
                    {
                        '--jigsaw-width': board.imageSize.width,
                        '--jigsaw-height': board.imageSize.height,
                    } as CSSProperties
                }
                onPointerMove={updateDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
            >
                <SolvedImageCanvas source={sourceImage} />
                {board.pieces.map((piece, index) => {
                    const position = renderedPositions.get(index);
                    if (!position) return null;
                    const componentIndex = layout.pieceToComponent.get(index);
                    const component = componentIndex === undefined ? [index] : layout.components[componentIndex] ?? [index];
                    const anchor =
                        componentIndex === undefined ? undefined : layout.anchors.get(componentIndex);
                    const placed = layout.positions.has(index);
                    const active = activeComponent.has(index);
                    return (
                        <button
                            key={index}
                            type="button"
                            className={`jigsawPiece ${placed ? 'placed' : 'unplaced'} ${active ? 'dragging' : ''}`}
                            disabled={readOnly}
                            onPointerDown={(event) => startDrag(index, event)}
                            style={
                                {
                                    '--piece-left': position.x - pieceSize.width / 2,
                                    '--piece-top': position.y - pieceSize.height / 2,
                                    '--piece-width': pieceSize.width,
                                    '--piece-height': pieceSize.height,
                                    '--piece-z': pieceZIndex({
                                        piece: index,
                                        component,
                                        anchor,
                                        placed,
                                        active,
                                    }),
                                } as CSSProperties
                            }
                            aria-label={`Piece ${index + 1}`}
                        >
                            <PieceCanvas
                                source={sourceImage}
                                pieceCenter={piece.center}
                                mask={piece.mask}
                                pieceSize={pieceSize}
                            />
                        </button>
                    );
                })}
            </div>
        </section>
    );

    function pointerToBoard(event: PointerEvent<HTMLElement>): Coord | null {
        const stage = stageRef.current;
        if (!stage) return null;
        const rect = stage.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: ((event.clientX - rect.left) / rect.width) * board.imageSize.width,
            y: ((event.clientY - rect.top) / rect.height) * board.imageSize.height,
        };
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
        const version = anchor === undefined ? undefined : anchorVersions.get(anchor);
        const versionRank = version ? timestampRank(version, anchorVersions) : 0;
        return base + versionRank * 10 + Math.max(...component, piece);
    }
}

function SolvedImageCanvas({source}: {source: HTMLCanvasElement}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0);
    }, [source]);
    return (
        <canvas
            ref={canvasRef}
            className="jigsawSolvedImage"
            width={source.width}
            height={source.height}
            aria-hidden="true"
        />
    );
}

function PieceCanvas({
    source,
    pieceCenter,
    mask,
    pieceSize,
}: {
    source: HTMLCanvasElement;
    pieceCenter: Coord;
    mask: PathSegment[];
    pieceSize: {width: number; height: number};
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.round(pieceSize.width));
        canvas.height = Math.max(1, Math.round(pieceSize.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        drawMaskPath(context, mask, pieceSize);
        context.clip();
        const sourceX = pieceCenter.x - pieceSize.width / 2;
        const sourceY = pieceCenter.y - pieceSize.height / 2;
        context.drawImage(
            source,
            sourceX,
            sourceY,
            pieceSize.width,
            pieceSize.height,
            0,
            0,
            canvas.width,
            canvas.height,
        );
        context.restore();
    }, [mask, pieceCenter.x, pieceCenter.y, pieceSize, source]);

    return (
        <canvas
            ref={canvasRef}
            className="jigsawPieceCanvas"
            width={Math.max(1, Math.round(pieceSize.width))}
            height={Math.max(1, Math.round(pieceSize.height))}
            aria-hidden="true"
        />
    );
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
    pieceSize: {width: number; height: number},
) {
    context.beginPath();
    const [first, ...rest] = mask;
    if (!first) {
        context.rect(0, 0, pieceSize.width, pieceSize.height);
        return;
    }
    context.moveTo(first.to.x + pieceSize.width / 2, first.to.y + pieceSize.height / 2);
    for (const segment of rest) {
        if (segment.type === 'Quadratic') {
            context.quadraticCurveTo(
                segment.control.x + pieceSize.width / 2,
                segment.control.y + pieceSize.height / 2,
                segment.to.x + pieceSize.width / 2,
                segment.to.y + pieceSize.height / 2,
            );
        } else if (segment.type === 'Cubic') {
            context.bezierCurveTo(
                segment.control1.x + pieceSize.width / 2,
                segment.control1.y + pieceSize.height / 2,
                segment.control2.x + pieceSize.width / 2,
                segment.control2.y + pieceSize.height / 2,
                segment.to.x + pieceSize.width / 2,
                segment.to.y + pieceSize.height / 2,
            );
        } else {
            context.lineTo(segment.to.x + pieceSize.width / 2, segment.to.y + pieceSize.height / 2);
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

function useAnchorVersions(
    editor: AppEditorContext<JigsawState, 'type', JigsawEphemeralData>,
    pieceCount: number,
) {
    const versions = new Map<number, HlcTimestamp>();
    if (!hasPathScopedCrdtMeta(editor)) return versions;
    for (let piece = 0; piece < pieceCount; piece++) {
        const meta = editor.useCrdtMeta(editor.$.positions[pieceKey(piece)] as any);
        const version = versionOfMeta(meta);
        if (version) versions.set(piece, version);
    }
    return versions;
}

function hasPathScopedCrdtMeta(
    editor: AppEditorContext<JigsawState, 'type', JigsawEphemeralData>,
): editor is CrdtEditorContext<JigsawState, 'type', JigsawEphemeralData> {
    return 'useCrdtMeta' in editor && typeof editor.useCrdtMeta === 'function';
}

function versionOfMeta(meta: unknown): HlcTimestamp | undefined {
    if (!meta || typeof meta !== 'object' || !('kind' in meta)) return undefined;
    if (meta.kind === 'primitive' && 'ts' in meta && typeof meta.ts === 'string') return meta.ts;
    if ('created' in meta && typeof meta.created === 'string') return meta.created;
    if (meta.kind === 'tombstone' && 'deleted' in meta && typeof meta.deleted === 'string') return meta.deleted;
    return undefined;
}

function timestampRank(version: HlcTimestamp, versions: Map<number, HlcTimestamp>) {
    const sorted = Array.from(new Set(versions.values())).sort(compareTimestamps);
    return sorted.findIndex((candidate) => candidate === version) + 1;
}
