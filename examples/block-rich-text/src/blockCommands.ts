import equal from 'fast-deep-equal';
import {
    applyMany,
    blockContents,
    deleteRangeOps,
    insertBlockOps,
    insertTextOps,
    joinBlocksOps,
    markRangeOp,
    materializeFormattedBlocks,
    materializedBlockParent,
    materializedBlockPath,
    moveBlockOps,
    orderedCharIdsForBlock,
    setBlockMetaOps,
    splitBlockOps,
    visibleBlockChildren,
    visibleBlockOutline,
    type Op,
} from 'umkehr/block-crdt';
import {createLseqIdBetween} from 'umkehr/block-crdt/lseq';
import type {BlockOrderTs, CachedState, Lamport} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import {paragraphMeta, sameTypeWithTs, type RichBlockMeta} from './blockMeta';
import {
    caret,
    clampPoint,
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    segmentText,
    visibleBlockIds,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';

export type CommandContext = {
    actor: string;
    nextTs(): string;
};

export type CommandResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    selection: EditorSelection;
};

export type MoveTarget =
    | {type: 'before'; targetBlockId: string}
    | {type: 'after'; targetBlockId: string}
    | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};

const ROOT: Lamport = [0, 'root'];
const ROOT_ID = lamportToString(ROOT);

export const insertText = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        if (deleted.ops.length) {
            working = deleted.state;
            ops.push(...deleted.ops);
            point = deleted.point;
        }
    }

    const inserted = insertTextAtPoint(working, point, text, context);
    ops.push(...inserted.ops);
    return {state: inserted.state, ops, selection: caret(inserted.point.blockId, inserted.point.offset)};
};

export const deleteBackward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(state, selection, context);
        return {state: deleted.state, ops: deleted.ops, selection: caret(deleted.point.blockId, deleted.point.offset)};
    }

    const point = focusPoint(selection);
    if (point.offset > 0) {
        const ops = deleteRangeOps(state, {
            block: parseLamportString(point.blockId),
            startOffset: point.offset - 1,
            endOffset: point.offset,
        });
        const next = applyMany(state, ops);
        return {state: next, ops, selection: caret(point.blockId, point.offset - 1)};
    }

    return joinWithPrevious(state, point.blockId, context);
};

export const deleteForward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(state, selection, context);
        return {state: deleted.state, ops: deleted.ops, selection: caret(deleted.point.blockId, deleted.point.offset)};
    }

    const point = focusPoint(selection);
    if (point.offset < pointTextLength(state, point.blockId)) {
        const ops = deleteRangeOps(state, {
            block: parseLamportString(point.blockId),
            startOffset: point.offset,
            endOffset: point.offset + 1,
        });
        const next = applyMany(state, ops);
        return {state: next, ops, selection: caret(point.blockId, point.offset)};
    }

    return joinWithNext(state, point.blockId, context);
};

export const splitBlock = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
    options: {forceCodeNewline?: boolean} = {},
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        if (deleted.ops.length) {
            working = deleted.state;
            ops.push(...deleted.ops);
            point = deleted.point;
        }
    }

    const newBlockId = lamportToString([working.state.maxSeenCount + 1, context.actor]);
    const currentMeta = working.state.blocks[point.blockId]?.meta;
    if (currentMeta && currentMeta.type !== 'paragraph' && pointTextLength(working, point.blockId) === 0) {
        const ops = setBlockMetaOps(working, {
            block: parseLamportString(point.blockId),
            meta: paragraphMeta(context.nextTs()),
        });
        const next = applyMany(working, ops);
        return {state: next, ops, selection: caret(point.blockId, 0)};
    }

    if (currentMeta?.type === 'code' && !options.forceCodeNewline && shouldExitCodeBlock(working, point)) {
        return exitCodeBlock(working, point.blockId, context);
    }

    if (currentMeta?.type === 'code') {
        const inserted = insertTextAtPoint(working, point, '\n', context);
        return {state: inserted.state, ops: inserted.ops, selection: caret(inserted.point.blockId, inserted.point.offset)};
    }

    const splitOps = splitBlockOps<RichBlockMeta>(working, {
        actor: context.actor,
        block: parseLamportString(point.blockId),
        offset: point.offset,
        ts: context.nextTs(),
    });
    const next = applyMany(working, splitOps);
    ops.push(...splitOps);
    return {state: next, ops, selection: caret(newBlockId, 0)};
};

export const pastePlainText = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let result = insertText(state, selection, lines[0] ?? '', context);
    const ops = [...result.ops];

    for (let index = 1; index < lines.length; index++) {
        const splitResult = splitBlock(result.state, result.selection, context);
        ops.push(...splitResult.ops);
        const inserted = insertText(splitResult.state, splitResult.selection, lines[index], context);
        ops.push(...inserted.ops);
        result = inserted;
    }

    return {...result, ops};
};

export const toggleMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    markType: 'bold' | 'italic',
    context: CommandContext,
): CommandResult => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return {state, ops: [], selection};

    const remove = selectionFullyHasMark(state, segments, markType);
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const segment of segments) {
        const op = markRangeOp(
            working,
            parseLamportString(segment.blockId),
            segment.startOffset,
            segment.endOffset,
            markType,
            undefined,
            remove,
            [working.state.maxSeenCount + 1, context.actor],
        );
        working = applyMany(working, [op]);
        ops.push(op);
    }

    return {state: working, ops, selection};
};

export const setBlockType = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    meta: RichBlockMeta,
): CommandResult => setBlockMeta(state, blockId, meta);

export const setBlockMeta = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    meta: RichBlockMeta,
): CommandResult => {
    const current = state.state.blocks[blockId];
    if (!current || equal(current.meta, meta)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
    const ops = setBlockMetaOps(state, {block: current.id, meta});
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(blockId, 0)};
};

export const updateBlockMeta = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    update: (current: RichBlockMeta, ts: string) => RichBlockMeta,
    context: CommandContext,
): CommandResult => {
    const current = state.state.blocks[blockId];
    if (!current) return {state, ops: [], selection: caret(blockId, 0)};
    return setBlockMeta(state, blockId, update(current.meta, context.nextTs()));
};

export const refreshBlockMetaTimestamp = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult =>
    updateBlockMeta(state, blockId, (meta, ts) => sameTypeWithTs(meta, ts), context);

export const moveBlock = (
    state: CachedState<RichBlockMeta>,
    movedBlockId: string,
    target: MoveTarget,
    context: CommandContext,
): CommandResult => {
    const current = state.state.blocks[movedBlockId];
    if (!current || !visibleBlockIds(state).includes(movedBlockId)) {
        return {state, ops: [], selection: caret(movedBlockId, 0)};
    }

    const resolved = resolveMoveTarget(state, movedBlockId, target);
    if (!resolved) return {state, ops: [], selection: caret(movedBlockId, 0)};

    const parent = parentFromPath(resolved.parentPath);
    const ops = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent,
        before: resolved.beforeId ? state.state.blocks[resolved.beforeId].id : null,
        after: resolved.afterId ? state.state.blocks[resolved.afterId].id : null,
        ts: context.nextTs(),
    });
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(movedBlockId, 0)};
};

const resolveMoveTarget = (
    state: CachedState<RichBlockMeta>,
    movedBlockId: string,
    target: MoveTarget,
): {parentPath: Lamport[]; beforeId: string | null; afterId: string | null} | null => {
    const targetParentId =
        target.type === 'child'
            ? target.parentBlockId
            : rawParentIdForVisibleBlock(state, target.targetBlockId);
    if (targetParentId === null) return null;
    if (target.type === 'child' && target.parentBlockId === movedBlockId) return null;
    if (target.type !== 'child' && target.targetBlockId === movedBlockId) return null;
    if (target.type !== 'child' && isDescendantOf(state, target.targetBlockId, movedBlockId)) return null;
    if (targetParentId !== ROOT_ID && isDescendantOrSelf(state, targetParentId, movedBlockId)) return null;

    const siblings = visibleBlockChildren(state, targetParentId).filter((id) => id !== movedBlockId);
    let insertIndex: number;
    if (target.type === 'child') {
        if (targetParentId !== ROOT_ID && !state.state.blocks[targetParentId]) return null;
        insertIndex = target.at === 'start' ? 0 : siblings.length;
    } else {
        const targetIndex = siblings.indexOf(target.targetBlockId);
        if (targetIndex < 0) return null;
        insertIndex = target.type === 'after' ? targetIndex + 1 : targetIndex;
    }

    const beforeId = insertIndex > 0 ? siblings[insertIndex - 1] : null;
    const afterId = siblings[insertIndex] ?? null;
    const parentPath = targetParentId === ROOT_ID ? [] : materializedBlockPath(state, targetParentId);
    const currentParent = visibleParentIdForBlock(state, movedBlockId);
    if (currentParent === null) return null;
    const currentSiblings = visibleBlockChildren(state, currentParent);
    const currentIndex = currentSiblings.indexOf(movedBlockId);
    const nextSibling = currentSiblings[currentIndex + 1] ?? null;
    const previousSibling = currentIndex > 0 ? currentSiblings[currentIndex - 1] : null;
    if (
        currentParent === targetParentId &&
        ((beforeId === previousSibling && afterId === nextSibling) ||
            (beforeId === movedBlockId && afterId === nextSibling) ||
            (beforeId === previousSibling && afterId === movedBlockId))
    ) {
        return null;
    }

    return {parentPath, beforeId, afterId};
};

const isDescendantOrSelf = (state: CachedState<RichBlockMeta>, blockId: string, ancestorId: string): boolean =>
    blockId === ancestorId || isDescendantOf(state, blockId, ancestorId);

const rawParentIdForVisibleBlock = (state: CachedState<RichBlockMeta>, blockId: string): string | null =>
    visibleParentIdForBlock(state, blockId);

const visibleParentIdForBlock = (state: CachedState<RichBlockMeta>, blockId: string): string | null =>
    visibleBlockOutline(state).find((item) => item.id === blockId)?.parentId ?? null;

const isDescendantOf = (state: CachedState<RichBlockMeta>, blockId: string, ancestorId: string): boolean => {
    const path = materializedBlockPath(state, blockId).map(lamportToString);
    return path.includes(ancestorId) && blockId !== ancestorId;
};

export const indentBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const current = state.state.blocks[blockId];
    if (!current || !visibleBlockIds(state).includes(blockId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parentId = lamportToString(materializedBlockParent(state, blockId));
    const siblings = visibleBlockChildren(state, parentId);
    const index = siblings.indexOf(blockId);
    const previousBlockId = siblings[index - 1];
    const previous = previousBlockId ? state.state.blocks[previousBlockId] : null;
    if (index <= 0 || !previous) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const previousChildren = visibleBlockChildren(state, previousBlockId);
    const lastChildId = previousChildren[previousChildren.length - 1] ?? null;
    const ops = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent: previous.id,
        before: lastChildId ? state.state.blocks[lastChildId].id : null,
        after: null,
        ts: context.nextTs(),
    });
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(blockId, 0)};
};

export const unindentBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const current = state.state.blocks[blockId];
    if (!current || !visibleBlockIds(state).includes(blockId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parentId = lamportToString(materializedBlockParent(state, blockId));
    if (parentId === ROOT_ID) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parent = state.state.blocks[parentId];
    if (!parent) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parentPath = materializedBlockPath(state, parentId);
    const grandparentPath = parentPath.slice(0, -1);
    const grandparentId =
        grandparentPath.length > 0 ? lamportToString(grandparentPath[grandparentPath.length - 1]) : ROOT_ID;
    const grandparentChildren = visibleBlockChildren(state, grandparentId).filter(
        (id) => id !== blockId,
    );
    const parentIndex = grandparentChildren.indexOf(parentId);
    const afterParentId = parentIndex >= 0 ? grandparentChildren[parentIndex + 1] : null;
    const siblings = visibleBlockChildren(state, parentId);
    const blockIndex = siblings.indexOf(blockId);
    const followingSiblings = blockIndex >= 0 ? siblings.slice(blockIndex + 1) : [];
    const ops: Array<Op<RichBlockMeta>> = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent: parentFromPath(grandparentPath),
        before: parent.id,
        after: afterParentId ? state.state.blocks[afterParentId].id : null,
        ts: context.nextTs(),
    });

    for (const siblingId of followingSiblings) {
        const sibling = state.state.blocks[siblingId];
        if (!sibling) continue;
        ops.push({
            type: 'block:move',
            id: sibling.id,
            order: {
                id: [state.state.maxSeenCount + ops.length + 1, context.actor],
                path: [...grandparentPath, current.id, sibling.id],
                index: sibling.order.index,
                ts: [lastBlockOrderTs(sibling.order.ts), current.order.index, context.nextTs()],
            },
        });
    }

    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(blockId, 0)};
};

export const joinWithPrevious = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const blocks = visibleBlockIds(state);
    const index = blocks.indexOf(blockId);
    if (index <= 0) return {state, ops: [], selection: caret(blockId, 0)};

    const previousBlockId = blocks[index - 1];
    const previousLength = pointTextLength(state, previousBlockId);
    const ops = joinBlocksOps(
        state,
        {
            actor: context.actor,
            left: parseLamportString(previousBlockId),
            right: parseLamportString(blockId),
            ts: context.nextTs(),
        },
    );
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(previousBlockId, previousLength)};
};

export const joinWithNext = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const blocks = visibleBlockIds(state);
    const index = blocks.indexOf(blockId);
    const nextBlockId = blocks[index + 1];
    if (index < 0 || !nextBlockId) {
        return {state, ops: [], selection: caret(blockId, pointTextLength(state, blockId))};
    }

    const currentLength = pointTextLength(state, blockId);
    const ops = joinBlocksOps(
        state,
        {
            actor: context.actor,
            left: parseLamportString(blockId),
            right: parseLamportString(nextBlockId),
            ts: context.nextTs(),
        },
    );
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(blockId, currentLength)};
};

const shouldExitCodeBlock = (state: CachedState<RichBlockMeta>, point: BlockPoint): boolean =>
    point.offset === pointTextLength(state, point.blockId) &&
    blockContents(state, point.blockId).endsWith('\n');

const exitCodeBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const length = pointTextLength(state, blockId);
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];

    if (length > 0 && blockContents(working, blockId).endsWith('\n')) {
        const deleteOps = deleteRangeOps(working, {
            block: parseLamportString(blockId),
            startOffset: length - 1,
            endOffset: length,
        });
        working = applyMany(working, deleteOps);
        ops.push(...deleteOps);
    }

    const parentId = visibleParentIdForBlock(working, blockId);
    if (parentId === null) return {state: working, ops, selection: caret(blockId, pointTextLength(working, blockId))};

    const siblings = visibleBlockChildren(working, parentId);
    const index = siblings.indexOf(blockId);
    if (index < 0) return {state: working, ops, selection: caret(blockId, pointTextLength(working, blockId))};

    const afterId = siblings[index + 1] ?? null;
    const ts = context.nextTs();
    const newBlockId = lamportToString([working.state.maxSeenCount + 1, context.actor]);
    const insertOps = insertBlockOps(working, {
        actor: context.actor,
        parent: parentId === ROOT_ID ? ROOT : parseLamportString(parentId),
        before: parseLamportString(blockId),
        after: afterId ? parseLamportString(afterId) : null,
        meta: paragraphMeta(ts),
        ts,
    });
    working = applyMany(working, insertOps);
    ops.push(...insertOps);

    return {state: working, ops, selection: caret(newBlockId, 0)};
};

const insertTextAtPoint = (
    state: CachedState<RichBlockMeta>,
    point: BlockPoint,
    text: string,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; point: BlockPoint} => {
    if (!text) return {state, ops: [], point};

    const ops = insertTextOps(state, {
        actor: context.actor,
        block: parseLamportString(point.blockId),
        offset: point.offset,
        text,
        ts: context.nextTs,
    });
    const next = applyMany(state, ops);
    return {
        state: next,
        ops,
        point: {blockId: point.blockId, offset: point.offset + ops.length},
    };
};

const deleteSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; point: BlockPoint} => {
    const point = firstPointForSelection(state, selection);
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const segment of normalizeSelectionSegments(state, selection)) {
        ops.push(
            ...deleteRangeOps(state, {
                block: parseLamportString(segment.blockId),
                startOffset: segment.startOffset,
                endOffset: segment.endOffset,
            }),
        );
    }
    return {state: ops.length ? applyMany(state, ops) : state, ops, point};
};

const deleteSelectionAndJoinBoundaries = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; point: BlockPoint} => {
    const span = normalizedSelectionSpan(state, selection);
    if (!span) return deleteSelection(state, selection);

    const blocks = visibleBlockIds(state);
    const startIndex = blocks.indexOf(span.start.blockId);
    const endIndex = blocks.indexOf(span.end.blockId);
    const blockRun = startIndex >= 0 && endIndex >= startIndex ? blocks.slice(startIndex, endIndex + 1) : [];

    const deleted = deleteSelection(state, selection);
    let working = deleted.state;
    const ops = [...deleted.ops];

    if (blockRun.length > 1) {
        const survivor = blockRun[0];
        for (const blockId of blockRun.slice(1)) {
            const joinOps = joinBlocksOps(
                working,
                {
                    actor: context.actor,
                    left: parseLamportString(survivor),
                    right: parseLamportString(blockId),
                    ts: context.nextTs(),
                },
            );
            working = applyMany(working, joinOps);
            ops.push(...joinOps);
        }
    }

    return {state: working, ops, point: clampPoint(working, span.start)};
};

const normalizedSelectionSpan = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): {start: BlockPoint; end: BlockPoint} | null => {
    if (selection.type === 'caret') return null;

    const anchor = clampPoint(state, selection.anchor);
    const focus = clampPoint(state, selection.focus);
    const blocks = visibleBlockIds(state);
    const anchorBlockIndex = blocks.indexOf(anchor.blockId);
    const focusBlockIndex = blocks.indexOf(focus.blockId);
    if (anchorBlockIndex < 0 || focusBlockIndex < 0) return null;

    if (anchorBlockIndex > focusBlockIndex || (anchorBlockIndex === focusBlockIndex && anchor.offset > focus.offset)) {
        return {start: focus, end: anchor};
    }
    return {start: anchor, end: focus};
};

const parentFromPath = (path: Lamport[]): Lamport => path[path.length - 1] ?? ROOT;

const lastBlockOrderTs = (ts: BlockOrderTs) => (typeof ts === 'string' ? ts : ts[2]);

const selectionFullyHasMark = (
    state: CachedState<RichBlockMeta>,
    segments: ReturnType<typeof normalizeSelectionSegments>,
    markType: 'bold' | 'italic',
): boolean => {
    const blocks = materializeFormattedBlocks(state);
    const byId = new Map(blocks.map((block) => [block.id, block]));

    return segments.every((segment) => {
        const block = byId.get(segment.blockId);
        if (!block) return false;
        const marksByOffset: Record<string, unknown>[] = [];
        for (const run of block.runs) {
            for (const _ of segmentText(run.text)) {
                marksByOffset.push(run.marks);
            }
        }
        const selected = marksByOffset.slice(segment.startOffset, segment.endOffset);
        return selected.length > 0 && selected.every((marks) => equal(marks[markType], true));
    });
};
