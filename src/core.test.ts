import {describe, expect, it} from 'vitest';
import {createPatchBuilder} from './helper';
import {realizeDraftPatch, resolveAndApply} from './make';
import {ops} from './ops';
import type {Patch} from './types';

const cheapEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type State = {
    title: string;
    optional?: string;
    items: string[];
    nested: {
        count: number;
        label: string;
    };
    untouched: {
        value: string;
    };
};

const builder = createPatchBuilder<State>();

const initialState: State = {
    title: 'Draft',
    items: ['a', 'b', 'c'],
    nested: {count: 1, label: 'one'},
    untouched: {value: 'keep'},
};

const applyChanges = (state: State, changes: Patch<State>[]) =>
    changes.reduce((current, change) => ops.apply(current, change, cheapEqual), state);

describe('core operations', () => {
    it('realizes and applies replace operations with previous values', () => {
        const result = resolveAndApply(initialState, builder.title('Published'), null, 'type', cheapEqual);

        expect(result.current.title).toBe('Published');
        expect(result.changes).toEqual([
            {
                op: 'replace',
                path: [{type: 'key', key: 'title'}],
                previous: 'Draft',
                value: 'Published',
            },
        ]);
    });

    it('realizes missing-path replace operations as adds', () => {
        const result = resolveAndApply(initialState, builder.optional('added'), null, 'type', cheapEqual);

        expect(result.current.optional).toBe('added');
        expect(result.changes).toEqual([
            {
                op: 'add',
                path: [{type: 'key', key: 'optional'}],
                value: 'added',
            },
        ]);
    });

    it('applies explicit add and remove operations', () => {
        const added = resolveAndApply(initialState, builder.optional.$add('added'), null, 'type', cheapEqual);
        const removed = resolveAndApply(added.current, builder.optional.$remove(), null, 'type', cheapEqual);

        expect(added.current.optional).toBe('added');
        expect(removed.current).toEqual(initialState);
        expect(removed.changes).toEqual([
            {
                op: 'remove',
                path: [{type: 'key', key: 'optional'}],
                value: 'added',
            },
        ]);
    });

    it('realizes push operations as adds at the current array end', () => {
        const result = resolveAndApply(initialState, builder.items.$push('d'), null, 'type', cheapEqual);

        expect(result.current.items).toEqual(['a', 'b', 'c', 'd']);
        expect(result.changes).toEqual([
            {
                op: 'add',
                path: [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 3},
                ],
                value: 'd',
            },
        ]);
    });

    it('replaces the root value and can invert the change', () => {
        const nextState: State = {
            title: 'Root',
            items: [],
            nested: {count: 0, label: 'zero'},
            untouched: {value: 'new'},
        };

        const result = resolveAndApply(initialState, builder(nextState), null, 'type', cheapEqual);
        const restored = applyChanges(result.current, result.changes.toReversed().map(ops.invert));

        expect(result.current).toEqual(nextState);
        expect(result.changes).toEqual([
            {
                op: 'replace',
                path: [],
                previous: initialState,
                value: nextState,
            },
        ]);
        expect(restored).toEqual(initialState);
    });

    it('round-trips realized changes through inversion', () => {
        const result = resolveAndApply(
            initialState,
            [builder.title('Published'), builder.items.$push('d'), builder.items.$reorder([3, 1, 2, 0])],
            null,
            'type',
            cheapEqual,
        );

        const restored = applyChanges(result.current, result.changes.toReversed().map(ops.invert));

        expect(result.current).toEqual({
            ...initialState,
            title: 'Published',
            items: ['d', 'b', 'c', 'a'],
        });
        expect(restored).toEqual(initialState);
    });
});

describe('core failure behavior', () => {
    it('rejects explicit add operations when the target already exists', () => {
        expect(() =>
            resolveAndApply(initialState, builder.title.$add('Duplicate'), null, 'type', cheapEqual),
        ).toThrow('Cannot add "title": value already exists.');
    });

    it('rejects remove operations when the target is absent', () => {
        expect(() =>
            resolveAndApply(initialState, builder.optional.$remove(), null, 'type', cheapEqual),
        ).toThrow('Cannot remove "optional": value does not exist.');
    });

    it('rejects push operations on non-arrays', () => {
        expect(() =>
            resolveAndApply(initialState, builder.title.$push('nope'), null, 'type', cheapEqual),
        ).toThrow('Cannot push to "title": value is not an array.');
    });

    it('rejects invalid reorder permutations', () => {
        expect(() =>
            resolveAndApply(initialState, builder.items.$reorder([0, 0, 2]), null, 'type', cheapEqual),
        ).toThrow('Cannot reorder "items": indices must be a permutation of array indices.');
    });

    it('rejects reorder operations whose length does not match the array', () => {
        expect(() =>
            resolveAndApply(initialState, builder.items.$reorder([1, 0]), null, 'type', cheapEqual),
        ).toThrow('Cannot reorder "items": indices length must match array length.');
    });

    it('rejects moves from missing paths', () => {
        expect(() =>
            resolveAndApply(initialState, builder.items.$move(8, 0), null, 'type', cheapEqual),
        ).toThrow('Cannot remove "items/8": key does not exist.');
    });

    it('rejects realized replace operations when the previous value does not match', () => {
        expect(() =>
            ops.apply(
                initialState,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'title'}],
                    previous: 'Wrong',
                    value: 'Published',
                },
                cheapEqual,
            ),
        ).toThrow('Cannot replace "title": previous value does not match current value.');
    });

    it('rejects direct realization of nested patches', () => {
        expect(() => realizeDraftPatch(initialState, builder.title.$update((title, up) => up(`${title}!`)))).toThrow(
            'Cannot realize nested patch directly. Use resolveAndApply instead.',
        );
    });
});

describe('immutability', () => {
    it('clones changed ancestors and preserves unchanged branches', () => {
        const result = resolveAndApply(initialState, builder.nested.count(2), null, 'type', cheapEqual);

        expect(result.current).not.toBe(initialState);
        expect(result.current.nested).not.toBe(initialState.nested);
        expect(result.current.items).toBe(initialState.items);
        expect(result.current.untouched).toBe(initialState.untouched);
        expect(result.current.nested).toEqual({count: 2, label: 'one'});
    });
});

describe('nested updates', () => {
    it('rebases nested update operations onto the outer path', () => {
        const result = resolveAndApply(
            initialState,
            builder.nested.$update((nested, up) => [
                up.count(nested.count + 1),
                up.label(`${nested.label}!`),
            ]),
            null,
            'type',
            cheapEqual,
        );

        expect(result.current.nested).toEqual({count: 2, label: 'one!'});
        expect(result.changes).toEqual([
            {
                op: 'replace',
                path: [
                    {type: 'key', key: 'nested'},
                    {type: 'key', key: 'count'},
                ],
                previous: 1,
                value: 2,
            },
            {
                op: 'replace',
                path: [
                    {type: 'key', key: 'nested'},
                    {type: 'key', key: 'label'},
                ],
                previous: 'one',
                value: 'one!',
            },
        ]);
    });

    it('rejects nested updates that return another nested update', () => {
        expect(() =>
            resolveAndApply(
                initialState,
                builder.nested.$update((_nested, up) =>
                    up.label.$update((label, labelUp) => labelUp(`${label}!`)),
                ),
                null,
                'type',
                cheapEqual,
            ),
        ).toThrow("A nested patch's 'make()' function returned another nested patch, which is unsupported.");
    });
});
