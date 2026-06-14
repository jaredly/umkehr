import {
    blockContents,
    deleteRangeOps,
    insertBlockOps,
    insertTextOps,
    visibleBlockChildren,
    type FormattedBlock,
    type FormattedRun,
    type Op,
} from 'umkehr/block-crdt';
import type {CachedState, JsonValue, Lamport, Mark} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import type {VirtualBlockParentConfig} from 'umkehr/block-crdt';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {normalizeSelectionSegments, segmentText, type EditorSelection} from './selectionModel';
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

export const setAnnotationBodyText = (
    state: CachedState<RichBlockMeta>,
    bodyBlockId: string,
    text: string,
    context: CommandContext,
): CommandResult => {
    const block = state.state.blocks[bodyBlockId];
    if (!block) return {state, ops: [], selection: {type: 'caret', point: {blockId: bodyBlockId, offset: 0}}};

    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    const existingLength = segmentText(blockContents(working, bodyBlockId)).length;
    if (existingLength > 0) {
        const deleteOps = deleteRangeOps(working, {
            block: parseLamportString(bodyBlockId),
            startOffset: 0,
            endOffset: existingLength,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
    }
    if (text.length > 0) {
        const insertOps = insertTextOps(working, {
            actor: context.actor,
            block: parseLamportString(bodyBlockId),
            offset: 0,
            text,
            ts: context.nextTs,
        });
        working = applyMany(working, insertOps, annotationVirtualParents(working));
        ops.push(...insertOps);
    }

    return {state: working, ops, selection: {type: 'caret', point: {blockId: bodyBlockId, offset: segmentText(text).length}}};
};

export const replaceAnnotationBodySelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range) return {state, ops: [], selection};

    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    if (range.startOffset < range.endOffset) {
        const deleteOps = deleteRangeOps(working, {
            block: parseLamportString(range.blockId),
            startOffset: range.startOffset,
            endOffset: range.endOffset,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
    }
    if (text.length > 0) {
        const insertOps = insertTextOps(working, {
            actor: context.actor,
            block: parseLamportString(range.blockId),
            offset: range.startOffset,
            text,
            ts: context.nextTs,
        });
        working = applyMany(working, insertOps, annotationVirtualParents(working));
        ops.push(...insertOps);
    }

    const offset = range.startOffset + segmentText(text).length;
    return {state: working, ops, selection: {type: 'caret', point: {blockId: range.blockId, offset}}};
};

export const deleteAnnotationBodyBackward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range) return {state, ops: [], selection};
    if (range.startOffset < range.endOffset) {
        return replaceAnnotationBodySelection(state, selection, '', context);
    }
    if (range.startOffset === 0) return {state, ops: [], selection};

    const deleteSelection: EditorSelection = {
        type: 'range',
        anchor: {blockId: range.blockId, offset: range.startOffset - 1},
        focus: {blockId: range.blockId, offset: range.startOffset},
    };
    return replaceAnnotationBodySelection(state, deleteSelection, '', context);
};

export const deleteAnnotationBodyForward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range) return {state, ops: [], selection};
    if (range.startOffset < range.endOffset) {
        return replaceAnnotationBodySelection(state, selection, '', context);
    }
    if (range.startOffset >= segmentText(blockContents(state, range.blockId)).length) {
        return {state, ops: [], selection};
    }

    const deleteSelection: EditorSelection = {
        type: 'range',
        anchor: {blockId: range.blockId, offset: range.startOffset},
        focus: {blockId: range.blockId, offset: range.startOffset + 1},
    };
    return replaceAnnotationBodySelection(state, deleteSelection, '', context);
};

export const toggleAnnotationBodyMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    markType: 'bold' | 'italic',
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range || range.startOffset === range.endOffset) return {state, ops: [], selection};

    const op = markRangeOp(
        state,
        parseLamportString(range.blockId),
        range.startOffset,
        range.endOffset,
        markType,
        true,
        false,
        [state.state.maxSeenCount + 1, context.actor],
    );
    const next = applyMany(state, [op], annotationVirtualParents(state));
    return {state: next, ops: [op], selection};
};

const bodySelectionRange = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): {blockId: string; startOffset: number; endOffset: number} | null => {
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = selection.type === 'caret' ? selection.point : selection.focus;
    if (anchor.blockId !== focus.blockId) return null;
    if (!state.state.blocks[anchor.blockId]) return null;
    const length = segmentText(blockContents(state, anchor.blockId)).length;
    const startOffset = Math.max(0, Math.min(anchor.offset, focus.offset, length));
    const endOffset = Math.max(0, Math.min(Math.max(anchor.offset, focus.offset), length));
    return {blockId: anchor.blockId, startOffset, endOffset};
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
    return visibleBlockChildren(state, parentId, annotationVirtualParents(state));
};

export type RenderedAnnotation = {
    id: string;
    data: AnnotationMarkData;
    mark: Mark;
    referenceText: string;
    bodyBlocks: Array<{id: string; text: string; runs: FormattedRun[]}>;
};

export const renderedAnnotations = (
    state: CachedState<RichBlockMeta>,
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    blocksWithAnnotationBodies: Array<FormattedBlock<RichBlockMeta>> = blocks,
): RenderedAnnotation[] => {
    const formattedBodies = new Map(blocksWithAnnotationBodies.map((block) => [block.id, block]));
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
                bodyBlocks: bodyIds.map((bodyId) => {
                    const formatted = formattedBodies.get(bodyId);
                    const text = formatted
                        ? formatted.runs.map((run) => run.text).join('')
                        : blockContents(state, bodyId);
                    return {id: bodyId, text, runs: formatted?.runs ?? [{text, marks: {}}]};
                }),
            };
        })
        .filter((annotation) => annotation.referenceText.length > 0)
        .sort((a, b) => {
            const aPosition = firstPositionForAnnotation(blocks, a.id);
            const bPosition = firstPositionForAnnotation(blocks, b.id);
            return aPosition.blockIndex - bPosition.blockIndex || aPosition.offset - bPosition.offset;
        });
};

export const isAnnotationData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' && value !== null && Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);

const annotationReferenceText = (blocks: Array<FormattedBlock<RichBlockMeta>>, id: string): string =>
    blocks.flatMap((block) => block.runs).filter((run) => run.marks[ANNOTATION_MARK] && lamportToString((run.marks[ANNOTATION_MARK] as unknown as AnnotationMarkData).id) === id).map((run) => run.text).join('');

const firstPositionForAnnotation = (
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    id: string,
): {blockIndex: number; offset: number} => {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        let offset = 0;
        for (const run of blocks[blockIndex].runs) {
            if (
                run.marks[ANNOTATION_MARK] &&
                lamportToString((run.marks[ANNOTATION_MARK] as unknown as AnnotationMarkData).id) === id
            ) {
                return {blockIndex, offset};
            }
            offset += segmentText(run.text).length;
        }
    }
    return {blockIndex: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER};
};
