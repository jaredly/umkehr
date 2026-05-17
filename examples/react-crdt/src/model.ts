import typia from 'typia';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createSyncedContext, type SyncedTransport} from 'umkehr/react-crdt';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type State = {
    todos: Todo[];
};

export type ReplicaId = string;
export type GridSlot = 'left' | 'right';
export type QueueCount = {label: string; count: number};
export type DemoTransport = SyncedTransport & {
    receive(update: CrdtUpdate): void;
};

export const replicas = [
    {id: 'replica-a', title: 'Replica A', label: 'A'},
    {id: 'replica-b', title: 'Replica B', label: 'B'},
] as const;

export const schema = typia.json.schemas<[State], '3.1'>();
export const [ProvideTodos, useTodos] = createSyncedContext<State>('type');

export const initialState: State = {
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Try CRDT sync', done: false},
    ],
};

export const initialTimestamp = hlc.pack(hlc.init('seed', 0));

export function createInitialHistory(): CrdtLocalHistory<State> {
    return createCrdtLocalHistory(
        createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
    );
}

export function createDemoTransport(
    actor: ReplicaId,
    publish: (from: ReplicaId, updates: CrdtUpdate[]) => void,
): DemoTransport {
    let clock = hlc.init(actor, Date.now());
    const listeners = new Set<(update: CrdtUpdate) => void>();

    return {
        actor,
        tick() {
            clock = hlc.inc(clock, Date.now());
            return clock;
        },
        publish(updates) {
            publish(actor, updates);
        },
        subscribe(receive) {
            listeners.add(receive);
            return () => {
                listeners.delete(receive);
            };
        },
        receive(update) {
            const ts = latestUpdateTimestamp(update);
            if (ts) clock = hlc.recv(clock, hlc.unpack(ts), Date.now());
            for (const listener of listeners) listener(update);
        },
    };
}

function latestUpdateTimestamp(update: CrdtUpdate) {
    if (update.op === 'set' || update.op === 'delete') return update.ts;

    let latest: string | undefined;
    for (const order of Object.values(update.orders)) {
        if (!latest || comparePackedHlc(order.ts, latest) > 0) latest = order.ts;
    }
    return latest;
}

function comparePackedHlc(a: string, b: string) {
    const left = hlc.unpack(a);
    const right = hlc.unpack(b);
    if (left.ts !== right.ts) return left.ts > right.ts ? 1 : -1;
    if (left.count !== right.count) return left.count > right.count ? 1 : -1;
    return left.node.localeCompare(right.node);
}
