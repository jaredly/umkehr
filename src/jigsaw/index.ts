export {
    DEFAULT_JIGSAW_PIECE_COUNT,
    JIGSAW_IMAGE_SIZE,
    generateJigsawBoard,
    gridForPieceCount,
    isJigsawPieceCount,
    isJigsawSurface,
    surfaceForBoard,
} from './generate.js';
export {jigsawBoardToSvg, svgPathForMask, type JigsawBoardSvgOptions} from './svg.js';
export type {
    Coord,
    JigsawBoard,
    JigsawBoardOptions,
    JigsawGenerationType,
    JigsawGrid,
    JigsawPiece,
    JigsawPieceCount,
    JigsawSurface,
    PathSegment,
    PieceBounds,
} from './types.js';
