import {fileURLToPath} from 'node:url';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import type {Plugin} from 'vite';

const mathJaxComponentPath = fileURLToPath(
    new URL('./node_modules/mathjax/tex-svg.js', import.meta.url),
);
const mathJaxSrePath = fileURLToPath(new URL('./node_modules/mathjax/sre', import.meta.url));

export default {
    plugins: [mathJaxVendorAsset()],
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

function mathJaxVendorAsset(): Plugin {
    const componentAssetPath = '/vendor/mathjax/tex-svg.js';
    const sreAssetPrefix = '/vendor/mathjax/sre/';
    const sreFiles = filesIn(mathJaxSrePath);
    return {
        name: 'mathjax-vendor-asset',
        configureServer(server) {
            server.middlewares.use(componentAssetPath, (_request, response) => {
                response.setHeader('Content-Type', mimeTypeForPath(componentAssetPath));
                response.end(readFileSync(mathJaxComponentPath));
            });
            server.middlewares.use(sreAssetPrefix, (request, response, next) => {
                const requested = decodeURIComponent((request.url ?? '').split('?')[0] ?? '');
                const relativePath = requested.replace(/^\/+/, '');
                const file = sreFiles.find((candidate) => candidate.assetPath === `${sreAssetPrefix}${relativePath}`);
                if (!file) {
                    next();
                    return;
                }
                response.setHeader('Content-Type', mimeTypeForPath(file.assetPath));
                response.end(readFileSync(file.sourcePath));
            });
        },
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: componentAssetPath.slice(1),
                source: readFileSync(mathJaxComponentPath),
            });
            for (const file of sreFiles) {
                this.emitFile({
                    type: 'asset',
                    fileName: file.assetPath.slice(1),
                    source: readFileSync(file.sourcePath),
                });
            }
        },
    };
}

function filesIn(root: string): Array<{assetPath: string; sourcePath: string}> {
    const files: Array<{assetPath: string; sourcePath: string}> = [];
    const visit = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const sourcePath = join(dir, entry);
            const stats = statSync(sourcePath);
            if (stats.isDirectory()) {
                visit(sourcePath);
                continue;
            }
            if (!stats.isFile()) continue;
            const assetRelativePath = relative(mathJaxSrePath, sourcePath).split(sep).join('/');
            files.push({
                assetPath: `/vendor/mathjax/sre/${assetRelativePath}`,
                sourcePath,
            });
        }
    };
    visit(root);
    return files;
}

function mimeTypeForPath(path: string): string {
    if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text/javascript';
    if (path.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
}
