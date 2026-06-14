import {describe, expect, it} from 'vitest';
import {apps, registeredAppForId, routeIdForRegisteredApp} from './appRegistry';
import {createPatchBuilder} from 'umkehr';
import {applyCrdtUpdate, createCrdtUpdates, hlc} from 'umkehr/crdt';
import {
    BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    blockRichTextBuilderExtension,
    blockRichTextRootBlockId,
    blockRichTextToString,
} from 'umkehr/block-richtext';
import {createInitialCrdtHistory} from './crdtApp';
import {validateCrdtUpdatesForApp} from './documentArchive';
import {schemaFingerprint} from './local-first/schemaFingerprint';
import {blockNotesApp} from '../apps/block-notes/BlockNotesApp';
import type {BlockNotesState} from '../apps/block-notes/model';

describe('app registry', () => {
    it('allows @ versions in URL app ids without changing AppDefinition.id', () => {
        const registered = registeredAppForId('todos@1');
        expect(registered.app.id).toBe('todos');
        expect(routeIdForRegisteredApp(registered)).toBe('todos@1');
        expect(apps.map((app) => app.id)).toContain('todos@3');
    });

    it('registers the block notes fixture with its leaf plugin and validates block updates', () => {
        const registered = registeredAppForId('block-notes');
        expect(registered.app.id).toBe('block-notes');
        expect(apps.map((app) => app.id)).toContain('block-notes');
        expect(blockNotesApp.leafPlugins?.map((plugin) => plugin.id)).toEqual([
            BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
        ]);
        expect(schemaFingerprint(blockNotesApp)).toContain(BLOCK_RICH_TEXT_LEAF_PLUGIN_ID);

        const history = createInitialCrdtHistory(blockNotesApp);
        const $ = createPatchBuilder<BlockNotesState, [typeof blockRichTextBuilderExtension]>({
            builderExtensions: [blockRichTextBuilderExtension],
        });
        const updates = createCrdtUpdates(
            history.doc,
            $.body.$block.insertText({block: blockRichTextRootBlockId(), offset: 0, text: 'hi'}),
            hlc.pack(hlc.init('alice', 1)),
            {sessionId: 'alice'},
        );

        expect(updates).toHaveLength(2);
        expect(validateCrdtUpdatesForApp(updates, blockNotesApp)).toHaveLength(2);

        const doc = updates.reduce(applyCrdtUpdate, history.doc);
        expect(blockRichTextToString(doc.state.body)).toContain('hi');
    });

    it('fails initial block notes document creation without the required plugin', () => {
        expect(() =>
            createInitialCrdtHistory({
                ...blockNotesApp,
                leafPlugins: [],
            }),
        ).toThrow(/Missing required leaf CRDT plugin/);
    });
});
