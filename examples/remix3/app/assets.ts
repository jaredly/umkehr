import {createAssetServer} from 'remix/assets';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), '../..');

export const assets = createAssetServer({
    basePath: '/assets',
    rootDir,
    fileMap: {
        'app/*path': 'examples/remix3/app/*path',
        'node_modules/*path': 'examples/remix3/node_modules/*path',
        'root_node_modules/*path': 'node_modules/*path',
        'dist/*path': 'dist/*path',
    },
    allow: ['examples/remix3/app/**', 'examples/remix3/node_modules/**', 'node_modules/**', 'dist/**'],
    deny: ['examples/remix3/app/**/*.server.*'],
    sourceMaps: process.env.NODE_ENV === 'development' ? 'external' : undefined,
    scripts: {
        define: {
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
        },
    },
});
