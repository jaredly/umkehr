import {describe, expect, it} from 'vitest';

import type {RichBlockMeta} from '../blockMeta';
import {
    ANNOTATION_MARK,
    footnoteNumberByAnnotationId,
    popoverTextByAnnotationId,
    renderedAnnotationMapById,
    renderedAnnotationsByPresentation,
    type RenderedAnnotation,
} from '../annotations';
import {createBlockEditorRegistry} from './registry';
import {annotationsPlugin} from './annotations';
import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import type {CachedState} from '../../block-crdt/types';

const emptyState = (): CachedState<RichBlockMeta> => ({
    state: {
        chars: {},
        blocks: {},
        marks: {},
        splits: {},
        joins: {},
        maxSeenCount: 0,
    },
    cache: {
        blockChildren: {},
        charContents: {},
        joinSentinels: {},
        joinedBlocks: {},
    },
});

describe('annotations plugin', () => {
    it('declares annotation compatibility, UI ownership, destinations, and CRDT hooks', () => {
        const registry = createBlockEditorRegistry([annotationsPlugin]);

        expect(registry.marks.has(ANNOTATION_MARK)).toBe(true);
        expect(registry.toolbarItems.map((item) => item.id)).toEqual([
            'annotation:sidebar',
            'annotation:footnote',
            'annotation:popover',
        ]);
        expect([...registry.commands.keys()]).toEqual([
            'annotation:sidebar',
            'annotation:footnote',
            'annotation:popover',
            'annotation:resolve',
            'annotation:body-replace-selection',
            'annotation:body-split-block',
            'annotation:body-delete-backward',
            'annotation:body-delete-forward',
            'annotation:body-remove-block',
            'annotation:body-toggle-mark',
            'annotation:body-set-link',
            'annotation:body-remove-link',
            'annotation:body-toggle-code',
            'annotation:body-set-code-language',
            'annotation:body-clear-code-language',
            'annotation:body-remove-code',
        ]);
        expect(registry.inlineRenderers.map((renderer) => renderer.markType)).toEqual([ANNOTATION_MARK]);
        expect(registry.destinationRenderers.get('sidebar')?.map((renderer) => renderer.id)).toEqual([
            'annotations.sidebar',
        ]);
        expect(registry.destinationRenderers.get('footer')?.map((renderer) => renderer.id)).toEqual([
            'annotations.footer',
        ]);
        expect(registry.destinationRenderers.get('floating')?.map((renderer) => renderer.id)).toEqual([
            'annotations.floating',
        ]);
        expect(registry.crdtConfig().markBehavior).toEqual({annotation: 'stacking'});
        expect(
            registry.crdtConfig().markVirtualParents?.({
                id: [1, 'a'],
                start: {id: [2, 'a'], at: 'before'},
                remove: false,
                type: ANNOTATION_MARK,
                data: {id: [3, 'a'], presentation: 'sidebar'},
                crossedSplits: [],
            }),
        ).toEqual([[3, 'a']]);
    });

    it('does not contribute structural block virtual parents', () => {
        const registry = createBlockEditorRegistry([annotationsPlugin]);

        expect(registry.crdtConfig().virtualParents).toBeUndefined();
    });

    it('allows annotation marks during compatibility checks', () => {
        const registry = createBlockEditorRegistry([annotationsPlugin]);
        const state = emptyState();
        state.state.marks.annotation = {
            id: [1, 'a'],
            start: {id: [2, 'a'], at: 'before'},
            end: {id: [3, 'a'], at: 'after'},
            remove: false,
            type: ANNOTATION_MARK,
            data: {id: [4, 'a'], presentation: 'sidebar'},
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });

    it('provides pure selectors for annotation destinations', () => {
        const annotations = [
            renderedAnnotation('c1', 'sidebar', 'comment'),
            renderedAnnotation('f1', 'footnote', 'footnote'),
            renderedAnnotation('p1', 'popover', 'popover body'),
            renderedAnnotation('f2', 'footnote', 'second footnote'),
            renderedAnnotation('p2', 'popover', ''),
        ];

        expect(renderedAnnotationsByPresentation(annotations, 'footnote').map((item) => item.id)).toEqual([
            'f1',
            'f2',
        ]);
        expect(renderedAnnotationMapById(annotations, 'popover').get('p1')?.referenceText).toBe('p1 reference');
        expect([...popoverTextByAnnotationId(annotations).entries()]).toEqual([
            ['p1', 'popover body'],
            ['p2', 'Empty popover'],
        ]);
        expect([...footnoteNumberByAnnotationId(annotations).entries()]).toEqual([
            ['f1', 1],
            ['f2', 2],
        ]);
    });
});

const renderedAnnotation = (
    id: string,
    presentation: 'sidebar' | 'footnote' | 'popover',
    bodyText: string,
): RenderedAnnotation => ({
    id,
    data: {id: [Number(id.slice(1)) || 1, 'a'], presentation},
    mark: {
        id: [100 + (Number(id.slice(1)) || 1), 'a'],
        start: {id: [1, 'a'], at: 'before'},
        end: {id: [2, 'a'], at: 'after'},
        remove: false,
        type: ANNOTATION_MARK,
        data: {id: [Number(id.slice(1)) || 1, 'a'], presentation},
        crossedSplits: [],
    },
    referenceText: `${id} reference`,
    bodyBlocks: [
        {
            id: `${id}-body`,
            text: bodyText,
            runs: [{text: bodyText, marks: {}}],
            meta: {type: 'paragraph', ts: '1'},
        },
    ],
});
