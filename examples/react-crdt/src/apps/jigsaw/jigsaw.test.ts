import {describe, expect, it} from 'vitest';
import {artifactFingerprintHash} from '../../lib/artifacts';
import {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_ARTIFACT_IMAGE_REF,
    JIGSAW_BOARD_ARTIFACT_ID,
    JIGSAW_BOARD_KIND,
    JIGSAW_BOARD_VERSION,
    JIGSAW_IMAGE_ARTIFACT_ID,
    JIGSAW_IMAGE_KIND,
    JIGSAW_IMAGE_VERSION,
    currentJigsawBoard,
    currentJigsawImage,
    generateJigsawBoard,
    initialJigsawArtifacts,
    isJigsawImageArtifact,
    isJigsawPieceCount,
    isJigsawSurface,
    jigsawArtifactStore,
    type JigsawImageArtifact,
    type JigsawPieceCount,
} from './artifacts';
import {jigsawApp} from './JigsawApp';
import type {JigsawState} from './schema';
import {
    anchorPieceForComponent,
    arrangeUnplacedPieces,
    arrangeUnplacedPiecesBestFirstGrid,
    arrangeUnplacedPiecesPerimeterShelves,
    buildPuzzleLayout,
    canonicalTorusPoint,
    connectionKey,
    connectionPatch,
    endpointPolygonForPiece,
    estimatedPieceSize,
    isInsideTorusViewport,
    isPlacedPieceOutsideStage,
    nearestEquivalentPoint,
    outsideTorusDropPatches,
    packingMetricsForPositions,
    packingPolygonArea,
    pieceBorderDistanceFromStage,
    placedPieceOverlapRatio,
    overlapArea,
    polygonOverlapArea,
    polygonOverlapRatio,
    positiveModulo,
    pieceDepths,
    rectsOverlap,
    removePositionPatch,
    snapCandidates,
    snapStrength,
    torusLogicalDropPosition,
    torusPieceCopies,
    validConnections,
    wrappedDistance,
} from './jigsaw';

describe('jigsaw board artifacts', () => {
    it.each([
        [12, 4, 3],
        [30, 6, 5],
        [60, 10, 6],
        [120, 15, 8],
        [600, 30, 20],
        [1000, 40, 25],
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

    it('defaults plane boards by omitting the surface field', () => {
        const board = generateJigsawBoard(12);
        expect(isJigsawSurface('plane')).toBe(true);
        expect(isJigsawSurface('torus')).toBe(true);
        expect(isJigsawSurface('sphere')).toBe(false);
        expect(board.surface).toBeUndefined();
        expect(initialJigsawArtifacts(12, {surface: 'plane'})[0].data).not.toHaveProperty('surface');
    });

    it('generates rectangular torus boards with wrapped neighbors and shortest offsets', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        expect(board.surface).toBe('torus');
        expect(board.title).toBe('12 piece torus hue puzzle');
        expect(board.pieces.every((piece) => piece.neighbors.length === 4)).toBe(true);

        const rightToLeft = board.pieces[3].neighbors.find((neighbor) => neighbor.piece === 0);
        const leftToRight = board.pieces[0].neighbors.find((neighbor) => neighbor.piece === 3);
        expect(rightToLeft?.offset).toEqual({x: 180, y: 0});
        expect(leftToRight?.offset).toEqual({x: -180, y: -0});

        const bottomToTop = board.pieces[8].neighbors.find((neighbor) => neighbor.piece === 0);
        const topToBottom = board.pieces[0].neighbors.find((neighbor) => neighbor.piece === 8);
        expect(bottomToTop?.offset).toEqual({x: 0, y: 180});
        expect(topToBottom?.offset).toEqual({x: -0, y: -180});

        expect(validConnections(board, {[connectionKey(3, 0)]: 1, [connectionKey(8, 0)]: 1})).toEqual([
            {key: connectionKey(3, 0), from: 3, to: 0, strength: 1},
            {key: connectionKey(8, 0), from: 8, to: 0, strength: 1},
        ]);
    });

    it('generates tabbed rectangular torus seam geometry', () => {
        const board = generateJigsawBoard(12, {surface: 'torus', tabs: true, seed: 'torus-tabs'});
        expect(board.surface).toBe('torus');
        expect(board.pieces.every((piece) => piece.neighbors.length === 4)).toBe(true);
        expect(board.pieces.some((piece) => hasCurvedSegment(piece.mask))).toBe(true);
        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

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
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('generates rectangular board geometry for an uploaded image size', () => {
        const board = generateJigsawBoard(30, {
            image: JIGSAW_ARTIFACT_IMAGE_REF,
            imageSize: {width: 640, height: 360},
            imageName: 'lake.jpg',
        });
        expect(board.image).toBe(JIGSAW_ARTIFACT_IMAGE_REF);
        expect(board.imageSize).toEqual({width: 640, height: 360});
        expect(board.title).toBe('30 piece lake.jpg puzzle');
        expect(estimatedPieceSize(board)).toEqual({width: 640 / 6, height: 360 / 5});
        expect(board.pieces[0].bounds).toEqual({
            left: -640 / 6 / 2,
            top: -360 / 5 / 2,
            width: 640 / 6,
            height: 360 / 5,
        });
    });

    it('generates Voronoi board geometry for an uploaded image size', () => {
        const board = generateJigsawBoard(30, {
            type: 'voronoi',
            image: JIGSAW_ARTIFACT_IMAGE_REF,
            imageSize: {width: 360, height: 640},
            imageName: 'portrait.webp',
        });
        expect(board.image).toBe(JIGSAW_ARTIFACT_IMAGE_REF);
        expect(board.imageSize).toEqual({width: 360, height: 640});
        expect(board.title).toBe('30 piece Voronoi portrait.webp puzzle');
        expect(board.pieces).toHaveLength(30);
        expect(totalMaskArea(board)).toBeCloseTo(360 * 640, -4);
    });

    it('generates tabbed rectangular board geometry', () => {
        const board = generateJigsawBoard(30, {tabs: true});
        expect(board.pieces).toHaveLength(30);
        expect(board.title).toBe('30 piece tabbed hue puzzle');
        expect(board.pieces.some((piece) => hasCurvedSegment(piece.mask))).toBe(true);
        expect(maxCurveExcursion(board)).toBeGreaterThan(20);

        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('generates tabbed Voronoi board geometry', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi', tabs: true});
        expect(board.pieces).toHaveLength(30);
        expect(board.title).toContain('tabbed Voronoi');
        expect(board.pieces.some((piece) => hasCurvedSegment(piece.mask))).toBe(true);
        expect(maxCurveExcursion(board)).toBeGreaterThan(12);

        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('generates periodic Voronoi torus board geometry', () => {
        const board = generateJigsawBoard(30, {
            type: 'voronoi',
            surface: 'torus',
            seed: 'periodic-voronoi',
        });
        expect(board.surface).toBe('torus');
        expect(board.pieces).toHaveLength(30);
        expect(board.title).toContain('torus Voronoi');

        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            expect(piece.neighbors.length).toBeGreaterThanOrEqual(3);
            piece.neighbors.forEach((neighbor) => {
                expect(neighbor.piece).not.toBe(index);
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });

        const seamNeighbor = board.pieces.findIndex((piece, index) =>
            piece.neighbors.some((neighbor) => {
                const other = board.pieces[neighbor.piece];
                const rawDx = Math.abs(other.center.x - board.pieces[index].center.x);
                const rawDy = Math.abs(other.center.y - board.pieces[index].center.y);
                return rawDx > board.imageSize.width / 2 || rawDy > board.imageSize.height / 2;
            }),
        );
        expect(seamNeighbor).toBeGreaterThanOrEqual(0);
    });

    it('generates tabbed periodic Voronoi torus board geometry', () => {
        const board = generateJigsawBoard(30, {
            type: 'voronoi',
            surface: 'torus',
            tabs: true,
            seed: 'periodic-voronoi-tabs',
        });
        expect(board.surface).toBe('torus');
        expect(board.pieces).toHaveLength(30);
        expect(board.pieces.some((piece) => hasCurvedSegment(piece.mask))).toBe(true);
        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            piece.neighbors.forEach((neighbor) => {
                const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
                expect(reverse).toBeTruthy();
                expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
                expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
            });
        });
    });

    it('uses a seed for reproducible tabbed rectangular randomness', () => {
        const a = generateJigsawBoard(30, {tabs: true, seed: 'tabs-a'});
        const b = generateJigsawBoard(30, {tabs: true, seed: 'tabs-a'});
        const c = generateJigsawBoard(30, {tabs: true, seed: 'tabs-b'});

        expect(a).toEqual(b);
        expect(a.pieces.map((piece) => piece.mask)).not.toEqual(c.pieces.map((piece) => piece.mask));
    });

    it('uses a seed for reproducible Voronoi site and tab randomness', () => {
        const a = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 1234});
        const b = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 1234});
        const c = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 5678});

        expect(a).toEqual(b);
        expect(a.pieces.map((piece) => piece.center)).not.toEqual(c.pieces.map((piece) => piece.center));
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

    it.each([
        [600, [0, 17, 29, 300, 570, 599]],
        [1000, [0, 23, 39, 500, 960, 999]],
    ] satisfies Array<[JigsawPieceCount, number[]]>)(
        'generates viable %s-piece Voronoi board geometry',
        (pieceCount, sampleIndexes) => {
        const board = generateJigsawBoard(pieceCount, {type: 'voronoi', seed: `viable-${pieceCount}`});
        expect(board.id).toBe(JIGSAW_BOARD_ARTIFACT_ID);
        expect(board.image).toBe('stock:hue');
        expect(board.pieces).toHaveLength(pieceCount);
        expect(board.title).toContain('Voronoi');
        expect(totalMaskArea(board)).toBeCloseTo(board.imageSize.width * board.imageSize.height, -4);

        sampleIndexes.forEach((index) => {
            const piece = board.pieces[index];
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

        expect(board.pieces.reduce((sum, piece) => sum + piece.neighbors.length, 0)).toBeGreaterThan(pieceCount);
        const source = board.pieces.findIndex((piece) => piece.neighbors.length > 0);
        expect(source).toBeGreaterThanOrEqual(0);
        const sourceNeighbor = board.pieces[source].neighbors[0];
        expect(validConnections(board, {[connectionKey(source, sourceNeighbor.piece)]: 1})).toEqual([
            {key: connectionKey(source, sourceNeighbor.piece), from: source, to: sourceNeighbor.piece, strength: 1},
        ]);
        },
    );

    it.each([12, 600, 1000] satisfies JigsawPieceCount[])('generates reciprocal neighbor offsets for %s pieces', (pieceCount) => {
        const board = generateJigsawBoard(pieceCount);
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

    it('serializes, manifests, and loads uploaded image artifacts', () => {
        const image = testImageArtifact();
        const artifacts = initialJigsawArtifacts(60, {type: 'voronoi', imageArtifact: image});
        expect(artifacts).toHaveLength(2);
        expect(artifacts[0]).toMatchObject({
            id: JIGSAW_BOARD_ARTIFACT_ID,
            kind: JIGSAW_BOARD_KIND,
            version: JIGSAW_BOARD_VERSION,
        });
        expect(artifacts[0].data).toMatchObject({
            image: JIGSAW_ARTIFACT_IMAGE_REF,
            imageSize: {width: image.width, height: image.height},
            title: expect.stringContaining('sample.jpg'),
        });
        expect(artifacts[1]).toEqual({
            id: JIGSAW_IMAGE_ARTIFACT_ID,
            kind: JIGSAW_IMAGE_KIND,
            version: JIGSAW_IMAGE_VERSION,
            fingerprintHash: artifactFingerprintHash(image),
            data: image,
        });
        expect(jigsawArtifactStore.manifest()).toHaveLength(2);
        expect(jigsawArtifactStore.serialize(JIGSAW_IMAGE_ARTIFACT_ID)?.data).toEqual(image);
        expect(currentJigsawImage()).toEqual(image);

        jigsawArtifactStore.createInitial?.();
        expect(currentJigsawImage()).toBeNull();
        expect(jigsawArtifactStore.manifest()).toHaveLength(1);

        artifacts.forEach((artifact) => jigsawArtifactStore.load(artifact));
        expect(currentJigsawBoard().image).toBe(JIGSAW_ARTIFACT_IMAGE_REF);
        expect(currentJigsawImage()).toEqual(image);

        const stock = initialJigsawArtifacts(12)[0];
        jigsawArtifactStore.load(stock);
        expect(currentJigsawBoard().image).toBe('stock:hue');
        expect(currentJigsawImage()).toBeNull();
    });

    it('ignores invalid uploaded image artifact data', () => {
        jigsawArtifactStore.createInitial?.();
        jigsawArtifactStore.load({
            id: JIGSAW_IMAGE_ARTIFACT_ID,
            kind: JIGSAW_IMAGE_KIND,
            version: JIGSAW_IMAGE_VERSION,
            fingerprintHash: artifactFingerprintHash({id: JIGSAW_IMAGE_ARTIFACT_ID}),
            data: {id: JIGSAW_IMAGE_ARTIFACT_ID},
        });
        expect(currentJigsawImage()).toBeNull();
        expect(isJigsawImageArtifact(testImageArtifact())).toBe(true);
        expect(isJigsawImageArtifact({...testImageArtifact(), dataUrl: 'data:image/png;base64,aaaa'})).toBe(false);
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

    it('loads explicit plane surfaces as the default and rejects invalid surface values', () => {
        const board = generateJigsawBoard(12);
        const explicitPlane = {...board, surface: 'plane'};
        jigsawArtifactStore.load({
            id: JIGSAW_BOARD_ARTIFACT_ID,
            kind: JIGSAW_BOARD_KIND,
            version: JIGSAW_BOARD_VERSION,
            fingerprintHash: artifactFingerprintHash(explicitPlane),
            data: explicitPlane,
        });
        expect(currentJigsawBoard().surface).toBeUndefined();

        const before = currentJigsawBoard();
        const invalidSurface = {...board, surface: 'sphere'};
        jigsawArtifactStore.load({
            id: JIGSAW_BOARD_ARTIFACT_ID,
            kind: JIGSAW_BOARD_KIND,
            version: JIGSAW_BOARD_VERSION,
            fingerprintHash: artifactFingerprintHash(invalidSurface),
            data: invalidSurface,
        });
        expect(currentJigsawBoard()).toBe(before);
    });

    it('validates creation piece counts and creates matching initial artifacts', () => {
        expect(isJigsawPieceCount(12)).toBe(true);
        expect(isJigsawPieceCount(30)).toBe(true);
        expect(isJigsawPieceCount(60)).toBe(true);
        expect(isJigsawPieceCount(120)).toBe(true);
        expect(isJigsawPieceCount(600)).toBe(true);
        expect(isJigsawPieceCount(1000)).toBe(true);
        expect(isJigsawPieceCount(24)).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'rectangular', surface: 'plane', tabs: false, imageStatus: 'idle'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'voronoi'})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'voronoi', surface: 'plane', tabs: false, imageStatus: 'idle'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'voronoi', tabs: true})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'voronoi', surface: 'plane', tabs: true, imageStatus: 'idle'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'voronoi', surface: 'torus'})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'voronoi', surface: 'torus', tabs: false, imageStatus: 'idle'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'voronoi', image: testImageArtifact()})).toEqual({
            success: true,
            data: {pieceCount: 30, type: 'voronoi', surface: 'plane', tabs: false, image: testImageArtifact(), imageStatus: 'idle'},
        });
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, imageStatus: 'loading'}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, imageStatus: 'error'}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, image: {id: 'image'}}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 24}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, type: 'spiral'}).success).toBe(false);
        expect(jigsawApp.documentInit?.validate({pieceCount: 30, surface: 'sphere'}).success).toBe(false);
        expect(initialJigsawArtifacts(60)[0].data).toMatchObject({pieceCount: 60});
        expect(initialJigsawArtifacts(60, {surface: 'torus'})[0].data).toMatchObject({
            pieceCount: 60,
            surface: 'torus',
        });
        expect(initialJigsawArtifacts(60, {type: 'voronoi'})[0].data).toMatchObject({
            pieceCount: 60,
            title: expect.stringContaining('Voronoi'),
        });
        expect(initialJigsawArtifacts(60, {type: 'voronoi', tabs: true})[0].data).toMatchObject({
            pieceCount: 60,
            title: expect.stringContaining('tabbed Voronoi'),
        });
        expect(initialJigsawArtifacts(600)[0].data).toMatchObject({pieceCount: 600});
        expect(initialJigsawArtifacts(1000)[0].data).toMatchObject({pieceCount: 1000});
        const appArtifacts = jigsawApp.documentInit?.initialArtifacts?.({pieceCount: 120, type: 'voronoi', tabs: true});
        expect(appArtifacts?.[0].data).toMatchObject({
            pieceCount: 120,
            title: expect.stringContaining('tabbed Voronoi'),
        });
    });
});

function testImageArtifact(): JigsawImageArtifact {
    return {
        id: JIGSAW_IMAGE_ARTIFACT_ID,
        mimeType: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,aaaa',
        width: 640,
        height: 360,
        originalName: 'sample.jpg',
    };
}

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

    it('creates snap candidates across rectangular torus seams', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        const state: JigsawState = {
            positions: {
                '3': {x: 630, y: 90},
                '0': {x: 810, y: 90},
            },
            connections: {},
        };
        const layout = buildPuzzleLayout(board, state);
        const draggedPositions = new Map([[3, {x: 630, y: 90}]]);
        const allPositions = new Map([
            [3, {x: 630, y: 90}],
            [0, {x: 810, y: 90}],
        ]);

        expect(
            snapCandidates({
                board,
                layout,
                draggedPieces: new Set([3]),
                draggedPositions,
                allPositions,
                snapThreshold: 2,
            }),
        ).toEqual([{from: 3, to: 0, key: connectionKey(3, 0), strength: 1}]);
    });

    it('lays out rectangular torus seam components as an unwrapped embedding', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        const state: JigsawState = {
            positions: {'3': {x: 630, y: 90}},
            connections: {[connectionKey(3, 0)]: 1},
        };
        const layout = buildPuzzleLayout(board, state);

        expect(layout.positions.get(3)).toEqual({x: 630, y: 90});
        expect(layout.positions.get(0)).toEqual({x: 810, y: 90});
    });

    it('does not use unconnected physical torus neighbors when laying out a component', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        const state: JigsawState = {
            positions: {'3': {x: 630, y: 90}},
            connections: {
                [connectionKey(3, 0)]: 1,
                [connectionKey(0, 1)]: 1,
                [connectionKey(1, 2)]: 1,
            },
        };
        const layout = buildPuzzleLayout(board, state);

        expect(layout.positions.get(0)).toEqual({x: 810, y: 90});
        expect(layout.positions.get(1)).toEqual({x: 990, y: 90});
        expect(layout.positions.get(2)).toEqual({x: 1170, y: 90});
    });

    it('canonicalizes torus positions and finds nearest equivalent drag points', () => {
        const size = {width: 720, height: 540};

        expect(positiveModulo(-1, size.width)).toBe(719);
        expect(canonicalTorusPoint({x: -20, y: 560}, size)).toEqual({x: 700, y: 20});
        expect(nearestEquivalentPoint({x: 5, y: 538}, {x: 715, y: 2}, size)).toEqual({
            x: 725,
            y: -2,
        });
        expect(wrappedDistance({x: 719, y: 2}, {x: 1, y: 538}, size)).toBeCloseTo(Math.hypot(2, 4));
    });

    it('computes filtered torus render copies around edges and corners', () => {
        const board = generateJigsawBoard(12);

        expect(
            torusPieceCopies({
                board,
                piece: 0,
                position: {x: 90, y: 90},
                pan: {x: 0, y: 0},
            }).map((copy) => copy.key),
        ).toEqual(['0:0']);

        expect(
            torusPieceCopies({
                board,
                piece: 0,
                position: {x: 90, y: 10},
                pan: {x: 0, y: 0},
            }).map((copy) => copy.key),
        ).toEqual(['0:0', `0:${board.imageSize.height}`]);

        expect(
            torusPieceCopies({
                board,
                piece: 0,
                position: {x: 10, y: 10},
                pan: {x: 0, y: 0},
            }).map((copy) => copy.key),
        ).toEqual([
            '0:0',
            `${board.imageSize.width}:0`,
            `0:${board.imageSize.height}`,
            `${board.imageSize.width}:${board.imageSize.height}`,
        ]);
    });

    it('classifies torus viewport drops and outside-drop patches', () => {
        const size = {width: 720, height: 540};
        const state: JigsawState = {
            positions: {'3': {x: 630, y: 90}},
            connections: {[connectionKey(3, 0)]: 1},
        };

        expect(isInsideTorusViewport({x: 0, y: 540}, size)).toBe(true);
        expect(isInsideTorusViewport({x: -1, y: 20}, size)).toBe(false);
        expect(outsideTorusDropPatches(state, [3])).toEqual({
            type: 'patches',
            patches: [removePositionPatch(3)],
        });
        expect(outsideTorusDropPatches(state, [4])).toEqual({type: 'patches', patches: []});
        expect(outsideTorusDropPatches(state, [3, 0])).toEqual({type: 'cancel'});
    });

    it('converts visual torus drop positions through sub-canvas pan before storing', () => {
        const size = {width: 720, height: 540};

        expect(torusLogicalDropPosition({x: 300, y: 160}, {x: 120, y: 40}, size)).toEqual({
            x: 180,
            y: 120,
        });
        expect(torusLogicalDropPosition({x: 40, y: 20}, {x: 120, y: 40}, size)).toEqual({
            x: 640,
            y: 520,
        });
    });

    it('can compare torus snap candidates with wrapped distance', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        const state: JigsawState = {
            positions: {
                '3': {x: 630, y: 90},
                '0': {x: 90, y: 90},
            },
            connections: {},
        };
        const layout = buildPuzzleLayout(board, state);
        const draggedPositions = new Map([[3, {x: 630, y: 90}]]);
        const allPositions = new Map([
            [3, {x: 630, y: 90}],
            [0, {x: 90, y: 90}],
        ]);

        expect(
            snapCandidates({
                board,
                layout,
                draggedPieces: new Set([3]),
                draggedPositions,
                allPositions,
                snapThreshold: 2,
                distanceBetween: (a, b) => wrappedDistance(a, b, board.imageSize),
            }),
        ).toEqual([{from: 3, to: 0, key: connectionKey(3, 0), strength: 1}]);
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

    it('measures polygon overlap area and treats edge touching as zero overlap', () => {
        const square = [
            {x: 0, y: 0},
            {x: 10, y: 0},
            {x: 10, y: 10},
            {x: 0, y: 10},
        ];
        const overlapping = [
            {x: 5, y: 5},
            {x: 15, y: 5},
            {x: 15, y: 15},
            {x: 5, y: 15},
        ];
        const touching = [
            {x: 10, y: 0},
            {x: 20, y: 0},
            {x: 20, y: 10},
            {x: 10, y: 10},
        ];

        expect(packingPolygonArea(square)).toBe(100);
        expect(polygonOverlapArea(square, overlapping)).toBeCloseTo(25);
        expect(polygonOverlapArea(square, touching)).toBe(0);
    });

    it('uses the smaller piece as the polygon overlap ratio denominator', () => {
        const small = [
            {x: 0, y: 0},
            {x: 10, y: 0},
            {x: 10, y: 10},
            {x: 0, y: 10},
        ];
        const large = [
            {x: 5, y: 5},
            {x: 25, y: 5},
            {x: 25, y: 25},
            {x: 5, y: 25},
        ];

        expect(polygonOverlapRatio(small, large)).toBeCloseTo(0.25);
    });

    it('checks whether placed pieces remain outside the image rectangle', () => {
        const board = generateJigsawBoard(12);
        expect(isPlacedPieceOutsideStage(board, 0, {x: 90, y: -90}, board.imageSize)).toBe(true);
        expect(isPlacedPieceOutsideStage(board, 0, {x: 90, y: -89}, board.imageSize)).toBe(false);
        expect(pieceBorderDistanceFromStage(board, 0, {x: 90, y: -100}, board.imageSize)).toBeCloseTo(10);
    });

    it('converts tabbed masks to collision polygons using only segment endpoints', () => {
        const board = generateJigsawBoard(30, {tabs: true, seed: 'packing-endpoints'});
        const pieceIndex = board.pieces.findIndex((piece) => piece.mask.some((segment) => segment.type === 'Cubic'));
        expect(pieceIndex).toBeGreaterThanOrEqual(0);
        const piece = board.pieces[pieceIndex];

        expect(endpointPolygonForPiece(board, pieceIndex)).toEqual(piece.mask.map((segment) => segment.to));
    });

    it('summarizes packing metrics for placed pieces', () => {
        const board = generateJigsawBoard(12);
        const positions = new Map([
            [0, {x: 90, y: -90}],
            [1, {x: 270, y: -90}],
        ]);

        expect(packingMetricsForPositions(board, positions, board.imageSize)).toMatchObject({
            placedCount: 2,
            maxBorderDistance: 0,
            overlapViolations: 0,
            outsideViolations: 0,
        });
        expect(placedPieceOverlapRatio(board, 0, positions.get(0)!, 1, positions.get(1)!)).toBe(0);
    });

    it('uses grid packing for small boards and perimeter shelves for 120 pieces and above', () => {
        const smallBoard = generateJigsawBoard(60);
        const smallPieces = smallBoard.pieces.map((_piece, index) => index);
        expect(arrangeUnplacedPieces(smallBoard, smallPieces, smallBoard.imageSize, 42)).toEqual(
            arrangeUnplacedPiecesBestFirstGrid(smallBoard, smallPieces, smallBoard.imageSize, 42),
        );

        const largeBoard = generateJigsawBoard(120);
        const largePieces = largeBoard.pieces.map((_piece, index) => index);
        expect(arrangeUnplacedPieces(largeBoard, largePieces, largeBoard.imageSize, 42)).toEqual(
            arrangeUnplacedPiecesPerimeterShelves(largeBoard, largePieces, largeBoard.imageSize, 42),
        );
    });

    it.each([12, 30, 60, 120] satisfies JigsawPieceCount[])(
        'arranges all %s rectangular pieces within packing constraints',
        (pieceCount) => {
            const board = generateJigsawBoard(pieceCount);
            const pieces = board.pieces.map((_piece, index) => index);
            const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
            const metrics = packingMetricsForPositions(board, positions, board.imageSize);

            expect(positions.size).toBe(pieceCount);
            expect(metrics.outsideViolations).toBe(0);
            expect(metrics.overlapViolations).toBe(0);
            expect(metrics.maxOverlapRatio).toBeLessThanOrEqual(0.1);
        },
    );

    it('packs shuffled pieces outside the board with bounded border distance', () => {
        const board = generateJigsawBoard(12);
        const positions = arrangeUnplacedPieces(
            board,
            board.pieces.map((_piece, index) => index),
            board.imageSize,
            0,
        );
        const metrics = packingMetricsForPositions(board, positions, board.imageSize);

        expect(metrics.outsideViolations).toBe(0);
        expect(metrics.overlapViolations).toBe(0);
        expect(metrics.maxBorderDistance).toBeLessThan(estimatedPieceSize(board).height * 1.25);
    });

    it('arranges Voronoi pieces within packing constraints', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi'});
        const pieces = board.pieces.map((_piece, index) => index);
        const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
        const metrics = packingMetricsForPositions(board, positions, board.imageSize);

        expect(positions.size).toBe(30);
        expect(metrics.outsideViolations).toBe(0);
        expect(metrics.overlapViolations).toBe(0);
        expect(metrics.maxOverlapRatio).toBeLessThanOrEqual(0.1);
    });

    it.each([
        ['rectangular', generateJigsawBoard(30, {tabs: true})],
        ['Voronoi', generateJigsawBoard(30, {type: 'voronoi', tabs: true})],
    ])('arranges tabbed %s pieces within packing constraints', (_name, board) => {
        const pieces = board.pieces.map((_piece, index) => index);
        const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
        const metrics = packingMetricsForPositions(board, positions, board.imageSize);

        expect(positions.size).toBe(30);
        expect(metrics.outsideViolations).toBe(0);
        expect(metrics.overlapViolations).toBe(0);
        expect(metrics.maxOverlapRatio).toBeLessThanOrEqual(0.1);
    });

    it.each([
        [600, 'rectangular', false],
        [1000, 'rectangular', false],
        [1000, 'voronoi', true],
    ] satisfies Array<[JigsawPieceCount, 'rectangular' | 'voronoi', boolean]>)(
        'packs %s-piece %s boards outside the image rectangle',
        (pieceCount, type, tabs) => {
            const board = generateJigsawBoard(pieceCount, {type, tabs, seed: `packing-${pieceCount}-${type}-${tabs}`});
            const pieces = board.pieces.map((_piece, index) => index);
            const positions = arrangeUnplacedPieces(board, pieces, board.imageSize, 42);
            const metrics = packingMetricsForPositions(board, positions, board.imageSize);

            expect(positions.size).toBe(pieceCount);
            expect(metrics.outsideViolations).toBe(0);
            expect(metrics.overlapViolations).toBe(0);
            expect(metrics.maxOverlapRatio).toBeLessThanOrEqual(0.1);
            expect(metrics.maxBorderDistance).toBeLessThan(board.imageSize.width * 1.1);
        },
    );

    it('returns no unplaced positions for empty input or invalid stages', () => {
        const board = generateJigsawBoard(12);
        expect(arrangeUnplacedPieces(board, [], board.imageSize, 1).size).toBe(0);
        expect(arrangeUnplacedPieces(board, [0, 1], {width: 0, height: 540}, 1).size).toBe(0);
        expect(arrangeUnplacedPieces(board, [0, 1], {width: 720, height: 0}, 1).size).toBe(0);
    });
});

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

function hasCurvedSegment(mask: Array<{type: string}>) {
    return mask.some((segment) => segment.type === 'Cubic' || segment.type === 'Quadratic');
}

function maxCurveExcursion(board: ReturnType<typeof generateJigsawBoard>) {
    let max = 0;
    for (const piece of board.pieces) {
        for (const segment of piece.mask) {
            if (segment.type === 'Cubic') {
                max = Math.max(max, distance(segment.control1, segment.to), distance(segment.control2, segment.to));
            } else if (segment.type === 'Quadratic') {
                max = Math.max(max, distance(segment.control, segment.to));
            }
        }
    }
    return max;
}

function expectFinitePieceGeometry(piece: {
    center: {x: number; y: number};
    bounds: {left: number; top: number; width: number; height: number};
    mask: Array<{to: {x: number; y: number}}>;
}) {
    expect(Number.isFinite(piece.center.x)).toBe(true);
    expect(Number.isFinite(piece.center.y)).toBe(true);
    expect(Number.isFinite(piece.bounds.left)).toBe(true);
    expect(Number.isFinite(piece.bounds.top)).toBe(true);
    expect(piece.bounds.width).toBeGreaterThan(0);
    expect(piece.bounds.height).toBeGreaterThan(0);
    expect(piece.mask.length).toBeGreaterThanOrEqual(3);
}

function distance(a: {x: number; y: number}, b: {x: number; y: number}) {
    return Math.hypot(a.x - b.x, a.y - b.y);
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
