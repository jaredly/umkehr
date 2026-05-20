import {Database} from 'bun:sqlite';
import type {CrdtUpdate} from 'umkehr/crdt';
import type {
    DocumentSummary,
    ServerBranch,
    ServerBranchEvent,
    ServerMigrationDump,
    ServerMigrationLock,
    ServerMigrationUpload,
    ServerMergeEvent,
    ServerUpdateEvent,
    ServerUser,
} from './types';

const MAIN_BRANCH_ID = 'main';
const MIGRATION_LOCK_TTL_MS = 60_000;

export class ServerStore {
    private db: Database;

    constructor(path = 'server-sync.sqlite') {
        this.db = new Database(path);
        this.db.exec(`
            create table if not exists documents (
                docId text primary key,
                schemaVersion integer not null default 1,
                schemaFingerprintHash text not null default '',
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
            create table if not exists archived_documents (
                docId text not null,
                schemaFingerprintHash text not null,
                schemaVersion integer not null,
                schemaFingerprint text not null,
                archivedAt text not null,
                branchesJson text not null,
                eventsJson text not null,
                primary key (docId, schemaFingerprintHash)
            );
            create table if not exists migration_locks (
                docId text primary key,
                ownerActor text not null,
                ownerUserId text not null,
                ownerSessionId text not null,
                sourceSchemaVersion integer not null,
                sourceSchemaFingerprint text not null,
                sourceSchemaFingerprintHash text not null,
                targetSchemaVersion integer not null,
                targetSchemaFingerprint text not null,
                targetSchemaFingerprintHash text not null,
                updatedAt text not null
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

    ensureUser(user: ServerUser): ServerUser {
        const cleanNickname = user.nickname.trim();
        if (!user.userId.trim()) throw new Error('User id is required.');
        if (!cleanNickname) throw new Error('Nickname is required.');
        const now = new Date().toISOString();
        const existing = this.getUserById(user.userId);
        if (existing) {
            this.db
                .query('update users set lastSeenAt = ? where userId = ?')
                .run(now, existing.userId);
            return existing;
        }

        const nickname = this.availableNickname(cleanNickname, user.userId);
        this.db
            .query(
                `insert into users (userId, nickname, nicknameKey, createdAt, lastSeenAt)
                 values (?, ?, ?, ?, ?)`,
            )
            .run(user.userId, nickname, nicknameKeyFor(nickname), now, now);
        return {userId: user.userId, nickname};
    }

    private availableNickname(nickname: string, userId: string) {
        const existing = this.db
            .query<UserRow, [string]>(
                `select userId, nickname
                 from users
                 where nicknameKey = ?`,
            )
            .get(nicknameKeyFor(nickname));
        if (!existing || existing.userId === userId) return nickname;
        return `${nickname} ${userId.slice(-4)}`;
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

    ensureDocument(docId: string, schemaVersion: number, schemaFingerprint: string, schemaFingerprintHash: string) {
        const existing = this.db
            .query<{schemaVersion: number; schemaFingerprint: string; schemaFingerprintHash: string}, [string]>(
                'select schemaVersion, schemaFingerprint, schemaFingerprintHash from documents where docId = ?',
            )
            .get(docId);
        if (existing) {
            const existingHash =
                existing.schemaFingerprintHash ||
                (existing.schemaFingerprint === schemaFingerprint ? schemaFingerprintHash : '');
            if (
                existing.schemaVersion !== schemaVersion ||
                existingHash !== schemaFingerprintHash
            ) {
                throw new Error('Document schema fingerprint does not match.');
            }
            if (!existing.schemaFingerprintHash) {
                this.db
                    .query('update documents set schemaFingerprintHash = ? where docId = ?')
                    .run(existingHash, docId);
            }
            this.ensureMainBranch(docId);
            return;
        }
        this.db
            .query(
                'insert into documents (docId, schemaVersion, schemaFingerprintHash, schemaFingerprint) values (?, ?, ?, ?)',
            )
            .run(docId, schemaVersion, schemaFingerprintHash, schemaFingerprint);
        this.ensureMainBranch(docId);
    }

    getDocument(docId: string): {schemaVersion: number; schemaFingerprint: string; schemaFingerprintHash: string} | null {
        return this.db
            .query<{schemaVersion: number; schemaFingerprint: string; schemaFingerprintHash: string}, [string]>(
                'select schemaVersion, schemaFingerprint, schemaFingerprintHash from documents where docId = ?',
            )
            .get(docId) ?? null;
    }

    activeMigrationLock(docId: string, now = new Date()): ServerMigrationLock | null {
        this.expireMigrationLock(docId, now);
        const lock = this.getMigrationLock(docId);
        return lock ?? null;
    }

    expireMigrationLock(docId: string, now = new Date()): ServerMigrationLock | null {
        const lock = this.getMigrationLock(docId);
        if (!lock) return null;
        if (now.getTime() - Date.parse(lock.updatedAt) <= MIGRATION_LOCK_TTL_MS) return null;
        this.db.query('delete from migration_locks where docId = ?').run(docId);
        return lock;
    }

    beginMigration({
        docId,
        ownerActor,
        ownerUserId,
        ownerSessionId,
        targetSchemaVersion,
        targetSchemaFingerprint,
        targetSchemaFingerprintHash,
    }: {
        docId: string;
        ownerActor: string;
        ownerUserId: string;
        ownerSessionId: string;
        targetSchemaVersion: number;
        targetSchemaFingerprint: string;
        targetSchemaFingerprintHash: string;
    }): {kind: 'locked'; lock: ServerMigrationLock} | {kind: 'granted'; lock: ServerMigrationLock; dump: ServerMigrationDump} {
        const existing = this.activeMigrationLock(docId);
        if (existing && existing.ownerActor !== ownerActor) return {kind: 'locked', lock: existing};
        const document = this.getDocument(docId);
        if (!document) throw new Error('Document does not exist.');
        const now = new Date().toISOString();
        const lock: ServerMigrationLock = {
            docId,
            ownerActor,
            ownerUserId,
            ownerSessionId,
            sourceSchemaVersion: document.schemaVersion,
            sourceSchemaFingerprint: document.schemaFingerprint,
            sourceSchemaFingerprintHash: document.schemaFingerprintHash,
            targetSchemaVersion,
            targetSchemaFingerprint,
            targetSchemaFingerprintHash,
            updatedAt: now,
        };
        this.db
            .query(
                `insert or replace into migration_locks
                    (docId, ownerActor, ownerUserId, ownerSessionId, sourceSchemaVersion, sourceSchemaFingerprint,
                     sourceSchemaFingerprintHash, targetSchemaVersion, targetSchemaFingerprint, targetSchemaFingerprintHash, updatedAt)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                docId,
                ownerActor,
                ownerUserId,
                ownerSessionId,
                lock.sourceSchemaVersion,
                lock.sourceSchemaFingerprint,
                lock.sourceSchemaFingerprintHash,
                targetSchemaVersion,
                targetSchemaFingerprint,
                targetSchemaFingerprintHash,
                now,
            );
        return {kind: 'granted', lock, dump: this.migrationDump(lock)};
    }

    completeMigration({
        ownerActor,
        upload,
    }: {
        ownerActor: string;
        upload: ServerMigrationUpload;
    }) {
        const tx = this.db.transaction(() => {
            const lock = this.activeMigrationLock(upload.docId);
            if (!lock || lock.ownerActor !== ownerActor) throw new Error('No active migration lock for this client.');
            if (lock.sourceSchemaFingerprintHash !== upload.sourceSchemaFingerprintHash) {
                throw new Error('Migration upload source schema does not match the active document.');
            }
            if (
                lock.targetSchemaVersion !== upload.targetSchemaVersion ||
                lock.targetSchemaFingerprintHash !== upload.targetSchemaFingerprintHash
            ) {
                throw new Error('Migration upload target schema does not match the lock.');
            }
            const document = this.getDocument(upload.docId);
            if (!document) throw new Error('Document does not exist.');
            if (document.schemaFingerprintHash !== upload.sourceSchemaFingerprintHash) {
                throw new Error('Active document changed during migration.');
            }
            validateMigrationUpload(upload);
            const branches = this.listBranches(upload.docId);
            const events = branches.flatMap((branch) => this.listEventsAfter(upload.docId, branch.branchId, 0));
            const now = new Date().toISOString();
            this.db
                .query(
                    `insert or replace into archived_documents
                        (docId, schemaFingerprintHash, schemaVersion, schemaFingerprint, archivedAt, branchesJson, eventsJson)
                     values (?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    upload.docId,
                    document.schemaFingerprintHash,
                    document.schemaVersion,
                    document.schemaFingerprint,
                    now,
                    JSON.stringify(branches),
                    JSON.stringify(events),
                );
            this.db.query('delete from branch_events where docId = ?').run(upload.docId);
            this.db.query('delete from branches where docId = ?').run(upload.docId);
            this.db
                .query(
                    `update documents
                     set schemaVersion = ?, schemaFingerprintHash = ?, schemaFingerprint = ?
                     where docId = ?`,
                )
                .run(
                    upload.targetSchemaVersion,
                    upload.targetSchemaFingerprintHash,
                    upload.targetSchemaFingerprint,
                    upload.docId,
                );
            for (const branch of upload.branches) this.insertBranch(branch);
            for (const event of upload.events) this.insertEvent(event);
            this.db.query('delete from migration_locks where docId = ?').run(upload.docId);
            return {
                schemaVersion: upload.targetSchemaVersion,
                schemaFingerprintHash: upload.targetSchemaFingerprintHash,
            };
        });
        return tx();
    }

    archivedSchemaHashes(docId: string): string[] {
        return this.db
            .query<{schemaFingerprintHash: string}, [string]>(
                'select schemaFingerprintHash from archived_documents where docId = ? order by archivedAt desc',
            )
            .all(docId)
            .map((row) => row.schemaFingerprintHash);
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
                    d.schemaVersion as schemaVersion,
                    d.schemaFingerprintHash as schemaFingerprintHash,
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

    private migrationDump(lock: ServerMigrationLock): ServerMigrationDump {
        const branches = this.listBranches(lock.docId);
        return {
            docId: lock.docId,
            sourceSchemaVersion: lock.sourceSchemaVersion,
            sourceSchemaFingerprint: lock.sourceSchemaFingerprint,
            sourceSchemaFingerprintHash: lock.sourceSchemaFingerprintHash,
            targetSchemaVersion: lock.targetSchemaVersion,
            targetSchemaFingerprint: lock.targetSchemaFingerprint,
            targetSchemaFingerprintHash: lock.targetSchemaFingerprintHash,
            branches,
            events: branches.flatMap((branch) => this.listEventsAfter(lock.docId, branch.branchId, 0)),
        };
    }

    private getMigrationLock(docId: string): ServerMigrationLock | null {
        return this.db
            .query<ServerMigrationLock, [string]>(
                `select docId, ownerActor, ownerUserId, ownerSessionId, sourceSchemaVersion, sourceSchemaFingerprint,
                        sourceSchemaFingerprintHash, targetSchemaVersion, targetSchemaFingerprint,
                        targetSchemaFingerprintHash, updatedAt
                 from migration_locks
                 where docId = ?`,
            )
            .get(docId) ?? null;
    }

    private insertBranch(branch: ServerBranch) {
        this.db
            .query(
                `insert into branches
                    (docId, branchId, name, nameKey, sourceBranchId, forkEventIndex, nextEventIndex, createdAt, updatedAt)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                branch.docId,
                branch.branchId,
                branch.name,
                branchNameKey(branch.name),
                branch.sourceBranchId ?? null,
                branch.forkEventIndex ?? null,
                branch.tipEventIndex + 1,
                branch.createdAt,
                branch.updatedAt,
            );
    }

    private insertEvent(event: ServerBranchEvent) {
        this.db
            .query(
                `insert into branch_events
                    (docId, branchId, eventIndex, kind, origin, hlcTimestamp, mergeId, receivedAt, payloadJson)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                event.docId,
                event.branchId,
                event.eventIndex,
                event.kind,
                event.kind === 'update' ? event.origin : event.actor,
                event.kind === 'update' ? event.hlcTimestamp : null,
                event.kind === 'merge' ? event.mergeId : null,
                event.kind === 'update' ? event.receivedAt : event.createdAt,
                JSON.stringify(event),
            );
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
        let columns = this.db
            .query<{name: string}, []>('pragma table_info(documents)')
            .all()
            .map((column) => column.name);
        if (columns.includes('nextMessageIndex')) {
            this.db.exec(`
                alter table documents rename to documents_v2;
                create table documents (
                    docId text primary key,
                    schemaVersion integer not null default 1,
                    schemaFingerprintHash text not null default '',
                    schemaFingerprint text not null
                );
                insert or ignore into documents (docId, schemaVersion, schemaFingerprintHash, schemaFingerprint)
                    select docId, 1, '', schemaFingerprint from documents_v2;
            `);
            columns = this.db
                .query<{name: string}, []>('pragma table_info(documents)')
                .all()
                .map((column) => column.name);
        }
        if (!columns.includes('schemaVersion')) {
            this.db.exec('alter table documents add column schemaVersion integer not null default 1');
        }
        if (!columns.includes('schemaFingerprintHash')) {
            this.db.exec("alter table documents add column schemaFingerprintHash text not null default ''");
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

function validateMigrationUpload(upload: ServerMigrationUpload) {
    if (!upload.branches.length) throw new Error('Migration upload must include at least one branch.');
    const branchIds = new Set(upload.branches.map((branch) => branch.branchId));
    if (!branchIds.has(MAIN_BRANCH_ID)) throw new Error('Migration upload must include main branch.');
    for (const branch of upload.branches) {
        if (branch.docId !== upload.docId) throw new Error('Migration upload branch doc id mismatch.');
        if (!branch.branchId.trim()) throw new Error('Migration upload branch id is required.');
        if (!branch.name.trim()) throw new Error('Migration upload branch name is required.');
        if (branch.sourceBranchId && !branchIds.has(branch.sourceBranchId)) {
            throw new Error('Migration upload branch source is missing.');
        }
        if (!Number.isSafeInteger(branch.tipEventIndex) || branch.tipEventIndex < 0) {
            throw new Error('Migration upload branch tip is invalid.');
        }
    }
    const seen = new Set<string>();
    for (const event of upload.events) {
        if (event.docId !== upload.docId) throw new Error('Migration upload event doc id mismatch.');
        if (!branchIds.has(event.branchId)) throw new Error('Migration upload event branch is missing.');
        if (!Number.isSafeInteger(event.eventIndex) || event.eventIndex < 1) {
            throw new Error('Migration upload event index is invalid.');
        }
        const key = `${event.branchId}:${event.eventIndex}`;
        if (seen.has(key)) throw new Error('Migration upload event indexes must be unique.');
        seen.add(key);
        if (event.kind === 'merge' && !branchIds.has(event.sourceBranchId)) {
            throw new Error('Migration upload merge source branch is missing.');
        }
        const branch = upload.branches.find((candidate) => candidate.branchId === event.branchId);
        if (branch && event.eventIndex > branch.tipEventIndex) {
            throw new Error('Migration upload event is beyond branch tip.');
        }
    }
}

function nicknameKeyFor(nickname: string) {
    return nickname.trim().toLocaleLowerCase();
}

function branchNameKey(name: string) {
    return name.trim().toLocaleLowerCase();
}
