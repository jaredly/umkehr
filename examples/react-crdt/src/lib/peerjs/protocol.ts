import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    createCrdtUpdateValidator,
    type CrdtDocument,
    type CrdtMeta,
    type CrdtUpdate,
    type PendingUpdate,
} from 'umkehr/crdt';
import type {PeerRole} from './types';

export const PEER_PROTOCOL_VERSION = 1;

export type PeerProtocolConfig<TState> = {
    docId: string;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
};

export type PeerMessage<TState> =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          docId: string;
          role: PeerRole;
      }
    | {
          kind: 'snapshot';
          version: 1;
          actor: string;
          docId: string;
          document: CrdtDocument<TState>;
      }
    | {
          kind: 'updates';
          version: 1;
          actor: string;
          docId: string;
          batchId: string;
          updates: CrdtUpdate[];
      };

export function parsePeerMessage<TState>(
    input: unknown,
    config: PeerProtocolConfig<TState>,
): PeerMessage<TState> | null {
    if (!isRecord(input)) return null;
    if (input.version !== PEER_PROTOCOL_VERSION) return null;
    if (input.docId !== config.docId) return null;
    if (typeof input.actor !== 'string' || input.actor.length === 0) return null;

    if (input.kind === 'hello') {
        if (input.role !== 'host' && input.role !== 'client') return null;
        return input as PeerMessage<TState>;
    }

    if (input.kind === 'snapshot') {
        const document = validatePeerSnapshot(input.document, config);
        if (!document) return null;
        return {...input, document} as PeerMessage<TState>;
    }

    if (input.kind === 'updates') {
        if (typeof input.batchId !== 'string' || input.batchId.length === 0) return null;
        if (!Array.isArray(input.updates) || input.updates.length === 0) return null;
        const updateValidator = createCrdtUpdateValidator<TState>(config.schema);
        const updates: CrdtUpdate[] = [];
        for (const update of input.updates) {
            const result = updateValidator.validate(update);
            if (!result.success) return null;
            updates.push(result.data);
        }
        return {...input, updates} as PeerMessage<TState>;
    }

    return null;
}

export function validatePeerSnapshot<TState>(
    input: unknown,
    config: PeerProtocolConfig<TState>,
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
    config: PeerProtocolConfig<TState>,
): input is PendingUpdate {
    if (!isRecord(input)) return false;
    if (
        input.reason !== 'missing-parent' &&
        input.reason !== 'missing-tag-branch' &&
        input.reason !== 'future-incarnation'
    ) {
        return false;
    }
    if (typeof input.queuedAt !== 'string' || input.queuedAt.length === 0) return false;
    const updateValidator = createCrdtUpdateValidator<TState>(config.schema);
    return updateValidator.is(input.update);
}

function validateCrdtMeta(input: unknown): input is CrdtMeta {
    if (!isRecord(input)) return false;
    switch (input.kind) {
        case 'primitive':
            return typeof input.ts === 'string' && isJsonPrimitive(input.value);
        case 'object':
            return typeof input.created === 'string' && validateMetaRecord(input.fields);
        case 'record':
            return typeof input.created === 'string' && validateMetaRecord(input.entries);
        case 'array':
            if (typeof input.created !== 'string' || !isRecord(input.items)) return false;
            return Object.values(input.items).every(validateArrayItemMeta);
        case 'tagged':
            return (
                typeof input.created === 'string' &&
                typeof input.tagKey === 'string' &&
                typeof input.tagValue === 'string' &&
                typeof input.tagTs === 'string' &&
                validateMetaRecord(input.fields)
            );
        case 'tombstone':
            return typeof input.deleted === 'string';
        default:
            return false;
    }
}

function validateArrayItemMeta(input: unknown) {
    return (
        isRecord(input) &&
        isRecord(input.order) &&
        typeof input.order.value === 'string' &&
        typeof input.order.ts === 'string' &&
        validateCrdtMeta(input.value)
    );
}

function validateMetaRecord(input: unknown) {
    return isRecord(input) && Object.values(input).every(validateCrdtMeta);
}

function validateSchemaContext<TState>(input: unknown, config: PeerProtocolConfig<TState>) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}
