import {describe, expect, it} from 'vitest';
import {
    generateJigsawBoard,
    gridForPieceCount,
    isJigsawPieceCount,
    isJigsawSurface,
    jigsawBoardToSvg,
    svgPathForMask,
    type JigsawPiece,
    type JigsawPieceCount,
    type PathSegment,
} from './index';

describe('jigsaw board generation', () => {
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
            expect(board.pieceCount).toBe(pieceCount);
            expect(board.grid).toEqual({cols, rows});
            expect(board.pieces).toHaveLength(pieceCount);
            expect(gridForPieceCount(pieceCount)).toEqual({cols, rows});
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

    it('generates arbitrary rectangular grids', () => {
        const board = generateJigsawBoard({grid: {cols: 7, rows: 2}, imageSize: {width: 700, height: 200}});
        expect(board.pieceCount).toBe(14);
        expect(board.grid).toEqual({cols: 7, rows: 2});
        expect(board.pieces).toHaveLength(14);
        expect(board.pieces[0].bounds).toEqual({
            left: -50,
            top: -50,
            width: 100,
            height: 100,
        });
    });

    it('defaults plane boards by omitting the surface field', () => {
        const board = generateJigsawBoard(12);
        expect(isJigsawSurface('plane')).toBe(true);
        expect(isJigsawSurface('torus')).toBe(true);
        expect(isJigsawSurface('sphere')).toBe(false);
        expect(board.surface).toBeUndefined();
    });

    it('generates rectangular torus boards with wrapped neighbors and shortest offsets', () => {
        const board = generateJigsawBoard(12, {surface: 'torus'});
        expect(board.surface).toBe('torus');
        expect(board.pieces.every((piece) => piece.neighbors.length === 4)).toBe(true);

        const rightToLeft = board.pieces[3].neighbors.find((neighbor) => neighbor.piece === 0);
        const leftToRight = board.pieces[0].neighbors.find((neighbor) => neighbor.piece === 3);
        expect(rightToLeft?.offset).toEqual({x: 180, y: 0});
        expect(leftToRight?.offset).toEqual({x: -180, y: -0});

        const bottomToTop = board.pieces[8].neighbors.find((neighbor) => neighbor.piece === 0);
        const topToBottom = board.pieces[0].neighbors.find((neighbor) => neighbor.piece === 8);
        expect(bottomToTop?.offset).toEqual({x: 0, y: 180});
        expect(topToBottom?.offset).toEqual({x: -0, y: -180});
    });

    it('generates tabbed rectangular board geometry', () => {
        const board = generateJigsawBoard(30, {tabs: true, seed: 'tabs'});
        expect(board.pieces).toHaveLength(30);
        expect(board.pieces.some((piece) => hasCurvedSegment(piece.mask))).toBe(true);
        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            expectReciprocalNeighbors(board, index);
        });
    });

    it('generates concrete Voronoi board geometry', () => {
        const board = generateJigsawBoard(30, {type: 'voronoi', seed: 'voronoi'});
        expect(board.pieces).toHaveLength(30);
        expect(totalMaskArea(board)).toBeCloseTo(board.imageSize.width * board.imageSize.height, -4);

        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(piece.mask.length).toBeGreaterThanOrEqual(3);
            expect(maskFitsBounds(piece)).toBe(true);
            expectReciprocalNeighbors(board, index);
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
        board.pieces.forEach((piece, index) => {
            expectFinitePieceGeometry(piece);
            expect(maskFitsBounds(piece)).toBe(true);
            expect(piece.neighbors.length).toBeGreaterThanOrEqual(3);
            expectReciprocalNeighbors(board, index);
        });
    });

    it('uses a seed for reproducible randomness', () => {
        const a = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 1234});
        const b = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 1234});
        const c = generateJigsawBoard(30, {type: 'voronoi', tabs: true, seed: 5678});

        expect(a).toEqual(b);
        expect(a.pieces.map((piece) => piece.center)).not.toEqual(c.pieces.map((piece) => piece.center));
    });

    it('validates preset piece counts', () => {
        expect(isJigsawPieceCount(12)).toBe(true);
        expect(isJigsawPieceCount(1000)).toBe(true);
        expect(isJigsawPieceCount(24)).toBe(false);
    });
});

describe('jigsaw SVG serialization', () => {
    it('serializes a piece mask to an SVG path', () => {
        const board = generateJigsawBoard(12);
        expect(svgPathForMask(board.pieces[0].mask, board.pieces[0].center)).toBe(
            'M 180 0 L 180 180 L 0 180 L 0 0 Z',
        );
    });

    it('serializes a board outline SVG with optional bounds', () => {
        const board = generateJigsawBoard(12, {tabs: true, seed: 'svg'});
        const svg = jigsawBoardToSvg(board, {
            title: 'SVG test',
            stroke: '#123456',
            strokeWidth: 1.5,
            showBounds: true,
        });
        expect(svg).toContain('<svg');
        expect(svg).toContain('SVG test outlines');
        expect(svg).toContain('data-piece="0"');
        expect(svg).toContain('stroke="#123456"');
        expect(svg).toContain('<rect');
    });
});

function expectReciprocalNeighbors(board: ReturnType<typeof generateJigsawBoard>, index: number) {
    board.pieces[index].neighbors.forEach((neighbor) => {
        const reverse = board.pieces[neighbor.piece].neighbors.find((entry) => entry.piece === index);
        expect(reverse).toBeTruthy();
        expect(reverse?.offset.x).toBeCloseTo(-neighbor.offset.x);
        expect(reverse?.offset.y).toBeCloseTo(-neighbor.offset.y);
    });
}

function expectFinitePieceGeometry(piece: JigsawPiece) {
    expect(Number.isFinite(piece.center.x)).toBe(true);
    expect(Number.isFinite(piece.center.y)).toBe(true);
    expect(piece.bounds.width).toBeGreaterThan(0);
    expect(piece.bounds.height).toBeGreaterThan(0);
}

function hasCurvedSegment(mask: PathSegment[]) {
    return mask.some((segment) => segment.type === 'Cubic' || segment.type === 'Quadratic');
}

function maskFitsBounds(piece: JigsawPiece) {
    const bounds = boundsForMask(piece.mask);
    return (
        bounds.left >= piece.bounds.left - 1e-6 &&
        bounds.top >= piece.bounds.top - 1e-6 &&
        bounds.left + bounds.width <= piece.bounds.left + piece.bounds.width + 1e-6 &&
        bounds.top + bounds.height <= piece.bounds.top + piece.bounds.height + 1e-6
    );
}

function boundsForMask(mask: PathSegment[]) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const segment of mask) {
        const points =
            segment.type === 'Cubic'
                ? [segment.control1, segment.control2, segment.to]
                : segment.type === 'Quadratic'
                  ? [segment.control, segment.to]
                  : [segment.to];
        for (const point of points) {
            left = Math.min(left, point.x);
            right = Math.max(right, point.x);
            top = Math.min(top, point.y);
            bottom = Math.max(bottom, point.y);
        }
    }
    return {left, top, width: right - left, height: bottom - top};
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
