import {
    artifactFingerprintHash,
    type ArtifactManifestEntry,
    type ArtifactStore,
    type SerializedArtifact,
} from '../../lib/artifacts';
import {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_IMAGE_SIZE,
    generateJigsawBoard as generateCoreJigsawBoard,
    gridForPieceCount,
    isJigsawPieceCount,
    isJigsawSurface,
    surfaceForBoard,
    type Coord,
    type JigsawBoard,
    type JigsawBoardOptions as CoreJigsawBoardOptions,
    type JigsawGenerationType,
    type JigsawPiece,
    type JigsawPieceCount,
    type JigsawSurface,
    type PathSegment,
    type PieceBounds,
} from '../../../../../src/jigsaw/index';

export type JigsawImageRef = 'stock:hue' | typeof JIGSAW_ARTIFACT_IMAGE_REF;

export type JigsawBoardOptions = CoreJigsawBoardOptions & {
    image?: JigsawImageRef;
    imageName?: string;
};

export type JigsawBoardArtifact = Omit<JigsawBoard, 'grid'> & {
    id: typeof JIGSAW_BOARD_ARTIFACT_ID;
    title: string;
    image: JigsawImageRef;
    pieceCount: JigsawPieceCount;
};

export type JigsawImageArtifact = {
    id: typeof JIGSAW_IMAGE_ARTIFACT_ID;
    mimeType: JigsawImageMimeType;
    dataUrl: string;
    width: number;
    height: number;
    originalName?: string;
};

export type JigsawImageMimeType = 'image/jpeg' | 'image/webp';

export {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_IMAGE_SIZE,
    gridForPieceCount,
    isJigsawPieceCount,
    isJigsawSurface,
    surfaceForBoard,
    type Coord,
    type JigsawGenerationType,
    type JigsawPiece,
    type JigsawPieceCount,
    type JigsawSurface,
    type PathSegment,
    type PieceBounds,
};

export const JIGSAW_BOARD_ARTIFACT_ID = 'board';
export const JIGSAW_BOARD_KIND = 'jigsaw-board';
export const JIGSAW_BOARD_VERSION = 1;
export const JIGSAW_IMAGE_ARTIFACT_ID = 'image';
export const JIGSAW_IMAGE_KIND = 'jigsaw-image';
export const JIGSAW_IMAGE_VERSION = 1;
export const JIGSAW_ARTIFACT_IMAGE_REF = 'artifact:image';

let loadedBoard = generateJigsawBoard(DEFAULT_JIGSAW_PIECE_COUNT);
let loadedImage: JigsawImageArtifact | null = null;

export const jigsawArtifactStore: ArtifactStore<JigsawBoardArtifact | JigsawImageArtifact> = {
    get(id) {
        if (id === JIGSAW_BOARD_ARTIFACT_ID) return loadedBoard;
        if (id === JIGSAW_IMAGE_ARTIFACT_ID) return loadedImage;
        return null;
    },
    serialize(id) {
        if (id === JIGSAW_BOARD_ARTIFACT_ID) return serializeBoard(loadedBoard);
        if (id === JIGSAW_IMAGE_ARTIFACT_ID && loadedImage) return serializeImage(loadedImage);
        return null;
    },
    load(artifact) {
        if (
            artifact.id === JIGSAW_BOARD_ARTIFACT_ID &&
            artifact.kind === JIGSAW_BOARD_KIND &&
            artifact.version === JIGSAW_BOARD_VERSION
        ) {
            const board = normalizeJigsawBoardArtifact(artifact.data);
            if (!board) return;
            if (
                artifact.fingerprintHash !== artifactFingerprintHash(artifact.data) &&
                artifact.fingerprintHash !== artifactFingerprintHash(board)
            ) {
                return;
            }
            loadedBoard = board;
            loadedImage = null;
            return;
        }

        if (
            artifact.id === JIGSAW_IMAGE_ARTIFACT_ID &&
            artifact.kind === JIGSAW_IMAGE_KIND &&
            artifact.version === JIGSAW_IMAGE_VERSION
        ) {
            const image = normalizeJigsawImageArtifact(artifact.data);
            if (!image) return;
            if (
                artifact.fingerprintHash !== artifactFingerprintHash(artifact.data) &&
                artifact.fingerprintHash !== artifactFingerprintHash(image)
            ) {
                return;
            }
            loadedImage = image;
        }
    },
    manifest() {
        return loadedImage
            ? [manifestForBoard(loadedBoard), manifestForImage(loadedImage)]
            : [manifestForBoard(loadedBoard)];
    },
    createInitial() {
        loadedBoard = generateJigsawBoard(DEFAULT_JIGSAW_PIECE_COUNT);
        loadedImage = null;
        return [serializeBoard(loadedBoard)];
    },
};

export function currentJigsawBoard() {
    return loadedBoard;
}

export function currentJigsawImage() {
    return loadedImage;
}

export function generateJigsawBoard(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions = {},
): JigsawBoardArtifact {
    const {image: _image, imageName: _imageName, ...coreOptions} = options;
    return boardArtifactFromCore(generateCoreJigsawBoard(pieceCount, coreOptions), options);
}

export function initialJigsawArtifacts(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions & {imageArtifact?: JigsawImageArtifact} = {},
): SerializedArtifact[] {
    const boardOptions: JigsawBoardOptions = options.imageArtifact
        ? {
              ...options,
              image: JIGSAW_ARTIFACT_IMAGE_REF,
              imageSize: {width: options.imageArtifact.width, height: options.imageArtifact.height},
              imageName: options.imageArtifact.originalName,
          }
        : options;
    const board = generateJigsawBoard(pieceCount, boardOptions);
    loadedBoard = board;
    loadedImage = options.imageArtifact ?? null;
    return loadedImage
        ? [serializeBoard(board), serializeImage(loadedImage)]
        : [serializeBoard(board)];
}

function boardArtifactFromCore(
    board: JigsawBoard,
    options: JigsawBoardOptions = {},
): JigsawBoardArtifact {
    const {grid: _grid, ...artifactBoard} = board;
    return {
        id: JIGSAW_BOARD_ARTIFACT_ID,
        title: jigsawBoardTitle(board.pieceCount, options),
        image: options.image ?? 'stock:hue',
        ...artifactBoard,
        pieceCount: board.pieceCount as JigsawPieceCount,
    };
}

function serializeBoard(board: JigsawBoardArtifact): SerializedArtifact {
    return {
        ...manifestForBoard(board),
        data: board,
    };
}

function serializeImage(image: JigsawImageArtifact): SerializedArtifact {
    return {
        ...manifestForImage(image),
        data: image,
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

function manifestForImage(image: JigsawImageArtifact): ArtifactManifestEntry {
    return {
        id: image.id,
        kind: JIGSAW_IMAGE_KIND,
        version: JIGSAW_IMAGE_VERSION,
        fingerprintHash: artifactFingerprintHash(image),
    };
}

function jigsawBoardTitle(pieceCount: number, options: JigsawBoardOptions) {
    const tabs = options.tabs ? 'tabbed ' : '';
    const surface = options.surface === 'torus' ? 'torus ' : '';
    const shape = options.type === 'voronoi' ? 'Voronoi ' : '';
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF && options.imageName) {
        return `${pieceCount} piece ${tabs}${surface}${shape}${options.imageName} puzzle`;
    }
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF) {
        return `${pieceCount} piece ${tabs}${surface}${shape}image puzzle`;
    }
    return `${pieceCount} piece ${tabs}${surface}${shape}hue puzzle`;
}

function normalizeJigsawBoardArtifact(input: unknown): JigsawBoardArtifact | null {
    if (!isRecord(input)) return null;
    const pieces = input.pieces;
    if (
        input.id === JIGSAW_BOARD_ARTIFACT_ID &&
        typeof input.title === 'string' &&
        isJigsawImageRef(input.image) &&
        isImageSize(input.imageSize) &&
        isJigsawPieceCount(input.pieceCount) &&
        (input.surface === undefined || isJigsawSurface(input.surface)) &&
        Array.isArray(pieces) &&
        pieces.length === input.pieceCount &&
        pieces.every((piece, index) => isJigsawPieceLike(piece, pieces.length, index))
    ) {
        const pieceCount = input.pieceCount;
        return {
            id: input.id,
            title: input.title,
            image: input.image,
            imageSize: input.imageSize,
            pieceCount,
            ...(input.surface === 'torus' ? {surface: input.surface} : {}),
            pieces: pieces.map((piece, index) => normalizeJigsawPiece(piece, pieceCount, index)),
        };
    }
    return null;
}

function normalizeJigsawImageArtifact(input: unknown): JigsawImageArtifact | null {
    if (!isJigsawImageArtifact(input)) return null;
    return {
        id: input.id,
        mimeType: input.mimeType,
        dataUrl: input.dataUrl,
        width: input.width,
        height: input.height,
        ...(input.originalName ? {originalName: input.originalName} : {}),
    };
}

export function isJigsawImageArtifact(input: unknown): input is JigsawImageArtifact {
    return (
        isRecord(input) &&
        input.id === JIGSAW_IMAGE_ARTIFACT_ID &&
        isJigsawImageMimeType(input.mimeType) &&
        typeof input.dataUrl === 'string' &&
        input.dataUrl.startsWith(`data:${input.mimeType};base64,`) &&
        typeof input.width === 'number' &&
        Number.isFinite(input.width) &&
        input.width > 0 &&
        typeof input.height === 'number' &&
        Number.isFinite(input.height) &&
        input.height > 0 &&
        (input.originalName === undefined || typeof input.originalName === 'string')
    );
}

function isJigsawImageRef(input: unknown): input is JigsawImageRef {
    return input === 'stock:hue' || input === JIGSAW_ARTIFACT_IMAGE_REF;
}

function isJigsawImageMimeType(input: unknown): input is JigsawImageMimeType {
    return input === 'image/jpeg' || input === 'image/webp';
}

function isJigsawPieceLike(input: unknown, pieceCount: number, index: number) {
    return (
        isRecord(input) &&
        isCoord(input.center) &&
        (input.bounds === undefined || isBounds(input.bounds)) &&
        Array.isArray(input.mask) &&
        input.mask.every(isPathSegment) &&
        Array.isArray(input.neighbors) &&
        input.neighbors.every((neighbor) => isNeighbor(neighbor, pieceCount, index))
    );
}

function normalizeJigsawPiece(
    input: unknown,
    pieceCount: JigsawPieceCount,
    index: number,
): JigsawPiece {
    const piece = input as Omit<JigsawPiece, 'bounds'> & {bounds?: PieceBounds};
    return {
        center: piece.center,
        bounds: piece.bounds ?? legacyRectangularBounds(pieceCount, index),
        mask: piece.mask,
        neighbors: piece.neighbors,
    };
}

function legacyRectangularBounds(pieceCount: JigsawPieceCount, index: number) {
    const grid = gridForPieceCount(pieceCount);
    const width = JIGSAW_IMAGE_SIZE.width / grid.cols;
    const height = JIGSAW_IMAGE_SIZE.height / grid.rows;
    const row = Math.floor(index / grid.cols);
    const col = index % grid.cols;
    const center = {
        x: (col + 0.5) * width,
        y: (row + 0.5) * height,
    };
    return {
        left: col * width - center.x,
        top: row * height - center.y,
        width,
        height,
    };
}

function isBounds(input: unknown): input is PieceBounds {
    return (
        isRecord(input) &&
        typeof input.left === 'number' &&
        Number.isFinite(input.left) &&
        typeof input.top === 'number' &&
        Number.isFinite(input.top) &&
        typeof input.width === 'number' &&
        Number.isFinite(input.width) &&
        input.width > 0 &&
        typeof input.height === 'number' &&
        Number.isFinite(input.height) &&
        input.height > 0
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
    if (input.type === 'Cubic')
        return isCoord(input.control1) && isCoord(input.control2) && isCoord(input.to);
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
