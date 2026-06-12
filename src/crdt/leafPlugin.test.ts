import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {applyMany, cachedState, insertTextOps, stateToString, validateOp} from '../block-crdt/index.js';
import {initialState} from '../block-crdt/initialState.js';
import type {Op, State as BlockState} from '../block-crdt/types.js';
import {
    applyCrdtUpdate,
    changedNormalPathsForCrdtUpdate,
    createCrdtDocument,
    createCrdtUpdates,
    createCrdtUpdateValidator,
    type LeafCrdtPlugin,
} from './index.js';
import type {JsonValue} from './types.js';
import type {Patch} from '../types.js';

type BlockDoc = {
    body: BlockState;
};

const blockSchema = {
    schemas: [
        {
            type: 'object',
            properties: {
                body: {
                    type: 'object',
                    'x-umkehr-leaf-crdt': 'test.block-crdt',
                    'x-umkehr-leaf-crdt-version': 1,
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [BlockDoc]>;

const seedTs = '000000000000000:00000:seed';
const aliceTs = '000000000000010:00000:alice';
const bobTs = '000000000000011:00000:bob';

const blockLeafPlugin: LeafCrdtPlugin<'test.block-crdt'> = {
    id: 'test.block-crdt',
    version: 1,
    empty() {
        return initialState('seed', seedTs) as JsonValue;
    },
    isValue(value): value is JsonValue {
        return Boolean(
            value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                (value as {chars?: unknown}).chars &&
                (value as {blocks?: unknown}).blocks,
        );
    },
    init({value}) {
        const state = this.isValue(value) ? value : (initialState('seed', seedTs) as JsonValue);
        return {value: state, meta: {maxSeenCount: (state as BlockState).maxSeenCount}};
    },
    createOperations({change}) {
        return Array.isArray(change) ? change : [change as JsonValue];
    },
    applyOperation({value, operation}) {
        const state = applyMany(cachedState(value as BlockState), [operation as unknown as Op]).state;
        return {
            value: state as JsonValue,
            meta: {maxSeenCount: state.maxSeenCount},
        };
    },
    validateOperation(input) {
        const result = validateOp(input as unknown as Op);
        return result.valid
            ? {success: true, data: input as JsonValue}
            : {
                  success: false,
                  errors: result.errors.map((message) => ({path: '<operation>', message})),
              };
    },
};

const createDoc = (actor = 'seed') =>
    createCrdtDocument(
        {body: initialState(actor, seedTs)},
        blockSchema,
        {timestamp: seedTs, leafPlugins: [blockLeafPlugin]},
    );

const leafPatch = (change: JsonValue): Patch<BlockDoc> => ({
    op: 'leaf',
    plugin: 'test.block-crdt',
    path: [{type: 'key', key: 'body'}],
    change,
});

describe('leaf CRDT plugins', () => {
    it('applies and validates raw block-crdt leaf operations', () => {
        let doc = createDoc('seed');
        const ops = insertTextOps(cachedState(doc.state.body), {
            actor: 'alice',
            block: [0, 'seed'],
            offset: 0,
            text: 'hi',
            ts: () => aliceTs,
        });
        const validator = createCrdtUpdateValidator(blockSchema, {leafPlugins: [blockLeafPlugin]});

        for (const op of ops) {
            const [update] = createCrdtUpdates(doc, leafPatch(op as unknown as JsonValue), aliceTs, {
                sessionId: 'alice',
            });
            expect(validator.validate(update)).toMatchObject({success: true});
            const next = applyCrdtUpdate(doc, update);
            expect(changedNormalPathsForCrdtUpdate(doc, next, update)).toEqual([
                [{type: 'key', key: 'body'}],
            ]);
            doc = next;
        }

        expect(stateToString(cachedState(doc.state.body))).toContain('hi');
    });

    it('converges block-crdt leaf operations from different sessions', () => {
        let left = createDoc('seed');
        let right = createDoc('seed');
        const leftOp = insertTextOps(cachedState(left.state.body), {
            actor: 'alice',
            block: [0, 'seed'],
            offset: 0,
            text: 'A',
            ts: () => aliceTs,
        })[0];
        const rightOp = insertTextOps(cachedState(right.state.body), {
            actor: 'bob',
            block: [0, 'seed'],
            offset: 0,
            text: 'B',
            ts: () => bobTs,
        })[0];
        if (!leftOp || !rightOp) throw new Error('missing block operation');
        const [leftUpdate] = createCrdtUpdates(left, leafPatch(leftOp as unknown as JsonValue), aliceTs, {
            sessionId: 'alice',
        });
        const [rightUpdate] = createCrdtUpdates(right, leafPatch(rightOp as unknown as JsonValue), bobTs, {
            sessionId: 'bob',
        });

        left = applyCrdtUpdate(applyCrdtUpdate(left, leftUpdate), rightUpdate);
        right = applyCrdtUpdate(applyCrdtUpdate(right, rightUpdate), leftUpdate);

        expect(left.state.body).toEqual(right.state.body);
        expect(stateToString(cachedState(left.state.body))).toContain('A');
        expect(stateToString(cachedState(left.state.body))).toContain('B');
    });

    it('rejects missing or mismatched required block plugins', () => {
        expect(() =>
            createCrdtDocument({body: initialState('seed', seedTs)}, blockSchema, {timestamp: seedTs}),
        ).toThrow(/Missing required leaf CRDT plugin/);
        expect(() =>
            createCrdtDocument({body: initialState('seed', seedTs)}, blockSchema, {
                timestamp: seedTs,
                leafPlugins: [{...blockLeafPlugin, version: 2}],
            }),
        ).toThrow(/version mismatch/);
    });
});
