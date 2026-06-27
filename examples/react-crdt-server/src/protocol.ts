import typia from 'typia';
import {hlc, latestCrdtUpdateTimestamp, type CrdtUpdate, type HlcTimestamp} from 'umkehr/crdt';
import type {
    ServerBranch,
    ServerBranchEvent,
    ServerDocumentImportUpload,
    ServerMigrationUpload,
    ServerPresenceUser,
    SerializedArtifact,
} from './types';

export const SERVER_PROTOCOL_VERSION = 3;
const MAX_EPHEMERAL_BYTES = 16_384;

export type EphemeralMessage<Data> = {
    kind: string;
    id: string;
    actor: string;
    path?: Array<{type: 'key'; key: string | number} | {type: 'tag'; key: string; value: string}>;
    data: Data;
    clear?: boolean;
    expiresAt?: string;
};

export type ClientServerMessage =
    | {
          kind: 'hello';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          appId: string;
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
          appId: string;
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
          appId: string;
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
      }
    | {
          kind: 'presenceEvent';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          event: EphemeralMessage<unknown>;
      }
    | {
          kind: 'serverMigrationRequest';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          appId?: string;
          targetSchemaVersion: number;
          targetSchemaFingerprint: string;
          targetSchemaFingerprintHash: string;
      }
    | ({
          kind: 'serverMigrationUpload';
          version: 3;
          actor: string;
          userId: string;
      } & ServerMigrationUpload)
    | ({
          kind: 'serverDocumentImport';
          version: 3;
          actor: string;
          userId: string;
      } & ServerDocumentImportUpload);

export type ServerMigrationRequiredMessage = {
    kind: 'serverMigrationRequired';
    version: 3;
    docId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprintHash: string;
    targetSchemaVersion: number;
    targetSchemaFingerprintHash: string;
};

export type WaitForMigrationMessage = {
    kind: 'waitForMigration';
    version: 3;
    docId: string;
    ownerActor: string;
    targetSchemaVersion: number;
    targetSchemaFingerprintHash: string;
};

export type ClientMigrationRequiredMessage = {
    kind: 'clientMigrationRequired';
    version: 3;
    docId: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
};

export type MigrationCancelledMessage = {
    kind: 'migrationCancelled';
    version: 3;
    docId: string;
    reason: string;
};

export type SchemaMismatchMessage = {
    kind: 'schemaMismatch';
    version: 3;
    docId: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
};

export type ServerMigrationDumpMessage = {
    kind: 'serverMigrationDump';
    version: 3;
    docId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprint: string;
    sourceSchemaFingerprintHash: string;
    targetSchemaVersion: number;
    targetSchemaFingerprint: string;
    targetSchemaFingerprintHash: string;
    branches: ServerBranch[];
    events: ServerBranchEvent[];
};

export type ServerMigrationCompleteMessage = {
    kind: 'serverMigrationComplete';
    version: 3;
    docId: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
};

export type ServerClientMessage =
    | {
          kind: 'unknownDocument';
          version: 3;
          docId: string;
      }
    | {
          kind: 'hello';
          version: 3;
          docId: string;
          branches: ServerBranch[];
          artifacts?: SerializedArtifact[];
      }
    | {
          kind: 'branchSnapshot';
          version: 3;
          docId: string;
          branches: ServerBranch[];
          artifacts?: SerializedArtifact[];
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
      }
    | {
          kind: 'presenceEvent';
          version: 3;
          docId: string;
          branchId: string;
          event: EphemeralMessage<unknown>;
      }
    | ServerMigrationRequiredMessage
    | WaitForMigrationMessage
    | ClientMigrationRequiredMessage
    | MigrationCancelledMessage
    | SchemaMismatchMessage
    | ServerMigrationDumpMessage
    | ServerMigrationCompleteMessage;

const validateClientMessage = typia.createValidate<ClientServerMessage>();

export function parseClientMessage(input: unknown): ClientServerMessage | null {
    const result = validateClientMessage(input);
    if (!result.success) return null;
    if (result.data.version !== SERVER_PROTOCOL_VERSION) return null;
    if (result.data.userId.length === 0) return null;
    if (result.data.docId.length === 0) return null;
    if ('appId' in result.data && typeof result.data.appId === 'string' && result.data.appId.length === 0) return null;
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
        case 'presenceEvent':
            if (!result.data.branchId) return null;
            if (!isValidEphemeralMessage(result.data.event)) return null;
            if (result.data.event.actor !== result.data.actor) return null;
            if (byteSize(result.data.event) > MAX_EPHEMERAL_BYTES) return null;
            return result.data;
        case 'serverMigrationRequest':
            if (!Number.isSafeInteger(result.data.targetSchemaVersion)) return null;
            if (!result.data.targetSchemaFingerprint.trim()) return null;
            if (!result.data.targetSchemaFingerprintHash.trim()) return null;
            return result.data;
        case 'serverMigrationUpload':
            if (!Number.isSafeInteger(result.data.targetSchemaVersion)) return null;
            if (!result.data.sourceSchemaFingerprintHash.trim()) return null;
            if (!result.data.targetSchemaFingerprint.trim()) return null;
            if (!result.data.targetSchemaFingerprintHash.trim()) return null;
            if (!Array.isArray(result.data.migrationIds)) return null;
            if (!result.data.migrationIds.every((id) => typeof id === 'string' && id.length > 0))
                return null;
            if (!result.data.migratedAt.trim()) return null;
            if (!Array.isArray(result.data.branches) || !Array.isArray(result.data.events))
                return null;
            return result.data;
        case 'serverDocumentImport':
            if (!result.data.appId.trim()) return null;
            if (!Number.isSafeInteger(result.data.schemaVersion)) return null;
            if (!result.data.schemaFingerprint.trim()) return null;
            if (!result.data.schemaFingerprintHash.trim()) return null;
            if (!result.data.importedAt.trim() || !result.data.importedBy.trim()) return null;
            if (!Array.isArray(result.data.branches) || !Array.isArray(result.data.events)) return null;
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
            if (!result.data.mergeId || !result.data.targetBranchId || !result.data.sourceBranchId)
                return null;
            if (!Number.isSafeInteger(result.data.sourceThroughEventIndex)) return null;
            if (result.data.sourceThroughEventIndex < 0) return null;
            return result.data;
        case 'clientUpdate':
            if (!result.data.branchId) return null;
            if (latestCrdtUpdateTimestamp(result.data.update) !== result.data.hlcTimestamp) {
                return null;
            }
            if (hlc.tryUnpack(result.data.hlcTimestamp)?.node !== result.data.actor) return null;
            return result.data;
        case 'hello':
            return result.data;
    }
}

function isValidPresenceColor(color: string) {
    return /^#[0-9a-fA-F]{6}$/.test(color);
}

function isValidEphemeralMessage(input: EphemeralMessage<unknown>) {
    if (typeof input.kind !== 'string' || input.kind.length === 0) return false;
    if (typeof input.id !== 'string' || input.id.length === 0) return false;
    if (typeof input.actor !== 'string' || input.actor.length === 0) return false;
    if (!('data' in input)) return false;
    if (input.path !== undefined && !isPath(input.path)) return false;
    if (input.clear !== undefined && typeof input.clear !== 'boolean') return false;
    if (input.expiresAt !== undefined && typeof input.expiresAt !== 'string') return false;
    return true;
}

function isPath(input: unknown): input is EphemeralMessage<unknown>['path'] {
    if (!Array.isArray(input)) return false;
    return input.every((segment) => {
        if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) return false;
        if (!('type' in segment)) return false;
        if (segment.type === 'key') {
            return (
                'key' in segment &&
                (typeof segment.key === 'string' || typeof segment.key === 'number')
            );
        }
        if (segment.type === 'tag') {
            return (
                'key' in segment &&
                'value' in segment &&
                typeof segment.key === 'string' &&
                typeof segment.value === 'string'
            );
        }
        return false;
    });
}

function byteSize(value: unknown) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
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
