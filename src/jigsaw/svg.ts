import type {Coord, JigsawBoard, PathSegment} from './types.js';

export type JigsawBoardSvgOptions = {
    stroke?: string;
    strokeWidth?: number;
    showBounds?: boolean;
    title?: string;
};

export function jigsawBoardToSvg(board: JigsawBoard, options: JigsawBoardSvgOptions = {}) {
    const stroke = options.stroke ?? '#111827';
    const strokeWidth =
        typeof options.strokeWidth === 'number' && Number.isFinite(options.strokeWidth) && options.strokeWidth > 0
            ? options.strokeWidth
            : 1;
    const showBounds = options.showBounds === true;
    const title = options.title ?? `${board.pieceCount} piece jigsaw puzzle`;
    const paths = board.pieces
        .map((piece, index) => {
            const d = svgPathForMask(piece.mask, piece.center);
            const bounds = showBounds
                ? `\n    <rect x="${format(piece.center.x + piece.bounds.left)}" y="${format(piece.center.y + piece.bounds.top)}" width="${format(piece.bounds.width)}" height="${format(piece.bounds.height)}" fill="none" stroke="#ef4444" stroke-width="${format(strokeWidth)}" opacity="0.45" />`
                : '';
            return `    <path data-piece="${index}" d="${d}" fill="none" stroke="${escapeAttribute(stroke)}" stroke-width="${format(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />${bounds}`;
        })
        .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(board.imageSize.width)} ${format(board.imageSize.height)}" width="${format(board.imageSize.width)}" height="${format(board.imageSize.height)}" role="img" aria-label="${escapeAttribute(title)} outlines">
  <title>${escapeText(title)} outlines</title>
  <g>
${paths}
  </g>
</svg>
`;
}

export function svgPathForMask(mask: PathSegment[], center: Coord = {x: 0, y: 0}) {
    const [first, ...rest] = mask;
    if (!first) return '';
    const commands = [`M ${point(first.to, center)}`];
    for (const segment of rest) {
        if (segment.type === 'Quadratic') {
            commands.push(`Q ${point(segment.control, center)} ${point(segment.to, center)}`);
        } else if (segment.type === 'Cubic') {
            commands.push(`C ${point(segment.control1, center)} ${point(segment.control2, center)} ${point(segment.to, center)}`);
        } else {
            commands.push(`L ${point(segment.to, center)}`);
        }
    }
    commands.push('Z');
    return commands.join(' ');
}

function point(point: Coord, offset: Coord) {
    return `${format(point.x + offset.x)} ${format(point.y + offset.y)}`;
}

function format(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

function escapeAttribute(value: string) {
    return escapeText(value).replace(/"/g, '&quot;');
}

function escapeText(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
