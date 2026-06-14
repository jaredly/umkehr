import type {PathSegment} from '../types.js';
import type {LeafPluginDescriptor} from './plugins.js';
import type {CrdtPathSegment, CrdtSchemaContext, Schema} from './types.js';

export function schemaAtCrdtPath(ctx: CrdtSchemaContext, path: CrdtPathSegment[]) {
    let schema = ctx.root;
    for (const segment of path) {
        const resolved = resolveRef(ctx, schema);
        switch (segment.type) {
            case 'objectField':
                schema = propertySchema(ctx, resolved, segment.key);
                break;
            case 'recordEntry':
                schema = recordValueSchema(resolved);
                break;
            case 'arrayItem':
                schema = arrayItemSchema(resolved);
                break;
            case 'taggedField': {
                const branch = taggedBranchSchema(ctx, resolved, segment.tagValue) ?? {};
                schema = propertySchema(ctx, branch, segment.key);
                break;
            }
        }
    }
    return schema;
}

export function walkSchema(ctx: CrdtSchemaContext, input: Schema, segment: PathSegment) {
    const schema = resolveRef(ctx, input);
    if (segment.type === 'tag') return taggedBranchSchema(ctx, schema, segment.value) ?? {};
    if (isArraySchema(schema)) return arrayItemSchema(schema);
    if (isRecordSchema(schema) && !objectProperties(schema)[String(segment.key)])
        return recordValueSchema(schema);
    return propertySchema(ctx, schema, String(segment.key));
}

export function fieldSegmentType(
    ctx: CrdtSchemaContext,
    schema: Schema,
    key: string,
): 'objectField' | 'recordEntry' {
    const resolved = resolveRef(ctx, schema);
    if (isRecordSchema(resolved) && !objectProperties(resolved)[key]) return 'recordEntry';
    return 'objectField';
}

export function resolveRef(ctx: CrdtSchemaContext, schema: Schema): Schema {
    const ref = (schema as {$ref?: string}).$ref;
    if (!ref) return schema;
    const name = ref.split('/').at(-1);
    const resolved = name ? (ctx.components.schemas?.[name] as Schema | undefined) : undefined;
    return resolved ? resolveRef(ctx, resolved) : schema;
}

export function isArraySchema(schema: Schema): schema is Extract<Schema, {type: 'array'}> {
    return (schema as {type?: string}).type === 'array';
}

export function leafPluginDescriptorForSchema(schema: Schema): LeafPluginDescriptor | null {
    const record = schema as Record<string, unknown>;
    const id = record['x-umkehr-leaf-crdt'];
    const version = record['x-umkehr-leaf-crdt-version'];
    if (id === undefined && version === undefined) return null;
    if (typeof id !== 'string' || id.length === 0) {
        throw new Error('Invalid leaf CRDT schema marker: x-umkehr-leaf-crdt must be a non-empty string.');
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new Error('Invalid leaf CRDT schema marker: x-umkehr-leaf-crdt-version must be a positive integer.');
    }
    return {id, version};
}

export function isLeafSchema(schema: Schema) {
    return leafPluginDescriptorForSchema(schema) !== null;
}

export function collectRequiredLeafPlugins(root: Schema, components: CrdtSchemaContext['components']) {
    const found = new Map<string, LeafPluginDescriptor>();
    const seenRefs = new Set<string>();
    const visit = (schema: Schema | undefined) => {
        if (!schema) return;
        const ref = (schema as {$ref?: string}).$ref;
        if (ref) {
            if (seenRefs.has(ref)) return;
            seenRefs.add(ref);
            const name = ref.split('/').at(-1);
            const resolved = name ? (components.schemas?.[name] as Schema | undefined) : undefined;
            if (resolved) visit(resolved);
            return;
        }

        const descriptor = leafPluginDescriptorForSchema(schema);
        if (descriptor) {
            const existing = found.get(descriptor.id);
            if (existing && existing.version !== descriptor.version) {
                throw new Error(
                    `Schema requires leaf CRDT plugin "${descriptor.id}" at versions ${existing.version} and ${descriptor.version}.`,
                );
            }
            found.set(descriptor.id, descriptor);
        }

        const properties = (schema as {properties?: Record<string, Schema>}).properties;
        if (properties) Object.values(properties).forEach(visit);
        const additional = (schema as {additionalProperties?: true | Schema}).additionalProperties;
        if (additional && additional !== true) visit(additional);
        const items = (schema as {items?: Schema}).items;
        if (items) visit(items);
        const prefixItems = (schema as {prefixItems?: Schema[]}).prefixItems;
        if (prefixItems) prefixItems.forEach(visit);
        const oneOf = (schema as {oneOf?: Schema[]}).oneOf;
        if (oneOf) oneOf.forEach(visit);
        const anyOf = (schema as {anyOf?: Schema[]}).anyOf;
        if (anyOf) anyOf.forEach(visit);
        const allOf = (schema as {allOf?: Schema[]}).allOf;
        if (allOf) allOf.forEach(visit);
    };
    visit(root);
    return Array.from(found.values()).sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}

export function arrayItemSchema(schema: Schema): Schema {
    return (schema as {items?: Schema}).items ?? {};
}

export function isRecordSchema(schema: Schema) {
    return Boolean((schema as {additionalProperties?: unknown}).additionalProperties);
}

export function recordValueSchema(schema: Schema): Schema {
    const additional = (schema as {additionalProperties?: true | Schema}).additionalProperties;
    return additional && additional !== true ? additional : {};
}

export function isTaggedUnionSchema(schema: Schema, tagKey: string) {
    const oneOf = (schema as {oneOf?: Schema[]}).oneOf;
    const discriminator = (schema as {discriminator?: {propertyName?: string}}).discriminator;
    return Boolean(oneOf?.length && discriminator?.propertyName === tagKey);
}

export function taggedBranchSchema(
    ctx: CrdtSchemaContext,
    schema: Schema,
    tagValue: string,
): Schema | undefined {
    const branches = (schema as {oneOf?: Schema[]}).oneOf ?? [];
    return branches.find((branch) => {
        const resolved = resolveRef(ctx, branch);
        const tagSchema = (resolved as {properties?: Record<string, Schema>}).properties?.[
            ctx.tagKey
        ] as ({const?: unknown; enum?: unknown[]} & Schema) | undefined;
        return tagSchema?.const === tagValue || tagSchema?.enum?.includes(tagValue);
    });
}

export function propertySchema(ctx: CrdtSchemaContext, schema: Schema, key: string): Schema {
    const resolved = resolveRef(ctx, schema);
    return objectProperties(resolved)[key] ?? recordValueSchema(resolved);
}

export function objectProperties(schema: Schema): Record<string, Schema> {
    return (schema as {properties?: Record<string, Schema>}).properties ?? {};
}
