import {describe, it, expect} from 'bun:test';
import {dispatch, jump, History} from './history';
import {createPatchBuilder} from '../helper';
import {Patch, DraftPatch} from '../types';

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

const builder = createPatchBuilder<Article, null>('type', null);

function fill<T>(draft: DraftPatch<T, 'type', null>, value: any): Patch<T> {
    switch (draft.op) {
        case 'add':
        case 'move':
        case 'copy':
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
            throw new Error('cant fill a nested sry');
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
            meta: {tags: ['draft', 'published'], flags: {archived: false, featured: false}},
            sections: [{heading: 'Intro', paragraphs: ['hello world']}],
        });
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
            [builder.sections.$push({heading: 'Deep Dive', paragraphs: ['details']})],
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
});

describe('jump', () => {
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
});
