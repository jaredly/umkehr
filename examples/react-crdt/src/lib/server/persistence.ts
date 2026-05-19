import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {PersistedServerReplica, PersistedServerUser, ServerBranchEvent, ServerUser} from './types';

const DB_NAME = 'umkehr-react-crdt-server-sync';
const DB_VERSION = 3;
const IDENTITY_KEY = 'default';

interface ServerSyncDb extends DBSchema {
    identity: {
        key: string;
        value: PersistedServerUser;
    };
    replicas: {
        key: string;
        value: PersistedServerReplica<unknown>;
    };
}

export async function loadServerUser(): Promise<PersistedServerUser | null> {
    const db = await openServerSyncDb();
    return (await db.get('identity', IDENTITY_KEY)) ?? null;
}

export async function saveServerUser(user: ServerUser): Promise<PersistedServerUser> {
    const db = await openServerSyncDb();
    const existing = await db.get('identity', IDENTITY_KEY);
    const now = new Date().toISOString();
    const persisted: PersistedServerUser = {
        storageVersion: 2,
        userId: user.userId,
        nickname: user.nickname,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    await db.put('identity', persisted, IDENTITY_KEY);
    return persisted;
}

export async function clearServerUser() {
    const db = await openServerSyncDb();
    await db.delete('identity', IDENTITY_KEY);
}

export async function loadServerReplica<TState>(
    docId: string,
): Promise<PersistedServerReplica<TState> | null> {
    const db = await openServerSyncDb();
    return (
        ((await db.get('replicas', docId)) as PersistedServerReplica<TState> | undefined) ?? null
    );
}

export async function saveServerReplica<TState>(replica: PersistedServerReplica<TState>) {
    const db = await openServerSyncDb();
    await db.put('replicas', replica as PersistedServerReplica<unknown>, replica.docId);
}

export function sortServerEvents(events: ServerBranchEvent[]) {
    return [...events].sort((a, b) => {
        const byBranch = a.branchId.localeCompare(b.branchId);
        if (byBranch !== 0) return byBranch;
        return a.eventIndex - b.eventIndex;
    });
}

let dbPromise: Promise<IDBPDatabase<ServerSyncDb>> | null = null;

function openServerSyncDb() {
    dbPromise ??= openDB<ServerSyncDb>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, _newVersion, tx) {
            if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
            if (!db.objectStoreNames.contains('replicas')) db.createObjectStore('replicas');
            if (oldVersion < 2) {
                tx.objectStore('identity').delete(IDENTITY_KEY);
            }
            if (oldVersion < 3) {
                tx.objectStore('replicas').clear();
            }
        },
    });
    return dbPromise;
}
