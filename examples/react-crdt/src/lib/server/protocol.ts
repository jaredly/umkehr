import {createCrdtUpdateValidator, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {IJsonSchemaCollection} from 'typia';
import type {ServerPresenceSession, ServerPresenceUser} from './types';
import {parseSessionActor} from './session';

export const SERVER_PROTOCOL_VERSION = 2;
export const SERVER_PORT = 8787;
export const SERVER_HTTP_URL = `http://localhost:${SERVER_PORT}`;
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
      }
    | {
          kind: 'presenceHello';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          color: string;
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
      }
    | {
          kind: 'presenceSnapshot';
          version: 2;
          docId: string;
          users: ServerPresenceUser[];
      }
    | {
          kind: 'presenceUpdate';
          version: 2;
          docId: string;
          user: ServerPresenceUser;
      }
    | {
          kind: 'presenceLeave';
          version: 2;
          docId: string;
          actor: string;
          userId: string;
          sessionId: string;
          at: string;
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
            if (typeof entry.hlcTimestamp !== 'string' || entry.hlcTimestamp.length === 0) {
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

    if (input.kind === 'presenceSnapshot') {
        if (input.docId !== docId) return null;
        if (!Array.isArray(input.users)) return null;
        const users = parsePresenceUsers(input.users);
        if (!users) return null;
        return {...input, users} as ServerClientMessage;
    }

    if (input.kind === 'presenceUpdate') {
        if (input.docId !== docId) return null;
        const user = parsePresenceUser(input.user);
        if (!user) return null;
        return {...input, user} as ServerClientMessage;
    }

    if (input.kind === 'presenceLeave') {
        if (input.docId !== docId) return null;
        if (typeof input.actor !== 'string' || input.actor.length === 0) return null;
        if (typeof input.userId !== 'string' || input.userId.length === 0) return null;
        if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) return null;
        if (typeof input.at !== 'string' || input.at.length === 0) return null;
        const actor = parseSessionActor(input.actor);
        if (!actor || actor.userId !== input.userId || actor.sessionId !== input.sessionId) {
            return null;
        }
        return input as ServerClientMessage;
    }

    return null;
}

function parsePresenceUsers(input: unknown[]): ServerPresenceUser[] | null {
    const users: ServerPresenceUser[] = [];
    for (const user of input) {
        const parsed = parsePresenceUser(user);
        if (!parsed) return null;
        users.push(parsed);
    }
    return users;
}

function parsePresenceUser(input: unknown): ServerPresenceUser | null {
    if (!isRecord(input)) return null;
    if (typeof input.userId !== 'string' || input.userId.length === 0) return null;
    if (typeof input.nickname !== 'string' || input.nickname.length === 0) return null;
    if (typeof input.color !== 'string' || input.color.length === 0) return null;
    if (!Array.isArray(input.sessions)) return null;
    const sessions: ServerPresenceSession[] = [];
    for (const session of input.sessions) {
        if (!isRecord(session)) return null;
        if (session.online !== true) return null;
        if (typeof session.actor !== 'string' || session.actor.length === 0) return null;
        if (typeof session.userId !== 'string' || session.userId !== input.userId) return null;
        if (typeof session.sessionId !== 'string' || session.sessionId.length === 0) return null;
        const actor = parseSessionActor(session.actor);
        if (!actor || actor.userId !== session.userId || actor.sessionId !== session.sessionId) {
            return null;
        }
        if (typeof session.nickname !== 'string' || session.nickname.length === 0) return null;
        if (typeof session.color !== 'string' || session.color.length === 0) return null;
        if (typeof session.lastSeenAt !== 'string' || session.lastSeenAt.length === 0) {
            return null;
        }
        sessions.push({
            actor: session.actor,
            userId: session.userId,
            sessionId: session.sessionId,
            nickname: session.nickname,
            color: session.color,
            online: true,
            lastSeenAt: session.lastSeenAt,
        });
    }
    return {
        userId: input.userId,
        nickname: input.nickname,
        color: input.color,
        sessions,
    };
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
