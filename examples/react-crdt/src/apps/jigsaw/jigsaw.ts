import type {DraftPatch} from 'umkehr';
import type {Coord, JigsawState} from './schema';
import type {JigsawBoardArtifact} from './artifacts';

export type ValidConnection = {
    key: string;
    from: number;
    to: number;
    strength: number;
};

export type PuzzleLayout = {
    connections: ValidConnection[];
    components: number[][];
    pieceToComponent: Map<number, number>;
    depths: Map<number, number>;
    anchors: Map<number, number>;
    positions: Map<number, Coord>;
};

export type SnapCandidate = {
    from: number;
    to: number;
    key: string;
    strength: number;
};

export type StageSize = {
    width: number;
    height: number;
};

export type PieceRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type TorusPieceCopy = {
    key: string;
    position: Coord;
    tileOffset: Coord;
    rect: PieceRect;
    primary: boolean;
};

export type OutsideTorusDropResult =
    | {type: 'cancel'}
    | {type: 'patches'; patches: DraftPatch<JigsawState>[]};

export type ArrangementResult = {
    positions: Map<number, Coord>;
    attempts: number;
};

type PackingSide = 'top' | 'right' | 'bottom' | 'left';

type BorderCandidate = {
    side: PackingSide;
    along: number;
    offsetX: number;
    offsetY: number;
    rank: number;
};

export function connectionKey(from: number, to: number) {
    return `${from}:${to}`;
}

export function pieceKey(piece: number) {
    return String(piece);
}

export function parseConnectionKey(key: string): {from: number; to: number} | null {
    const match = /^(\d+):(\d+)$/.exec(key);
    if (!match) return null;
    return {from: Number(match[1]), to: Number(match[2])};
}

export function validConnections(
    board: JigsawBoardArtifact,
    connections: JigsawState['connections'],
): ValidConnection[] {
    return Object.entries(connections).flatMap(([key, strength]) => {
        const parsed = parseConnectionKey(key);
        if (!parsed) return [];
        if (!Number.isFinite(strength) || strength <= 0) return [];
        if (!isPieceIndex(board, parsed.from) || !isPieceIndex(board, parsed.to)) return [];
        if (parsed.from === parsed.to) return [];
        if (!neighborOffset(board, parsed.from, parsed.to)) return [];
        return [{key, from: parsed.from, to: parsed.to, strength}];
    });
}

export function connectedComponents(board: JigsawBoardArtifact, connections: ValidConnection[]) {
    const adjacency = new Map<number, Set<number>>();
    for (let index = 0; index < board.pieces.length; index++) adjacency.set(index, new Set());
    for (const connection of connections) {
        adjacency.get(connection.from)?.add(connection.to);
        adjacency.get(connection.to)?.add(connection.from);
    }

    const visited = new Set<number>();
    const components: number[][] = [];
    for (let index = 0; index < board.pieces.length; index++) {
        if (visited.has(index)) continue;
        const component: number[] = [];
        const stack = [index];
        visited.add(index);
        while (stack.length) {
            const current = stack.pop()!;
            component.push(current);
            for (const next of adjacency.get(current) ?? []) {
                if (visited.has(next)) continue;
                visited.add(next);
                stack.push(next);
            }
        }
        components.push(component.sort((a, b) => a - b));
    }
    return components;
}

export function pieceDepths(board: JigsawBoardArtifact, connections: ValidConnection[]) {
    const sccs = stronglyConnectedComponents(board.pieces.length, connections);
    const pieceToScc = new Map<number, number>();
    sccs.forEach((scc, index) => {
        for (const piece of scc) pieceToScc.set(piece, index);
    });

    const incomingCount = new Map<number, number>();
    const dag = new Map<number, Array<{to: number; strength: number}>>();
    for (let index = 0; index < sccs.length; index++) {
        incomingCount.set(index, 0);
        dag.set(index, []);
    }
    const edgeStrengths = new Map<string, {from: number; to: number; strength: number}>();
    for (const connection of connections) {
        const from = pieceToScc.get(connection.from);
        const to = pieceToScc.get(connection.to);
        if (from === undefined || to === undefined || from === to) continue;
        const key = `${from}:${to}`;
        const existing = edgeStrengths.get(key);
        if (!existing || connection.strength > existing.strength) {
            edgeStrengths.set(key, {from, to, strength: connection.strength});
        }
    }
    for (const edge of edgeStrengths.values()) {
        dag.get(edge.from)?.push({to: edge.to, strength: edge.strength});
        incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    }

    const depthsByScc = new Map<number, number>();
    for (let index = 0; index < sccs.length; index++) depthsByScc.set(index, 0);
    const queue = Array.from(incomingCount.entries())
        .filter(([, incoming]) => incoming === 0)
        .map(([index]) => index);

    while (queue.length) {
        const current = queue.shift()!;
        for (const edge of dag.get(current) ?? []) {
            const nextDepth = (depthsByScc.get(current) ?? 0) + edge.strength;
            if (nextDepth > (depthsByScc.get(edge.to) ?? 0)) depthsByScc.set(edge.to, nextDepth);
            incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) - 1);
            if (incomingCount.get(edge.to) === 0) queue.push(edge.to);
        }
    }

    const depths = new Map<number, number>();
    for (const [piece, scc] of pieceToScc) depths.set(piece, depthsByScc.get(scc) ?? 0);
    return depths;
}

export function buildPuzzleLayout(board: JigsawBoardArtifact, state: JigsawState): PuzzleLayout {
    const connections = validConnections(board, state.connections);
    const components = connectedComponents(board, connections);
    const pieceToComponent = new Map<number, number>();
    components.forEach((component, index) => {
        for (const piece of component) pieceToComponent.set(piece, index);
    });
    const depths = pieceDepths(board, connections);
    const anchors = new Map<number, number>();
    const positions = new Map<number, Coord>();

    components.forEach((component, componentIndex) => {
        const anchor = anchorPieceForComponent(component, state.positions, depths);
        if (anchor === null) return;
        anchors.set(componentIndex, anchor);
        const anchorPosition = state.positions[pieceKey(anchor)];
        if (!anchorPosition) return;
        for (const [piece, position] of positionsForComponent(board, component, anchor, anchorPosition, connections)) {
            positions.set(piece, position);
        }
    });

    return {connections, components, pieceToComponent, depths, anchors, positions};
}

export function anchorPieceForComponent(
    component: number[],
    positions: JigsawState['positions'],
    depths: Map<number, number>,
) {
    let anchor: number | null = null;
    for (const piece of component) {
        if (!positions[pieceKey(piece)]) continue;
        if (anchor === null) {
            anchor = piece;
            continue;
        }
        const depth = depths.get(piece) ?? 0;
        const anchorDepth = depths.get(anchor) ?? 0;
        if (depth > anchorDepth || (depth === anchorDepth && piece > anchor)) anchor = piece;
    }
    return anchor;
}

export function positionsForComponent(
    board: JigsawBoardArtifact,
    component: number[],
    anchor: number,
    anchorPosition: Coord,
    connections: ValidConnection[] = [],
) {
    const neighborsByPiece = connectedNeighborsForComponent(board, component, connections);
    const positions = new Map<number, Coord>([[anchor, anchorPosition]]);
    const queue = [anchor];
    while (queue.length) {
        const current = queue.shift()!;
        const currentPosition = positions.get(current)!;
        const neighbors = neighborsByPiece.get(current) ?? [];
        for (const neighbor of neighbors) {
            if (positions.has(neighbor.piece)) continue;
            positions.set(neighbor.piece, add(currentPosition, neighbor.offset));
            queue.push(neighbor.piece);
        }
    }
    return positions;
}

export function unplacedPieces(board: JigsawBoardArtifact, layout: PuzzleLayout) {
    const result: number[] = [];
    for (let index = 0; index < board.pieces.length; index++) {
        if (!layout.positions.has(index)) result.push(index);
    }
    return result;
}

export function arrangeUnplacedPieces(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
) {
    return shouldUsePerimeterShelves(board)
        ? arrangeUnplacedPiecesPerimeterShelves(board, pieces, stage, seed)
        : arrangeUnplacedPiecesBestFirstGrid(board, pieces, stage, seed);
}

export function arrangeUnplacedPiecesRingLane(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
) {
    if (!pieces.length || stage.width <= 0 || stage.height <= 0) return new Map<number, Coord>();
    const positions = new Map<number, Coord>();
    const rects: PieceRect[] = [];
    const pieceSize = maxPieceSize(board);
    const padding = pieceCollisionPadding(board);
    const gap = padding * 2;
    const baseOffset = Math.max(pieceSize.width, pieceSize.height) * 0.72 + padding;
    const ringGap = Math.max(pieceSize.width, pieceSize.height) + gap;
    const laneRotation = normalizedSeed(seed) % 4;
    const slotRotation = normalizedSeed(seed) % Math.max(1, pieces.length);
    const maxRings = Math.max(8, Math.ceil(pieces.length / 12) + 4);

    for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index];
        const position = findNonOverlappingPiecePosition({
            board,
            piece,
            stage,
            placed: rects,
            padding,
            gap,
            baseOffset,
            ringGap,
            maxRings,
            laneRotation,
            slotRotation: slotRotation + index,
        });
        positions.set(piece, position);
        rects.push(rectForPiece(board, piece, position, padding));
    }
    return positions;
}

export function arrangeUnplacedPiecesPerimeterShelves(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
) {
    return arrangeUnplacedPiecesPerimeterShelvesWithStats(board, pieces, stage, seed).positions;
}

export function arrangeUnplacedPiecesPerimeterShelvesWithStats(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
): ArrangementResult {
    if (!pieces.length || stage.width <= 0 || stage.height <= 0) {
        return {positions: new Map(), attempts: 0};
    }

    const sorted = sortedPackingPieces(board, pieces, seed);
    const positions = new Map<number, Coord>();
    const gap = piecePackingGap(board);
    const maxSize = maxPieceSize(board);
    const rowStepX = Math.max(1, maxSize.width + gap);
    const rowStepY = Math.max(1, maxSize.height + gap);
    const sideOrder = rotatedPackingSides(seed);
    let nextPiece = 0;
    let attempts = 0;
    const maxRows = Math.max(8, sorted.length + 4);

    for (let row = 0; nextPiece < sorted.length && row < maxRows; row++) {
        const offsetX = row * rowStepX;
        const offsetY = row * rowStepY;
        for (const side of sideOrder) {
            const result = fillPackingShelf({
                board,
                sorted,
                positions,
                stage,
                side,
                offsetX,
                offsetY,
                gap,
                nextPiece,
            });
            nextPiece = result.nextPiece;
            attempts += result.attempts;
            if (nextPiece >= sorted.length) break;
        }
    }

    return {positions, attempts};
}

export function arrangeUnplacedPiecesBestFirstGrid(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
) {
    return arrangeUnplacedPiecesBestFirstGridWithStats(board, pieces, stage, seed).positions;
}

export function arrangeUnplacedPiecesBestFirstGridWithStats(
    board: JigsawBoardArtifact,
    pieces: number[],
    stage: StageSize,
    seed = 0,
): ArrangementResult {
    if (!pieces.length || stage.width <= 0 || stage.height <= 0) {
        return {positions: new Map(), attempts: 0};
    }

    const sorted = sortedPackingPieces(board, pieces, seed);
    const candidates = borderGridCandidates(board, sorted.length, stage, seed);
    const positions = new Map<number, Coord>();
    const rects: PieceRect[] = [];
    const index = new RectSpatialIndex(Math.max(12, Math.max(maxPieceSize(board).width, maxPieceSize(board).height)));
    let attempts = 0;

    for (const piece of sorted) {
        let fallback: {position: Coord; overlapCount: number} | null = null;
        for (const candidate of candidates) {
            attempts++;
            const position = positionForBorderCandidate(board, piece, stage, candidate);
            const rect = rectForPiece(board, piece, position);
            if (!rectOutsideStage(rect, stage)) continue;
            const overlapping = index.query(rect).filter((rectIndex) => rectsOverlap(rect, rects[rectIndex]));
            if (!overlapping.length) {
                positions.set(piece, position);
                rects.push(rect);
                index.add(rect, rects.length - 1);
                fallback = null;
                break;
            }
            if (!fallback || overlapping.length < fallback.overlapCount) {
                fallback = {position, overlapCount: overlapping.length};
            }
        }
        if (!positions.has(piece) && fallback) {
            const rect = rectForPiece(board, piece, fallback.position);
            positions.set(piece, fallback.position);
            rects.push(rect);
            index.add(rect, rects.length - 1);
        }
    }

    return {positions, attempts};
}

function fillPackingShelf({
    board,
    sorted,
    positions,
    stage,
    side,
    offsetX,
    offsetY,
    gap,
    nextPiece,
}: {
    board: JigsawBoardArtifact;
    sorted: number[];
    positions: Map<number, Coord>;
    stage: StageSize;
    side: PackingSide;
    offsetX: number;
    offsetY: number;
    gap: number;
    nextPiece: number;
}) {
    let attempts = 0;
    let cursor = (side === 'top' || side === 'bottom' ? -offsetX : -offsetY) + gap;
    const limit =
        (side === 'top' || side === 'bottom' ? stage.width + offsetX : stage.height + offsetY) - gap;

    while (nextPiece < sorted.length) {
        const piece = sorted[nextPiece];
        const bounds = board.pieces[piece]?.bounds;
        if (!bounds) {
            nextPiece++;
            continue;
        }
        attempts++;
        const footprint = side === 'top' || side === 'bottom' ? bounds.width : bounds.height;
        if (cursor + footprint > limit + 1e-6) break;
        positions.set(
            piece,
            positionForShelfPiece({
                bounds,
                side,
                cursor,
                stage,
                offsetX,
                offsetY,
            }),
        );
        cursor += footprint + gap;
        nextPiece++;
    }

    return {nextPiece, attempts};
}

function positionForShelfPiece({
    bounds,
    side,
    cursor,
    stage,
    offsetX,
    offsetY,
}: {
    bounds: {left: number; top: number; width: number; height: number};
    side: PackingSide;
    cursor: number;
    stage: StageSize;
    offsetX: number;
    offsetY: number;
}): Coord {
    switch (side) {
        case 'top':
            return {x: cursor - bounds.left, y: -offsetY - bounds.height - bounds.top};
        case 'right':
            return {x: stage.width + offsetX - bounds.left, y: cursor - bounds.top};
        case 'bottom':
            return {x: cursor - bounds.left, y: stage.height + offsetY - bounds.top};
        case 'left':
            return {x: -offsetX - bounds.width - bounds.left, y: cursor - bounds.top};
    }
}

function borderGridCandidates(
    board: JigsawBoardArtifact,
    pieceCount: number,
    stage: StageSize,
    seed: number,
) {
    const average = averagePieceSize(board);
    const maxSize = maxPieceSize(board);
    const stepX = Math.max(4, average.width * 0.65);
    const stepY = Math.max(4, average.height * 0.65);
    const rowStepX = Math.max(1, maxSize.width * 0.72);
    const rowStepY = Math.max(1, maxSize.height * 0.72);
    const target = Math.max(pieceCount * 12, 64);
    const candidates: BorderCandidate[] = [];
    const sides = rotatedPackingSides(seed);

    for (let row = 0; candidates.length < target && row < pieceCount + 24; row++) {
        const offsetX = row * rowStepX;
        const offsetY = row * rowStepY;
        for (const side of sides) {
            const horizontal = side === 'top' || side === 'bottom';
            const start = horizontal ? -offsetX : -offsetY;
            const end = horizontal ? stage.width + offsetX : stage.height + offsetY;
            const step = horizontal ? stepX : stepY;
            let slot = 0;
            for (let along = start; along <= end; along += step) {
                candidates.push({
                    side,
                    along,
                    offsetX,
                    offsetY,
                    rank: row * 1_000_000 + slot * 10 + seededPieceRank(slot, seed),
                });
                slot++;
            }
        }
    }

    return candidates.sort((a, b) => candidateDistance(a) - candidateDistance(b) || a.rank - b.rank);
}

function positionForBorderCandidate(
    board: JigsawBoardArtifact,
    piece: number,
    stage: StageSize,
    candidate: BorderCandidate,
) {
    const bounds = board.pieces[piece]?.bounds ?? {left: 0, top: 0, width: 0, height: 0};
    return positionForShelfPiece({
        bounds,
        side: candidate.side,
        cursor: candidate.along,
        stage,
        offsetX: candidate.offsetX,
        offsetY: candidate.offsetY,
    });
}

function candidateDistance(candidate: BorderCandidate) {
    return Math.hypot(candidate.offsetX, candidate.offsetY);
}

function sortedPackingPieces(board: JigsawBoardArtifact, pieces: number[], seed: number) {
    const seen = new Set<number>();
    const normalized = normalizedSeed(seed);
    return pieces
        .filter((piece) => {
            if (!isPieceIndex(board, piece) || seen.has(piece)) return false;
            seen.add(piece);
            return true;
        })
        .sort((a, b) => {
            const areaDelta = pieceAreaEstimate(board, b) - pieceAreaEstimate(board, a);
            if (Math.abs(areaDelta) > 1e-6) return areaDelta;
            return seededPieceRank(a, normalized) - seededPieceRank(b, normalized) || a - b;
        });
}

function shouldUsePerimeterShelves(board: JigsawBoardArtifact) {
    return board.pieceCount >= 120;
}

function pieceAreaEstimate(board: JigsawBoardArtifact, piece: number) {
    const bounds = board.pieces[piece]?.bounds;
    return bounds ? bounds.width * bounds.height : 0;
}

function piecePackingGap(board: JigsawBoardArtifact) {
    return pieceCollisionPadding(board) * 2 + 0.5;
}

function rotatedPackingSides(seed: number): PackingSide[] {
    const sides: PackingSide[] = ['top', 'right', 'bottom', 'left'];
    const rotation = normalizedSeed(seed) % sides.length;
    return sides.slice(rotation).concat(sides.slice(0, rotation));
}

function seededPieceRank(piece: number, seed: number) {
    let state = (piece + 1) * 0x9e3779b1 + seed * 0x85ebca6b;
    state ^= state >>> 16;
    state = Math.imul(state, 0x7feb352d);
    state ^= state >>> 15;
    state = Math.imul(state, 0x846ca68b);
    state ^= state >>> 16;
    return state >>> 0;
}

function rectOutsideStage(rect: PieceRect, stage: StageSize) {
    return rect.right <= 0 || rect.left >= stage.width || rect.bottom <= 0 || rect.top >= stage.height;
}

class RectSpatialIndex {
    private cells = new Map<string, number[]>();

    constructor(private readonly cellSize: number) {}

    add(rect: PieceRect, index: number) {
        for (const key of this.keysForRect(rect)) {
            const cell = this.cells.get(key);
            if (cell) {
                cell.push(index);
            } else {
                this.cells.set(key, [index]);
            }
        }
    }

    query(rect: PieceRect) {
        const result = new Set<number>();
        for (const key of this.keysForRect(rect)) {
            for (const index of this.cells.get(key) ?? []) result.add(index);
        }
        return Array.from(result);
    }

    private keysForRect(rect: PieceRect) {
        const minX = Math.floor(rect.left / this.cellSize);
        const maxX = Math.floor((rect.right - 1e-6) / this.cellSize);
        const minY = Math.floor(rect.top / this.cellSize);
        const maxY = Math.floor((rect.bottom - 1e-6) / this.cellSize);
        const keys: string[] = [];
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) keys.push(`${x}:${y}`);
        }
        return keys;
    }
}

export function rectForPiece(
    board: JigsawBoardArtifact,
    piece: number,
    position: Coord,
    padding = 0,
): PieceRect {
    const bounds = board.pieces[piece]?.bounds;
    if (!bounds) {
        return {
            left: position.x - padding,
            top: position.y - padding,
            right: position.x + padding,
            bottom: position.y + padding,
        };
    }
    return {
        left: position.x + bounds.left - padding,
        top: position.y + bounds.top - padding,
        right: position.x + bounds.left + bounds.width + padding,
        bottom: position.y + bounds.top + bounds.height + padding,
    };
}

export function rectsOverlap(a: PieceRect, b: PieceRect) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function pieceCollisionPadding(board: JigsawBoardArtifact) {
    const size = averagePieceSize(board);
    return Math.max(6, Math.min(size.width, size.height) * 0.08);
}

export function overlapArea(a: PieceRect, b: PieceRect) {
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width * height;
}

function findNonOverlappingPiecePosition({
    board,
    piece,
    stage,
    placed,
    padding,
    gap,
    baseOffset,
    ringGap,
    maxRings,
    laneRotation,
    slotRotation,
}: {
    board: JigsawBoardArtifact;
    piece: number;
    stage: StageSize;
    placed: PieceRect[];
    padding: number;
    gap: number;
    baseOffset: number;
    ringGap: number;
    maxRings: number;
    laneRotation: number;
    slotRotation: number;
}) {
    let fallback: {position: Coord; score: number} | null = null;
    for (let ring = 0; ring < maxRings; ring++) {
        for (let laneIndex = 0; laneIndex < 4; laneIndex++) {
            const lane = (laneIndex + laneRotation) % 4;
            const slots = slotsForLane(board, piece, stage, lane, padding, gap);
            for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
                const slot = (slotIndex + slotRotation) % slots;
                const position = positionForLaneSlot({
                    lane,
                    slot,
                    slots,
                    stage,
                    offset: baseOffset + ring * ringGap,
                });
                const rect = rectForPiece(board, piece, position, padding);
                const score = totalOverlapArea(rect, placed);
                if (score === 0) return position;
                if (!fallback || score < fallback.score) fallback = {position, score};
            }
        }
    }
    return fallback?.position ?? {x: -baseOffset, y: -baseOffset};
}

function slotsForLane(
    board: JigsawBoardArtifact,
    piece: number,
    stage: StageSize,
    lane: number,
    padding: number,
    gap: number,
) {
    const bounds = board.pieces[piece]?.bounds;
    const projectedSize = lane === 0 || lane === 2 ? bounds?.width ?? 1 : bounds?.height ?? 1;
    const laneLength = lane === 0 || lane === 2 ? stage.width : stage.height;
    const footprint = Math.max(1, projectedSize + padding * 2 + gap);
    return Math.max(1, Math.floor(laneLength / footprint));
}

function positionForLaneSlot({
    lane,
    slot,
    slots,
    stage,
    offset,
}: {
    lane: number;
    slot: number;
    slots: number;
    stage: StageSize;
    offset: number;
}) {
    const horizontal = lane === 0 || lane === 2;
    const laneLength = (horizontal ? stage.width : stage.height) + offset * 2;
    const distance = slots === 1 ? laneLength / 2 : (slot / (slots - 1)) * laneLength;
    switch (lane) {
        case 0:
            return {x: distance - offset, y: -offset};
        case 1:
            return {x: stage.width + offset, y: distance - offset};
        case 2:
            return {x: stage.width + offset - distance, y: stage.height + offset};
        default:
            return {x: -offset, y: stage.height + offset - distance};
    }
}

function totalOverlapArea(rect: PieceRect, placed: PieceRect[]) {
    return placed.reduce((total, placedRect) => total + overlapArea(rect, placedRect), 0);
}

function normalizedSeed(seed: number) {
    return Math.abs(Math.trunc(seed || 0));
}

export function snapCandidates({
    board,
    layout,
    draggedPieces,
    draggedPositions,
    allPositions,
    snapThreshold,
    distanceBetween = distance,
}: {
    board: JigsawBoardArtifact;
    layout: PuzzleLayout;
    draggedPieces: Set<number>;
    draggedPositions: Map<number, Coord>;
    allPositions: Map<number, Coord>;
    snapThreshold: number;
    distanceBetween?: (a: Coord, b: Coord) => number;
}): SnapCandidate[] {
    const candidates: SnapCandidate[] = [];
    const existing = new Set(layout.connections.map((connection) => connection.key));
    const draggedMaxDepth = maxDepth(draggedPieces, layout.depths);

    for (const from of draggedPieces) {
        const fromPosition = draggedPositions.get(from);
        if (!fromPosition) continue;
        for (const neighbor of board.pieces[from]?.neighbors ?? []) {
            if (draggedPieces.has(neighbor.piece)) continue;
            const key = connectionKey(from, neighbor.piece);
            if (existing.has(key)) continue;
            const neighborPosition = allPositions.get(neighbor.piece);
            if (!neighborPosition) continue;
            const expected = add(fromPosition, neighbor.offset);
            if (distanceBetween(expected, neighborPosition) > snapThreshold) continue;
            const strength = snapStrength({
                draggedMaxDepth,
                draggedEndpointDepth: layout.depths.get(from) ?? 0,
            });
            candidates.push({from, to: neighbor.piece, key, strength});
        }
    }

    return candidates;
}

export function snapStrength({
    draggedMaxDepth,
    draggedEndpointDepth,
}: {
    draggedMaxDepth: number;
    draggedEndpointDepth: number;
}) {
    return Math.max(1, draggedMaxDepth - draggedEndpointDepth + 1);
}

export function positionPatch(
    state: JigsawState,
    piece: number,
    position: Coord,
): DraftPatch<JigsawState> {
    return {
        op: state.positions[pieceKey(piece)] ? 'replace' : 'add',
        path: [
            {type: 'key', key: 'positions'},
            {type: 'key', key: pieceKey(piece)},
        ],
        value: position,
    };
}

export function removePositionPatch(piece: number): DraftPatch<JigsawState> {
    return {
        op: 'remove',
        path: [
            {type: 'key', key: 'positions'},
            {type: 'key', key: pieceKey(piece)},
        ],
    };
}

export function outsideTorusDropPatches(
    state: JigsawState,
    component: number[],
): OutsideTorusDropResult {
    if (component.length !== 1) return {type: 'cancel'};
    const [piece] = component;
    if (piece === undefined || state.positions[pieceKey(piece)] === undefined) {
        return {type: 'patches', patches: []};
    }
    return {type: 'patches', patches: [removePositionPatch(piece)]};
}

export function connectionPatch(candidate: SnapCandidate): DraftPatch<JigsawState> {
    return {
        op: 'add',
        path: [
            {type: 'key', key: 'connections'},
            {type: 'key', key: candidate.key},
        ],
        value: candidate.strength,
    };
}

export function estimatedPieceSize(board: JigsawBoardArtifact) {
    return maxPieceSize(board);
}

export function snapThreshold(board: JigsawBoardArtifact) {
    const size = averagePieceSize(board);
    return Math.max(8, Math.min(size.width, size.height) * 0.12);
}

export function maxPieceSize(board: JigsawBoardArtifact) {
    return board.pieces.reduce(
        (size, piece) => ({
            width: Math.max(size.width, piece.bounds.width),
            height: Math.max(size.height, piece.bounds.height),
        }),
        {width: 0, height: 0},
    );
}

function averagePieceSize(board: JigsawBoardArtifact) {
    if (!board.pieces.length) return {width: 0, height: 0};
    const total = board.pieces.reduce(
        (size, piece) => ({
            width: size.width + piece.bounds.width,
            height: size.height + piece.bounds.height,
        }),
        {width: 0, height: 0},
    );
    return {
        width: total.width / board.pieces.length,
        height: total.height / board.pieces.length,
    };
}

export function add(a: Coord, b: Coord): Coord {
    return {x: a.x + b.x, y: a.y + b.y};
}

export function subtract(a: Coord, b: Coord): Coord {
    return {x: a.x - b.x, y: a.y - b.y};
}

export function distance(a: Coord, b: Coord) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function positiveModulo(value: number, size: number) {
    if (size <= 0) return value;
    return ((value % size) + size) % size;
}

export function canonicalTorusPoint(
    point: Coord,
    size: {width: number; height: number},
): Coord {
    return {
        x: positiveModulo(point.x, size.width),
        y: positiveModulo(point.y, size.height),
    };
}

export function shortestWrappedDelta(
    from: Coord,
    to: Coord,
    size: {width: number; height: number},
): Coord {
    return {
        x: shortestAxisDelta(from.x, to.x, size.width),
        y: shortestAxisDelta(from.y, to.y, size.height),
    };
}

export function wrappedDistance(
    a: Coord,
    b: Coord,
    size: {width: number; height: number},
) {
    const delta = shortestWrappedDelta(a, b, size);
    return Math.hypot(delta.x, delta.y);
}

export function nearestEquivalentPoint(
    point: Coord,
    reference: Coord,
    size: {width: number; height: number},
): Coord {
    return {
        x: nearestEquivalentAxis(point.x, reference.x, size.width),
        y: nearestEquivalentAxis(point.y, reference.y, size.height),
    };
}

export function torusPieceCopies({
    board,
    piece,
    position,
    pan,
    viewport,
}: {
    board: JigsawBoardArtifact;
    piece: number;
    position: Coord;
    pan: Coord;
    viewport?: PieceRect;
}): TorusPieceCopy[] {
    const imageSize = board.imageSize;
    const base = canonicalTorusPoint(add(position, pan), imageSize);
    const tileOffsets = [
        {x: -imageSize.width, y: -imageSize.height},
        {x: 0, y: -imageSize.height},
        {x: imageSize.width, y: -imageSize.height},
        {x: -imageSize.width, y: 0},
        {x: 0, y: 0},
        {x: imageSize.width, y: 0},
        {x: -imageSize.width, y: imageSize.height},
        {x: 0, y: imageSize.height},
        {x: imageSize.width, y: imageSize.height},
    ];
    const bounds = viewport ?? {
        left: 0,
        top: 0,
        right: imageSize.width,
        bottom: imageSize.height,
    };

    return tileOffsets.flatMap((tileOffset): TorusPieceCopy[] => {
        const copyPosition = add(base, tileOffset);
        const rect = rectForPiece(board, piece, copyPosition);
        if (!rectsOverlap(rect, bounds)) return [];
        return [
            {
                key: `${tileOffset.x}:${tileOffset.y}`,
                position: copyPosition,
                tileOffset,
                rect,
                primary: tileOffset.x === 0 && tileOffset.y === 0,
            },
        ];
    });
}

export function isInsideTorusViewport(point: Coord, imageSize: {width: number; height: number}) {
    return point.x >= 0 && point.x <= imageSize.width && point.y >= 0 && point.y <= imageSize.height;
}

function shortestAxisDelta(from: number, to: number, size: number) {
    const delta = to - from;
    if (size <= 0) return delta;
    return delta - Math.round(delta / size) * size;
}

function nearestEquivalentAxis(value: number, reference: number, size: number) {
    if (size <= 0) return value;
    return value + Math.round((reference - value) / size) * size;
}

function stronglyConnectedComponents(pieceCount: number, connections: ValidConnection[]) {
    const adjacency = new Map<number, number[]>();
    for (let index = 0; index < pieceCount; index++) adjacency.set(index, []);
    for (const connection of connections) adjacency.get(connection.from)?.push(connection.to);

    let nextIndex = 0;
    const stack: number[] = [];
    const onStack = new Set<number>();
    const indexes = new Map<number, number>();
    const lowLinks = new Map<number, number>();
    const components: number[][] = [];

    const visit = (piece: number) => {
        indexes.set(piece, nextIndex);
        lowLinks.set(piece, nextIndex);
        nextIndex++;
        stack.push(piece);
        onStack.add(piece);

        for (const next of adjacency.get(piece) ?? []) {
            if (!indexes.has(next)) {
                visit(next);
                lowLinks.set(piece, Math.min(lowLinks.get(piece)!, lowLinks.get(next)!));
            } else if (onStack.has(next)) {
                lowLinks.set(piece, Math.min(lowLinks.get(piece)!, indexes.get(next)!));
            }
        }

        if (lowLinks.get(piece) !== indexes.get(piece)) return;
        const component: number[] = [];
        while (stack.length) {
            const current = stack.pop()!;
            onStack.delete(current);
            component.push(current);
            if (current === piece) break;
        }
        components.push(component.sort((a, b) => a - b));
    };

    for (let piece = 0; piece < pieceCount; piece++) {
        if (!indexes.has(piece)) visit(piece);
    }
    return components;
}

function connectedNeighborsForComponent(
    board: JigsawBoardArtifact,
    component: number[],
    connections: ValidConnection[],
) {
    const componentSet = new Set(component);
    const neighbors = new Map<number, Array<{piece: number; offset: Coord}>>();
    for (const piece of component) neighbors.set(piece, []);

    for (const connection of connections) {
        if (!componentSet.has(connection.from) || !componentSet.has(connection.to)) continue;
        const offset = neighborOffset(board, connection.from, connection.to);
        if (!offset) continue;
        neighbors.get(connection.from)?.push({piece: connection.to, offset});
        neighbors
            .get(connection.to)
            ?.push({piece: connection.from, offset: {x: -offset.x, y: -offset.y}});
    }
    return neighbors;
}

function neighborOffset(board: JigsawBoardArtifact, from: number, to: number) {
    return board.pieces[from]?.neighbors.find((neighbor) => neighbor.piece === to)?.offset ?? null;
}

function maxDepth(pieces: Set<number>, depths: Map<number, number>) {
    let max = 0;
    for (const piece of pieces) max = Math.max(max, depths.get(piece) ?? 0);
    return max;
}

function isPieceIndex(board: JigsawBoardArtifact, piece: number) {
    return Number.isInteger(piece) && piece >= 0 && piece < board.pieces.length;
}

export {
    endpointPolygonForPiece,
    isPlacedPieceOutsideStage,
    maxAllowedPieceOverlapRatio,
    packingMetricsForPositions,
    pieceBorderDistanceFromStage,
    placedPieceOverlapRatio,
    polygonArea as packingPolygonArea,
    polygonOverlapArea,
    polygonOverlapRatio,
} from './jigsawPacking';
