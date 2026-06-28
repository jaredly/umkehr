import type {VirtualBlockParentConfig} from '../block-crdt/index.js';
import type {CachedState, Lamport} from '../block-crdt/types.js';
import {tableVirtualParentsForBlock, type RichBlockMeta} from './blockMeta';

export const ANNOTATION_MARK = 'annotation';

export type AnnotationPresentation = 'sidebar' | 'footnote' | 'popover';

export type AnnotationMarkData = {
    id: Lamport;
    presentation: AnnotationPresentation;
    resolved?: boolean;
};

export const annotationMarkBehavior: VirtualBlockParentConfig<RichBlockMeta> = {
    markBehavior: {[ANNOTATION_MARK]: 'stacking'},
};

export const richTextVirtualParents = (
    _state: CachedState<RichBlockMeta>,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    ...annotationMarkBehavior,
    virtualParents: tableVirtualParentsForBlock,
    markVirtualParents: (mark) =>
        mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data)
            ? [(mark.data as unknown as AnnotationMarkData).id]
            : [],
});

const isAnnotationData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);
