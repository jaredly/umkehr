import type {Lamport} from '../../block-crdt/types.js';
import type {RichBlockMeta} from '../blockMeta.js';
import {
    ANNOTATION_MARK,
    annotationMarkBehavior,
    isAnnotationData,
    type AnnotationMarkData,
    type AnnotationPresentation,
} from '../annotations.js';
import type {BlockEditorPlugin} from './types.js';

export const annotationMarkVirtualParents = (mark: {
    type: string;
    remove: boolean;
    data?: unknown;
}): readonly Lamport[] =>
    mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data) ? [mark.data.id] : [];

export const annotationsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'annotations',
    marks: [{id: ANNOTATION_MARK, label: 'Annotation'}],
    toolbarItems: [
        {
            id: 'annotation:sidebar',
            group: 'Annotations',
            label: 'Comment',
            order: 30,
            commandId: 'annotation:sidebar',
        },
        {
            id: 'annotation:footnote',
            group: 'Annotations',
            label: 'Footnote',
            order: 31,
            commandId: 'annotation:footnote',
        },
        {
            id: 'annotation:popover',
            group: 'Annotations',
            label: 'Popover',
            order: 32,
            commandId: 'annotation:popover',
        },
    ],
    commands: [
        {id: 'annotation:sidebar', handle: () => undefined},
        {id: 'annotation:footnote', handle: () => undefined},
        {id: 'annotation:popover', handle: () => undefined},
        {id: 'annotation:resolve', handle: () => undefined},
        {id: 'annotation:body-replace-selection', handle: () => undefined},
        {id: 'annotation:body-split-block', handle: () => undefined},
        {id: 'annotation:body-delete-backward', handle: () => undefined},
        {id: 'annotation:body-delete-forward', handle: () => undefined},
        {id: 'annotation:body-remove-block', handle: () => undefined},
        {id: 'annotation:body-toggle-mark', handle: () => undefined},
        {id: 'annotation:body-set-link', handle: () => undefined},
        {id: 'annotation:body-remove-link', handle: () => undefined},
        {id: 'annotation:body-toggle-code', handle: () => undefined},
        {id: 'annotation:body-set-code-language', handle: () => undefined},
        {id: 'annotation:body-clear-code-language', handle: () => undefined},
        {id: 'annotation:body-remove-code', handle: () => undefined},
    ],
    inlineRenderers: [{id: 'annotations.inline', markType: ANNOTATION_MARK, render: () => null}],
    destinationRenderers: [
        {id: 'annotations.sidebar', destination: 'sidebar', order: 20, render: () => null},
        {id: 'annotations.footer', destination: 'footer', order: 20, render: () => null},
        {id: 'annotations.floating', destination: 'floating', order: 20, render: () => null},
    ],
    crdt: {
        markBehavior: annotationMarkBehavior.markBehavior,
        markVirtualParents: annotationMarkVirtualParents,
    },
};

export type {AnnotationMarkData, AnnotationPresentation};
