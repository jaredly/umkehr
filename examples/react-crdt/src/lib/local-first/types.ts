import type {CrdtLocalHistory, CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {ExternalStore} from '../store';

export type LocalFirstRole = 'host' | 'client';
export type VersionVector = Record<string, HlcTimestamp>;

export type ReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};

export type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
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

export type LocalFirstPersistenceState =
    | {kind: 'loading'}
    | {kind: 'ready'; source: 'created' | 'loaded'; savedAt?: string}
    | {kind: 'saving'; source: 'created' | 'loaded'; savedAt?: string}
    | {kind: 'incompatible'; message: string}
    | {kind: 'error'; message: string};

export type LocalFirstStats = {
    vector: VersionVector;
    retainedBatches: number;
    receivedBatches: number;
    pendingUpdates: number;
};

export type LocalFirstConnectionInfo = {
    peerId: string;
    actor?: string;
    role?: LocalFirstRole;
    open: boolean;
    queuedOutgoing: number;
    error?: string;
    lastSyncAt?: string;
};

export type LocalFirstSyncState =
    | {kind: 'offline'; role: LocalFirstRole}
    | {kind: 'initializing'; role: LocalFirstRole}
    | {kind: 'ready'; role: LocalFirstRole; peerId: string}
    | {kind: 'error'; role: LocalFirstRole; message: string};

export type LocalFirstSync<TState> = {
    transport: SyncedTransport;
    identity: ReplicaIdentity;
    stateStore: ExternalStore<LocalFirstSyncState>;
    persistenceStore: ExternalStore<LocalFirstPersistenceState>;
    statsStore: ExternalStore<LocalFirstStats>;
    connectionsStore: ExternalStore<LocalFirstConnectionInfo[]>;
    saveHistory(history: CrdtLocalHistory<TState>): void;
    resetLocalReplica(): Promise<void>;
};
