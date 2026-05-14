import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

describe('package exports', () => {
    it('imports the built root entry point without pulling in React bindings', async () => {
        if (!existsSync('dist/src/index.js')) return;

        const pkg = await import('umkehr');

        expect(typeof pkg.createPatchBuilder).toBe('function');
        expect(typeof pkg.blankHistory).toBe('function');
        expect('createStateContext' in pkg).toBe(false);
        expect('createHistoryContext' in pkg).toBe(false);
    });

    it('imports the built React entry point separately', async () => {
        if (!existsSync('dist/src/react/index.js')) return;

        const reactPkg = await import('umkehr/react');

        expect(typeof reactPkg.createStateContext).toBe('function');
        expect(typeof reactPkg.createHistoryContext).toBe('function');
        expect(typeof reactPkg.useValue).toBe('function');
    });
});
