import {fileURLToPath} from 'node:url';
import UnpluginTypia from '@typia/unplugin/vite';
import {configDefaults, defineConfig} from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    plugins: [UnpluginTypia()],
    resolve: {
        alias: {
            'umkehr/crdt': fileURLToPath(new URL('./src/crdt/index.ts', import.meta.url)),
            'umkehr/richtext': fileURLToPath(
                new URL('./src/richtext/index.ts', import.meta.url),
            ),
            'umkehr/validation': fileURLToPath(
                new URL('./src/validation/index.ts', import.meta.url),
            ),
            'umkehr/migration': fileURLToPath(new URL('./src/migration/index.ts', import.meta.url)),
            'umkehr/react': fileURLToPath(new URL('./src/react/react.tsx', import.meta.url)),
            'umkehr/react-crdt': fileURLToPath(
                new URL('./src/react-crdt/index.ts', import.meta.url),
            ),
            'umkehr/remix': fileURLToPath(new URL('./src/remix/index.ts', import.meta.url)),
            umkehr: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        },
    },
    test: {
        root,
        exclude: [...configDefaults.exclude, '**.spec.ts'],
    },
});
