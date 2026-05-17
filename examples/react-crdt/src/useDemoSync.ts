import {useCallback, useMemo, useRef, type MutableRefObject} from 'react';
import type {CrdtUpdate} from 'umkehr/crdt';
import {createDemoTransport, replicas, type DemoTransport, type ReplicaId} from './model';
import {createExternalStore, type ExternalStore} from './store';

export type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

type SetTransport = (next: TransportState) => void;
type PublishUpdates = (from: ReplicaId, updates: CrdtUpdate[]) => void;

export type DemoSync = {
    stateStore: ExternalStore<TransportState>;
    transports: Record<ReplicaId, DemoTransport>;
    toggleSync(): void;
};

export function useDemoSync() {
    const publishRef = useRef<PublishUpdates>(() => {});
    const stateStore = useMemo(
        () => createExternalStore<TransportState>({syncEnabled: true, outbox: emptyOutbox()}),
        [],
    );
    const transports = useMemo(() => createDemoTransports(publishRef), []);

    const setTransport = useCallback(
        (next: TransportState) => stateStore.setSnapshot(next),
        [stateStore],
    );

    const deliverUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            deliverTransportUpdates(transports, from, updates);
        },
        [transports],
    );

    const publishUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            broadcastTransportUpdates(
                stateStore.getSnapshot(),
                setTransport,
                deliverUpdates,
                from,
                updates,
            );
        },
        [deliverUpdates, setTransport, stateStore],
    );

    const toggleSync = useCallback(() => {
        toggleTransportSync(stateStore.getSnapshot(), setTransport, deliverUpdates);
    }, [deliverUpdates, setTransport, stateStore]);

    publishRef.current = publishUpdates;

    return useMemo(
        (): DemoSync => ({
            stateStore,
            transports,
            toggleSync,
        }),
        [stateStore, transports, toggleSync],
    );
}

function createDemoTransports(ref: MutableRefObject<PublishUpdates>) {
    return Object.fromEntries(
        replicas.map((replica) => [
            replica.id,
            createDemoTransport(replica.id, (from, updates) => ref.current(from, updates)),
        ]),
    ) as Record<ReplicaId, DemoTransport>;
}

function emptyOutbox(): Record<ReplicaId, CrdtUpdate[]> {
    return Object.fromEntries(replicas.map((replica) => [replica.id, []]));
}

function deliverTransportUpdates(
    transports: Record<ReplicaId, DemoTransport>,
    from: ReplicaId,
    updates: CrdtUpdate[],
) {
    for (const replica of replicas) {
        if (replica.id === from) continue;
        const transport = transports[replica.id];
        for (const update of updates) transport.receive(update);
    }
}

function broadcastTransportUpdates(
    current: TransportState,
    setTransport: SetTransport,
    deliverUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
    from: ReplicaId,
    updates: CrdtUpdate[],
) {
    if (!updates.length) return;
    if (current.syncEnabled) {
        deliverUpdates(from, updates);
        return;
    }
    setTransport({
        ...current,
        outbox: {
            ...current.outbox,
            [from]: [...(current.outbox[from] ?? []), ...updates],
        },
    });
}

function toggleTransportSync(
    current: TransportState,
    setTransport: SetTransport,
    deliverUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
) {
    if (current.syncEnabled) {
        setTransport({...current, syncEnabled: false});
        return;
    }

    const queued = current.outbox;
    setTransport({syncEnabled: true, outbox: emptyOutbox()});
    for (const replica of replicas) deliverUpdates(replica.id, queued[replica.id] ?? []);
}
