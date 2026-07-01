import type {BlockEditorPluginStyle, BlockEditorRegistry} from './types.js';

export const bundledPluginStyle = (pluginId: string, cssFile: string, order: number): BlockEditorPluginStyle => ({
    id: `${pluginId}:styles`,
    type: 'import',
    href: `umkehr/block-editor/plugins/${cssFile}`,
    order,
});

export const styleTextFromRegistry = (
    registry: Pick<BlockEditorRegistry, 'styles'>,
): string =>
    registry.styles
        .filter((style): style is Extract<BlockEditorPluginStyle, {type: 'css'}> => style.type === 'css')
        .map((style) => style.cssText)
        .join('\n');

export const styleImportsFromRegistry = (
    registry: Pick<BlockEditorRegistry, 'styles'>,
): string[] =>
    registry.styles
        .filter((style): style is Extract<BlockEditorPluginStyle, {type: 'import'}> => style.type === 'import')
        .map((style) => style.href);
