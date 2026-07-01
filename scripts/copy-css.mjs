import {copyFileSync, mkdirSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';

const cssFiles = [
    'src/block-editor/style.css',
    'src/block-editor/defaultBlockEditorPlugins.css',
    ...readdirSync('src/block-editor/plugins')
        .filter((file) => file.endsWith('.css'))
        .map((file) => `src/block-editor/plugins/${file}`),
];

for (const source of cssFiles) {
    const target = join('dist', source);
    mkdirSync(dirname(target), {recursive: true});
    copyFileSync(source, target);
}
