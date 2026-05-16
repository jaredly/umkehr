import type {HlcTimestamp} from './types.js';

export function compareTimestamps(a: HlcTimestamp, b: HlcTimestamp) {
    return a < b ? -1 : a > b ? 1 : 0;
}

export const newer = (a: HlcTimestamp, b: HlcTimestamp) => compareTimestamps(a, b) > 0;
