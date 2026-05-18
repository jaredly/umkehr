import typia from 'typia';
import {hlc, latestCrdtUpdateTimestamp, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {ServerLogEntry} from './types';

export const SERVER_PROTOCOL_VERSION = 2;

export type ClientServerMessage =
    | {
          kind: 'hello';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      }
    | {
          kind: 'clientUpdate';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      }
    | {
          kind: 'syncRequest';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      };

export type ServerClientMessage =
    | {
          kind: 'hello';
          version: 2;
          docId: string;
          lastSeenMessageIndex: number;
      }
    | {
          kind: 'serverUpdates';
          version: 2;
          docId: string;
          entries: ServerLogEntry[];
      }
    | {
          kind: 'ack';
          version: 2;
          docId: string;
          hlcTimestamp: HlcTimestamp;
      }
    | {
          kind: 'error';
          version: 2;
          message: string;
      };

const validateClientMessage = typia.createValidate<ClientServerMessage>();

export function parseClientMessage(input: unknown): ClientServerMessage | null {
    const result = validateClientMessage(input);
    if (!result.success) return null;
    if (result.data.version !== SERVER_PROTOCOL_VERSION) return null;
    if (result.data.userId.length === 0) return null;
    const actor = parseSessionActor(result.data.actor);
    if (!actor || actor.userId !== result.data.userId) return null;
    if (result.data.kind === 'clientUpdate') {
        if (latestCrdtUpdateTimestamp(result.data.update) !== result.data.hlcTimestamp) {
            return null;
        }
        if (hlc.unpack(result.data.hlcTimestamp).node !== result.data.actor) return null;
    }
    return result.data;
}

export function actorForSession(userId: string, sessionId: string) {
    return `${userId}:${sessionId}`;
}

export function parseSessionActor(actor: string): {userId: string; sessionId: string} | null {
    const parts = actor.split(':');
    if (parts.length !== 2) return null;
    const [userId, sessionId] = parts;
    if (!userId || !sessionId) return null;
    return {userId, sessionId};
}

export function encodeServerMessage(message: ServerClientMessage) {
    return JSON.stringify(message);
}
