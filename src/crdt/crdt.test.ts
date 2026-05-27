import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {
    applyCrdtUpdate,
    changedNormalPathsForCrdtUpdate,
    createCrdtDocument,
    createCrdtUpdates,
    normalPathForCrdtPath,
} from './index';
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

    it('creates CRDT order updates for array moves', () => {
        let doc = createDoc();
        const appendSecond = createCrdtUpdates(
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
        doc = applyCrdtUpdate(doc, appendSecond);
        const appendThird = createCrdtUpdates(
            doc,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 2},
                ],
                {title: 'Third', done: false},
            ),
            '020',
        )[0];
        doc = applyCrdtUpdate(doc, appendThird);

        const updates = createCrdtUpdates(
            doc,
            {
                op: 'move',
                path: [{type: 'key', key: 'todos'}],
                fromIdx: 0,
                targetIdx: 2,
                after: true,
            },
            '030',
        );

        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatchObject({op: 'setOrder'});
        expect(Object.keys(updates[0].op === 'setOrder' ? updates[0].orders : {})).toHaveLength(1);

        const result = applyCrdtUpdate(doc, updates[0]);
        expect(result.state.todos.map((todo) => todo.title)).toEqual(['Second', 'Third', 'First']);
    });

    it('handles adjacent CRDT array moves without disturbing unrelated items', () => {
        let doc = createDoc();
        for (let index = 1; index < 5; index++) {
            doc = applyCrdtUpdate(
                doc,
                createCrdtUpdates(
                    doc,
                    add(
                        [
                            {type: 'key', key: 'todos'},
                            {type: 'key', key: index},
                        ],
                        {title: `Item ${index + 1}`, done: false},
                    ),
                    `01${index}`,
                )[0],
            );
        }

        const afterSecond = createCrdtUpdates(
            doc,
            {
                op: 'move',
                path: [{type: 'key', key: 'todos'}],
                fromIdx: 0,
                targetIdx: 1,
                after: true,
            },
            '020',
        )[0];
        expect(applyCrdtUpdate(doc, afterSecond).state.todos.map((todo) => todo.title)).toEqual([
            'Item 2',
            'First',
            'Item 3',
            'Item 4',
            'Item 5',
        ]);

        const beforeSecond = createCrdtUpdates(
            doc,
            {
                op: 'move',
                path: [{type: 'key', key: 'todos'}],
                fromIdx: 0,
                targetIdx: 1,
                after: false,
            },
            '030',
        );
        expect(beforeSecond).toEqual([]);
    });

    it('moves duplicate array values by CRDT item identity', () => {
        let doc = createDoc();
        const appendDuplicate = createCrdtUpdates(
            doc,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'First', done: true},
            ),
            '010',
        )[0];
        doc = applyCrdtUpdate(doc, appendDuplicate);
        const appendThird = createCrdtUpdates(
            doc,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 2},
                ],
                {title: 'Third', done: false},
            ),
            '020',
        )[0];
        doc = applyCrdtUpdate(doc, appendThird);

        const move = createCrdtUpdates(
            doc,
            {
                op: 'move',
                path: [{type: 'key', key: 'todos'}],
                fromIdx: 1,
                targetIdx: 0,
                after: false,
            },
            '030',
        )[0];
        const result = applyCrdtUpdate(doc, move);

        expect(result.state.todos).toEqual([
            {title: 'First', done: true},
            {title: 'First', done: false},
            {title: 'Third', done: false},
        ]);
    });

    it('applies move updates on another replica with the same array item IDs', () => {
        let author = createDoc();
        const appendSecond = createCrdtUpdates(
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
        author = applyCrdtUpdate(author, appendSecond);
        const appendThird = createCrdtUpdates(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 2},
                ],
                {title: 'Third', done: false},
            ),
            '020',
        )[0];
        author = applyCrdtUpdate(author, appendThird);
        const move = createCrdtUpdates(
            author,
            {
                op: 'move',
                path: [{type: 'key', key: 'todos'}],
                fromIdx: 2,
                targetIdx: 0,
                after: false,
            },
            '030',
        )[0];
        author = applyCrdtUpdate(author, move);

        let receiver = createDoc();
        for (const update of [appendSecond, appendThird, move]) {
            receiver = applyCrdtUpdate(receiver, update);
        }

        expect(receiver.state.todos).toEqual(author.state.todos);
    });

    it('rejects invalid CRDT move indexes', () => {
        const doc = createDoc();

        expect(() =>
            createCrdtUpdates(
                doc,
                {
                    op: 'move',
                    path: [{type: 'key', key: 'todos'}],
                    fromIdx: 2,
                    targetIdx: 0,
                    after: false,
                },
                '010',
            ),
        ).toThrow('Cannot create CRDT move update: fromIdx is out of range.');

        expect(() =>
            createCrdtUpdates(
                doc,
                {
                    op: 'move',
                    path: [{type: 'key', key: 'todos'}],
                    fromIdx: 0.5,
                    targetIdx: 0,
                    after: false,
                },
                '010',
            ),
        ).toThrow('Cannot create CRDT move update: fromIdx must be an integer.');
    });

    it('translates CRDT paths back to normal paths', () => {
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

        expect(updateSecond.op).toBe('set');
        if (updateSecond.op !== 'set') return;
        expect(normalPathForCrdtPath(doc, updateSecond.path)).toEqual([
            {type: 'key', key: 'todos'},
            {type: 'key', key: 1},
            {type: 'key', key: 'done'},
        ]);
    });

    it('reports changed normal paths for deletes and reorders', () => {
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
        const reorder = createCrdtUpdates(
            doc,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            '020',
        )[0];
        const afterReorder = applyCrdtUpdate(doc, reorder);
        expect(changedNormalPathsForCrdtUpdate(doc, afterReorder, reorder)).toEqual([
            [{type: 'key', key: 'todos'}],
        ]);

        const deleteSecond = createCrdtUpdates(
            doc,
            remove(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {title: 'Second', done: false},
            ),
            '030',
        )[0];
        const afterDelete = applyCrdtUpdate(doc, deleteSecond);
        expect(changedNormalPathsForCrdtUpdate(doc, afterDelete, deleteSecond)).toEqual([
            [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 1},
            ],
        ]);
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
