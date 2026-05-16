import type {PathSegment} from '../types.js';
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
