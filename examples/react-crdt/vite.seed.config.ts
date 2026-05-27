import {defineConfig} from 'vite';
import UnpluginTypia from '@typia/unplugin/vite';

export default defineConfig({
    plugins: [UnpluginTypia()],
    build: {
        ssr: 'src/lib/seed/generate.ts',
        outDir: '/private/tmp/umkehr-react-crdt-seed-build',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: 'generate.js',
            },
        },
    },
    ssr: {
        noExternal: ['typia', 'umkehr'],
    },
});
