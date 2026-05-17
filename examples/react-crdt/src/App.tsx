import {
    useCallback,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import type {CrdtUpdate} from 'umkehr/crdt';
import {SyncControls} from './SyncControls';
import {TodoPanel} from './TodoPanel';
import {
    ProvideTodos,
    createDemoTransport,
    createInitialHistory,
    replicas,
    type DemoTransport,
    type ReplicaId,
} from './model';
import './style.css';

type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

type SetTransport = (next: TransportState) => void;
type PublishUpdates = (from: ReplicaId, updates: CrdtUpdate[]) => void;

export function App() {
    const publishRef = useRef<PublishUpdates>(() => {});
    const transports = useRef<Record<ReplicaId, DemoTransport>>(createDemoTransports(publishRef));
    const initialHistory = useRef(createInitialHistory());
    const [transport, setTransportState] = useState<TransportState>(() => ({
        syncEnabled: true,
        outbox: emptyOutbox(),
    }));
    const transportRef = useRef(transport);

    const setTransport = useCallback(
        (next: TransportState) => setTransportSnapshot(next, transportRef, setTransportState),
        [],
    );

    const deliverUpdates = useCallback((from: ReplicaId, updates: CrdtUpdate[]) => {
        deliverTransportUpdates(transports.current, from, updates);
    }, []);

    const broadcastUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            broadcastTransportUpdates(
                transportRef.current,
                setTransport,
                deliverUpdates,
                from,
                updates,
            );
        },
        [deliverUpdates, setTransport],
    );

    const toggleSync = useCallback(() => {
        toggleTransportSync(transportRef.current, setTransport, deliverUpdates);
    }, [deliverUpdates, setTransport]);

    publishRef.current = broadcastUpdates;

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <ProvideTodos
                    key={replica.id}
                    initial={initialHistory.current}
                    transport={transports.current[replica.id]}
                >
                    <TodoPanel
                        replicaId={replica.id}
                        title={replica.title}
                        queued={transport.outbox[replica.id]?.length ?? 0}
                        gridSlot={index === 0 ? 'left' : 'right'}
                    />
                </ProvideTodos>
            ))}
            <SyncControls
                syncEnabled={transport.syncEnabled}
                queueCounts={replicas.map((replica) => ({
                    label: replica.label,
                    count: transport.outbox[replica.id]?.length ?? 0,
                }))}
                toggleSync={toggleSync}
            />
        </main>
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
