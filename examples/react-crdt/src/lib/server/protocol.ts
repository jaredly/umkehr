import {
    createCrdtUpdateValidator,
    type CrdtUpdate,
    type HlcTimestamp,
} from 'umkehr/crdt';
import type {IJsonSchemaCollection} from 'typia';

export const SERVER_PROTOCOL_VERSION = 1;
export const SERVER_PORT = 8787;
export const SERVER_WS_URL = `ws://localhost:${SERVER_PORT}/sync`;

export type ServerLogEntry = {
    messageIndex: number;
    docId: string;
    origin: string;
    hlcTimestamp: HlcTimestamp;
    receivedAt: string;
    update: CrdtUpdate;
};

export type ClientServerMessage =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      }
    | {
          kind: 'clientUpdate';
          version: 1;
          actor: string;
          docId: string;
          schemaFingerprint: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      }
    | {
          kind: 'syncRequest';
          version: 1;
          actor: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      };

export type ServerClientMessage =
    | {
          kind: 'hello';
          version: 1;
          docId: string;
          lastSeenMessageIndex: number;
      }
    | {
          kind: 'serverUpdates';
          version: 1;
          docId: string;
          entries: ServerLogEntry[];
      }
    | {
          kind: 'ack';
          version: 1;
          docId: string;
          hlcTimestamp: HlcTimestamp;
      }
    | {
          kind: 'error';
          version: 1;
          message: string;
      };

export function parseServerMessage<TState>(
    input: unknown,
    {
        docId,
        schema,
    }: {
        docId: string;
        schema: IJsonSchemaCollection<'3.1', [TState]>;
    },
): ServerClientMessage | null {
    if (!isRecord(input)) return null;
    if (input.version !== SERVER_PROTOCOL_VERSION) return null;

    if (input.kind === 'hello') {
        if (input.docId !== docId) return null;
        if (!isSafeInteger(input.lastSeenMessageIndex)) return null;
        return input as ServerClientMessage;
    }

    if (input.kind === 'ack') {
        if (input.docId !== docId) return null;
        if (typeof input.hlcTimestamp !== 'string' || input.hlcTimestamp.length === 0) {
            return null;
        }
        return input as ServerClientMessage;
    }

    if (input.kind === 'serverUpdates') {
        if (input.docId !== docId) return null;
        if (!Array.isArray(input.entries)) return null;
        const validator = createCrdtUpdateValidator<TState>(schema);
        const entries: ServerLogEntry[] = [];
        for (const entry of input.entries) {
            if (!isRecord(entry)) return null;
            if (!isSafeInteger(entry.messageIndex)) return null;
            if (entry.docId !== docId) return null;
            if (typeof entry.origin !== 'string' || entry.origin.length === 0) return null;
            if (
                typeof entry.hlcTimestamp !== 'string' ||
                entry.hlcTimestamp.length === 0
            ) {
                return null;
            }
            if (typeof entry.receivedAt !== 'string' || entry.receivedAt.length === 0) {
                return null;
            }
            const update = validator.validate(entry.update);
            if (!update.success) return null;
            entries.push({...entry, update: update.data} as ServerLogEntry);
        }
        return {...input, entries} as ServerClientMessage;
    }

    if (input.kind === 'error') {
        if (typeof input.message !== 'string') return null;
        return input as ServerClientMessage;
    }

    return null;
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
