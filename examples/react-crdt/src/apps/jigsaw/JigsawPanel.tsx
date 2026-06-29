import {
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
import type {Coord, JigsawEphemeralData, JigsawState} from './model';
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
                <div className="jigsawSolvedImage" aria-hidden="true" />
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
                                    '--piece-hue-start': (piece.center.x / board.imageSize.width) * 360,
                                    '--piece-hue-end':
                                        ((piece.center.x + pieceSize.width / 2) / board.imageSize.width) * 360,
                                    '--piece-light-start':
                                        30 + (piece.center.y / board.imageSize.height) * 40,
                                    '--piece-light-end':
                                        30 +
                                        ((piece.center.y + pieceSize.height / 2) / board.imageSize.height) * 40,
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
                        />
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
