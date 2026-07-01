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

export type JigsawPieceCount = 12 | 30 | 60 | 120 | 600 | 1000;
export type JigsawGenerationType = 'rectangular' | 'voronoi';
export type JigsawSurface = 'plane' | 'torus';

export type PieceBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};

export type JigsawPiece = {
    center: Coord;
    bounds: PieceBounds;
    mask: PathSegment[];
    neighbors: {piece: number; offset: Coord}[];
};

export type JigsawImageRef = 'stock:hue' | typeof JIGSAW_ARTIFACT_IMAGE_REF;

export type JigsawBoardArtifact = {
    id: string;
    title: string;
    image: JigsawImageRef;
    imageSize: {width: number; height: number};
    pieceCount: JigsawPieceCount;
    surface?: JigsawSurface;
    pieces: JigsawPiece[];
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

export type JigsawBoardOptions = {
    type?: JigsawGenerationType;
    surface?: JigsawSurface;
    tabs?: boolean;
    seed?: string | number;
    image?: JigsawImageRef;
    imageSize?: {width: number; height: number};
    imageName?: string;
};

type RandomSource = () => number;

type SharedEdge = {
    a: number;
    b: number;
    start: Coord;
    end: Coord;
    bStart?: Coord;
    bEnd?: Coord;
    wrap?: Coord;
};

type TabSpec = {
    edge: SharedEdge;
    center: Coord;
    radius: number;
    outwardPiece: number;
};

export const JIGSAW_BOARD_ARTIFACT_ID = 'board';
export const JIGSAW_BOARD_KIND = 'jigsaw-board';
export const JIGSAW_BOARD_VERSION = 1;
export const JIGSAW_IMAGE_ARTIFACT_ID = 'image';
export const JIGSAW_IMAGE_KIND = 'jigsaw-image';
export const JIGSAW_IMAGE_VERSION = 1;
export const JIGSAW_ARTIFACT_IMAGE_REF = 'artifact:image';
export const DEFAULT_JIGSAW_PIECE_COUNT: JigsawPieceCount = 12;
export const JIGSAW_IMAGE_SIZE = {width: 720, height: 540} as const;

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
            return;
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
    if (options.type === 'voronoi') return generateVoronoiJigsawBoard(pieceCount, options);
    return generateRectangularJigsawBoard(pieceCount, options);
}

function generateRectangularJigsawBoard(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions = {},
): JigsawBoardArtifact {
    const imageSize = normalizedGenerationImageSize(options.imageSize);
    const surface = surfaceForOptions(options);
    const grid = gridForPieceCount(pieceCount);
    const random = randomSource(options.seed);
    const pieceWidth = imageSize.width / grid.cols;
    const pieceHeight = imageSize.height / grid.rows;
    const polygons: Coord[][] = [];
    const centers: Coord[] = [];
    const sharedEdges: SharedEdge[] = [];

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const index = row * grid.cols + col;
            const center = {
                x: (col + 0.5) * pieceWidth,
                y: (row + 0.5) * pieceHeight,
            };
            centers.push(center);
            polygons.push([
                {x: col * pieceWidth, y: row * pieceHeight},
                {x: (col + 1) * pieceWidth, y: row * pieceHeight},
                {x: (col + 1) * pieceWidth, y: (row + 1) * pieceHeight},
                {x: col * pieceWidth, y: (row + 1) * pieceHeight},
            ]);
            if (polygons.length !== index + 1) throw new Error('Unexpected jigsaw piece order.');
            if (col < grid.cols - 1) {
                sharedEdges.push({
                    a: index,
                    b: index + 1,
                    start: {x: (col + 1) * pieceWidth, y: row * pieceHeight},
                    end: {x: (col + 1) * pieceWidth, y: (row + 1) * pieceHeight},
                });
            }
            if (row < grid.rows - 1) {
                sharedEdges.push({
                    a: index,
                    b: index + grid.cols,
                    start: {x: (col + 1) * pieceWidth, y: (row + 1) * pieceHeight},
                    end: {x: col * pieceWidth, y: (row + 1) * pieceHeight},
                });
            }
        }
    }
    if (surface === 'torus') {
        for (let row = 0; row < grid.rows; row++) {
            const left = row * grid.cols;
            const right = row * grid.cols + grid.cols - 1;
            sharedEdges.push({
                a: right,
                b: left,
                start: {x: imageSize.width, y: row * pieceHeight},
                end: {x: imageSize.width, y: (row + 1) * pieceHeight},
                bStart: {x: 0, y: row * pieceHeight},
                bEnd: {x: 0, y: (row + 1) * pieceHeight},
                wrap: {x: imageSize.width, y: 0},
            });
        }
        for (let col = 0; col < grid.cols; col++) {
            const top = col;
            const bottom = (grid.rows - 1) * grid.cols + col;
            sharedEdges.push({
                a: bottom,
                b: top,
                start: {x: (col + 1) * pieceWidth, y: imageSize.height},
                end: {x: col * pieceWidth, y: imageSize.height},
                bStart: {x: (col + 1) * pieceWidth, y: 0},
                bEnd: {x: col * pieceWidth, y: 0},
                wrap: {x: 0, y: imageSize.height},
            });
        }
    }

    const neighbors = neighborsFromSharedEdges(sharedEdges, centers, imageSize, surface);
    const pieces = piecesFromPolygons({
        polygons,
        centers,
        neighbors,
        sharedEdges,
        grid,
        imageSize,
        tabs: options.tabs === true,
        random,
    }).map((piece) =>
        options.tabs === true
            ? piece
            : {
                  ...piece,
                  bounds: rectangleBounds(pieceWidth, pieceHeight),
                  mask: rectangleMask(pieceWidth, pieceHeight),
              },
    );

    return {
        id: JIGSAW_BOARD_ARTIFACT_ID,
        title: jigsawBoardTitle(pieceCount, options, false),
        image: options.image ?? 'stock:hue',
        imageSize,
        pieceCount,
        ...(surface === 'torus' ? {surface} : {}),
        pieces,
    };
}

function generateVoronoiJigsawBoard(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions = {},
): JigsawBoardArtifact {
    const imageSize = normalizedGenerationImageSize(options.imageSize);
    const surface = surfaceForOptions(options);
    const grid = gridForPieceCount(pieceCount);
    const random = randomSource(options.seed);
    const cellWidth = imageSize.width / grid.cols;
    const cellHeight = imageSize.height / grid.rows;
    const sites: Coord[] = [];

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const center = {
                x: (col + 0.5) * cellWidth,
                y: (row + 0.5) * cellHeight,
            };
            const dx = signedPerturbation(cellWidth, random);
            const dy = signedPerturbation(cellHeight, random);
            sites.push({
                x: clamp(center.x + dx, 0.001, imageSize.width - 0.001),
                y: clamp(center.y + dy, 0.001, imageSize.height - 0.001),
            });
        }
    }

    const polygons =
        surface === 'torus'
            ? sites.map((site, index) => periodicVoronoiCell(site, index, sites, imageSize, grid))
            : sites.map((site, index) => voronoiCell(site, index, sites, imageSize, grid));
    const centers =
        surface === 'torus'
            ? sites
            : polygons.map((polygon) => centerOfBounds(boundsForPolygon(polygon)));
    const sharedEdges =
        surface === 'torus'
            ? sharedEdgesForPeriodicPolygons(polygons, imageSize, grid)
            : sharedEdgesForPolygons(polygons, grid);
    const neighbors = neighborsFromSharedEdges(sharedEdges, centers, imageSize, surface);
    const pieces = piecesFromPolygons({
        polygons,
        centers,
        neighbors,
        sharedEdges,
        grid,
        imageSize,
        tabs: options.tabs === true,
        random,
    });

    return {
        id: JIGSAW_BOARD_ARTIFACT_ID,
        title: jigsawBoardTitle(pieceCount, options, true),
        image: options.image ?? 'stock:hue',
        imageSize,
        pieceCount,
        ...(surface === 'torus' ? {surface} : {}),
        pieces,
    };
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
        case 600:
            return {cols: 30, rows: 20};
        case 1000:
            return {cols: 40, rows: 25};
    }
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

function normalizedGenerationImageSize(input: unknown): JigsawBoardArtifact['imageSize'] {
    return isImageSize(input) ? {width: input.width, height: input.height} : {...JIGSAW_IMAGE_SIZE};
}

function surfaceForOptions(options: JigsawBoardOptions): JigsawSurface {
    return options.surface === 'torus' ? 'torus' : 'plane';
}

export function surfaceForBoard(board: Pick<JigsawBoardArtifact, 'surface'>): JigsawSurface {
    return board.surface === 'torus' ? 'torus' : 'plane';
}

function jigsawBoardTitle(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions,
    voronoi: boolean,
) {
    const tabs = options.tabs ? 'tabbed ' : '';
    const surface = options.surface === 'torus' ? 'torus ' : '';
    const shape = voronoi ? 'Voronoi ' : '';
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF && options.imageName) {
        return `${pieceCount} piece ${tabs}${surface}${shape}${options.imageName} puzzle`;
    }
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF) {
        return `${pieceCount} piece ${tabs}${surface}${shape}image puzzle`;
    }
    return `${pieceCount} piece ${tabs}${surface}${shape}hue puzzle`;
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

function rectangleBounds(width: number, height: number): PieceBounds {
    return {left: -width / 2, top: -height / 2, width, height};
}

function signedPerturbation(size: number, random: RandomSource) {
    const magnitude = size * (0.25 + random() * 0.25);
    return magnitude * (random() < 0.5 ? -1 : 1);
}

function voronoiCell(
    site: Coord,
    siteIndex: number,
    sites: Coord[],
    size: {width: number; height: number},
    grid: {cols: number; rows: number},
) {
    let polygon: Coord[] = [
        {x: 0, y: 0},
        {x: size.width, y: 0},
        {x: size.width, y: size.height},
        {x: 0, y: size.height},
    ];
    for (const index of nearbyGridIndexes(siteIndex, grid, 3)) {
        polygon = clipToCloserSite(polygon, site, sites[index]);
        if (polygon.length === 0) break;
    }
    return polygon;
}

function periodicVoronoiCell(
    site: Coord,
    siteIndex: number,
    sites: Coord[],
    size: {width: number; height: number},
    grid: {cols: number; rows: number},
) {
    let polygon: Coord[] = [
        {x: site.x - size.width / 2, y: site.y - size.height / 2},
        {x: site.x + size.width / 2, y: site.y - size.height / 2},
        {x: site.x + size.width / 2, y: site.y + size.height / 2},
        {x: site.x - size.width / 2, y: site.y + size.height / 2},
    ];
    for (const copy of nearbyPeriodicSiteCopies(siteIndex, grid, size, 3)) {
        if (copy.index === siteIndex && copy.shift.x === 0 && copy.shift.y === 0) continue;
        polygon = clipToCloserSite(polygon, site, add(sites[copy.index], copy.shift));
        if (polygon.length === 0) break;
    }
    return polygon;
}

function clipToCloserSite(polygon: Coord[], site: Coord, other: Coord) {
    const result: Coord[] = [];
    const epsilon = 1e-7;
    for (let index = 0; index < polygon.length; index++) {
        const current = polygon[index];
        const previous = polygon[(index + polygon.length - 1) % polygon.length];
        const currentValue = distanceSquared(current, site) - distanceSquared(current, other);
        const previousValue = distanceSquared(previous, site) - distanceSquared(previous, other);
        const currentInside = currentValue <= epsilon;
        const previousInside = previousValue <= epsilon;

        if (currentInside !== previousInside) {
            const denominator = previousValue - currentValue;
            const t = Math.abs(denominator) < 1e-12 ? 0 : previousValue / denominator;
            result.push({
                x: previous.x + (current.x - previous.x) * t,
                y: previous.y + (current.y - previous.y) * t,
            });
        }
        if (currentInside) result.push(current);
    }
    return dedupePolygon(result);
}

function dedupePolygon(polygon: Coord[]) {
    const result: Coord[] = [];
    for (const point of polygon) {
        const previous = result[result.length - 1];
        if (!previous || distance(point, previous) > 1e-6) result.push(point);
    }
    if (result.length > 1 && distance(result[0], result[result.length - 1]) <= 1e-6) result.pop();
    return result;
}

function boundsForPolygon(polygon: Coord[]): {
    left: number;
    top: number;
    width: number;
    height: number;
} {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of polygon) {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    return {left, top, width: right - left, height: bottom - top};
}

function centerOfBounds(bounds: {left: number; top: number; width: number; height: number}): Coord {
    return {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
}

function polygonToMask(polygon: Coord[], center: Coord): PathSegment[] {
    return polygon.map((point) => ({type: 'Line', to: subtract(point, center)}));
}

function piecesFromPolygons({
    polygons,
    centers,
    neighbors,
    sharedEdges,
    grid,
    imageSize,
    tabs,
    random,
}: {
    polygons: Coord[][];
    centers: Coord[];
    neighbors: Map<number, Array<{piece: number; offset: Coord}>>;
    sharedEdges: SharedEdge[];
    grid: {cols: number; rows: number};
    imageSize: {width: number; height: number};
    tabs: boolean;
    random: RandomSource;
}) {
    const tabSpecs = tabs
        ? tabSpecsForSharedEdges(sharedEdges, imageSize, grid, random)
        : new Map<string, TabSpec>();
    return polygons.map((polygon, index): JigsawPiece => {
        const center = centers[index];
        const mask = tabs
            ? tabbedPolygonToMask(polygon, center, index, tabSpecs)
            : polygonToMask(polygon, center);
        const imageBounds = tabs ? boundsForMask(mask) : localBoundsForPolygon(polygon, center);
        return {
            center,
            bounds: {
                left: imageBounds.left,
                top: imageBounds.top,
                width: imageBounds.width,
                height: imageBounds.height,
            },
            mask,
            neighbors: neighbors.get(index) ?? [],
        };
    });
}

function localBoundsForPolygon(polygon: Coord[], center: Coord): PieceBounds {
    const imageBounds = boundsForPolygon(polygon);
    return {
        left: imageBounds.left - center.x,
        top: imageBounds.top - center.y,
        width: imageBounds.width,
        height: imageBounds.height,
    };
}

function neighborsFromSharedEdges(
    sharedEdges: SharedEdge[],
    centers: Coord[],
    imageSize: {width: number; height: number},
    surface: JigsawSurface,
) {
    const neighbors = new Map<number, Array<{piece: number; offset: Coord}>>();
    for (let index = 0; index < centers.length; index++) neighbors.set(index, []);
    for (const edge of sharedEdges) {
        const offset =
            surface === 'torus'
                ? shortestWrappedDelta(centers[edge.a], centers[edge.b], imageSize)
                : subtract(centers[edge.b], centers[edge.a]);
        neighbors
            .get(edge.a)
            ?.push({piece: edge.b, offset});
        neighbors
            .get(edge.b)
            ?.push({piece: edge.a, offset: multiply(offset, -1)});
    }
    return neighbors;
}

function sharedEdgesForPolygons(polygons: Coord[][], grid: {cols: number; rows: number}) {
    const edges: SharedEdge[] = [];
    for (let a = 0; a < polygons.length; a++) {
        for (const b of nearbyGridIndexes(a, grid, 3)) {
            if (b <= a) continue;
            const edge = sharedEdgeForPolygons(a, polygons[a], b, polygons[b]);
            if (!edge) continue;
            edges.push(edge);
        }
    }
    return edges;
}

function sharedEdgesForPeriodicPolygons(
    polygons: Coord[][],
    imageSize: {width: number; height: number},
    grid: {cols: number; rows: number},
) {
    const edges: SharedEdge[] = [];
    const seen = new Set<string>();
    for (let a = 0; a < polygons.length; a++) {
        for (const copy of nearbyPeriodicSiteCopies(a, grid, imageSize, 3)) {
            const b = copy.index;
            if (a === b) continue;
            const key = periodicEdgeKey(a, b, copy.shift, imageSize);
            if (seen.has(key)) continue;
            const bPolygon = shiftPolygon(polygons[b], copy.shift);
            const edge = sharedEdgeForPolygons(a, polygons[a], b, bPolygon);
            if (!edge) continue;
            seen.add(key);
            edges.push({
                ...edge,
                bStart: subtract(edge.start, copy.shift),
                bEnd: subtract(edge.end, copy.shift),
                wrap: copy.shift.x === 0 && copy.shift.y === 0 ? undefined : copy.shift,
            });
        }
    }
    return edges;
}

function periodicEdgeKey(a: number, b: number, shift: Coord, imageSize: {width: number; height: number}) {
    const shiftX = Math.round(shift.x / imageSize.width);
    const shiftY = Math.round(shift.y / imageSize.height);
    if (a < b) return `${a}:${b}:${shiftX}:${shiftY}`;
    return `${b}:${a}:${-shiftX}:${-shiftY}`;
}

function sharedEdgeForPolygons(
    a: number,
    aPolygon: Coord[],
    b: number,
    bPolygon: Coord[],
): SharedEdge | null {
    for (let i = 0; i < aPolygon.length; i++) {
        const a1 = aPolygon[i];
        const a2 = aPolygon[(i + 1) % aPolygon.length];
        for (let j = 0; j < bPolygon.length; j++) {
            const b1 = bPolygon[j];
            const b2 = bPolygon[(j + 1) % bPolygon.length];
            const overlap = segmentOverlap(a1, a2, b1, b2);
            if (overlap && distance(overlap.start, overlap.end) > 1e-4) {
                return {a, b, start: overlap.start, end: overlap.end};
            }
        }
    }
    return null;
}

function nearbyGridIndexes(index: number, grid: {cols: number; rows: number}, radius: number) {
    const row = Math.floor(index / grid.cols);
    const col = index % grid.cols;
    const result: number[] = [];
    for (
        let nextRow = Math.max(0, row - radius);
        nextRow <= Math.min(grid.rows - 1, row + radius);
        nextRow++
    ) {
        for (
            let nextCol = Math.max(0, col - radius);
            nextCol <= Math.min(grid.cols - 1, col + radius);
            nextCol++
        ) {
            const next = nextRow * grid.cols + nextCol;
            if (next !== index) result.push(next);
        }
    }
    return result;
}

function nearbyPeriodicSiteCopies(
    index: number,
    grid: {cols: number; rows: number},
    imageSize: {width: number; height: number},
    radius: number,
) {
    const row = Math.floor(index / grid.cols);
    const col = index % grid.cols;
    const result: Array<{index: number; shift: Coord}> = [];
    const seen = new Set<string>();

    for (let nextRow = row - radius; nextRow <= row + radius; nextRow++) {
        for (let nextCol = col - radius; nextCol <= col + radius; nextCol++) {
            const wrappedRow = modulo(nextRow, grid.rows);
            const wrappedCol = modulo(nextCol, grid.cols);
            const shiftRows = Math.floor(nextRow / grid.rows);
            const shiftCols = Math.floor(nextCol / grid.cols);
            const next = wrappedRow * grid.cols + wrappedCol;
            const key = `${next}:${shiftCols}:${shiftRows}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({
                index: next,
                shift: {x: shiftCols * imageSize.width, y: shiftRows * imageSize.height},
            });
        }
    }

    return result;
}

function polygonsShareEdge(a: Coord[], b: Coord[]) {
    for (let i = 0; i < a.length; i++) {
        const a1 = a[i];
        const a2 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            const b1 = b[j];
            const b2 = b[(j + 1) % b.length];
            if (segmentOverlapLength(a1, a2, b1, b2) > 1e-4) return true;
        }
    }
    return false;
}

function segmentOverlap(
    a1: Coord,
    a2: Coord,
    b1: Coord,
    b2: Coord,
): {start: Coord; end: Coord} | null {
    const ax = a2.x - a1.x;
    const ay = a2.y - a1.y;
    const bx = b2.x - b1.x;
    const by = b2.y - b1.y;
    const aLength = Math.hypot(ax, ay);
    const bLength = Math.hypot(bx, by);
    if (aLength <= 1e-8 || bLength <= 1e-8) return null;
    const crossDirections = Math.abs(ax * by - ay * bx);
    if (crossDirections > 1e-5 * aLength * bLength) return null;
    const crossOffset = Math.abs(ax * (b1.y - a1.y) - ay * (b1.x - a1.x));
    if (crossOffset > 1e-5 * aLength) return null;

    const axis = Math.abs(ax) >= Math.abs(ay) ? 'x' : 'y';
    const aMin = Math.min(a1[axis], a2[axis]);
    const aMax = Math.max(a1[axis], a2[axis]);
    const bMin = Math.min(b1[axis], b2[axis]);
    const bMax = Math.max(b1[axis], b2[axis]);
    const overlapStart = Math.max(aMin, bMin);
    const overlapEnd = Math.min(aMax, bMax);
    if (overlapEnd - overlapStart <= 1e-5) return null;

    return {
        start: pointOnSegmentAtAxis(a1, a2, axis, overlapStart),
        end: pointOnSegmentAtAxis(a1, a2, axis, overlapEnd),
    };
}

function segmentOverlapLength(a1: Coord, a2: Coord, b1: Coord, b2: Coord) {
    const overlap = segmentOverlap(a1, a2, b1, b2);
    return overlap ? distance(overlap.start, overlap.end) : 0;
}

function pointOnSegmentAtAxis(a: Coord, b: Coord, axis: 'x' | 'y', value: number): Coord {
    const denominator = b[axis] - a[axis];
    const t = Math.abs(denominator) < 1e-12 ? 0 : (value - a[axis]) / denominator;
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
}

function tabSpecsForSharedEdges(
    sharedEdges: SharedEdge[],
    imageSize: {width: number; height: number},
    grid: {cols: number; rows: number},
    random: RandomSource,
) {
    const cellSize = Math.min(imageSize.width / grid.cols, imageSize.height / grid.rows);
    const margin = cellSize / 10;
    const minRadius = margin * 0.7;
    const centers = sharedEdges.map((edge) => midpoint(edge.start, edge.end));
    const specs = new Map<string, TabSpec>();

    for (let index = 0; index < sharedEdges.length; index++) {
        const edge = sharedEdges[index];
        const edgeLength = distance(edge.start, edge.end);
        let radius = edgeLength * 0.48;
        for (let other = 0; other < centers.length; other++) {
            if (other === index) continue;
            radius = Math.min(radius, (distance(centers[index], centers[other]) - margin) / 2);
        }
        if (radius < minRadius) continue;
        specs.set(edgeKey(edge.a, edge.b), {
            edge,
            center: centers[index],
            radius,
            outwardPiece: random() < 0.5 ? edge.a : edge.b,
        });
    }
    return specs;
}

function randomSource(seed: string | number | undefined): RandomSource {
    if (seed === undefined) return Math.random;
    let state = hashSeed(String(seed));
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(seed: string) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index++) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function tabbedPolygonToMask(
    polygon: Coord[],
    center: Coord,
    piece: number,
    tabSpecs: Map<string, TabSpec>,
): PathSegment[] {
    if (!polygon.length) return [];
    const mask: PathSegment[] = [{type: 'Line', to: subtract(polygon[0], center)}];
    const clockwise = signedPolygonArea(polygon) >= 0;

    for (let index = 0; index < polygon.length; index++) {
        const from = polygon[index];
        const to = polygon[(index + 1) % polygon.length];
        const tab = tabSpecForEdge(piece, from, to, tabSpecs);
        if (!tab) {
            mask.push({type: 'Line', to: subtract(to, center)});
            continue;
        }
        const tangent = normalize(subtract(to, from));
        const normal = outwardNormal(tangent, clockwise);
        const bulge = tab.outwardPiece === piece ? normal : multiply(normal, -1);
        const tabCenter = midpoint(from, to);
        const tabStart = add(tabCenter, multiply(tangent, -tab.radius));
        const tabEnd = add(tabCenter, multiply(tangent, tab.radius));
        const orientedStart =
            distance(from, tabStart) <= distance(from, tabEnd) ? tabStart : tabEnd;
        const orientedEnd = orientedStart === tabStart ? tabEnd : tabStart;
        const orientedTangent = normalize(subtract(orientedEnd, orientedStart));
        const neckDepth = Math.max(tab.radius * 0.2, distance(from, tabStart) / 3);
        const shoulderDepth = tab.radius * 0.1;
        const tabDepth = tab.radius * 0.82;
        const neckOffset = tab.radius * 0.58;
        const shoulderOffset = tab.radius * 0.34;
        const tabHandle = tab.radius * 0.22;
        const bulgeSize = tabHandle * 1.5;
        const bulgeOffset = tab.radius * 0.4;

        const leftNeck = add(
            tabCenter,
            add(multiply(orientedTangent, -neckOffset), multiply(bulge, -neckDepth)),
        );
        const leftShoulder = add(
            tabCenter,
            add(multiply(orientedTangent, -shoulderOffset), multiply(bulge, shoulderDepth)),
        );
        const apex = add(tabCenter, multiply(bulge, tabDepth));
        const rightShoulder = add(
            tabCenter,
            add(multiply(orientedTangent, shoulderOffset), multiply(bulge, shoulderDepth)),
        );
        const rightNeck = add(
            tabCenter,
            add(multiply(orientedTangent, neckOffset), multiply(bulge, -neckDepth)),
        );
        const leftDipHandle = Math.max(tab.radius * 0.2, distance(from, leftNeck) * 0.38);
        const rightDipHandle = Math.max(tab.radius * 0.2, distance(rightNeck, to) * 0.38);

        mask.push({
            type: 'Cubic',
            control1: subtract(add(from, multiply(orientedTangent, leftDipHandle)), center),
            control2: subtract(add(leftNeck, multiply(orientedTangent, -leftDipHandle)), center),
            to: subtract(leftNeck, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(leftNeck, multiply(orientedTangent, tabHandle)), center),
            control2: subtract(
                add(
                    add(leftShoulder, multiply(orientedTangent, bulgeSize)),
                    multiply(bulge, -bulgeOffset),
                ),
                center,
            ),
            to: subtract(leftShoulder, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(
                add(
                    add(leftShoulder, multiply(orientedTangent, -bulgeSize)),
                    multiply(bulge, bulgeOffset),
                ),
                center,
            ),
            control2: subtract(add(apex, multiply(orientedTangent, -bulgeSize)), center),
            to: subtract(apex, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(apex, multiply(orientedTangent, bulgeSize)), center),
            control2: subtract(
                add(
                    add(rightShoulder, multiply(orientedTangent, bulgeSize)),
                    multiply(bulge, bulgeOffset),
                ),
                center,
            ),
            to: subtract(rightShoulder, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(
                add(
                    add(rightShoulder, multiply(orientedTangent, -bulgeSize)),
                    multiply(bulge, -bulgeOffset),
                ),
                center,
            ),
            control2: subtract(add(rightNeck, multiply(orientedTangent, -tabHandle)), center),
            to: subtract(rightNeck, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(rightNeck, multiply(orientedTangent, rightDipHandle)), center),
            control2: subtract(add(to, multiply(orientedTangent, -rightDipHandle)), center),
            to: subtract(to, center),
        });
    }
    return mask;
}

function tabSpecForEdge(piece: number, from: Coord, to: Coord, tabSpecs: Map<string, TabSpec>) {
    for (const tab of tabSpecs.values()) {
        if (piece !== tab.edge.a && piece !== tab.edge.b) continue;
        const edge = edgeEndpointsForPiece(tab.edge, piece);
        if (pointsMatchUnordered(from, to, edge.start, edge.end)) return tab;
    }
    return null;
}

function edgeEndpointsForPiece(edge: SharedEdge, piece: number) {
    if (piece === edge.b) {
        return {
            start: edge.bStart ?? edge.start,
            end: edge.bEnd ?? edge.end,
        };
    }
    return {start: edge.start, end: edge.end};
}

function pointsMatchUnordered(a1: Coord, a2: Coord, b1: Coord, b2: Coord) {
    return (
        (distance(a1, b1) <= 1e-4 && distance(a2, b2) <= 1e-4) ||
        (distance(a1, b2) <= 1e-4 && distance(a2, b1) <= 1e-4)
    );
}

function boundsForMask(mask: PathSegment[]) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const visit = (point: Coord) => {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    };
    for (const segment of mask) {
        visit(segment.to);
        if (segment.type === 'Quadratic') visit(segment.control);
        if (segment.type === 'Cubic') {
            visit(segment.control1);
            visit(segment.control2);
        }
    }
    if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom)
    ) {
        return {left: -0.5, top: -0.5, width: 1, height: 1};
    }
    return {left, top, width: Math.max(1e-6, right - left), height: Math.max(1e-6, bottom - top)};
}

function edgeKey(a: number, b: number) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function signedPolygonArea(points: Coord[]) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
}

function outwardNormal(tangent: Coord, clockwise: boolean) {
    return clockwise ? {x: tangent.y, y: -tangent.x} : {x: -tangent.y, y: tangent.x};
}

function normalize(vector: Coord) {
    const length = Math.hypot(vector.x, vector.y);
    return length <= 1e-8 ? {x: 0, y: 0} : {x: vector.x / length, y: vector.y / length};
}

function add(a: Coord, b: Coord): Coord {
    return {x: a.x + b.x, y: a.y + b.y};
}

function multiply(point: Coord, scale: number): Coord {
    return {x: point.x * scale, y: point.y * scale};
}

function midpoint(a: Coord, b: Coord): Coord {
    return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
}

function shiftPolygon(polygon: Coord[], shift: Coord) {
    if (shift.x === 0 && shift.y === 0) return polygon;
    return polygon.map((point) => add(point, shift));
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

function shortestWrappedDelta(from: Coord, to: Coord, imageSize: {width: number; height: number}) {
    return {
        x: shortestWrappedAxisDelta(to.x - from.x, imageSize.width),
        y: shortestWrappedAxisDelta(to.y - from.y, imageSize.height),
    };
}

function shortestWrappedAxisDelta(delta: number, size: number) {
    if (!Number.isFinite(size) || size <= 0) return delta;
    let wrapped = delta;
    if (wrapped > size / 2) wrapped -= size;
    if (wrapped < -size / 2) wrapped += size;
    return wrapped;
}

function distanceSquared(a: Coord, b: Coord) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function distance(a: Coord, b: Coord) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function modulo(value: number, size: number) {
    return ((value % size) + size) % size;
}

function normalizeJigsawBoardArtifact(input: unknown): JigsawBoardArtifact | null {
    if (!isRecord(input)) return null;
    const pieces = input.pieces;
    if (
        input.id === JIGSAW_BOARD_ARTIFACT_ID &&
        typeof input.title === 'string' &&
        isJigsawImageRef(input.image) &&
        isImageSize(input.imageSize) &&
        isPieceCount(input.pieceCount) &&
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

export function isJigsawSurface(input: unknown): input is JigsawSurface {
    return input === 'plane' || input === 'torus';
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

function isPieceCount(input: unknown): input is JigsawPieceCount {
    return (
        input === 12 ||
        input === 30 ||
        input === 60 ||
        input === 120 ||
        input === 600 ||
        input === 1000
    );
}

export function isJigsawPieceCount(input: unknown): input is JigsawPieceCount {
    return isPieceCount(input);
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
