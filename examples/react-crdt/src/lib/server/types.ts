import type {CrdtLocalHistory, CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';
import type {StatusStore, SyncedTransport} from 'umkehr/react-crdt';
import type {ExternalStore} from '../store';

export type ServerUser = {
    userId: string;
    nickname: string;
};

export type ServerDocumentSummary = {
    docId: string;
    appId: string;
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

export type PersistedServerUser = ServerUser & {
    storageVersion: 2;
    createdAt: string;
    updatedAt: string;
};

export type ServerSessionIdentity = {
    user: ServerUser;
    sessionId: string;
    actor: string;
    createdAt: string;
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
    pending?: boolean;
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
    recorded?: boolean;
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
    recorded?: boolean;
};

export type ServerBranchEvent = ServerUpdateEvent | ServerMergeEvent;

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

export type ServerLastEditStatusData = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    timestamp: HlcTimestamp;
    receivedAt: string;
};

export type ServerSelectionStatusData = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    elementId: string;
    receivedAt: string;
};

export type PersistedServerBranch<TState> = {
    branchId: string;
    sourceBranchId?: string;
    forkEventIndex?: number;
    history: CrdtLocalHistory<TState>;
    lastSeenEventIndex: number;
    undoCheckpointEventIndex: number;
    events: ServerBranchEvent[];
    mirrored: boolean;
};

export type PersistedServerReplica<TState> = {
    docId: string;
    appId: string;
    title?: string;
    storageVersion: 4;
    protocolVersion: 3;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    activeBranchId: string;
    branches: Record<string, PersistedServerBranch<TState>>;
    branchList: ServerBranch[];
    updatedAt: string;
};

export type ServerSyncState =
    | {kind: 'offline'; reason: 'manual' | 'starting'}
    | {kind: 'connecting'}
    | {kind: 'connected'}
    | {
          kind: 'migration-required';
          message: string;
          sourceSchemaVersion: number;
          sourceSchemaFingerprintHash: string;
          targetSchemaVersion: number;
          targetSchemaFingerprintHash: string;
      }
    | {
          kind: 'migration-running';
          message: string;
          ownerActor: string;
          targetSchemaVersion: number;
          targetSchemaFingerprintHash: string;
      }
    | {kind: 'migration-cancelled'; message: string}
    | {
          kind: 'client-migration-required';
          message: string;
          schemaVersion: number;
          schemaFingerprintHash: string;
      }
    | {
          kind: 'schema-mismatch';
          message: string;
          schemaVersion: number;
          schemaFingerprintHash: string;
      }
    | {kind: 'error'; message: string; duplicateSession?: boolean};

export type ServerSyncStats = {
    lastSeenEventIndex: number;
    pendingUploads: number;
    totalEvents: number;
    receivedEvents: number;
    lastSyncAt?: string;
};

export type ServerMergePreview<TState> = {
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    targetBranchId: string;
    preview: CrdtLocalHistory<TState>;
    changedPaths: import('umkehr/crdt').CrdtPathSegment[][];
    revertUpdates: CrdtUpdate[];
    impact: import('./materialize').MergeImpact;
    revertedPathKeys: Set<string>;
};

export type ServerSync<TState> = {
    transport: SyncedTransport & {receive(update: CrdtUpdate): void};
    identity: ServerSessionIdentity;
    stateStore: ExternalStore<ServerSyncState>;
    statsStore: ExternalStore<ServerSyncStats>;
    branchesStore: ExternalStore<ServerBranch[]>;
    eventsStore: ExternalStore<ServerBranchEvent[]>;
    activeBranchStore: ExternalStore<string>;
    presenceStore: ExternalStore<ServerPresenceUser[]>;
    statusStore: StatusStore;
    manualOfflineStore: ExternalStore<boolean>;
    setManualOffline(offline: boolean): void;
    requestSync(): void;
    requestServerMigration(): void;
    saveHistory(history: CrdtLocalHistory<TState>): void;
    switchBranch(branchId: string): void;
    createBranch(name: string, forkEventIndex?: number): void;
    renameBranch(branchId: string, name: string): void;
    mergeBranch(sourceBranchId: string, sourceThroughEventIndex?: number, revertedPathKeys?: Set<string>): void;
    buildEventPreview(throughEventIndex: number): CrdtLocalHistory<TState>;
    buildMergePreview(sourceBranchId: string, sourceThroughEventIndex?: number, revertedPathKeys?: Set<string>): ServerMergePreview<TState> | null;
    setPresenceSelection(elementId: string | null): void;
    exportReplica(): PersistedServerReplica<TState>;
    replaceReplica(replica: PersistedServerReplica<TState>): void;
};
