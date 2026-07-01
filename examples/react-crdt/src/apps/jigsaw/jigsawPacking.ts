import type {Coord} from './schema';
import type {JigsawBoardArtifact} from './artifacts';

export const maxAllowedPieceOverlapRatio = 0.1;

export type BoardRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type PackingMetrics = {
    placedCount: number;
    maxBorderDistance: number;
    p95BorderDistance: number;
    meanBorderDistance: number;
    maxOverlapRatio: number;
    overlapViolations: number;
    outsideViolations: number;
};

type Triangle = [Coord, Coord, Coord];

const epsilon = 1e-7;

export function endpointPolygonForPiece(board: JigsawBoardArtifact, piece: number): Coord[] {
    return (board.pieces[piece]?.mask ?? []).map((segment) => segment.to);
}

export function placedPiecePolygon(
    board: JigsawBoardArtifact,
    piece: number,
    position: Coord,
): Coord[] {
    return endpointPolygonForPiece(board, piece).map((point) => add(point, position));
}

export function placedPieceBounds(
    board: JigsawBoardArtifact,
    piece: number,
    position: Coord,
): BoardRect {
    const bounds = board.pieces[piece]?.bounds;
    if (!bounds) return {left: position.x, top: position.y, right: position.x, bottom: position.y};
    return {
        left: position.x + bounds.left,
        top: position.y + bounds.top,
        right: position.x + bounds.left + bounds.width,
        bottom: position.y + bounds.top + bounds.height,
    };
}

export function stageRect(stage: {width: number; height: number}): BoardRect {
    return {left: 0, top: 0, right: stage.width, bottom: stage.height};
}

export function pieceBorderDistanceFromStage(
    board: JigsawBoardArtifact,
    piece: number,
    position: Coord,
    stage: {width: number; height: number},
) {
    return rectDistance(placedPieceBounds(board, piece, position), stageRect(stage));
}

export function isPlacedPieceOutsideStage(
    board: JigsawBoardArtifact,
    piece: number,
    position: Coord,
    stage: {width: number; height: number},
) {
    if (!stage.width || !stage.height) return false;
    const polygon = placedPiecePolygon(board, piece, position);
    if (polygon.length < 3) return true;
    return polygonOverlapArea(polygon, rectPolygon(stageRect(stage))) <= epsilon;
}

export function placedPieceOverlapRatio(
    board: JigsawBoardArtifact,
    aPiece: number,
    aPosition: Coord,
    bPiece: number,
    bPosition: Coord,
) {
    if (!rectsOverlap(placedPieceBounds(board, aPiece, aPosition), placedPieceBounds(board, bPiece, bPosition))) {
        return 0;
    }
    return polygonOverlapRatio(
        placedPiecePolygon(board, aPiece, aPosition),
        placedPiecePolygon(board, bPiece, bPosition),
    );
}

export function packingMetricsForPositions(
    board: JigsawBoardArtifact,
    positions: Map<number, Coord>,
    stage: {width: number; height: number},
): PackingMetrics {
    const entries = Array.from(positions);
    const distances = entries
        .map(([piece, position]) => pieceBorderDistanceFromStage(board, piece, position, stage))
        .sort((a, b) => a - b);
    let totalDistance = 0;
    for (const distance of distances) totalDistance += distance;

    let maxOverlapRatio = 0;
    let overlapViolations = 0;
    for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
            const ratio = placedPieceOverlapRatio(
                board,
                entries[a][0],
                entries[a][1],
                entries[b][0],
                entries[b][1],
            );
            maxOverlapRatio = Math.max(maxOverlapRatio, ratio);
            if (ratio > maxAllowedPieceOverlapRatio + epsilon) overlapViolations++;
        }
    }

    let outsideViolations = 0;
    for (const [piece, position] of entries) {
        if (!isPlacedPieceOutsideStage(board, piece, position, stage)) outsideViolations++;
    }

    return {
        placedCount: positions.size,
        maxBorderDistance: distances[distances.length - 1] ?? 0,
        p95BorderDistance: percentileSorted(distances, 0.95),
        meanBorderDistance: distances.length ? totalDistance / distances.length : 0,
        maxOverlapRatio,
        overlapViolations,
        outsideViolations,
    };
}

export function polygonOverlapRatio(a: Coord[], b: Coord[]) {
    const aArea = polygonArea(a);
    const bArea = polygonArea(b);
    const denominator = Math.min(aArea, bArea);
    if (denominator <= epsilon) return 0;
    return polygonOverlapArea(a, b) / denominator;
}

export function polygonOverlapArea(a: Coord[], b: Coord[]) {
    const aPolygon = normalizePolygon(a);
    const bPolygon = normalizePolygon(b);
    if (aPolygon.length < 3 || bPolygon.length < 3) return 0;
    if (!rectsOverlap(boundsForPoints(aPolygon), boundsForPoints(bPolygon))) return 0;

    const aTriangles = triangulatePolygon(aPolygon);
    const bTriangles = triangulatePolygon(bPolygon);
    let area = 0;
    for (const aTriangle of aTriangles) {
        for (const bTriangle of bTriangles) {
            area += convexPolygonIntersectionArea(aTriangle, bTriangle);
        }
    }
    return area;
}

export function polygonArea(points: Coord[]) {
    return Math.abs(signedPolygonArea(normalizePolygon(points))) / 2;
}

export function rectsOverlap(a: BoardRect, b: BoardRect) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function boundsForPoints(points: Coord[]): BoardRect {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of points) {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    if (!points.length) return {left: 0, top: 0, right: 0, bottom: 0};
    return {left, top, right, bottom};
}

function triangulatePolygon(points: Coord[]): Triangle[] {
    const polygon = normalizePolygon(points);
    if (polygon.length < 3) return [];
    if (polygon.length === 3) return [[polygon[0], polygon[1], polygon[2]]];

    const orientation = signedPolygonArea(polygon) >= 0 ? 1 : -1;
    const remaining = polygon.map((_point, index) => index);
    const triangles: Triangle[] = [];
    let guard = 0;

    while (remaining.length > 3 && guard < polygon.length * polygon.length) {
        guard++;
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const previousIndex = remaining[(i + remaining.length - 1) % remaining.length];
            const currentIndex = remaining[i];
            const nextIndex = remaining[(i + 1) % remaining.length];
            const previous = polygon[previousIndex];
            const current = polygon[currentIndex];
            const next = polygon[nextIndex];
            if (orientation * cross(subtract(current, previous), subtract(next, current)) <= epsilon) {
                continue;
            }

            let containsOtherPoint = false;
            for (const candidateIndex of remaining) {
                if (
                    candidateIndex === previousIndex ||
                    candidateIndex === currentIndex ||
                    candidateIndex === nextIndex
                ) {
                    continue;
                }
                if (pointInTriangle(polygon[candidateIndex], previous, current, next)) {
                    containsOtherPoint = true;
                    break;
                }
            }
            if (containsOtherPoint) continue;

            triangles.push([previous, current, next]);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }

    if (remaining.length === 3) {
        triangles.push([polygon[remaining[0]], polygon[remaining[1]], polygon[remaining[2]]]);
    }

    if (!triangles.length) {
        for (let index = 1; index < polygon.length - 1; index++) {
            triangles.push([polygon[0], polygon[index], polygon[index + 1]]);
        }
    }

    return triangles;
}

function convexPolygonIntersectionArea(subject: Coord[], clip: Coord[]) {
    let output = normalizePolygon(subject);
    const clipPolygon = normalizePolygon(clip);
    if (output.length < 3 || clipPolygon.length < 3) return 0;
    const orientation = signedPolygonArea(clipPolygon) >= 0 ? 1 : -1;

    for (let index = 0; index < clipPolygon.length; index++) {
        const clipStart = clipPolygon[index];
        const clipEnd = clipPolygon[(index + 1) % clipPolygon.length];
        const input = output;
        output = [];
        if (!input.length) break;

        for (let i = 0; i < input.length; i++) {
            const current = input[i];
            const previous = input[(i + input.length - 1) % input.length];
            const currentInside = insideHalfPlane(current, clipStart, clipEnd, orientation);
            const previousInside = insideHalfPlane(previous, clipStart, clipEnd, orientation);

            if (currentInside !== previousInside) {
                output.push(lineIntersection(previous, current, clipStart, clipEnd));
            }
            if (currentInside) output.push(current);
        }
        output = normalizePolygon(output);
    }

    return polygonArea(output);
}

function insideHalfPlane(point: Coord, lineStart: Coord, lineEnd: Coord, orientation: number) {
    return orientation * cross(subtract(lineEnd, lineStart), subtract(point, lineStart)) >= -epsilon;
}

function lineIntersection(a: Coord, b: Coord, c: Coord, d: Coord): Coord {
    const ab = subtract(b, a);
    const cd = subtract(d, c);
    const denominator = cross(ab, cd);
    if (Math.abs(denominator) <= epsilon) return b;
    const t = cross(subtract(c, a), cd) / denominator;
    return {x: a.x + ab.x * t, y: a.y + ab.y * t};
}

function pointInTriangle(point: Coord, a: Coord, b: Coord, c: Coord) {
    const area = Math.abs(cross(subtract(b, a), subtract(c, a)));
    const area1 = Math.abs(cross(subtract(a, point), subtract(b, point)));
    const area2 = Math.abs(cross(subtract(b, point), subtract(c, point)));
    const area3 = Math.abs(cross(subtract(c, point), subtract(a, point)));
    return Math.abs(area - area1 - area2 - area3) <= epsilon;
}

function rectPolygon(rect: BoardRect): Coord[] {
    return [
        {x: rect.left, y: rect.top},
        {x: rect.right, y: rect.top},
        {x: rect.right, y: rect.bottom},
        {x: rect.left, y: rect.bottom},
    ];
}

function rectDistance(a: BoardRect, b: BoardRect) {
    const dx = a.right < b.left ? b.left - a.right : b.right < a.left ? a.left - b.right : 0;
    const dy = a.bottom < b.top ? b.top - a.bottom : b.bottom < a.top ? a.top - b.bottom : 0;
    return Math.hypot(dx, dy);
}

function percentileSorted(values: number[], percentile: number) {
    if (!values.length) return 0;
    const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * percentile)));
    return values[index];
}

function normalizePolygon(points: Coord[]) {
    const result: Coord[] = [];
    for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        const previous = result[result.length - 1];
        if (!previous || distance(previous, point) > epsilon) result.push(point);
    }
    if (result.length > 1 && distance(result[0], result[result.length - 1]) <= epsilon) result.pop();
    return result;
}

function signedPolygonArea(points: Coord[]) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return area;
}

function add(a: Coord, b: Coord): Coord {
    return {x: a.x + b.x, y: a.y + b.y};
}

function subtract(a: Coord, b: Coord): Coord {
    return {x: a.x - b.x, y: a.y - b.y};
}

function cross(a: Coord, b: Coord) {
    return a.x * b.y - a.y * b.x;
}

function distance(a: Coord, b: Coord) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
