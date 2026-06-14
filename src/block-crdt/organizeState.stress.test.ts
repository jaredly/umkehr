import {describe, expect, it} from 'vitest';
import {blockParentStrategiesForStress} from './index';
import {Block} from './types';
import {compareLseqIds, LseqId} from './lseq';

const runStress = process.env.BLOCK_CRDT_STRESS === '1';
const stressLevel = process.env.BLOCK_CRDT_STRESS_LEVEL ?? 'default';
const iterations = Number(process.env.BLOCK_CRDT_STRESS_ITERATIONS ?? 11);

type CaseResult = {
    strategy: string;
    name: string;
    blocks: number;
    medianMs: string;
    p95Ms: string;
    maxMs: string;
    over10ms: boolean;
};

const lseq = (index: number): LseqId => ({
    path: [index],
    opId: {actorId: 'stress', counter: index},
});

const block = (id: number, path: number[], orderId = id): Block => ({
    id: [id, 'stress'],
    meta: {type: 'paragraph', ts: '00001'},
    order: {
        id: [orderId, 'order'],
        path: path.map((item) => [item, 'stress']),
        index: lseq(id),
        ts: '00001',
    },
    deleted: false,
});

const flat = (size: number) => {
    const blocks: Record<string, Block> = {};
    for (let i = 1; i <= size; i++) {
        blocks[id(i)] = block(i, [i]);
    }
    return blocks;
};

const compressedChain = (size: number) => {
    const blocks: Record<string, Block> = {};
    for (let i = 1; i <= size; i++) {
        blocks[id(i)] = block(i, i === 1 ? [i] : [i - 1, i]);
    }
    return blocks;
};

const fullPathChain = (size: number) => {
    const blocks: Record<string, Block> = {};
    const path: number[] = [];
    for (let i = 1; i <= size; i++) {
        path.push(i);
        blocks[id(i)] = block(i, path);
    }
    return blocks;
};

const cappedPathChain = (size: number, maxDepth: number) => {
    const blocks: Record<string, Block> = {};
    const path: number[] = [];
    for (let i = 1; i <= size; i++) {
        path.push(i);
        blocks[id(i)] = block(i, path.slice(-maxDepth));
    }
    return blocks;
};

const balancedTree = (size: number, fanout: number) => {
    const blocks: Record<string, Block> = {};
    const paths: number[][] = [[]];
    for (let i = 1; i <= size; i++) {
        const parent = i === 1 ? 0 : Math.floor((i - 2) / fanout) + 1;
        const parentPath = paths[parent] ?? [];
        const path = [...parentPath, i];
        paths[i] = path;
        blocks[id(i)] = block(i, path);
    }
    return blocks;
};

const cappedBalancedTree = (size: number, fanout: number, maxDepth: number) => {
    const blocks: Record<string, Block> = {};
    const paths: number[][] = [[]];
    for (let i = 1; i <= size; i++) {
        const parent = i === 1 ? 0 : Math.floor((i - 2) / fanout) + 1;
        const parentPath = paths[parent] ?? [];
        const path = [...parentPath, i].slice(-maxDepth);
        paths[i] = path;
        blocks[id(i)] = block(i, path);
    }
    return blocks;
};

const reciprocalCycles = (pairs: number, tailLength: number) => {
    const blocks: Record<string, Block> = {};
    let next = 1;
    for (let pair = 0; pair < pairs; pair++) {
        const left = next++;
        const right = next++;
        blocks[id(left)] = block(left, [right, left], 10_000 + left);
        blocks[id(right)] = block(right, [left, right], right);
        let parent = right;
        for (let tail = 0; tail < tailLength; tail++) {
            const child = next++;
            blocks[id(child)] = block(child, [parent, child]);
            parent = child;
        }
    }
    return blocks;
};

const id = (count: number) => `${String(count).padStart(4, '0')}-stress`;

const buildBlockChildren = (
    blocks: Record<string, Block>,
    parents: Record<string, string>,
): Record<string, string[]> => {
    const blockChildren: Record<string, string[]> = {};
    for (const id of Object.keys(blocks)) {
        const pid = parents[id];
        blockChildren[pid] = blockChildren[pid] ?? [];
        blockChildren[pid].push(id);
    }
    Object.values(blockChildren).forEach((items) => {
        items.sort((a, b) => compareLseqIds(blocks[a].order.index, blocks[b].order.index));
    });
    return blockChildren;
};

const timeCase = (
    strategy: (typeof blockParentStrategiesForStress)[number],
    name: string,
    blocks: Record<string, Block>,
    sampleCount = iterations,
): CaseResult => {
    // Warm up JIT and allocation paths before measuring.
    for (let i = 0; i < 2; i++) {
        buildBlockChildren(blocks, strategy.derive(blocks).parents);
    }

    const samples: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
        const started = performance.now();
        buildBlockChildren(blocks, strategy.derive(blocks).parents);
        samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const max = samples[samples.length - 1];
    return {
        strategy: strategy.name,
        name,
        blocks: Object.keys(blocks).length,
        medianMs: median.toFixed(3),
        p95Ms: p95.toFixed(3),
        maxMs: max.toFixed(3),
        over10ms: median > 10 || p95 > 10,
    };
};

const runCase = (results: CaseResult[], name: string, blocks: Record<string, Block>) => {
    const baseline = blockParentStrategiesForStress[0];
    const expected = buildBlockChildren(blocks, baseline.derive(blocks).parents);
    for (const strategy of blockParentStrategiesForStress) {
        expect(buildBlockChildren(blocks, strategy.derive(blocks).parents)).toEqual(expected);
        results.push(timeCase(strategy, name, blocks));
    }
};

describe.runIf(runStress)('organizeState stress', () => {
    it('reports the size where full block reparsing crosses 10ms', () => {
        const results: CaseResult[] = [];
        const broadSizes =
            stressLevel === 'deep' ? [100, 250, 500, 1_000, 2_000, 4_000, 8_000] : [100, 250, 500, 1_000, 2_000, 4_000];
        const compressedSizes =
            stressLevel === 'deep' ? [100, 250, 500, 1_000, 2_000, 4_000, 8_000] : [100, 250, 500, 1_000];
        const fullPathSizes =
            stressLevel === 'deep' ? [100, 250, 500, 1_000, 2_000] : [100, 250, 500];
        const cappedPathSizes =
            stressLevel === 'deep' ? [500, 1_000, 2_000, 4_000, 8_000] : [500, 1_000];
        const cappedBalancedSizes =
            stressLevel === 'deep' ? [500, 1_000, 2_000, 4_000, 8_000] : [500, 1_000, 2_000, 4_000];
        const cyclePairs = stressLevel === 'deep' ? [25, 50, 100, 250, 500] : [25, 100, 500];

        for (const size of broadSizes) {
            runCase(results, `flat/${size}`, flat(size));
            runCase(results, `balanced4/${size}`, balancedTree(size, 4));
        }
        for (const size of compressedSizes) {
            runCase(results, `compressed-chain/${size}`, compressedChain(size));
        }

        for (const size of fullPathSizes) {
            runCase(results, `full-path-chain/${size}`, fullPathChain(size));
        }

        for (const maxDepth of [10, 25, 50]) {
            for (const size of cappedPathSizes) {
                runCase(results, `capped-chain-d${maxDepth}/${size}`, cappedPathChain(size, maxDepth));
            }
        }

        for (const maxDepth of [10, 25, 50]) {
            for (const size of cappedBalancedSizes) {
                runCase(results, `capped-balanced4-d${maxDepth}/${size}`, cappedBalancedTree(size, 4, maxDepth));
            }
        }

        for (const pairs of cyclePairs) {
            runCase(results, `reciprocal-cycles-tail3/${pairs}`, reciprocalCycles(pairs, 3));
        }

        console.table(results);
    }, 120_000);
});
