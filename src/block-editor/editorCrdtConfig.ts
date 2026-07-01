import type {VirtualBlockParentConfig} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import {
    annotationsPlugin,
    createBlockEditorRegistry,
    pollsPlugin,
    tablePlugin,
    type BlockEditorPlugin,
    type BlockEditorRegistry,
} from './plugins/index.js';
import {tableSelectionPluginBundle} from './tableSelectionPlugin.js';

export const legacyAnnotationsCrdtPlugin = annotationsPlugin;

export const legacyStructuralCrdtPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'legacy-structural-crdt',
};

export const legacyPollsCrdtPlugin: BlockEditorPlugin<RichBlockMeta> = pollsPlugin;

export const legacyRichTextCrdtPlugins: readonly BlockEditorPlugin<RichBlockMeta>[] = [
    legacyAnnotationsCrdtPlugin,
    legacyPollsCrdtPlugin,
    tableSelectionPluginBundle,
    tablePlugin,
];

export const legacyRichTextCrdtRegistry: BlockEditorRegistry<RichBlockMeta> =
    createBlockEditorRegistry(legacyRichTextCrdtPlugins);

export const blockEditorCrdtConfigFromRegistry = <Meta extends RichBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
): VirtualBlockParentConfig<Meta> => registry.crdtConfig();

export const richTextVirtualParentsFromRegistry = (
    _state: CachedState<RichBlockMeta>,
    registry: BlockEditorRegistry<RichBlockMeta>,
): VirtualBlockParentConfig<RichBlockMeta> => registry.crdtConfig();

export const richTextCrdtConfig = (
    _state: CachedState<RichBlockMeta>,
    registry: BlockEditorRegistry<RichBlockMeta> = legacyRichTextCrdtRegistry,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    ...registry.crdtConfig(),
});
