import {describe, expect, it} from 'vitest';
import type {DocumentNode, TransactionOp} from '@plim/core';
import {
    applyMany,
    blockContents,
    insertTextOps,
    joinBlocksOps,
    parseLamportString,
    retainSelection,
    splitBlockOps,
    stateToString,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {
    applyLocalTransaction,
    applyRemoteOps,
    createAdapterState,
    createPlimEditorState,
    crdtToPlimDocument,
    plimPathToBlockId,
    plimPositionToBlockPoint,
    retainedSelectionToPlimSelection,
    translateTransaction,
} from './plimBlockCrdtAdapter';
import {createFixtureState, makeTs} from './fixtures';

describe('plim block crdt adapter', () => {
    it('materializes block-crdt state into Plim document nodes', () => {
        const state = createFixtureState();
        const doc = crdtToPlimDocument(state);

        expect(doc.children.map((block) => ({id: block.id, type: block.type, attrs: block.attrs}))).toEqual([
            {id: '0000-alice', type: 'paragraph', attrs: {tone: 'plain'}},
            {id: doc.children[1].id, type: 'heading', attrs: {level: 2}},
        ]);
        expect(doc.children[0].text).toEqual([
            {text: 'Hello', marks: [{type: 'bold', attrs: undefined}]},
            {text: ' 👩‍💻', marks: undefined},
        ]);
        expect(doc.children[0].children?.[0]).toMatchObject({
            id: doc.children[0].children?.[0].id,
            type: 'todo',
            attrs: {checked: false},
            text: [{text: 'Ship adapter', marks: undefined}],
        });
    });

    it('maps Plim paths and UTF-16 offsets to CRDT block/grapheme points', () => {
        const doc = crdtToPlimDocument(createFixtureState());

        expect(plimPathToBlockId(doc, [0])).toBe('0000-alice');
        expect(plimPathToBlockId(doc, [0, 0])).toBe(doc.children[0].children?.[0].id);
        expect(plimPositionToBlockPoint(doc, {path: [0], offset: 'Hello '.length + 3})).toEqual({
            blockId: '0000-alice',
            offset: 6,
        });
    });

    it('translates replaceText with grapheme offsets and marks', () => {
        const state = createFixtureState();
        const doc = crdtToPlimDocument(state);
        const tx = {
            ops: [
                {
                    kind: 'replaceText',
                    path: [0],
                    from: 'Hello '.length,
                    to: 'Hello 👩‍💻'.length,
                    insert: [{text: 'e\u0301', marks: [{type: 'italic'}]}],
                } satisfies TransactionOp,
            ],
        };

        const translated = translateTransaction(state, doc, tx, {actor: 'bob', ts: makeTs(100)});
        const next = applyMany(state, translated.ops);

        expect(translated.unsupported).toEqual([]);
        expect(blockContents(next, '0000-alice')).toBe('Hello e\u0301');
        expect(createPlimEditorState(next).doc.children[0].text).toContainEqual({
            text: 'e\u0301',
            marks: [{type: 'italic', attrs: undefined}],
        });
    });

    it('uses post-Plim selection after paste-like replaceText transactions', () => {
        const adapter = createAdapterState(createFixtureState());
        const tx = {
            ops: [
                {
                    kind: 'replaceText',
                    path: [0],
                    from: 0,
                    to: 0,
                    insert: [{text: 'Paste '}],
                } satisfies TransactionOp,
            ],
        };
        const postPlim = {
            doc: {
                ...adapter.plim.doc,
                children: [
                    {
                        ...adapter.plim.doc.children[0],
                        text: [{text: 'Paste Hello 👩‍💻'}],
                    },
                    ...adapter.plim.doc.children.slice(1),
                ],
            },
            selection: {
                anchor: {path: [0], offset: 'Paste '.length},
                head: {path: [0], offset: 'Paste '.length},
            },
        };

        const next = applyLocalTransaction(adapter, tx, {actor: 'bob', ts: makeTs(100)}, postPlim);

        expect(blockContents(next.crdt, '0000-alice')).toBe('Paste Hello 👩‍💻');
        expect(next.plim.selection).toEqual({
            anchor: {path: [0], offset: 'Paste '.length},
            head: {path: [0], offset: 'Paste '.length},
        });
    });

    it('retains split selection against canonical CRDT ids instead of Plim temporary ids', () => {
        const adapter = createAdapterState(createFixtureState());
        const tx = {
            ops: [
                {
                    kind: 'splitBlock',
                    path: [0],
                    offset: 5,
                } satisfies TransactionOp,
            ],
        };
        const postPlim = {
            doc: {
                ...adapter.plim.doc,
                children: [
                    {
                        ...adapter.plim.doc.children[0],
                        text: [{text: 'Hello'}],
                    },
                    {
                        id: 'temporary-split-id',
                        type: 'paragraph',
                        attrs: {tone: 'plain'},
                        text: [{text: ' 👩‍💻'}],
                    },
                    ...adapter.plim.doc.children.slice(1),
                ],
            },
            selection: {
                anchor: {path: [1], offset: 0},
                head: {path: [1], offset: 0},
            },
        };

        const next = applyLocalTransaction(adapter, tx, {actor: 'bob', ts: makeTs(100)}, postPlim);

        expect(next.plim.selection).toEqual({
            anchor: {path: [1], offset: 0},
            head: {path: [1], offset: 0},
        });
        expect(next.plim.doc.children[1].id).not.toBe('temporary-split-id');
        expect(next.retainedSelection).toMatchObject({
            type: 'caret',
            point: {blockId: next.plim.doc.children[1].id, charId: null, affinity: 'after'},
        });
    });

    it('translates split, join, insert block, block-only remove, move, metadata, and marks', () => {
        const state = createFixtureState();
        const doc = crdtToPlimDocument(state);
        const tx = {
            ops: [
                {kind: 'splitBlock', path: [1], offset: 4, newType: 'paragraph'} satisfies TransactionOp,
                {
                    kind: 'insertBlock',
                    path: [2],
                    block: {id: 'temporary', type: 'divider', attrs: {size: 'sm'}},
                } satisfies TransactionOp,
                {kind: 'setBlockAttrs', path: [0], attrs: {tone: 'info'}} satisfies TransactionOp,
                {kind: 'toggleMark', path: [0], from: 0, to: 5, mark: {type: 'bold'}} satisfies TransactionOp,
            ],
        };

        const translated = translateTransaction(state, doc, tx, {actor: 'bob', ts: makeTs(100)});
        const next = applyMany(state, translated.ops);
        const nextDoc = crdtToPlimDocument(next);

        expect(translated.unsupported).toEqual([]);
        expect(nextDoc.children.map((block) => block.id)).not.toContain('temporary');
        expect(nextDoc.children[0].attrs).toEqual({tone: 'info'});
        expect(nextDoc.children[0].text?.[0]).toEqual({text: 'Hello 👩‍💻', marks: undefined});
        expect(nextDoc.children.map((block) => block.type)).toContain('divider');
    });

    it('uses block-only deletion and splices visible children upward', () => {
        const state = createFixtureState();
        const doc = crdtToPlimDocument(state);
        const translated = translateTransaction(
            state,
            doc,
            {ops: [{kind: 'removeBlock', path: [0]} satisfies TransactionOp]},
            {actor: 'bob', ts: makeTs(100)},
        );
        const next = applyMany(state, translated.ops);

        expect(crdtToPlimDocument(next).children.map((block) => block.type).sort()).toEqual(['heading', 'todo']);
    });

    it('resolves retained selections back into Plim UTF-16 offsets after remote edits', () => {
        let state = createFixtureState();
        const retained = retainSelection(state, {type: 'caret', point: {blockId: '0000-alice', offset: 6}});

        state = applyMany(
            state,
            insertTextOps(state, {
                actor: 'remote',
                block: [0, 'alice'],
                offset: 0,
                text: 'Yo ',
                ts: makeTs(200),
            }),
        );

        const doc = crdtToPlimDocument(state);
        expect(retainedSelectionToPlimSelection(state, doc, retained)).toEqual({
            anchor: {path: [0], offset: 'Yo Hello '.length},
            head: {path: [0], offset: 'Yo Hello '.length},
        });
    });

    it('applies remote ops and converges two adapter replicas', () => {
        const base = createFixtureState();
        const left = createAdapterState(base);
        const right = createAdapterState(base);

        const leftTx = {
            ops: [{kind: 'replaceText', path: [0], from: 0, to: 0, insert: [{text: 'A'}]} satisfies TransactionOp],
        };
        const rightOps = insertTextOps(base, {
            actor: 'remote',
            block: [0, 'alice'],
            offset: 0,
            text: 'B',
            ts: makeTs(300),
        });

        const afterLeft = applyLocalTransaction(left, leftTx, {actor: 'local', ts: makeTs(100)});
        const leftWithRemote = applyRemoteOps(afterLeft, rightOps);
        const rightWithLocal = applyRemoteOps(right, afterLeft.ops);
        const rightFinal = applyRemoteOps(rightWithLocal, rightOps);

        expect(stateToString(leftWithRemote.crdt)).toBe(stateToString(rightFinal.crdt));
    });

    it('resolves joined right-block selections into the visible left block stream', () => {
        let state = createFixtureState();
        state = applyMany(state, splitBlockOps(state, {actor: 'alice', block: [0, 'alice'], offset: 6, ts: '00300'}));
        const [left, right] = visibleBlockChildren(state, '0000-root').map(parseLamportString);
        const retained = retainSelection(state, {
            type: 'caret',
            point: {blockId: `${right[0].toString().padStart(4, '0')}-${right[1]}`, offset: 1},
        });

        state = applyMany(state, joinBlocksOps(state, {actor: 'alice', left, right, ts: '00301'}));
        const doc = crdtToPlimDocument(state);

        expect(retainedSelectionToPlimSelection(state, doc, retained)).toEqual({
            anchor: {path: [0], offset: 'Hello 👩‍💻'.length},
            head: {path: [0], offset: 'Hello 👩‍💻'.length},
        });
    });
});
