#!/usr/bin/env bun
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {
    generateJigsawBoard,
    type JigsawGenerationType,
    type JigsawPieceCount,
} from '../src/apps/jigsaw/artifacts';
import {
    arrangeUnplacedPiecesBestFirstGridWithStats,
    arrangeUnplacedPiecesPerimeterShelvesWithStats,
    arrangeUnplacedPiecesRingLane,
    packingMetricsForPositions,
} from '../src/apps/jigsaw/jigsaw';

type BenchmarkRow = {
    algorithm: string;
    count: JigsawPieceCount;
    type: JigsawGenerationType;
    tabs: boolean;
    seed: number;
    subset: string;
    ms: number;
    placedCount: number;
    maxDistance: number;
    p95Distance: number;
    meanDistance: number;
    maxOverlapRatio: number;
    overlapViolations: number;
    outsideViolations: number;
    attempts: number | null;
};

type Algorithm = {
    name: string;
    arrange(
        board: ReturnType<typeof generateJigsawBoard>,
        pieces: number[],
        seed: number,
    ): {positions: Map<number, {x: number; y: number}>; attempts: number | null};
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputPath = resolve(scriptDir, '../../../.tasks/05kdv-jigsaw-shuffle/benchmark.md');

const algorithms: Algorithm[] = [
    {
        name: 'currentRingLane',
        arrange(board, pieces, seed) {
            return {
                positions: arrangeUnplacedPiecesRingLane(board, pieces, board.imageSize, seed),
                attempts: null,
            };
        },
    },
    {
        name: 'bestFirstGrid',
        arrange(board, pieces, seed) {
            return arrangeUnplacedPiecesBestFirstGridWithStats(board, pieces, board.imageSize, seed);
        },
    },
    {
        name: 'perimeterShelves',
        arrange(board, pieces, seed) {
            return arrangeUnplacedPiecesPerimeterShelvesWithStats(board, pieces, board.imageSize, seed);
        },
    },
];

function main() {
    const quick = process.argv.includes('--quick');
    const outputPath = optionValue('--output') ?? defaultOutputPath;
    const config = quick
        ? {
              counts: [120, 600, 1000] satisfies JigsawPieceCount[],
              seeds: [1],
              subsets: [1],
          }
        : {
              counts: [12, 30, 60, 120, 600, 1000] satisfies JigsawPieceCount[],
              seeds: Array.from({length: 20}, (_value, index) => index + 1),
              subsets: [1, 0.75, 0.5],
          };

    const rows: BenchmarkRow[] = [];
    for (const count of config.counts) {
        for (const type of ['rectangular', 'voronoi'] satisfies JigsawGenerationType[]) {
            for (const tabs of [false, true]) {
                for (const seed of config.seeds) {
                    const board = generateJigsawBoard(count, {
                        type,
                        tabs,
                        seed: `bench-board-${seed}`,
                    });
                    for (const subsetRatio of config.subsets) {
                        const pieces = subsetPieces(board.pieces.length, subsetRatio, seed);
                        for (const algorithm of algorithms) {
                            const started = performance.now();
                            const {positions, attempts} = algorithm.arrange(board, pieces, seed);
                            const ms = performance.now() - started;
                            const metrics = packingMetricsForPositions(board, positions, board.imageSize);
                            rows.push({
                                algorithm: algorithm.name,
                                count,
                                type,
                                tabs,
                                seed,
                                subset: subsetLabel(subsetRatio),
                                ms,
                                placedCount: metrics.placedCount,
                                maxDistance: metrics.maxBorderDistance,
                                p95Distance: metrics.p95BorderDistance,
                                meanDistance: metrics.meanBorderDistance,
                                maxOverlapRatio: metrics.maxOverlapRatio,
                                overlapViolations: metrics.overlapViolations,
                                outsideViolations: metrics.outsideViolations,
                                attempts,
                            });
                        }
                    }
                }
            }
        }
    }

    const markdown = benchmarkMarkdown(rows, quick);
    writeFileSync(outputPath, markdown);
    process.stdout.write(`${markdown}\n`);
}

function subsetPieces(pieceCount: number, ratio: number, seed: number) {
    const pieces = Array.from({length: pieceCount}, (_value, index) => index);
    if (ratio >= 1) return pieces;
    pieces.sort((a, b) => seededRank(a, seed) - seededRank(b, seed));
    return pieces.slice(0, Math.max(1, Math.floor(pieceCount * ratio))).sort((a, b) => a - b);
}

function seededRank(value: number, seed: number) {
    let state = (value + 1) * 0x9e3779b1 + seed * 0x85ebca6b;
    state ^= state >>> 16;
    state = Math.imul(state, 0x7feb352d);
    state ^= state >>> 15;
    state = Math.imul(state, 0x846ca68b);
    state ^= state >>> 16;
    return state >>> 0;
}

function subsetLabel(ratio: number) {
    return ratio >= 1 ? 'all' : `${Math.round(ratio * 100)}%`;
}

function benchmarkMarkdown(rows: BenchmarkRow[], quick: boolean) {
    const lines = [
        '# Jigsaw Packing Benchmark',
        '',
        `Mode: ${quick ? 'quick' : 'full'}`,
        '',
        '| algorithm | count | type | tabs | seed | subset | ms | placed | max distance | p95 distance | mean distance | max overlap | overlap violations | outside violations | attempts |',
        '| --- | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const row of rows) {
        lines.push(
            [
                row.algorithm,
                row.count,
                row.type,
                row.tabs ? 'yes' : 'no',
                row.seed,
                row.subset,
                format(row.ms),
                row.placedCount,
                format(row.maxDistance),
                format(row.p95Distance),
                format(row.meanDistance),
                format(row.maxOverlapRatio, 4),
                row.overlapViolations,
                row.outsideViolations,
                row.attempts ?? '',
            ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
        );
    }
    return `${lines.join('\n')}\n`;
}

function optionValue(name: string) {
    const index = process.argv.indexOf(name);
    if (index < 0) return null;
    return process.argv[index + 1] ?? null;
}

function format(value: number, digits = 1) {
    return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

main();
