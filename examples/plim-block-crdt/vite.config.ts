import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^umkehr\/block-crdt\/(.+)$/,
                replacement: fileURLToPath(new URL('../../src/block-crdt/$1.ts', import.meta.url)),
            },
            {
                find: 'umkehr/block-crdt',
                replacement: fileURLToPath(new URL('../../src/block-crdt/index.ts', import.meta.url)),
            },
        ],
    },
});
