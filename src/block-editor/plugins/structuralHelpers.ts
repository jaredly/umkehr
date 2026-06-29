import type {RichBlockMeta} from '../blockMeta.js';
import {
    declarationBlockRenderer,
    declarationOptionPanel,
    simpleRichBlockTypeSpec,
} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import type {
    BlockEditorBlockRenderer,
    BlockEditorBlockTypeSpec,
    BlockEditorCommandSpec,
    BlockEditorOptionPanelSpec,
    BlockEditorSlashCommandSpec,
    BlockEditorToolbarItemSpec,
} from './types.js';

export const structuralBlockTypeSpec = <Meta extends RichBlockMeta>(
    id: Meta['type'],
    validateMeta: (meta: Record<string, unknown>) => boolean,
): BlockEditorBlockTypeSpec<RichBlockMeta> => simpleRichBlockTypeSpec(id, validateMeta);

export const structuralToolbarItems = (
    items: readonly {value: Parameters<typeof blockSlashCommand>[0]; label: string}[],
): readonly BlockEditorToolbarItemSpec[] =>
    withOrder(items.map((item) => toolbarItem(`block-type:${item.value}`, 'Block type', item.label)));

export const structuralSlashCommands = (
    items: readonly {
        value: Parameters<typeof blockSlashCommand>[0];
        label: string;
        keywords: readonly string[];
    }[],
): readonly BlockEditorSlashCommandSpec[] =>
    withOrder(
        items.map((item) =>
            blockSlashCommand(item.value, item.label, [...item.keywords]),
        ),
    );

export const structuralRenderers = (
    items: readonly {id: string; blockType: RichBlockMeta['type']}[],
): readonly BlockEditorBlockRenderer<RichBlockMeta>[] =>
    items.map((item) => declarationBlockRenderer(`render:${item.id}`, item.blockType));

export const structuralOptionPanels = (
    items: readonly {id: string; blockType: RichBlockMeta['type']}[],
): readonly BlockEditorOptionPanelSpec<RichBlockMeta>[] =>
    items.map((item) => declarationOptionPanel(`options:${item.id}`, item.blockType));

export const structuralCommands = (
    ids: readonly string[],
): readonly BlockEditorCommandSpec<RichBlockMeta>[] => ids.map((id) => ({id, handle: () => undefined}));
