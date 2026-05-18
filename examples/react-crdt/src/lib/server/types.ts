import type {CrdtLocalHistory, CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {ExternalStore} from '../store';

export type ServerReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};

export type ServerChangeSource = 'local' | 'remote';

export type ServerChange = {
    docId: string;
    timestamp: HlcTimestamp;
    origin: string;
    source: ServerChangeSource;
    update: CrdtUpdate;
    recorded: boolean;
    messageIndex?: number;
    receivedAt: string;
};

export type PersistedServerReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    lastSeenMessageIndex: number;
    changes: ServerChange[];
    updatedAt: string;
};

export type ServerSyncState =
    | {kind: 'offline'; reason: 'manual' | 'starting'}
    | {kind: 'connecting'}
    | {kind: 'connected'}
    | {kind: 'error'; message: string};

export type ServerSyncStats = {
    lastSeenMessageIndex: number;
    pendingUploads: number;
    totalChanges: number;
    receivedChanges: number;
    lastSyncAt?: string;
};

export type ServerSync<TState> = {
    transport: SyncedTransport & {receive(update: CrdtUpdate): void};
    identity: ServerReplicaIdentity;
    stateStore: ExternalStore<ServerSyncState>;
    statsStore: ExternalStore<ServerSyncStats>;
    changesStore: ExternalStore<ServerChange[]>;
    manualOfflineStore: ExternalStore<boolean>;
    setManualOffline(offline: boolean): void;
    requestSync(): void;
    saveHistory(history: CrdtLocalHistory<TState>): void;
};
