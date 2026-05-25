import {describe, expect, it} from 'vitest';
import {createEphemeralStore, type EphemeralMessage} from './ephemeral';
import type {Path} from './types';

type Data = {value: string};

const path = (...keys: Array<string | number>): Path => keys.map((key) => ({type: 'key', key}));

const message = (
    id: string,
    actor: string,
    keys: Array<string | number> | undefined,
    kind = 'preview',
): EphemeralMessage<Data> => ({
    id,
    actor,
    kind,
    path: keys ? path(...keys) : undefined,
    data: {value: id},
});

describe('createEphemeralStore', () => {
    it('adds messages and replaces existing ids', () => {
        const store = createEphemeralStore();
        store.add([
            message('one', 'actor-a', ['elements', 'one']),
            message('two', 'actor-a', ['elements', 'two']),
        ]);
        store.add([message('one', 'actor-b', ['elements', 'three'], 'selection')]);

        expect(
            store.get({path: path('elements'), descendants: true}).map((record) => record.message),
        ).toEqual([
            message('two', 'actor-a', ['elements', 'two']),
            message('one', 'actor-b', ['elements', 'three'], 'selection'),
        ]);
        expect(store.get({actor: 'actor-a'}).map((record) => record.message.id)).toEqual(['two']);
        expect(store.get({actor: 'actor-b'}).map((record) => record.message.id)).toEqual(['one']);
    });

    it('clears by id, clear messages, actor, and all records', () => {
        const store = createEphemeralStore();
        store.add([
            message('one', 'actor-a', ['elements', 'one']),
            message('two', 'actor-a', ['elements', 'two']),
            message('three', 'actor-b', ['elements', 'three']),
        ]);

        store.clear('one');
        expect(store.get({actor: 'actor-a'}).map((record) => record.message.id)).toEqual(['two']);

        store.add([{...message('two', 'actor-a', ['elements', 'two']), clear: true}]);
        expect(store.get({actor: 'actor-a'})).toEqual([]);

        store.clearActor('actor-b');
        expect(store.get()).toEqual([]);

        store.add([message('four', 'actor-c', undefined)]);
        store.clearAll();
        expect(store.get()).toEqual([]);
    });

    it('filters by actor, path, descendants, and kind', () => {
        const store = createEphemeralStore();
        store.add([
            message('self', 'actor-a', ['elements'], 'selection'),
            message('child', 'actor-a', ['elements', 'note-1'], 'preview'),
            message('sibling', 'actor-b', ['elements', 'note-2'], 'preview'),
            message('pathless', 'actor-a', undefined, 'cursor'),
        ]);

        expect(store.get({path: path('elements')}).map((record) => record.message.id)).toEqual([
            'self',
        ]);
        expect(
            store
                .get({
                    actor: 'actor-a',
                    path: path('elements'),
                    descendants: true,
                    kinds: ['preview'],
                })
                .map((record) => record.message.id),
        ).toEqual(['child']);
        expect(store.get({actor: 'actor-a'}).map((record) => record.message.id)).toEqual([
            'self',
            'child',
            'pathless',
        ]);
    });

    it('marks records stale after 15 seconds and removes them after 30 seconds', () => {
        const store = createEphemeralStore();
        const start = new Date('2026-05-25T12:00:00.000Z');
        store.add([message('one', 'actor-a', ['elements', 'one'])], start);

        expect(store.get(undefined, new Date(start.getTime() + 14_999))[0].state).toBe('active');
        expect(store.get(undefined, new Date(start.getTime() + 15_000))[0].state).toBe('stale');
        expect(store.get(undefined, new Date(start.getTime() + 30_000))).toEqual([]);
    });

    it('sweeps expired records and notifies subscribers', () => {
        const store = createEphemeralStore();
        const start = new Date('2026-05-25T12:00:00.000Z');
        const seen: string[][] = [];
        store.subscribe({path: path('elements'), descendants: true}, (records) => {
            seen.push(records.map((record) => record.message.id));
        });

        store.add([message('one', 'actor-a', ['elements', 'one'])], start);
        store.sweep(new Date(start.getTime() + 30_000));

        expect(seen).toEqual([['one'], []]);
    });

    it('notifies subscribers when records become stale', () => {
        const store = createEphemeralStore();
        const start = new Date('2026-05-25T12:00:00.000Z');
        const seen: string[] = [];
        store.subscribe(undefined, (records) => {
            seen.push(records.map((record) => record.state).join(','));
        });

        store.add([message('one', 'actor-a', ['elements', 'one'])], start);
        store.sweep(new Date(start.getTime() + 15_000));

        expect(seen).toEqual(['active', 'stale']);
    });

    it('honors explicit expiresAt timestamps', () => {
        const store = createEphemeralStore();
        const start = new Date('2026-05-25T12:00:00.000Z');
        store.add(
            [
                {
                    ...message('one', 'actor-a', ['elements', 'one']),
                    expiresAt: new Date(start.getTime() + 5_000).toISOString(),
                },
            ],
            start,
        );

        expect(store.get(undefined, new Date(start.getTime() + 4_999))).toHaveLength(1);
        expect(store.get(undefined, new Date(start.getTime() + 5_000))).toEqual([]);
    });
});
