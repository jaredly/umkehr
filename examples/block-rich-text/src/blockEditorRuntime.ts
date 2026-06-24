import {applyMany, cachedState, type Op} from 'umkehr/block-crdt';
import {initialStateWithMeta} from 'umkehr/block-crdt/initialState';
import type {
    BlockOrderTs,
    CachedState,
    CharParentTs,
    HLC,
    State,
} from 'umkehr/block-crdt/types';
import * as hlc from '../../../src/crdt/hlc';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {annotationVirtualParents} from './annotations';
import {initialRetainedSelectionSet, type RetainedSelectionSet} from './selectionSet';
import {applyCharInsertOps} from './localTextOps';
import {importDocument, type ImportDocument} from './documentFormat';

export type EditorId = 'left' | 'right';

export type Replica = {
    id: EditorId;
    actor: EditorId;
    state: CachedState<RichBlockMeta>;
    selection: RetainedSelectionSet;
    online: boolean;
    queue: Array<Array<Op<RichBlockMeta>>>;
    clock: hlc.HLC;
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
    const state = cachedState(initialStateWithMeta('doc', paragraphMeta(initialTimestamp('doc'))));
    return {
        left: createReplica('left', state),
        right: createReplica('right', state),
    };
};

export const createDemoStateFromDocument = (document: ImportDocument): DemoState => {
    let i = 1;
    const imported = importDocument(document, {
        actor: 'fixture',
        nextTs: () => hlc.pack({ts: 1, count: i++, node: 'fixture'}),
    });
    return {
        left: createReplica('left', imported.state),
        right: createReplica('right', imported.state),
    };
};

export const nextReplicaTs = (replica: Replica) => {
    replica.clock = hlc.inc(clockAfterReceivingState(replica), 0);
    return hlc.pack(replica.clock);
};

export const previewReplicaTs = (replica: Replica) => {
    let clock = clockAfterReceivingState(replica);
    return () => {
        clock = hlc.inc(clock, 0);
        return hlc.pack(clock);
    };
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
    clock: hlc.init(id, 0),
});

const applyRemoteOps = (replica: Replica, ops: Array<Op<RichBlockMeta>>): Replica => {
    const state = applyCharInsertOps(replica.state, ops) ?? applyMany(replica.state, ops, annotationVirtualParents(replica.state));
    return {...replica, state};
};

const initialTimestamp = (node: string) => hlc.pack(hlc.init(node, 0));

const clockAfterReceivingState = (replica: Replica): hlc.HLC => {
    let clock = replica.clock;
    for (const timestamp of stateTimestamps(replica.state.state)) {
        const remote = hlc.tryUnpack(timestamp);
        if (remote) clock = hlc.recv(clock, remote, 0);
    }
    return clock;
};

const stateTimestamps = (state: State<RichBlockMeta>): HLC[] => {
    const timestamps: HLC[] = [];
    for (const block of Object.values(state.blocks)) {
        timestamps.push(block.meta.ts, ...blockOrderTimestamps(block.order.ts));
    }
    for (const char of Object.values(state.chars)) {
        timestamps.push(...charParentTimestamps(char.parent.ts));
    }
    for (const join of Object.values(state.joins)) {
        timestamps.push(join.ts);
    }
    return timestamps;
};

const blockOrderTimestamps = (ts: BlockOrderTs): HLC[] =>
    typeof ts === 'string' ? [ts] : [ts[0], ts[2]];

const charParentTimestamps = (ts: CharParentTs): HLC[] =>
    typeof ts === 'string' ? [ts] : [ts[0], ts[2]];
