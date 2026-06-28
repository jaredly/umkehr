import {describe, expect, it} from 'vitest';

import {DEFAULT_SLASH_COMMANDS, slashCommandsFromRegistry, slashCommandsFromSpecs} from '../slashCommands';
import {createBlockEditorRegistry} from './registry';
import {
    blockTypeMenuItemsFromToolbarSpecs,
    legacyBlockTypeMenuItems,
    legacyBlockTypeMenuItemsFromToolbarSpecs,
    legacyRichTextUiPlugin,
    legacySlashCommandSpecs,
    legacyToolbarItemSpecs,
} from './legacyRichTextUi';
import type {RichBlockMeta} from '../blockMeta';

describe('legacy rich text UI plugin', () => {
    it('declares slash commands matching the current built-in slash commands', () => {
        expect(slashCommandsFromSpecs(legacySlashCommandSpecs)).toEqual(DEFAULT_SLASH_COMMANDS);
    });

    it('exposes slash commands through the registry', () => {
        const registry = createBlockEditorRegistry<RichBlockMeta>([legacyRichTextUiPlugin]);

        expect(slashCommandsFromRegistry(registry)).toEqual(DEFAULT_SLASH_COMMANDS);
    });

    it('declares block type toolbar menu items matching block slash command values', () => {
        const blockSlashValues = slashCommandsFromSpecs(legacySlashCommandSpecs)
            .filter((command) => command.type === 'block')
            .map((command) => (command.type === 'block' ? command.value : null));
        const slashBackedMenuItems = legacyBlockTypeMenuItems
            .map((item) => item.value)
            .filter((value) => !value.startsWith('poll-'));

        expect(slashBackedMenuItems).toEqual(blockSlashValues);
    });

    it('declares toolbar item ids without duplicates', () => {
        const ids = legacyToolbarItemSpecs.map((item) => item.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('derives block type menu items from toolbar specs', () => {
        expect(legacyBlockTypeMenuItemsFromToolbarSpecs()).toEqual(legacyBlockTypeMenuItems);
    });

    it('ignores non-block-type toolbar specs when deriving menu items', () => {
        expect(
            blockTypeMenuItemsFromToolbarSpecs([
                {id: 'mark:bold', commandId: 'mark:bold', label: 'Bold'},
                {id: 'block-type:paragraph', commandId: 'block-type:paragraph', label: 'Paragraph'},
                {id: 'block-type:unknown', commandId: 'block-type:unknown', label: 'Unknown'},
            ]),
        ).toEqual([{value: 'paragraph', label: 'Paragraph'}]);
    });

    it('can be combined with existing legacy CRDT plugins without conflicts', async () => {
        const {legacyRichTextCrdtPlugins} = await import('../editorCrdtConfig');

        const registry = createBlockEditorRegistry<RichBlockMeta>([
            ...legacyRichTextCrdtPlugins,
            legacyRichTextUiPlugin,
        ]);

        expect(registry.plugins.map((plugin) => plugin.id)).toEqual([
            'annotations',
            'legacy-rich-text-ui',
            'polls',
        ]);
    });
});
