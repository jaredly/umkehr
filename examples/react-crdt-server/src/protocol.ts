import typia from 'typia';
import {latestCrdtUpdateTimestamp, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {ServerLogEntry} from './types';

export const SERVER_PROTOCOL_VERSION = 1;

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

const validateClientMessage = typia.createValidate<ClientServerMessage>();

export function parseClientMessage(input: unknown): ClientServerMessage | null {
    const result = validateClientMessage(input);
    if (!result.success) return null;
    if (result.data.version !== SERVER_PROTOCOL_VERSION) return null;
    if (result.data.kind === 'clientUpdate') {
        if (latestCrdtUpdateTimestamp(result.data.update) !== result.data.hlcTimestamp) {
            return null;
        }
    }
    return result.data;
}

export function encodeServerMessage(message: ServerClientMessage) {
    return JSON.stringify(message);
}
