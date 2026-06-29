import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta.js';
import type {BlockEditorRegistry, BlockEditorSelectionPlugin} from './plugins/types.js';
import {
    clampPoint,
    editableBlockIds,
    clampSelection,
    firstPointForSelection,
    focusBlockId,
    focusPoint,
    selectedBlockIdsForSelection,
    selectedTopLevelBlockIdsForSelection,
    visibleSubtreeBlockIds,
    type BlockPoint,
    type EditorSelection,
    type PluginEditorSelection,
    type PluginRetainedSelection,
} from './selectionModel.js';
import {
    resolveSelection,
    retainSelection,
    type RetainedSelection,
} from './retainedSelection.js';
import type {BlockLevelSelectionDecorations} from './selectionSet.js';
export {BlockEditorSelectionPluginError} from './selectionPluginError.js';
import {BlockEditorSelectionPluginError} from './selectionPluginError.js';

export const retainSelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): RetainedSelection => {
    if (isCoreSelection(selection)) return retainSelection(state, selection);
    return selectionPlugin(registry, selection.type).retain({
        state,
        selection: selection as PluginEditorSelection,
    }) as RetainedSelection;
};

export const resolveSelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelection,
): EditorSelection => {
    if (isCoreRetainedSelection(selection)) return resolveSelection(state, selection);
    return selectionPlugin(registry, selection.type).resolve({state, selection: selection as PluginRetainedSelection}) as EditorSelection;
};

export const clampSelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): EditorSelection => {
    if (isCoreSelection(selection)) return clampSelection(state, selection);
    const plugin = selectionPlugin(registry, selection.type);
    return (plugin.clamp?.({state, selection: selection as PluginEditorSelection}) ?? selection) as EditorSelection;
};

export const focusPointFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): BlockPoint => {
    if (isCoreSelection(selection)) return focusPoint(selection);
    const plugin = selectionPlugin(registry, selection.type);
    const point = plugin.focusPoint?.({state, selection: selection as PluginEditorSelection});
    if (point) return point;
    return firstPointFromRegistry(registry, state, selection);
};

export const focusBlockIdFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string => {
    if (isCoreSelection(selection)) return focusBlockId(selection);
    const plugin = selectionPlugin(registry, selection.type);
    return (
        plugin.focusBlockId?.({state, selection: selection as PluginEditorSelection}) ??
        focusPointFromRegistry(registry, state, selection).blockId
    );
};

export const firstPointFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): BlockPoint => {
    if (isCoreSelection(selection)) return firstPointForSelection(state, selection);
    const plugin = selectionPlugin(registry, selection.type);
    return (
        plugin.firstPoint?.({state, selection: selection as PluginEditorSelection}) ?? {
            blockId: selectedBlockIdsFromRegistry(registry, state, selection)[0] ?? '',
            offset: 0,
        }
    );
};

export const selectedBlockIdsFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    if (isCoreSelection(selection)) return selectedBlockIdsForSelection(state, selection);
    const plugin = selectionPlugin(registry, selection.type);
    return [...(plugin.selectedBlockIds?.({state, selection: selection as PluginEditorSelection}) ?? [])];
};

export const selectedTopLevelBlockIdsFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    if (isCoreSelection(selection)) return selectedTopLevelBlockIdsForSelection(state, selection);
    const plugin = selectionPlugin(registry, selection.type);
    return [
        ...(plugin.selectedTopLevelBlockIds?.({state, selection: selection as PluginEditorSelection}) ??
            selectedBlockIdsFromRegistry(registry, state, selection)),
    ];
};

export const blockLevelDecorationsForSelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    entryId: string,
    primary: boolean,
): Map<string, BlockLevelSelectionDecorations> => {
    if (selection.type === 'block') {
        const result = new Map<string, BlockLevelSelectionDecorations>();
        const focusId = focusBlockId(selection);
        for (const blockId of selectedTopLevelBlockIdsForSelection(state, selection)) {
            result.set(blockId, {
                selected: true,
                primary,
                focus: blockId === focusId || visibleSubtreeBlockIds(state, blockId).includes(focusId),
            });
        }
        return result;
    }
    if (selection.type === 'caret' || selection.type === 'range') return new Map();
    const plugin = selectionPlugin(registry, selection.type);
    return new Map(
        plugin.blockLevelDecorations?.({
            state,
            selection: selection as PluginEditorSelection,
            entryId,
            primary,
        }) ?? [],
    );
};

export const compareSelectionsFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    one: EditorSelection,
    two: EditorSelection,
): number => {
    if (!isCoreSelection(one) && one.type === two.type) {
        const compared = selectionPlugin(registry, one.type).compare?.({
            state,
            one: one as PluginEditorSelection,
            two: two as PluginEditorSelection,
        });
        if (typeof compared === 'number') return compared;
    }
    return comparePoints(state, firstPointFromRegistry(registry, state, one), firstPointFromRegistry(registry, state, two));
};

const isCoreSelection = (selection: EditorSelection): boolean =>
    selection.type === 'caret' || selection.type === 'range' || selection.type === 'block';

const isCoreRetainedSelection = (selection: RetainedSelection): boolean =>
    selection.type === 'caret' || selection.type === 'range' || selection.type === 'block';

const selectionPlugin = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    type: string,
): BlockEditorSelectionPlugin<RichBlockMeta> => {
    const plugin = registry.selectionPlugins.get(type);
    if (!plugin) {
        throw new BlockEditorSelectionPluginError(
            'unknown-selection-plugin',
            `Selection type "${type}" does not have a registered selection plugin.`,
        );
    }
    return plugin;
};

const comparePoints = (state: CachedState<RichBlockMeta>, one: BlockPoint, two: BlockPoint): number => {
    const oneClamped = clampPoint(state, one);
    const twoClamped = clampPoint(state, two);
    const blocks = editableBlockIds(state);
    return (
        blocks.indexOf(oneClamped.blockId) - blocks.indexOf(twoClamped.blockId) ||
        oneClamped.offset - twoClamped.offset ||
        oneClamped.blockId.localeCompare(twoClamped.blockId)
    );
};
