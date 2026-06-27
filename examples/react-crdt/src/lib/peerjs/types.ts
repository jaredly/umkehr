import type {CrdtDocument} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {SerializedArtifact} from '../artifacts';
import type {ExternalStore} from '../store';

export type PeerRole = 'host' | 'client';

export type PeerConnectionInfo = {
    peerId: string;
    actor?: string;
    open: boolean;
    role?: PeerRole;
    queuedOutgoing: number;
    error?: string;
};

export type PeerSyncState =
    | {kind: 'initializing'; role: PeerRole}
    | {kind: 'ready'; role: PeerRole; peerId: string}
    | {kind: 'waiting-for-snapshot'; role: 'client'; peerId: string; hostPeerId: string}
    | {kind: 'error'; role: PeerRole; message: string};

export type PeerJsSync<TState> = {
    transport: SyncedTransport;
    stateStore: ExternalStore<PeerSyncState>;
    connectionsStore: ExternalStore<PeerConnectionInfo[]>;
    snapshotStore: ExternalStore<CrdtDocument<TState> | null>;
    connect(peerId: string): void;
    disconnect(peerId: string): void;
    flushQueued(peerId?: string): void;
    setSnapshotDocument(document: CrdtDocument<TState>): void;
    broadcastSnapshot(document: CrdtDocument<TState>, artifacts?: SerializedArtifact[]): void;
    destroy(): void;
};
