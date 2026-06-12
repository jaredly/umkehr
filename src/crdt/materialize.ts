import {compareStrings} from './fractionalIndex.js';
import type {CrdtMeta, CrdtSchemaContext, JsonValue} from './types.js';

export function materialize(
    meta: CrdtMeta,
    previous?: unknown,
    ctx?: CrdtSchemaContext,
): JsonValue | undefined {
    switch (meta.kind) {
        case 'primitive':
            return meta.value;
        case 'tombstone':
            return undefined;
        case 'object': {
            const value: Record<string, JsonValue | undefined> = {};
            for (const [key, field] of Object.entries(meta.fields)) {
                const previousField =
                    previous && typeof previous === 'object'
                        ? (previous as Record<string, unknown>)[key]
                        : undefined;
                const next = materialize(field, previousField, ctx);
                if (next !== undefined) value[key] = next;
            }
            return value;
        }
        case 'record': {
            const value: Record<string, JsonValue | undefined> = {};
            for (const [key, entry] of Object.entries(meta.entries)) {
                const previousEntry =
                    previous && typeof previous === 'object'
                        ? (previous as Record<string, unknown>)[key]
                        : undefined;
                const next = materialize(entry, previousEntry, ctx);
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
                .map(([id, item], index) =>
                    item.kind === 'live'
                        ? materialize(
                              item.value,
                              Array.isArray(previous)
                                  ? previous[index]
                                  : previous && typeof previous === 'object'
                                    ? (previous as Record<string, unknown>)[id]
                                    : undefined,
                              ctx,
                          )
                        : undefined,
                )
                .filter((value) => value !== undefined) as JsonValue[];
        case 'tagged': {
            const value: Record<string, JsonValue | undefined> = {[meta.tagKey]: meta.tagValue};
            for (const [key, field] of Object.entries(meta.fields)) {
                const previousField =
                    previous && typeof previous === 'object'
                        ? (previous as Record<string, unknown>)[key]
                        : undefined;
                const next = materialize(field, previousField, ctx);
                if (next !== undefined) value[key] = next;
            }
            return value;
        }
        case 'leaf': {
            const plugin = ctx?.leafPlugins[meta.plugin];
            if (plugin?.isValue(previous)) return previous as JsonValue;
            return plugin ? plugin.empty({schema: ctx.root}) : (previous as JsonValue | undefined);
        }
    }
}
