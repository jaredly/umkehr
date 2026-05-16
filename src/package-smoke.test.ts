import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

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
    });

    it('imports the built validation entry point separately', async () => {
        expect(existsSync('dist/src/validation/index.js')).toBe(true);

        const validationPkg = await import('umkehr/validation');

        expect(typeof validationPkg.createPatchValidator).toBe('function');
        expect(typeof validationPkg.validatePatch).toBe('function');
        expect(typeof validationPkg.PatchValidationError).toBe('function');
    });

    it('imports the built React entry point separately', async () => {
        expect(existsSync('dist/src/react/index.js')).toBe(true);

        const reactPkg = await import('umkehr/react');

        expect(typeof reactPkg.createStateContext).toBe('function');
        expect(typeof reactPkg.createHistoryContext).toBe('function');
        expect(typeof reactPkg.useValue).toBe('function');
    });
});
