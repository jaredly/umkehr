import {
    createCrdtUpdateValidator,
    hlc,
    type CrdtDocument,
    type CrdtMeta,
    type CrdtUpdate,
    type PendingUpdate,
} from 'umkehr/crdt';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import type {
    LocalFirstMember,
    LocalFirstRole,
    PersistedBatch,
    VersionVector,
} from './types';
import {stableStringify} from './schemaFingerprint';

export const LOCAL_FIRST_PROTOCOL_VERSION = 1;

export type LocalFirstMessage<TState> =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          peerId?: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          role: LocalFirstRole;
          vector: VersionVector;
      }
    | {
          kind: 'updates';
          version: 1;
          actor: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          batch: PersistedBatch;
      }
    | {
          kind: 'syncRequest';
          version: 1;
          actor: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          vector: VersionVector;
      }
    | {
          kind: 'syncResponse';
          version: 1;
          actor: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          since: VersionVector;
          batches: PersistedBatch[];
          requiresSnapshot?: boolean;
      }
    | {
          kind: 'snapshot';
          version: 1;
          actor: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          document: CrdtDocument<TState>;
          compactedThrough: VersionVector;
      }
    | {
          kind: 'members';
          version: 1;
          actor: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          members: LocalFirstMember[];
      };

export type LocalFirstProtocolConfig<TState> = {
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
};

export function parseLocalFirstMessage<TState>(
    input: unknown,
    config: LocalFirstProtocolConfig<TState>,
): LocalFirstMessage<TState> | null {
    if (!isRecord(input)) return null;
    if (input.version !== LOCAL_FIRST_PROTOCOL_VERSION) return null;
    if (input.docId !== config.docId) return null;
    if (!hasExpectedSchema(input, config)) return null;
    if (typeof input.actor !== 'string' || input.actor.length === 0) return null;

    if (input.kind === 'hello') {
        if (input.role !== 'host' && input.role !== 'client') return null;
        if (input.peerId !== undefined && typeof input.peerId !== 'string') return null;
        if (!isVersionVector(input.vector)) return null;
        return input as LocalFirstMessage<TState>;
    }

    if (input.kind === 'updates') {
        const batch = validateBatch(input.batch, config);
        if (!batch) return null;
        return {...input, batch} as LocalFirstMessage<TState>;
    }

    if (input.kind === 'syncRequest') {
        if (!isVersionVector(input.vector)) return null;
        return input as LocalFirstMessage<TState>;
    }

    if (input.kind === 'syncResponse') {
        if (!isVersionVector(input.since)) return null;
        if (input.requiresSnapshot !== undefined && typeof input.requiresSnapshot !== 'boolean') {
            return null;
        }
        if (!Array.isArray(input.batches)) return null;
        const batches: PersistedBatch[] = [];
        for (const value of input.batches) {
            const batch = validateBatch(value, config);
            if (!batch) return null;
            batches.push(batch);
        }
        return {...input, batches} as LocalFirstMessage<TState>;
    }

    if (input.kind === 'snapshot') {
        if (!isVersionVector(input.compactedThrough)) return null;
        const document = validateSnapshot(input.document, config);
        if (!document) return null;
        return {...input, document} as LocalFirstMessage<TState>;
    }

    if (input.kind === 'members') {
        if (!Array.isArray(input.members)) return null;
        const members: LocalFirstMember[] = [];
        for (const member of input.members) {
            if (!isRecord(member)) return null;
            if (typeof member.peerId !== 'string' || member.peerId.length === 0) return null;
            if (typeof member.actor !== 'string' || member.actor.length === 0) return null;
            if (typeof member.docId !== 'string' || member.docId.length === 0) return null;
            if (typeof member.schemaVersion !== 'number') return null;
            if (
                typeof member.schemaFingerprint !== 'string' ||
                member.schemaFingerprint.length === 0
            ) {
                return null;
            }
            if (member.role !== 'host' && member.role !== 'client') return null;
            if (!isVersionVector(member.vector)) return null;
            members.push(member as LocalFirstMember);
        }
        return {...input, members} as LocalFirstMessage<TState>;
    }

    return null;
}

function validateBatch<TState>(
    input: unknown,
    config: LocalFirstProtocolConfig<TState>,
): PersistedBatch | null {
    if (!isRecord(input)) return null;
    if (input.docId !== config.docId) return null;
    if (typeof input.batchId !== 'string' || input.batchId.length === 0) return null;
    if (typeof input.origin !== 'string' || input.origin.length === 0) return null;
    if (!Array.isArray(input.updates) || input.updates.length === 0) return null;
    if (input.minTs !== undefined && !isHlcTimestamp(input.minTs)) return null;
    if (input.maxTs !== undefined && !isHlcTimestamp(input.maxTs)) return null;
    if (!isVersionVector(input.vectorAfter)) return null;
    if (typeof input.receivedAt !== 'string' || input.receivedAt.length === 0) return null;

    const validator = createCrdtUpdateValidator<TState>(config.schema);
    const updates: CrdtUpdate[] = [];
    for (const update of input.updates) {
        const result = validator.validate(update);
        if (!result.success) return null;
        updates.push(result.data);
    }
    return {...input, updates} as PersistedBatch;
}

function isVersionVector(input: unknown): input is VersionVector {
    return isRecord(input) && Object.values(input).every(isHlcTimestamp);
}

function hasExpectedSchema<TState>(
    input: Record<string, unknown>,
    config: LocalFirstProtocolConfig<TState>,
) {
    return (
        input.schemaVersion === config.schemaVersion &&
        input.schemaFingerprint === config.schemaFingerprint
    );
}

function validateSnapshot<TState>(
    input: unknown,
    config: LocalFirstProtocolConfig<TState>,
): CrdtDocument<TState> | null {
    if (!isRecord(input)) return null;
    if (!hasOnlyDocumentKeys(input)) return null;

    const state = config.validateState(input.state);
    if (!state.success) return null;
    if (!validateCrdtMeta(input.meta)) return null;
    if (
        !Array.isArray(input.pending) ||
        !input.pending.every((pending) => validatePendingUpdate(pending, config))
    ) {
        return null;
    }
    if (!validateSchemaContext(input.schema, config)) return null;

    return input as CrdtDocument<TState>;
}

function validatePendingUpdate<TState>(
    input: unknown,
    config: LocalFirstProtocolConfig<TState>,
): input is PendingUpdate {
    if (!isRecord(input)) return false;
    if (
        input.reason !== 'missing-parent' &&
        input.reason !== 'missing-tag-branch' &&
        input.reason !== 'future-incarnation'
    ) {
        return false;
    }
    if (!isHlcTimestamp(input.queuedAt)) return false;
    return createCrdtUpdateValidator<TState>(config.schema).is(input.update);
}

function validateCrdtMeta(input: unknown): input is CrdtMeta {
    if (!isRecord(input)) return false;
    switch (input.kind) {
        case 'primitive':
            return isHlcTimestamp(input.ts) && isJsonPrimitive(input.value);
        case 'object':
            return isHlcTimestamp(input.created) && validateMetaRecord(input.fields);
        case 'record':
            return isHlcTimestamp(input.created) && validateMetaRecord(input.entries);
        case 'array':
            if (!isHlcTimestamp(input.created) || !isRecord(input.items)) return false;
            return Object.values(input.items).every(validateArrayItemMeta);
        case 'tagged':
            return (
                isHlcTimestamp(input.created) &&
                typeof input.tagKey === 'string' &&
                typeof input.tagValue === 'string' &&
                isHlcTimestamp(input.tagTs) &&
                validateMetaRecord(input.fields)
            );
        case 'tombstone':
            return isHlcTimestamp(input.deleted);
        default:
            return false;
    }
}

function validateArrayItemMeta(input: unknown) {
    return (
        isRecord(input) &&
        isRecord(input.order) &&
        typeof input.order.value === 'string' &&
        isHlcTimestamp(input.order.ts) &&
        validateCrdtMeta(input.value)
    );
}

function validateMetaRecord(input: unknown) {
    return isRecord(input) && Object.values(input).every(validateCrdtMeta);
}

function validateSchemaContext<TState>(
    input: unknown,
    config: LocalFirstProtocolConfig<TState>,
) {
    if (!isRecord(input)) return false;
    if (input.tagKey !== config.tagKey) return false;
    return (
        stableStringify(input.root) === stableStringify(config.schema.schemas[0]) &&
        stableStringify(input.components) === stableStringify(config.schema.components)
    );
}

function hasOnlyDocumentKeys(input: Record<string, unknown>) {
    const keys = Object.keys(input).sort();
    return keys.join('\0') === ['meta', 'pending', 'schema', 'state'].join('\0');
}

function isJsonPrimitive(input: unknown) {
    return input === null || ['string', 'number', 'boolean'].includes(typeof input);
}

function isHlcTimestamp(input: unknown): input is string {
    if (typeof input !== 'string' || input.length === 0) return false;
    try {
        const unpacked = hlc.unpack(input);
        return (
            Number.isSafeInteger(unpacked.ts) &&
            unpacked.ts >= 0 &&
            Number.isSafeInteger(unpacked.count) &&
            unpacked.count >= 0 &&
            unpacked.node.length > 0 &&
            hlc.pack(unpacked) === input
        );
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
