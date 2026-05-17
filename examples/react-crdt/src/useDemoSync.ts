import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import type {CrdtUpdate} from 'umkehr/crdt';
import {createDemoTransport, replicas, type DemoTransport, type ReplicaId} from './model';

export type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

type SetTransport = (next: TransportState) => void;
type PublishUpdates = (from: ReplicaId, updates: CrdtUpdate[]) => void;

export function useDemoSync() {
    const publishRef = useRef<PublishUpdates>(() => {});
    const [state, setState] = useState<TransportState>(() => ({
        syncEnabled: true,
        outbox: emptyOutbox(),
    }));
    const stateRef = useRef(state);
    const transports = useMemo(() => createDemoTransports(publishRef), []);

    const setTransport = useCallback(
        (next: TransportState) => setTransportSnapshot(next, stateRef, setState),
        [],
    );

    const deliverUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            deliverTransportUpdates(transports, from, updates);
        },
        [transports],
    );

    const publishUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            broadcastTransportUpdates(stateRef.current, setTransport, deliverUpdates, from, updates);
        },
        [deliverUpdates, setTransport],
    );

    const toggleSync = useCallback(() => {
        toggleTransportSync(stateRef.current, setTransport, deliverUpdates);
    }, [deliverUpdates, setTransport]);

    publishRef.current = publishUpdates;

    return useMemo(
        () => ({
            state,
            transports,
            toggleSync,
        }),
        [state, transports, toggleSync],
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

function setTransportSnapshot(
    next: TransportState,
    ref: MutableRefObject<TransportState>,
    setState: Dispatch<SetStateAction<TransportState>>,
) {
    ref.current = next;
    setState(next);
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
