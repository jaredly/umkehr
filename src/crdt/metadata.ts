import {fractionalIndexBetween} from './fractionalIndex.js';
import {
    arrayItemSchema,
    leafPluginDescriptorForSchema,
    isRecordSchema,
    isTaggedUnionSchema,
    propertySchema,
    recordValueSchema,
    resolveRef,
    taggedBranchSchema,
} from './schema.js';
import type {
    ArrayItemMeta,
    CrdtMeta,
    CrdtSchemaContext,
    FractionalIndex,
    HlcTimestamp,
    ItemId,
    JsonValue,
    Schema,
} from './types.js';

export function buildMeta(
    value: JsonValue | undefined,
    inputSchema: Schema,
    ctx: CrdtSchemaContext,
    ts: HlcTimestamp,
): CrdtMeta {
    if (value === undefined) return {kind: 'tombstone', deleted: ts};
    const schema = resolveRef(ctx, inputSchema);
    const leafPlugin = leafPluginForValue(ctx, schema, value);
    if (leafPlugin) {
        const initialized = leafPlugin.plugin.init({
            value: value as never,
            schema,
            ts,
        });
        return {
            kind: 'leaf',
            plugin: leafPlugin.plugin.id,
            created: ts,
            data: initialized.meta,
        };
    }
    if (value === null || typeof value !== 'object') return {kind: 'primitive', ts, value};
    if (Array.isArray(value)) {
        const itemSchema = arrayItemSchema(schema);
        let previous: FractionalIndex | undefined;
        const items: Record<ItemId, ArrayItemMeta> = {};
        value.forEach((item, index) => {
            const order = fractionalIndexBetween(previous);
            previous = order;
            const id = `${ts}:${index}`;
            items[id] = {
                kind: 'live',
                order: {value: order, ts},
                value: buildMeta(item as JsonValue, itemSchema, ctx, ts),
            };
        });
        return {kind: 'array', created: ts, items};
    }
    if (isTaggedUnionSchema(schema, ctx.tagKey)) {
        const tagValue = String((value as Record<string, JsonValue>)[ctx.tagKey]);
        const branch = taggedBranchSchema(ctx, schema, tagValue) ?? {};
        const fields: Record<string, CrdtMeta> = {};
        for (const [key, field] of Object.entries(value)) {
            if (key === ctx.tagKey || field === undefined) continue;
            fields[key] = buildMeta(field, propertySchema(ctx, branch, key), ctx, ts);
        }
        return {
            kind: 'tagged',
            created: ts,
            tagKey: ctx.tagKey,
            tagValue,
            tagTs: ts,
            fields,
        };
    }
    if (isRecordSchema(schema)) {
        const entries: Record<string, CrdtMeta> = {};
        const valueSchema = recordValueSchema(schema);
        for (const [key, field] of Object.entries(value)) {
            if (field !== undefined) entries[key] = buildMeta(field, valueSchema, ctx, ts);
        }
        return {kind: 'record', created: ts, entries};
    }
    const fields: Record<string, CrdtMeta> = {};
    for (const [key, field] of Object.entries(value)) {
        if (field !== undefined)
            fields[key] = buildMeta(field, propertySchema(ctx, schema, key), ctx, ts);
    }
    return {kind: 'object', created: ts, fields};
}

function leafPluginForValue(
    ctx: CrdtSchemaContext,
    schema: Schema,
    value: JsonValue | undefined,
) {
    const descriptor = leafPluginDescriptorForSchema(schema);
    if (descriptor) {
        const plugin = ctx.leafPlugins[descriptor.id];
        if (!plugin) {
            throw new Error(`Missing required leaf CRDT plugin "${descriptor.id}" version ${descriptor.version}.`);
        }
        if (plugin.version !== descriptor.version) {
            throw new Error(
                `Leaf CRDT plugin "${descriptor.id}" version mismatch: schema requires ${descriptor.version}, registered ${plugin.version}.`,
            );
        }
        return {plugin};
    }
    const plugin = Object.values(ctx.leafPlugins).find((candidate) => candidate.isValue(value));
    return plugin ? {plugin} : null;
}

export function cloneMeta(meta: CrdtMeta): CrdtMeta {
    return structuredClone(meta) as CrdtMeta;
}

export function versionOf(meta: CrdtMeta): HlcTimestamp | undefined {
    switch (meta.kind) {
        case 'primitive':
            return meta.ts;
        case 'object':
        case 'record':
        case 'array':
        case 'tagged':
        case 'leaf':
            return meta.created;
        case 'tombstone':
            return meta.deleted;
    }
}

export function createdOf(meta: CrdtMeta): HlcTimestamp | undefined {
    switch (meta.kind) {
        case 'object':
        case 'record':
        case 'array':
        case 'tagged':
        case 'leaf':
            return meta.created;
        default:
            return undefined;
    }
}
