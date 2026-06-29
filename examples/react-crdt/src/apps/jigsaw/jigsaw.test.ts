import {describe, expect, it} from 'vitest';
import {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_BOARD_ARTIFACT_ID,
    currentJigsawBoard,
    generateJigsawBoard,
    jigsawArtifactStore,
    type JigsawPieceCount,
} from './artifacts';
import type {JigsawState} from './schema';
import {
    anchorPieceForComponent,
    arrangeUnplacedPieces,
    buildPuzzleLayout,
    connectionKey,
    connectionPatch,
    estimatedPieceSize,
    pieceDepths,
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
        },
    );

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
});
