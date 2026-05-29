import type {AppDefinition} from '../crdtApp';
import {
    schemaFingerprint as createSchemaFingerprint,
    schemaFingerprintHash as createSchemaFingerprintHash,
    stableStringify,
} from 'umkehr/migration';

export function schemaFingerprint<TState>(app: Pick<AppDefinition<TState>, 'schema' | 'tagKey'>) {
    return createSchemaFingerprint(app.schema, app.tagKey);
}

export function schemaFingerprintHash<TState>(app: Pick<AppDefinition<TState>, 'schema' | 'tagKey'>) {
    return createSchemaFingerprintHash(app.schema, app.tagKey);
}

export {stableStringify};
