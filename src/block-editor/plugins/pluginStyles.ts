import type {BlockEditorPluginStyle} from './types.js';

export const bundledPluginStyle = (pluginId: string, cssFile: string, order: number): BlockEditorPluginStyle => ({
    id: `${pluginId}:styles`,
    type: 'import',
    href: `umkehr/block-editor/plugins/${cssFile}`,
    order,
});
