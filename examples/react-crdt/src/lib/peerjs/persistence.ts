import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import type {LocalDocumentSummary} from '../documentArchive';
import {cloneSerializableCrdtLocalHistory} from '../crdtApp';

const DB_NAME = 'umkehr-react-crdt-peerjs-documents';
const DB_VERSION = 2;

export type PersistedPeerJsDocument<TState> = {
    docId: string;
    appId: string;
    title: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
    history: CrdtLocalHistory<TState>;
    createdAt: string;
    updatedAt: string;
};

interface PeerJsDocumentsDb extends DBSchema {
    documents: {
        key: string;
        value: PersistedPeerJsDocument<unknown>;
    };
}

export async function loadPeerJsDocument<TState>(docId: string) {
    const db = await openPeerJsDocumentsDb();
    const document = (await db.get('documents', docId)) as
        | (PersistedPeerJsDocument<TState> & {title?: string; schemaVersion?: number})
        | undefined;
    return document ? normalizePeerJsDocument(document) : null;
}

export async function savePeerJsDocument<TState>(document: PersistedPeerJsDocument<TState>) {
    const db = await openPeerJsDocumentsDb();
    await db.put(
        'documents',
        {
            ...document,
            history: cloneSerializableCrdtLocalHistory(document.history),
        } as PersistedPeerJsDocument<unknown>,
        document.docId,
    );
}

export async function listPeerJsDocumentSummaries(): Promise<LocalDocumentSummary[]> {
    const db = await openPeerJsDocumentsDb();
    const documents = await db.getAll('documents');
    return documents.map((document) => ({
        docId: document.docId,
        appId: document.appId,
        title: document.title || document.docId,
        payloadKind: 'peerjs',
        schemaVersion: document.schemaVersion ?? 1,
        schemaFingerprintHash: document.schemaFingerprintHash,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    }));
}

export async function deletePeerJsDocument(docId: string) {
    const db = await openPeerJsDocumentsDb();
    await db.delete('documents', docId);
}

let dbPromise: Promise<IDBPDatabase<PeerJsDocumentsDb>> | null = null;

function openPeerJsDocumentsDb() {
    dbPromise ??= openDB<PeerJsDocumentsDb>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
        },
    });
    return dbPromise;
}

function normalizePeerJsDocument<TState>(
    document: PersistedPeerJsDocument<TState> & {title?: string; schemaVersion?: number},
): PersistedPeerJsDocument<TState> {
    return {
        ...document,
        title: document.title || document.docId,
        schemaVersion: document.schemaVersion ?? 1,
    };
}
