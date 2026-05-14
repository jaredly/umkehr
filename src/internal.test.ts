import {describe, it, expect} from 'vitest';
import {_add, _get, _remove, _replace} from './internal';
import equal from 'fast-deep-equal';

describe('_replace', () => {
    it('should work', () => {
        expect(_replace({name: 'one'}, [{type: 'key', key: 'name'}], 'one', 'two', equal)).toEqual({
            name: 'two',
        });
    });
    it('should work deeply', () => {
        expect(
            _replace(
                {a: {name: 'one'}},
                [
                    {type: 'key', key: 'a'},
                    {type: 'key', key: 'name'},
                ],
                'one',
                'two',
                equal,
            ),
        ).toEqual({
            a: {name: 'two'},
        });
    });
});

describe('_add', () => {
    it('inserts into arrays without mutating the original array', () => {
        const original = {items: ['a', 'c'], untouched: {value: true}};
        const result = _add(
            original,
            [
                {type: 'key', key: 'items'},
                {type: 'key', key: 1},
            ],
            'b',
        );

        expect(result).toEqual({items: ['a', 'b', 'c'], untouched: {value: true}});
        expect(original.items).toEqual(['a', 'c']);
        expect(result.untouched).toBe(original.untouched);
    });

    it('rejects object keys that already exist', () => {
        expect(() => _add({name: 'one'}, [{type: 'key', key: 'name'}], 'two')).toThrow(
            'Cannot add "name": key already exists. Use replace instead.',
        );
    });
});

describe('_remove', () => {
    it('removes from arrays without mutating the original array', () => {
        const original = {items: ['a', 'b', 'c'], untouched: {value: true}};
        const result = _remove(
            original,
            [
                {type: 'key', key: 'items'},
                {type: 'key', key: 1},
            ],
            'b',
            equal,
        );

        expect(result).toEqual({items: ['a', 'c'], untouched: {value: true}});
        expect(original.items).toEqual(['a', 'b', 'c']);
        expect(result.untouched).toBe(original.untouched);
    });

    it('rejects removals when the expected value does not match', () => {
        expect(() => _remove({name: 'one'}, [{type: 'key', key: 'name'}], 'two', equal)).toThrow(
            'Cannot remove "name": expected value does not match current value.',
        );
    });
});

describe('_get', () => {
    it('reads through matching tagged-union path segments', () => {
        expect(
            _get(
                {shape: {type: 'circle', radius: 2}},
                [
                    {type: 'key', key: 'shape'},
                    {type: 'tag', key: 'type', value: 'circle'},
                    {type: 'key', key: 'radius'},
                ],
            ),
        ).toBe(2);
    });

    it('rejects non-numeric array keys', () => {
        expect(() =>
            _get(
                {items: ['a']},
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: '0'},
                ],
            ),
        ).toThrow('Expected numeric array index at "items", got "0".');
    });
});
