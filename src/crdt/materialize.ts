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
                .filter(([, item]) => item.value.kind !== 'tombstone')
                .sort(([aId, a], [bId, b]) => {
                    const order = compareStrings(a.order.value, b.order.value);
                    return order || compareStrings(aId, bId);
                })
                .map(([, item]) => materialize(item.value))
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
