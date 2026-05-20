import typia from 'typia';
import {hlc, latestCrdtUpdateTimestamp, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {ServerBranch, ServerBranchEvent, ServerPresenceUser} from './types';

export const SERVER_PROTOCOL_VERSION = 3;

export type ClientServerMessage =
    | {
          kind: 'hello';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          schemaVersion: number;
          schemaFingerprint: string;
          schemaFingerprintHash: string;
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
          schemaVersion: number;
          schemaFingerprint: string;
          schemaFingerprintHash: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      }
    | {
          kind: 'presenceHello';
          version: 3;
          actor: string;
          userId: string;
          nickname: string;
          docId: string;
          branchId: string;
          color: string;
      }
    | {
          kind: 'presenceSelection';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          elementId: string | null;
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
      }
    | {
          kind: 'presenceSelection';
          version: 3;
          docId: string;
          actor: string;
          userId: string;
          sessionId: string;
          branchId: string;
          elementId: string | null;
          at: string;
      };

const validateClientMessage = typia.createValidate<ClientServerMessage>();

export function parseClientMessage(input: unknown): ClientServerMessage | null {
    const result = validateClientMessage(input);
    if (!result.success) return null;
    if (result.data.version !== SERVER_PROTOCOL_VERSION) return null;
    if (result.data.userId.length === 0) return null;
    if (result.data.docId.length === 0) return null;
    const actor = parseSessionActor(result.data.actor);
    if (!actor || actor.userId !== result.data.userId) return null;

    switch (result.data.kind) {
        case 'presenceHello':
            if (!result.data.branchId) return null;
            if (!result.data.nickname.trim()) return null;
            if (!isValidPresenceColor(result.data.color)) return null;
            return result.data;
        case 'presenceSelection':
            if (!result.data.branchId) return null;
            if (result.data.elementId !== null && !result.data.elementId.trim()) return null;
            return result.data;
        case 'branchSubscribe':
            if (!result.data.branchId) return null;
            if (!Number.isSafeInteger(result.data.lastSeenEventIndex)) return null;
            if (result.data.lastSeenEventIndex < 0) return null;
            return result.data;
        case 'createBranch':
            if (!result.data.sourceBranchId || !result.data.name.trim()) return null;
            if (!Number.isSafeInteger(result.data.forkEventIndex)) return null;
            if (result.data.forkEventIndex < 0) return null;
            return result.data;
        case 'renameBranch':
            if (!result.data.branchId || !result.data.name.trim()) return null;
            return result.data;
        case 'mergeBranch':
            if (!result.data.mergeId || !result.data.targetBranchId || !result.data.sourceBranchId) return null;
            if (!Number.isSafeInteger(result.data.sourceThroughEventIndex)) return null;
            if (result.data.sourceThroughEventIndex < 0) return null;
            return result.data;
        case 'clientUpdate':
            if (!result.data.branchId) return null;
            if (latestCrdtUpdateTimestamp(result.data.update) !== result.data.hlcTimestamp) {
                return null;
            }
            if (hlc.unpack(result.data.hlcTimestamp).node !== result.data.actor) return null;
            return result.data;
        case 'hello':
            return result.data;
    }
}

function isValidPresenceColor(color: string) {
    return /^#[0-9a-fA-F]{6}$/.test(color);
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
