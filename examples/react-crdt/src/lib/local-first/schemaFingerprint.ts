import type {AppDefinition} from '../crdtApp';
import {
    schemaFingerprint as createSchemaFingerprint,
    schemaFingerprintHash as createSchemaFingerprintHash,
    stableStringify,
} from 'umkehr/migration';

export function schemaFingerprint<TState>(app: AppDefinition<TState>) {
    return createSchemaFingerprint(app.schema, app.tagKey);
}

export function schemaFingerprintHash<TState>(app: AppDefinition<TState>) {
    return createSchemaFingerprintHash(app.schema, app.tagKey);
}

export {stableStringify};
