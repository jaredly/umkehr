import {describe, expect, it} from 'vitest';
import {createPatchBuilder, getExtra, getPath} from './helper';
import {resolveAndApply} from './make';
import {ops} from './ops';

const moveBuilder = createPatchBuilder<{items: string[]; map: Record<string, number>}, string>(
    'type',
    'hello',
);

const cheapEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

describe('helper2 path', () => {
    it('gets the path out', () => {
        expect(getPath(moveBuilder.items[2])).toEqual([
            {type: 'key', key: 'items'},
            {type: 'key', key: 2},
        ]);
    });
});

describe('helper2 extr', () => {
    it('gets the extra', () => {
        expect(getExtra(moveBuilder.items[2])).toEqual('hello');
    });
});

describe('helper2 move()', () => {
    it('reorders array items', () => {
        const op = moveBuilder.items.$move(0, 2);

        expect(op).toMatchObject({
            from: [
                {type: 'key', key: 'items'},
                {type: 'key', key: 0},
            ],
        });
        expect(op.path).toEqual([
            {type: 'key', key: 'items'},
            {type: 'key', key: 2},
        ]);

        const result = resolveAndApply<{items: string[]; map: Record<string, number>}, string>(
            {items: ['a', 'b', 'c'], map: {a: 1, b: 2}},
            op,
            '',
            'type',
            cheapEqual,
        );
        expect(result.current.items).toEqual(['b', 'c', 'a']);
    });

    it('moves object keys', () => {
        const op = moveBuilder.map.$move('a', 'c');

        const result = resolveAndApply<{items: string[]; map: Record<string, number>}, string>(
            {items: [], map: {a: 1, b: 2}},
            op,
            '',
            'type',
            cheapEqual,
        );
        expect(result.current.map).toEqual({b: 2, c: 1});
        expect(result.changes[0]).toMatchObject({
            op: 'move',
            from: [
                {type: 'key', key: 'map'},
                {type: 'key', key: 'a'},
            ],
            path: [
                {type: 'key', key: 'map'},
                {type: 'key', key: 'c'},
            ],
        });
    });
});

describe('helper2 reorder()', () => {
    it('reorders array items', () => {
        const op = moveBuilder.items.$reorder([2, 0, 1]);

        expect(op).toMatchObject({
            op: 'reorder',
            path: [{type: 'key', key: 'items'}],
            indices: [2, 0, 1],
        });

        const result = resolveAndApply<{items: string[]; map: Record<string, number>}, string>(
            {items: ['a', 'b', 'c'], map: {a: 1, b: 2}},
            op,
            '',
            'type',
            cheapEqual,
        );
        expect(result.current.items).toEqual(['c', 'a', 'b']);
        expect(result.changes).toEqual([
            {
                op: 'reorder',
                path: [{type: 'key', key: 'items'}],
                indices: [2, 0, 1],
            },
        ]);

        const restored = result.changes
            .toReversed()
            .map(ops.invert)
            .reduce((a, b) => ops.apply(a, b, cheapEqual), result.current);
        expect(restored.items).toEqual(['a', 'b', 'c']);
    });
});

describe('helper2 variant()', () => {
    it('replaces a whole tagged union value through a variant path', () => {
        type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};
        type State = {shape: Shape};
        const builder = createPatchBuilder<State, null>('type', null);
        const op = builder.shape.$variant('circle')({type: 'circle', radius: 2});

        const result = resolveAndApply<State, null>(
            {shape: {type: 'circle', radius: 1}},
            op,
            null,
            'type',
            cheapEqual,
        );

        expect(result.current).toEqual({shape: {type: 'circle', radius: 2}});
        expect(result.changes).toEqual([
            {
                op: 'replace',
                path: [
                    {type: 'key', key: 'shape'},
                    {type: 'tag', key: 'type', value: 'circle'},
                ],
                previous: {type: 'circle', radius: 1},
                value: {type: 'circle', radius: 2},
            },
        ]);
    });

    it('rejects variant paths when the current union has a different tag', () => {
        type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};
        type State = {shape: Shape};
        const builder = createPatchBuilder<State, null>('type', null);

        expect(() =>
            resolveAndApply<State, null>(
                {shape: {type: 'rect', width: 4}},
                builder.shape.$variant('circle').radius(2),
                null,
                'type',
                cheapEqual,
            ),
        ).toThrow('Tagged union at "shape" has tag "type"="rect", expected "circle".');
    });

    it('rejects variant paths when the current value has no discriminant', () => {
        type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};
        type State = {shape: Shape};
        const builder = createPatchBuilder<State, null>('type', null);

        expect(() =>
            resolveAndApply<State, null>(
                {shape: {radius: 1} as Shape},
                builder.shape.$variant('circle').radius(2),
                null,
                'type',
                cheapEqual,
            ),
        ).toThrow('Expected tagged union with tag "type" at "shape".');
    });

    it('uses the callback form to select the active variant updater', () => {
        type Shape = {type: 'circle'; radius: number} | {type: 'rect'; width: number};
        type State = {shape: Shape};
        const builder = createPatchBuilder<State, null>('type', null);
        const state: State = {shape: {type: 'circle', radius: 1}};

        const op = builder.shape.$variant(state.shape, {
            circle: (shape, up) => up.radius(shape.radius + 1),
            rect: (shape, up) => up.width(shape.width + 1),
        });
        const result = resolveAndApply<State, null>(state, op, null, 'type', cheapEqual);

        expect(result.current).toEqual({shape: {type: 'circle', radius: 2}});
    });
});
