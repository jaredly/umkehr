import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import UnpluginTypia from '@typia/unplugin/vite';

export default defineConfig({
    plugins: [UnpluginTypia()],
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    build: {
        outDir: 'dist-wordsearch-peerjs',
        rollupOptions: {
            input: fileURLToPath(new URL('./wordsearch-peerjs.html', import.meta.url)),
        },
    },
});
