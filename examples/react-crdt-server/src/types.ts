import type {CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';

export type ServerUser = {
    userId: string;
    nickname: string;
};

export type ServerPresenceSession = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    online: true;
    lastSeenAt: string;
    branchId?: string;
    selectionElementId?: string;
};

export type ServerPresenceUser = {
    userId: string;
    nickname: string;
    color: string;
    sessions: ServerPresenceSession[];
};

export type ServerBranch = {
    docId: string;
    branchId: string;
    name: string;
    sourceBranchId?: string;
    forkEventIndex?: number;
    tipEventIndex: number;
    createdAt: string;
    updatedAt: string;
};

export type ServerUpdateEvent = {
    kind: 'update';
    docId: string;
    branchId: string;
    eventIndex: number;
    origin: string;
    hlcTimestamp: HlcTimestamp;
    receivedAt: string;
    update: CrdtUpdate;
};

export type ServerMergeEvent = {
    kind: 'merge';
    mergeId: string;
    docId: string;
    branchId: string;
    eventIndex: number;
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    actor: string;
    createdAt: string;
};

export type ServerBranchEvent = ServerUpdateEvent | ServerMergeEvent;

export type DocumentSummary = {
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    createdAt: string;
    lastAccessedAt: string;
    branchCount: number;
    eventCount: number;
};

export type DocumentMetadata = {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    createdAt: string;
    lastAccessedAt: string;
};

export type SeedUser = ServerUser;

export type SeedDocument = DocumentMetadata & {
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    branches: ServerBranch[];
    events: ServerBranchEvent[];
};

export type SeedDatabasePayload = {
    generatedAt: string;
    users: SeedUser[];
    documents: SeedDocument[];
};

export type ServerMigrationDump = {
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

export type ServerMigrationUpload = {
    docId: string;
    sourceSchemaFingerprintHash: string;
    targetSchemaVersion: number;
    targetSchemaFingerprint: string;
    targetSchemaFingerprintHash: string;
    migrationIds: string[];
    migratedAt: string;
    branches: ServerBranch[];
    events: ServerBranchEvent[];
};

export type ServerMigrationLock = {
    docId: string;
    ownerActor: string;
    ownerUserId: string;
    ownerSessionId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprint: string;
    sourceSchemaFingerprintHash: string;
    targetSchemaVersion: number;
    targetSchemaFingerprint: string;
    targetSchemaFingerprintHash: string;
    updatedAt: string;
};

export type ConnectedClient = {
    actor?: string;
    userId?: string;
    sessionId?: string;
    nickname?: string;
    color?: string;
    docId?: string;
    branchId?: string;
    selectionElementId?: string;
    presenceReady?: boolean;
};
