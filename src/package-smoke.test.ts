import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

describe('package exports', () => {
    it('imports the built root entry point without pulling in React bindings', async () => {
        expect(existsSync('dist/src/index.js')).toBe(true);

        const pkg = await import('umkehr');

        expect(typeof pkg.createPatchBuilder).toBe('function');
        expect(typeof pkg.createPatchBuilderWithContext).toBe('function');
        expect(typeof pkg.blankHistory).toBe('function');
        expect('createStateContext' in pkg).toBe(false);
        expect('createHistoryContext' in pkg).toBe(false);
    });

    it('imports the built React entry point separately', async () => {
        expect(existsSync('dist/src/react/index.js')).toBe(true);

        const reactPkg = await import('umkehr/react');

        expect(typeof reactPkg.createStateContext).toBe('function');
        expect(typeof reactPkg.createHistoryContext).toBe('function');
        expect(typeof reactPkg.useValue).toBe('function');
    });
});
