import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {createBlockEditorRegistry, legacyRichTextPlugins, styleImportsFromRegistry} from './block-editor/index';

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

    it('publishes block editor CSS entrypoints', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            exports: Record<string, unknown>;
            sideEffects: unknown;
        };

        expect(packageJson.exports['./block-editor/style.css']).toBe('./dist/src/block-editor/style.css');
        expect(packageJson.exports['./block-editor/legacyRichTextPlugins.css']).toBe(
            './dist/src/block-editor/legacyRichTextPlugins.css',
        );
        expect(packageJson.exports['./block-editor/plugins/*.css']).toBe('./dist/src/block-editor/plugins/*.css');
        expect(packageJson.sideEffects).toEqual(['**/*.css']);
        expect(existsSync('dist/src/block-editor/style.css')).toBe(true);
        expect(existsSync('dist/src/block-editor/legacyRichTextPlugins.css')).toBe(true);
        expect(existsSync('dist/src/block-editor/plugins/annotations.css')).toBe(true);
        expect(readFileSync('dist/src/block-editor/legacyRichTextPlugins.css', 'utf8')).toContain(
            "@import './plugins/table.css';",
        );
    });

    it('keeps bundled plugin style declarations aligned with package CSS entrypoints', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            exports: Record<string, unknown>;
        };
        const registry = createBlockEditorRegistry(legacyRichTextPlugins);
        const styleImports = styleImportsFromRegistry(registry);
        const legacyPresetCss = readFileSync('src/block-editor/legacyRichTextPlugins.css', 'utf8');
        const copyCssScript = readFileSync('scripts/copy-css.mjs', 'utf8');
        let previousIndex = -1;

        expect(packageJson.exports['./block-editor/plugins/*.css']).toBe('./dist/src/block-editor/plugins/*.css');
        expect(copyCssScript).toContain("readdirSync('src/block-editor/plugins')");
        expect(copyCssScript).toContain("file.endsWith('.css')");

        for (const href of styleImports) {
            const cssFile = href.replace('umkehr/block-editor/plugins/', '');
            const importLine = `@import './plugins/${cssFile}';`;
            expect(href).toMatch(/^umkehr\/block-editor\/plugins\/[^/]+\.css$/);
            expect(existsSync(`src/block-editor/plugins/${cssFile}`)).toBe(true);
            expect(packageJson.exports[`./block-editor/plugins/${cssFile}`] ?? packageJson.exports['./block-editor/plugins/*.css'])
                .toBe('./dist/src/block-editor/plugins/*.css');
            expect(legacyPresetCss).toContain(importLine);
            const index = legacyPresetCss.indexOf(importLine);
            expect(index).toBeGreaterThan(previousIndex);
            previousIndex = index;
        }
    });
});
