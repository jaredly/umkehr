import {describe, expect, it} from 'vitest';
import {createStatusStore, type Status} from './statuses';
import type {Path} from './types';

const path = (...keys: Array<string | number>): Path =>
    keys.map((key) => ({type: 'key', key}));

const status = (id: string, keys: Array<string | number>, kind = 'changed'): Status => ({
    id,
    path: path(...keys),
    kind,
});

describe('createStatusStore', () => {
    it('returns exact path statuses by default', () => {
        const store = createStatusStore();
        store.add([
            status('title', ['title']),
            status('child', ['todos', 0, 'title']),
            status('sibling', ['todos', 1]),
        ]);

        expect(store.get(path('todos', 0))).toEqual([]);
        expect(store.get(path('todos', 0, 'title'))).toEqual([
            status('child', ['todos', 0, 'title']),
        ]);
    });

    it('returns descendant statuses including statuses on the subscribed path', () => {
        const store = createStatusStore();
        store.add([
            status('self', ['todos', 0]),
            status('child', ['todos', 0, 'title']),
            status('sibling', ['todos', 1, 'title']),
        ]);

        expect(store.get(path('todos', 0), {descendants: true})).toEqual([
            status('self', ['todos', 0]),
            status('child', ['todos', 0, 'title']),
        ]);
    });

    it('filters by kind inside the matched path bucket', () => {
        const store = createStatusStore();
        store.add([
            status('changed', ['todos', 0], 'changed'),
            status('conflict', ['todos', 0, 'title'], 'conflict'),
            status('deleted', ['todos', 0, 'done'], 'deleted-in-peer'),
        ]);

        expect(store.get(path('todos', 0), {descendants: true, kinds: ['conflict']})).toEqual([
            status('conflict', ['todos', 0, 'title'], 'conflict'),
        ]);
    });

    it('adds multiple statuses and replaces existing ids', () => {
        const store = createStatusStore();
        store.add([status('one', ['todos', 0]), status('two', ['todos', 1])]);
        store.add([status('one', ['todos', 2], 'conflict')]);

        expect(store.get(path('todos', 0))).toEqual([]);
        expect(store.get(path('todos', 2))).toEqual([status('one', ['todos', 2], 'conflict')]);
        expect(store.get(path('todos'), {descendants: true})).toEqual([
            status('two', ['todos', 1]),
            status('one', ['todos', 2], 'conflict'),
        ]);
    });

    it('clears statuses by id and clears all statuses', () => {
        const store = createStatusStore();
        store.add([status('one', ['todos', 0]), status('two', ['todos', 1])]);

        store.clear('one');
        expect(store.get(path('todos'), {descendants: true})).toEqual([status('two', ['todos', 1])]);

        store.clearAll();
        expect(store.get(path('todos'), {descendants: true})).toEqual([]);
    });

    it('notifies subscribers with the matching status list', () => {
        const store = createStatusStore();
        const exact: Status[][] = [];
        const descendants: Status[][] = [];

        store.subscribe(path('todos', 0), undefined, (statuses) => exact.push(statuses));
        store.subscribe(path('todos', 0), {descendants: true}, (statuses) =>
            descendants.push(statuses),
        );

        store.add([status('child', ['todos', 0, 'title'])]);
        expect(exact).toEqual([]);
        expect(descendants).toEqual([[status('child', ['todos', 0, 'title'])]]);

        store.add([status('self', ['todos', 0])]);
        expect(exact).toEqual([[status('self', ['todos', 0])]]);
        expect(descendants).toEqual([
            [status('child', ['todos', 0, 'title'])],
            [status('child', ['todos', 0, 'title']), status('self', ['todos', 0])],
        ]);

        store.clear('child');
        expect(descendants.at(-1)).toEqual([status('self', ['todos', 0])]);
    });
});
