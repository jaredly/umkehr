import type {IJsonSchemaCollection, OpenApi} from 'typia';
import type {CrdtPathSegment, CrdtUpdate, HlcTimestamp, JsonValue} from './types.js';

export type CrdtUpdateValidationIssue = {
    path: string;
    message: string;
    expected?: string;
    value?: unknown;
};

export type CrdtUpdateValidationResult<T> =
    | {success: true; data: CrdtUpdate}
    | {success: false; data: unknown; errors: CrdtUpdateValidationIssue[]};

export type CrdtUpdateValidator<T> = {
    validate(input: unknown): CrdtUpdateValidationResult<T>;
    is(input: unknown): input is CrdtUpdate;
    assert(input: unknown): CrdtUpdate;
};

export type CrdtUpdateValidatorOptions = {
    schemaIndex?: number;
    tagKey?: string;
};

type Schema = OpenApi.IJsonSchema;
type Components = OpenApi.IComponents;

type SchemaContext = {
    root: Schema;
    components: Components;
    tagKey: string;
};

type RefContext = {
    components: Components;
    seenRefs: Set<string>;
};

type WalkResult =
    | {ok: true; schema: Schema}
    | {ok: false; issue: CrdtUpdateValidationIssue};

export function createCrdtUpdateValidator<T>(
    collection: IJsonSchemaCollection<'3.1', [T]>,
    options: CrdtUpdateValidatorOptions = {},
): CrdtUpdateValidator<T> {
    const root = collection.schemas[options.schemaIndex ?? 0];
    if (!root) {
        throw new Error(
            `Cannot create CRDT update validator: schema index ${options.schemaIndex ?? 0} is missing.`,
        );
    }
    const ctx: SchemaContext = {
        root,
        components: collection.components,
        tagKey: options.tagKey ?? 'type',
    };

    const validate = (input: unknown): CrdtUpdateValidationResult<T> => {
        const envelope = validateEnvelope(input);
        if (!envelope.success) return envelope;

        const update = envelope.data;
        const errors = validateUpdateSchema(update, ctx);
        if (errors.length) return {success: false, data: input, errors};
        return {success: true, data: update};
    };

    return {
        validate,
        is: (input): input is CrdtUpdate => validate(input).success,
        assert: (input) => {
            const result = validate(input);
            if (result.success) return result.data;
            throw new CrdtUpdateValidationError(result.errors);
        },
    };
}

export function validateCrdtUpdate<T>(
    collection: IJsonSchemaCollection<'3.1', [T]>,
    input: unknown,
    options?: CrdtUpdateValidatorOptions,
): CrdtUpdateValidationResult<T> {
    return createCrdtUpdateValidator(collection, options).validate(input);
}

export class CrdtUpdateValidationError extends Error {
    constructor(readonly errors: CrdtUpdateValidationIssue[]) {
        super(errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
        this.name = 'CrdtUpdateValidationError';
    }
}

function validateEnvelope(input: unknown): CrdtUpdateValidationResult<unknown> {
    if (!isRecord(input)) {
        return fail(input, {path: '<update>', message: 'CRDT update must be an object.', value: input});
    }
    if (typeof input.op !== 'string') {
        return fail(input, {path: 'op', message: 'CRDT update op must be a string.', value: input.op});
    }
    if (!['set', 'delete', 'setOrder'].includes(input.op)) {
        return fail(input, {path: 'op', message: `Unknown CRDT update op "${input.op}".`, value: input.op});
    }
    const metaIssue = validateMeta(input.meta);
    if (metaIssue) return fail(input, metaIssue);

    switch (input.op) {
        case 'set': {
            const pathIssue = validateCrdtPathEnvelope(input.path, 'path');
            if (pathIssue) return fail(input, pathIssue);
            if (!('value' in input)) return fail(input, {path: 'value', message: '"set" requires value.'});
            const tsIssue = validateTimestamp(input.ts, 'ts');
            if (tsIssue) return fail(input, tsIssue);
            return {success: true, data: input as CrdtUpdate};
        }
        case 'delete': {
            const pathIssue = validateCrdtPathEnvelope(input.path, 'path');
            if (pathIssue) return fail(input, pathIssue);
            const tsIssue = validateTimestamp(input.ts, 'ts');
            if (tsIssue) return fail(input, tsIssue);
            return {success: true, data: input as CrdtUpdate};
        }
        case 'setOrder': {
            const pathIssue = validateCrdtPathEnvelope(input.arrayPath, 'arrayPath');
            if (pathIssue) return fail(input, pathIssue);
            if (!isRecord(input.orders)) {
                return fail(input, {
                    path: 'orders',
                    message: '"setOrder" requires orders: Record<string, {value: string; ts: string}>.',
                    value: input.orders,
                });
            }
            for (const [id, order] of Object.entries(input.orders)) {
                if (!id) {
                    return fail(input, {path: 'orders', message: 'Order IDs must be non-empty strings.'});
                }
                if (!isRecord(order)) {
                    return fail(input, {
                        path: `orders/${id}`,
                        message: 'Order value must be an object.',
                        value: order,
                    });
                }
                if (typeof order.value !== 'string' || order.value.length === 0) {
                    return fail(input, {
                        path: `orders/${id}/value`,
                        message: 'Order fractional index must be a non-empty string.',
                        value: order.value,
                    });
                }
                const tsIssue = validateTimestamp(order.ts, `orders/${id}/ts`);
                if (tsIssue) return fail(input, tsIssue);
            }
            return {success: true, data: input as CrdtUpdate};
        }
    }
    return fail(input, {path: 'op', message: 'Unknown CRDT update op.', value: input.op});
}

function validateMeta(input: unknown): CrdtUpdateValidationIssue | null {
    if (input === undefined) return null;
    if (!isRecord(input)) {
        return {path: 'meta', message: 'CRDT update metadata must be an object.', value: input};
    }
    const commandIdIssue = validateTimestamp(input.commandId, 'meta/commandId');
    if (commandIdIssue) return commandIdIssue;
    if (
        typeof input.commandSeq !== 'number' ||
        !Number.isInteger(input.commandSeq) ||
        input.commandSeq < 0
    ) {
        return {
            path: 'meta/commandSeq',
            message: 'CRDT update metadata commandSeq must be a non-negative integer.',
            expected: 'non-negative integer',
            value: input.commandSeq,
        };
    }
    if (input.intent !== 'edit' && input.intent !== 'undo' && input.intent !== 'redo') {
        return {
            path: 'meta/intent',
            message: 'CRDT update metadata intent must be "edit", "undo", or "redo".',
            expected: 'edit | undo | redo',
            value: input.intent,
        };
    }
    if (input.intent === 'edit') {
        if (input.targetCommandId !== undefined) {
            return {
                path: 'meta/targetCommandId',
                message: 'Edit metadata must not include targetCommandId.',
                value: input.targetCommandId,
            };
        }
        return null;
    }
    const targetIssue = validateTimestamp(input.targetCommandId, 'meta/targetCommandId');
    if (targetIssue) return targetIssue;
    return null;
}

function validateCrdtPathEnvelope(input: unknown, path: string): CrdtUpdateValidationIssue | null {
    if (!Array.isArray(input)) return {path, message: 'CRDT path must be an array.', value: input};
    for (let i = 0; i < input.length; i++) {
        const segment = input[i];
        const issuePath = `${path}/${i}`;
        if (!isRecord(segment)) {
            return {path: issuePath, message: 'CRDT path segment must be an object.', value: segment};
        }
        switch (segment.type) {
            case 'objectField':
            case 'recordEntry': {
                if (typeof segment.key !== 'string') {
                    return {
                        path: `${issuePath}/key`,
                        message: `${segment.type} requires a string key.`,
                        value: segment.key,
                    };
                }
                const createdIssue = validateTimestamp(segment.parentCreated, `${issuePath}/parentCreated`);
                if (createdIssue) return createdIssue;
                break;
            }
            case 'arrayItem': {
                if (typeof segment.id !== 'string' || segment.id.length === 0) {
                    return {path: `${issuePath}/id`, message: 'arrayItem requires a non-empty string id.', value: segment.id};
                }
                const createdIssue = validateTimestamp(segment.parentCreated, `${issuePath}/parentCreated`);
                if (createdIssue) return createdIssue;
                if (segment.order !== undefined) {
                    if (!isRecord(segment.order)) {
                        return {path: `${issuePath}/order`, message: 'arrayItem order must be an object.', value: segment.order};
                    }
                    if (typeof segment.order.value !== 'string' || segment.order.value.length === 0) {
                        return {
                            path: `${issuePath}/order/value`,
                            message: 'arrayItem order value must be a non-empty string.',
                            value: segment.order.value,
                        };
                    }
                    const orderTsIssue = validateTimestamp(segment.order.ts, `${issuePath}/order/ts`);
                    if (orderTsIssue) return orderTsIssue;
                }
                break;
            }
            case 'taggedField': {
                if (typeof segment.key !== 'string') {
                    return {path: `${issuePath}/key`, message: 'taggedField requires a string key.', value: segment.key};
                }
                if (typeof segment.tagKey !== 'string' || segment.tagKey.length === 0) {
                    return {
                        path: `${issuePath}/tagKey`,
                        message: 'taggedField requires a non-empty string tagKey.',
                        value: segment.tagKey,
                    };
                }
                if (typeof segment.tagValue !== 'string') {
                    return {
                        path: `${issuePath}/tagValue`,
                        message: 'taggedField requires a string tagValue.',
                        value: segment.tagValue,
                    };
                }
                const createdIssue = validateTimestamp(segment.parentCreated, `${issuePath}/parentCreated`);
                if (createdIssue) return createdIssue;
                const tagTsIssue = validateTimestamp(segment.tagTs, `${issuePath}/tagTs`);
                if (tagTsIssue) return tagTsIssue;
                break;
            }
            default:
                return {path: `${issuePath}/type`, message: 'Unknown CRDT path segment type.', value: segment.type};
        }
    }
    return null;
}

function validateUpdateSchema(update: CrdtUpdate, ctx: SchemaContext) {
    const errors: CrdtUpdateValidationIssue[] = [];
    if (update.op === 'setOrder') {
        const target = walkCrdtPath(ctx, update.arrayPath, 'arrayPath');
        if (!target.ok) {
            errors.push(target.issue);
        } else if (!isArrayLike(ctx.components, target.schema)) {
            errors.push({
                path: 'arrayPath',
                message: `setOrder path "${pathToIssuePath(update.arrayPath)}" must point to an array.`,
                expected: 'array',
            });
        }
        return errors;
    }

    const target = walkCrdtPath(ctx, update.path, 'path');
    if (!target.ok) {
        errors.push(target.issue);
        return errors;
    }
    if (update.op === 'set') {
        const issue = validateValue(ctx.components, target.schema, update.value, 'value');
        if (issue) errors.push(issue);
    }
    return errors;
}

function walkCrdtPath(ctx: SchemaContext, path: CrdtPathSegment[], rootName: string): WalkResult {
    let schema = ctx.root;
    for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const next = walkCrdtSegment(ctx, schema, segment);
        if (!next.ok) {
            return {
                ok: false,
                issue: {
                    ...next.issue,
                    path: `${rootName}/${i}`,
                    message: `${next.issue.message} at "${pathToIssuePath(path.slice(0, i + 1))}".`,
                },
            };
        }
        schema = next.schema;
    }
    return {ok: true, schema};
}

function walkCrdtSegment(ctx: SchemaContext, input: Schema, segment: CrdtPathSegment): WalkResult {
    const resolved = resolveRef({components: ctx.components, seenRefs: new Set()}, input);
    if (!resolved.ok) return resolved;
    const schema = resolved.schema;

    if (isOneOf(schema)) {
        if (schema.discriminator) {
            if (segment.type !== 'taggedField') {
                return failWalk('Tagged-union paths must use a taggedField segment');
            }
        } else {
            const branches = schema.oneOf
                .map((branch) => walkCrdtSegment(ctx, branch, segment))
                .filter((result): result is {ok: true; schema: Schema} => result.ok)
                .map((result) => result.schema);
            if (!branches.length) return failWalk(`Segment is not valid for any union branch`);
            return {ok: true, schema: branches.length === 1 ? branches[0] : {oneOf: branches}};
        }
    }

    switch (segment.type) {
        case 'objectField':
            return walkObjectField(ctx, schema, segment.key);
        case 'recordEntry':
            return walkRecordEntry(schema, segment.key);
        case 'arrayItem':
            if (!isArraySchema(schema)) return failWalk(`Cannot navigate array item through ${describeSchema(schema)}`);
            return {ok: true, schema: arrayElementSchema(schema)};
        case 'taggedField':
            return walkTaggedField(ctx, schema, segment);
    }
}

function walkObjectField(ctx: SchemaContext, schema: Schema, key: string): WalkResult {
    const resolved = resolveRef({components: ctx.components, seenRefs: new Set()}, schema);
    if (!resolved.ok) return resolved;
    if (isOneOf(resolved.schema) && resolved.schema.discriminator) {
        return failWalk('Tagged-union paths must use a taggedField segment');
    }
    if (!isObjectSchema(resolved.schema)) {
        return failWalk(`Cannot navigate object field "${key}" through ${describeSchema(resolved.schema)}`);
    }
    const property = resolved.schema.properties?.[key];
    if (!property) {
        return failWalk(`Key "${key}" is not defined by the object schema`);
    }
    return {ok: true, schema: property};
}

function walkRecordEntry(schema: Schema, key: string): WalkResult {
    if (!isObjectSchema(schema)) return failWalk(`Cannot navigate record entry "${key}" through ${describeSchema(schema)}`);
    if (schema.properties?.[key]) {
        return failWalk(`Key "${key}" is an object field, not a record entry`);
    }
    if (schema.additionalProperties === true) return {ok: true, schema: {}};
    if (schema.additionalProperties) return {ok: true, schema: schema.additionalProperties};
    return failWalk(`Schema does not allow record entries`);
}

function walkTaggedField(ctx: SchemaContext, schema: Schema, segment: Extract<CrdtPathSegment, {type: 'taggedField'}>): WalkResult {
    if (!isOneOf(schema)) return failWalk('taggedField requires a tagged union schema');
    if (schema.discriminator?.propertyName !== segment.tagKey) {
        return failWalk(`Expected discriminator "${schema.discriminator?.propertyName ?? '<none>'}"`);
    }
    if (segment.tagKey !== ctx.tagKey) {
        return failWalk(`Expected configured tag key "${ctx.tagKey}"`);
    }

    const mapped = schema.discriminator.mapping?.[segment.tagValue];
    if (mapped) {
        const ref = resolveRef({components: ctx.components, seenRefs: new Set()}, {$ref: mapped});
        if (ref.ok) return walkObjectField(ctx, ref.schema, segment.key);
    }

    for (const branch of schema.oneOf) {
        const resolved = resolveRef({components: ctx.components, seenRefs: new Set()}, branch);
        if (!resolved.ok || !isObjectSchema(resolved.schema)) continue;
        const tagSchema = resolved.schema.properties?.[segment.tagKey];
        if (tagSchema && schemaAllowsValue(ctx.components, tagSchema, segment.tagValue)) {
            return walkObjectField(ctx, resolved.schema, segment.key);
        }
    }
    return failWalk(`No union variant matches ${segment.tagKey}="${segment.tagValue}"`);
}

function validateValue(
    components: Components,
    input: Schema,
    value: unknown,
    path: string,
    seenRefs = new Set<string>(),
): CrdtUpdateValidationIssue | null {
    const resolved = resolveRef({components, seenRefs}, input);
    if (!resolved.ok) return {...resolved.issue, path};
    const schema = resolved.schema;

    if (isOneOf(schema)) {
        return schema.oneOf.some((branch) => !validateValue(components, branch, value, path, new Set(seenRefs)))
            ? null
            : {path, message: `Value does not match any union branch.`, expected: describeSchema(schema), value};
    }
    if ('const' in schema) {
        return Object.is(value, schema.const)
            ? null
            : {path, message: `Value must equal ${JSON.stringify(schema.const)}.`, expected: 'constant', value};
    }
    if (!('type' in schema) || schema.type === undefined) return null;

    switch (schema.type) {
        case 'null':
            return value === null ? null : {path, message: 'Value must be null.', expected: 'null', value};
        case 'boolean':
            return typeof value === 'boolean'
                ? null
                : {path, message: 'Value must be a boolean.', expected: 'boolean', value};
        case 'integer':
            return Number.isInteger(value)
                ? null
                : {path, message: 'Value must be an integer.', expected: 'integer', value};
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
                ? null
                : {path, message: 'Value must be a finite number.', expected: 'number', value};
        case 'string': {
            if (typeof value !== 'string') return {path, message: 'Value must be a string.', expected: 'string', value};
            if (schema.minLength !== undefined && value.length < schema.minLength) {
                return {path, message: `String length must be at least ${schema.minLength}.`, value};
            }
            if (schema.maxLength !== undefined && value.length > schema.maxLength) {
                return {path, message: `String length must be at most ${schema.maxLength}.`, value};
            }
            if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
                return {path, message: `String must match pattern ${schema.pattern}.`, value};
            }
            return null;
        }
        case 'array':
            return validateArrayValue(components, schema, value, path, seenRefs);
        case 'object':
            return validateObjectValue(components, schema, value, path, seenRefs);
    }
}

function validateArrayValue(
    components: Components,
    schema: Extract<Schema, {type: 'array'}>,
    value: unknown,
    path: string,
    seenRefs: Set<string>,
) {
    if (!Array.isArray(value)) return {path, message: 'Value must be an array.', expected: 'array', value};
    if (schema.minItems !== undefined && value.length < schema.minItems) {
        return {path, message: `Array length must be at least ${schema.minItems}.`, value};
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return {path, message: `Array length must be at most ${schema.maxItems}.`, value};
    }
    if ('prefixItems' in schema) {
        for (let i = 0; i < schema.prefixItems.length; i++) {
            const issue = validateValue(components, schema.prefixItems[i], value[i], `${path}/${i}`, new Set(seenRefs));
            if (issue) return issue;
        }
        if (value.length > schema.prefixItems.length) {
            if (schema.additionalItems === false || schema.additionalItems === undefined) {
                return {path, message: 'Tuple has too many items.', value};
            }
            if (schema.additionalItems !== true) {
                for (let i = schema.prefixItems.length; i < value.length; i++) {
                    const issue = validateValue(components, schema.additionalItems, value[i], `${path}/${i}`);
                    if (issue) return issue;
                }
            }
        }
        return null;
    }
    for (let i = 0; i < value.length; i++) {
        const issue = validateValue(components, schema.items ?? {}, value[i], `${path}/${i}`, new Set(seenRefs));
        if (issue) return issue;
    }
    return null;
}

function validateObjectValue(
    components: Components,
    schema: Extract<Schema, {type: 'object'}>,
    value: unknown,
    path: string,
    seenRefs: Set<string>,
) {
    if (!isRecord(value)) return {path, message: 'Value must be an object.', expected: 'object', value};
    for (const key of schema.required ?? []) {
        if (!(key in value)) return {path: `${path}/${key}`, message: 'Required property is missing.'};
    }
    for (const [key, childValue] of Object.entries(value)) {
        const childSchema = schema.properties?.[key];
        if (childSchema) {
            const issue = validateValue(components, childSchema, childValue, `${path}/${key}`, new Set(seenRefs));
            if (issue) return issue;
            continue;
        }
        if (schema.additionalProperties === false || schema.additionalProperties === undefined) {
            return {path: `${path}/${key}`, message: 'Additional property is not allowed.', value: childValue};
        }
        if (schema.additionalProperties !== true) {
            const issue = validateValue(
                components,
                schema.additionalProperties,
                childValue,
                `${path}/${key}`,
                new Set(seenRefs),
            );
            if (issue) return issue;
        }
    }
    return null;
}

function validateTimestamp(input: unknown, path: string): CrdtUpdateValidationIssue | null {
    if (typeof input !== 'string' || input.length === 0) {
        return {path, message: 'Timestamp must be a non-empty string.', expected: 'string', value: input};
    }
    return null;
}

function schemaAllowsValue(components: Components, schema: Schema, value: unknown) {
    return validateValue(components, schema, value, '<schema>') === null;
}

function isArrayLike(components: Components, input: Schema): boolean {
    const schema = resolveRef({components, seenRefs: new Set()}, input);
    return (
        schema.ok &&
        (isArraySchema(schema.schema) ||
            (isOneOf(schema.schema) && schema.schema.oneOf.every((s) => isArrayLike(components, s))))
    );
}

function resolveRef(ctx: RefContext, schema: Schema): WalkResult {
    if (!('$ref' in schema)) return {ok: true, schema};
    if (ctx.seenRefs.has(schema.$ref)) return {ok: true, schema: {}};
    ctx.seenRefs.add(schema.$ref);
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) return failWalk(`Unsupported schema reference "${schema.$ref}"`);
    const name = schema.$ref.slice(prefix.length);
    const resolved = ctx.components.schemas?.[name];
    if (!resolved) return failWalk(`Unknown schema reference "${schema.$ref}"`);
    return resolveRef(ctx, resolved);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf(schema: Schema): schema is Extract<Schema, {oneOf: Schema[]}> {
    return 'oneOf' in schema;
}

function isObjectSchema(schema: Schema): schema is Extract<Schema, {type: 'object'}> {
    return 'type' in schema && schema.type === 'object';
}

function isArraySchema(schema: Schema): schema is Extract<Schema, {type: 'array'}> {
    return 'type' in schema && schema.type === 'array';
}

function arrayElementSchema(schema: Extract<Schema, {type: 'array'}>): Schema {
    if ('prefixItems' in schema) return schema.prefixItems.length === 1 ? schema.prefixItems[0] : {oneOf: schema.prefixItems};
    return schema.items ?? {};
}

function fail<T>(data: unknown, issue: CrdtUpdateValidationIssue): CrdtUpdateValidationResult<T> {
    return {success: false, data, errors: [issue]};
}

function failWalk(message: string): WalkResult {
    return {ok: false, issue: {path: 'path', message}};
}

function describeSchema(schema: Schema): string {
    if ('$ref' in schema) return schema.$ref;
    if ('const' in schema) return JSON.stringify(schema.const);
    if ('oneOf' in schema) return 'union';
    return 'type' in schema ? (schema.type ?? 'unknown') : 'unknown';
}

function pathToIssuePath(path: CrdtPathSegment[]) {
    return path
        .map((segment) => {
            switch (segment.type) {
                case 'objectField':
                    return segment.key;
                case 'recordEntry':
                    return `{${segment.key}}`;
                case 'arrayItem':
                    return `[${segment.id}]`;
                case 'taggedField':
                    return `${segment.tagKey}:${segment.tagValue}.${segment.key}`;
            }
        })
        .join('.');
}
