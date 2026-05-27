import type {CrdtLocalHistory, CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {ExternalStore} from '../store';

export type LocalFirstRole = 'host' | 'client';
export type VersionVector = Record<string, HlcTimestamp>;

export type ReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};

export type LocalFirstSchemaMetadata = {
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
};

export type DocumentLineage = {
    sourceDocId: string;
    sourceSchemaVersion: number;
    sourceSchemaFingerprint: string;
    migratedAt: string;
    migrationId: string;
};

export type PersistedReplica<TState> = {
    docId: string;
    title?: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    lineage?: DocumentLineage;
    updatedAt: string;
};

export type PersistedBatch = {
    docId: string;
    batchId: string;
    origin: string;
    updates: CrdtUpdate[];
    minTs?: HlcTimestamp;
    maxTs?: HlcTimestamp;
    vectorAfter: VersionVector;
    receivedAt: string;
};

export type ReceivedBatch = {
    docId: string;
    origin: string;
    batchId: string;
    receivedAt: string;
};

export type LocalFirstMember = {
    peerId: string;
    actor: string;
    role: LocalFirstRole;
    vector: VersionVector;
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
};

export type LocalFirstPersistenceState =
    | {kind: 'loading'}
    | {kind: 'ready'; source: 'created' | 'loaded' | 'migrated'; savedAt?: string}
    | {kind: 'saving'; source: 'created' | 'loaded' | 'migrated'; savedAt?: string}
    | {kind: 'incompatible'; message: string}
    | {kind: 'error'; message: string};

export type LocalFirstStats = {
    vector: VersionVector;
    compactedThrough?: VersionVector;
    retainedBatches: number;
    receivedBatches: number;
    pendingUpdates: number;
    schemaVersion: number;
    lineage?: DocumentLineage;
    mesh: {
        discoveredMembers: number;
        directConnections: number;
        connectedPeers: number;
        lastMemberUpdateAt?: string;
        compactionRisks: LocalFirstCompactionRisk[];
    };
    snapshotStatus?: string;
    pendingSnapshot?: {
        actor: string;
        compactedActors: number;
    };
    replayPreview?: {
        actor: string;
        localBatches: number;
        skippedUpdates: number;
        state: unknown;
    };
    compactionStatus?: string;
};

export type LocalFirstCompactionRisk = {
    peerId: string;
    actor?: string;
    reason: 'behind' | 'unknown';
};

export type LocalFirstConnectionInfo = {
    peerId: string;
    actor?: string;
    role?: LocalFirstRole;
    vector?: VersionVector;
    docId?: string;
    schemaVersion?: number;
    schemaFingerprint?: string;
    schemaFingerprintHash?: string;
    open: boolean;
    queuedOutgoing: number;
    error?: string;
    lastSyncAt?: string;
};

export type LocalFirstSyncState =
    | {kind: 'offline'; role: LocalFirstRole}
    | {kind: 'initializing'; role: LocalFirstRole}
    | {kind: 'ready'; role: LocalFirstRole; peerId: string}
    | {
          kind: 'incompatible';
          role: LocalFirstRole;
          peerId?: string;
          message: string;
      }
    | {
          kind: 'migration-required';
          role: LocalFirstRole;
          peerId?: string;
          message: string;
      }
    | {
          kind: 'needs-rebase-or-discard';
          role: LocalFirstRole;
          peerId?: string;
          actor: string;
          message: string;
      }
    | {kind: 'error'; role: LocalFirstRole; message: string};

export type LocalFirstSync<TState> = {
    transport: SyncedTransport;
    identity: ReplicaIdentity;
    stateStore: ExternalStore<LocalFirstSyncState>;
    persistenceStore: ExternalStore<LocalFirstPersistenceState>;
    statsStore: ExternalStore<LocalFirstStats>;
    connectionsStore: ExternalStore<LocalFirstConnectionInfo[]>;
    connect(peerId: string): void;
    disconnect(peerId: string): void;
    setRole(role: LocalFirstRole): void;
    requestSync(peerId?: string): void;
    compactRetainedLog(): Promise<void>;
    discardLocalAndAcceptSnapshot(): Promise<void>;
    previewLocalBatchesOnSnapshot(): Promise<void>;
    replayLocalBatchesOnSnapshot(): Promise<void>;
    exportLocalState(): Promise<string>;
    importLocalState(json: string): Promise<void>;
    saveHistory(history: CrdtLocalHistory<TState>): void;
    resetLocalReplica(): Promise<void>;
};
