import {Database} from 'bun:sqlite';
import type {CrdtUpdate} from 'umkehr/crdt';
import type {
    DocumentSummary,
    ServerBranch,
    ServerBranchEvent,
    ServerMergeEvent,
    ServerUpdateEvent,
    ServerUser,
} from './types';

const MAIN_BRANCH_ID = 'main';

export class ServerStore {
    private db: Database;

    constructor(path = 'server-sync.sqlite') {
        this.db = new Database(path);
        this.db.exec(`
            create table if not exists documents (
                docId text primary key,
                schemaFingerprint text not null
            );
            create table if not exists branches (
                docId text not null,
                branchId text not null,
                name text not null,
                nameKey text not null,
                sourceBranchId text,
                forkEventIndex integer,
                nextEventIndex integer not null,
                createdAt text not null,
                updatedAt text not null,
                primary key (docId, branchId),
                unique (docId, nameKey)
            );
            create table if not exists branch_events (
                docId text not null,
                branchId text not null,
                eventIndex integer not null,
                kind text not null,
                origin text,
                hlcTimestamp text,
                mergeId text,
                receivedAt text not null,
                payloadJson text not null,
                primary key (docId, branchId, eventIndex)
            );
            create unique index if not exists branch_events_update_hlc_idx
                on branch_events (docId, branchId, hlcTimestamp)
                where hlcTimestamp is not null;
            create index if not exists branch_events_doc_branch_idx
                on branch_events (docId, branchId, eventIndex);
            create table if not exists users (
                userId text primary key,
                nickname text not null,
                nicknameKey text not null unique,
                createdAt text not null,
                lastSeenAt text not null
            );
        `);
        this.migrateLegacyDocuments();
        this.migrateBranchEvents();
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
            this.ensureMainBranch(docId);
            return;
        }
        this.db
            .query('insert into documents (docId, schemaFingerprint) values (?, ?)')
            .run(docId, schemaFingerprint);
        this.ensureMainBranch(docId);
    }

    ensureMainBranch(docId: string) {
        const existing = this.findBranch(docId, MAIN_BRANCH_ID);
        if (existing) return existing;
        const now = new Date().toISOString();
        this.db
            .query(
                `insert into branches
                    (docId, branchId, name, nameKey, sourceBranchId, forkEventIndex, nextEventIndex, createdAt, updatedAt)
                 values (?, ?, ?, ?, null, null, 1, ?, ?)`,
            )
            .run(docId, MAIN_BRANCH_ID, 'main', branchNameKey('main'), now, now);
        return this.findBranch(docId, MAIN_BRANCH_ID)!;
    }

    listBranches(docId: string): ServerBranch[] {
        return this.db
            .query<BranchRow, [string]>(
                `select docId, branchId, name, sourceBranchId, forkEventIndex, nextEventIndex, createdAt, updatedAt
                 from branches
                 where docId = ?
                 order by nameKey asc`,
            )
            .all(docId)
            .map(rowToBranch);
    }

    createBranch({
        docId,
        branchId,
        sourceBranchId,
        forkEventIndex,
        name,
    }: {
        docId: string;
        branchId?: string;
        sourceBranchId: string;
        forkEventIndex: number;
        name: string;
    }): ServerBranch {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Branch name is required.');
        if (!Number.isSafeInteger(forkEventIndex) || forkEventIndex < 0) {
            throw new Error('Invalid fork event index.');
        }
        const source = this.findBranch(docId, sourceBranchId);
        if (!source) throw new Error('Source branch does not exist.');
        if (forkEventIndex > source.tipEventIndex) {
            throw new Error('Fork event index is past source branch tip.');
        }
        const id = branchId?.trim() || `branch-${crypto.randomUUID()}`;
        const existing = this.findBranch(docId, id);
        if (existing) return existing;
        const now = new Date().toISOString();
        this.db
            .query(
                `insert into branches
                    (docId, branchId, name, nameKey, sourceBranchId, forkEventIndex, nextEventIndex, createdAt, updatedAt)
                 values (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .run(
                docId,
                id,
                cleanName,
                branchNameKey(cleanName),
                sourceBranchId,
                forkEventIndex,
                now,
                now,
            );
        return this.findBranch(docId, id)!;
    }

    renameBranch({
        docId,
        branchId,
        name,
    }: {
        docId: string;
        branchId: string;
        name: string;
    }): ServerBranch {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Branch name is required.');
        const now = new Date().toISOString();
        this.db
            .query('update branches set name = ?, nameKey = ?, updatedAt = ? where docId = ? and branchId = ?')
            .run(cleanName, branchNameKey(cleanName), now, docId, branchId);
        const branch = this.findBranch(docId, branchId);
        if (!branch) throw new Error('Branch does not exist.');
        return branch;
    }

    appendUpdateEvent({
        docId,
        branchId,
        origin,
        hlcTimestamp,
        update,
    }: {
        docId: string;
        branchId: string;
        origin: string;
        hlcTimestamp: string;
        update: CrdtUpdate;
    }): ServerUpdateEvent {
        const existing = this.findUpdateByTimestamp(docId, branchId, hlcTimestamp);
        if (existing) return existing;
        return this.appendEvent(docId, branchId, (eventIndex, now) => ({
            kind: 'update',
            docId,
            branchId,
            eventIndex,
            origin,
            hlcTimestamp,
            receivedAt: now,
            update,
        }));
    }

    appendMergeEvent({
        docId,
        branchId,
        mergeId,
        actor,
        sourceBranchId,
        sourceThroughEventIndex,
    }: {
        docId: string;
        branchId: string;
        mergeId: string;
        actor: string;
        sourceBranchId: string;
        sourceThroughEventIndex: number;
    }): ServerMergeEvent {
        const existing = this.findMergeById(docId, branchId, mergeId);
        if (existing) return existing;
        const source = this.findBranch(docId, sourceBranchId);
        if (!source) throw new Error('Source branch does not exist.');
        if (
            !Number.isSafeInteger(sourceThroughEventIndex) ||
            sourceThroughEventIndex < 0 ||
            sourceThroughEventIndex > source.tipEventIndex
        ) {
            throw new Error('Invalid source merge event index.');
        }
        return this.appendEvent(docId, branchId, (eventIndex, now) => ({
            kind: 'merge',
            mergeId,
            docId,
            branchId,
            eventIndex,
            sourceBranchId,
            sourceThroughEventIndex,
            actor,
            createdAt: now,
        }));
    }

    listEventsAfter(docId: string, branchId: string, afterEventIndex: number): ServerBranchEvent[] {
        return this.db
            .query<EventRow, [string, string, number]>(
                `select docId, branchId, eventIndex, kind, origin, hlcTimestamp, receivedAt, payloadJson
                 from branch_events
                 where docId = ? and branchId = ? and eventIndex > ?
                 order by eventIndex asc`,
            )
            .all(docId, branchId, afterEventIndex)
            .map(rowToEvent);
    }

    listEventsThrough(
        docId: string,
        branchId: string,
        throughEventIndex: number,
    ): ServerBranchEvent[] {
        return this.db
            .query<EventRow, [string, string, number]>(
                `select docId, branchId, eventIndex, kind, origin, hlcTimestamp, receivedAt, payloadJson
                 from branch_events
                 where docId = ? and branchId = ? and eventIndex <= ?
                 order by eventIndex asc`,
            )
            .all(docId, branchId, throughEventIndex)
            .map(rowToEvent);
    }

    summarizeDocuments(): DocumentSummary[] {
        return this.db
            .query<DocumentSummary, []>(
                `select
                    d.docId as docId,
                    d.schemaFingerprint as schemaFingerprint,
                    count(distinct b.branchId) as branchCount,
                    count(e.eventIndex) as eventCount
                 from documents d
                 left join branches b on b.docId = d.docId
                 left join branch_events e on e.docId = b.docId and e.branchId = b.branchId
                 group by d.docId
                 order by d.docId asc`,
            )
            .all();
    }

    recentEvents(limit = 50): ServerBranchEvent[] {
        return this.db
            .query<EventRow, [number]>(
                `select docId, branchId, eventIndex, kind, origin, hlcTimestamp, receivedAt, payloadJson
                 from branch_events
                 order by receivedAt desc
                 limit ?`,
            )
            .all(limit)
            .map(rowToEvent);
    }

    private appendEvent<TEvent extends ServerBranchEvent>(
        docId: string,
        branchId: string,
        create: (eventIndex: number, now: string) => TEvent,
    ): TEvent {
        const tx = this.db.transaction(() => {
            const branch = this.db
                .query<{nextEventIndex: number}, [string, string]>(
                    'select nextEventIndex from branches where docId = ? and branchId = ?',
                )
                .get(docId, branchId);
            if (!branch) throw new Error('Branch does not exist.');
            const eventIndex = branch.nextEventIndex;
            const now = new Date().toISOString();
            const event = create(eventIndex, now);
            this.db
                .query(
                    `insert into branch_events
                        (docId, branchId, eventIndex, kind, origin, hlcTimestamp, mergeId, receivedAt, payloadJson)
                     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    docId,
                    branchId,
                    eventIndex,
                    event.kind,
                    event.kind === 'update' ? event.origin : event.actor,
                    event.kind === 'update' ? event.hlcTimestamp : null,
                    event.kind === 'merge' ? event.mergeId : null,
                    event.kind === 'update' ? event.receivedAt : event.createdAt,
                    JSON.stringify(event),
                );
            this.db
                .query('update branches set nextEventIndex = ?, updatedAt = ? where docId = ? and branchId = ?')
                .run(eventIndex + 1, now, docId, branchId);
            return event;
        });
        return tx();
    }

    private findBranch(docId: string, branchId: string): ServerBranch | null {
        const row = this.db
            .query<BranchRow, [string, string]>(
                `select docId, branchId, name, sourceBranchId, forkEventIndex, nextEventIndex, createdAt, updatedAt
                 from branches
                 where docId = ? and branchId = ?`,
            )
            .get(docId, branchId);
        return row ? rowToBranch(row) : null;
    }

    private findUpdateByTimestamp(
        docId: string,
        branchId: string,
        hlcTimestamp: string,
    ): ServerUpdateEvent | null {
        const row = this.db
            .query<EventRow, [string, string, string]>(
                `select docId, branchId, eventIndex, kind, origin, hlcTimestamp, receivedAt, payloadJson
                 from branch_events
                 where docId = ? and branchId = ? and hlcTimestamp = ?`,
            )
            .get(docId, branchId, hlcTimestamp);
        if (!row) return null;
        const event = rowToEvent(row);
        return event.kind === 'update' ? event : null;
    }

    private findMergeById(docId: string, branchId: string, mergeId: string): ServerMergeEvent | null {
        const row = this.db
            .query<EventRow, [string, string, string]>(
                `select docId, branchId, eventIndex, kind, origin, hlcTimestamp, receivedAt, payloadJson
                 from branch_events
                 where docId = ? and branchId = ? and mergeId = ?`,
            )
            .get(docId, branchId, mergeId);
        if (!row) return null;
        const event = rowToEvent(row);
        return event.kind === 'merge' ? event : null;
    }

    private migrateBranchEvents() {
        const columns = this.db
            .query<{name: string}, []>('pragma table_info(branch_events)')
            .all()
            .map((column) => column.name);
        if (!columns.includes('mergeId')) {
            this.db.exec('alter table branch_events add column mergeId text');
        }
        this.db.exec(`
            create unique index if not exists branch_events_merge_id_idx
                on branch_events (docId, branchId, mergeId)
                where mergeId is not null;
        `);
    }

    private migrateLegacyDocuments() {
        const columns = this.db
            .query<{name: string}, []>('pragma table_info(documents)')
            .all()
            .map((column) => column.name);
        if (columns.includes('nextMessageIndex')) {
            this.db.exec(`
                alter table documents rename to documents_v2;
                create table documents (
                    docId text primary key,
                    schemaFingerprint text not null
                );
                insert or ignore into documents (docId, schemaFingerprint)
                    select docId, schemaFingerprint from documents_v2;
            `);
        }
    }
}

type BranchRow = {
    docId: string;
    branchId: string;
    name: string;
    sourceBranchId: string | null;
    forkEventIndex: number | null;
    nextEventIndex: number;
    createdAt: string;
    updatedAt: string;
};

type EventRow = {
    docId: string;
    branchId: string;
    eventIndex: number;
    kind: string;
    origin: string | null;
    hlcTimestamp: string | null;
    receivedAt: string;
    payloadJson: string;
};

type UserRow = {
    userId: string;
    nickname: string;
};

function rowToBranch(row: BranchRow): ServerBranch {
    return {
        docId: row.docId,
        branchId: row.branchId,
        name: row.name,
        sourceBranchId: row.sourceBranchId ?? undefined,
        forkEventIndex: row.forkEventIndex ?? undefined,
        tipEventIndex: row.nextEventIndex - 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function rowToEvent(row: EventRow): ServerBranchEvent {
    return JSON.parse(row.payloadJson) as ServerBranchEvent;
}

function rowToUser(row: UserRow): ServerUser {
    return {
        userId: row.userId,
        nickname: row.nickname,
    };
}

function nicknameKeyFor(nickname: string) {
    return nickname.trim().toLocaleLowerCase();
}

function branchNameKey(name: string) {
    return name.trim().toLocaleLowerCase();
}
