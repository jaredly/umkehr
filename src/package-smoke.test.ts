import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const packageImportTimeoutMs = 15_000;

describe('package exports', () => {
    it('imports the built root entry point without pulling in React bindings', async () => {
        expect(existsSync('dist/src/index.js')).toBe(true);

        const pkg = await import('umkehr');

        expect(typeof pkg.createPatchBuilder).toBe('function');
        expect(typeof pkg.createPatchBuilderWithContext).toBe('function');
        expect(typeof pkg.applyPatch).toBe('function');
        expect(typeof pkg.invertPatch).toBe('function');
        expect(typeof pkg.resolveAndApply).toBe('function');
        expect(typeof pkg.blankHistory).toBe('function');
        expect('createPatchValidator' in pkg).toBe(false);
        expect('validatePatch' in pkg).toBe(false);
        expect('createStateContext' in pkg).toBe(false);
        expect('createHistoryContext' in pkg).toBe(false);
        expect('createSyncedContext' in pkg).toBe(false);
    }, packageImportTimeoutMs);

    it('imports the built validation entry point separately', async () => {
        expect(existsSync('dist/src/validation/index.js')).toBe(true);

        const validationPkg = await import('umkehr/validation');

        expect(typeof validationPkg.createPatchValidator).toBe('function');
        expect(typeof validationPkg.validatePatch).toBe('function');
        expect(typeof validationPkg.PatchValidationError).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built CRDT entry point separately', async () => {
        expect(existsSync('dist/src/crdt/index.js')).toBe(true);

        const crdtPkg = await import('umkehr/crdt');

        expect(typeof crdtPkg.createCrdtDocument).toBe('function');
        expect(typeof crdtPkg.createCrdtUpdates).toBe('function');
        expect(typeof crdtPkg.applyCrdtUpdate).toBe('function');
        expect(typeof crdtPkg.createCrdtUpdateValidator).toBe('function');
        expect(typeof crdtPkg.validateCrdtUpdate).toBe('function');
        expect(typeof crdtPkg.CrdtUpdateValidationError).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built rich text entry point separately', async () => {
        expect(existsSync('dist/src/richtext/index.js')).toBe(true);

        const richTextPkg = await import('umkehr/richtext');

        expect(typeof richTextPkg.richText).toBe('function');
        expect(typeof richTextPkg.richTextFromPlainText).toBe('function');
        expect(typeof richTextPkg.materializeRichText).toBe('function');
        expect(typeof richTextPkg.materializeRichTextValue).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built block rich text entry point separately', async () => {
        expect(existsSync('dist/src/block-richtext/index.js')).toBe(true);

        const blockRichTextPkg = await import('umkehr/block-richtext');

        expect(typeof blockRichTextPkg.blockRichText).toBe('function');
        expect(typeof blockRichTextPkg.blockRichTextLeafPlugin).toBe('object');
        expect(typeof blockRichTextPkg.materializeBlockRichTextValue).toBe('function');
        expect(blockRichTextPkg.BLOCK_RICH_TEXT_LEAF_PLUGIN_ID).toBe('umkehr.block-rich-text');
    }, packageImportTimeoutMs);

    it('imports the built React entry point separately', async () => {
        expect(existsSync('dist/src/react/index.js')).toBe(true);

        const reactPkg = await import('umkehr/react');

        expect(typeof reactPkg.createStateContext).toBe('function');
        expect(typeof reactPkg.createHistoryContext).toBe('function');
        expect(typeof reactPkg.useValue).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built React CRDT entry point separately', async () => {
        expect(existsSync('dist/src/react-crdt/index.js')).toBe(true);

        const reactCrdtPkg = await import('umkehr/react-crdt');

        expect(typeof reactCrdtPkg.createSyncedContext).toBe('function');
        expect(typeof reactCrdtPkg.RichTextEditor).toBe('function');
        expect(typeof reactCrdtPkg.useValue).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built React rich text entry point separately', async () => {
        expect(existsSync('dist/src/react-rich-text/index.js')).toBe(true);

        const reactRichTextPkg = await import('umkehr/react-rich-text');

        expect(typeof reactRichTextPkg.RichTextEditor).toBe('function');
    }, packageImportTimeoutMs);

    it('imports the built Remix entry point separately', async () => {
        expect(existsSync('dist/src/remix/index.js')).toBe(true);

        const remixPkg = await import('umkehr/remix');

        expect(typeof remixPkg.createStateContext).toBe('function');
        expect(typeof remixPkg.createHistoryContext).toBe('function');
    }, packageImportTimeoutMs);
});
