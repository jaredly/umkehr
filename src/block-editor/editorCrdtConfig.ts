import type {VirtualBlockParentConfig} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import {annotationVirtualParents} from './annotations';
import {mergeRichBlockMeta} from './pollBlocks';

export const richTextCrdtConfig = (
    state: CachedState<RichBlockMeta>,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    ...annotationVirtualParents(state),
    mergeBlockMeta: mergeRichBlockMeta,
});
