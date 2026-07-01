export type Coord = {
    x: number;
    y: number;
};

export type PathSegment =
    | {type: 'Line'; to: Coord}
    | {type: 'Cubic'; control1: Coord; control2: Coord; to: Coord}
    | {type: 'Quadratic'; control: Coord; to: Coord};

export type JigsawPieceCount = 12 | 30 | 60 | 120 | 600 | 1000;
export type JigsawGenerationType = 'rectangular' | 'voronoi';
export type JigsawSurface = 'plane' | 'torus';

export type JigsawGrid = {
    cols: number;
    rows: number;
};

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

export type JigsawBoard = {
    imageSize: {width: number; height: number};
    pieceCount: number;
    grid: JigsawGrid;
    surface?: JigsawSurface;
    pieces: JigsawPiece[];
};

export type JigsawBoardOptions = {
    type?: JigsawGenerationType;
    surface?: JigsawSurface;
    tabs?: boolean;
    seed?: string | number;
    imageSize?: {width: number; height: number};
    grid?: JigsawGrid;
};

export const DEFAULT_JIGSAW_PIECE_COUNT: JigsawPieceCount = 12;
export const JIGSAW_IMAGE_SIZE = {width: 720, height: 540} as const;
