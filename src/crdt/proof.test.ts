import {describe, expect, it} from 'vitest';
import fc from 'fast-check';
import type {IJsonSchemaCollection} from 'typia';
import {
    applyCrdtUpdate,
    createCrdtDocument,
    createCrdtUpdates,
    createCrdtUpdateValidator,
    hlc,
} from './index';
import {
    applyAll,
    duplicateUpdates,
    expectConverged,
    expectNoReadyPending,
    expectValidCrdtUpdate,
    expectValidMaterializedState,
    shuffleDeterministically,
} from './proofTestHelpers';
import type {CrdtDocument, CrdtUpdate} from './types';
import type {Patch} from '../types';

type Todo = {id: string; title: string; done: boolean};
type Item = {name: string; child: Record<string, {name: string}>};
type Shape = {type: 'circle'; radius: number} | {type: 'text'; text: string};
type State = {
    title: string;
    count: number;
    settings: {theme: string; nested: {label: string}};
    items: Record<string, Item>;
    todos: Todo[];
    selected: Shape;
};

const schema = {
    schemas: [
        {
            type: 'object',
            required: ['title', 'count', 'settings', 'items', 'todos', 'selected'],
            properties: {
                title: {type: 'string'},
                count: {type: 'number'},
                settings: {
                    type: 'object',
                    required: ['theme', 'nested'],
                    properties: {
                        theme: {type: 'string'},
                        nested: {
                            type: 'object',
                            required: ['label'],
                            properties: {
                                label: {type: 'string'},
                            },
                        },
                    },
                },
                items: {
                    type: 'object',
                    additionalProperties: {
                        type: 'object',
                        required: ['name', 'child'],
                        properties: {
                            name: {type: 'string'},
                            child: {
                                type: 'object',
                                additionalProperties: {
                                    type: 'object',
                                    required: ['name'],
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
                        required: ['id', 'title', 'done'],
                        properties: {
                            id: {type: 'string'},
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
                            required: ['type', 'radius'],
                            properties: {
                                type: {const: 'circle'},
                                radius: {type: 'number'},
                            },
                        },
                        {
                            type: 'object',
                            required: ['type', 'text'],
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
    count: 0,
    settings: {theme: 'light', nested: {label: 'original'}},
    items: {},
    todos: [{id: 'one', title: 'One', done: false}],
    selected: {type: 'circle', radius: 1},
};

const startTs = hlc.pack(hlc.init('seed', 1_000_000));
const updateValidator = createCrdtUpdateValidator(schema);

const ts = (count: number, node = 'actor') => hlc.pack({ts: 2_000_000, count, node});
const createDoc = () => createCrdtDocument(initial, schema, {timestamp: startTs});

const replace = (path: Patch<State>['path'], value: unknown, previous: unknown): Patch<State> => ({
    op: 'replace',
    path,
    value,
    previous,
});

const add = (path: Patch<State>['path'], value: unknown): Patch<State> => ({
    op: 'add',
    path,
    value,
});

const remove = (path: Patch<State>['path'], value: unknown): Patch<State> => ({
    op: 'remove',
    path,
    value,
});

const reorder = (path: Patch<State>['path'], indices: number[]): Patch<State> => ({
    op: 'reorder',
    path,
    indices,
});

const move = (
    path: Patch<State>['path'],
    fromIdx: number,
    targetIdx: number,
    after: boolean,
): Patch<State> => ({
    op: 'move',
    path,
    fromIdx,
    targetIdx,
    after,
});

const stateValidator = {
    validate(input: unknown) {
        return validateState(input) ? {success: true} : {success: false, message: 'invalid state'};
    },
};

describe('CRDT proof invariant helpers', () => {
    it('asserts convergence for reordered and duplicated primitive delivery', () => {
        const doc = createDoc();
        const updates = [
            createCrdtUpdates(doc, replace([{type: 'key', key: 'title'}], 'First', 'Draft'), ts(1))[0],
            createCrdtUpdates(doc, replace([{type: 'key', key: 'title'}], 'Second', 'Draft'), ts(2))[0],
        ];
        const duplicated = duplicateUpdates(updates, {indices: [0, 1]});
        const shuffled = shuffleDeterministically(duplicated, 123);

        assertConverges([duplicated, shuffled, duplicated.toReversed()], (doc) => {
            expect(doc.state.title).toBe('Second');
        });
    });

    it('distinguishes non-ready pending updates from ready pending updates', () => {
        let author = createDoc();
        const createItem = oneUpdate(
            author,
            add([{type: 'key', key: 'items'}, {type: 'key', key: 'one'}], {
                name: 'One',
                child: {},
            }),
            ts(1),
        );
        author = applyCrdtUpdate(author, createItem);
        const renameItem = oneUpdate(
            author,
            replace(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                    {type: 'key', key: 'name'},
                ],
                'Renamed',
                'One',
            ),
            ts(2),
        );

        const waiting = applyCrdtUpdate(createDoc(), renameItem);
        expect(waiting.pending).toHaveLength(1);
        expect(() => expectNoReadyPending(waiting)).not.toThrow();

        const settled = applyCrdtUpdate(waiting, createItem);
        expect(settled.pending).toEqual([]);
        expect(settled.state.items.one.name).toBe('Renamed');
        expectNoReadyPending(settled);
    });
});

describe('CRDT targeted invariant regressions', () => {
    it('keeps primitive LWW sets convergent across older, newer, and duplicate delivery', () => {
        const doc = createDoc();
        const older = oneUpdate(
            doc,
            replace([{type: 'key', key: 'title'}], 'Older', 'Draft'),
            ts(1, 'left'),
        );
        const newer = oneUpdate(
            doc,
            replace([{type: 'key', key: 'title'}], 'Newer', 'Draft'),
            ts(2, 'right'),
        );

        assertConverges(
            [
                [older, newer],
                [newer, older],
                [older, older, newer, newer],
                [newer, older, newer, older],
            ],
            (doc) => expect(doc.state.title).toBe('Newer'),
        );
    });

    it('does not attach delayed child updates to a recreated record entry', () => {
        let author = createDoc();
        const createItem = oneUpdate(
            author,
            add([{type: 'key', key: 'items'}, {type: 'key', key: 'one'}], {
                name: 'One',
                child: {},
            }),
            ts(1),
        );
        author = applyCrdtUpdate(author, createItem);
        const setChild = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                    {type: 'key', key: 'child'},
                    {type: 'key', key: 'kid'},
                ],
                {name: 'Kid'},
            ),
            ts(2),
        );
        const deleteItem = oneUpdate(
            author,
            remove([{type: 'key', key: 'items'}, {type: 'key', key: 'one'}], {
                name: 'One',
                child: {},
            }),
            ts(3),
        );
        const recreateItem = oneUpdate(
            applyCrdtUpdate(author, deleteItem),
            add([{type: 'key', key: 'items'}, {type: 'key', key: 'one'}], {
                name: 'One again',
                child: {},
            }),
            ts(4),
        );

        assertConverges(
            [
                [createItem, setChild, deleteItem, recreateItem],
                [createItem, deleteItem, recreateItem, setChild],
                [setChild, createItem, deleteItem, recreateItem],
                [createItem, setChild, setChild, deleteItem, recreateItem, setChild],
            ],
            (doc) => expect(doc.state.items.one).toEqual({name: 'One again', child: {}}),
        );
    });

    it('settles record child updates that arrive before their parent creation', () => {
        let author = createDoc();
        const createItem = oneUpdate(
            author,
            add([{type: 'key', key: 'items'}, {type: 'key', key: 'one'}], {
                name: 'One',
                child: {},
            }),
            ts(1),
        );
        author = applyCrdtUpdate(author, createItem);
        const setChild = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'items'},
                    {type: 'key', key: 'one'},
                    {type: 'key', key: 'child'},
                    {type: 'key', key: 'kid'},
                ],
                {name: 'Kid'},
            ),
            ts(2),
        );

        assertConverges(
            [
                [createItem, setChild],
                [setChild, createItem],
                [setChild, setChild, createItem],
            ],
            (doc) => expect(doc.state.items.one.child.kid).toEqual({name: 'Kid'}),
        );
    });

    it('discards delayed nested object updates for an older object incarnation', () => {
        const doc = createDoc();
        const oldNestedUpdate = oneUpdate(
            doc,
            replace(
                [
                    {type: 'key', key: 'settings'},
                    {type: 'key', key: 'nested'},
                    {type: 'key', key: 'label'},
                ],
                'stale',
                'original',
            ),
            ts(1),
        );
        const replaceSettings = oneUpdate(
            doc,
            replace(
                [{type: 'key', key: 'settings'}],
                {theme: 'dark', nested: {label: 'fresh'}},
                initial.settings,
            ),
            ts(2),
        );

        assertConverges(
            [
                [oldNestedUpdate, replaceSettings],
                [replaceSettings, oldNestedUpdate],
                [replaceSettings, oldNestedUpdate, oldNestedUpdate],
            ],
            (doc) => expect(doc.state.settings).toEqual({theme: 'dark', nested: {label: 'fresh'}}),
        );
    });

    it('settles array item edits and reorders that arrive before item creation', () => {
        let author = createDoc();
        const append = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {id: 'two', title: 'Two', done: false},
            ),
            ts(1),
        );
        author = applyCrdtUpdate(author, append);
        const editSecond = oneUpdate(
            author,
            replace(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                    {type: 'key', key: 'done'},
                ],
                true,
                false,
            ),
            ts(2),
        );
        const reorderTodos = oneUpdate(
            author,
            reorder([{type: 'key', key: 'todos'}], [1, 0]),
            ts(3),
        );

        assertConverges(
            [
                [append, editSecond, reorderTodos],
                [editSecond, reorderTodos, append],
                [reorderTodos, editSecond, append],
                [editSecond, editSecond, reorderTodos, append],
            ],
            (doc) =>
                expect(doc.state.todos).toEqual([
                    {id: 'two', title: 'Two', done: true},
                    {id: 'one', title: 'One', done: false},
                ]),
        );
    });

    it('moves duplicate array values by item identity and converges across delivery order', () => {
        let author = createDoc();
        const appendDuplicate = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {id: 'one', title: 'One', done: true},
            ),
            ts(1),
        );
        author = applyCrdtUpdate(author, appendDuplicate);
        const appendThird = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 2},
                ],
                {id: 'three', title: 'Three', done: false},
            ),
            ts(2),
        );
        author = applyCrdtUpdate(author, appendThird);
        const moveDuplicate = oneUpdate(
            author,
            move([{type: 'key', key: 'todos'}], 1, 0, false),
            ts(3),
        );

        assertConverges(
            [
                [appendDuplicate, appendThird, moveDuplicate],
                [moveDuplicate, appendThird, appendDuplicate],
                [appendThird, moveDuplicate, appendDuplicate],
                [appendDuplicate, appendThird, moveDuplicate, moveDuplicate],
            ],
            (doc) =>
                expect(doc.state.todos).toEqual([
                    {id: 'one', title: 'One', done: true},
                    {id: 'one', title: 'One', done: false},
                    {id: 'three', title: 'Three', done: false},
                ]),
        );
    });

    it('keeps reordered setOrder updates for existing items convergent', () => {
        let author = createDoc();
        const appendSecond = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 1},
                ],
                {id: 'two', title: 'Two', done: false},
            ),
            ts(1),
        );
        author = applyCrdtUpdate(author, appendSecond);
        const appendThird = oneUpdate(
            author,
            add(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: 2},
                ],
                {id: 'three', title: 'Three', done: false},
            ),
            ts(2),
        );
        author = applyCrdtUpdate(author, appendThird);
        const olderOrder = oneUpdate(author, reorder([{type: 'key', key: 'todos'}], [1, 0, 2]), ts(3));
        const newerOrder = oneUpdate(author, reorder([{type: 'key', key: 'todos'}], [2, 1, 0]), ts(4));

        assertConverges(
            [
                [appendSecond, appendThird, olderOrder, newerOrder],
                [appendSecond, appendThird, newerOrder, olderOrder],
                [appendThird, newerOrder, appendSecond, olderOrder],
                [appendSecond, appendThird, olderOrder, newerOrder, olderOrder],
            ],
            (doc) =>
                expect(doc.state.todos.map((todo) => todo.id)).toEqual(['three', 'two', 'one']),
        );
    });

    it('discards delayed tagged-union field updates for old branches', () => {
        const doc = createDoc();
        const oldRadiusUpdate = oneUpdate(
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
            ts(1),
        );
        const replaceBranch = oneUpdate(
            doc,
            replace(
                [{type: 'key', key: 'selected'}],
                {type: 'text', text: 'fresh'},
                initial.selected,
            ),
            ts(2),
        );

        assertConverges(
            [
                [oldRadiusUpdate, replaceBranch],
                [replaceBranch, oldRadiusUpdate],
                [replaceBranch, oldRadiusUpdate, oldRadiusUpdate],
            ],
            (doc) => expect(doc.state.selected).toEqual({type: 'text', text: 'fresh'}),
        );
    });

    it('settles tagged-union branch field updates that arrive before branch creation', () => {
        let author = createDoc();
        const replaceBranch = oneUpdate(
            author,
            replace(
                [{type: 'key', key: 'selected'}],
                {type: 'text', text: 'fresh'},
                initial.selected,
            ),
            ts(1),
        );
        author = applyCrdtUpdate(author, replaceBranch);
        const updateText = oneUpdate(
            author,
            replace(
                [
                    {type: 'key', key: 'selected'},
                    {type: 'tag', key: 'type', value: 'text'},
                    {type: 'key', key: 'text'},
                ],
                'settled',
                'fresh',
            ),
            ts(2),
        );

        assertConverges(
            [
                [replaceBranch, updateText],
                [updateText, replaceBranch],
                [updateText, updateText, replaceBranch],
            ],
            (doc) => expect(doc.state.selected).toEqual({type: 'text', text: 'settled'}),
        );
    });

    it('validates HLC suffix ordering outside applyCrdtUpdate', () => {
        const doc = createDoc();
        const base = ts(1);
        const suffixed = hlc.withSuffix(base, 'migration-1');
        const baseUpdate = oneUpdate(
            doc,
            replace([{type: 'key', key: 'title'}], 'base', 'Draft'),
            base,
        );
        const suffixedUpdate = oneUpdate(
            doc,
            replace([{type: 'key', key: 'title'}], 'suffixed', 'Draft'),
            suffixed,
        );

        expect(base < suffixed).toBe(true);
        assertConverges(
            [
                [baseUpdate, suffixedUpdate],
                [suffixedUpdate, baseUpdate],
                [baseUpdate, baseUpdate, suffixedUpdate],
            ],
            (doc) => expect(doc.state.title).toBe('suffixed'),
        );
    });
});

describe('CRDT property invariants', () => {
    it('converges for generated valid histories under reordered and duplicated delivery', () => {
        fc.assert(
            fc.property(initialStateArb(), commandHistoryArb(), fc.integer(), (initialState, commands, seed) => {
                const {updates} = buildGeneratedHistory(initialState, commands);
                fc.pre(updates.length > 0);

                const schedules = [
                    updates,
                    updates.toReversed(),
                    shuffleDeterministically(updates, seed),
                    duplicateUpdates(shuffleDeterministically(updates, seed + 1), {
                        indices: updates.map((_, index) => index).filter((index) => index % 2 === 0),
                    }),
                ];
                const docs = schedules.map((schedule) => applyAll(createDocFrom(initialState), schedule));

                expectConverged(docs);
                for (const doc of docs) {
                    expectNoReadyPending(doc);
                    expectValidMaterializedState(doc, stateValidator);
                }
                for (const update of updates) {
                    expectValidCrdtUpdate(update, updateValidator);
                }

                const once = applyAll(createDocFrom(initialState), updates);
                const twice = applyAll(once, updates);
                expectConverged([once, twice]);
            }),
            {numRuns: 50, seed: 0x43524454},
        );
    });
});

function oneUpdate(doc: CrdtDocument<State>, patch: Patch<State>, timestamp: string) {
    const updates = createCrdtUpdates(doc, patch, timestamp);
    expect(updates).toHaveLength(1);
    return updates[0];
}

type GeneratedCommand =
    | {kind: 'setTitle'; value: string}
    | {kind: 'setCount'; value: number}
    | {kind: 'setNestedLabel'; value: string}
    | {kind: 'setRecord'; key: string; value: Item}
    | {kind: 'deleteRecord'; key: string}
    | {kind: 'setRecordChild'; key: string; childKey: string; value: string}
    | {kind: 'appendTodo'; value: Todo}
    | {kind: 'deleteTodo'; index: number}
    | {kind: 'editTodoDone'; index: number; value: boolean}
    | {kind: 'moveTodo'; fromIdx: number; targetIdx: number; after: boolean}
    | {kind: 'reorderTodos'}
    | {kind: 'setSelected'; value: Shape}
    | {kind: 'editSelectedText'; value: string}
    | {kind: 'editSelectedRadius'; value: number};

function buildGeneratedHistory(initialState: State, commands: readonly GeneratedCommand[]) {
    let doc = createDocFrom(initialState);
    const updates: CrdtUpdate[] = [];
    for (let i = 0; i < commands.length; i++) {
        const patch = patchForCommand(doc.state, commands[i]);
        if (!patch) continue;
        for (const update of createCrdtUpdates(doc, patch, ts(i + 1, `gen-${i % 3}`))) {
            updates.push(update);
            doc = applyCrdtUpdate(doc, update);
        }
    }
    return {doc, updates};
}

function patchForCommand(state: State, command: GeneratedCommand): Patch<State> | null {
    switch (command.kind) {
        case 'setTitle':
            return replace([{type: 'key', key: 'title'}], command.value, state.title);
        case 'setCount':
            return replace([{type: 'key', key: 'count'}], command.value, state.count);
        case 'setNestedLabel':
            return replace(
                [
                    {type: 'key', key: 'settings'},
                    {type: 'key', key: 'nested'},
                    {type: 'key', key: 'label'},
                ],
                command.value,
                state.settings.nested.label,
            );
        case 'setRecord':
            return state.items[command.key]
                ? replace([{type: 'key', key: 'items'}, {type: 'key', key: command.key}], command.value, state.items[command.key])
                : add([{type: 'key', key: 'items'}, {type: 'key', key: command.key}], command.value);
        case 'deleteRecord': {
            const existing = state.items[command.key];
            return existing
                ? remove([{type: 'key', key: 'items'}, {type: 'key', key: command.key}], existing)
                : null;
        }
        case 'setRecordChild': {
            const item = state.items[command.key];
            if (!item) return null;
            const path: Patch<State>['path'] = [
                {type: 'key', key: 'items'},
                {type: 'key', key: command.key},
                {type: 'key', key: 'child'},
                {type: 'key', key: command.childKey},
            ];
            const value = {name: command.value};
            return item.child[command.childKey]
                ? replace(path, value, item.child[command.childKey])
                : add(path, value);
        }
        case 'appendTodo':
            return add([{type: 'key', key: 'todos'}, {type: 'key', key: state.todos.length}], command.value);
        case 'deleteTodo': {
            if (!state.todos.length) return null;
            const index = command.index % state.todos.length;
            return remove([{type: 'key', key: 'todos'}, {type: 'key', key: index}], state.todos[index]);
        }
        case 'editTodoDone': {
            if (!state.todos.length) return null;
            const index = command.index % state.todos.length;
            return replace(
                [
                    {type: 'key', key: 'todos'},
                    {type: 'key', key: index},
                    {type: 'key', key: 'done'},
                ],
                command.value,
                state.todos[index].done,
            );
        }
        case 'moveTodo': {
            if (state.todos.length < 2) return null;
            const fromIdx = command.fromIdx % state.todos.length;
            const targetIdx = command.targetIdx % state.todos.length;
            return move([{type: 'key', key: 'todos'}], fromIdx, targetIdx, command.after);
        }
        case 'reorderTodos':
            return state.todos.length > 1
                ? reorder(
                      [{type: 'key', key: 'todos'}],
                      state.todos.map((_, index) => state.todos.length - index - 1),
                  )
                : null;
        case 'setSelected':
            return replace([{type: 'key', key: 'selected'}], command.value, state.selected);
        case 'editSelectedText':
            return state.selected.type === 'text'
                ? replace(
                      [
                          {type: 'key', key: 'selected'},
                          {type: 'tag', key: 'type', value: 'text'},
                          {type: 'key', key: 'text'},
                      ],
                      command.value,
                      state.selected.text,
                  )
                : null;
        case 'editSelectedRadius':
            return state.selected.type === 'circle'
                ? replace(
                      [
                          {type: 'key', key: 'selected'},
                          {type: 'tag', key: 'type', value: 'circle'},
                          {type: 'key', key: 'radius'},
                      ],
                      command.value,
                      state.selected.radius,
                  )
                : null;
    }
}

function createDocFrom(state: State) {
    return createCrdtDocument(state, schema, {timestamp: startTs});
}

function initialStateArb() {
    return fc.record<State>({
        title: smallStringArb('title'),
        count: fc.integer({min: 0, max: 5}),
        settings: fc.record({
            theme: smallStringArb('theme'),
            nested: fc.record({label: smallStringArb('label')}),
        }),
        items: fc.dictionary(fc.constantFrom('one', 'two'), itemArb(), {maxKeys: 2}),
        todos: fc.array(todoArb(), {minLength: 1, maxLength: 3}),
        selected: shapeArb(),
    });
}

function commandHistoryArb() {
    return fc.array(commandArb(), {minLength: 1, maxLength: 8});
}

function commandArb(): fc.Arbitrary<GeneratedCommand> {
    return fc.oneof(
        fc.record({kind: fc.constant('setTitle'), value: smallStringArb('title')}),
        fc.record({kind: fc.constant('setCount'), value: fc.integer({min: 0, max: 20})}),
        fc.record({kind: fc.constant('setNestedLabel'), value: smallStringArb('label')}),
        fc.record({kind: fc.constant('setRecord'), key: recordKeyArb(), value: itemArb()}),
        fc.record({kind: fc.constant('deleteRecord'), key: recordKeyArb()}),
        fc.record({
            kind: fc.constant('setRecordChild'),
            key: recordKeyArb(),
            childKey: childKeyArb(),
            value: smallStringArb('child'),
        }),
        fc.record({kind: fc.constant('appendTodo'), value: todoArb()}),
        fc.record({kind: fc.constant('deleteTodo'), index: fc.integer({min: 0, max: 4})}),
        fc.record({
            kind: fc.constant('editTodoDone'),
            index: fc.integer({min: 0, max: 4}),
            value: fc.boolean(),
        }),
        fc.record({
            kind: fc.constant('moveTodo'),
            fromIdx: fc.integer({min: 0, max: 4}),
            targetIdx: fc.integer({min: 0, max: 4}),
            after: fc.boolean(),
        }),
        fc.record({kind: fc.constant('reorderTodos')}),
        fc.record({kind: fc.constant('setSelected'), value: shapeArb()}),
        fc.record({kind: fc.constant('editSelectedText'), value: smallStringArb('text')}),
        fc.record({kind: fc.constant('editSelectedRadius'), value: fc.integer({min: 0, max: 20})}),
    );
}

function itemArb() {
    return fc.record<Item>({
        name: smallStringArb('item'),
        child: fc.dictionary(childKeyArb(), fc.record({name: smallStringArb('child')}), {
            maxKeys: 2,
        }),
    });
}

function todoArb() {
    return fc.record<Todo>({
        id: smallStringArb('todo'),
        title: smallStringArb('todo'),
        done: fc.boolean(),
    });
}

function shapeArb() {
    return fc.oneof<Shape>(
        fc.record({type: fc.constant('circle'), radius: fc.integer({min: 0, max: 20})}),
        fc.record({type: fc.constant('text'), text: smallStringArb('text')}),
    );
}

function recordKeyArb() {
    return fc.constantFrom('one', 'two', 'three');
}

function childKeyArb() {
    return fc.constantFrom('kid', 'pal');
}

function smallStringArb(prefix: string) {
    return fc.integer({min: 0, max: 20}).map((value) => `${prefix}-${value}`);
}

function assertConverges(
    schedules: readonly (readonly CrdtUpdate[])[],
    check?: (doc: CrdtDocument<State>) => void,
) {
    const docs = schedules.map((updates) => applyAll(createDoc(), updates));
    expectConverged(docs);
    for (const doc of docs) {
        expectNoReadyPending(doc);
        expectValidMaterializedState(doc, stateValidator);
        check?.(doc);
    }
    for (const update of new Set(schedules.flat())) {
        expectValidCrdtUpdate(update, updateValidator);
    }
}

function validateState(input: unknown): input is State {
    if (!input || typeof input !== 'object') return false;
    const value = input as State;
    return (
        typeof value.title === 'string' &&
        typeof value.count === 'number' &&
        validateSettings(value.settings) &&
        validateItems(value.items) &&
        validateTodos(value.todos) &&
        validateShape(value.selected)
    );
}

function validateSettings(input: unknown): input is State['settings'] {
    if (!input || typeof input !== 'object') return false;
    const value = input as State['settings'];
    return (
        typeof value.theme === 'string' &&
        !!value.nested &&
        typeof value.nested === 'object' &&
        typeof value.nested.label === 'string'
    );
}

function validateItems(input: unknown): input is State['items'] {
    if (!input || typeof input !== 'object') return false;
    for (const item of Object.values(input as State['items'])) {
        if (!item || typeof item !== 'object' || typeof item.name !== 'string') return false;
        if (!item.child || typeof item.child !== 'object') return false;
        for (const child of Object.values(item.child)) {
            if (!child || typeof child !== 'object' || typeof child.name !== 'string') return false;
        }
    }
    return true;
}

function validateTodos(input: unknown): input is State['todos'] {
    return (
        Array.isArray(input) &&
        input.every(
            (todo) =>
                todo &&
                typeof todo === 'object' &&
                typeof todo.id === 'string' &&
                typeof todo.title === 'string' &&
                typeof todo.done === 'boolean',
        )
    );
}

function validateShape(input: unknown): input is Shape {
    if (!input || typeof input !== 'object') return false;
    const value = input as Shape;
    if (value.type === 'circle') return typeof value.radius === 'number';
    if (value.type === 'text') return typeof value.text === 'string';
    return false;
}
