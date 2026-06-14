import {describe, expect, it} from 'vitest';
import {
    createPatchBuilder,
    createPatchBuilderWithContext,
    createPatchDispatcher,
    getExtra,
    getPath,
} from './helper';
import {defineLeafBuilderExtension} from './builderExtensions';
import {resolveAndApply} from './make';
import {ops} from './ops';

const moveBuilder = createPatchBuilderWithContext<
    {items: string[]; map: Record<string, number>},
    string
>('type', 'hello');

const cheapEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

type FancyLeaf = {kind: 'fancy'; value: string};
type FancyChange = {kind: 'set'; value: string};
type FancyState = {leaf: FancyLeaf; nested: {leaf: FancyLeaf}};

const fancyBuilderExtension = defineLeafBuilderExtension<FancyLeaf, FancyChange>()({
    key: '$fancy',
    plugin: 'test.fancy',
    commands: {
        set: (arg: {value: string}) => ({kind: 'set', value: arg.value}),
    },
});

const duplicateFancyBuilderExtension = defineLeafBuilderExtension<FancyLeaf, FancyChange>()({
    key: '$fancy',
    plugin: 'test.other-fancy',
    commands: {
        set: (arg: {value: string}) => ({kind: 'set', value: arg.value}),
    },
});

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

describe('builder extensions', () => {
    it('emits plugin-tagged leaf patches from configured extension commands', () => {
        const builder = createPatchBuilder<FancyState, [typeof fancyBuilderExtension]>({
            builderExtensions: [fancyBuilderExtension],
        });

        expect(builder.leaf.$fancy.set({value: 'hello'})).toEqual({
            op: 'leaf',
            plugin: 'test.fancy',
            path: [{type: 'key', key: 'leaf'}],
            change: {kind: 'set', value: 'hello'},
        });
    });

    it('passes preview timing through extension commands', () => {
        const events: Array<{patch: unknown; when: unknown}> = [];
        const builder = createPatchDispatcher<
            FancyState,
            undefined,
            'type',
            void,
            [typeof fancyBuilderExtension]
        >((patch, when) => events.push({patch, when}), undefined, 'type', {
            builderExtensions: [fancyBuilderExtension],
        });

        builder.leaf.$fancy.set({value: 'previewed'}, 'preview');

        expect(events).toEqual([
            {
                patch: {
                    op: 'leaf',
                    plugin: 'test.fancy',
                    path: [{type: 'key', key: 'leaf'}],
                    change: {kind: 'set', value: 'previewed'},
                },
                when: 'preview',
            },
        ]);
    });

    it('rejects duplicate extension keys', () => {
        expect(() =>
            createPatchBuilder<
                FancyState,
                [typeof fancyBuilderExtension, typeof duplicateFancyBuilderExtension]
            >({
                builderExtensions: [fancyBuilderExtension, duplicateFancyBuilderExtension],
            }),
        ).toThrow(/Duplicate patch builder extension key "\$fancy"/);
    });

    it('carries configured extensions through nested patch builders', () => {
        const builder = createPatchBuilder<FancyState, [typeof fancyBuilderExtension]>({
            builderExtensions: [fancyBuilderExtension],
        });
        const op = builder.nested.$update((_nested, update) =>
            update.leaf.$fancy.set({value: 'nested'}),
        );

        const result = resolveAndApply<
            FancyState,
            undefined,
            'type',
            [typeof fancyBuilderExtension]
        >(
            {
                leaf: {kind: 'fancy', value: ''},
                nested: {leaf: {kind: 'fancy', value: ''}},
            },
            op,
            undefined,
            'type',
            cheapEqual,
        );

        expect(result.changes).toEqual([
            {
                op: 'leaf',
                plugin: 'test.fancy',
                path: [
                    {type: 'key', key: 'nested'},
                    {type: 'key', key: 'leaf'},
                ],
                change: {kind: 'set', value: 'nested'},
            },
        ]);
    });
});

describe('helper2 move()', () => {
    it('reorders array items', () => {
        const op = moveBuilder.items.$move({fromIdx: 0, targetIdx: 2, after: true});

        expect(op).toMatchObject({
            op: 'move',
            path: [{type: 'key', key: 'items'}],
            fromIdx: 0,
            targetIdx: 2,
            after: true,
        });

        const result = resolveAndApply<{items: string[]; map: Record<string, number>}, string>(
            {items: ['a', 'b', 'c'], map: {a: 1, b: 2}},
            op,
            '',
            'type',
            cheapEqual,
        );
        expect(result.current.items).toEqual(['b', 'c', 'a']);
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
        const builder = createPatchBuilder<State>();
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
        const builder = createPatchBuilder<State>();

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
        const builder = createPatchBuilder<State>();

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
        const builder = createPatchBuilder<State>();
        const state: State = {shape: {type: 'circle', radius: 1}};

        const op = builder.shape.$variant(state.shape, {
            circle: (shape, up) => up.radius(shape.radius + 1),
            rect: (shape, up) => up.width(shape.width + 1),
        });
        const result = resolveAndApply<State, null>(state, op, null, 'type', cheapEqual);

        expect(result.current).toEqual({shape: {type: 'circle', radius: 2}});
    });
});
