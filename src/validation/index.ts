import type {IJsonSchemaCollection, OpenApi} from 'typia';
import type {Patch, Path, PathSegment} from '../types.js';

export type PatchValidationIssue = {
    path: string;
    message: string;
    expected?: string;
    value?: unknown;
};

export type PatchValidationResult<T> =
    | {success: true; data: Patch<T>}
    | {success: false; data: unknown; errors: PatchValidationIssue[]};

export type PatchValidator<T> = {
    validate(input: unknown): PatchValidationResult<T>;
    is(input: unknown): input is Patch<T>;
    assert(input: unknown): Patch<T>;
};

export type PatchValidatorOptions = {
    schemaIndex?: number;
};

type Schema = OpenApi.IJsonSchema;
type Components = OpenApi.IComponents;

type Context = {
    components: Components;
    seenRefs: Set<string>;
};

type WalkResult = {ok: true; schema: Schema} | {ok: false; issue: PatchValidationIssue};

export function createPatchValidator<T>(
    collection: IJsonSchemaCollection<'3.1', [T]>,
    options: PatchValidatorOptions = {},
): PatchValidator<T> {
    const root = collection.schemas[options.schemaIndex ?? 0];
    if (!root) {
        throw new Error(`Cannot create patch validator: schema index ${options.schemaIndex ?? 0} is missing.`);
    }
    const components = collection.components;

    const validate = (input: unknown): PatchValidationResult<T> => {
        const envelope = validateEnvelope(input);
        if (!envelope.success) return envelope;

        const patch = envelope.data;
        const errors = validatePatchSchema(patch, root, components);
        if (errors.length) return {success: false, data: input, errors};
        return {success: true, data: patch as Patch<T>};
    };

    return {
        validate,
        is: (input): input is Patch<T> => validate(input).success,
        assert: (input) => {
            const result = validate(input);
            if (result.success) return result.data;
            throw new PatchValidationError(result.errors);
        },
    };
}

export function validatePatch<T>(
    collection: IJsonSchemaCollection<'3.1', [T]>,
    input: unknown,
    options?: PatchValidatorOptions,
): PatchValidationResult<T> {
    return createPatchValidator(collection, options).validate(input);
}

export class PatchValidationError extends Error {
    constructor(readonly errors: PatchValidationIssue[]) {
        super(errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
        this.name = 'PatchValidationError';
    }
}

function validateEnvelope(input: unknown): PatchValidationResult<unknown> {
    if (!isRecord(input)) {
        return fail(input, {path: '<patch>', message: 'Patch must be an object.', value: input});
    }
    if (typeof input.op !== 'string') {
        return fail(input, {path: 'op', message: 'Patch op must be a string.', value: input.op});
    }
    if (!['add', 'replace', 'remove', 'move', 'reorder'].includes(input.op)) {
        return fail(input, {path: 'op', message: `Unknown patch op "${input.op}".`, value: input.op});
    }
    const pathIssue = validatePathEnvelope(input.path, 'path');
    if (pathIssue) return fail(input, pathIssue);

    switch (input.op) {
        case 'add':
        case 'remove':
            if (!('value' in input)) return fail(input, {path: 'value', message: `"${input.op}" requires value.`});
            break;
        case 'replace':
            if (!('value' in input)) return fail(input, {path: 'value', message: '"replace" requires value.'});
            if (!('previous' in input))
                return fail(input, {path: 'previous', message: '"replace" requires previous.'});
            break;
        case 'move': {
            const fromIssue = validatePathEnvelope(input.from, 'from');
            if (fromIssue) return fail(input, fromIssue);
            break;
        }
        case 'reorder':
            if (!Array.isArray(input.indices)) {
                return fail(input, {
                    path: 'indices',
                    message: '"reorder" requires indices: number[].',
                    value: input.indices,
                });
            }
            for (let i = 0; i < input.indices.length; i++) {
                if (!Number.isInteger(input.indices[i])) {
                    return fail(input, {
                        path: `indices/${i}`,
                        message: 'Reorder indices must be integers.',
                        value: input.indices[i],
                    });
                }
            }
            break;
    }
    return {success: true, data: input as Patch<unknown>};
}

function validatePatchSchema(patch: Patch<unknown>, root: Schema, components: Components) {
    const errors: PatchValidationIssue[] = [];
    const at = (field: string) => field;
    const pathTarget = walkPath(root, patch.path, components);

    if (!pathTarget.ok) {
        errors.push(pathTarget.issue);
        return errors;
    }

    switch (patch.op) {
        case 'add':
            pushValueErrors(errors, components, pathTarget.schema, patch.value, at('value'));
            break;
        case 'replace':
            pushValueErrors(errors, components, pathTarget.schema, patch.value, at('value'));
            pushValueErrors(errors, components, pathTarget.schema, patch.previous, at('previous'));
            break;
        case 'remove':
            pushValueErrors(errors, components, pathTarget.schema, patch.value, at('value'));
            break;
        case 'move': {
            const fromTarget = walkPath(root, patch.from, components, 'from');
            if (!fromTarget.ok) {
                errors.push(fromTarget.issue);
            } else if (!schemaCovers(components, pathTarget.schema, fromTarget.schema)) {
                errors.push({
                    path: 'from',
                    message: `Move source is not compatible with destination "${pathToIssuePath(patch.path)}".`,
                    expected: describeSchema(pathTarget.schema),
                });
            }
            break;
        }
        case 'reorder':
            if (!isArrayLike(components, pathTarget.schema)) {
                errors.push({
                    path: 'path',
                    message: `Reorder path "${pathToIssuePath(patch.path)}" must point to an array.`,
                    expected: 'array',
                });
            }
            break;
    }

    return errors;
}

function validatePathEnvelope(input: unknown, path: string): PatchValidationIssue | null {
    if (!Array.isArray(input)) {
        return {path, message: 'Path must be an array.', value: input};
    }
    for (let i = 0; i < input.length; i++) {
        const segment = input[i];
        const issuePath = `${path}/${i}`;
        if (!isRecord(segment)) {
            return {path: issuePath, message: 'Path segment must be an object.', value: segment};
        }
        if (segment.type === 'key') {
            if (typeof segment.key !== 'string' && typeof segment.key !== 'number') {
                return {
                    path: `${issuePath}/key`,
                    message: 'Key path segment requires string or number key.',
                    value: segment.key,
                };
            }
            continue;
        }
        if (segment.type === 'tag') {
            if (typeof segment.key !== 'string' || typeof segment.value !== 'string') {
                return {
                    path: issuePath,
                    message: 'Tag path segment requires string key and string value.',
                    value: segment,
                };
            }
            continue;
        }
        return {path: `${issuePath}/type`, message: 'Unknown path segment type.', value: segment.type};
    }
    return null;
}

function walkPath(root: Schema, path: Path, components: Components, rootName = 'path'): WalkResult {
    let schema = root;
    for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const ctx = {components, seenRefs: new Set<string>()};
        const next = segment.type === 'tag' ? walkTag(ctx, schema, segment) : walkKey(ctx, schema, segment);
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

function walkKey(ctx: Context, input: Schema, segment: Extract<PathSegment, {type: 'key'}>): WalkResult {
    const schema = resolveRef(ctx, input);
    if (!schema.ok) return schema;

    if (isOneOf(schema.schema)) {
        if (schema.schema.discriminator) {
            return failWalk('Tagged-union paths must use a tag segment before key navigation');
        }
        const branches = schema.schema.oneOf
            .map((branch) => walkKey({...ctx, seenRefs: new Set(ctx.seenRefs)}, branch, segment))
            .filter((result): result is {ok: true; schema: Schema} => result.ok)
            .map((result) => result.schema);
        if (!branches.length) return failWalk(`Key "${segment.key}" is not valid for any union branch`);
        return {ok: true, schema: branches.length === 1 ? branches[0] : {oneOf: branches}};
    }

    if (isObjectSchema(schema.schema)) {
        const key = String(segment.key);
        if (schema.schema.properties?.[key]) return {ok: true, schema: schema.schema.properties[key]};
        if (schema.schema.additionalProperties === true) return {ok: true, schema: {}};
        if (schema.schema.additionalProperties) return {ok: true, schema: schema.schema.additionalProperties};
        return failWalk(`Key "${key}" is not defined by the object schema`);
    }

    if (isArraySchema(schema.schema)) {
        if (typeof segment.key !== 'number' || !Number.isInteger(segment.key)) {
            return failWalk(`Array keys must be integer numbers, got "${segment.key}"`);
        }
        if ('prefixItems' in schema.schema) {
            const item = schema.schema.prefixItems[segment.key];
            if (item) return {ok: true, schema: item};
            if (schema.schema.additionalItems === true) return {ok: true, schema: {}};
            if (schema.schema.additionalItems) return {ok: true, schema: schema.schema.additionalItems};
            return failWalk(`Tuple index ${segment.key} is outside the tuple schema`);
        }
        return {ok: true, schema: schema.schema.items};
    }

    return failWalk(`Cannot navigate key "${segment.key}" through ${describeSchema(schema.schema)}`);
}

function walkTag(ctx: Context, input: Schema, segment: Extract<PathSegment, {type: 'tag'}>): WalkResult {
    const schema = resolveRef(ctx, input);
    if (!schema.ok) return schema;
    if (!isOneOf(schema.schema)) return failWalk(`Tag segment requires a union schema`);
    if (schema.schema.discriminator?.propertyName !== segment.key) {
        return failWalk(`Expected discriminator "${schema.schema.discriminator?.propertyName ?? '<none>'}"`);
    }

    const mapped = schema.schema.discriminator.mapping?.[segment.value];
    if (mapped) {
        const ref = resolveRef(ctx, {$ref: mapped});
        if (ref.ok) return ref;
    }

    for (const branch of schema.schema.oneOf) {
        const resolved = resolveRef(ctx, branch);
        if (!resolved.ok || !isObjectSchema(resolved.schema)) continue;
        const tagSchema = resolved.schema.properties?.[segment.key];
        if (tagSchema && schemaAllowsValue(ctx.components, tagSchema, segment.value)) {
            return resolved;
        }
    }
    return failWalk(`No union variant matches ${segment.key}="${segment.value}"`);
}

function pushValueErrors(
    errors: PatchValidationIssue[],
    components: Components,
    schema: Schema,
    value: unknown,
    path: string,
) {
    const issue = validateValue(components, schema, value, path);
    if (issue) errors.push(issue);
}

function validateValue(
    components: Components,
    input: Schema,
    value: unknown,
    path: string,
    seenRefs = new Set<string>(),
): PatchValidationIssue | null {
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
        const issue = validateValue(components, schema.items, value[i], `${path}/${i}`, new Set(seenRefs));
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

function schemaCovers(components: Components, destination: Schema, source: Schema): boolean {
    const dest = resolveRef({components, seenRefs: new Set()}, destination);
    const src = resolveRef({components, seenRefs: new Set()}, source);
    if (!dest.ok || !src.ok) return false;
    if (isUnknown(dest.schema)) return true;
    if (isOneOf(src.schema)) return src.schema.oneOf.every((branch) => schemaCovers(components, dest.schema, branch));
    if (isOneOf(dest.schema)) return dest.schema.oneOf.some((branch) => schemaCovers(components, branch, src.schema));
    if ('const' in src.schema) return schemaAllowsValue(components, dest.schema, src.schema.const);
    if ('const' in dest.schema) return 'const' in src.schema && Object.is(dest.schema.const, src.schema.const);
    if (isUnknown(src.schema)) return false;
    if (hasType(dest.schema, 'number') && hasType(src.schema, 'integer')) return true;
    return JSON.stringify(dest.schema) === JSON.stringify(src.schema);
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

function resolveRef(ctx: Context, schema: Schema): WalkResult {
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

function hasType<Type extends string>(schema: Schema, type: Type): schema is Schema & {type: Type} {
    return 'type' in schema && schema.type === type;
}

function isUnknown(schema: Schema) {
    return !('type' in schema) && !('const' in schema) && !('oneOf' in schema) && !('$ref' in schema);
}

function fail<T>(data: unknown, issue: PatchValidationIssue): PatchValidationResult<T> {
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

function pathToIssuePath(path: Path): string {
    return path.map((segment) => (segment.type === 'tag' ? `[${segment.key}=${segment.value}]` : String(segment.key))).join('/') || '<root>';
}
