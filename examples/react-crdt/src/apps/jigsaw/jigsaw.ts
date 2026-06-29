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
        for (const [piece, position] of positionsForComponent(board, component, anchor, anchorPosition)) {
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
) {
    const componentSet = new Set(component);
    const positions = new Map<number, Coord>([[anchor, anchorPosition]]);
    const queue = [anchor];
    while (queue.length) {
        const current = queue.shift()!;
        const currentPosition = positions.get(current)!;
        const neighbors = physicalNeighborsInComponent(board, current, componentSet);
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
    const laneLength = horizontal ? stage.width : stage.height;
    const distance = ((slot + 0.5) / slots) * laneLength;
    switch (lane) {
        case 0:
            return {x: distance, y: -offset};
        case 1:
            return {x: stage.width + offset, y: distance};
        case 2:
            return {x: stage.width - distance, y: stage.height + offset};
        default:
            return {x: -offset, y: stage.height - distance};
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
}: {
    board: JigsawBoardArtifact;
    layout: PuzzleLayout;
    draggedPieces: Set<number>;
    draggedPositions: Map<number, Coord>;
    allPositions: Map<number, Coord>;
    snapThreshold: number;
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
            if (distance(expected, neighborPosition) > snapThreshold) continue;
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

function physicalNeighborsInComponent(
    board: JigsawBoardArtifact,
    piece: number,
    component: Set<number>,
) {
    const neighbors: Array<{piece: number; offset: Coord}> = [];
    for (const neighbor of board.pieces[piece]?.neighbors ?? []) {
        if (component.has(neighbor.piece)) neighbors.push(neighbor);
    }
    for (const [candidate, candidatePiece] of board.pieces.entries()) {
        if (!component.has(candidate) || candidate === piece) continue;
        const reverse = candidatePiece.neighbors.find((neighbor) => neighbor.piece === piece);
        if (reverse) neighbors.push({piece: candidate, offset: {x: -reverse.offset.x, y: -reverse.offset.y}});
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
