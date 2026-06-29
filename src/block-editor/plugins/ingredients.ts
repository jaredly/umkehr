import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';

export const ingredientBlockTypeSpec = simpleRichBlockTypeSpec('recipe_ingredient', () => true);

export const ingredientToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:recipe-ingredient', 'Block type', 'Ingredient line'),
]);

export const ingredientsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'ingredients',
    blockTypes: [ingredientBlockTypeSpec],
    toolbarItems: ingredientToolbarItems,
    slashCommands: withOrder([
        blockSlashCommand('recipe-ingredient', 'Ingredient', ['ingredient', 'recipe', 'food', 'line']),
    ]),
    blockRenderers: [declarationBlockRenderer('render:recipe-ingredient', 'recipe_ingredient')],
    clipboard: [{id: 'clipboard:recipe-ingredient'}],
};
