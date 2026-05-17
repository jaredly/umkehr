import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {
    PersistedBatch,
    PersistedReplica,
    ReceivedBatch,
    ReplicaIdentity,
} from './types';
import {batchKey} from './recentBatchCache';

const DB_NAME = 'umkehr-react-crdt-local-first';
const DB_VERSION = 1;
const IDENTITY_KEY = 'default';

interface LocalFirstDb extends DBSchema {
    identity: {
        key: string;
        value: ReplicaIdentity;
    };
    replicas: {
        key: string;
        value: PersistedReplica<unknown>;
    };
    batches: {
        key: string;
        value: PersistedBatch;
        indexes: {docId: string};
    };
    receivedBatches: {
        key: string;
        value: ReceivedBatch;
        indexes: {docId: string};
    };
}

export async function loadOrCreateIdentity(): Promise<ReplicaIdentity> {
    const db = await openLocalFirstDb();
    const existing = await db.get('identity', IDENTITY_KEY);
    if (existing) return existing;

    const identity: ReplicaIdentity = {
        replicaId: `replica-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
    };
    await db.put('identity', identity, IDENTITY_KEY);
    return identity;
}

export async function loadReplica<TState>(
    docId: string,
): Promise<PersistedReplica<TState> | null> {
    const db = await openLocalFirstDb();
    return ((await db.get('replicas', docId)) as PersistedReplica<TState> | undefined) ?? null;
}

export async function saveReplica<TState>(replica: PersistedReplica<TState>) {
    const db = await openLocalFirstDb();
    await db.put('replicas', replica as PersistedReplica<unknown>, replica.docId);
}

export async function clearReplica(docId: string) {
    const db = await openLocalFirstDb();
    await Promise.all([
        db.delete('replicas', docId),
        deleteByDocId(db, 'batches', docId),
        deleteByDocId(db, 'receivedBatches', docId),
    ]);
}

export async function appendBatch(batch: PersistedBatch) {
    const db = await openLocalFirstDb();
    await db.put('batches', batch, batchKey(batch.docId, batch.origin, batch.batchId));
}

export async function listBatches(docId: string) {
    const db = await openLocalFirstDb();
    return db.getAllFromIndex('batches', 'docId', docId);
}

export async function countBatches(docId: string) {
    const db = await openLocalFirstDb();
    return db.countFromIndex('batches', 'docId', docId);
}

export async function countReceivedBatches(docId: string) {
    const db = await openLocalFirstDb();
    return db.countFromIndex('receivedBatches', 'docId', docId);
}

export async function hasReceivedBatch(docId: string, origin: string, batchId: string) {
    const db = await openLocalFirstDb();
    return (await db.get('receivedBatches', batchKey(docId, origin, batchId))) !== undefined;
}

export async function markReceivedBatch(received: ReceivedBatch) {
    const db = await openLocalFirstDb();
    await db.put(
        'receivedBatches',
        received,
        batchKey(received.docId, received.origin, received.batchId),
    );
}

let dbPromise: Promise<IDBPDatabase<LocalFirstDb>> | null = null;

function openLocalFirstDb() {
    dbPromise ??= openDB<LocalFirstDb>(DB_NAME, DB_VERSION, {
        upgrade(db, _oldVersion, _newVersion, tx) {
            if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
            if (!db.objectStoreNames.contains('replicas')) db.createObjectStore('replicas');
            const batches = db.objectStoreNames.contains('batches')
                ? tx.objectStore('batches')
                : db.createObjectStore('batches');
            if (!batches.indexNames.contains('docId')) batches.createIndex('docId', 'docId');
            const received = db.objectStoreNames.contains('receivedBatches')
                ? tx.objectStore('receivedBatches')
                : db.createObjectStore('receivedBatches');
            if (!received.indexNames.contains('docId')) received.createIndex('docId', 'docId');
        },
    });
    return dbPromise;
}

async function deleteByDocId(
    db: IDBPDatabase<LocalFirstDb>,
    storeName: 'batches' | 'receivedBatches',
    docId: string,
) {
    const keys = await db.getAllKeysFromIndex(storeName, 'docId', docId);
    const tx = db.transaction(storeName, 'readwrite');
    await Promise.all(keys.map((key) => tx.store.delete(key)));
    await tx.done;
}
