import type {CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';

export type ServerUser = {
    userId: string;
    nickname: string;
};

export type ServerLogEntry = {
    messageIndex: number;
    docId: string;
    origin: string;
    hlcTimestamp: HlcTimestamp;
    receivedAt: string;
    update: CrdtUpdate;
};

export type DocumentSummary = {
    docId: string;
    schemaFingerprint: string;
    nextMessageIndex: number;
    messageCount: number;
};

export type ConnectedClient = {
    actor?: string;
    userId?: string;
    sessionId?: string;
    docId?: string;
};
