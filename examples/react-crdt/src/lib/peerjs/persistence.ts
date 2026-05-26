import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import type {LocalDocumentSummary} from '../documentArchive';

const DB_NAME = 'umkehr-react-crdt-peerjs-documents';
const DB_VERSION = 1;

export type PersistedPeerJsDocument<TState> = {
    docId: string;
    appId: string;
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
    return ((await db.get('documents', docId)) as PersistedPeerJsDocument<TState> | undefined) ?? null;
}

export async function savePeerJsDocument<TState>(document: PersistedPeerJsDocument<TState>) {
    const db = await openPeerJsDocumentsDb();
    await db.put('documents', document as PersistedPeerJsDocument<unknown>, document.docId);
}

export async function listPeerJsDocumentSummaries(): Promise<LocalDocumentSummary[]> {
    const db = await openPeerJsDocumentsDb();
    const documents = await db.getAll('documents');
    return documents.map((document) => ({
        docId: document.docId,
        appId: document.appId,
        title: document.docId,
        payloadKind: 'peerjs',
        schemaFingerprintHash: document.schemaFingerprintHash,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    }));
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
