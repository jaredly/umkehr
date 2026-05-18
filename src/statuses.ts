import type {Path, PathSegment} from './types.js';

export type Status = {
    id: string;
    path: Path;
    kind: string;
    message?: string;
    data?: unknown;
};

export type StatusQuery = {
    descendants?: boolean;
    kinds?: readonly string[];
};

export type StatusStore = {
    get(path: Path, query?: StatusQuery): Status[];
    subscribe(
        path: Path,
        query: StatusQuery | undefined,
        listener: (statuses: Status[]) => void,
    ): () => void;
    add(statuses: Status[]): void;
    clear(id: string): void;
    clearAll(): void;
};

type Subscription = {
    path: Path;
    key: string;
    query?: StatusQuery;
    listener: (statuses: Status[]) => void;
    last: Status[];
};

export function createStatusStore(): StatusStore {
    const byId = new Map<string, Status>();
    const exactIdsByPath = new Map<string, Set<string>>();
    const descendantIdsByPath = new Map<string, Set<string>>();
    const exactSubscriptions = new Map<string, Set<Subscription>>();
    const descendantSubscriptions = new Map<string, Set<Subscription>>();

    const get = (path: Path, query?: StatusQuery) => {
        const ids = query?.descendants
            ? descendantIdsByPath.get(pathKey(path))
            : exactIdsByPath.get(pathKey(path));
        if (!ids) return [];

        const kinds = query?.kinds ? new Set(query.kinds) : undefined;
        const statuses: Status[] = [];
        ids.forEach((id) => {
            const status = byId.get(id);
            if (!status) return;
            if (kinds && !kinds.has(status.kind)) return;
            statuses.push(status);
        });
        return statuses;
    };

    const notify = (paths: Path[]) => {
        if (!paths.length) return;
        const subscriptions = new Set<Subscription>();
        paths.forEach((path) => {
            exactSubscriptions.get(pathKey(path))?.forEach((subscription) => {
                subscriptions.add(subscription);
            });
            ancestorPathKeys(path).forEach((key) => {
                descendantSubscriptions.get(key)?.forEach((subscription) => {
                    subscriptions.add(subscription);
                });
            });
        });

        subscriptions.forEach((subscription) => {
            const next = get(subscription.path, subscription.query);
            if (statusListsEqual(subscription.last, next)) return;
            subscription.last = next;
            subscription.listener(next);
        });
    };

    const addStatusToIndexes = (status: Status) => {
        addToPathIndex(exactIdsByPath, pathKey(status.path), status.id);
        ancestorPathKeys(status.path).forEach((key) => {
            addToPathIndex(descendantIdsByPath, key, status.id);
        });
    };

    const removeStatusFromIndexes = (status: Status) => {
        removeFromPathIndex(exactIdsByPath, pathKey(status.path), status.id);
        ancestorPathKeys(status.path).forEach((key) => {
            removeFromPathIndex(descendantIdsByPath, key, status.id);
        });
    };

    return {
        get,
        subscribe(path, query, listener) {
            const subscription: Subscription = {
                path,
                key: pathKey(path),
                query,
                listener,
                last: get(path, query),
            };
            const subscriptions = query?.descendants ? descendantSubscriptions : exactSubscriptions;
            addToSubscriptionIndex(subscriptions, subscription.key, subscription);
            return () => {
                removeFromSubscriptionIndex(subscriptions, subscription.key, subscription);
            };
        },
        add(statuses) {
            if (!statuses.length) return;
            const affected: Record<string, Path> = {};
            statuses.forEach((status) => {
                const previous = byId.get(status.id);
                if (previous) {
                    removeStatusFromIndexes(previous);
                    affected[pathKey(previous.path)] = previous.path;
                }
                byId.set(status.id, status);
                addStatusToIndexes(status);
                affected[pathKey(status.path)] = status.path;
            });
            notify(Object.values(affected));
        },
        clear(id) {
            const previous = byId.get(id);
            if (!previous) return;
            byId.delete(id);
            removeStatusFromIndexes(previous);
            notify([previous.path]);
        },
        clearAll() {
            if (!byId.size) return;
            const affected: Record<string, Path> = {};
            byId.forEach((status) => {
                affected[pathKey(status.path)] = status.path;
            });
            byId.clear();
            exactIdsByPath.clear();
            descendantIdsByPath.clear();
            notify(Object.values(affected));
        },
    };
}

export function pathKey(path: Path) {
    return JSON.stringify(path);
}

export function ancestorPathKeys(path: Path) {
    const keys: string[] = [];
    for (let i = 0; i <= path.length; i++) {
        keys.push(pathKey(path.slice(0, i)));
    }
    return keys;
}

export function samePath(a: Path, b: Path) {
    if (a.length !== b.length) return false;
    return a.every((segment, index) => sameSegment(segment, b[index]));
}

export function isDescendantOrSelf(path: Path, candidate: Path) {
    if (candidate.length < path.length) return false;
    return path.every((segment, index) => sameSegment(segment, candidate[index]));
}

export function statusMatchesQuery(status: Status, path: Path, query?: StatusQuery) {
    if (query?.descendants) {
        if (!isDescendantOrSelf(path, status.path)) return false;
    } else if (!samePath(path, status.path)) {
        return false;
    }
    return !query?.kinds || query.kinds.includes(status.kind);
}

function sameSegment(a: PathSegment, b: PathSegment | undefined) {
    if (!b || a.type !== b.type) return false;
    if (a.type === 'key') return b.type === 'key' && a.key === b.key;
    return b.type === 'tag' && a.key === b.key && a.value === b.value;
}

function addToPathIndex(index: Map<string, Set<string>>, key: string, id: string) {
    let ids = index.get(key);
    if (!ids) {
        ids = new Set();
        index.set(key, ids);
    }
    ids.add(id);
}

function removeFromPathIndex(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key);
    if (!ids) return;
    ids.delete(id);
    if (!ids.size) index.delete(key);
}

function addToSubscriptionIndex(
    index: Map<string, Set<Subscription>>,
    key: string,
    subscription: Subscription,
) {
    let subscriptions = index.get(key);
    if (!subscriptions) {
        subscriptions = new Set();
        index.set(key, subscriptions);
    }
    subscriptions.add(subscription);
}

function removeFromSubscriptionIndex(
    index: Map<string, Set<Subscription>>,
    key: string,
    subscription: Subscription,
) {
    const subscriptions = index.get(key);
    if (!subscriptions) return;
    subscriptions.delete(subscription);
    if (!subscriptions.size) index.delete(key);
}

function statusListsEqual(a: Status[], b: Status[]) {
    if (a.length !== b.length) return false;
    return a.every((status, index) => statusEqual(status, b[index]));
}

function statusEqual(a: Status, b: Status | undefined) {
    return (
        !!b &&
        a.id === b.id &&
        a.kind === b.kind &&
        a.message === b.message &&
        Object.is(a.data, b.data) &&
        samePath(a.path, b.path)
    );
}
