import {compareTimestamps} from './clock.js';
import {createdOf} from './metadata.js';
import type {CrdtMeta, CrdtPathSegment} from './types.js';

export function checkParent(
    parent: CrdtMeta,
    segment: CrdtPathSegment,
): 'ready' | 'pending' | 'discard' {
    if (parent.kind === 'tombstone') return 'discard';
    const created = createdOf(parent);
    if (!created) return 'discard';
    const required = segment.parentCreated;
    const cmp = compareTimestamps(created, required);
    if (cmp > 0) return 'discard';
    if (cmp < 0) return 'pending';
    if (segment.type === 'taggedField') {
        if (parent.kind !== 'tagged') return 'discard';
        if (parent.tagKey !== segment.tagKey || parent.tagValue !== segment.tagValue)
            return 'discard';
        const tagCmp = compareTimestamps(parent.tagTs, segment.tagTs);
        if (tagCmp > 0) return 'discard';
        if (tagCmp < 0) return 'pending';
    }
    return 'ready';
}
