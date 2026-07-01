#!/usr/bin/env bun
import {writeFileSync} from 'node:fs';
import {
    generateJigsawBoard,
    isJigsawPieceCount,
    type JigsawBoardOptions,
    type JigsawPieceCount,
    type PathSegment,
} from '../src/apps/jigsaw/artifacts';

type SvgOptions = JigsawBoardOptions & {
    pieceCount?: JigsawPieceCount;
    stroke?: string;
    strokeWidth?: number;
    showBounds?: boolean;
};

const usage = `Usage:
  bun scripts/jigsaw-board-svg.ts '<options-json>' [output.svg]

Examples:
  bun scripts/jigsaw-board-svg.ts '{"pieceCount":30,"type":"voronoi","tabs":true}' > /tmp/jigsaw.svg
  bun scripts/jigsaw-board-svg.ts '{"pieceCount":12,"tabs":true,"seed":"inspect","strokeWidth":1.5}' /tmp/jigsaw.svg

The JSON is JigsawBoardOptions plus optional script fields:
  pieceCount: 12 | 30 | 60 | 120 | 600 | 1000 (default 30)
  seed: string | number for reproducible random boards
  stroke: SVG stroke color (default "#111827")
  strokeWidth: SVG stroke width (default 1)
  showBounds: draw per-piece bounds in red (default false)
`;

function main() {
    const [json, outputPath] = process.argv.slice(2);
    if (!json || json === '--help' || json === '-h') {
        process.stdout.write(usage);
        process.exit(json ? 0 : 1);
    }

    const options = parseOptions(json);
    const pieceCount = options.pieceCount ?? 30;
    if (!isJigsawPieceCount(pieceCount)) {
        throw new Error('pieceCount must be one of 12, 30, 60, 120, 600, or 1000.');
    }

    const board = generateJigsawBoard(pieceCount, options);
    const svg = boardToSvg(board, {
        stroke: typeof options.stroke === 'string' ? options.stroke : '#111827',
        strokeWidth:
            typeof options.strokeWidth === 'number' && Number.isFinite(options.strokeWidth) && options.strokeWidth > 0
                ? options.strokeWidth
                : 1,
        showBounds: options.showBounds === true,
    });

    if (outputPath) {
        writeFileSync(outputPath, svg);
    } else {
        process.stdout.write(svg);
    }
}

function parseOptions(json: string): SvgOptions {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) throw new Error('Options JSON must decode to an object.');
    return parsed as SvgOptions;
}

function boardToSvg(
    board: ReturnType<typeof generateJigsawBoard>,
    {
        stroke,
        strokeWidth,
        showBounds,
    }: {
        stroke: string;
        strokeWidth: number;
        showBounds: boolean;
    },
) {
    const paths = board.pieces
        .map((piece, index) => {
            const d = svgPathForMask(piece.mask, piece.center);
            const bounds = showBounds
                ? `\n    <rect x="${format(piece.center.x + piece.bounds.left)}" y="${format(piece.center.y + piece.bounds.top)}" width="${format(piece.bounds.width)}" height="${format(piece.bounds.height)}" fill="none" stroke="#ef4444" stroke-width="${format(strokeWidth)}" opacity="0.45" />`
                : '';
            return `    <path data-piece="${index}" d="${d}" fill="none" stroke="${escapeAttribute(stroke)}" stroke-width="${format(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />${bounds}`;
        })
        .join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(board.imageSize.width)} ${format(board.imageSize.height)}" width="${format(board.imageSize.width)}" height="${format(board.imageSize.height)}" role="img" aria-label="${escapeAttribute(board.title)} outlines">
  <title>${escapeText(board.title)} outlines</title>
  <g>
${paths}
  </g>
</svg>
`;
}

function svgPathForMask(mask: PathSegment[], center: {x: number; y: number}) {
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

function point(point: {x: number; y: number}, offset: {x: number; y: number}) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main();
