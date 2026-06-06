import equal from 'fast-deep-equal';
import {
    applyMany,
    charOp,
    join,
    markRange,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    rootBlockIds,
    split,
    type Op,
} from 'umkehr/block-crdt';
import {createLseqIdBetween} from 'umkehr/block-crdt/lseq';
import type {CachedState, Lamport} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString, selPos} from 'umkehr/block-crdt/utils';
import {
    caret,
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    segmentText,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';

export type CommandContext = {
    actor: string;
    nextTs(): string;
};

export type CommandResult = {
    state: CachedState;
    ops: Op[];
    selection: EditorSelection;
};

export type MoveTarget = {targetBlockId: string; after: boolean};

const ROOT: Lamport = [0, 'root'];

export const insertText = (
    state: CachedState,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Op[] = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelection(working, selection);
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
    state: CachedState,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    if (!isCollapsed(selection)) {
        const deleted = deleteSelection(state, selection);
        return {state: deleted.state, ops: deleted.ops, selection: caret(deleted.point.blockId, deleted.point.offset)};
    }

    const point = focusPoint(selection);
    if (point.offset > 0) {
        const charId = orderedCharIdsForBlock(state, point.blockId, {visibleOnly: true})[point.offset - 1];
        if (!charId) return {state, ops: [], selection};
        const op: Op = {type: 'char:delete', id: state.state.chars[charId].id};
        const next = applyMany(state, [op]);
        return {state: next, ops: [op], selection: caret(point.blockId, point.offset - 1)};
    }

    return joinWithPrevious(state, point.blockId, context);
};

export const splitBlock = (
    state: CachedState,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Op[] = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelection(working, selection);
        if (deleted.ops.length) {
            working = deleted.state;
            ops.push(...deleted.ops);
            point = deleted.point;
        }
    }

    const block = parseLamportString(point.blockId);
    const length = pointTextLength(working, point.blockId);
    const char =
        point.offset === 0
            ? block
            : point.offset === length
              ? null
              : selPos(working, block, point.offset + 1);
    const previous =
        point.offset === 0
            ? null
            : point.offset >= length
              ? lastChar(working, point.blockId)
              : selPos(working, block, point.offset);
    const newBlockId = lamportToString([working.state.maxSeenCount + 1, context.actor]);
    const splitOps = split(working, {block, char, previous}, context.nextTs(), context.actor);
    const next = applyMany(working, splitOps);
    ops.push(...splitOps);
    return {state: next, ops, selection: caret(newBlockId, 0)};
};

export const pastePlainText = (
    state: CachedState,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let result = insertText(state, selection, lines[0] ?? '', context);

    for (let index = 1; index < lines.length; index++) {
        result = splitBlock(result.state, result.selection, context);
        const inserted = insertText(result.state, result.selection, lines[index], context);
        result = {
            state: inserted.state,
            ops: [...result.ops, ...inserted.ops],
            selection: inserted.selection,
        };
    }

    return result;
};

export const toggleMark = (
    state: CachedState,
    selection: EditorSelection,
    markType: 'bold' | 'italic',
    context: CommandContext,
): CommandResult => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return {state, ops: [], selection};

    const remove = selectionFullyHasMark(state, segments, markType);
    let working = state;
    const ops: Op[] = [];
    for (const segment of segments) {
        const op = markRange(
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

export const moveBlock = (
    state: CachedState,
    movedBlockId: string,
    target: MoveTarget,
    context: CommandContext,
): CommandResult => {
    const currentOrder = rootBlockIds(state);
    const withoutMoved = currentOrder.filter((id) => id !== movedBlockId);
    const targetIndex = withoutMoved.indexOf(target.targetBlockId);
    if (targetIndex < 0 || movedBlockId === target.targetBlockId) {
        return {state, ops: [], selection: caret(movedBlockId, 0)};
    }

    const insertIndex = target.after ? targetIndex + 1 : targetIndex;
    const beforeId = insertIndex > 0 ? withoutMoved[insertIndex - 1] : null;
    const afterId = withoutMoved[insertIndex] ?? null;
    const current = state.state.blocks[movedBlockId];
    if (!current) return {state, ops: [], selection: caret(movedBlockId, 0)};

    const nextIndex = createLseqIdBetween(
        beforeId ? state.state.blocks[beforeId].order.index : null,
        afterId ? state.state.blocks[afterId].order.index : null,
        {actorId: context.actor, counter: state.state.maxSeenCount + 1},
    );
    const op: Op = {
        type: 'block:move',
        id: current.id,
        order: {
            parent: ROOT,
            index: nextIndex,
            ts: context.nextTs(),
        },
    };
    const next = applyMany(state, [op]);
    return {state: next, ops: [op], selection: caret(movedBlockId, 0)};
};

export const joinWithPrevious = (
    state: CachedState,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const blocks = rootBlockIds(state);
    const index = blocks.indexOf(blockId);
    if (index <= 0) return {state, ops: [], selection: caret(blockId, 0)};

    const previousBlockId = blocks[index - 1];
    const previousLength = pointTextLength(state, previousBlockId);
    const ops = join(
        state,
        parseLamportString(previousBlockId),
        parseLamportString(blockId),
        context.nextTs(),
        context.actor,
    );
    const next = applyMany(state, ops);
    return {state: next, ops, selection: caret(previousBlockId, previousLength)};
};

const insertTextAtPoint = (
    state: CachedState,
    point: BlockPoint,
    text: string,
    context: CommandContext,
): {state: CachedState; ops: Op[]; point: BlockPoint} => {
    if (!text) return {state, ops: [], point};

    const block = parseLamportString(point.blockId);
    let after = selPos(state, block, point.offset);
    const ops: Op[] = [];
    for (const segment of segmentText(text)) {
        const id: Lamport = [state.state.maxSeenCount + ops.length + 1, context.actor];
        ops.push(charOp(segment, id, after ?? block, context.nextTs()));
        after = id;
    }
    const next = applyMany(state, ops);
    return {
        state: next,
        ops,
        point: {blockId: point.blockId, offset: point.offset + ops.length},
    };
};

const deleteSelection = (
    state: CachedState,
    selection: EditorSelection,
): {state: CachedState; ops: Op[]; point: BlockPoint} => {
    const point = firstPointForSelection(state, selection);
    const ops: Op[] = [];
    for (const segment of normalizeSelectionSegments(state, selection)) {
        const charIds = orderedCharIdsForBlock(state, segment.blockId, {visibleOnly: true}).slice(
            segment.startOffset,
            segment.endOffset,
        );
        for (const charId of charIds) {
            ops.push({type: 'char:delete', id: state.state.chars[charId].id});
        }
    }
    return {state: ops.length ? applyMany(state, ops) : state, ops, point};
};

const lastChar = (state: CachedState, blockId: string): Lamport | null => {
    const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    const id = chars[chars.length - 1];
    return id ? state.state.chars[id].id : null;
};

const selectionFullyHasMark = (
    state: CachedState,
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
