import type {CrdtUpdate, HlcTimestamp} from 'umkehr/crdt';

export type ServerUser = {
    userId: string;
    nickname: string;
};

export type ServerPresenceSession = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    online: true;
    lastSeenAt: string;
};

export type ServerPresenceUser = {
    userId: string;
    nickname: string;
    color: string;
    sessions: ServerPresenceSession[];
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
    nickname?: string;
    color?: string;
    docId?: string;
    presenceReady?: boolean;
};
