import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {createPatchBuilder} from '../helper';
import {
    applyCrdtUpdate,
    applyLocalCommand,
    applyRemoteUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    createCrdtDocument,
    createCrdtLocalHistory,
    createCrdtUpdates,
    hlc,
    redoLocalCommand,
    undoLocalCommand,
    type CrdtLocalHistory,
} from './index';

type Todo = {id: string; title: string; done: boolean};
type State = {
    title: string;
    todos: Todo[];
    items: Record<string, {title: string}>;
};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                        },
                    },
                },
                items: {
                    type: 'object',
                    additionalProperties: {
                        type: 'object',
                        properties: {
                            title: {type: 'string'},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const initial: State = {
    title: 'Draft',
    todos: [
        {id: 'one', title: 'One', done: false},
        {id: 'two', title: 'Two', done: false},
    ],
    items: {one: {title: 'One'}},
};

const $ = createPatchBuilder<State>();
const startTs = hlc.pack(hlc.init('seed', 1_000_000));

const blank = () =>
    createCrdtLocalHistory(createCrdtDocument(initial, schema, {timestamp: startTs}));

const clock = (node = 'local') => hlc.init(node, 2_000_000);

const updateTs = (update: ReturnType<typeof createCrdtUpdates<State>>[number]) => {
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders)
        .map(({ts}) => ts)
        .sort()
        .at(-1)!;
};

const afterUpdate = (
    update: ReturnType<typeof createCrdtUpdates<State>>[number],
    node = 'remote',
) => {
    const unpacked = hlc.unpack(updateTs(update));
    return hlc.pack({...unpacked, count: unpacked.count + 100, node});
};

const apply = (
    history: CrdtLocalHistory<State>,
    draft: Parameters<typeof applyLocalCommand<State>>[1],
    currentClock = clock(),
) => applyLocalCommand(history, draft, currentClock);

describe('crdt local history', () => {
    it('undoes and redoes a local primitive set with fresh CRDT updates', () => {
        const applied = apply(blank(), $.title('Published'));

        expect(applied.history.doc.state.title).toBe('Published');
        expect(applied.updates).toHaveLength(1);

        const undone = undoLocalCommand(applied.history, applied.clock);

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.title).toBe('Draft');
        expect(undone.updates).toHaveLength(1);
        expect(undone.updates[0]).toMatchObject({op: 'set', value: 'Draft'});
        expect(undone.updates[0].op === 'set' ? undone.updates[0].ts : '').not.toBe(
            applied.updates[0].op === 'set' ? applied.updates[0].ts : '',
        );

        const redone = redoLocalCommand(undone.history, undone.clock);

        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(redone.history.doc.state.title).toBe('Published');
        expect(redone.updates[0]).toMatchObject({op: 'set', value: 'Published'});
        expect(canUndoLocalCommand(redone.history)).toBe(true);

        const undoneAgain = undoLocalCommand(redone.history, redone.clock);

        expect(undoneAgain.ok).toBe(true);
        if (!undoneAgain.ok) return;
        expect(undoneAgain.history.doc.state.title).toBe('Draft');
    });

    it('blocks undo when a newer remote update superseded the local set', () => {
        const applied = apply(blank(), $.title('Local'), clock('local'));
        expect(canUndoLocalCommand(applied.history)).toBe(true);
        const remoteUpdate = createCrdtUpdates(
            applied.history.doc,
            {
                op: 'replace',
                path: [{type: 'key', key: 'title'}],
                previous: 'Local',
                value: 'Remote',
            },
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, remoteUpdate, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(false);
        expect(undone.reason).toBe('blocked');
        expect(canUndoLocalCommand(remote.history)).toBe(false);
        expect(undone.history.doc.state.title).toBe('Remote');
    });

    it('keeps remote updates out of local history and does not clear redo', () => {
        const applied = apply(blank(), $.title('Local'));
        const undone = undoLocalCommand(applied.history, applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;

        const remoteUpdate = createCrdtUpdates(
            undone.history.doc,
            {
                op: 'replace',
                path: [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 0},
                    {type: 'key', key: 'done'},
                ],
                previous: false,
                value: true,
            },
            hlc.pack({ts: 2_000_001, count: 0, node: 'remote'}),
        )[0];
        const remote = applyRemoteUpdate(undone.history, remoteUpdate, undone.clock);

        expect(remote.history.undoStack).toHaveLength(0);
        expect(remote.history.redoStack).toHaveLength(1);
        expect(remote.history.doc.state.todos[0].done).toBe(true);
    });

    it('clears redo after a new local command', () => {
        const applied = apply(blank(), $.title('Local'));
        const undone = undoLocalCommand(applied.history, applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;

        const next = applyLocalCommand(undone.history, $.todos[0].done(true), undone.clock);

        expect(next.history.redoStack).toEqual([]);
    });

    it('undoes an array insert by item id after a remote reorder', () => {
        const applied = apply(
            blank(),
            $.todos.$push({id: 'three', title: 'Three', done: false}),
            clock('local'),
        );
        const reorder = createCrdtUpdates(
            applied.history.doc,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [2, 0, 1]},
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, reorder, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.todos.map((todo) => todo.id)).toEqual(['one', 'two']);
    });

    it('undoes an array item edit after remote reorder', () => {
        const applied = apply(blank(), $.todos[1].title('Two edited'), clock('local'));
        const reorder = createCrdtUpdates(
            applied.history.doc,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, reorder, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.todos).toEqual([
            {id: 'two', title: 'Two', done: false},
            {id: 'one', title: 'One', done: false},
        ]);
    });

    it('undoes a local delete by restoring a fresh incarnation', () => {
        const applied = apply(blank(), $.items.one.$remove(), hlc.init('local', 2_000_000));
        expect(applied.history.doc.state.items.one).toBeUndefined();

        const undone = undoLocalCommand(applied.history, applied.clock);

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.items.one).toEqual({title: 'One'});
    });

    it('blocks undo when a deleted record entry was remotely recreated', () => {
        const applied = apply(blank(), $.items.one.$remove(), clock('local'));
        const recreate = createCrdtUpdates(
            applied.history.doc,
            {
                op: 'add',
                path: [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                ],
                value: {title: 'Remote'},
            },
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, recreate, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(false);
        expect(undone.reason).toBe('blocked');
        expect(undone.history.doc.state.items.one).toEqual({title: 'Remote'});
    });

    it('undoes and redoes a local reorder', () => {
        const applied = apply(
            blank(),
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            clock('local'),
        );
        expect(applied.history.doc.state.todos.map((todo) => todo.id)).toEqual(['two', 'one']);

        const undone = undoLocalCommand(applied.history, applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.todos.map((todo) => todo.id)).toEqual(['one', 'two']);

        const redone = redoLocalCommand(undone.history, undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(redone.history.doc.state.todos.map((todo) => todo.id)).toEqual(['two', 'one']);
    });

    it('blocks reorder undo if any affected item was remotely reordered', () => {
        const applied = apply(
            blank(),
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            clock('local'),
        );
        const remoteReorder = createCrdtUpdates(
            applied.history.doc,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, remoteReorder, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(false);
        expect(undone.reason).toBe('blocked');
    });

    it('blocks a multi-patch undo all-or-nothing when one effect is superseded', () => {
        const applied = apply(blank(), [$.title('Local'), $.todos[0].done(true)], clock('local'));
        const remoteUpdate = createCrdtUpdates(
            applied.history.doc,
            {
                op: 'replace',
                path: [{type: 'key', key: 'title'}],
                previous: 'Local',
                value: 'Remote',
            },
            afterUpdate(applied.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(applied.history, remoteUpdate, applied.clock);

        const undone = undoLocalCommand(remote.history, remote.clock);

        expect(undone.ok).toBe(false);
        expect(undone.history.doc.state.title).toBe('Remote');
        expect(undone.history.doc.state.todos[0].done).toBe(true);
    });

    it('undoes a multi-patch command all together', () => {
        const applied = apply(blank(), [$.title('Local'), $.todos[0].done(true)], clock('local'));

        const undone = undoLocalCommand(applied.history, applied.clock);

        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(undone.history.doc.state.title).toBe('Draft');
        expect(undone.history.doc.state.todos[0].done).toBe(false);
    });

    it('blocks redo all-or-nothing when an undo effect was superseded', () => {
        const applied = apply(blank(), $.title('Local'), clock('local'));
        const undone = undoLocalCommand(applied.history, applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;

        const remoteUpdate = createCrdtUpdates(
            undone.history.doc,
            {
                op: 'replace',
                path: [{type: 'key', key: 'title'}],
                previous: 'Draft',
                value: 'Remote',
            },
            afterUpdate(undone.updates[0]),
        )[0];
        const remote = applyRemoteUpdate(undone.history, remoteUpdate, undone.clock);

        const redone = redoLocalCommand(remote.history, remote.clock);

        expect(redone.ok).toBe(false);
        expect(redone.reason).toBe('blocked');
        expect(canRedoLocalCommand(remote.history)).toBe(false);
        expect(redone.history.doc.state.title).toBe('Remote');
    });
});
