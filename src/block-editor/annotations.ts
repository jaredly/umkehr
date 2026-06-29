import {
    applyMany,
    blockContents,
    deleteBlockOps,
    deleteRangeOps,
    formattedMarkValues,
    isDeleted,
    insertBlockOpsWithId,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    setBlockMetaOps,
    splitBlockOps,
    visibleBlockChildren,
    coveredCharIdsForMark,
    visibleRangesForMark,
    type FormattedBlock,
    type FormattedRun,
    type Op,
    type VisibleMarkRange,
} from '../block-crdt/index.js';
import type {CachedState, JsonValue, Lamport, Mark} from '../block-crdt/types.js';
import {lamportToString, parseLamportString} from '../block-crdt/utils.js';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {caret, focusPoint, normalizeSelectionSegments, segmentText, type EditorSelection} from './selectionModel';
import type {CommandContext, CommandResult} from './blockCommands';
import {markdownShortcutPrefix} from './markdownShortcuts';
import {markRangeOp} from '../block-crdt/index.js';
import {
    ANNOTATION_MARK,
    annotationMarkBehavior,
    richTextVirtualParents,
    type AnnotationMarkData,
    type AnnotationPresentation,
} from './virtualParents';
import {applyCharInsertOpsOrApplyMany, localInsertTextOps} from './localTextOps';
import {CODE_MARK, normalizeStoredCodeLanguage} from './inlineMarks';

export {
    ANNOTATION_MARK,
    annotationMarkBehavior,
    type AnnotationMarkData,
    type AnnotationPresentation,
};

export const annotationVirtualParents = richTextVirtualParents;

export type CreateAnnotationResult = CommandResult & {
    annotationId: Lamport | null;
    bodyBlockId: string | null;
};

export const createAnnotation = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    presentation: AnnotationPresentation,
    context: CommandContext,
): CreateAnnotationResult => {
    const bodyRange = bodySelectionRange(state, selection);
    const segments = (bodyRange
        ? [{blockId: bodyRange.blockId, startOffset: bodyRange.startOffset, endOffset: bodyRange.endOffset}]
        : normalizeSelectionSegments(state, selection)
    ).filter((segment) => segment.startOffset < segment.endOffset);
    if (!segments.length) return {state, ops: [], selection, annotationId: null, bodyBlockId: null};

    const exact = exactAnnotationForSegments(state, segments);
    if (exact) {
        const existingBodies = annotationBodyBlockIds(state, exact);
        const before = existingBodies.at(-1);
        const {ops: bodyOps, blockId: bodyBlockId} = insertBlockOpsWithId(state, {
            actor: context.actor,
            parent: exact,
            before: before ? state.state.blocks[before].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(state),
        });
        return {
            state: applyMany(state, bodyOps, annotationVirtualParents(state)),
            ops: bodyOps,
            selection,
            annotationId: exact,
            bodyBlockId,
        };
    }

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

    const {ops: bodyOps, blockId: bodyBlockId} = insertBlockOpsWithId(working, {
        actor: context.actor,
        parent: markId,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, bodyOps, annotationVirtualParents(working));
    ops.push(...bodyOps);

    return {state: working, ops, selection, annotationId: markId, bodyBlockId};
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
            ts: context.nextTs,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
    }
    if (text.length > 0) {
        const insertOps = localInsertTextOps(working, {
            actor: context.actor,
            block: parseLamportString(bodyBlockId),
            offset: 0,
            text,
        });
        working = applyCharInsertOpsOrApplyMany(working, insertOps);
        ops.push(...insertOps);
    }

    return {state: working, ops, selection: {type: 'caret', point: {blockId: bodyBlockId, offset: segmentText(text).length}}};
};

export const resolveAnnotation = (
    state: CachedState<RichBlockMeta>,
    annotationId: string,
    context: CommandContext,
): CommandResult => {
    const marks = findAnnotationMarks(state, annotationId);
    if (!marks.length) return {state, ops: [], selection: fallbackAnnotationSelection(state)};

    const rangesByMark = marks.map((mark) => ({
        mark,
        ranges: visibleRangesForMark(state, mark, annotationVirtualParents(state)),
    })).filter((entry) => entry.ranges.length > 0);
    const ranges = rangesByMark.flatMap((entry) => entry.ranges);
    if (!ranges.length) return {state, ops: [], selection: fallbackAnnotationSelection(state)};

    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    for (const {mark, ranges: markRanges} of rangesByMark) {
        const originalData = mark.data as unknown as AnnotationMarkData;
        const resolvedData: AnnotationMarkData = {...originalData, resolved: true};
        for (const range of markRanges) {
            const removeOp = annotationMarkRangeOp(working, range, originalData, true, context);
            working = applyMany(working, [removeOp], annotationVirtualParents(working));
            ops.push(removeOp);

            const resolvedOp = annotationMarkRangeOp(working, range, resolvedData, false, context);
            working = applyMany(working, [resolvedOp], annotationVirtualParents(working));
            ops.push(resolvedOp);
        }
    }

    const first = ranges[0];
    return {state: working, ops, selection: caret(first.blockId, first.startOffset)};
};

export const removeAnnotationBodyBlock = (
    state: CachedState<RichBlockMeta>,
    annotationId: string,
    bodyBlockId: string,
    context: CommandContext,
): CommandResult => {
    const mark = findAnnotationMarks(state, annotationId)[0];
    if (!mark) return {state, ops: [], selection: caret(bodyBlockId, 0)};

    const bodyIds = annotationBodyBlockIds(state, (mark.data as unknown as AnnotationMarkData).id);
    const bodyIndex = bodyIds.indexOf(bodyBlockId);
    if (bodyIndex < 0) return {state, ops: [], selection: caret(bodyBlockId, 0)};

    if (bodyIds.length <= 1) {
        return resolveAnnotation(state, annotationId, context);
    }

    const fallbackBodyId = bodyIds[bodyIndex - 1] ?? bodyIds[bodyIndex + 1] ?? bodyIds[0];
    const fallbackTextLength = fallbackBodyId ? segmentText(blockContents(state, fallbackBodyId)).length : 0;
    const ops = deleteBlockOps(state, {
        block: parseLamportString(bodyBlockId),
        mode: 'subtree',
        virtualParents: annotationVirtualParents(state),
            ts: context.nextTs,
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {
        state: next,
        ops,
        selection: fallbackBodyId ? caret(fallbackBodyId, fallbackTextLength) : fallbackAnnotationSelection(next),
    };
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
            ts: context.nextTs,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
    }
    if (text.length > 0) {
        const insertOps = localInsertTextOps(working, {
            actor: context.actor,
            block: parseLamportString(range.blockId),
            offset: range.startOffset,
            text,
        });
        working = applyCharInsertOpsOrApplyMany(working, insertOps);
        ops.push(...insertOps);
    }

    const offset = range.startOffset + segmentText(text).length;
    return {state: working, ops, selection: {type: 'caret', point: {blockId: range.blockId, offset}}};
};

export const pasteAnnotationBodyTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let result = replaceAnnotationBodySelection(state, selection, lines[0] ?? '', context);
    const ops = [...result.ops];
    const firstPoint = focusPoint(result.selection);
    const touchedLines = [
        {
            blockId: firstPoint.blockId,
            startOffset: firstPoint.offset - segmentText(lines[0] ?? '').length,
            sourceLine: lines[0] ?? '',
        },
    ];

    for (let index = 1; index < lines.length; index++) {
        const split = splitAnnotationBodyBlock(result.state, result.selection, context);
        ops.push(...split.ops);
        const inserted = replaceAnnotationBodySelection(split.state, split.selection, lines[index], context);
        ops.push(...inserted.ops);
        result = inserted;
        touchedLines.push({
            blockId: focusPoint(result.selection).blockId,
            startOffset: 0,
            sourceLine: lines[index],
        });
    }

    let working = result.state;
    const removedPrefixByBlock = new Map<string, number>();
    for (const touched of touchedLines) {
        if (touched.startOffset !== 0) continue;
        const block = working.state.blocks[touched.blockId];
        if (!block) continue;
        const shortcut = markdownShortcutPrefix(touched.sourceLine, block.meta, context.nextTs);
        if (!shortcut) continue;
        const currentPrefix = segmentText(blockContents(working, touched.blockId))
            .slice(0, shortcut.length)
            .join('');
        if (currentPrefix !== touched.sourceLine.slice(0, shortcut.length)) continue;

        const deleteOps = deleteRangeOps(working, {
            block: block.id,
            startOffset: 0,
            endOffset: shortcut.length,
            ts: context.nextTs,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        removedPrefixByBlock.set(
            touched.blockId,
            (removedPrefixByBlock.get(touched.blockId) ?? 0) + shortcut.length,
        );

        const metaOps = setBlockMetaOps(working, {block: block.id, meta: shortcut.meta});
        working = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
    }

    return {state: working, ops, selection: adjustSelectionForRemovedPrefixes(result.selection, removedPrefixByBlock)};
};

const adjustSelectionForRemovedPrefixes = (
    selection: EditorSelection,
    removedPrefixByBlock: Map<string, number>,
): EditorSelection => {
    const point = focusPoint(selection);
    const removed = removedPrefixByBlock.get(point.blockId) ?? 0;
    return selection.type === 'caret' && removed
        ? caret(point.blockId, Math.max(0, point.offset - removed))
        : selection;
};

export const splitAnnotationBodyBlock = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range) return {state, ops: [], selection};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    let point = focusPoint(selection);

    if (range.startOffset < range.endOffset) {
        const deleted = replaceAnnotationBodySelection(working, selection, '', context);
        working = deleted.state;
        ops.push(...deleted.ops);
        point = focusPoint(deleted.selection);
    } else {
        point = {blockId: range.blockId, offset: range.startOffset};
    }

    const newBlockId = lamportToString([working.state.maxSeenCount + 1, context.actor]);
    const splitOps = splitBlockOps<RichBlockMeta>(working, {
        actor: context.actor,
        block: parseLamportString(point.blockId),
        offset: point.offset,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, splitOps, annotationVirtualParents(working));
    ops.push(...splitOps);

    return {state: working, ops, selection: caret(newBlockId, 0)};
};

export const deleteAnnotationBodyBackward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
    options: {annotationId?: string; bodyBlockId?: string} = {},
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range) return {state, ops: [], selection};
    if (range.startOffset < range.endOffset) {
        return replaceAnnotationBodySelection(state, selection, '', context);
    }
    if (range.startOffset === 0) {
        const textLength = segmentText(blockContents(state, range.blockId)).length;
        if (textLength === 0 && options.annotationId && options.bodyBlockId) {
            return removeAnnotationBodyBlock(state, options.annotationId, options.bodyBlockId, context);
        }
        return {state, ops: [], selection};
    }

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
    markType: 'bold' | 'italic' | 'strikethrough' | 'underline',
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

export const setAnnotationBodyLink = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    href: string,
    context: CommandContext,
): CommandResult => setAnnotationBodyLinkMark(state, selection, href, false, context);

export const removeAnnotationBodyLink = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setAnnotationBodyLinkMark(state, selection, undefined, true, context);

export const toggleAnnotationBodyCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range || range.startOffset === range.endOffset) return {state, ops: [], selection};

    const formatted = materializeFormattedBlocks(state, annotationVirtualParents(state));
    const block = formatted.find((candidate) => candidate.id === range.blockId);
    const selectedMarks = block ? marksForBodyRange(block, range.startOffset, range.endOffset) : [];
    const remove = selectedMarks.length > 0 && selectedMarks.every((marks) => marks[CODE_MARK] === true || typeof marks[CODE_MARK] === 'string');
    return setAnnotationBodyCodeMarkValue(state, selection, undefined, remove, context);
};

export const setAnnotationBodyCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    language: string,
    context: CommandContext,
): CommandResult => {
    const normalized = normalizeStoredCodeLanguage(language);
    return normalized
        ? setAnnotationBodyCodeMarkValue(state, selection, normalized, false, context)
        : clearAnnotationBodyCodeLanguage(state, selection, context);
};

export const clearAnnotationBodyCodeLanguage = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setAnnotationBodyCodeMarkValue(state, selection, undefined, false, context);

export const removeAnnotationBodyCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setAnnotationBodyCodeMarkValue(state, selection, undefined, true, context);

const setAnnotationBodyLinkMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    href: string | undefined,
    remove: boolean,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range || range.startOffset === range.endOffset) return {state, ops: [], selection};

    const op = markRangeOp(
        state,
        parseLamportString(range.blockId),
        range.startOffset,
        range.endOffset,
        'link',
        href,
        remove,
        [state.state.maxSeenCount + 1, context.actor],
    );
    const next = applyMany(state, [op], annotationVirtualParents(state));
    return {state: next, ops: [op], selection};
};

const setAnnotationBodyCodeMarkValue = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    language: string | undefined,
    remove: boolean,
    context: CommandContext,
): CommandResult => {
    const range = bodySelectionRange(state, selection);
    if (!range || range.startOffset === range.endOffset) return {state, ops: [], selection};

    const op = markRangeOp(
        state,
        parseLamportString(range.blockId),
        range.startOffset,
        range.endOffset,
        CODE_MARK,
        language,
        remove,
        [state.state.maxSeenCount + 1, context.actor],
    );
    const next = applyMany(state, [op], annotationVirtualParents(state));
    return {state: next, ops: [op], selection};
};

const marksForBodyRange = (
    block: FormattedBlock<RichBlockMeta>,
    startOffset: number,
    endOffset: number,
): Array<Record<string, unknown>> => {
    const marksByOffset: Array<Record<string, unknown>> = [];
    for (const run of block.runs) {
        for (const _ of segmentText(run.text)) {
            marksByOffset.push(run.marks);
        }
    }
    return marksByOffset.slice(startOffset, endOffset);
};

const bodySelectionRange = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): {blockId: string; startOffset: number; endOffset: number} | null => {
    if (selection.type !== 'caret' && selection.type !== 'range') return null;
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = selection.type === 'caret' ? selection.point : selection.focus;
    if (anchor.blockId !== focus.blockId) return null;
    if (!state.state.blocks[anchor.blockId]) return null;
    const length = segmentText(blockContents(state, anchor.blockId)).length;
    const startOffset = Math.max(0, Math.min(anchor.offset, focus.offset, length));
    const endOffset = Math.max(0, Math.min(Math.max(anchor.offset, focus.offset), length));
    return {blockId: anchor.blockId, startOffset, endOffset};
};

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
    bodyBlocks: Array<{id: string; text: string; runs: FormattedRun[]; meta: RichBlockMeta}>;
};

export const renderedAnnotations = (
    state: CachedState<RichBlockMeta>,
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    blocksWithAnnotationBodies: Array<FormattedBlock<RichBlockMeta>> = blocks,
): RenderedAnnotation[] => {
    const formattedBodies = new Map(blocksWithAnnotationBodies.map((block) => [block.id, block]));
    const referenceBlocks = blocksWithAnnotationBodies;
    const activeData = activeAnnotationDatasForBlocks(referenceBlocks);
    const seen = new Set<string>();
    return activeData
        .map((data) => {
            const id = lamportToString(data.id);
            const mark = representativeAnnotationMark(state, data);
            const bodyIds = annotationBodyBlockIds(state, data.id);
            if (!mark) return null;
            return {
                id,
                data,
                mark,
                referenceText: annotationReferenceText(referenceBlocks, id),
                bodyBlocks: bodyIds.map((bodyId) => {
                    const formatted = formattedBodies.get(bodyId);
                    const text = formatted
                        ? formatted.runs.map((run) => run.text).join('')
                        : blockContents(state, bodyId);
                    return {
                        id: bodyId,
                        text,
                        runs: formatted?.runs ?? [{text, marks: {}}],
                        meta: state.state.blocks[bodyId]?.meta ?? paragraphMeta(''),
                    };
                }),
            };
        })
        .filter((annotation): annotation is RenderedAnnotation => Boolean(annotation))
        .filter((annotation) => annotation.referenceText.length > 0)
        .filter((annotation) => {
            if (seen.has(annotation.id)) return false;
            seen.add(annotation.id);
            return true;
        })
        .sort((a, b) => {
            const aPosition = firstPositionForAnnotation(referenceBlocks, a.id);
            const bPosition = firstPositionForAnnotation(referenceBlocks, b.id);
            return aPosition.blockIndex - bPosition.blockIndex || aPosition.offset - bPosition.offset;
        });
};

export const isAnnotationData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' && value !== null && Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);

export const isActiveAnnotationData = (value: unknown): value is AnnotationMarkData =>
    isAnnotationData(value) && !value.resolved;

const annotationReferenceText = (blocks: Array<FormattedBlock<RichBlockMeta>>, id: string): string =>
    blocks.flatMap((block) => block.runs).filter((run) => annotationDatasForRun(run).some((data) => lamportToString(data.id) === id)).map((run) => run.text).join('');

const firstPositionForAnnotation = (
    blocks: Array<FormattedBlock<RichBlockMeta>>,
    id: string,
): {blockIndex: number; offset: number} => {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        let offset = 0;
        for (const run of blocks[blockIndex].runs) {
            if (
                annotationDatasForRun(run).some((data) => lamportToString(data.id) === id)
            ) {
                return {blockIndex, offset};
            }
            offset += segmentText(run.text).length;
        }
    }
    return {blockIndex: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER};
};

const annotationDatasForRun = (run: FormattedRun): AnnotationMarkData[] =>
    formattedMarkValues(run, ANNOTATION_MARK).filter(isActiveAnnotationData);

const activeAnnotationDatasForBlocks = (blocks: Array<FormattedBlock<RichBlockMeta>>): AnnotationMarkData[] => {
    const result: AnnotationMarkData[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        for (const run of block.runs) {
            for (const data of annotationDatasForRun(run)) {
                const id = lamportToString(data.id);
                if (seen.has(id)) continue;
                seen.add(id);
                result.push(data);
            }
        }
    }
    return result;
};

const representativeAnnotationMark = (
    state: CachedState<RichBlockMeta>,
    data: AnnotationMarkData,
): Mark | null =>
    findAnnotationMarks(state, lamportToString(data.id)).find((mark) => annotationDataEquals(mark.data, data)) ?? null;

const annotationDataEquals = (value: unknown, data: AnnotationMarkData): boolean =>
    isAnnotationData(value) &&
    lamportToString(value.id) === lamportToString(data.id) &&
    value.presentation === data.presentation &&
    Boolean(value.resolved) === Boolean(data.resolved);

const exactAnnotationForSegments = (
    state: CachedState<RichBlockMeta>,
    segments: Array<{blockId: string; startOffset: number; endOffset: number}>,
): Lamport | null => {
    if (segments.length !== 1) return null;
    const segment = segments[0];
    const selected = orderedVisibleCharIds(state, segment.blockId).slice(segment.startOffset, segment.endOffset);
    if (!selected.length) return null;
    const selectedKey = selected.join('\0');
    const activeData = activeAnnotationDatasForBlocks(materializeFormattedBlocks(state, annotationVirtualParents(state)));
    for (const data of activeData) {
        const mark = representativeAnnotationMark(state, data);
        if (!mark) continue;
        const covered = coveredCharIdsForMark(state, mark, annotationVirtualParents(state))
            .filter((id) => !isDeleted(state.state.chars[id]));
        if (covered.join('\0') === selectedKey) {
            return data.id;
        }
    }
    return null;
};

const orderedVisibleCharIds = (state: CachedState<RichBlockMeta>, blockId: string): string[] =>
    orderedCharIdsForBlock(state, blockId, {visibleOnly: true});

const findAnnotationMarks = (
    state: CachedState<RichBlockMeta>,
    annotationId: string,
): Mark[] => {
    const marks: Mark[] = [];
    for (const mark of Object.values(state.state.marks)) {
        if (mark.type !== ANNOTATION_MARK || mark.remove || !isActiveAnnotationData(mark.data)) continue;
        if (lamportToString(mark.data.id) === annotationId) marks.push(mark);
    }
    return marks;
};

const annotationMarkRangeOp = (
    state: CachedState<RichBlockMeta>,
    range: VisibleMarkRange,
    data: AnnotationMarkData,
    remove: boolean,
    context: CommandContext,
): Op<RichBlockMeta> =>
    markRangeOp(
        state,
        parseLamportString(range.blockId),
        range.startOffset,
        range.endOffset,
        ANNOTATION_MARK,
        data as unknown as JsonValue,
        remove,
        [state.state.maxSeenCount + 1, context.actor],
    );

const fallbackAnnotationSelection = (state: CachedState<RichBlockMeta>): EditorSelection => {
    const blockId = Object.keys(state.state.blocks).find((id) => !isDeleted(state.state.blocks[id]));
    return caret(blockId ?? lamportToString([0, 'root']), 0);
};
