import {hlc, latestCrdtUpdateTimestamp, type CrdtUpdate} from 'umkehr/crdt';
import type {EphemeralMessage, SyncedTransport} from 'umkehr/react-crdt';

export type ReplicaId = string;
export type QueueCount = {label: string; count: number};
export type DemoTransport = SyncedTransport & {
    receive(update: CrdtUpdate): void;
    receiveEphemeral<Data>(message: EphemeralMessage<Data>): void;
};

export const replicas = [
    {id: 'replica-a', title: 'Replica A', label: 'A'},
    {id: 'replica-b', title: 'Replica B', label: 'B'},
] as const;

export function createDemoTransport(
    actor: ReplicaId,
    publish: (from: ReplicaId, updates: CrdtUpdate[]) => void,
    publishEphemeral: (from: ReplicaId, messages: EphemeralMessage<unknown>[]) => void,
): DemoTransport {
    let clock = hlc.init(actor, Date.now());
    const listeners = new Set<(update: CrdtUpdate) => void>();
    const ephemeralListeners = new Set<(message: EphemeralMessage<unknown>) => void>();

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
        publishEphemeral<Data>(messages: EphemeralMessage<Data>[]) {
            publishEphemeral(actor, messages);
        },
        subscribeEphemeral<Data>(receive: (message: EphemeralMessage<Data>) => void) {
            const listener = receive as (message: EphemeralMessage<unknown>) => void;
            ephemeralListeners.add(listener);
            return () => {
                ephemeralListeners.delete(listener);
            };
        },
        receive(update) {
            const ts = latestCrdtUpdateTimestamp(update);
            if (ts) clock = hlc.recv(clock, hlc.unpack(ts), Date.now());
            for (const listener of listeners) listener(update);
        },
        receiveEphemeral(message) {
            for (const listener of ephemeralListeners) listener(message);
        },
    };
}
