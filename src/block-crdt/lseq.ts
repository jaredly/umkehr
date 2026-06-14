type ActorId = string;

export type OpId = {
    actorId: ActorId;
    counter: number;
};

export type LseqId = {
    /**
     * Variable-length path.
     *
     * Examples:
     *   [15]
     *   [15, 8]
     *   [15, 8, 23]
     */
    path: number[];

    /**
     * Unique operation id.
     *
     * Used only as a tie-breaker when two actors, or the same actor,
     * generate the same path.
     */
    opId: OpId;
};

export type LseqOptions = {
    /**
     * Initial numeric base.
     *
     * Larger values give more room between neighboring identifiers.
     */
    base?: number;

    /**
     * Maximum number of candidate positions to consider near a boundary.
     *
     * Smaller boundary = shorter local identifiers, more chance of path collision.
     * Larger boundary = more spread, slightly larger jumps.
     */
    boundary?: number;

    /**
     * Optional RNG for reproducibility in tests.
     *
     * Must return a number in [0, 1).
     */
    random?: () => number;
};

const DEFAULT_BASE = 32;
const DEFAULT_BOUNDARY = 10;
const MAX_BASE = 2 ** 31 - 1;

export function compareLseqIds(a: LseqId, b: LseqId): number {
    const pathCompare = comparePaths(a.path, b.path);
    if (pathCompare !== 0) return pathCompare;

    const actorCompare = a.opId.actorId.localeCompare(b.opId.actorId);
    if (actorCompare !== 0) return actorCompare;

    return a.opId.counter - b.opId.counter;
}

function comparePaths(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);

    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }

    return a.length - b.length;
}

export function createLseqIdBetween(
    left: LseqId | null,
    right: LseqId | null,
    opId: OpId,
    options: LseqOptions = {},
): LseqId {
    const base = options.base ?? DEFAULT_BASE;
    const boundary = options.boundary ?? DEFAULT_BOUNDARY;
    const random = options.random ?? Math.random;

    if (left && right && compareLseqIds(left, right) >= 0) {
        throw new Error('Expected left < right');
    }

    const path = allocatePathBetween(left?.path ?? [], right?.path ?? [], {
        base,
        boundary,
        random,
    });

    return {
        path,
        opId,
    };
}

function allocatePathBetween(
    leftPath: number[],
    rightPath: number[],
    options: Required<LseqOptions>,
): number[] {
    const result: number[] = [];

    let depth = 0;

    while (true) {
        const baseAtDepth = getBaseAtDepth(options.base, depth);

        const leftDigit = getDigitOrLowerSentinel(leftPath, depth);
        const rightDigit = getDigitOrUpperSentinel(rightPath, depth, baseAtDepth);

        const gap = rightDigit - leftDigit - 1;

        if (gap > 0) {
            const digit = allocateDigit(
                leftDigit,
                rightDigit,
                depth,
                options.boundary,
                options.random,
            );

            result.push(digit);
            return result;
        }

        result.push(leftDigit);
        depth++;
    }
}

function getBaseAtDepth(base: number, depth: number): number {
    /**
     * LSEQ-style exponential growth.
     *
     * Depth 0: base
     * Depth 1: base * 2
     * Depth 2: base * 4
     * ...
     *
     * This creates more room at deeper levels.
     */
    return Math.min(MAX_BASE, base * 2 ** depth);
}

function getDigitOrLowerSentinel(path: number[], depth: number): number {
    return depth < path.length ? path[depth] : 0;
}

function getDigitOrUpperSentinel(path: number[], depth: number, baseAtDepth: number): number {
    return depth < path.length ? path[depth] : baseAtDepth;
}

function allocateDigit(
    leftDigit: number,
    rightDigit: number,
    depth: number,
    boundary: number,
    random: () => number,
): number {
    const gap = rightDigit - leftDigit - 1;

    if (gap <= 0) {
        throw new Error('No digit available between left and right');
    }

    const step = Math.min(boundary, gap);

    /**
     * boundary+ on even depths:
     *
     * Choose near the left side.
     *
     *     left [x x x] right
     *          ^
     */
    if (depth % 2 === 0) {
        const offset = 1 + randomInt(step, random);
        return leftDigit + offset;
    }

    /**
     * boundary- on odd depths:
     *
     * Choose near the right side.
     *
     *     left [x x x] right
     *                ^
     */
    const offset = 1 + randomInt(step, random);
    return rightDigit - offset;
}

function randomInt(maxExclusive: number, random: () => number): number {
    return Math.floor(random() * maxExclusive);
}

export function encodeLseqId(id: LseqId): string {
    const path = id.path.map((n) => n.toString(36)).join('.');
    const counter = id.opId.counter.toString(36);

    return `${path}|${id.opId.actorId}|${counter}`;
}

export function decodeLseqId(encoded: string): LseqId {
    const [path, actorId, counter] = encoded.split('|');
    return {
        path: path.split('.').map((n) => parseInt(n, 36)),
        opId: {
            actorId,
            counter: parseInt(counter, 36),
        },
    };
}
