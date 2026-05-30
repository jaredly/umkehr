import {fractionalIndexBetween} from './fractionalIndex.js';
import {
    arrayItemSchema,
    isRecordSchema,
    isRichTextSchema,
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
    if (isRichTextSchema(schema)) {
        return {
            kind: 'richText',
            created: ts,
            sentinel: {kind: 'rich-text', version: 1},
            chars: [],
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
        case 'richText':
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
        case 'richText':
            return meta.created;
        default:
            return undefined;
    }
}
