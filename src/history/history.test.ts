import {describe, it, expect} from 'vitest';
import {dispatch, dispatchWithChangedPaths, jump, jumpWithChangedPaths, type History} from './history';
import {createPatchBuilder} from '../helper';
import type {Patch, DraftPatch} from '../types';

const cheapEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

type Article = {
    title: string;
    meta: {
        tags: string[];
        flags: {archived: boolean; featured: boolean};
    };
    sections: Array<{
        heading: string;
        paragraphs: string[];
    }>;
};

const path = (...keys: (string | number)[]) => keys.map((key) => ({type: 'key' as const, key}));

const initialArticle: Article = {
    title: 'First Draft',
    meta: {tags: ['draft'], flags: {archived: false, featured: false}},
    sections: [{heading: 'Intro', paragraphs: ['hello world']}],
};

const makeHistory = (current: Article): History<Article, string> => ({
    version: 2,
    nodes: {root: {id: 'root', pid: 'root', changes: [], children: []}},
    annotations: {},
    root: 'root',
    tip: 'root',
    current,
    initial: current,
    undoTrail: [],
});

const idGenerator = () => {
    let count = 0;
    return () => `node-${++count}`;
};

const builder = createPatchBuilder<Article>();

function fill<T>(draft: DraftPatch<T, 'type', null>, value: any): Patch<T> {
    switch (draft.op) {
        case 'add':
        case 'move':
        case 'reorder':
            return draft;
        case 'replace':
            return {...draft, previous: value};
        case 'remove':
            return {...draft, value: value};
        case 'push': {
            return {
                op: 'add',
                path: [...draft.path, {type: 'key', key: value}],
                value: draft.value,
            } as Patch<T>;
        }
        case 'nested': {
            throw new Error('Test helper does not support nested patches.');
        }
    }
}

describe('dispatch', () => {
    it('applies draft operations, stores realized changes on a new node, and updates current', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        const updates: Array<
            DraftPatch<Article, 'type', null> | DraftPatch<Article, 'type', null>[]
        > = [
            builder.title('Revised Title'),
            builder.meta.tags.$push('published'),
            builder.title((title, up) => up(title + 'v2')),
        ];

        history = dispatch(history, updates, null, 'type', cheapEqual, genId);

        expect(history.tip).toBe('node-1');
        expect(history.undoTrail).toEqual([]);
        expect(history.nodes.root.children).toEqual(['node-1']);
        expect(history.nodes['node-1'].changes).toEqual([
            fill(builder.title('Revised Title'), 'First Draft'),
            fill(builder.meta.tags.$push('published'), 1),
            fill(builder.title('Revised Titlev2'), 'Revised Title'),
        ]);
        expect(history.current).toEqual({
            title: 'Revised Titlev2',
            meta: {
                tags: ['draft', 'published'],
                flags: {archived: false, featured: false},
            },
            sections: [{heading: 'Intro', paragraphs: ['hello world']}],
        });
    });

    it('supports the simple public overload with default tag/context arguments', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(history, [builder.title('Simple')], cheapEqual, genId);

        expect(history.tip).toBe('node-1');
        expect(history.current.title).toBe('Simple');
        expect(history.nodes['node-1'].changes).toEqual([
            fill(builder.title('Simple'), 'First Draft'),
        ]);
    });
});

describe('undo/redo', () => {
    it('walks back and forward through history while keeping undoTrail in sync', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(
            history,
            [builder.meta.flags.featured(true)],
            null,
            'type',
            cheapEqual,
            genId,
        );
        const afterFirst = history;

        history = dispatch(
            history,
            [
                builder.sections.$push({
                    heading: 'Deep Dive',
                    paragraphs: ['details'],
                }),
            ],
            null,
            'type',
            cheapEqual,
            genId,
        );
        const afterSecond = history;

        const backOne = dispatch(history, {op: 'undo'}, null, 'type', cheapEqual);
        expect(backOne.tip).toBe('node-1');
        expect(backOne.undoTrail).toEqual(['node-2']);
        expect(backOne.current).toEqual(afterFirst.current);

        const backToRoot = dispatch(backOne, {op: 'undo'}, null, 'type', cheapEqual);
        expect(backToRoot.tip).toBe('root');
        expect(backToRoot.undoTrail).toEqual(['node-1', 'node-2']);
        expect(backToRoot.current).toEqual(initialArticle);

        const redoFirst = dispatch(backToRoot, {op: 'redo'}, null, 'type', cheapEqual);
        expect(redoFirst.tip).toBe('node-1');
        expect(redoFirst.undoTrail).toEqual(['node-2']);
        expect(redoFirst.current.meta.flags.featured).toBe(true);
        expect(redoFirst.current.sections.length).toBe(1);

        const redoSecond = dispatch(redoFirst, {op: 'redo'}, null, 'type', cheapEqual);
        expect(redoSecond.tip).toBe('node-2');
        expect(redoSecond.undoTrail).toEqual([]);
        expect(redoSecond.current).toEqual(afterSecond.current);
    });

    it('clears the redo trail when dispatching a new change after undo', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(history, [builder.title('Second')], null, 'type', cheapEqual, genId);
        history = dispatch(history, [builder.title('Third')], null, 'type', cheapEqual, genId);

        const undone = dispatch(history, {op: 'undo'}, null, 'type', cheapEqual);
        expect(undone.tip).toBe('node-1');
        expect(undone.undoTrail).toEqual(['node-2']);

        const branched = dispatch(
            undone,
            [builder.meta.flags.archived(true)],
            null,
            'type',
            cheapEqual,
            genId,
        );

        expect(branched.tip).toBe('node-3');
        expect(branched.undoTrail).toEqual([]);
        expect(branched.nodes['node-1'].children).toEqual(['node-2', 'node-3']);
        expect(branched.current.title).toBe('Second');
        expect(branched.current.meta.flags.archived).toBe(true);

        const redo = dispatch(branched, {op: 'redo'}, null, 'type', cheapEqual);
        expect(redo).toBe(branched);
    });

    it('throws when the redo trail references a missing node', () => {
        const history: History<Article, string> = {
            ...makeHistory(initialArticle),
            undoTrail: ['missing-node'],
        };

        expect(() => dispatch(history, {op: 'redo'}, null, 'type', cheapEqual)).toThrow(
            'Cannot redo: undo trail references missing history node "missing-node".',
        );
    });

    it('reports changed paths for undo and redo commands', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(history, [builder.title('Second')], null, 'type', cheapEqual, genId);
        history = dispatch(history, [builder.meta.flags.archived(true)], null, 'type', cheapEqual, genId);

        const undone = dispatchWithChangedPaths(history, {op: 'undo'}, null, 'type', cheapEqual);
        expect(undone.changedPaths).toEqual([path('meta', 'flags', 'archived')]);
        expect(undone.changedHistory).toBe(false);
        expect(undone.history.current.meta.flags.archived).toBe(false);

        const redone = dispatchWithChangedPaths(undone.history, {op: 'redo'}, null, 'type', cheapEqual);
        expect(redone.changedPaths).toEqual([path('meta', 'flags', 'archived')]);
        expect(redone.changedHistory).toBe(false);
        expect(redone.history.current.meta.flags.archived).toBe(true);
    });
});

describe('jump', () => {
    type TodoState = {todos: Array<{id: string; title: string; done: boolean}>};
    const todoBuilder = createPatchBuilder<TodoState>();
    const initialTodos: TodoState = {
        todos: [
            {id: 'one', title: 'Write README', done: false},
            {id: 'two', title: 'Add examples', done: false},
        ],
    };
    const makeTodoHistory = (): History<TodoState, string> => ({
        version: 2,
        nodes: {root: {id: 'root', pid: 'root', changes: [], children: []}},
        annotations: {},
        root: 'root',
        tip: 'root',
        current: initialTodos,
        initial: initialTodos,
        undoTrail: [],
    });

    it('jumps back to root after two opposite replacements at the same path', () => {
        const genId = idGenerator();
        let history = makeTodoHistory();

        history = dispatch(history, [todoBuilder.todos[0].done(true)], cheapEqual, genId);
        history = dispatch(history, [todoBuilder.todos[0].done(false)], cheapEqual, genId);

        const jumped = jump(history, 'root', cheapEqual);

        expect(jumped.tip).toBe('root');
        expect(jumped.current).toEqual(initialTodos);
    });

    it('jumps upward through several same-path replacements', () => {
        const genId = idGenerator();
        let history = makeTodoHistory();

        history = dispatch(history, [todoBuilder.todos[0].title('Draft')], cheapEqual, genId);
        history = dispatch(history, [todoBuilder.todos[0].title('Review')], cheapEqual, genId);
        const reviewTip = history.tip;
        const reviewState = history.current;
        history = dispatch(history, [todoBuilder.todos[0].title('Published')], cheapEqual, genId);
        history = dispatch(history, [todoBuilder.todos[0].title('Archived')], cheapEqual, genId);

        const jumpedToReview = jump(history, reviewTip, cheapEqual);
        expect(jumpedToReview.current).toEqual(reviewState);

        const jumpedToRoot = jump(history, 'root', cheapEqual);
        expect(jumpedToRoot.current).toEqual(initialTodos);
    });

    it('jumps upward through a node with multiple dependent changes in reverse order', () => {
        const genId = idGenerator();
        let history = makeTodoHistory();

        history = dispatch(
            history,
            [todoBuilder.todos[0].title('Draft'), todoBuilder.todos[0].title('Review')],
            cheapEqual,
            genId,
        );
        history = dispatch(history, [todoBuilder.todos[0].title('Published')], cheapEqual, genId);

        const jumped = jump(history, 'root', cheapEqual);

        expect(jumped.current).toEqual(initialTodos);
    });

    it('jumps between branches that both changed the same path', () => {
        const genId = idGenerator();
        let history = makeTodoHistory();

        history = dispatch(history, [todoBuilder.todos[0].title('Draft')], cheapEqual, genId);
        const branchPoint = history.tip;

        history = dispatch(history, [todoBuilder.todos[0].title('Mainline')], cheapEqual, genId);
        const mainlineTip = history.tip;
        const mainlineState = history.current;

        history = jump(history, branchPoint, cheapEqual);
        history = dispatch(history, [todoBuilder.todos[0].title('Alternate')], cheapEqual, genId);
        const alternateTip = history.tip;
        const alternateState = history.current;

        const jumpedToMainline = jump(history, mainlineTip, cheapEqual);
        expect(jumpedToMainline.current).toEqual(mainlineState);

        const jumpedToAlternate = jump(jumpedToMainline, alternateTip, cheapEqual);
        expect(jumpedToAlternate.current).toEqual(alternateState);
    });

    it('reports changed paths when jumping through repeated same-path replacements', () => {
        const genId = idGenerator();
        let history = makeTodoHistory();

        history = dispatch(history, [todoBuilder.todos[0].done(true)], cheapEqual, genId);
        history = dispatch(history, [todoBuilder.todos[0].done(false)], cheapEqual, genId);

        const jumped = jumpWithChangedPaths(history, 'root', cheapEqual);

        expect(jumped.changedPaths).toEqual([path('todos', 0, 'done'), path('todos', 0, 'done')]);
        expect(jumped.changedHistory).toBe(false);
        expect(jumped.history.current).toEqual(initialTodos);
    });

    it('recomputes current when moving between branches', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(
            history,
            [builder.meta.flags.featured(true)],
            null,
            'type',
            cheapEqual,
            genId,
        );
        const firstBranchTip = history.tip;

        history = dispatch(
            history,
            [builder.sections.$push({heading: 'Follow Up', paragraphs: ['later']})],
            null,
            'type',
            cheapEqual,
            genId,
        );
        const mainlineTip = history.tip;
        const mainlineState = history.current;

        history = jump(history, firstBranchTip, cheapEqual);
        expect(history.tip).toBe(firstBranchTip);
        expect(history.undoTrail).toEqual([]);
        expect(history.current.sections.length).toBe(1);

        history = dispatch(
            history,
            [builder.meta.tags[0]('finalized')],
            null,
            'type',
            cheapEqual,
            genId,
        );
        const branchTip = history.tip;

        expect(history.nodes[firstBranchTip].children).toEqual([mainlineTip, branchTip]);
        expect(history.current.meta.tags).toEqual(['finalized']);

        history = jump(history, mainlineTip, cheapEqual);
        expect(history.tip).toBe(mainlineTip);
        expect(history.undoTrail).toEqual([]);
        expect(history.current).toEqual(mainlineState);
    });

    it('throws when jumping to an unknown node', () => {
        const history = makeHistory(initialArticle);

        expect(() => jump(history, 'missing-node', cheapEqual)).toThrow(
            'Cannot jump: unknown history node "missing-node".',
        );
    });

    it('dispatches jump commands and clears redo history', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(history, [builder.title('Second')], null, 'type', cheapEqual, genId);
        const firstTip = history.tip;
        history = dispatch(history, [builder.title('Third')], null, 'type', cheapEqual, genId);

        const backOne = dispatch(history, {op: 'undo'}, null, 'type', cheapEqual);
        expect(backOne.undoTrail).toEqual(['node-2']);

        const jumped = dispatch(backOne, {op: 'jump', id: firstTip}, null, 'type', cheapEqual);

        expect(jumped.tip).toBe(firstTip);
        expect(jumped.undoTrail).toEqual([]);
        expect(jumped.current.title).toBe('Second');
    });

    it('computes changed paths for jump commands while applying the jump once', () => {
        const genId = idGenerator();
        let history = makeHistory(initialArticle);

        history = dispatch(history, [builder.title('Second')], null, 'type', cheapEqual, genId);
        const branchPoint = history.tip;
        history = dispatch(history, [builder.meta.flags.featured(true)], null, 'type', cheapEqual, genId);
        const mainlineTip = history.tip;
        history = jump(history, branchPoint, cheapEqual);
        history = dispatch(history, [builder.sections.$push({heading: 'Branch', paragraphs: []})], null, 'type', cheapEqual, genId);

        const jumped = jumpWithChangedPaths(history, mainlineTip, cheapEqual);

        expect(jumped.history.tip).toBe(mainlineTip);
        expect(jumped.history.current.meta.flags.featured).toBe(true);
        expect(jumped.history.current.sections).toEqual(initialArticle.sections);
        expect(jumped.changedPaths).toEqual([
            path('sections', 1),
            path('meta', 'flags', 'featured'),
        ]);
        expect(jumped.changedHistory).toBe(false);
    });
});
