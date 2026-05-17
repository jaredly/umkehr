import type {AppDefinition} from '../crdtApp';

export function schemaFingerprint<TState>(app: AppDefinition<TState>) {
    return stableStringify({
        root: app.schema.schemas[0],
        components: app.schema.components,
        tagKey: app.tagKey,
    });
}

export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
