import {
    artifactFingerprintHash,
    type ArtifactManifestEntry,
    type ArtifactStore,
    type SerializedArtifact,
} from '../../lib/artifacts';
import type {Coord} from './schema';

export type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};

export type JigsawPieceCount = 12 | 30 | 60 | 120;

export type JigsawPiece = {
    center: Coord;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: 'stock:hue';
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    pieces: JigsawPiece[];
};

export const JIGSAW_BOARD_ARTIFACT_ID = 'board';
export const JIGSAW_BOARD_KIND = 'jigsaw-board';
export const JIGSAW_BOARD_VERSION = 1;
export const DEFAULT_JIGSAW_PIECE_COUNT: JigsawPieceCount = 12;
export const JIGSAW_IMAGE_SIZE = {width: 720, height: 540} as const;

let loadedBoard = generateJigsawBoard(DEFAULT_JIGSAW_PIECE_COUNT);

export const jigsawArtifactStore: ArtifactStore<JigsawBoardArtifact> = {
    get(id) {
        return id === JIGSAW_BOARD_ARTIFACT_ID ? loadedBoard : null;
    },
    serialize(id) {
        if (id !== JIGSAW_BOARD_ARTIFACT_ID) return null;
        return serializeBoard(loadedBoard);
    },
    load(artifact) {
        if (
            artifact.id !== JIGSAW_BOARD_ARTIFACT_ID ||
            artifact.kind !== JIGSAW_BOARD_KIND ||
            artifact.version !== JIGSAW_BOARD_VERSION ||
            !isJigsawBoardArtifact(artifact.data)
        ) {
            return;
        }
        const next = artifact.data;
        if (artifact.fingerprintHash !== artifactFingerprintHash(next)) return;
        loadedBoard = next;
    },
    manifest() {
        return [manifestForBoard(loadedBoard)];
    },
    createInitial() {
        loadedBoard = generateJigsawBoard(DEFAULT_JIGSAW_PIECE_COUNT);
        return [serializeBoard(loadedBoard)];
    },
};

export function currentJigsawBoard() {
    return loadedBoard;
}

export function generateJigsawBoard(pieceCount: JigsawPieceCount): JigsawBoardArtifact {
    const grid = gridForPieceCount(pieceCount);
    const pieceWidth = JIGSAW_IMAGE_SIZE.width / grid.cols;
    const pieceHeight = JIGSAW_IMAGE_SIZE.height / grid.rows;
    const pieces: JigsawPiece[] = [];

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const index = row * grid.cols + col;
            const center = {
                x: (col + 0.5) * pieceWidth,
                y: (row + 0.5) * pieceHeight,
            };
            pieces.push({
                center,
                mask: rectangleMask(pieceWidth, pieceHeight),
                neighbors: neighborIndexes({row, col, cols: grid.cols, rows: grid.rows}).map(
                    (neighbor) => {
                        const neighborCenter = {
                            x: (neighbor.col + 0.5) * pieceWidth,
                            y: (neighbor.row + 0.5) * pieceHeight,
                        };
                        return {
                            piece: neighbor.row * grid.cols + neighbor.col,
                            offset: subtract(neighborCenter, center),
                        };
                    },
                ),
            });
            if (pieces.length !== index + 1) throw new Error('Unexpected jigsaw piece order.');
        }
    }

    return {
        id: JIGSAW_BOARD_ARTIFACT_ID,
        title: `${pieceCount} piece hue puzzle`,
        image: 'stock:hue',
        imageSize: {...JIGSAW_IMAGE_SIZE},
        pieceCount,
        pieces,
    };
}

export function gridForPieceCount(pieceCount: JigsawPieceCount) {
    switch (pieceCount) {
        case 12:
            return {cols: 4, rows: 3};
        case 30:
            return {cols: 6, rows: 5};
        case 60:
            return {cols: 10, rows: 6};
        case 120:
            return {cols: 15, rows: 8};
    }
}

function serializeBoard(board: JigsawBoardArtifact): SerializedArtifact {
    return {
        ...manifestForBoard(board),
        data: board,
    };
}

function manifestForBoard(board: JigsawBoardArtifact): ArtifactManifestEntry {
    return {
        id: board.id,
        kind: JIGSAW_BOARD_KIND,
        version: JIGSAW_BOARD_VERSION,
        fingerprintHash: artifactFingerprintHash(board),
    };
}

function rectangleMask(width: number, height: number): PathSegment[] {
    const left = -width / 2;
    const right = width / 2;
    const top = -height / 2;
    const bottom = height / 2;
    return [
        {type: 'Line', to: {x: right, y: top}},
        {type: 'Line', to: {x: right, y: bottom}},
        {type: 'Line', to: {x: left, y: bottom}},
        {type: 'Line', to: {x: left, y: top}},
    ];
}

function neighborIndexes({
    row,
    col,
    cols,
    rows,
}: {
    row: number;
    col: number;
    cols: number;
    rows: number;
}) {
    return [
        {row: row - 1, col},
        {row, col: col + 1},
        {row: row + 1, col},
        {row, col: col - 1},
    ].filter((point) => point.row >= 0 && point.row < rows && point.col >= 0 && point.col < cols);
}

function subtract(a: Coord, b: Coord): Coord {
    return {x: a.x - b.x, y: a.y - b.y};
}

function isJigsawBoardArtifact(input: unknown): input is JigsawBoardArtifact {
    if (!isRecord(input)) return false;
    const pieces = input.pieces;
    return (
        input.id === JIGSAW_BOARD_ARTIFACT_ID &&
        typeof input.title === 'string' &&
        input.image === 'stock:hue' &&
        isImageSize(input.imageSize) &&
        isPieceCount(input.pieceCount) &&
        Array.isArray(pieces) &&
        pieces.length === input.pieceCount &&
        pieces.every((piece, index) => isJigsawPiece(piece, pieces.length, index))
    );
}

function isJigsawPiece(input: unknown, pieceCount: number, index: number): input is JigsawPiece {
    return (
        isRecord(input) &&
        isCoord(input.center) &&
        Array.isArray(input.mask) &&
        input.mask.every(isPathSegment) &&
        Array.isArray(input.neighbors) &&
        input.neighbors.every((neighbor) => isNeighbor(neighbor, pieceCount, index))
    );
}

function isNeighbor(input: unknown, pieceCount: number, index: number) {
    return (
        isRecord(input) &&
        typeof input.piece === 'number' &&
        Number.isInteger(input.piece) &&
        input.piece >= 0 &&
        input.piece < pieceCount &&
        input.piece !== index &&
        isCoord(input.offset)
    );
}

function isPathSegment(input: unknown): input is PathSegment {
    if (!isRecord(input)) return false;
    if (input.type === 'Line') return isCoord(input.to);
    if (input.type === 'Cubic') return isCoord(input.control1) && isCoord(input.control2) && isCoord(input.to);
    if (input.type === 'Quadratic') return isCoord(input.control) && isCoord(input.to);
    return false;
}

function isImageSize(input: unknown): input is JigsawBoardArtifact['imageSize'] {
    return (
        isRecord(input) &&
        typeof input.width === 'number' &&
        Number.isFinite(input.width) &&
        input.width > 0 &&
        typeof input.height === 'number' &&
        Number.isFinite(input.height) &&
        input.height > 0
    );
}

function isPieceCount(input: unknown): input is JigsawPieceCount {
    return input === 12 || input === 30 || input === 60 || input === 120;
}

function isCoord(input: unknown): input is Coord {
    return (
        isRecord(input) &&
        typeof input.x === 'number' &&
        Number.isFinite(input.x) &&
        typeof input.y === 'number' &&
        Number.isFinite(input.y)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
