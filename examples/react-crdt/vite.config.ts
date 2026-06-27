import {defineConfig} from 'vite';
import UnpluginTypia from '@typia/unplugin/vite';

export default defineConfig({
    plugins: [UnpluginTypia()],
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
});
