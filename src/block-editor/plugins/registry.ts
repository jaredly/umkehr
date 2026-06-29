import type {Lamport, TimestampedBlockMeta} from '../../block-crdt/types.js';
import type {VirtualBlockParentConfig} from '../../block-crdt/index.js';

import {
    BlockEditorPluginRegistryError,
    type BlockEditorBlockRenderer,
    type BlockEditorBlockTypeSpec,
    type BlockEditorClipboardHooks,
    type BlockEditorCodePreviewRenderer,
    type BlockEditorCommandSpec,
    type BlockEditorDestinationRenderer,
    type BlockEditorInlineEmbedSpec,
    type BlockEditorInlineMarkSpec,
    type BlockEditorInlineRenderer,
    type BlockEditorMarkdownShortcutSpec,
    type BlockEditorOptionPanelSpec,
    type BlockEditorPlugin,
    type BlockEditorPluginStyle,
    type BlockEditorRegistry,
    type BlockEditorSelectionPlugin,
    type BlockEditorSelectionTypeSpec,
    type BlockEditorSlashCommandSpec,
    type BlockEditorToolbarItemSpec,
} from './types.js';

export const createBlockEditorRegistry = <Meta extends TimestampedBlockMeta>(
    plugins: readonly BlockEditorPlugin<Meta>[],
): BlockEditorRegistry<Meta> => {
    const orderedPlugins = orderPlugins(plugins);

    const blockTypes = mapById<Meta, BlockEditorBlockTypeSpec<Meta>>('block type', orderedPlugins, 'blockTypes');
    const marks = mapById<Meta, BlockEditorInlineMarkSpec>('mark', orderedPlugins, 'marks');
    const inlineEmbeds = mapById<Meta, BlockEditorInlineEmbedSpec>('inline embed', orderedPlugins, 'inlineEmbeds');
    const selectionTypes = mapById<Meta, BlockEditorSelectionTypeSpec>('selection type', orderedPlugins, 'selectionTypes');
    const selectionPlugins = mapById<Meta, BlockEditorSelectionPlugin<Meta>>(
        'selection plugin',
        orderedPlugins,
        'selectionPlugins',
    );
    validateSelectionPluginDeclarations(selectionTypes, selectionPlugins);
    const commands = mapById<Meta, BlockEditorCommandSpec<Meta>>('command', orderedPlugins, 'commands');
    const clipboard = mapById<Meta, BlockEditorClipboardHooks<Meta>>('clipboard hook', orderedPlugins, 'clipboard');

    const toolbarItems = sortedContributions<BlockEditorToolbarItemSpec>(
        mapById<Meta, BlockEditorToolbarItemSpec>('toolbar item', orderedPlugins, 'toolbarItems').values(),
    );
    const slashCommands = sortedContributions<BlockEditorSlashCommandSpec>(
        mapById<Meta, BlockEditorSlashCommandSpec>('slash command', orderedPlugins, 'slashCommands').values(),
    );
    const markdownShortcuts = sortedContributions<BlockEditorMarkdownShortcutSpec<Meta>>(
        mapById<Meta, BlockEditorMarkdownShortcutSpec<Meta>>('markdown shortcut', orderedPlugins, 'markdownShortcuts').values(),
    );
    const inlineRenderers = sortedContributions<BlockEditorInlineRenderer<Meta>>(
        mapById<Meta, BlockEditorInlineRenderer<Meta>>('inline renderer', orderedPlugins, 'inlineRenderers').values(),
    );
    validateInlineRendererOwnership(inlineRenderers);
    const styles = sortedContributions<BlockEditorPluginStyle>(
        mapById<Meta, BlockEditorPluginStyle>('style', orderedPlugins, 'styles').values(),
    );

    const blockRenderers = blockRendererMap(orderedPlugins);
    const destinationRenderers = groupedByKey<Meta, BlockEditorDestinationRenderer<Meta>>(
        'destination renderer',
        orderedPlugins,
        'destinationRenderers',
        (renderer) => renderer.destination,
    );
    const optionPanels = groupedByKey<Meta, BlockEditorOptionPanelSpec<Meta>>(
        'option panel',
        orderedPlugins,
        'optionPanels',
        (panel) => panel.blockType,
    );
    const {byId: codePreviewRenderers, byLanguage: codePreviewRenderersByLanguage} =
        codePreviewRendererMaps(orderedPlugins);
    const composedCrdtConfig = crdtConfig(orderedPlugins);

    return {
        plugins: orderedPlugins,
        blockTypes,
        marks,
        inlineEmbeds,
        selectionTypes,
        selectionPlugins,
        toolbarItems,
        slashCommands,
        markdownShortcuts,
        commands,
        blockRenderers,
        inlineRenderers,
        destinationRenderers,
        optionPanels,
        codePreviewRenderers,
        codePreviewRenderersByLanguage,
        clipboard,
        styles,
        crdtConfig: () => composedCrdtConfig,
    };
};

const validateSelectionPluginDeclarations = <Meta extends TimestampedBlockMeta>(
    selectionTypes: ReadonlyMap<string, BlockEditorSelectionTypeSpec>,
    selectionPlugins: ReadonlyMap<string, BlockEditorSelectionPlugin<Meta>>,
): void => {
    for (const plugin of selectionPlugins.values()) {
        if (!selectionTypes.has(plugin.id)) {
            throw registryError(
                'missing-selection-type',
                `Selection plugin "${plugin.id}" must declare a matching selection type.`,
            );
        }
    }
};

const orderPlugins = <Meta extends TimestampedBlockMeta>(
    plugins: readonly BlockEditorPlugin<Meta>[],
): readonly BlockEditorPlugin<Meta>[] => {
    const byId = new Map<string, BlockEditorPlugin<Meta>>();
    for (const plugin of plugins) {
        if (!plugin.id) throw registryError('invalid-plugin-id', 'Plugin id must be a non-empty string.');
        const existing = byId.get(plugin.id);
        if (existing) throw duplicateError('plugin', plugin.id, existing.id, plugin.id);
        byId.set(plugin.id, plugin);
    }

    const ids = [...byId.keys()].sort();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const result: BlockEditorPlugin<Meta>[] = [];

    const visit = (id: string, path: string[]) => {
        if (visited.has(id)) return;
        if (visiting.has(id)) {
            throw registryError('plugin-cycle', `Plugin dependency cycle: ${[...path, id].join(' -> ')}.`);
        }
        const plugin = byId.get(id);
        if (!plugin) throw registryError('missing-plugin', `Plugin "${id}" is required but was not registered.`);

        visiting.add(id);
        for (const dependency of [...(plugin.requires ?? [])].sort()) {
            if (!byId.has(dependency)) {
                throw registryError(
                    'missing-plugin',
                    `Plugin "${plugin.id}" requires "${dependency}", but "${dependency}" was not registered.`,
                );
            }
            visit(dependency, [...path, id]);
        }
        visiting.delete(id);
        visited.add(id);
        result.push(plugin);
    };

    for (const id of ids) visit(id, []);
    return result;
};

const mapById = <
    Meta extends TimestampedBlockMeta = TimestampedBlockMeta,
    Item extends {id: string; pluginId?: string} = {id: string; pluginId?: string},
>(
    label: string,
    plugins: readonly BlockEditorPlugin<Meta>[],
    key: keyof BlockEditorPlugin<Meta>,
): Map<string, Item> => {
    const result = new Map<string, Item>();
    const ownerById = new Map<string, string>();
    for (const plugin of plugins) {
        for (const rawItem of contributionArray<Item, Meta>(plugin, key)) {
            if (!rawItem.id) {
                throw registryError('invalid-contribution-id', `${capitalize(label)} from "${plugin.id}" has an empty id.`);
            }
            const existingOwner = ownerById.get(rawItem.id);
            if (existingOwner) throw duplicateError(label, rawItem.id, existingOwner, plugin.id);
            const item = withPluginId(rawItem, plugin.id);
            ownerById.set(item.id, plugin.id);
            result.set(item.id, item);
        }
    }
    return result;
};

const groupedByKey = <
    Meta extends TimestampedBlockMeta,
    Item extends {id: string; pluginId?: string; order?: number},
>(
    label: string,
    plugins: readonly BlockEditorPlugin<Meta>[],
    key: keyof BlockEditorPlugin<Meta>,
    groupKey: (item: Item) => string,
): Map<string, readonly Item[]> => {
    const byId = mapById<Meta, Item>(label, plugins, key);
    const result = new Map<string, Item[]>();
    for (const item of sortedContributions(byId.values())) {
        const group = groupKey(item);
        result.set(group, [...(result.get(group) ?? []), item]);
    }
    return result;
};

const blockRendererMap = <Meta extends TimestampedBlockMeta>(
    plugins: readonly BlockEditorPlugin<Meta>[],
): Map<string, BlockEditorBlockRenderer<Meta>> => {
    const byId = mapById<Meta, BlockEditorBlockRenderer<Meta>>('block renderer', plugins, 'blockRenderers');
    const result = new Map<string, BlockEditorBlockRenderer<Meta>>();
    for (const renderer of sortedContributions(byId.values())) {
        const existing = result.get(renderer.blockType);
        if (existing) {
            throw registryError(
                'duplicate-block-renderer',
                `Block type "${renderer.blockType}" is rendered by both "${existing.pluginId}" and "${renderer.pluginId}".`,
            );
        }
        result.set(renderer.blockType, renderer);
    }
    return result;
};

const codePreviewRendererMaps = <Meta extends TimestampedBlockMeta>(
    plugins: readonly BlockEditorPlugin<Meta>[],
): {
    byId: Map<string, BlockEditorCodePreviewRenderer>;
    byLanguage: Map<string, BlockEditorCodePreviewRenderer>;
} => {
    const byId = mapById<Meta, BlockEditorCodePreviewRenderer>('code preview renderer', plugins, 'codePreviewRenderers');
    const byLanguage = new Map<string, BlockEditorCodePreviewRenderer>();
    for (const renderer of sortedContributions(byId.values())) {
        for (const language of renderer.languages) {
            const normalized = normalizeLanguage(language);
            const existing = byLanguage.get(normalized);
            if (existing) {
                throw registryError(
                    'duplicate-code-preview-language',
                    `Code preview language "${normalized}" is handled by both "${existing.pluginId}" and "${renderer.pluginId}".`,
                );
            }
            byLanguage.set(normalized, renderer);
        }
    }
    return {byId, byLanguage};
};

const validateInlineRendererOwnership = <Meta extends TimestampedBlockMeta>(
    renderers: readonly BlockEditorInlineRenderer<Meta>[],
): void => {
    const markOwner = new Map<string, BlockEditorInlineRenderer<Meta>>();
    const embedOwner = new Map<string, BlockEditorInlineRenderer<Meta>>();
    for (const renderer of renderers) {
        if (renderer.markType && !renderer.embedType) {
            const existing = markOwner.get(renderer.markType);
            if (existing) {
                throw registryError(
                    'duplicate-inline-renderer-mark',
                    `Inline mark "${renderer.markType}" is rendered by both "${existing.pluginId}" and "${renderer.pluginId}".`,
                );
            }
            markOwner.set(renderer.markType, renderer);
        }
        if (renderer.embedType) {
            const existing = embedOwner.get(renderer.embedType);
            if (existing) {
                throw registryError(
                    'duplicate-inline-renderer-embed',
                    `Inline embed "${renderer.embedType}" is rendered by both "${existing.pluginId}" and "${renderer.pluginId}".`,
                );
            }
            embedOwner.set(renderer.embedType, renderer);
        }
    }
};

const crdtConfig = <Meta extends TimestampedBlockMeta>(
    plugins: readonly BlockEditorPlugin<Meta>[],
): VirtualBlockParentConfig<Meta> => {
    const markBehavior: NonNullable<VirtualBlockParentConfig<Meta>['markBehavior']> = {};
    const virtualParents: NonNullable<BlockEditorPlugin<Meta>['crdt']>[] = [];
    const markVirtualParents: NonNullable<BlockEditorPlugin<Meta>['crdt']>[] = [];
    const mergeHooksByType = new Map<string, NonNullable<BlockEditorPlugin<Meta>['crdt']>>();
    const genericMergeHooks: NonNullable<BlockEditorPlugin<Meta>['crdt']>[] = [];

    for (const plugin of plugins) {
        const hooks = plugin.crdt;
        if (!hooks) continue;
        for (const [markType, behavior] of Object.entries(hooks.markBehavior ?? {})) {
            const existing = markBehavior[markType];
            if (existing && existing !== behavior) {
                throw registryError(
                    'conflicting-mark-behavior',
                    `Mark "${markType}" has conflicting CRDT behavior "${existing}" and "${behavior}".`,
                );
            }
            markBehavior[markType] = behavior;
        }
        if (hooks.virtualParents) virtualParents.push(hooks);
        if (hooks.markVirtualParents) markVirtualParents.push(hooks);
        if (hooks.mergeBlockMeta) {
            const types = hooks.mergeBlockMetaTypes;
            if (!types?.length) {
                genericMergeHooks.push(hooks);
            } else {
                for (const type of types) {
                    const existing = mergeHooksByType.get(type);
                    if (existing) {
                        throw registryError(
                            'duplicate-merge-block-meta',
                            `Block metadata type "${type}" has more than one merge hook.`,
                        );
                    }
                    mergeHooksByType.set(type, hooks);
                }
            }
        }
    }
    if (genericMergeHooks.length > 1) {
        throw registryError('duplicate-merge-block-meta', 'More than one unscoped block metadata merge hook was registered.');
    }

    return {
        ...(Object.keys(markBehavior).length ? {markBehavior} : {}),
        ...(virtualParents.length
            ? {
                  virtualParents: (block) =>
                      virtualParents.flatMap((hooks) => [...(hooks.virtualParents?.(block) ?? [])]) as Lamport[],
              }
            : {}),
        ...(markVirtualParents.length
            ? {
                  markVirtualParents: (mark) =>
                      markVirtualParents.flatMap((hooks) => [...(hooks.markVirtualParents?.(mark) ?? [])]) as Lamport[],
              }
            : {}),
        ...((mergeHooksByType.size || genericMergeHooks.length)
            ? {
                  mergeBlockMeta: (current, incoming) => {
                      const type = metadataType(current, incoming);
                      const scopedHook = type ? mergeHooksByType.get(type) : undefined;
                      return (scopedHook ?? genericMergeHooks[0])?.mergeBlockMeta?.(current, incoming);
                  },
              }
            : {}),
    };
};

const metadataType = (current: TimestampedBlockMeta, incoming: TimestampedBlockMeta): string | null => {
    const currentType = typeProperty(current);
    const incomingType = typeProperty(incoming);
    return currentType && currentType === incomingType ? currentType : (incomingType ?? currentType);
};

const typeProperty = (value: TimestampedBlockMeta): string | null => {
    const record = value as unknown as {type?: unknown};
    return typeof record.type === 'string' ? record.type : null;
};

const contributionArray = <Item, Meta extends TimestampedBlockMeta>(
    plugin: BlockEditorPlugin<Meta>,
    key: keyof BlockEditorPlugin<Meta>,
): readonly Item[] => {
    const value = plugin[key];
    return Array.isArray(value) ? (value as readonly Item[]) : [];
};

const sortedContributions = <Item extends {id: string; pluginId?: string; order?: number}>(
    items: Iterable<Item>,
): Item[] =>
    [...items].sort((a, b) => {
        const order = (a.order ?? 0) - (b.order ?? 0);
        if (order) return order;
        const plugin = (a.pluginId ?? '').localeCompare(b.pluginId ?? '');
        if (plugin) return plugin;
        return a.id.localeCompare(b.id);
    });

const withPluginId = <Item extends {pluginId?: string}>(item: Item, pluginId: string): Item =>
    item.pluginId === pluginId ? item : {...item, pluginId};

const normalizeLanguage = (language: string): string => language.trim().toLowerCase();

const duplicateError = (label: string, id: string, existingOwner: string, newOwner: string) =>
    registryError(
        `duplicate-${label.replace(/\s+/g, '-')}`,
        `Duplicate ${label} "${id}" from plugins "${existingOwner}" and "${newOwner}".`,
    );

const registryError = (code: string, message: string): BlockEditorPluginRegistryError =>
    new BlockEditorPluginRegistryError(code, message);

const capitalize = (value: string): string => value.slice(0, 1).toUpperCase() + value.slice(1);
