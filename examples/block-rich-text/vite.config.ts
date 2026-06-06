import {fileURLToPath} from 'node:url';

export default {
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
};
