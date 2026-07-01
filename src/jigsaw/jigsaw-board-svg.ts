#!/usr/bin/env bun
import {writeFileSync} from 'node:fs';
import {
    generateJigsawBoard,
    isJigsawPieceCount,
    jigsawBoardToSvg,
    type JigsawBoardOptions,
    type JigsawPieceCount,
} from './index.js';

type SvgOptions = JigsawBoardOptions & {
    pieceCount?: JigsawPieceCount;
    stroke?: string;
    strokeWidth?: number;
    showBounds?: boolean;
};

const usage = `Usage:
  jigsaw-board-svg '<options-json>' [output.svg]

Examples:
  jigsaw-board-svg '{"pieceCount":30,"type":"voronoi","tabs":true}' > /tmp/jigsaw.svg
  jigsaw-board-svg '{"pieceCount":12,"tabs":true,"seed":"inspect","strokeWidth":1.5}' /tmp/jigsaw.svg

The JSON is JigsawBoardOptions plus optional script fields:
  pieceCount: 12 | 30 | 60 | 120 | 600 | 1000 (default 30)
  grid: {"cols": number, "rows": number} for arbitrary grid generation
  surface: "plane" | "torus" (default "plane")
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
    const svg = jigsawBoardToSvg(board, {
        stroke: typeof options.stroke === 'string' ? options.stroke : '#111827',
        strokeWidth:
            typeof options.strokeWidth === 'number' && Number.isFinite(options.strokeWidth) && options.strokeWidth > 0
                ? options.strokeWidth
                : 1,
        showBounds: options.showBounds === true,
        title: titleForBoard(board.pieceCount, options),
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

function titleForBoard(pieceCount: number, options: SvgOptions) {
    const tabs = options.tabs ? 'tabbed ' : '';
    const surface = options.surface === 'torus' ? 'torus ' : '';
    const shape = options.type === 'voronoi' ? 'Voronoi ' : '';
    return `${pieceCount} piece ${tabs}${surface}${shape}jigsaw puzzle`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main();
