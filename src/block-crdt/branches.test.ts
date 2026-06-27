import {describe, expect, it} from 'vitest';
import {materializeBranch, type BranchEvent, type PersistedBranch} from '../branches/index';
import {cachedState, insertTextOps, visibleTextForBlock} from './index';
import {
    blockCrdtUpdateEvent,
    appendBlockBranchCommand,
    createBlockCrdtBranchAdapter,
    createBlockBranchHistory,
    createBlockCrdtUpdate,
    redoBlockBranchCommand,
    undoBlockBranchCommand,
    validateBlockCrdtUpdate,
    type BlockCrdtUpdate,
} from './branches';
import {lamportToString} from './ids';
import {initialState} from './initialState';
import type {CachedState, DefaultBlockMeta} from './types';

type History = CachedState<DefaultBlockMeta>;
type Update = BlockCrdtUpdate<DefaultBlockMeta>;

const rootBlock = [0, 'doc'] as const;

describe('block CRDT branch adapter', () => {
    it('materializes branch command batches and merge events', () => {
        const initial = cachedState(initialState('doc', 't0'));
        const adapter = createBlockCrdtBranchAdapter({
            createInitialHistory: () => initial,
        });

        const mainA = textBatch(initial, {
            eventId: 'main-a',
            actor: 'main',
            offset: 0,
            text: 'a',
            ts: 't1',
        });
        const afterMainA = materializeBranch({
            adapter,
            branches: {main: branch('main', [event('main', 1, mainA)])},
            branchId: 'main',
        });
        const mainB = textBatch(afterMainA, {
            eventId: 'main-b',
            actor: 'main',
            offset: 1,
            text: 'b',
            ts: 't2',
        });
        const featureX = textBatch(afterMainA, {
            eventId: 'feature-x',
            actor: 'feature',
            offset: 1,
            text: 'x',
            ts: 't3',
        });
        const branches = {
            main: branch('main', [
                event('main', 1, mainA),
                event('main', 2, mainB),
                merge('main', 3, 'feature', 1),
            ]),
            feature: branch('feature', [event('feature', 1, featureX)], {
                sourceBranchId: 'main',
                forkEventIndex: 1,
            }),
        };

        const feature = materializeBranch({adapter, branches, branchId: 'feature'});
        const merged = materializeBranch({adapter, branches, branchId: 'main'});

        expect(visibleTextForBlock(feature, blockId())).toBe('ax');
        expect([...visibleTextForBlock(merged, blockId())].sort().join('')).toBe('abx');
    });

    it('keeps command batches atomic as branch update events', () => {
        const initial = cachedState(initialState('doc', 't0'));
        const update = textBatch(initial, {
            eventId: 'typing-abc',
            actor: 'main',
            offset: 0,
            text: 'abc',
            ts: 't1',
        });

        expect(update.ops).toHaveLength(3);
        expect(blockCrdtUpdateEvent({branchId: 'main', eventIndex: 1, ...update})).toMatchObject({
            kind: 'update',
            branchId: 'main',
            eventIndex: 1,
            eventId: 'typing-abc',
            update,
        });
    });

    it('validates block update payloads', () => {
        const initial = cachedState(initialState('doc', 't0'));
        const valid = textBatch(initial, {
            eventId: 'valid',
            actor: 'main',
            offset: 0,
            text: 'a',
            ts: 't1',
        });

        expect(validateBlockCrdtUpdate(valid)).toEqual({valid: true});
        expect(validateBlockCrdtUpdate({eventId: '', ops: valid.ops}).valid).toBe(false);
        expect(validateBlockCrdtUpdate({eventId: 'bad', ops: [{type: 'block'}]}).valid).toBe(
            false,
        );
    });

    it('appends undo and redo as forward command batches', () => {
        const initial = cachedState(initialState('doc', 't0'));
        let history = createBlockBranchHistory(initial);
        const insert = textBatch(initial, {
            eventId: 'insert-a',
            actor: 'alice',
            offset: 0,
            text: 'a',
            ts: 't1',
        });
        history = appendBlockBranchCommand({history, update: insert, actor: 'alice'});

        const undone = undoBlockBranchCommand({
            history,
            actor: 'alice',
            eventId: 'undo-a',
            ts: sequenceTs(10),
        });
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(visibleTextForBlock(undone.history.state, blockId())).toBe('');
        expect(undone.history.undoStack).toEqual([]);
        expect(undone.history.redoStack).toEqual(['insert-a']);

        const redone = redoBlockBranchCommand({
            history: undone.history,
            actor: 'alice',
            eventId: 'redo-a',
            ts: sequenceTs(20),
        });
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(visibleTextForBlock(redone.history.state, blockId())).toBe('a');
        expect(redone.history.undoStack).toEqual(['insert-a']);
        expect(redone.history.redoStack).toEqual([]);
    });

    it('keeps undo stacks local to the actor', () => {
        const initial = cachedState(initialState('doc', 't0'));
        let history = createBlockBranchHistory(initial);
        const alice = textBatch(initial, {
            eventId: 'alice-a',
            actor: 'alice',
            offset: 0,
            text: 'a',
            ts: 't1',
        });
        history = appendBlockBranchCommand({history, update: alice, actor: 'alice'});
        const bob = textBatch(history.state, {
            eventId: 'bob-b',
            actor: 'bob',
            offset: 1,
            text: 'b',
            ts: 't2',
        });
        history = appendBlockBranchCommand({history, update: bob, actor: 'bob'});

        const undone = undoBlockBranchCommand({
            history,
            actor: 'alice',
            eventId: 'undo-alice-a',
            ts: sequenceTs(10),
        });

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(visibleTextForBlock(undone.history.state, blockId())).toBe('b');
    });
});

function textBatch(
    state: History,
    {
        eventId,
        actor,
        offset,
        text,
        ts,
    }: {
        eventId: string;
        actor: string;
        offset: number;
        text: string;
        ts: string;
    },
): Update {
    return createBlockCrdtUpdate(
        eventId,
        insertTextOps(state, {
            actor,
            block: [...rootBlock],
            offset,
            text,
            ts: () => ts,
        }),
    );
}

function branch(
    branchId: string,
    events: BranchEvent<Update>[],
    options: Partial<PersistedBranch<History, Update>> = {},
): PersistedBranch<History, Update> {
    return {
        branchId,
        history: cachedState(initialState('doc', 't0')),
        lastSeenEventIndex: 0,
        events,
        ...options,
    };
}

function event(branchId: string, eventIndex: number, update: Update): BranchEvent<Update> {
    return {
        kind: 'update',
        branchId,
        eventIndex,
        eventId: update.eventId,
        update,
    };
}

function merge(
    branchId: string,
    eventIndex: number,
    sourceBranchId: string,
    sourceThroughEventIndex: number,
): BranchEvent<Update> {
    return {
        kind: 'merge',
        branchId,
        eventIndex,
        mergeId: `${branchId}-${eventIndex}`,
        sourceBranchId,
        sourceThroughEventIndex,
    };
}

function blockId() {
    return lamportToString([...rootBlock]);
}

function sequenceTs(start: number) {
    let index = start;
    return () => (index++).toString().padStart(5, '0');
}
