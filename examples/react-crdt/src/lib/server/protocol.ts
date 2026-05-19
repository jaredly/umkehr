import {createCrdtUpdateValidator, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {IJsonSchemaCollection} from 'typia';
import type {ServerBranch, ServerBranchEvent, ServerPresenceSession, ServerPresenceUser} from './types';
import {parseSessionActor} from './session';

export const SERVER_PROTOCOL_VERSION = 3;
export const SERVER_PORT = 8787;
export const SERVER_HTTP_URL = `http://localhost:${SERVER_PORT}`;
export const SERVER_WS_URL = `ws://localhost:${SERVER_PORT}/sync`;

export type ClientServerMessage =
    | {
          kind: 'hello';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
      }
    | {
          kind: 'branchSubscribe';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          lastSeenEventIndex: number;
      }
    | {
          kind: 'createBranch';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          sourceBranchId: string;
          forkEventIndex: number;
          branchId?: string;
          name: string;
      }
    | {
          kind: 'renameBranch';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          name: string;
      }
    | {
          kind: 'mergeBranch';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          mergeId: string;
          targetBranchId: string;
          sourceBranchId: string;
          sourceThroughEventIndex: number;
      }
    | {
          kind: 'clientUpdate';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          schemaFingerprint: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      }
    | {
          kind: 'presenceHello';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          color: string;
      };

export type ServerClientMessage =
    | {
          kind: 'hello';
          version: 3;
          docId: string;
          branches: ServerBranch[];
      }
    | {
          kind: 'branchSnapshot';
          version: 3;
          docId: string;
          branches: ServerBranch[];
      }
    | {
          kind: 'branchUpdate';
          version: 3;
          docId: string;
          branch: ServerBranch;
      }
    | {
          kind: 'branchEvents';
          version: 3;
          docId: string;
          branchId: string;
          events: ServerBranchEvent[];
      }
    | {
          kind: 'ack';
          version: 3;
          docId: string;
          branchId?: string;
          hlcTimestamp?: HlcTimestamp;
          mergeId?: string;
          eventIndex?: number;
          branchIdCreated?: string;
      }
    | {
          kind: 'error';
          version: 3;
          message: string;
      }
    | {
          kind: 'presenceSnapshot';
          version: 3;
          docId: string;
          users: ServerPresenceUser[];
      }
    | {
          kind: 'presenceUpdate';
          version: 3;
          docId: string;
          user: ServerPresenceUser;
      }
    | {
          kind: 'presenceLeave';
          version: 3;
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

    if (input.kind === 'hello' || input.kind === 'branchSnapshot') {
        if (input.docId !== docId || !Array.isArray(input.branches)) return null;
        const branches = parseBranches(input.branches);
        if (!branches) return null;
        return {...input, branches} as ServerClientMessage;
    }

    if (input.kind === 'branchUpdate') {
        if (input.docId !== docId) return null;
        const branch = parseBranch(input.branch);
        if (!branch) return null;
        return {...input, branch} as ServerClientMessage;
    }

    if (input.kind === 'ack') {
        if (input.docId !== docId) return null;
        return input as ServerClientMessage;
    }

    if (input.kind === 'branchEvents') {
        if (input.docId !== docId) return null;
        if (typeof input.branchId !== 'string' || input.branchId.length === 0) return null;
        if (!Array.isArray(input.events)) return null;
        const validator = createCrdtUpdateValidator<TState>(schema);
        const events: ServerBranchEvent[] = [];
        for (const event of input.events) {
            const parsed = parseBranchEvent(event, input.branchId, validator);
            if (!parsed) return null;
            events.push(parsed);
        }
        return {...input, events} as ServerClientMessage;
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

function parseBranches(input: unknown[]): ServerBranch[] | null {
    const branches: ServerBranch[] = [];
    for (const item of input) {
        const branch = parseBranch(item);
        if (!branch) return null;
        branches.push(branch);
    }
    return branches;
}

function parseBranch(input: unknown): ServerBranch | null {
    if (!isRecord(input)) return null;
    if (typeof input.docId !== 'string' || input.docId.length === 0) return null;
    if (typeof input.branchId !== 'string' || input.branchId.length === 0) return null;
    if (typeof input.name !== 'string' || input.name.length === 0) return null;
    if (!isSafeInteger(input.tipEventIndex)) return null;
    if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) return null;
    if (typeof input.updatedAt !== 'string' || input.updatedAt.length === 0) return null;
    if (input.sourceBranchId !== undefined && typeof input.sourceBranchId !== 'string') {
        return null;
    }
    if (input.forkEventIndex !== undefined && !isSafeInteger(input.forkEventIndex)) return null;
    return input as ServerBranch;
}

function parseBranchEvent<TState>(
    input: unknown,
    branchId: string,
    validator: ReturnType<typeof createCrdtUpdateValidator<TState>>,
): ServerBranchEvent | null {
    if (!isRecord(input)) return null;
    if (input.branchId !== branchId) return null;
    if (!isSafeInteger(input.eventIndex)) return null;
    if (input.kind === 'update') {
        if (typeof input.docId !== 'string' || input.docId.length === 0) return null;
        if (typeof input.origin !== 'string' || input.origin.length === 0) return null;
        if (typeof input.hlcTimestamp !== 'string' || input.hlcTimestamp.length === 0) {
            return null;
        }
        if (typeof input.receivedAt !== 'string' || input.receivedAt.length === 0) {
            return null;
        }
        const update = validator.validate(input.update);
        if (!update.success) return null;
        return {...input, update: update.data} as ServerBranchEvent;
    }
    if (input.kind === 'merge') {
        if (typeof input.docId !== 'string' || input.docId.length === 0) return null;
        if (typeof input.mergeId !== 'string' || input.mergeId.length === 0) return null;
        if (typeof input.sourceBranchId !== 'string' || input.sourceBranchId.length === 0) {
            return null;
        }
        if (!isSafeInteger(input.sourceThroughEventIndex)) return null;
        if (typeof input.actor !== 'string' || input.actor.length === 0) return null;
        if (typeof input.createdAt !== 'string' || input.createdAt.length === 0) return null;
        return input as ServerBranchEvent;
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
        if (session.branchId !== undefined && typeof session.branchId !== 'string') return null;
        sessions.push({
            actor: session.actor,
            userId: session.userId,
            sessionId: session.sessionId,
            nickname: session.nickname,
            color: session.color,
            online: true,
            lastSeenAt: session.lastSeenAt,
            branchId: session.branchId,
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
