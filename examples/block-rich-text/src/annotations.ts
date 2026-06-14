import {blockContents, insertBlockOps, type FormattedBlock, type Op} from 'umkehr/block-crdt';
import type {CachedState, JsonValue, Lamport, Mark} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import type {VirtualBlockParentConfig} from 'umkehr/block-crdt';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {normalizeSelectionSegments, type EditorSelection} from './selectionModel';
import type {CommandContext, CommandResult} from './blockCommands';
import {applyMany, markRangeOp} from 'umkehr/block-crdt';

export type AnnotationPresentation = 'sidebar' | 'footnote' | 'popover';

export type AnnotationMarkData = {
    id: Lamport;
    presentation: AnnotationPresentation;
    resolved?: boolean;
};

export const ANNOTATION_MARK = 'annotation';

export const createAnnotation = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    presentation: AnnotationPresentation,
    context: CommandContext,
): CommandResult => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return {state, ops: [], selection};

    const markId: Lamport = [state.state.maxSeenCount + 1, context.actor];
    const data: AnnotationMarkData = {id: markId, presentation};
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    for (const segment of segments) {
        const op = markRangeOp(
            working,
            parseLamportString(segment.blockId),
            segment.startOffset,
            segment.endOffset,
            ANNOTATION_MARK,
            data as unknown as JsonValue,
            false,
            ops.length ? [working.state.maxSeenCount + 1, context.actor] : markId,
        );
        working = applyMany(working, [op]);
        ops.push(op);
    }

    const bodyOps = insertBlockOps(working, {
        actor: context.actor,
        parent: markId,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, bodyOps, annotationVirtualParents(working));
    ops.push(...bodyOps);

    return {state: working, ops, selection};
};

export const annotationVirtualParents = (
    _state: CachedState<RichBlockMeta>,
): VirtualBlockParentConfig<RichBlockMeta> => ({
    markVirtualParents: (mark) =>
        mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data)
            ? [(mark.data as unknown as AnnotationMarkData).id]
            : [],
});

export const annotationBodyBlockIds = (
    state: CachedState<RichBlockMeta>,
    annotationId: Lamport,
): string[] => {
    const parentId = lamportToString(annotationId);
    return Object.values(state.state.blocks)
        .filter((block) => !block.deleted && lamportToString(block.order.path.at(-2) ?? [0, 'root']) === parentId)
        .sort((a, b) => lamportToString(a.id).localeCompare(lamportToString(b.id)))
        .map((block) => lamportToString(block.id));
};

export type RenderedAnnotation = {
    id: string;
    data: AnnotationMarkData;
    mark: Mark;
    referenceText: string;
    bodyBlocks: Array<{id: string; text: string}>;
};

export const renderedAnnotations = (
    state: CachedState<RichBlockMeta>,
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    _blocksWithAnnotationBodies: Array<FormattedBlock<RichBlockMeta>> = blocks,
): RenderedAnnotation[] => {
    return Object.values(state.state.marks)
        .filter((mark) => mark.type === ANNOTATION_MARK && !mark.remove && isAnnotationData(mark.data))
        .map((mark) => {
            const id = lamportToString((mark.data as unknown as AnnotationMarkData).id);
            const bodyIds = annotationBodyBlockIds(state, (mark.data as unknown as AnnotationMarkData).id);
            return {
                id,
                data: mark.data as unknown as AnnotationMarkData,
                mark,
                referenceText: annotationReferenceText(blocks, id),
                bodyBlocks: bodyIds.map((bodyId) => ({id: bodyId, text: blockContents(state, bodyId)})),
            };
        })
        .filter((annotation) => annotation.referenceText.length > 0)
        .sort((a, b) => firstBlockIndexForAnnotation(blocks, a.id) - firstBlockIndexForAnnotation(blocks, b.id));
};

export const isAnnotationData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' && value !== null && Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);

const annotationReferenceText = (blocks: Array<FormattedBlock<RichBlockMeta>>, id: string): string =>
    blocks.flatMap((block) => block.runs).filter((run) => run.marks[ANNOTATION_MARK] && lamportToString((run.marks[ANNOTATION_MARK] as unknown as AnnotationMarkData).id) === id).map((run) => run.text).join('');

const firstBlockIndexForAnnotation = (blocks: Array<FormattedBlock<RichBlockMeta>>, id: string): number => {
    const index = blocks.findIndex((block) => block.runs.some((run) => run.marks[ANNOTATION_MARK] && lamportToString((run.marks[ANNOTATION_MARK] as unknown as AnnotationMarkData).id) === id));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};
