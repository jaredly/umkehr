import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {insertTextOps} from '../block-crdt/index.js';
import {
    BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    blockRichText,
    blockRichTextBuilderExtension,
    blockRichTextLeafPlugin,
    blockRichTextRootBlockId,
    blockRichTextToString,
    cachedBlockRichTextValue,
    type BlockRichText,
} from '../block-richtext/index.js';
import type {PollMeta, RichBlockMeta} from '../block-editor/index.js';
import {schemaFingerprintInput} from '../migration/index.js';
import {
    applyCrdtUpdate,
    applyLocalCommand,
    applyRemoteHistoryUpdate,
    changedNormalPathsForCrdtUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    createCrdtDocument,
    createCrdtLocalHistory,
    createCrdtUpdates,
    createCrdtUpdateValidator,
    hlc,
    redoLocalCommand,
    undoLocalCommand,
} from './index.js';
import {createPatchBuilder} from '../helper.js';
import type {JsonValue} from './types.js';
import type {Patch} from '../types.js';

type BlockDoc = {
    body: BlockRichText;
};

type BlockBuilderExtensions = [typeof blockRichTextBuilderExtension];
const createBlockPatchBuilder = () =>
    createPatchBuilder<BlockDoc, BlockBuilderExtensions>({
        builderExtensions: [blockRichTextBuilderExtension],
    });

const blockSchema = {
    schemas: [
        {
            type: 'object',
            properties: {
                body: {
                    type: 'object',
                    'x-umkehr-leaf-crdt': BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
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

const createDoc = (actor = 'seed') =>
    createCrdtDocument({body: blockRichText(actor, seedTs)}, blockSchema, {
        timestamp: seedTs,
        leafPlugins: [blockRichTextLeafPlugin],
    });

const leafPatch = (change: JsonValue): Patch<BlockDoc> => ({
    op: 'leaf',
    plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    path: [{type: 'key', key: 'body'}],
    change,
});

describe('leaf CRDT plugins', () => {
    it('applies and validates raw block-crdt leaf operations through the exported plugin', () => {
        let doc = createDoc('seed');
        const ops = insertTextOps(cachedBlockRichTextValue(doc.state.body), {
            actor: 'alice',
            block: [0, 'seed'],
            offset: 0,
            text: 'hi',
            ts: () => aliceTs,
        });
        const validator = createCrdtUpdateValidator(blockSchema, {
            leafPlugins: [blockRichTextLeafPlugin],
        });

        const [update] = createCrdtUpdates(
            doc,
            leafPatch({kind: 'ops', ops} as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );
        expect(validator.validate(update)).toMatchObject({success: true});
        const next = applyCrdtUpdate(doc, update);
        expect(changedNormalPathsForCrdtUpdate(doc, next, update)).toEqual([
            [{type: 'key', key: 'body'}],
        ]);
        doc = next;

        const [secondUpdate] = createCrdtUpdates(
            doc,
            leafPatch({kind: 'ops', ops: ops.slice(1)} as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );
        expect(validator.validate(secondUpdate)).toMatchObject({success: true});
        doc = applyCrdtUpdate(doc, secondUpdate);

        expect(blockRichTextToString(doc.state.body)).toContain('hi');
    });

    it('creates and applies high-level block rich text changes', () => {
        let doc = createDoc('seed');
        const [update] = createCrdtUpdates(
            doc,
            leafPatch({
                kind: 'insertText',
                block: blockRichTextRootBlockId(),
                offset: 0,
                text: 'hi',
            } as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );

        expect(update.plugin).toBe(BLOCK_RICH_TEXT_LEAF_PLUGIN_ID);
        doc = applyCrdtUpdate(doc, update);

        expect(blockRichTextToString(doc.state.body)).toContain('h');
        expect(doc.state.body.state.maxSeenCount).toBeGreaterThan(0);
    });

    it('applies rich block metadata through block-richtext changes', () => {
        let doc = createDoc('seed');
        const heading: RichBlockMeta = {type: 'heading', level: 2, ts: aliceTs};
        const [update] = createCrdtUpdates(
            doc,
            leafPatch({
                kind: 'setBlockMeta',
                block: blockRichTextRootBlockId(),
                meta: heading,
            } as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );

        doc = applyCrdtUpdate(doc, update);

        expect(doc.state.body.state.blocks[blockRichTextRootBlockId()]?.meta).toEqual(heading);
    });

    it('merges rich poll metadata when raw ops arrive through the leaf plugin', () => {
        let doc = createDoc('seed');
        const firstPoll: PollMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            max: 5,
            votes: {
                ada: {type: 'single', optionId: '5', ts: aliceTs},
            },
            ts: aliceTs,
        };
        const secondPoll: PollMeta = {
            ...firstPoll,
            votes: {
                ben: {type: 'single', optionId: '4', ts: bobTs},
            },
            ts: bobTs,
        };
        const blockId = blockRichTextRootBlockId();
        const [firstUpdate] = createCrdtUpdates(
            doc,
            leafPatch({
                kind: 'ops',
                ops: [{type: 'block:meta', id: [0, 'seed'], meta: firstPoll}],
            } as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );
        doc = applyCrdtUpdate(doc, firstUpdate);

        const [secondUpdate] = createCrdtUpdates(
            doc,
            leafPatch({
                kind: 'ops',
                ops: [{type: 'block:meta', id: [0, 'seed'], meta: secondPoll}],
            } as unknown as JsonValue),
            bobTs,
            {sessionId: 'bob'},
        );
        doc = applyCrdtUpdate(doc, secondUpdate);

        expect(doc.state.body.state.blocks[blockId]?.meta).toMatchObject({
            type: 'poll',
            votes: {
                ada: {optionId: '5'},
                ben: {optionId: '4'},
            },
        });
    });

    it('converges block-crdt leaf operations from different sessions', () => {
        let left = createDoc('seed');
        let right = createDoc('seed');
        const leftUpdate = createCrdtUpdates(
            left,
            leafPatch({
                kind: 'insertText',
                block: blockRichTextRootBlockId(),
                offset: 0,
                text: 'A',
            } as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        )[0];
        const rightUpdate = createCrdtUpdates(
            right,
            leafPatch({
                kind: 'insertText',
                block: blockRichTextRootBlockId(),
                offset: 0,
                text: 'B',
            } as unknown as JsonValue),
            bobTs,
            {sessionId: 'bob'},
        )[0];
        if (!leftUpdate || !rightUpdate) throw new Error('missing block operation');

        left = applyCrdtUpdate(applyCrdtUpdate(left, leftUpdate), rightUpdate);
        right = applyCrdtUpdate(applyCrdtUpdate(right, rightUpdate), leftUpdate);

        expect(left.state.body).toEqual(right.state.body);
        expect(blockRichTextToString(left.state.body)).toContain('A');
        expect(blockRichTextToString(left.state.body)).toContain('B');
    });

    it('includes block plugin descriptors in schema fingerprints', () => {
        expect(schemaFingerprintInput(blockSchema).leafPlugins).toEqual([
            {id: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID, version: 1},
        ]);
    });

    it('rejects missing or mismatched required block plugins', () => {
        expect(() =>
            createCrdtDocument({body: blockRichText()}, blockSchema, {timestamp: seedTs}),
        ).toThrow(/Missing required leaf CRDT plugin/);
        expect(() =>
            createCrdtDocument({body: blockRichText()}, blockSchema, {
                timestamp: seedTs,
                leafPlugins: [{...blockRichTextLeafPlugin, version: 2}],
            }),
        ).toThrow(/version mismatch/);
    });

    it('rejects invalid raw block-crdt leaf operations', () => {
        expect(blockRichTextLeafPlugin.validateOperation({type: 'unknown'})).toMatchObject({
            success: false,
        });
        const validator = createCrdtUpdateValidator(blockSchema, {
            leafPlugins: [blockRichTextLeafPlugin],
        });
        const doc = createDoc('seed');
        const [update] = createCrdtUpdates(
            doc,
            leafPatch({
                kind: 'ops',
                ops: [{type: 'block', block: {id: [1, 'bad'], order: {path: []}}}],
            } as unknown as JsonValue),
            aliceTs,
            {sessionId: 'alice'},
        );

        expect(validator.validate(update)).toMatchObject({
            success: false,
            errors: [expect.objectContaining({path: 'change/<operation>'})],
        });
    });

    it('undoes and redoes grouped block rich text inserts with fresh operations', () => {
        const base = createCrdtLocalHistory(createDoc('seed'));
        const $ = createBlockPatchBuilder();
        const applied = applyLocalCommand(
            base,
            $.body.$block.insertText({block: blockRichTextRootBlockId(), offset: 0, text: 'hi'}),
            hlc.init('local', 10),
        );

        expect(blockRichTextToString(applied.history.doc.state.body)).toContain('hi');
        expect(applied.updates).toHaveLength(2);
        expect(canUndoLocalCommand(applied.history, 'local')).toBe(true);

        const undone = undoLocalCommand(applied.history, 'local', applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(blockRichTextToString(undone.history.doc.state.body)).not.toContain('hi');
        expect(undone.updates).toHaveLength(2);
        expect(canRedoLocalCommand(undone.history, 'local')).toBe(true);

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(blockRichTextToString(redone.history.doc.state.body)).toContain('hi');
        expect(redone.updates).toHaveLength(2);
        expect(redone.updates[0]?.op === 'leaf' ? redone.updates[0].change : null).not.toEqual(
            applied.updates[0]?.op === 'leaf' ? applied.updates[0].change : null,
        );
    });

    it('undoes and redoes block rich text deletes', () => {
        let history = createCrdtLocalHistory(createDoc('seed'));
        const $ = createBlockPatchBuilder();
        const inserted = applyLocalCommand(
            history,
            $.body.$block.insertText({block: blockRichTextRootBlockId(), offset: 0, text: 'hi'}),
            hlc.init('local', 10),
        );
        history = inserted.history;
        const deleted = applyLocalCommand(
            history,
            $.body.$block.deleteRange({
                block: blockRichTextRootBlockId(),
                startOffset: 0,
                endOffset: 2,
            }),
            inserted.clock,
        );

        expect(blockRichTextToString(deleted.history.doc.state.body)).not.toContain('hi');
        expect(canUndoLocalCommand(deleted.history, 'local')).toBe(true);

        const undone = undoLocalCommand(deleted.history, 'local', deleted.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(blockRichTextToString(undone.history.doc.state.body)).toContain('hi');
        expect(canRedoLocalCommand(undone.history, 'local')).toBe(true);

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(blockRichTextToString(redone.history.doc.state.body)).not.toContain('hi');
    });

    it('blocks undo when a local block insert was deleted remotely', () => {
        const base = createCrdtLocalHistory(createDoc('seed'));
        const $ = createBlockPatchBuilder();
        const applied = applyLocalCommand(
            base,
            $.body.$block.insertText({block: blockRichTextRootBlockId(), offset: 0, text: 'h'}),
            hlc.init('local', 10),
        );
        const inserted =
            applied.updates[0]?.op === 'leaf'
                ? (applied.updates[0].change as {char?: {id?: unknown}}).char?.id
                : undefined;
        if (!Array.isArray(inserted)) throw new Error('missing inserted char id');

        const remote = applyRemoteHistoryUpdate(applied.history, {
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: applied.updates[0]?.op === 'leaf' ? applied.updates[0].path : [],
            change: {
                type: 'char:delete',
                id: inserted,
                deleted: {value: true, ts: '000000000000020:00000:remote'},
            } as unknown as JsonValue,
            ts: '000000000000020:00000:remote',
        });

        expect(canUndoLocalCommand(remote, 'local')).toBe(false);
        const undone = undoLocalCommand(remote, 'local', applied.clock);
        expect(undone.ok).toBe(false);
        expect(undone.reason).toBe('blocked');
        expect(undone.blocked?.[0]?.reason).toBe('deleted');
    });
});
