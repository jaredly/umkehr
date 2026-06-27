import {fileURLToPath} from 'node:url';
import UnpluginTypia from '@typia/unplugin/vite';
import {configDefaults, defineConfig} from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    plugins: [UnpluginTypia()],
    resolve: {
        alias: [
            {find: /^react\/(.+)$/, replacement: fileURLToPath(new URL('./node_modules/react/$1', import.meta.url))},
            {find: 'react', replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url))},
            {
                find: /^react-dom\/(.+)$/,
                replacement: fileURLToPath(new URL('./node_modules/react-dom/$1', import.meta.url)),
            },
            {
                find: 'react-dom',
                replacement: fileURLToPath(new URL('./node_modules/react-dom/index.js', import.meta.url)),
            },
            {
                find: /^umkehr\/block-crdt\/(.+)$/,
                replacement: fileURLToPath(new URL('./src/block-crdt/$1.ts', import.meta.url)),
            },
            {
                find: 'umkehr/block-crdt',
                replacement: fileURLToPath(new URL('./src/block-crdt/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/block-crdt/branches',
                replacement: fileURLToPath(new URL('./src/block-crdt/branches.ts', import.meta.url)),
            },
            {
                find: /^umkehr\/block-richtext\/(.+)$/,
                replacement: fileURLToPath(new URL('./src/block-richtext/$1.ts', import.meta.url)),
            },
            {
                find: 'umkehr/block-richtext',
                replacement: fileURLToPath(new URL('./src/block-richtext/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/branches',
                replacement: fileURLToPath(new URL('./src/branches/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/crdt/branches',
                replacement: fileURLToPath(new URL('./src/crdt/branches.ts', import.meta.url)),
            },
            {find: 'umkehr/crdt', replacement: fileURLToPath(new URL('./src/crdt/index.ts', import.meta.url))},
            {
                find: 'umkehr/richtext',
                replacement: fileURLToPath(new URL('./src/richtext/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/validation',
                replacement: fileURLToPath(new URL('./src/validation/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/migration',
                replacement: fileURLToPath(new URL('./src/migration/index.ts', import.meta.url)),
            },
            {find: 'umkehr/react', replacement: fileURLToPath(new URL('./src/react/react.tsx', import.meta.url))},
            {
                find: 'umkehr/react-crdt',
                replacement: fileURLToPath(new URL('./src/react-crdt/index.ts', import.meta.url)),
            },
            {
                find: 'umkehr/react-rich-text',
                replacement: fileURLToPath(new URL('./src/react-rich-text/index.ts', import.meta.url)),
            },
            {find: 'umkehr/remix', replacement: fileURLToPath(new URL('./src/remix/index.ts', import.meta.url))},
            {find: 'umkehr', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url))},
        ],
    },
    test: {
        root,
        exclude: [...configDefaults.exclude, '**.spec.ts'],
    },
});
