import type {VirtualBlockParentConfig} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import type {RichBlockMeta} from './blockMeta';
import {annotationVirtualParents} from './annotations';
import {mergeRichBlockMeta} from './pollBlocks';

export const richTextCrdtConfig = (
    state: CachedState<RichBlockMeta>,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    ...annotationVirtualParents(state),
    mergeBlockMeta: mergeRichBlockMeta,
});
