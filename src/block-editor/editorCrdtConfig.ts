import type {VirtualBlockParentConfig} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import {tableVirtualParentsForBlock} from './blockMeta';
import {ANNOTATION_MARK, annotationMarkBehavior, isAnnotationData} from './annotations';
import {mergeRichBlockMeta} from './pollBlocks';
import {createBlockEditorRegistry, type BlockEditorPlugin, type BlockEditorRegistry} from './plugins/index.js';

export const legacyAnnotationsCrdtPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'annotations',
    marks: [{id: ANNOTATION_MARK, label: 'Annotation'}],
    crdt: {
        markBehavior: annotationMarkBehavior.markBehavior,
        virtualParents: tableVirtualParentsForBlock,
        markVirtualParents: (mark) =>
            mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data)
                ? [mark.data.id]
                : [],
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
    legacyPollsCrdtPlugin,
];

export const legacyRichTextCrdtRegistry: BlockEditorRegistry<RichBlockMeta> =
    createBlockEditorRegistry(legacyRichTextCrdtPlugins);

export const blockEditorCrdtConfigFromRegistry = <Meta extends RichBlockMeta>(
    registry: BlockEditorRegistry<Meta>,
): VirtualBlockParentConfig<Meta> => registry.crdtConfig();

export const richTextCrdtConfig = (
    _state: CachedState<RichBlockMeta>,
    registry: BlockEditorRegistry<RichBlockMeta> = legacyRichTextCrdtRegistry,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    ...registry.crdtConfig(),
});
