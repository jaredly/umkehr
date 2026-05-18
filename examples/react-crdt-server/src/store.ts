import {Database} from 'bun:sqlite';
import type {CrdtUpdate} from 'umkehr/crdt';
import type {DocumentSummary, ServerLogEntry, ServerUser} from './types';

export class ServerStore {
    private db: Database;

    constructor(path = 'server-sync.sqlite') {
        this.db = new Database(path);
        this.db.exec(`
            create table if not exists documents (
                docId text primary key,
                schemaFingerprint text not null,
                nextMessageIndex integer not null
            );
            create table if not exists messages (
                docId text not null,
                messageIndex integer not null,
                origin text not null,
                hlcTimestamp text not null,
                receivedAt text not null,
                updateJson text not null,
                primary key (docId, messageIndex),
                unique (docId, hlcTimestamp)
            );
            create index if not exists messages_doc_message_idx
                on messages (docId, messageIndex);
            create index if not exists messages_doc_hlc_idx
                on messages (docId, hlcTimestamp);
            create table if not exists users (
                userId text primary key,
                nickname text not null,
                nicknameKey text not null unique,
                createdAt text not null,
                lastSeenAt text not null
            );
        `);
    }

    listUsers(): ServerUser[] {
        return this.db
            .query<UserRow, []>(
                `select userId, nickname
                 from users
                 order by nicknameKey asc`,
            )
            .all()
            .map(rowToUser);
    }

    loginUser(nickname: string): ServerUser {
        const cleanNickname = nickname.trim();
        if (!cleanNickname) throw new Error('Nickname is required.');
        const nicknameKey = nicknameKeyFor(cleanNickname);
        const existing = this.db
            .query<UserRow, [string]>(
                `select userId, nickname
                 from users
                 where nicknameKey = ?`,
            )
            .get(nicknameKey);
        const now = new Date().toISOString();
        if (existing) {
            this.db
                .query('update users set lastSeenAt = ? where userId = ?')
                .run(now, existing.userId);
            return rowToUser(existing);
        }

        const user: ServerUser = {
            userId: `user-${crypto.randomUUID()}`,
            nickname: cleanNickname,
        };
        this.db
            .query(
                `insert into users (userId, nickname, nicknameKey, createdAt, lastSeenAt)
                 values (?, ?, ?, ?, ?)`,
            )
            .run(user.userId, user.nickname, nicknameKey, now, now);
        return user;
    }

    getUserById(userId: string): ServerUser | null {
        const row = this.db
            .query<UserRow, [string]>(
                `select userId, nickname
                 from users
                 where userId = ?`,
            )
            .get(userId);
        return row ? rowToUser(row) : null;
    }

    ensureDocument(docId: string, schemaFingerprint: string) {
        const existing = this.db
            .query<{schemaFingerprint: string}, [string]>(
                'select schemaFingerprint from documents where docId = ?',
            )
            .get(docId);
        if (existing) {
            if (existing.schemaFingerprint !== schemaFingerprint) {
                throw new Error('Document schema fingerprint does not match.');
            }
            return;
        }
        this.db
            .query(
                'insert into documents (docId, schemaFingerprint, nextMessageIndex) values (?, ?, 1)',
            )
            .run(docId, schemaFingerprint);
    }

    appendUpdate({
        docId,
        schemaFingerprint,
        origin,
        hlcTimestamp,
        update,
    }: {
        docId: string;
        schemaFingerprint: string;
        origin: string;
        hlcTimestamp: string;
        update: CrdtUpdate;
    }): ServerLogEntry {
        this.ensureDocument(docId, schemaFingerprint);
        const existing = this.findByTimestamp(docId, hlcTimestamp);
        if (existing) return existing;

        const receivedAt = new Date().toISOString();
        const tx = this.db.transaction(() => {
            const doc = this.db
                .query<{nextMessageIndex: number}, [string]>(
                    'select nextMessageIndex from documents where docId = ?',
                )
                .get(docId);
            if (!doc) throw new Error('Document was not initialized.');
            const messageIndex = doc.nextMessageIndex;
            this.db
                .query(
                    `insert into messages
                        (docId, messageIndex, origin, hlcTimestamp, receivedAt, updateJson)
                     values (?, ?, ?, ?, ?, ?)`,
                )
                .run(docId, messageIndex, origin, hlcTimestamp, receivedAt, JSON.stringify(update));
            this.db
                .query('update documents set nextMessageIndex = ? where docId = ?')
                .run(messageIndex + 1, docId);
            return {
                docId,
                messageIndex,
                origin,
                hlcTimestamp,
                receivedAt,
                update,
            };
        });
        return tx();
    }

    listAfter(docId: string, afterMessageIndex: number, excludeOrigin?: string): ServerLogEntry[] {
        const rows = this.db
            .query<MessageRow, [string, number]>(
                `select docId, messageIndex, origin, hlcTimestamp, receivedAt, updateJson
                 from messages
                 where docId = ? and messageIndex > ?
                 order by messageIndex asc`,
            )
            .all(docId, afterMessageIndex);
        return rows.filter((row) => row.origin !== excludeOrigin).map(rowToEntry);
    }

    summarizeDocuments(): DocumentSummary[] {
        return this.db
            .query<DocumentSummary, []>(
                `select
                    d.docId as docId,
                    d.schemaFingerprint as schemaFingerprint,
                    d.nextMessageIndex as nextMessageIndex,
                    count(m.messageIndex) as messageCount
                 from documents d
                 left join messages m on m.docId = d.docId
                 group by d.docId
                 order by d.docId asc`,
            )
            .all();
    }

    recentMessages(limit = 50): ServerLogEntry[] {
        return this.db
            .query<MessageRow, [number]>(
                `select docId, messageIndex, origin, hlcTimestamp, receivedAt, updateJson
                 from messages
                 order by receivedAt desc
                 limit ?`,
            )
            .all(limit)
            .map(rowToEntry);
    }

    private findByTimestamp(docId: string, hlcTimestamp: string): ServerLogEntry | null {
        const row = this.db
            .query<MessageRow, [string, string]>(
                `select docId, messageIndex, origin, hlcTimestamp, receivedAt, updateJson
                 from messages
                 where docId = ? and hlcTimestamp = ?`,
            )
            .get(docId, hlcTimestamp);
        return row ? rowToEntry(row) : null;
    }
}

type MessageRow = {
    docId: string;
    messageIndex: number;
    origin: string;
    hlcTimestamp: string;
    receivedAt: string;
    updateJson: string;
};

type UserRow = {
    userId: string;
    nickname: string;
};

function rowToUser(row: UserRow): ServerUser {
    return {
        userId: row.userId,
        nickname: row.nickname,
    };
}

function nicknameKeyFor(nickname: string) {
    return nickname.trim().toLocaleLowerCase();
}

function rowToEntry(row: MessageRow): ServerLogEntry {
    return {
        docId: row.docId,
        messageIndex: row.messageIndex,
        origin: row.origin,
        hlcTimestamp: row.hlcTimestamp,
        receivedAt: row.receivedAt,
        update: JSON.parse(row.updateJson) as CrdtUpdate,
    };
}
