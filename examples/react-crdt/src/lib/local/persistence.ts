import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {CrdtLocalHistory, CrdtUpdate} from 'umkehr/crdt';
import type {LocalDocumentSummary} from '../documentArchive';
import type {TransportState} from './useLocalDemoSync';

const DB_NAME = 'umkehr-react-crdt-local-simulator-documents';
const DB_VERSION = 2;

export type PersistedLocalSimulatorDocument<TState> = {
    docId: string;
    appId: string;
    title: string;
    schemaVersion: number;
    schemaFingerprintHash: string;
    replicas: Record<string, CrdtLocalHistory<TState>>;
    transportState: {
        syncEnabled: boolean;
        outbox: Record<string, CrdtUpdate[]>;
    };
    createdAt: string;
    updatedAt: string;
};

interface LocalSimulatorDb extends DBSchema {
    documents: {
        key: string;
        value: PersistedLocalSimulatorDocument<unknown>;
    };
}

export async function loadLocalSimulatorDocument<TState>(docId: string) {
    const db = await openLocalSimulatorDb();
    const document = (await db.get('documents', docId)) as
        | (PersistedLocalSimulatorDocument<TState> & {title?: string; schemaVersion?: number})
        | undefined;
    return document ? normalizeLocalSimulatorDocument(document) : null;
}

export async function saveLocalSimulatorDocument<TState>(
    document: PersistedLocalSimulatorDocument<TState>,
) {
    const db = await openLocalSimulatorDb();
    await db.put('documents', document as PersistedLocalSimulatorDocument<unknown>, document.docId);
}

export async function listLocalSimulatorDocumentSummaries(): Promise<LocalDocumentSummary[]> {
    const db = await openLocalSimulatorDb();
    const documents = await db.getAll('documents');
    return documents.map((document) => ({
        docId: document.docId,
        appId: document.appId,
        title: document.title || document.docId,
        payloadKind: 'local-simulator',
        schemaVersion: document.schemaVersion ?? 1,
        schemaFingerprintHash: document.schemaFingerprintHash,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    }));
}

export async function deleteLocalSimulatorDocument(docId: string) {
    const db = await openLocalSimulatorDb();
    await db.delete('documents', docId);
}

export function cloneTransportState(state: TransportState): PersistedLocalSimulatorDocument<unknown>['transportState'] {
    return {
        syncEnabled: state.syncEnabled,
        outbox: Object.fromEntries(
            Object.entries(state.outbox).map(([replicaId, updates]) => [replicaId, [...updates]]),
        ),
    };
}

let dbPromise: Promise<IDBPDatabase<LocalSimulatorDb>> | null = null;

function openLocalSimulatorDb() {
    dbPromise ??= openDB<LocalSimulatorDb>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
        },
    });
    return dbPromise;
}

function normalizeLocalSimulatorDocument<TState>(
    document: PersistedLocalSimulatorDocument<TState> & {title?: string; schemaVersion?: number},
): PersistedLocalSimulatorDocument<TState> {
    return {
        ...document,
        title: document.title || document.docId,
        schemaVersion: document.schemaVersion ?? 1,
    };
}
