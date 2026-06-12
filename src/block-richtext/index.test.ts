import {describe, expect, it} from 'vitest';
import typia from 'typia';
import {
    blockRichText,
    blockRichTextRootBlockId,
    blockRichTextToString,
    isBlockRichTextValue,
    materializeBlockRichTextValue,
    type BlockRichText,
} from './index.js';

type State = {
    title: string;
    body: BlockRichText;
};

describe('block rich text public api', () => {
    it('creates an empty block rich text value', () => {
        const value = blockRichText();

        expect(value.kind).toBe('block-rich-text');
        expect(value.version).toBe(1);
        expect(value.state.blocks[blockRichTextRootBlockId()]).toMatchObject({
            id: [0, 'seed'],
            meta: {type: 'paragraph'},
            deleted: false,
        });
        expect(isBlockRichTextValue(value)).toBe(true);
    });

    it('materializes an empty block rich text value', () => {
        expect(materializeBlockRichTextValue(blockRichText())).toEqual([
            expect.objectContaining({
                id: blockRichTextRootBlockId(),
                block: expect.objectContaining({
                    meta: expect.objectContaining({type: 'paragraph'}),
                }),
                runs: [],
            }),
        ]);
        expect(blockRichTextToString(blockRichText())).toContain('');
    });

    it('emits the typia block-rich-text schema marker', () => {
        const schemas = typia.json.schemas<[State], '3.1'>();
        const root = schemas.components.schemas?.State as {
            properties?: Record<string, Record<string, unknown>>;
        };

        expect(root.properties?.body?.['x-umkehr-leaf-crdt']).toBe('umkehr.block-rich-text');
        expect(root.properties?.body?.['x-umkehr-leaf-crdt-version']).toBe(1);
    });
});
