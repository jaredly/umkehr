import {
    applyRemoteOps,
    createAdapterState,
    createPlimEditorState,
    selectionToRetained,
    type AdapterState,
    type PlimBlockMeta,
} from './plimBlockCrdtAdapter';
import {createFixtureState} from './fixtures';
import {getBlockAt, type Selection} from '@plim/core';
import {lamportToString, planUndoOps, type CachedState, type HLC, type Lamport, type Op, type RetainedSelection} from 'umkehr/block-crdt';

export type EditorId = 'left' | 'right';

export type Replica = {
    id: EditorId;
    label: string;
    actor: EditorId;
    adapter: AdapterState;
    online: boolean;
    queue: Op<PlimBlockMeta>[][];
    undoStack: UndoEntry[];
    redoStack: UndoEntry[];
    clock: number;
};

export type UndoEntry = {
    before: CachedState<PlimBlockMeta>;
    ops: Op<PlimBlockMeta>[];
    label: string;
    beforeSelection: RetainedSelection | null;
    afterSelection: RetainedSelection | null;
    beforePlimSelection: Selection;
    afterPlimSelection: Selection;
    undoBefore?: CachedState<PlimBlockMeta>;
    undoOps?: Op<PlimBlockMeta>[];
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
        left: createReplica('left', 'Editor A', createAdapterState(initial), 500),
        right: createReplica('right', 'Editor B', createAdapterState(initial), 5000),
    };
};

export const peerId = (id: EditorId): EditorId => (id === 'left' ? 'right' : 'left');

export const nextReplicaTs = (replica: Replica): HLC => {
    replica.clock = Math.max(
        replica.clock,
        replica.adapter.crdt.state.maxSeenCount + 1,
        maxNumericTimestampCounter(replica.adapter.crdt.state) + 1,
    );
    return (replica.clock++).toString().padStart(5, '0') as HLC;
};

export const applyLocalAdapterChange = (
    demo: DemoState,
    id: EditorId,
    adapter: AdapterState,
    ops: Op<PlimBlockMeta>[],
    history?: {
        before: CachedState<PlimBlockMeta>;
        beforeSelection: RetainedSelection | null;
        beforePlimSelection: Selection;
        label: string;
    },
): ApplyChangeResult => {
    let source = {...demo[id], adapter};
    const peerKey = peerId(id);
    let peer = demo[peerKey];
    const messages: string[] = [];

    if (ops.length) {
        if (history) {
            source = {
                ...source,
                undoStack: [
                    ...source.undoStack,
                    {
                        before: history.before,
                        beforeSelection: history.beforeSelection,
                        afterSelection: adapter.retainedSelection,
                        beforePlimSelection: cloneSelection(history.beforePlimSelection),
                        afterPlimSelection: cloneSelection(adapter.plim.selection),
                        ops,
                        label: history.label,
                    },
                ],
                redoStack: [],
            };
        }
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

export const applyUndo = (demo: DemoState, id: EditorId): ApplyChangeResult => {
    const source = demo[id];
    const entry = source.undoStack.at(-1);
    if (!entry) return {demo, messages: [`${id} undo skipped: nothing to undo`]};

    const plan = planUndoOps(entry.before, source.adapter.crdt, entry.ops, {
        actor: source.actor,
        ts: () => nextReplicaTs(source),
    });
    if (!plan.complete) {
        return {
            demo,
            messages: [`${id} undo blocked: ${plan.unsupported[0]?.reason ?? 'unsupported inverse'}`],
        };
    }
    if (!plan.ops.length) return {demo, messages: [`${id} undo skipped: no effect`]};

    const nextAdapter = applyOpsWithSelection(source.adapter, plan.ops, entry.beforeSelection, entry.beforePlimSelection);
    const undoStack = retargetRestoredCharInsertHistory(source.undoStack.slice(0, -1), entry.ops, plan.ops);
    const nextSource: Replica = {
        ...source,
        adapter: nextAdapter,
        undoStack,
        redoStack: [
            ...source.redoStack,
            {...entry, undoBefore: source.adapter.crdt, undoOps: plan.ops},
        ],
    };
    return applySourceOps(demo, id, nextSource, plan.ops, [`${id} undo ${entry.label} -> ${plan.ops.length} ops`]);
};

export const applyRedo = (demo: DemoState, id: EditorId): ApplyChangeResult => {
    const source = demo[id];
    const entry = source.redoStack.at(-1);
    if (!entry) return {demo, messages: [`${id} redo skipped: nothing to redo`]};
    if (!entry.undoBefore || !entry.undoOps) return {demo, messages: [`${id} redo blocked: missing undo batch`]};

    const plan = planUndoOps(entry.undoBefore, source.adapter.crdt, entry.undoOps, {
        actor: source.actor,
        ts: () => nextReplicaTs(source),
    });
    if (!plan.complete) {
        return {
            demo,
            messages: [`${id} redo blocked: ${plan.unsupported[0]?.reason ?? 'unsupported inverse'}`],
        };
    }
    if (!plan.ops.length) return {demo, messages: [`${id} redo skipped: no effect`]};

    const nextAdapter = applyOpsWithSelection(source.adapter, plan.ops, entry.afterSelection, entry.afterPlimSelection);
    const nextSource: Replica = {
        ...source,
        adapter: nextAdapter,
        undoStack: [
            ...source.undoStack,
            {
                before: entry.before,
                beforeSelection: entry.beforeSelection,
                afterSelection: entry.afterSelection,
                beforePlimSelection: cloneSelection(entry.beforePlimSelection),
                afterPlimSelection: cloneSelection(entry.afterPlimSelection),
                ops: entry.ops,
                label: entry.label,
            },
        ],
        redoStack: source.redoStack.slice(0, -1),
    };
    return applySourceOps(demo, id, nextSource, plan.ops, [`${id} redo ${entry.label} -> ${plan.ops.length} ops`]);
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
    clock: number,
): Replica => ({
    id,
    label,
    actor: id,
    adapter,
    online: true,
    queue: [],
    undoStack: [],
    redoStack: [],
    clock,
});

const applySourceOps = (
    demo: DemoState,
    id: EditorId,
    source: Replica,
    ops: Op<PlimBlockMeta>[],
    messages: string[],
): ApplyChangeResult => {
    const peerKey = peerId(id);
    let peer = demo[peerKey];
    let nextSource = source;

    if (nextSource.online && peer.online) {
        const nextPeer = applyRemoteOps(peer.adapter, ops);
        peer = {...peer, adapter: nextPeer};
        messages.push(`${id} sync -> ${peerKey}: applied ${nextPeer.applied.length}, pending ${nextPeer.pending.length}`);
    } else {
        nextSource = {...nextSource, queue: [...nextSource.queue, ops]};
        messages.push(`${id} queued ${ops.length} ops; ${nextSource.queue.length} batch${nextSource.queue.length === 1 ? '' : 'es'} pending`);
    }

    return {
        demo: {...demo, [id]: nextSource, [peerKey]: peer},
        messages,
    };
};

const applyOpsWithSelection = (
    adapter: AdapterState,
    ops: Op<PlimBlockMeta>[],
    retainedSelection: RetainedSelection | null,
    plimSelection: Selection,
): AdapterState => {
    const next = applyRemoteOps(adapter, ops);
    const plim = createPlimEditorState(next.crdt, retainedSelection);
    const validPlimSelection = clampPlimSelection(plim.doc, plimSelection);
    if (validPlimSelection) {
        return {
            crdt: next.crdt,
            plim: {...plim, selection: validPlimSelection},
            retainedSelection:
                selectionToRetained(next.crdt, plim.doc, validPlimSelection) ?? retainedSelection,
        };
    }
    return {
        crdt: next.crdt,
        plim,
        retainedSelection,
    };
};

const cloneSelection = (selection: Selection): Selection => ({
    anchor: {path: [...selection.anchor.path], offset: selection.anchor.offset},
    head: {path: [...selection.head.path], offset: selection.head.offset},
});

const clampPlimSelection = (doc: AdapterState['plim']['doc'], selection: Selection): Selection | null => {
    const anchorBlock = getBlockAt(doc, selection.anchor.path);
    const headBlock = getBlockAt(doc, selection.head.path);
    if (!anchorBlock || !headBlock) return null;
    return {
        anchor: {
            path: [...selection.anchor.path],
            offset: Math.max(0, Math.min(selection.anchor.offset, blockTextLength(anchorBlock))),
        },
        head: {
            path: [...selection.head.path],
            offset: Math.max(0, Math.min(selection.head.offset, blockTextLength(headBlock))),
        },
    };
};

const maxNumericTimestampCounter = (value: unknown): number => {
    if (typeof value === 'string') {
        return /^\d+$/.test(value) ? Number(value) : 0;
    }
    if (Array.isArray(value)) {
        return value.reduce((max, item) => Math.max(max, maxNumericTimestampCounter(item)), 0);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).reduce(
            (max, item) => Math.max(max, maxNumericTimestampCounter(item)),
            0,
        );
    }
    return 0;
};

const blockTextLength = (block: NonNullable<ReturnType<typeof getBlockAt>>): number =>
    block.text?.reduce((sum, span) => sum + span.text.length, 0) ?? 0;

const retargetRestoredCharInsertHistory = (
    undoStack: UndoEntry[],
    undoneOps: Op<PlimBlockMeta>[],
    undoOps: Op<PlimBlockMeta>[],
): UndoEntry[] => {
    const restored = restoredCharIdsByDeletedId(undoneOps, undoOps);
    if (!restored.size) return undoStack;
    return undoStack.map((entry) => {
        let changed = false;
        const ops = entry.ops.map((op) => {
            if (op.type !== 'char') return op;
            const replacement = restored.get(lamportToString(op.char.id));
            if (!replacement) return op;
            changed = true;
            return {...op, char: {...op.char, id: replacement}};
        });
        return changed ? {...entry, ops} : entry;
    });
};

const restoredCharIdsByDeletedId = (
    undoneOps: Op<PlimBlockMeta>[],
    undoOps: Op<PlimBlockMeta>[],
): Map<string, Lamport> => {
    const deleted = undoneOps
        .filter((op): op is Op<PlimBlockMeta> & {type: 'char:delete'} => op.type === 'char:delete')
        .slice()
        .reverse();
    const restored = undoOps.filter((op): op is Op<PlimBlockMeta> & {type: 'char'} => op.type === 'char');
    const result = new Map<string, Lamport>();
    for (let index = 0; index < Math.min(deleted.length, restored.length); index++) {
        result.set(lamportToString(deleted[index].id), restored[index].char.id);
    }
    return result;
};
