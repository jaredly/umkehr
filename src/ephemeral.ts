import {ancestorPathKeys, isDescendantOrSelf, pathKey, samePath} from './statuses.js';
import type {Path} from './types.js';

export type EphemeralMessage<Data> = {
    kind: string;
    id: string;
    actor: string;
    path?: Path;
    data: Data;
    clear?: boolean;
    expiresAt?: string;
};

export type EphemeralConfig<Data> = {
    validateEphemeralData(input: unknown): input is Data;
    maxEphemeralBytes?: number;
};

export type EphemeralState = 'active' | 'stale';

export type EphemeralRecord<Data = unknown> = {
    message: EphemeralMessage<Data>;
    receivedAt: string;
    state: EphemeralState;
};

export type EphemeralQuery = {
    actor?: string;
    path?: Path;
    descendants?: boolean;
    kinds?: readonly string[];
};

export type EphemeralStore = {
    get<Data = unknown>(query?: EphemeralQuery, now?: Date): EphemeralRecord<Data>[];
    subscribe<Data = unknown>(
        query: EphemeralQuery | undefined,
        listener: (records: EphemeralRecord<Data>[]) => void,
    ): () => void;
    add<Data>(messages: EphemeralMessage<Data>[], receivedAt?: Date): void;
    clear(id: string): void;
    clearActor(actor: string): void;
    clearAll(): void;
    sweep(now?: Date): void;
};

type StoredRecord = {
    message: EphemeralMessage<unknown>;
    receivedAtMs: number;
    receivedAt: string;
};

type Subscription = {
    query?: EphemeralQuery;
    listener: (records: EphemeralRecord[]) => void;
    last: EphemeralRecord[];
};

const staleAfterMs = 15_000;
const removeAfterMs = 30_000;

export function createEphemeralStore(): EphemeralStore {
    const byId = new Map<string, StoredRecord>();
    const idsByActor = new Map<string, Set<string>>();
    const exactIdsByPath = new Map<string, Set<string>>();
    const descendantIdsByPath = new Map<string, Set<string>>();
    const subscriptions = new Set<Subscription>();

    const getStoredRecords = (query?: EphemeralQuery, now = new Date()) => {
        const nowMs = now.getTime();
        const ids = idsForQuery(query);
        const records: EphemeralRecord[] = [];
        ids.forEach((id) => {
            const record = byId.get(id);
            if (!record) return;
            if (isExpired(record, nowMs)) return;
            if (!matchesQuery(record.message, query)) return;
            records.push(toEphemeralRecord(record, nowMs));
        });
        return records;
    };

    const notify = (now = new Date()) => {
        subscriptions.forEach((subscription) => {
            const next = getStoredRecords(subscription.query, now);
            if (ephemeralRecordsEqual(subscription.last, next)) return;
            subscription.last = next;
            subscription.listener(next);
        });
    };

    const removeRecord = (id: string) => {
        const previous = byId.get(id);
        if (!previous) return false;
        byId.delete(id);
        removeFromIndex(idsByActor, previous.message.actor, id);
        if (previous.message.path) {
            removeFromIndex(exactIdsByPath, pathKey(previous.message.path), id);
            ancestorPathKeys(previous.message.path).forEach((key) => {
                removeFromIndex(descendantIdsByPath, key, id);
            });
        }
        return true;
    };

    const addRecord = (message: EphemeralMessage<unknown>, receivedAt: Date) => {
        removeRecord(message.id);
        const stored: StoredRecord = {
            message,
            receivedAtMs: receivedAt.getTime(),
            receivedAt: receivedAt.toISOString(),
        };
        byId.set(message.id, stored);
        addToIndex(idsByActor, message.actor, message.id);
        if (message.path) {
            addToIndex(exactIdsByPath, pathKey(message.path), message.id);
            ancestorPathKeys(message.path).forEach((key) => {
                addToIndex(descendantIdsByPath, key, message.id);
            });
        }
    };

    const idsForQuery = (query?: EphemeralQuery) => {
        if (query?.path) {
            return new Set(
                query.descendants
                    ? descendantIdsByPath.get(pathKey(query.path))
                    : exactIdsByPath.get(pathKey(query.path)),
            );
        }
        if (query?.actor) return new Set(idsByActor.get(query.actor));
        return new Set(byId.keys());
    };

    return {
        get(query, now) {
            return getStoredRecords(query, now) as EphemeralRecord<any>[];
        },
        subscribe(query, listener) {
            const subscription: Subscription = {
                query,
                listener: listener as (records: EphemeralRecord[]) => void,
                last: getStoredRecords(query),
            };
            subscriptions.add(subscription);
            return () => {
                subscriptions.delete(subscription);
            };
        },
        add(messages, receivedAt = new Date()) {
            let changed = false;
            messages.forEach((message) => {
                if (message.clear) {
                    changed = removeRecord(message.id) || changed;
                    return;
                }
                addRecord(message, receivedAt);
                changed = true;
            });
            if (changed) notify(receivedAt);
        },
        clear(id) {
            if (removeRecord(id)) notify();
        },
        clearActor(actor) {
            const ids = [...(idsByActor.get(actor) ?? [])];
            if (!ids.length) return;
            ids.forEach(removeRecord);
            notify();
        },
        clearAll() {
            if (!byId.size) return;
            byId.clear();
            idsByActor.clear();
            exactIdsByPath.clear();
            descendantIdsByPath.clear();
            notify();
        },
        sweep(now = new Date()) {
            const nowMs = now.getTime();
            [...byId].forEach(([id, record]) => {
                if (!isExpired(record, nowMs)) return;
                removeRecord(id);
            });
            notify(now);
        },
    };
}

function toEphemeralRecord(record: StoredRecord, nowMs: number): EphemeralRecord {
    return {
        message: record.message,
        receivedAt: record.receivedAt,
        state: nowMs - record.receivedAtMs >= staleAfterMs ? 'stale' : 'active',
    };
}

function isExpired(record: StoredRecord, nowMs: number) {
    if (nowMs - record.receivedAtMs >= removeAfterMs) return true;
    if (!record.message.expiresAt) return false;
    return Date.parse(record.message.expiresAt) <= nowMs;
}

function matchesQuery(message: EphemeralMessage<unknown>, query?: EphemeralQuery) {
    if (!query) return true;
    if (query.actor && message.actor !== query.actor) return false;
    if (query.kinds && !query.kinds.includes(message.kind)) return false;
    if (query.path) {
        if (!message.path) return false;
        if (query.descendants) return isDescendantOrSelf(query.path, message.path);
        return samePath(query.path, message.path);
    }
    return true;
}

function addToIndex(index: Map<string, Set<string>>, key: string, id: string) {
    let ids = index.get(key);
    if (!ids) {
        ids = new Set();
        index.set(key, ids);
    }
    ids.add(id);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key);
    if (!ids) return;
    ids.delete(id);
    if (!ids.size) index.delete(key);
}

function ephemeralRecordsEqual(a: EphemeralRecord[], b: EphemeralRecord[]) {
    if (a.length !== b.length) return false;
    return a.every((record, index) => {
        const other = b[index];
        return (
            record.state === other.state &&
            record.receivedAt === other.receivedAt &&
            record.message === other.message
        );
    });
}
