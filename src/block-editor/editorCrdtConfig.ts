import type {VirtualBlockParentConfig} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import {tableVirtualParentsForBlock} from './blockMeta';
import {mergeRichBlockMeta} from './pollBlocks';
import {
    annotationsPlugin,
    createBlockEditorRegistry,
    type BlockEditorPlugin,
    type BlockEditorRegistry,
} from './plugins/index.js';

export const legacyAnnotationsCrdtPlugin = annotationsPlugin;

export const legacyStructuralCrdtPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'legacy-structural-crdt',
    crdt: {
        virtualParents: tableVirtualParentsForBlock,
    },
};

export const legacyPollsCrdtPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'polls',
    crdt: {
        mergeBlockMetaTypes: ['poll'],
        mergeBlockMeta: mergeRichBlockMeta,
    },
};

export const legacyRichTextCrdtPlugins: readonly BlockEditorPlugin<RichBlockMeta>[] = [
    legacyAnnotationsCrdtPlugin,
    legacyStructuralCrdtPlugin,
    legacyPollsCrdtPlugin,
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
