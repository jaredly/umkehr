import {applyMany, cachedState, type Op} from 'umkehr/block-crdt';
import {initialStateWithMeta} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {initialRetainedSelectionSet, type RetainedSelectionSet} from './selectionSet';

export type EditorId = 'left' | 'right';

export type Replica = {
    id: EditorId;
    actor: EditorId;
    state: CachedState<RichBlockMeta>;
    selection: RetainedSelectionSet;
    online: boolean;
    queue: Array<Array<Op<RichBlockMeta>>>;
    clock: number;
};

export type DemoState = {
    left: Replica;
    right: Replica;
};

export type LocalChange = {
    editorId: EditorId;
    state: CachedState<RichBlockMeta>;
    selection: RetainedSelectionSet;
    ops: Array<Op<RichBlockMeta>>;
};

export const createDemoState = (): DemoState => {
    const state = cachedState(initialStateWithMeta('doc', paragraphMeta('00000')));
    return {
        left: createReplica('left', state),
        right: createReplica('right', state),
    };
};

export const nextReplicaTs = (replica: Replica) => {
    replica.clock = Math.max(replica.clock, replica.state.state.maxSeenCount + 1);
    return lamportToString([replica.clock++, replica.actor]);
};

export const makeCommandContext = (replica: Replica) => ({
    actor: replica.actor,
    nextTs: () => nextReplicaTs(replica),
});

export const applyLocalChange = (demo: DemoState, change: LocalChange): DemoState => {
    const source = {...demo[change.editorId], state: change.state, selection: change.selection};
    const peerId = change.editorId === 'left' ? 'right' : 'left';
    let peer = demo[peerId];

    if (change.ops.length) {
        if (source.online && peer.online) {
            peer = applyRemoteOps(peer, change.ops);
        } else {
            source.queue = [...source.queue, change.ops];
        }
    }

    return {...demo, [change.editorId]: source, [peerId]: peer};
};

export const toggleOnline = (demo: DemoState, editorId: EditorId): DemoState => {
    const next = {...demo, [editorId]: {...demo[editorId], online: !demo[editorId].online}};
    return flushQueues(next);
};

export const flushQueues = (demo: DemoState): DemoState => {
    let next = demo;
    for (const id of ['left', 'right'] as const) {
        const peerId = id === 'left' ? 'right' : 'left';
        let source = next[id];
        let peer = next[peerId];
        if (!source.online || !peer.online || source.queue.length === 0) continue;

        for (const ops of source.queue) {
            peer = applyRemoteOps(peer, ops);
        }
        source = {...source, queue: []};
        next = {...next, [id]: source, [peerId]: peer};
    }
    return next;
};

const createReplica = (id: EditorId, state: CachedState<RichBlockMeta>): Replica => ({
    id,
    actor: id,
    state,
    selection: initialRetainedSelectionSet(state),
    online: true,
    queue: [],
    clock: 1,
});

const applyRemoteOps = (replica: Replica, ops: Array<Op<RichBlockMeta>>): Replica => {
    const state = applyMany(replica.state, ops);
    return {...replica, state};
};
