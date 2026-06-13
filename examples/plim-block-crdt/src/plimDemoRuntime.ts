import {applyRemoteOps, createAdapterState, type AdapterState, type PlimBlockMeta} from './plimBlockCrdtAdapter';
import {createFixtureState, makeTs} from './fixtures';
import type {HLC, Op} from 'umkehr/block-crdt';

export type EditorId = 'left' | 'right';

export type Replica = {
    id: EditorId;
    label: string;
    actor: EditorId;
    adapter: AdapterState;
    online: boolean;
    queue: Op<PlimBlockMeta>[][];
    ts: () => HLC;
};

export type DemoState = {
    left: Replica;
    right: Replica;
};

export type ApplyChangeResult = {
    demo: DemoState;
    messages: string[];
};

export const createDemoState = (): DemoState => {
    const initial = createFixtureState();
    return {
        left: createReplica('left', 'Editor A', createAdapterState(initial), makeTs(500)),
        right: createReplica('right', 'Editor B', createAdapterState(initial), makeTs(5000)),
    };
};

export const peerId = (id: EditorId): EditorId => (id === 'left' ? 'right' : 'left');

export const applyLocalAdapterChange = (
    demo: DemoState,
    id: EditorId,
    adapter: AdapterState,
    ops: Op<PlimBlockMeta>[],
): ApplyChangeResult => {
    const source = {...demo[id], adapter};
    const peerKey = peerId(id);
    let peer = demo[peerKey];
    const messages: string[] = [];

    if (ops.length) {
        if (source.online && peer.online) {
            const nextPeer = applyRemoteOps(peer.adapter, ops);
            peer = {...peer, adapter: nextPeer};
            messages.push(`${id} sync -> ${peerKey}: applied ${nextPeer.applied.length}, pending ${nextPeer.pending.length}`);
        } else {
            source.queue = [...source.queue, ops];
            messages.push(`${id} queued ${ops.length} ops; ${source.queue.length} batch${source.queue.length === 1 ? '' : 'es'} pending`);
        }
    }

    return {
        demo: {...demo, [id]: source, [peerKey]: peer},
        messages,
    };
};

export const toggleReplicaOnline = (demo: DemoState, id: EditorId): ApplyChangeResult => {
    const replica = demo[id];
    const next = {...demo, [id]: {...replica, online: !replica.online}};
    const status = next[id].online ? 'online' : 'offline';
    const flushed = flushQueues(next);
    return {
        demo: flushed.demo,
        messages: [`${id} is ${status}`, ...flushed.messages],
    };
};

export const flushQueues = (demo: DemoState): ApplyChangeResult => {
    let next = demo;
    const messages: string[] = [];

    for (const id of ['left', 'right'] as const) {
        const peerKey = peerId(id);
        let source = next[id];
        let peer = next[peerKey];
        if (!source.online || !peer.online || source.queue.length === 0) continue;

        let applied = 0;
        let pending = 0;
        for (const ops of source.queue) {
            const result = applyRemoteOps(peer.adapter, ops);
            peer = {...peer, adapter: result};
            applied += result.applied.length;
            pending += result.pending.length;
        }
        messages.push(`${id} flushed ${source.queue.length} batch${source.queue.length === 1 ? '' : 'es'} -> ${peerKey}: applied ${applied}, pending ${pending}`);
        source = {...source, queue: []};
        next = {...next, [id]: source, [peerKey]: peer};
    }

    return {demo: next, messages};
};

const createReplica = (
    id: EditorId,
    label: string,
    adapter: AdapterState,
    ts: () => HLC,
): Replica => ({
    id,
    label,
    actor: id,
    adapter,
    online: true,
    queue: [],
    ts,
});
