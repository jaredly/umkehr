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

export type JigsawPieceCount = 12 | 30 | 60 | 120 | 600;
export type JigsawGenerationType = 'rectangular' | 'voronoi';

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
    tabs?: boolean;
    image?: JigsawImageRef;
    imageSize?: {width: number; height: number};
    imageName?: string;
};

type SharedEdge = {
    a: number;
    b: number;
    start: Coord;
    end: Coord;
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
        return loadedImage ? [manifestForBoard(loadedBoard), manifestForImage(loadedImage)] : [manifestForBoard(loadedBoard)];
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
    const grid = gridForPieceCount(pieceCount);
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

    const neighbors = neighborsFromSharedEdges(sharedEdges, centers);
    const pieces = piecesFromPolygons({
        polygons,
        centers,
        neighbors,
        sharedEdges,
        grid,
        imageSize,
        tabs: options.tabs === true,
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
        pieces,
    };
}

function generateVoronoiJigsawBoard(
    pieceCount: JigsawPieceCount,
    options: JigsawBoardOptions = {},
): JigsawBoardArtifact {
    const imageSize = normalizedGenerationImageSize(options.imageSize);
    const grid = gridForPieceCount(pieceCount);
    const cellWidth = imageSize.width / grid.cols;
    const cellHeight = imageSize.height / grid.rows;
    const sites: Coord[] = [];

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const center = {
                x: (col + 0.5) * cellWidth,
                y: (row + 0.5) * cellHeight,
            };
            const dx = signedPerturbation(cellWidth);
            const dy = signedPerturbation(cellHeight);
            sites.push({
                x: clamp(center.x + dx, 0.001, imageSize.width - 0.001),
                y: clamp(center.y + dy, 0.001, imageSize.height - 0.001),
            });
        }
    }

    const polygons = sites.map((site, index) =>
        voronoiCell(site, index, sites, imageSize, grid),
    );
    const centers = polygons.map((polygon) => centerOfBounds(boundsForPolygon(polygon)));
    const sharedEdges = sharedEdgesForPolygons(polygons, grid);
    const neighbors = neighborsFromSharedEdges(sharedEdges, centers);
    const pieces = piecesFromPolygons({
        polygons,
        centers,
        neighbors,
        sharedEdges,
        grid,
        imageSize,
        tabs: options.tabs === true,
    });

    return {
        id: JIGSAW_BOARD_ARTIFACT_ID,
        title: jigsawBoardTitle(pieceCount, options, true),
        image: options.image ?? 'stock:hue',
        imageSize,
        pieceCount,
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
    return loadedImage ? [serializeBoard(board), serializeImage(loadedImage)] : [serializeBoard(board)];
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

function jigsawBoardTitle(pieceCount: JigsawPieceCount, options: JigsawBoardOptions, voronoi: boolean) {
    const tabs = options.tabs ? 'tabbed ' : '';
    const shape = voronoi ? 'Voronoi ' : '';
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF && options.imageName) {
        return `${pieceCount} piece ${tabs}${shape}${options.imageName} puzzle`;
    }
    if (options.image === JIGSAW_ARTIFACT_IMAGE_REF) {
        return `${pieceCount} piece ${tabs}${shape}image puzzle`;
    }
    return `${pieceCount} piece ${tabs}${shape}hue puzzle`;
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

function signedPerturbation(size: number) {
    const magnitude = size * (0.25 + Math.random() * 0.25);
    return magnitude * (Math.random() < 0.5 ? -1 : 1);
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

function boundsForPolygon(polygon: Coord[]): {left: number; top: number; width: number; height: number} {
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
}: {
    polygons: Coord[][];
    centers: Coord[];
    neighbors: Map<number, Array<{piece: number; offset: Coord}>>;
    sharedEdges: SharedEdge[];
    grid: {cols: number; rows: number};
    imageSize: {width: number; height: number};
    tabs: boolean;
}) {
    const tabSpecs = tabs ? tabSpecsForSharedEdges(sharedEdges, imageSize, grid) : new Map<string, TabSpec>();
    return polygons.map((polygon, index): JigsawPiece => {
        const center = centers[index];
        const mask = tabs ? tabbedPolygonToMask(polygon, center, index, tabSpecs) : polygonToMask(polygon, center);
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

function neighborsFromSharedEdges(sharedEdges: SharedEdge[], centers: Coord[]) {
    const neighbors = new Map<number, Array<{piece: number; offset: Coord}>>();
    for (let index = 0; index < centers.length; index++) neighbors.set(index, []);
    for (const edge of sharedEdges) {
        neighbors.get(edge.a)?.push({piece: edge.b, offset: subtract(centers[edge.b], centers[edge.a])});
        neighbors.get(edge.b)?.push({piece: edge.a, offset: subtract(centers[edge.a], centers[edge.b])});
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

function sharedEdgeForPolygons(a: number, aPolygon: Coord[], b: number, bPolygon: Coord[]): SharedEdge | null {
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
    for (let nextRow = Math.max(0, row - radius); nextRow <= Math.min(grid.rows - 1, row + radius); nextRow++) {
        for (let nextCol = Math.max(0, col - radius); nextCol <= Math.min(grid.cols - 1, col + radius); nextCol++) {
            const next = nextRow * grid.cols + nextCol;
            if (next !== index) result.push(next);
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

function segmentOverlap(a1: Coord, a2: Coord, b1: Coord, b2: Coord): {start: Coord; end: Coord} | null {
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
) {
    const cellSize = Math.min(imageSize.width / grid.cols, imageSize.height / grid.rows);
    const margin = cellSize / 10;
    const minRadius = margin * 0.35;
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
            outwardPiece: Math.random() < 0.5 ? edge.a : edge.b,
        });
    }
    return specs;
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
        const tabStart = add(tab.center, multiply(tangent, -tab.radius));
        const tabEnd = add(tab.center, multiply(tangent, tab.radius));
        const orientedStart = distance(from, tabStart) <= distance(from, tabEnd) ? tabStart : tabEnd;
        const orientedEnd = orientedStart === tabStart ? tabEnd : tabStart;
        const orientedTangent = normalize(subtract(orientedEnd, orientedStart));
        const neckDepth = tab.radius * 0.22;
        const tabDepth = tab.radius * 0.72;
        const handle = tab.radius * 0.24;
        const leftNeck = add(tab.center, add(multiply(orientedTangent, -tab.radius * 0.48), multiply(bulge, -neckDepth)));
        const apex = add(tab.center, multiply(bulge, tabDepth));
        const rightNeck = add(tab.center, add(multiply(orientedTangent, tab.radius * 0.48), multiply(bulge, -neckDepth)));

        mask.push({type: 'Line', to: subtract(orientedStart, center)});
        mask.push({
            type: 'Cubic',
            control1: subtract(add(orientedStart, multiply(orientedTangent, handle)), center),
            control2: subtract(add(leftNeck, multiply(orientedTangent, -handle)), center),
            to: subtract(leftNeck, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(leftNeck, multiply(orientedTangent, handle)), center),
            control2: subtract(add(apex, multiply(orientedTangent, -handle * 1.25)), center),
            to: subtract(apex, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(apex, multiply(orientedTangent, handle * 1.25)), center),
            control2: subtract(add(rightNeck, multiply(orientedTangent, -handle)), center),
            to: subtract(rightNeck, center),
        });
        mask.push({
            type: 'Cubic',
            control1: subtract(add(rightNeck, multiply(orientedTangent, handle)), center),
            control2: subtract(add(orientedEnd, multiply(orientedTangent, -handle)), center),
            to: subtract(orientedEnd, center),
        });
        mask.push({type: 'Line', to: subtract(to, center)});
    }
    return mask;
}

function tabSpecForEdge(
    piece: number,
    from: Coord,
    to: Coord,
    tabSpecs: Map<string, TabSpec>,
) {
    for (const tab of tabSpecs.values()) {
        if (piece !== tab.edge.a && piece !== tab.edge.b) continue;
        if (pointsMatchUnordered(from, to, tab.edge.start, tab.edge.end)) return tab;
    }
    return null;
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
    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
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

function distanceSquared(a: Coord, b: Coord) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function distance(a: Coord, b: Coord) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
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

function normalizeJigsawPiece(input: unknown, pieceCount: JigsawPieceCount, index: number): JigsawPiece {
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
    return input === 12 || input === 30 || input === 60 || input === 120 || input === 600;
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
