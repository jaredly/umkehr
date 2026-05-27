import {useSyncExternalStore} from 'react';

export type ExternalStore<T> = {
    getSnapshot(): T;
    setSnapshot(next: T): void;
    subscribe(listener: () => void): () => void;
};

export function createExternalStore<T>(initial: T): ExternalStore<T> {
    let snapshot = initial;
    const listeners = new Set<() => void>();

    return {
        getSnapshot() {
            return snapshot;
        },
        setSnapshot(next) {
            if (Object.is(snapshot, next)) return;
            snapshot = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function useStore<T>(store: ExternalStore<T>): T {
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
