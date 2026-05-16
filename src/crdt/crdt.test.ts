import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {applyCrdtUpdate, createCrdtDocument, createCrdtUpdates} from './index';
import type {Patch} from '../types';

type Person = {name: string};
type Item = {title: string; people: Record<string, Person>};
type Todo = {title: string; done: boolean};
type Shape = {type: 'circle'; radius: number} | {type: 'text'; text: string};
type State = {
    title: string;
    items: Record<string, Item>;
    todos: Todo[];
    selected: Shape;
};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
                items: {
                    type: 'object',
                    additionalProperties: {
                        type: 'object',
                        properties: {
                            title: {type: 'string'},
                            people: {
                                type: 'object',
                                additionalProperties: {
                                    type: 'object',
                                    properties: {
                                        name: {type: 'string'},
                                    },
                                },
                            },
                        },
                    },
                },
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                        },
                    },
                },
                selected: {
                    discriminator: {propertyName: 'type'},
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                type: {const: 'circle'},
                                radius: {type: 'number'},
                            },
                        },
                        {
                            type: 'object',
                            properties: {
                                type: {const: 'text'},
                                text: {type: 'string'},
                            },
                        },
                    ],
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const initial: State = {
    title: 'Draft',
    items: {},
    todos: [{title: 'First', done: false}],
    selected: {type: 'circle', radius: 1},
};

const createDoc = () => createCrdtDocument(initial, schema, {timestamp: '001'});

const add = (path: Patch<State>['path'], value: unknown): Patch<State> => ({
    op: 'add',
    path,
    value,
});
const replace = (path: Patch<State>['path'], value: unknown, previous: unknown): Patch<State> => ({
    op: 'replace',
    path,
    value,
    previous,
});
const remove = (path: Patch<State>['path'], value: unknown): Patch<State> => ({
    op: 'remove',
    path,
    value,
});

describe('crdt', () => {
    it('applies newer primitive writes with LWW semantics', () => {
        const doc = createDoc();
        const older = createCrdtUpdates(
            doc,
            replace([{type: 'key', key: 'title'}], 'Older', 'Draft'),
            '010',
        )[0];
        const newer = createCrdtUpdates(
            doc,
            replace([{type: 'key', key: 'title'}], 'Newer', 'Draft'),
            '020',
        )[0];

        const result = applyCrdtUpdate(applyCrdtUpdate(doc, newer), older);

        expect(result.state.title).toBe('Newer');
    });

    it('discards delayed child updates for an older record entry incarnation', () => {
        let author = createDoc();
        const createOne = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                ],
                {title: 'One', people: {}},
            ),
            '010',
        )[0];
        author = applyCrdtUpdate(author, createOne);
        const addPerson = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                    {type: 'key', key: 'people'},
                    {type: 'key', key: 'me'},
                ],
                {name: 'Me'},
            ),
            '020',
        )[0];
        const deleteOne = createCrdtUpdates(
            author,
            remove(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                ],
                {title: 'One', people: {}},
            ),
            '030',
        )[0];
        const recreateOne = createCrdtUpdates(
            applyCrdtUpdate(author, deleteOne),
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                ],
                {title: 'One1', people: {}},
            ),
            '040',
        )[0];

        let receiver = createDoc();
        for (const update of [createOne, deleteOne, recreateOne, addPerson]) {
            receiver = applyCrdtUpdate(receiver, update);
        }

        expect(receiver.state.items.one).toEqual({title: 'One1', people: {}});
        expect(receiver.pending).toEqual([]);
    });

    it('queues child updates until their parent creation arrives', () => {
        let author = createDoc();
        const createOne = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                ],
                {title: 'One', people: {}},
            ),
            '010',
        )[0];
        author = applyCrdtUpdate(author, createOne);
        const addPerson = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                    {type: 'key', key: 'people'},
                    {type: 'key', key: 'me'},
                ],
                {name: 'Me'},
            ),
            '020',
        )[0];

        let receiver = applyCrdtUpdate(createDoc(), addPerson);
        expect(receiver.pending).toHaveLength(1);

        receiver = applyCrdtUpdate(receiver, createOne);

        expect(receiver.pending).toEqual([]);
        expect(receiver.state.items.one.people.me).toEqual({name: 'Me'});
    });

    it('uses stable array item IDs for updates after reorder and delete', () => {
        let doc = createDoc();
        const append = createCrdtUpdates(
            doc,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'Second', done: false},
            ),
            '010',
        )[0];
        doc = applyCrdtUpdate(doc, append);
        const updateSecond = createCrdtUpdates(
            doc,
            replace(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                    {type: 'key', key: 'done'},
                ],
                true,
                false,
            ),
            '020',
        )[0];
        const reorder = createCrdtUpdates(
            doc,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            '030',
        )[0];
        const deleteSecond = createCrdtUpdates(
            doc,
            remove(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'Second', done: false},
            ),
            '040',
        )[0];

        expect(deleteSecond).toMatchObject({
            op: 'delete',
            path: [
                {type: 'objectField', key: 'todos'},
                {type: 'arrayItem', id: '010'},
            ],
        });

        let receiver = createDoc();
        for (const update of [append, reorder, deleteSecond, updateSecond]) {
            receiver = applyCrdtUpdate(receiver, update);
        }

        expect(receiver.state.todos).toEqual([{title: 'First', done: false}]);
    });

    it('queues array item updates and reorders until the item creation arrives', () => {
        let author = createDoc();
        const append = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'Second', done: false},
            ),
            '010',
        )[0];
        author = applyCrdtUpdate(author, append);
        const replaceSecond = createCrdtUpdates(
            author,
            replace(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'Second edited', done: false},
                {title: 'Second', done: false},
            ),
            '020',
        )[0];
        const reorder = createCrdtUpdates(
            author,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            '030',
        )[0];

        let receiver = applyCrdtUpdate(createDoc(), replaceSecond);
        receiver = applyCrdtUpdate(receiver, reorder);

        expect(receiver.pending).toHaveLength(2);

        receiver = applyCrdtUpdate(receiver, append);

        expect(receiver.pending).toEqual([]);
        expect(receiver.state.todos).toEqual([
            {title: 'Second edited', done: false},
            {title: 'First', done: false},
        ]);
    });

    it('discards delayed tagged-union field updates for older branches', () => {
        const doc = createDoc();
        const updateOldBranch = createCrdtUpdates(
            doc,
            replace(
                [
                    {type: 'key', key: 'selected'},
                    {type: 'tag', key: 'type', value: 'circle'},
                    {type: 'key', key: 'radius'},
                ],
                2,
                1,
            ),
            '010',
        )[0];
        const replaceBranch = createCrdtUpdates(
            doc,
            replace(
                [{type: 'key', key: 'selected'}],
                {type: 'text', text: 'hello'},
                initial.selected,
            ),
            '020',
        )[0];

        const receiver = applyCrdtUpdate(
            applyCrdtUpdate(createDoc(), replaceBranch),
            updateOldBranch,
        );

        expect(receiver.state.selected).toEqual({type: 'text', text: 'hello'});
    });
});
