import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {PersistedServerReplica, ServerChange, ServerReplicaIdentity} from './types';

const DB_NAME = 'umkehr-react-crdt-server-sync';
const DB_VERSION = 1;
const IDENTITY_KEY = 'default';

interface ServerSyncDb extends DBSchema {
    identity: {
        key: string;
        value: ServerReplicaIdentity;
    };
    replicas: {
        key: string;
        value: PersistedServerReplica<unknown>;
    };
}

export async function loadOrCreateServerIdentity(): Promise<ServerReplicaIdentity> {
    const db = await openServerSyncDb();
    const existing = await db.get('identity', IDENTITY_KEY);
    if (existing) return existing;

    const identity: ServerReplicaIdentity = {
        replicaId: `client-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
    };
    await db.put('identity', identity, IDENTITY_KEY);
    return identity;
}

export async function loadServerReplica<TState>(
    docId: string,
): Promise<PersistedServerReplica<TState> | null> {
    const db = await openServerSyncDb();
    return (
        ((await db.get('replicas', docId)) as PersistedServerReplica<TState> | undefined) ??
        null
    );
}

export async function saveServerReplica<TState>(replica: PersistedServerReplica<TState>) {
    const db = await openServerSyncDb();
    await db.put('replicas', replica as PersistedServerReplica<unknown>, replica.docId);
}

export function sortServerChanges(changes: ServerChange[]) {
    return [...changes].sort((a, b) => {
        const byTimestamp = a.timestamp.localeCompare(b.timestamp);
        if (byTimestamp !== 0) return byTimestamp;
        return a.origin.localeCompare(b.origin);
    });
}

let dbPromise: Promise<IDBPDatabase<ServerSyncDb>> | null = null;

function openServerSyncDb() {
    dbPromise ??= openDB<ServerSyncDb>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
            if (!db.objectStoreNames.contains('replicas')) db.createObjectStore('replicas');
        },
    });
    return dbPromise;
}
