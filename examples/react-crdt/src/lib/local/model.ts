import {
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtUpdate,
} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';

export type ReplicaId = string;
export type QueueCount = {label: string; count: number};
export type DemoTransport = SyncedTransport & {
    receive(update: CrdtUpdate): void;
};

export const replicas = [
    {id: 'replica-a', title: 'Replica A', label: 'A'},
    {id: 'replica-b', title: 'Replica B', label: 'B'},
] as const;

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
            const ts = latestCrdtUpdateTimestamp(update);
            if (ts) clock = hlc.recv(clock, hlc.unpack(ts), Date.now());
            for (const listener of listeners) listener(update);
        },
    };
}
