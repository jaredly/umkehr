import {describe, expect, it} from 'vitest';
import {artifactFingerprintHash} from '../../lib/artifacts';
import {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_BOARD_ARTIFACT_ID,
    JIGSAW_BOARD_KIND,
    JIGSAW_BOARD_VERSION,
    currentJigsawBoard,
    generateJigsawBoard,
    initialJigsawArtifacts,
    isJigsawPieceCount,
    jigsawArtifactStore,
    type JigsawPieceCount,
} from './artifacts';
import {jigsawApp} from './JigsawApp';
import type {JigsawState} from './schema';
import {
    anchorPieceForComponent,
    arrangeUnplacedPieces,
    buildPuzzleLayout,
    connectionKey,
    connectionPatch,
    estimatedPieceSize,
    overlapArea,
    pieceCollisionPadding,
    pieceDepths,
    rectForPiece,
    rectsOverlap,
    snapCandidates,
    snapStrength,
    validConnections,
} from './jigsaw';

describe('jigsaw board artifacts', () => {
    it.each([
        [12, 4, 3],
        [30, 6, 5],
        [60, 10, 6],
        [120, 15, 8],
    ] satisfies Array<[JigsawPieceCount, number, number]>)(
        'generates a %s-piece %sx%s rectangular board',
        (pieceCount, cols, rows) => {
            const board = generateJigsawBoard(pieceCount);
            expect(board.id).toBe(JIGSAW_BOARD_ARTIFACT_ID);
            expect(board.image).toBe('stock:hue');
            expect(board.pieces).toHaveLength(pieceCount);
            expect(estimatedPieceSize(board)).toEqual({
                width: board.imageSize.width / cols,
                height: board.imageSize.height / rows,
            });
            board.pieces.forEach((piece) => {
                expect(piece.bounds).toEqual({
                    left: -board.imageSize.width / cols / 2,
                    top: -board.imageSize.height / rows / 2,
                    width: board.imageSize.width / cols,
                    height: board.imageSize.height / rows,
                });
            });
        },
    );

    it('generates concrete Voronoi board geometry', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi'});
        expect(board.id).toBe(JIGSAW_BOARD_ARTIFACT_ID);
        expect(board.image).toBe('stock:hue');
        expect(board.pieces).toHaveLength(30);
        expect(board.title).toContain('Voronoi');
        expect(totalMaskArea(board)).toBeCloseTo(board.imageSize.width * board.imageSize.height, -4);

        board.pieces.forEach((piece, index) => {
            expect(Number.isFinite(piece.center.x)).toBe(true);
            expect(Number.isFinite(piece.center.y)).toBe(true);
            expect(piece.bounds.width).toBeGreaterThan(0);
            expect(piece.bounds.height).toBeGreaterThan(0);
            expect(piece.mask.length).toBeGreaterThanOrEqual(3);
            expect(piece.neighbors.length).toBeGreaterThanOrEqual(2);
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('uses Voronoi neighbor geometry for connection validation', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi'});
        const neighbor = board.pieces[0].neighbors[0];
        expect(validConnections(board, {[connectionKey(0, neighbor.piece)]: 1})).toEqual([
            {key: connectionKey(0, neighbor.piece), from: 0, to: neighbor.piece, strength: 1},
        ]);

        const nonNeighbor = board.pieces.findIndex(
            (_piece, index) => index !== 0 && !board.pieces[0].neighbors.some((entry) => entry.piece === index),
        );
        expect(nonNeighbor).toBeGreaterThan(0);
        expect(validConnections(board, {[connectionKey(0, nonNeighbor)]: 1})).toEqual([]);
    });

    it('generates reciprocal neighbor offsets', () => {
        const board = generateJigsawBoard(12);
        board.pieces.forEach((piece, index) => {
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('serializes, manifests, and loads the current board', () => {
        const manifest = jigsawArtifactStore.manifest();
        expect(manifest).toEqual([
            expect.objectContaining({
                id: JIGSAW_BOARD_ARTIFACT_ID,
                kind: 'jigsaw-board',
                version: 1,
            }),
        ]);
        const serialized = jigsawArtifactStore.serialize(JIGSAW_BOARD_ARTIFACT_ID);
        expect(serialized?.data).toEqual(currentJigsawBoard());
        expect(jigsawArtifactStore.createInitial?.()[0].data).toMatchObject({
            pieceCount: DEFAULT_JIGSAW_PIECE_COUNT,
        });
        if (serialized) jigsawArtifactStore.load(serialized);
        expect(currentJigsawBoard()).toEqual(serialized?.data);
    });

    it('loads legacy rectangular artifacts without piece bounds', () => {
        const board = generateJigsawBoard(12);
        const legacyBoard = {
            ...board,
            pieces: board.pieces.map(({bounds: _bounds, ...piece}) => piece),
        };
        jigsawArtifactStore.load({
            id: JIGSAW_BOARD_ARTIFACT_ID,
            kind: JIGSAW_BOARD_KIND,
            version: JIGSAW_BOARD_VERSION,
            fingerprintHash: artifactFingerprintHash(legacyBoard),
            data: legacyBoard,
        });
        expect(currentJigsawBoard().pieces.every((piece) => piece.bounds.width > 0)).toBe(true);
        expect(currentJigsawBoard().pieces[0].bounds).toEqual(board.pieces[0].bounds);
    });

    it('validates creation piece counts and creates matching initial artifacts', () => {
        expect(isJigsawPieceCount(12)).toBe(true);
        expect(isJigsawPieceCount(30)).toBe(true);
        expect(isJigsawPieceCount(60)).toBe(true);
        expect(isJigsawPieceCount(120)).toBe(true);
        expect(isJigsawPieceCount(24)).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'rectangular'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'voronoi'})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'voronoi'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 24}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'spiral'}).success).toBe(false);
        expect(initialJigsawArtifacts(60)[0].data).toMatchObject({pieceCount: 60});
        expect(initialJigsawArtifacts(60, {type: 'voronoi'})[0].data).toMatchObject({
            pieceCount: 60,
            title: expect.stringContaining('Voronoi'),
        });
        const appArtifacts = jigsawApp.documentInit?.initialArtifacts?.({pieceCount: 120, type: 'voronoi'});
        expect(appArtifacts?.[0].data).toMatchObject({
            pieceCount: 120,
            title: expect.stringContaining('Voronoi'),
        });
    });
});

describe('jigsaw placement logic', () => {
    it('filters invalid connections', () => {
        const board = generateJigsawBoard(12);
        expect(
            validConnections(board, {
                [connectionKey(0, 1)]: 1,
                [connectionKey(0, 2)]: 1,
                [connectionKey(0, 0)]: 1,
                'bad:key': 1,
                [connectionKey(1, 2)]: 0,
            }),
        ).toEqual([{key: connectionKey(0, 1), from: 0, to: 1, strength: 1}]);
    });

    it('computes weighted depths through merges and cycles', () => {
        const board = generateJigsawBoard(12);
        const connections = validConnections(board, {
            [connectionKey(0, 1)]: 1,
            [connectionKey(1, 2)]: 4,
            [connectionKey(4, 5)]: 2,
            [connectionKey(5, 1)]: 3,
            [connectionKey(6, 7)]: 1,
            [connectionKey(7, 11)]: 1,
            [connectionKey(11, 10)]: 1,
            [connectionKey(10, 6)]: 1,
            [connectionKey(2, 6)]: 6,
        });
        const depths = pieceDepths(board, connections);
        expect(depths.get(0)).toBe(0);
        expect(depths.get(1)).toBe(5);
        expect(depths.get(2)).toBe(9);
        expect(depths.get(6)).toBe(15);
        expect(depths.get(7)).toBe(15);
        expect(depths.get(10)).toBe(15);
        expect(depths.get(11)).toBe(15);
    });

    it('chooses anchors by greatest weighted depth and largest index tie-break', () => {
        const board = generateJigsawBoard(12);
        const connections = validConnections(board, {
            [connectionKey(0, 1)]: 1,
            [connectionKey(1, 2)]: 1,
        });
        const depths = pieceDepths(board, connections);
        expect(anchorPieceForComponent([0, 1, 2], {'0': {x: 0, y: 0}, '2': {x: 2, y: 0}}, depths)).toBe(
            2,
        );
        expect(anchorPieceForComponent([0, 1], {'0': {x: 0, y: 0}, '1': {x: 1, y: 0}}, new Map())).toBe(
            1,
        );
    });

    it('derives component positions from the selected anchor and ignores stale non-anchor positions', () => {
        const board = generateJigsawBoard(12);
        const state: JigsawState = {
            positions: {
                '0': {x: 999, y: 999},
                '2': {x: 300, y: 90},
            },
            connections: {
                [connectionKey(0, 1)]: 1,
                [connectionKey(1, 2)]: 1,
            },
        };
        const layout = buildPuzzleLayout(board, state);
        expect(layout.anchors.get(layout.pieceToComponent.get(0)!)).toBe(2);
        expect(layout.positions.get(2)).toEqual({x: 300, y: 90});
        expect(layout.positions.get(1)).toEqual({x: 120, y: 90});
        expect(layout.positions.get(0)).toEqual({x: -60, y: 90});
    });

    it('creates all eligible correct-neighbor snap candidates with destination-winning strength', () => {
        const board = generateJigsawBoard(12);
        const state: JigsawState = {
            positions: {
                '0': {x: 0, y: 0},
                '1': {x: 180, y: 0},
                '5': {x: 180, y: 180},
            },
            connections: {[connectionKey(0, 1)]: 1},
        };
        const layout = buildPuzzleLayout(board, state);
        const draggedPieces = new Set([0, 1]);
        const draggedPositions = new Map([
            [0, {x: 0, y: 0}],
            [1, {x: 180, y: 0}],
        ]);
        const allPositions = new Map(layout.positions);
        allPositions.set(0, {x: 0, y: 0});
        allPositions.set(1, {x: 180, y: 0});
        allPositions.set(5, {x: 180, y: 180});

        const candidates = snapCandidates({
            board,
            layout,
            draggedPieces,
            draggedPositions,
            allPositions,
            snapThreshold: 2,
        });

        expect(candidates).toEqual([{from: 1, to: 5, key: connectionKey(1, 5), strength: 1}]);
        expect(connectionPatch(candidates[0])).toEqual({
            op: 'add',
            path: [
                {type: 'key', key: 'connections'},
                {type: 'key', key: connectionKey(1, 5)},
            ],
            value: 1,
        });
    });

    it('computes stronger snap edges when the dragged endpoint is shallower than the dragged anchor', () => {
        expect(snapStrength({draggedMaxDepth: 5, draggedEndpointDepth: 2})).toBe(4);
    });

    it('arranges unplaced pieces deterministically around the stage border', () => {
        const board = generateJigsawBoard(12);
        expect(arrangeUnplacedPieces(board, [0, 1, 2], {width: 720, height: 540}, 123)).toEqual(
            arrangeUnplacedPieces(board, [0, 1, 2], {width: 720, height: 540}, 123),
        );
    });

    it('detects rectangle overlap and edge-touching correctly', () => {
        expect(
            rectsOverlap(
                {left: 0, top: 0, right: 10, bottom: 10},
                {left: 9, top: 9, right: 20, bottom: 20},
            ),
        ).toBe(true);
        expect(overlapArea(
            {left: 0, top: 0, right: 10, bottom: 10},
            {left: 9, top: 9, right: 20, bottom: 20},
        )).toBe(1);
        expect(
            rectsOverlap(
                {left: 0, top: 0, right: 10, bottom: 10},
                {left: 10, top: 0, right: 20, bottom: 10},
            ),
        ).toBe(false);
    });

    it.each([12, 30, 60, 120] satisfies JigsawPieceCount[])(
        'arranges all %s rectangular pieces without bounding-box overlap',
        (pieceCount) => {
            const board = generateJigsawBoard(pieceCount);
            const pieces = board.pieces.map((_piece, index) => index);
            const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
            expect(positions.size).toBe(pieceCount);
            expectNoArrangedOverlap(board, positions, pieceCollisionPadding(board));
        },
    );

    it('extends shuffle lanes into expanded corner quadrants', () => {
        const board = generateJigsawBoard(12);
        const positions = arrangeUnplacedPieces(
            board,
            board.pieces.map((_piece, index) => index),
            board.imageSize,
            0,
        );
        const cornerBand = 60;
        const corners = [
            (position: {x: number; y: number}) => position.x < 0 && position.y < 0,
            (position: {x: number; y: number}) =>
                position.x > board.imageSize.width && position.y < 0,
            (position: {x: number; y: number}) =>
                position.x > board.imageSize.width && position.y > board.imageSize.height,
            (position: {x: number; y: number}) =>
                position.x < 0 && position.y > board.imageSize.height,
        ];
        const arranged = Array.from(positions.values());
        expect(corners.every((matches) => arranged.some(matches))).toBe(true);
        expect(
            arranged.some(
                (position) =>
                    position.x < cornerBand &&
                    position.y < cornerBand,
            ),
        ).toBe(true);
    });

    it('arranges Voronoi pieces without bounding-box overlap', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi'});
        const pieces = board.pieces.map((_piece, index) => index);
        const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
        expect(positions.size).toBe(30);
        expectNoArrangedOverlap(board, positions, pieceCollisionPadding(board));
    });

    it('returns no unplaced positions for empty input or invalid stages', () => {
        const board = generateJigsawBoard(12);
        expect(arrangeUnplacedPieces(board, [], board.imageSize, 1).size).toBe(0);
        expect(arrangeUnplacedPieces(board, [0, 1], {width: 0, height: 540}, 1).size).toBe(0);
        expect(arrangeUnplacedPieces(board, [0, 1], {width: 720, height: 0}, 1).size).toBe(0);
    });
});

function expectNoArrangedOverlap(
    board: ReturnType<typeof generateJigsawBoard>,
    positions: Map<number, {x: number; y: number}>,
    padding: number,
) {
    const rects = Array.from(positions, ([piece, position]) => ({
        piece,
        rect: rectForPiece(board, piece, position, padding),
    }));
    for (let a = 0; a < rects.length; a++) {
        for (let b = a + 1; b < rects.length; b++) {
            expect(
                rectsOverlap(rects[a].rect, rects[b].rect),
                `expected pieces ${rects[a].piece} and ${rects[b].piece} not to overlap`,
            ).toBe(false);
        }
    }
}

function maskFitsBounds(piece: {bounds: {left: number; top: number; width: number; height: number}; mask: Array<{to: {x: number; y: number}}>}) {
    const right = piece.bounds.left + piece.bounds.width;
    const bottom = piece.bounds.top + piece.bounds.height;
    return piece.mask.every(
        (segment) =>
            segment.to.x >= piece.bounds.left - 1e-6 &&
            segment.to.x <= right + 1e-6 &&
            segment.to.y >= piece.bounds.top - 1e-6 &&
            segment.to.y <= bottom + 1e-6,
    );
}

function totalMaskArea(board: ReturnType<typeof generateJigsawBoard>) {
    return board.pieces.reduce((sum, piece) => sum + polygonArea(piece.mask.map((segment) => segment.to)), 0);
}

function polygonArea(points: Array<{x: number; y: number}>) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
}
