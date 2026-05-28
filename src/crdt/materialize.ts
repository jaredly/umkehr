import {compareStrings} from './fractionalIndex.js';
import type {CrdtMeta, JsonValue} from './types.js';

export function materialize(meta: CrdtMeta): JsonValue | undefined {
    switch (meta.kind) {
        case 'primitive':
            return meta.value;
        case 'tombstone':
            return undefined;
        case 'object': {
            const value: Record<string, JsonValue | undefined> = {};
            for (const [key, field] of Object.entries(meta.fields)) {
                const next = materialize(field);
                if (next !== undefined) value[key] = next;
            }
            return value;
        }
        case 'record': {
            const value: Record<string, JsonValue | undefined> = {};
            for (const [key, entry] of Object.entries(meta.entries)) {
                const next = materialize(entry);
                if (next !== undefined) value[key] = next;
            }
            return value;
        }
        case 'array':
            return Object.entries(meta.items)
                .filter(([, item]) => item.kind === 'live')
                .sort(([aId, a], [bId, b]) => {
                    if (a.kind !== 'live' || b.kind !== 'live') return 0;
                    const order = compareStrings(a.order.value, b.order.value);
                    return order || compareStrings(aId, bId);
                })
                .map(([, item]) => (item.kind === 'live' ? materialize(item.value) : undefined))
                .filter((value) => value !== undefined) as JsonValue[];
        case 'tagged': {
            const value: Record<string, JsonValue | undefined> = {[meta.tagKey]: meta.tagValue};
            for (const [key, field] of Object.entries(meta.fields)) {
                const next = materialize(field);
                if (next !== undefined) value[key] = next;
            }
            return value;
        }
    }
}
