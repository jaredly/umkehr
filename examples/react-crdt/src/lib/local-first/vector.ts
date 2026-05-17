import {
    compareTimestamps,
    hlc,
    type CrdtUpdate,
    type HlcTimestamp,
} from 'umkehr/crdt';
import type {VersionVector} from './types';

export function timestampsForUpdate(update: CrdtUpdate): HlcTimestamp[] {
    if (update.op !== 'setOrder') return [update.ts];
    return Object.values(update.orders).map(({ts}) => ts);
}

export function timestampsForBatch(updates: readonly CrdtUpdate[]): HlcTimestamp[] {
    return updates.flatMap(timestampsForUpdate);
}

export function actorForTimestamp(timestamp: HlcTimestamp): string {
    return hlc.unpack(timestamp).node;
}

export function batchTimestampRange(updates: readonly CrdtUpdate[]) {
    const timestamps = timestampsForBatch(updates).sort(compareTimestamps);
    return {
        minTs: timestamps[0],
        maxTs: timestamps.at(-1),
    };
}

export function advanceVector(
    vector: VersionVector,
    updates: readonly CrdtUpdate[],
): VersionVector {
    const next = {...vector};
    for (const timestamp of timestampsForBatch(updates)) {
        const actor = actorForTimestamp(timestamp);
        const current = next[actor];
        if (!current || compareTimestamps(timestamp, current) > 0) {
            next[actor] = timestamp;
        }
    }
    return next;
}

export function mergeVectors(a: VersionVector, b: VersionVector): VersionVector {
    const next = {...a};
    for (const [actor, timestamp] of Object.entries(b)) {
        const current = next[actor];
        if (!current || compareTimestamps(timestamp, current) > 0) {
            next[actor] = timestamp;
        }
    }
    return next;
}

export function vectorDominates(a: VersionVector, b: VersionVector): boolean {
    return Object.entries(b).every(([actor, timestamp]) => {
        const current = a[actor];
        return current !== undefined && compareTimestamps(current, timestamp) >= 0;
    });
}
