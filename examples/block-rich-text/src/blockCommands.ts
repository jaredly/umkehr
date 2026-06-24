import equal from 'fast-deep-equal';
import {
    applyMany,
    blockContents,
    deleteBlockOps,
    deleteRangeOps,
    insertBlockOps,
    insertTextOps,
    joinBlocksOps,
    markBoundaryOp,
    markRangeOp,
    materializeFormattedBlocks,
    materializedBlockParent,
    materializedBlockPath,
    moveBlockOps,
    nextBlockIdForActor,
    orderedCharIdsForBlock,
    setBlockMetaOps,
    splitBlockOps,
    visibleSiblingAnchorsForBlock,
    visibleBlockChildren,
    visibleBlockOutline,
    compareLamportStrings,
    type Op,
} from 'umkehr/block-crdt';
import {compareLseqIds, createLseqIdBetween} from 'umkehr/block-crdt/lseq';
import type {BlockOrderTs, Boundary, CachedState, JsonValue, Lamport} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import {
    paragraphMeta,
    sameTypeWithTs,
    type ImagePresentationSize,
    type PreviewMetadata,
    type RichBlockMeta,
} from './blockMeta';
import {annotationVirtualParents} from './annotations';
import {CODE_MARK, isCodeMarkValue, normalizeStoredCodeLanguage, type BareInlineMark, type BooleanInlineMark} from './inlineMarks';
import {markdownShortcutPrefix, type MarkdownShortcutMatch} from './markdownShortcuts';
import {
    caret,
    clampPoint,
    editableBlockIds,
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    segmentText,
    tableCellRectangleForSelection,
    visibleBlockIds,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';
import {textSegments} from './charUtils';
import {applyCharInsertOpsOrApplyMany, localInsertTextOps} from './localTextOps';
import {INLINE_EMBED_MARK, INLINE_EMBED_TEXT, type InlineEmbedData} from './inlineEmbeds';

export type CommandContext = {
    actor: string;
    nextTs(): string;
};

export type CommandResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    selection: EditorSelection;
};

export type RetainedInlineMarkSession = {
    markType: BareInlineMark;
    start: Boundary;
    end?: Boundary;
    lastTypedCharId: string | null;
};

export type RetainedInlineMarkInsertResult = CommandResult & {
    sessions: RetainedInlineMarkSession[];
};

export type MoveTarget =
    | {type: 'before'; targetBlockId: string}
    | {type: 'after'; targetBlockId: string}
    | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};

export type TableRowSlotTarget = {
    tableId: string;
    beforeRowId: string | null;
    afterRowId: string | null;
};

export type TableCellSlotTarget = {
    rowId: string;
    index: number;
};

const ROOT: Lamport = [0, 'root'];
const ROOT_ID = lamportToString(ROOT);

const insertedBlockFromOps = (ops: Array<Op<RichBlockMeta>>) => {
    const op = ops[0];
    if (op?.type !== 'block') throw new Error('insertBlockOps did not return a block op');
    return op.block;
};

const NO_COMMAND = Symbol('no-command');

export type OptionalCommandResult = CommandResult | typeof NO_COMMAND;

export const noCommand = (): OptionalCommandResult => NO_COMMAND;

export const commandApplied = (result: OptionalCommandResult): result is CommandResult =>
    result !== NO_COMMAND;

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

export const insertTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const inserted = insertText(state, selection, text, context);
    if (text === '`' && isCollapsed(inserted.selection)) {
        const inlineCode = applyInlineCodeMarkdownShortcut(inserted, context);
        if (inlineCode) return inlineCode;
    }
    if (text !== ' ' || !isCollapsed(inserted.selection)) return inserted;

    const point = focusPoint(inserted.selection);
    const block = inserted.state.state.blocks[point.blockId];
    if (!block) return inserted;

    const textBeforeCaret = segmentText(blockContents(inserted.state, point.blockId))
        .slice(0, point.offset)
        .join('');
    const shortcut = markdownShortcutPrefix(textBeforeCaret, block.meta, context.nextTs);
    if (!shortcut || shortcut.length !== point.offset) return inserted;

    let working = inserted.state;
    const ops: Array<Op<RichBlockMeta>> = [...inserted.ops];
    const deleteOps = deleteRangeOps(working, {
        block: parseLamportString(point.blockId),
        startOffset: 0,
        endOffset: shortcut.length,
    });
    working = applyMany(working, deleteOps, annotationVirtualParents(working));
    ops.push(...deleteOps);

    const metaOps = setBlockMetaOps(working, {block: block.id, meta: shortcut.meta});
    working = applyMany(working, metaOps, annotationVirtualParents(working));
    ops.push(...metaOps);

    return {state: working, ops, selection: caret(point.blockId, 0)};
};

const applyInlineCodeMarkdownShortcut = (
    inserted: CommandResult,
    context: CommandContext,
): CommandResult | null => {
    const point = focusPoint(inserted.selection);
    const block = inserted.state.state.blocks[point.blockId];
    if (!block || point.offset < 2) return null;

    const segments = segmentText(blockContents(inserted.state, point.blockId));
    const closingOffset = point.offset - 1;
    if (segments[closingOffset] !== '`') return null;

    let openingOffset = -1;
    for (let index = closingOffset - 1; index >= 0; index--) {
        if (segments[index] === '`') {
            openingOffset = index;
            break;
        }
    }
    if (openingOffset < 0 || closingOffset - openingOffset <= 1) return null;

    let working = inserted.state;
    const ops: Array<Op<RichBlockMeta>> = [...inserted.ops];

    const deleteClosing = deleteRangeOps(working, {
        block: parseLamportString(point.blockId),
        startOffset: closingOffset,
        endOffset: closingOffset + 1,
    });
    working = applyMany(working, deleteClosing, annotationVirtualParents(working));
    ops.push(...deleteClosing);

    const deleteOpening = deleteRangeOps(working, {
        block: parseLamportString(point.blockId),
        startOffset: openingOffset,
        endOffset: openingOffset + 1,
    });
    working = applyMany(working, deleteOpening, annotationVirtualParents(working));
    ops.push(...deleteOpening);

    const codeEndOffset = closingOffset - 1;
    if (openingOffset < codeEndOffset) {
        const mark = markRangeOp(
            working,
            parseLamportString(point.blockId),
            openingOffset,
            codeEndOffset,
            CODE_MARK,
            undefined,
            false,
            [working.state.maxSeenCount + 1, context.actor],
        );
        working = applyMany(working, [mark], annotationVirtualParents(working));
        ops.push(mark);
    }

    return {state: working, ops, selection: caret(point.blockId, codeEndOffset)};
};

export const insertTextWithMarks = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    markTypes: BareInlineMark[],
    context: CommandContext,
): CommandResult => {
    const insertionStart = firstPointForSelection(state, selection);
    const inserted = insertText(state, selection, text, context);
    const insertedLength = segmentText(text).length;
    const uniqueMarkTypes = [...new Set(markTypes)];
    if (!insertedLength || !uniqueMarkTypes.length) return inserted;

    const insertionEnd = firstPointForSelection(inserted.state, inserted.selection);
    if (insertionStart.blockId !== insertionEnd.blockId || insertionStart.offset >= insertionEnd.offset) {
        return inserted;
    }

    let working = inserted.state;
    const ops = [...inserted.ops];
    for (const markType of uniqueMarkTypes) {
        const op = markRangeOp(
            working,
            parseLamportString(insertionStart.blockId),
            insertionStart.offset,
            insertionStart.offset + insertedLength,
            markType,
            undefined,
            false,
            [working.state.maxSeenCount + 1, context.actor],
        );
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
    }

    return {state: working, ops, selection: inserted.selection};
};

export const insertInlineEmbed = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    data: InlineEmbedData,
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

    const inserted = insertTextAtPoint(working, point, INLINE_EMBED_TEXT, context);
    working = inserted.state;
    ops.push(...inserted.ops);

    const mark = markRangeOp(
        working,
        parseLamportString(point.blockId),
        point.offset,
        point.offset + 1,
        INLINE_EMBED_MARK,
        data as unknown as JsonValue,
        false,
        [working.state.maxSeenCount + 1, context.actor],
    );
    working = applyMany(working, [mark], annotationVirtualParents(working));
    ops.push(mark);

    return {state: working, ops, selection: caret(point.blockId, point.offset + 1)};
};

export const setInlineEmbedDataByCharId = (
    state: CachedState<RichBlockMeta>,
    charId: string,
    data: InlineEmbedData,
    context: CommandContext,
): OptionalCommandResult => {
    const target = visibleCharLocation(state, charId);
    if (!target) return noCommand();
    if (state.state.chars[charId]?.text !== INLINE_EMBED_TEXT) return noCommand();

    const op = markRangeOp(
        state,
        parseLamportString(target.blockId),
        target.offset,
        target.offset + 1,
        INLINE_EMBED_MARK,
        data as unknown as JsonValue,
        false,
        [state.state.maxSeenCount + 1, context.actor],
    );
    const next = applyMany(state, [op], annotationVirtualParents(state));
    return {state: next, ops: [op], selection: caret(target.blockId, target.offset + 1)};
};

export const insertTextWithRetainedMarks = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    markTypes: BareInlineMark[],
    sessions: RetainedInlineMarkSession[],
    context: CommandContext,
): RetainedInlineMarkInsertResult => {
    if (selection.type !== 'caret' || !markTypes.length) {
        const inserted = insertText(state, selection, text, context);
        return {state: inserted.state, ops: inserted.ops, selection: inserted.selection, sessions};
    }

    const point = firstPointForSelection(state, selection);
    const end = openRetainedMarkEndForPoint(state, point);
    const inserted = insertText(state, selection, text, context);
    const insertedCharIds = inserted.ops
        .filter((op): op is Op<RichBlockMeta> & {type: 'char'} => op.type === 'char')
        .map((op) => lamportToString(op.char.id));
    if (!insertedCharIds.length) {
        return {state: inserted.state, ops: inserted.ops, selection: inserted.selection, sessions};
    }

    let working = inserted.state;
    const ops = [...inserted.ops];
    const nextSessions = sessions.slice();
    const firstInsertedCharId = insertedCharIds[0];
    const lastInsertedCharId = insertedCharIds[insertedCharIds.length - 1];

    for (const markType of [...new Set(markTypes)]) {
        const existingIndex = nextSessions.findIndex((session) => session.markType === markType);
        if (existingIndex >= 0) {
            nextSessions[existingIndex] = {
                ...nextSessions[existingIndex],
                lastTypedCharId: lastInsertedCharId,
            };
            continue;
        }

        const session: RetainedInlineMarkSession = {
            markType,
            start: {id: parseLamportString(firstInsertedCharId), at: 'before'},
            ...(end ? {end} : {}),
            lastTypedCharId: lastInsertedCharId,
        };
        const op = markBoundaryOp<RichBlockMeta>(
            [working.state.maxSeenCount + 1, context.actor],
            session.start,
            session.end,
            markType,
        );
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
        nextSessions.push(session);
    }

    return {state: working, ops, selection: inserted.selection, sessions: nextSessions};
};

export const closeRetainedInlineMarkSessions = (
    state: CachedState<RichBlockMeta>,
    sessions: RetainedInlineMarkSession[],
    markType: BareInlineMark,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; sessions: RetainedInlineMarkSession[]} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const remaining: RetainedInlineMarkSession[] = [];

    for (const session of sessions) {
        if (session.markType !== markType) {
            remaining.push(session);
            continue;
        }
        if (!session.lastTypedCharId) {
            continue;
        }

        const remove = markBoundaryOp<RichBlockMeta>(
            [working.state.maxSeenCount + 1, context.actor],
            session.start,
            session.end,
            markType,
            undefined,
            true,
        );
        working = applyMany(working, [remove], annotationVirtualParents(working));
        ops.push(remove);

        const bounded = markBoundaryOp<RichBlockMeta>(
            [working.state.maxSeenCount + 1, context.actor],
            session.start,
            {id: parseLamportString(session.lastTypedCharId), at: 'after'},
            markType,
        );
        working = applyMany(working, [bounded], annotationVirtualParents(working));
        ops.push(bounded);
    }

    return {state: working, ops, sessions: remaining};
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
        const next = applyMany(state, ops, annotationVirtualParents(state));
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
        const next = applyMany(state, ops, annotationVirtualParents(state));
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
    if (currentMeta?.type === 'image' || currentMeta?.type === 'preview') {
        const inserted = insertParagraphAfterBlock(working, point.blockId, context);
        return {state: inserted.state, ops: [...ops, ...inserted.ops], selection: caret(inserted.blockId, 0)};
    }

    if (currentMeta && currentMeta.type !== 'paragraph' && pointTextLength(working, point.blockId) === 0) {
        const ops = setBlockMetaOps(working, {
            block: parseLamportString(point.blockId),
            meta: paragraphMeta(context.nextTs()),
        });
        const next = applyMany(working, ops, annotationVirtualParents(working));
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
        virtualParents: annotationVirtualParents(working),
    });
    const next = applyMany(working, splitOps, annotationVirtualParents(working));
    ops.push(...splitOps);
    return {state: next, ops, selection: caret(newBlockId, 0)};
};

export const splitTableRowHeader = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        working = deleted.state;
        ops.push(...deleted.ops);
        point = deleted.point;
    }

    const current = working.state.blocks[point.blockId];
    if (!current) return noCommand();
    const row = tableRowContext(working, point.blockId);
    if (!row || current.meta.type === 'table') return noCommand();

    const newRowId = lamportToString(nextBlockIdForActor(working, context.actor));
    if (point.offset === 0) {
        const anchors = visibleSiblingAnchorsForBlock(working, point.blockId, annotationVirtualParents(working));
        if (!anchors) return noCommand();
        const insertOps = insertBlockOps(working, {
            actor: context.actor,
            parent: anchors.parent,
            before: anchors.before,
            after: anchors.after,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, insertOps, annotationVirtualParents(working));
        ops.push(...insertOps);

        const firstCharId = orderedCharIdsForBlock(working, point.blockId, {visibleOnly: true})[0];
        if (firstCharId) {
            const moveOp: Op<RichBlockMeta> = {
                type: 'char:move',
                id: parseLamportString(firstCharId),
                parent: {id: parseLamportString(newRowId), ts: context.nextTs()},
            };
            working = applyMany(working, [moveOp], annotationVirtualParents(working));
            ops.push(moveOp);
        }
    } else {
        const splitOps = splitBlockOps<RichBlockMeta>(working, {
            actor: context.actor,
            block: current.id,
            offset: point.offset,
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, splitOps, annotationVirtualParents(working));
        ops.push(...splitOps);
    }

    const columnCount = tableColumnCount(working, row.tableId);
    const newRow = working.state.blocks[newRowId];
    if (!newRow || !tableRowContext(working, newRowId)) return noCommand();
    const cells = createEmptyCellsForRow(working, newRowId, columnCount, context);
    working = cells.state;
    ops.push(...cells.ops);

    return {state: working, ops, selection: caret(newRowId, 0)};
};

export const deleteTableRowHeaderBackward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult => {
    if (!isCollapsed(selection)) return noCommand();
    const point = focusPoint(selection);
    if (point.offset !== 0 || pointTextLength(state, point.blockId) !== 0) return noCommand();

    const row = tableRowContext(state, point.blockId);
    if (!row) return noCommand();
    const previousRowId = row.rows[row.rowIndex - 1] ?? null;
    const fallbackSelection = previousRowId
        ? caret(previousRowId, pointTextLength(state, previousRowId))
        : caret(row.tableId, pointTextLength(state, row.tableId));

    if (!areTableRowCellsEmpty(state, point.blockId)) {
        return {state, ops: [], selection: fallbackSelection};
    }

    if (row.rows.length <= 1) {
        const table = state.state.blocks[row.tableId];
        if (!table || table.meta.type !== 'table') return noCommand();
        const rehomed = rehomeVisibleSubtreeToRealParents(state, point.blockId, table.id, context);
        let working = rehomed.state;
        const ops: Array<Op<RichBlockMeta>> = [...rehomed.ops];
        const deleteOps = deleteBlockOps(working, {
            block: parseLamportString(point.blockId),
            mode: 'subtree',
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        const metaOps = setBlockMetaOps(working, {
            block: table.id,
            meta: paragraphMeta(context.nextTs()),
        });
        const next = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
        return {state: next, ops, selection: caret(row.tableId, pointTextLength(next, row.tableId))};
    }

    const ops = deleteBlockOps(state, {
        block: parseLamportString(point.blockId),
        mode: 'subtree',
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, selection: fallbackSelection};
};

export const deleteEmptyTableRowBackward = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult => {
    if (!isCollapsed(selection)) return noCommand();
    const point = focusPoint(selection);
    if (point.offset !== 0) return noCommand();

    const cell = tableCellContext(state, point.blockId);
    if (!cell) return noCommand();
    const rowCells = tableCells(state, cell.rowId);
    if (cell.columnIndex > 0) {
        const previousCellId = rowCells[cell.columnIndex - 1];
        return previousCellId
            ? {state, ops: [], selection: caret(previousCellId, pointTextLength(state, previousCellId))}
            : noCommand();
    }

    if (!isEmptyTableRow(state, cell.rowId)) return noCommand();

    const rows = tableRows(state, cell.tableId);
    if (rows.length <= 1) {
        const table = state.state.blocks[cell.tableId];
        if (!table || table.meta.type !== 'table') return noCommand();
        const rehomed = rehomeVisibleSubtreeToRealParents(state, cell.rowId, table.id, context);
        let working = rehomed.state;
        const ops: Array<Op<RichBlockMeta>> = [...rehomed.ops];
        const deleteOps = deleteVisibleSubtreeOps(working, cell.rowId);
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        const metaOps = setBlockMetaOps(working, {
            block: table.id,
            meta: paragraphMeta(context.nextTs()),
        });
        const next = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
        return {state: next, ops, selection: caret(cell.tableId, pointTextLength(next, cell.tableId))};
    }

    const previousRowId = rows[cell.rowIndex - 1] ?? null;
    if (!previousRowId) return noCommand();
    const previousCells = visibleBlockChildren(state, previousRowId, annotationVirtualParents(state));
    const previousCellId = previousCells[previousCells.length - 1] ?? null;
    const ops = deleteVisibleSubtreeOps(state, cell.rowId);
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {
        state: next,
        ops,
        selection: previousCellId
            ? caret(previousCellId, pointTextLength(next, previousCellId))
            : caret(cell.tableId, pointTextLength(next, cell.tableId)),
    };
};

export const exitEmptyLastTableRow = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult => {
    if (!isCollapsed(selection)) return noCommand();
    const cell = tableCellContext(state, focusPoint(selection).blockId);
    if (!cell) return noCommand();
    const rows = tableRows(state, cell.tableId);
    if (rows.length <= 1 || rows[rows.length - 1] !== cell.rowId) return noCommand();
    if (!isEmptyTableRow(state, cell.rowId)) return noCommand();

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const deleteOps = deleteVisibleSubtreeOps(working, cell.rowId);
    working = applyMany(working, deleteOps, annotationVirtualParents(working));
    ops.push(...deleteOps);

    const inserted = insertParagraphAfterBlock(working, cell.tableId, context);
    ops.push(...inserted.ops);
    return {state: inserted.state, ops, selection: caret(inserted.blockId, 0)};
};

export const splitTableTitleToParagraph = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        working = deleted.state;
        ops.push(...deleted.ops);
        point = deleted.point;
    }

    const current = working.state.blocks[point.blockId];
    if (!current || current.meta.type !== 'table') return noCommand();

    if (point.offset === 0) {
        const trailing = blockContents(working, point.blockId);
        const inserted = insertParagraphAfterBlock(working, point.blockId, context);
        working = inserted.state;
        ops.push(...inserted.ops);
        if (trailing) {
            const deleteOps = deleteRangeOps(working, {
                block: current.id,
                startOffset: 0,
                endOffset: pointTextLength(working, point.blockId),
            });
            working = applyMany(working, deleteOps, annotationVirtualParents(working));
            ops.push(...deleteOps);
            const insertedText = insertTextAtPoint(working, {blockId: inserted.blockId, offset: 0}, trailing, context);
            working = insertedText.state;
            ops.push(...insertedText.ops);
        }
        return {state: working, ops, selection: caret(inserted.blockId, 0)};
    }

    const newBlockId = lamportToString([working.state.maxSeenCount + 1, context.actor]);
    const splitOps = splitBlockOps<RichBlockMeta>(working, {
        actor: context.actor,
        block: current.id,
        offset: point.offset,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, splitOps, annotationVirtualParents(working));
    ops.push(...splitOps);

    const newBlock = working.state.blocks[newBlockId];
    if (newBlock) {
        const metaOps = setBlockMetaOps(working, {
            block: newBlock.id,
            meta: paragraphMeta(context.nextTs()),
        });
        working = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
    }

    return {state: working, ops, selection: caret(newBlockId, 0)};
};

export const pastePlainText = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    return pastePlainTextDetailed(state, selection, text, context).result;
};

export type PastedLineTarget = {
    blockId: string;
    startOffset: number;
    sourceLine: string;
};

export const pastePlainTextDetailed = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): {result: CommandResult; touchedLines: PastedLineTarget[]} => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const appended = pastePlainTextAtBlockEnd(state, selection, lines, context);
    if (appended) return appended;

    let result = insertText(state, selection, lines[0] ?? '', context);
    const ops = [...result.ops];
    const firstPoint = focusPoint(result.selection);
    const touchedLines: PastedLineTarget[] = [
        {
            blockId: firstPoint.blockId,
            startOffset: firstPoint.offset - segmentText(lines[0] ?? '').length,
            sourceLine: lines[0] ?? '',
        },
    ];

    for (let index = 1; index < lines.length; index++) {
        const splitResult = splitBlock(result.state, result.selection, context);
        ops.push(...splitResult.ops);
        const inserted = insertText(splitResult.state, splitResult.selection, lines[index], context);
        ops.push(...inserted.ops);
        result = inserted;
        touchedLines.push({blockId: focusPoint(result.selection).blockId, startOffset: 0, sourceLine: lines[index]});
    }

    return {result: {...result, ops}, touchedLines};
};

export const pastePlainTextWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    text: string,
    context: CommandContext,
): CommandResult => {
    const pasted = pastePlainTextDetailed(state, selection, text, context);
    const converted = applyMarkdownShortcutsToPastedLines(
        pasted.result.state,
        pasted.touchedLines,
        pasted.result.selection,
        context,
    );
    return {
        state: converted.state,
        ops: [...pasted.result.ops, ...converted.ops],
        selection: converted.selection,
    };
};

const pastePlainTextAtBlockEnd = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    lines: string[],
    context: CommandContext,
): {result: CommandResult; touchedLines: PastedLineTarget[]} | null => {
    if (lines.length <= 1 || !isCollapsed(selection)) return null;
    const point = firstPointForSelection(state, selection);
    const block = state.state.blocks[point.blockId];
    const parentId = visibleParentIdForBlock(state, point.blockId);
    if (
        !block ||
        block.meta.type === 'code' ||
        parentId !== ROOT_ID ||
        point.offset !== pointTextLength(state, point.blockId)
    ) {
        return null;
    }

    const chars = {...state.state.chars};
    const blocks = {...state.state.blocks};
    const charContents = {...state.cache.charContents};
    const blockChildren = {...state.cache.blockChildren};
    const ops: Array<Op<RichBlockMeta>> = [];
    let maxSeenCount = state.state.maxSeenCount;
    let previousBlockId = point.blockId;
    let selectionOffset = 0;

    const appendText = (blockId: string, text: string) => {
        const currentState = {
            state: {...state.state, chars, blocks, maxSeenCount},
            cache: {...state.cache, charContents},
        };
        let after = lastVisibleCharId(currentState, blockId) ?? blocks[blockId].id;
        for (const segment of textSegments(text)) {
            const id: Lamport = [++maxSeenCount, context.actor];
            const op: Op<RichBlockMeta> = {
                type: 'char',
                char: {text: segment, id, deleted: false, parent: {id: after, ts: ''}},
            };
            const charId = lamportToString(id);
            chars[charId] = op.char;
            const afterId = lamportToString(after);
            charContents[afterId] = insertSortedRev(charContents[afterId]?.slice() ?? [], charId);
            ops.push(op);
            after = id;
            selectionOffset++;
        }
    };

    appendText(previousBlockId, lines[0] ?? '');
    const touchedLines: PastedLineTarget[] = [
        {blockId: previousBlockId, startOffset: point.offset, sourceLine: lines[0] ?? ''},
    ];

    for (let index = 1; index < lines.length; index++) {
        const previous = blocks[previousBlockId];
        if (!previous) return null;
        const currentState = {
            state: {...state.state, chars, blocks, maxSeenCount},
            cache: {...state.cache, blockChildren, charContents},
        };
        const blockOp = appendRootBlockAfterOp(
            currentState,
            previousBlockId,
            previous.meta,
            context,
        );
        maxSeenCount = Math.max(maxSeenCount, blockOp.block.id[0]);
        const blockId = lamportToString(blockOp.block.id);
        blocks[blockId] = blockOp.block;
        blockChildren[ROOT_ID] = insertSortedBlockId(blockChildren[ROOT_ID]?.slice() ?? [], blockId, blocks);
        ops.push(blockOp);
        previousBlockId = blockId;
        selectionOffset = 0;
        appendText(previousBlockId, lines[index]);
        touchedLines.push({blockId: previousBlockId, startOffset: 0, sourceLine: lines[index]});
    }

    return {
        result: {
            state: {
                state: {...state.state, chars, blocks, maxSeenCount},
                cache: {...state.cache, blockChildren, charContents},
            },
            ops,
            selection: caret(previousBlockId, selectionOffset),
        },
        touchedLines,
    };
};

type PastedLineShortcut = {
    deleteLength: number;
    indentLevel: number;
    shortcut: MarkdownShortcutMatch;
};

const applyMarkdownShortcutsToPastedLines = (
    state: CachedState<RichBlockMeta>,
    touchedLines: PastedLineTarget[],
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const removedPrefixByBlock = new Map<string, number>();
    const converted: Array<{blockId: string; indentLevel: number; nestable: boolean}> = [];

    for (const touched of touchedLines) {
        if (touched.startOffset !== 0) continue;
        const block = working.state.blocks[touched.blockId];
        if (!block) continue;
        const lineShortcut = pastedLineShortcut(touched.sourceLine, block.meta, context.nextTs);
        if (!lineShortcut) continue;

        const currentPrefix = segmentText(blockContents(working, touched.blockId))
            .slice(0, lineShortcut.deleteLength)
            .join('');
        if (currentPrefix !== touched.sourceLine.slice(0, lineShortcut.deleteLength)) continue;

        const deleteOps = deleteRangeOps(working, {
            block: block.id,
            startOffset: 0,
            endOffset: lineShortcut.deleteLength,
        });
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        removedPrefixByBlock.set(
            touched.blockId,
            (removedPrefixByBlock.get(touched.blockId) ?? 0) + lineShortcut.deleteLength,
        );

        const metaOps = setBlockMetaOps(working, {
            block: block.id,
            meta: lineShortcut.shortcut.meta,
        });
        working = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);

        converted.push({
            blockId: touched.blockId,
            indentLevel: lineShortcut.indentLevel,
            nestable: lineShortcut.shortcut.kind === 'list' || lineShortcut.shortcut.kind === 'todo',
        });
    }

    const nested = nestConvertedPastedListBlocks(working, converted, context);
    working = nested.state;
    ops.push(...nested.ops);

    return {state: working, ops, selection: adjustSelectionForRemovedPrefixes(selection, removedPrefixByBlock)};
};

const pastedLineShortcut = (
    sourceLine: string,
    currentMeta: RichBlockMeta,
    nextTs: CommandContext['nextTs'],
): PastedLineShortcut | null => {
    const indentation = pastedLineIndentation(sourceLine);
    const text = indentation.indentLevel > 0 ? sourceLine.slice(indentation.length) : sourceLine;
    const shortcut = markdownShortcutPrefix(text, currentMeta, nextTs);
    if (!shortcut) return null;
    if (indentation.indentLevel > 0 && shortcut.kind === 'heading') return null;
    if (indentation.length > 0 && indentation.indentLevel === 0) return null;
    return {
        deleteLength: indentation.length + shortcut.length,
        indentLevel: shortcut.kind === 'list' || shortcut.kind === 'todo' ? indentation.indentLevel : 0,
        shortcut,
    };
};

const pastedLineIndentation = (sourceLine: string): {length: number; indentLevel: number} => {
    let length = 0;
    let spaces = 0;
    let tabs = 0;
    for (const char of sourceLine) {
        if (char === ' ') {
            spaces++;
            length++;
        } else if (char === '\t') {
            tabs++;
            length++;
        } else {
            break;
        }
    }
    return {length, indentLevel: tabs + Math.floor(spaces / 2)};
};

const nestConvertedPastedListBlocks = (
    state: CachedState<RichBlockMeta>,
    converted: Array<{blockId: string; indentLevel: number; nestable: boolean}>,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const stack = new Map<number, string>();

    for (const item of converted) {
        if (!item.nestable) {
            stack.clear();
            continue;
        }
        if (item.indentLevel > 0 && !pastedBlockHasTableRowParent(working, item.blockId)) {
            let parentLevel = item.indentLevel - 1;
            while (parentLevel >= 0 && !stack.has(parentLevel)) parentLevel--;
            const parentId = parentLevel >= 0 ? stack.get(parentLevel) : null;
            const current = working.state.blocks[item.blockId];
            const parent = parentId ? working.state.blocks[parentId] : null;
            if (current && parent && parentId) {
                const siblings = visibleBlockChildren(working, parentId, annotationVirtualParents(working)).filter(
                    (id) => id !== item.blockId,
                );
                const beforeId = siblings[siblings.length - 1] ?? null;
                const moveOps = moveBlockOps(working, {
                    actor: context.actor,
                    block: current.id,
                    parent: parent.id,
                    before: beforeId ? working.state.blocks[beforeId].id : null,
                    after: null,
                    ts: context.nextTs(),
                    virtualParents: annotationVirtualParents(working),
                });
                working = applyMany(working, moveOps, annotationVirtualParents(working));
                ops.push(...moveOps);
            }
        }
        for (const level of [...stack.keys()]) {
            if (level >= item.indentLevel) stack.delete(level);
        }
        stack.set(item.indentLevel, item.blockId);
    }

    return {state: working, ops};
};

const pastedBlockHasTableRowParent = (state: CachedState<RichBlockMeta>, blockId: string): boolean => {
    const parentId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    return tableRowContext(state, parentId) !== null;
};

const adjustSelectionForRemovedPrefixes = (
    selection: EditorSelection,
    removedPrefixByBlock: Map<string, number>,
): EditorSelection => {
    const adjustPoint = (point: BlockPoint): BlockPoint => {
        const removed = removedPrefixByBlock.get(point.blockId) ?? 0;
        return removed ? {...point, offset: Math.max(0, point.offset - removed)} : point;
    };
    if (selection.type === 'caret') return caret(selection.point.blockId, adjustPoint(selection.point).offset);
    if (selection.type !== 'range') return selection;
    return {type: 'range', anchor: adjustPoint(selection.anchor), focus: adjustPoint(selection.focus)};
};

const lastVisibleCharId = (state: CachedState<RichBlockMeta>, blockId: string): Lamport | null => {
    const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    const charId = chars[chars.length - 1];
    return charId ? state.state.chars[charId].id : null;
};

const openRetainedMarkEndForPoint = (
    state: CachedState<RichBlockMeta>,
    point: BlockPoint,
): Boundary | undefined => {
    const chars = orderedCharIdsForBlock(state, point.blockId, {visibleOnly: true});
    const nextCharId = chars[point.offset];
    return nextCharId ? {id: parseLamportString(nextCharId), at: 'before'} : undefined;
};

const appendRootBlockAfterOp = (
    state: CachedState<RichBlockMeta>,
    previousBlockId: string,
    meta: RichBlockMeta,
    context: CommandContext,
): Op<RichBlockMeta> & {type: 'block'} => {
    const previous = state.state.blocks[previousBlockId];
    if (!previous) throw new Error('append previous block not found');
    const id: Lamport = [state.state.maxSeenCount + 1, context.actor];
    const ts = context.nextTs();
    return {
        type: 'block',
        block: {
            id,
            meta,
            order: {
                id,
                path: [id],
                index: createLseqIdBetween(previous.order.index, null, {
                    actorId: context.actor,
                    counter: id[0],
                }),
                ts,
            },
            deleted: false,
        },
    };
};

const insertSortedBlockId = (
    array: string[],
    item: string,
    blocks: CachedState<RichBlockMeta>['state']['blocks'],
): string[] => {
    const itemBlock = blocks[item];
    for (let index = 0; index < array.length; index++) {
        if (compareLseqIds(itemBlock.order.index, blocks[array[index]].order.index) < 0) {
            array.splice(index, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};

export const toggleMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    markType: BooleanInlineMark,
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
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
    }

    return {state: working, ops, selection};
};

export const setLinkMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    href: string,
    context: CommandContext,
): CommandResult => setValuedMark(state, selection, 'link', href, false, context);

export const removeLinkMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setValuedMark(state, selection, 'link', undefined, true, context);

export const toggleCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return {state, ops: [], selection};

    const remove = selectionFullyHasMark(state, segments, CODE_MARK);
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const segment of segments) {
        const op = markRangeOp(
            working,
            parseLamportString(segment.blockId),
            segment.startOffset,
            segment.endOffset,
            CODE_MARK,
            undefined,
            remove,
            [working.state.maxSeenCount + 1, context.actor],
        );
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
    }

    return {state: working, ops, selection};
};

export const setCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    language: string,
    context: CommandContext,
): CommandResult => {
    const normalized = normalizeStoredCodeLanguage(language);
    return normalized
        ? setValuedMark(state, selection, CODE_MARK, normalized, false, context)
        : clearCodeLanguage(state, selection, context);
};

export const clearCodeLanguage = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setValuedMark(state, selection, CODE_MARK, undefined, false, context);

export const removeCodeMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult => setValuedMark(state, selection, CODE_MARK, undefined, true, context);

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
    const next = applyMany(state, ops, annotationVirtualParents(state));
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

export const insertImageBlock = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    attachmentId: string,
    size: ImagePresentationSize,
    context: CommandContext,
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        working = deleted.state;
        ops.push(...deleted.ops);
        point = deleted.point;
    }

    const block = working.state.blocks[point.blockId];
    if (!block) return {state: working, ops, selection: caret(point.blockId, point.offset)};

    const meta: RichBlockMeta = {type: 'image', attachmentId, size, ts: context.nextTs()};
    if (pointTextLength(working, point.blockId) === 0) {
        const metaOps = setBlockMetaOps(working, {block: block.id, meta});
        working = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
        return {state: working, ops, selection: caret(point.blockId, 0)};
    }

    const inserted = insertBlockAfterBlock(working, point.blockId, meta, context);
    return {
        state: inserted.state,
        ops: [...ops, ...inserted.ops],
        selection: caret(inserted.blockId, 0),
    };
};

export const insertPreviewBlock = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    url: string,
    context: CommandContext,
): CommandResult => {
    let working = state;
    let point = firstPointForSelection(working, selection);
    const ops: Array<Op<RichBlockMeta>> = [];

    if (!isCollapsed(selection)) {
        const deleted = deleteSelectionAndJoinBoundaries(working, selection, context);
        working = deleted.state;
        ops.push(...deleted.ops);
        point = deleted.point;
    }

    const block = working.state.blocks[point.blockId];
    if (!block) return {state: working, ops, selection: caret(point.blockId, point.offset)};

    const meta: RichBlockMeta = {type: 'preview', url, preview: null, ts: context.nextTs()};
    const metaOps = setBlockMetaOps(working, {block: block.id, meta});
    working = applyMany(working, metaOps, annotationVirtualParents(working));
    ops.push(...metaOps);
    return {state: working, ops, selection: caret(point.blockId, 0)};
};

export const setPreviewBlockData = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    url: string,
    preview: PreviewMetadata | null,
    context: CommandContext,
): CommandResult => {
    const current = state.state.blocks[blockId];
    if (!current || current.meta.type !== 'preview') {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
    return setBlockMeta(state, blockId, {
        type: 'preview',
        url,
        preview,
        ts: context.nextTs(),
    });
};

export const createTable = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
    size: {rows: number; columns: number} = {rows: 2, columns: 2},
): CommandResult => {
    const focus = firstPointForSelection(state, selection);
    const focusBlock = state.state.blocks[focus.blockId];
    if (!focusBlock) return {state, ops: [], selection};

    const config = annotationVirtualParents(state);
    const parent = materializedBlockParent(state, focus.blockId, config);
    const parentId = lamportToString(parent);
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    let tableId: string;

    if (tableCellContext(state, focus.blockId)) {
        const tableOps = setBlockMetaOps(working, {
            block: focusBlock.id,
            meta: {type: 'table', ts: context.nextTs()},
        });
        working = applyMany(working, tableOps, annotationVirtualParents(working));
        ops.push(...tableOps);
        tableId = focus.blockId;
    } else {
        const siblings = visibleBlockChildren(state, parentId, config);
        const focusIndex = siblings.indexOf(focus.blockId);
        const afterId = focusIndex >= 0 ? siblings[focusIndex + 1] : null;
        const tableOps = insertBlockOps(working, {
            actor: context.actor,
            parent,
            before: focusBlock.id,
            after: afterId ? state.state.blocks[afterId].id : null,
            meta: {type: 'table', ts: context.nextTs()},
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, tableOps, annotationVirtualParents(working));
        ops.push(...tableOps);
        tableId = lamportToString(insertedBlockFromOps(tableOps).id);
    }
    let firstCellId: string | null = null;

    for (let rowIndex = 0; rowIndex < Math.max(1, size.rows); rowIndex++) {
        const existingRows = tableRows(working, tableId);
        const previousRowId = existingRows[existingRows.length - 1] ?? null;
        const rowOps = insertBlockOps(working, {
            actor: context.actor,
            parent: working.state.blocks[tableId].id,
            before: previousRowId ? working.state.blocks[previousRowId].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, rowOps, annotationVirtualParents(working));
        ops.push(...rowOps);
        const rowBlock = insertedBlockFromOps(rowOps);
        const rowId = lamportToString(rowBlock.id);

        for (let columnIndex = 0; columnIndex < Math.max(1, size.columns); columnIndex++) {
            const existingCells = tableCells(working, rowId);
            const previousCellId = existingCells[existingCells.length - 1] ?? null;
            const cellOps = insertBlockOps(working, {
                actor: context.actor,
                parent: rowBlock.id,
                before: previousCellId ? working.state.blocks[previousCellId].id : null,
                meta: paragraphMeta(context.nextTs()),
                ts: context.nextTs(),
                virtualParents: annotationVirtualParents(working),
            });
            working = applyMany(working, cellOps, annotationVirtualParents(working));
            ops.push(...cellOps);
            firstCellId ??= lamportToString(insertedBlockFromOps(cellOps).id);
        }

    }

    return {state: working, ops, selection: caret(firstCellId ?? tableId, 0)};
};

export const convertBlockToTable = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
    size: {rows: number; columns: number} = {rows: 2, columns: 2},
): CommandResult => {
    const focus = firstPointForSelection(state, selection);
    const focusBlock = state.state.blocks[focus.blockId];
    if (!focusBlock) return {state, ops: [], selection};
    if (focusBlock.meta.type === 'table') return {state, ops: [], selection: caret(focus.blockId, focus.offset)};

    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    const tableOps = setBlockMetaOps(working, {
        block: focusBlock.id,
        meta: {type: 'table', ts: context.nextTs()},
    });
    working = applyMany(working, tableOps, annotationVirtualParents(working));
    ops.push(...tableOps);

    if (tableRows(working, focus.blockId).length > 0) {
        return {state: working, ops, selection: caret(focus.blockId, focus.offset)};
    }

    let firstCellId: string | null = null;
    for (let rowIndex = 0; rowIndex < Math.max(1, size.rows); rowIndex++) {
        const existingRows = tableRows(working, focus.blockId);
        const previousRowId = existingRows[existingRows.length - 1] ?? null;
        const rowOps = insertBlockOps(working, {
            actor: context.actor,
            parent: focusBlock.id,
            before: previousRowId ? working.state.blocks[previousRowId].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, rowOps, annotationVirtualParents(working));
        ops.push(...rowOps);
        const rowBlock = insertedBlockFromOps(rowOps);
        const rowId = lamportToString(rowBlock.id);

        for (let columnIndex = 0; columnIndex < Math.max(1, size.columns); columnIndex++) {
            const existingCells = tableCells(working, rowId);
            const previousCellId = existingCells[existingCells.length - 1] ?? null;
            const cellOps = insertBlockOps(working, {
                actor: context.actor,
                parent: rowBlock.id,
                before: previousCellId ? working.state.blocks[previousCellId].id : null,
                meta: paragraphMeta(context.nextTs()),
                ts: context.nextTs(),
                virtualParents: annotationVirtualParents(working),
            });
            working = applyMany(working, cellOps, annotationVirtualParents(working));
            ops.push(...cellOps);
            firstCellId ??= lamportToString(insertedBlockFromOps(cellOps).id);
        }
    }

    return {state: working, ops, selection: caret(firstCellId ?? focus.blockId, 0)};
};

export const createMissingTableCell = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
    columnIndex: number,
    context: CommandContext,
): CommandResult => {
    const row = state.state.blocks[rowId];
    if (!row || !tableRowContext(state, rowId) || row.meta.type === 'table') {
        return {state, ops: [], selection: caret(rowId, 0)};
    }
    const config = annotationVirtualParents(state);
    const cells = tableCells(state, rowId);
    const beforeId = columnIndex > 0 ? cells[columnIndex - 1] ?? cells[cells.length - 1] : null;
    const afterId = cells[columnIndex] ?? null;
    const ops = insertBlockOps(state, {
        actor: context.actor,
        parent: row.id,
        before: beforeId ? state.state.blocks[beforeId].id : null,
        after: afterId ? state.state.blocks[afterId].id : null,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: config,
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    const cellId = lamportToString(insertedBlockFromOps(ops).id);
    return {state: next, ops, selection: caret(cellId, 0)};
};

export const moveTableSelectionByArrow = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'left' | 'right' | 'up' | 'down',
    context: CommandContext,
): CommandResult | null => {
    const point =
        selection.type === 'caret'
            ? selection.point
            : direction === 'left' || direction === 'up'
              ? firstPointForSelection(state, selection)
              : lastPointForSelection(state, selection);
    const location = tableNavigationLocation(state, point.blockId);
    if (!location) return null;

    if (location.kind === 'row-header') {
        return moveFromTableRowHeader(state, location, point, direction, context);
    }
    return moveFromTableCellBlock(state, location, point, direction, context);
};

export const addTableRow = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    context: CommandContext,
    afterRowId?: string,
): CommandResult => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') return {state, ops: [], selection: caret(tableId, 0)};
    const rows = tableRows(state, tableId);
    const columnCount = tableColumnCount(state, tableId);
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    const afterIndex = afterRowId ? rows.indexOf(afterRowId) : -1;
    const previousRowId = afterIndex >= 0 ? rows[afterIndex] : rows[rows.length - 1] ?? null;
    const nextRowId = afterIndex >= 0 ? rows[afterIndex + 1] ?? null : null;
    const rowOps = insertBlockOps(working, {
        actor: context.actor,
        parent: table.id,
        before: previousRowId ? state.state.blocks[previousRowId].id : null,
        after: nextRowId ? state.state.blocks[nextRowId].id : null,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, rowOps, annotationVirtualParents(working));
    ops.push(...rowOps);
    const rowBlock = insertedBlockFromOps(rowOps);
    const rowId = lamportToString(rowBlock.id);
    let firstCellId: string | null = null;
    for (let index = 0; index < columnCount; index++) {
        const existingCells = tableCells(working, rowId);
        const previousCellId = existingCells[existingCells.length - 1] ?? null;
        const cellOps = insertBlockOps(working, {
            actor: context.actor,
            parent: rowBlock.id,
            before: previousCellId ? working.state.blocks[previousCellId].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, cellOps, annotationVirtualParents(working));
        ops.push(...cellOps);
        firstCellId ??= lamportToString(insertedBlockFromOps(cellOps).id);
    }
    return {state: working, ops, selection: caret(firstCellId ?? tableId, 0)};
};

export const addTableColumn = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    context: CommandContext,
    columnIndex?: number,
): CommandResult => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') return {state, ops: [], selection: caret(tableId, 0)};
    const rows = tableRows(state, tableId);
    const appendIndex = Math.max(0, ...rows.map((rowId) => tableCells(state, rowId).length));
    const targetIndex = columnIndex ?? appendIndex;
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    let firstCellId: string | null = null;
    for (const rowId of rows) {
        const row = working.state.blocks[rowId];
        if (!row || row.meta.type === 'table') continue;
        const cells = tableCells(working, rowId);
        const previousCellId = targetIndex > 0 ? cells[targetIndex - 1] ?? cells[cells.length - 1] ?? null : null;
        const nextCellId = cells[targetIndex] ?? null;
        const cellOps = insertBlockOps(working, {
            actor: context.actor,
            parent: state.state.blocks[rowId].id,
            before: previousCellId ? working.state.blocks[previousCellId].id : null,
            after: nextCellId ? working.state.blocks[nextCellId].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, cellOps, annotationVirtualParents(working));
        ops.push(...cellOps);
        firstCellId ??= lamportToString(insertedBlockFromOps(cellOps).id);
    }
    return {state: working, ops, selection: caret(firstCellId ?? tableId, 0)};
};

export const moveTableRow = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    rowId: string,
    direction: 'up' | 'down',
    context: CommandContext,
): CommandResult => {
    const table = state.state.blocks[tableId];
    const row = state.state.blocks[rowId];
    if (!table || table.meta.type !== 'table' || !row || !tableRowContext(state, rowId)) {
        return {state, ops: [], selection: caret(rowId, 0)};
    }
    const config = annotationVirtualParents(state);
    const rows = tableRows(state, tableId);
    const index = rows.indexOf(rowId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) {
        return {state, ops: [], selection: caret(rowId, 0)};
    }
    const reordered = rows.filter((id) => id !== rowId);
    reordered.splice(targetIndex, 0, rowId);
    const newIndex = reordered.indexOf(rowId);
    const beforeId = newIndex > 0 ? reordered[newIndex - 1] : null;
    const afterId = reordered[newIndex + 1] ?? null;
    const ops = moveBlockOps(state, {
        actor: context.actor,
        block: row.id,
        parent: table.id,
        before: beforeId ? state.state.blocks[beforeId].id : null,
        after: afterId ? state.state.blocks[afterId].id : null,
        ts: context.nextTs(),
        virtualParents: config,
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    const firstCellId = tableCells(next, rowId)[0];
    return {state: next, ops, selection: caret(firstCellId ?? rowId, 0)};
};

export const moveTableCellByTab = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    direction: 'forward' | 'backward',
    context: CommandContext,
): CommandResult => {
    const cell = tableCellContext(state, blockId);
    if (!cell) return {state, ops: [], selection: caret(blockId, 0)};

    if (direction === 'backward') {
        const previousCellId = previousTableCellId(state, cell);
        return previousCellId
            ? {state, ops: [], selection: caret(previousCellId, pointTextLength(state, previousCellId))}
            : {state, ops: [], selection: caret(blockId, 0)};
    }

    const nextCellId = nextTableCellId(state, cell);
    if (nextCellId) return {state, ops: [], selection: caret(nextCellId, 0)};

    const added = addTableRow(state, cell.tableId, context, cell.rowId);
    const next = tableCellContext(added.state, blockId);
    const rows = next ? tableRows(added.state, next.tableId) : [];
    const insertedRowId = rows[cell.rowIndex + 1] ?? rows[rows.length - 1] ?? null;
    const firstCellId = insertedRowId ? tableCells(added.state, insertedRowId)[0] : null;
    return {...added, selection: caret(firstCellId ?? blockId, 0)};
};

export const moveTableCell = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
    target: TableCellSlotTarget,
    context: CommandContext,
): CommandResult => {
    const cell = tableCellContext(state, cellId);
    const targetRow = state.state.blocks[target.rowId];
    if (!cell || !targetRow || targetRow.meta.type === 'table' || !tableRowContext(state, target.rowId)) {
        return {state, ops: [], selection: caret(cellId, 0)};
    }
    const sourceTable = state.state.blocks[cell.tableId];
    if (!sourceTable || sourceTable.meta.type !== 'table') {
        return {state, ops: [], selection: caret(cellId, 0)};
    }
    const targetRowContext = tableRowContext(state, target.rowId);
    if (!targetRowContext || targetRowContext.tableId !== cell.tableId) {
        return {state, ops: [], selection: caret(cellId, 0)};
    }

    const targetCells = tableCells(state, target.rowId).filter((id) => id !== cellId);
    const insertIndex = Math.max(0, Math.min(target.index, targetCells.length));
    const beforeId = insertIndex > 0 ? targetCells[insertIndex - 1] : null;
    const afterId = targetCells[insertIndex] ?? null;
    if (cell.rowId === target.rowId) {
        const currentCells = tableCells(state, cell.rowId);
        const reordered = currentCells.filter((id) => id !== cellId);
        reordered.splice(insertIndex, 0, cellId);
        if (reordered.join('\0') === currentCells.join('\0')) {
            return {state, ops: [], selection: caret(cellId, 0)};
        }
    }

    const current = state.state.blocks[cellId];
    const ops = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent: targetRow.id,
        before: beforeId ? state.state.blocks[beforeId].id : null,
        after: afterId ? state.state.blocks[afterId].id : null,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, selection: caret(cellId, 0)};
};

export const moveTableCellsToNewRow = (
    state: CachedState<RichBlockMeta>,
    cellIds: string[],
    target: TableRowSlotTarget,
    context: CommandContext,
): CommandResult => {
    const table = state.state.blocks[target.tableId];
    if (!table || table.meta.type !== 'table') {
        return {state, ops: [], selection: caret(target.tableId, 0)};
    }
    const rowAnchors = rowSlotAnchors(state, target);
    if (!rowAnchors) return {state, ops: [], selection: caret(target.tableId, 0)};

    const orderedCellIds = orderBlockIdsByVisiblePosition(state, cellIds).filter((cellId) =>
        Boolean(tableCellContext(state, cellId)),
    );
    if (!orderedCellIds.length) return {state, ops: [], selection: caret(target.tableId, 0)};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const rowOps = insertBlockOps(working, {
        actor: context.actor,
        parent: table.id,
        before: rowAnchors.beforeId ? working.state.blocks[rowAnchors.beforeId].id : null,
        after: rowAnchors.afterId ? working.state.blocks[rowAnchors.afterId].id : null,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, rowOps, annotationVirtualParents(working));
    ops.push(...rowOps);
    const rowId = lamportToString(insertedBlockFromOps(rowOps).id);

    let previousCellId: string | null = null;
    for (const cellId of orderedCellIds) {
        const cell = working.state.blocks[cellId];
        if (!cell || cell.deleted) continue;
        const moveOps = moveBlockOps(working, {
            actor: context.actor,
            block: cell.id,
            parent: working.state.blocks[rowId].id,
            before: previousCellId ? working.state.blocks[previousCellId].id : null,
            after: null,
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, moveOps, annotationVirtualParents(working));
        ops.push(...moveOps);
        previousCellId = cellId;
    }

    return {state: working, ops, selection: caret(orderedCellIds[0], 0)};
};

export const moveTableCellsOutAsBlocks = (
    state: CachedState<RichBlockMeta>,
    cellIds: string[],
    target: MoveTarget,
    context: CommandContext,
): CommandResult => {
    const orderedCellIds = orderDraggedBlockIdsForTarget(state, cellIds, target).filter((cellId) =>
        Boolean(tableCellContext(state, cellId)),
    );
    if (!orderedCellIds.length) {
        return {state, ops: [], selection: caret(focusTargetBlockId(target), 0)};
    }

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const cellId of orderedCellIds) {
        const result = moveBlock(working, cellId, target, context);
        working = result.state;
        ops.push(...result.ops);
    }
    return {state: working, ops, selection: caret(orderedCellIds[orderedCellIds.length - 1], 0)};
};

export const moveCellRectangleOutToNewTable = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    target: MoveTarget,
    context: CommandContext,
): CommandResult | null => {
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle) return null;
    const insertion = resolveInsertionTarget(state, target);
    if (!insertion) return {state, ops: [], selection};

    const tableMeta: RichBlockMeta = {type: 'table', ts: context.nextTs()};
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const tableOps = insertBlockOps(working, {
        actor: context.actor,
        parent: parentFromPath(insertion.parentPath),
        before: insertion.beforeId ? working.state.blocks[insertion.beforeId].id : null,
        after: insertion.afterId ? working.state.blocks[insertion.afterId].id : null,
        meta: tableMeta,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, tableOps, annotationVirtualParents(working));
    ops.push(...tableOps);
    const tableId = lamportToString(insertedBlockFromOps(tableOps).id);

    const sourceRows = tableRows(state, rectangle.tableId).slice(
        rectangle.startRowIndex,
        rectangle.endRowIndex + 1,
    );
    let firstMovedCellId: string | null = null;
    for (const sourceRowId of sourceRows) {
        const existingRows = tableRows(working, tableId);
        const previousRowId = existingRows[existingRows.length - 1] ?? null;
        const rowOps = insertBlockOps(working, {
            actor: context.actor,
            parent: working.state.blocks[tableId].id,
            before: previousRowId ? working.state.blocks[previousRowId].id : null,
            after: null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, rowOps, annotationVirtualParents(working));
        ops.push(...rowOps);
        const rowId = lamportToString(insertedBlockFromOps(rowOps).id);

        let previousCellId: string | null = null;
        const sourceCells = tableCells(state, sourceRowId).slice(
            rectangle.startColumnIndex,
            rectangle.endColumnIndex + 1,
        );
        for (const cellId of sourceCells) {
            const cell = working.state.blocks[cellId];
            if (!cell || cell.deleted) continue;
            const moveOps = moveBlockOps(working, {
                actor: context.actor,
                block: cell.id,
                parent: working.state.blocks[rowId].id,
                before: previousCellId ? working.state.blocks[previousCellId].id : null,
                after: null,
                ts: context.nextTs(),
                virtualParents: annotationVirtualParents(working),
            });
            working = applyMany(working, moveOps, annotationVirtualParents(working));
            ops.push(...moveOps);
            previousCellId = cellId;
            firstMovedCellId ??= cellId;
        }
    }

    return {state: working, ops, selection: caret(firstMovedCellId ?? tableId, 0)};
};

export const moveBlockToTableCellSlot = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    target: TableCellSlotTarget,
    context: CommandContext,
): CommandResult => {
    const row = state.state.blocks[target.rowId];
    if (!row || row.meta.type === 'table' || !tableRowContext(state, target.rowId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    while (tableCells(working, target.rowId).filter((id) => id !== blockId).length < target.index) {
        const inserted = createMissingTableCell(
            working,
            target.rowId,
            tableCells(working, target.rowId).length,
            context,
        );
        working = inserted.state;
        ops.push(...inserted.ops);
    }

    const targetCells = tableCells(working, target.rowId).filter((id) => id !== blockId);
    const insertIndex = Math.max(0, Math.min(target.index, targetCells.length));
    const beforeId = insertIndex > 0 ? targetCells[insertIndex - 1] : null;
    const afterId = targetCells[insertIndex] ?? null;
    const current = working.state.blocks[blockId];
    if (!current || current.deleted) return {state: working, ops, selection: caret(blockId, 0)};

    const moveOps = moveBlockOps(working, {
        actor: context.actor,
        block: current.id,
        parent: row.id,
        before: beforeId ? working.state.blocks[beforeId].id : null,
        after: afterId ? working.state.blocks[afterId].id : null,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, moveOps, annotationVirtualParents(working));
    ops.push(...moveOps);
    return {state: working, ops, selection: caret(blockId, 0)};
};

export const moveTableCellRectangleContents = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    target: TableCellSlotTarget,
    context: CommandContext,
): CommandResult | null => {
    if (selection.type !== 'table-cells') return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle) return null;
    const rows = tableRows(state, rectangle.tableId);
    const targetRowIndex = rows.indexOf(target.rowId);
    if (targetRowIndex < 0) return null;

    const height = rectangle.endRowIndex - rectangle.startRowIndex + 1;
    const width = rectangle.endColumnIndex - rectangle.startColumnIndex + 1;
    if (targetRowIndex + height > rows.length) {
        return {state, ops: [], selection};
    }

    const sourceRows = rows.slice(rectangle.startRowIndex, rectangle.endRowIndex + 1);
    const sourceTexts = sourceRows.map((rowId) => {
        const cells = tableCells(state, rowId);
        return Array.from({length: width}, (_, columnOffset) => {
            const cellId = cells[rectangle.startColumnIndex + columnOffset];
            return cellId ? blockContents(state, cellId) : '';
        });
    });

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const targetCellRows: string[][] = [];
    for (let rowOffset = 0; rowOffset < height; rowOffset++) {
        const rowId = rows[targetRowIndex + rowOffset];
        const cells: string[] = [];
        for (let columnOffset = 0; columnOffset < width; columnOffset++) {
            const targetIndex = target.index + columnOffset;
            while (tableCells(working, rowId).length <= targetIndex) {
                const inserted = createMissingTableCell(
                    working,
                    rowId,
                    tableCells(working, rowId).length,
                    context,
                );
                working = inserted.state;
                ops.push(...inserted.ops);
            }
            cells.push(tableCells(working, rowId)[targetIndex]);
        }
        targetCellRows.push(cells);
    }

    const cellsToClear = new Set<string>();
    for (let rowOffset = 0; rowOffset < height; rowOffset++) {
        const sourceCells = tableCells(working, rows[rectangle.startRowIndex + rowOffset]);
        for (let columnOffset = 0; columnOffset < width; columnOffset++) {
            const sourceCellId = sourceCells[rectangle.startColumnIndex + columnOffset];
            if (sourceCellId) cellsToClear.add(sourceCellId);
            const targetCellId = targetCellRows[rowOffset]?.[columnOffset];
            if (targetCellId) cellsToClear.add(targetCellId);
        }
    }

    for (const cellId of cellsToClear) {
        const cleared = clearCellContents(working, cellId);
        working = cleared.state;
        ops.push(...cleared.ops);
    }

    let focusCellId: string | null = null;
    for (let rowOffset = 0; rowOffset < height; rowOffset++) {
        for (let columnOffset = 0; columnOffset < width; columnOffset++) {
            const targetCellId = targetCellRows[rowOffset]?.[columnOffset];
            if (!targetCellId) continue;
            const text = sourceTexts[rowOffset]?.[columnOffset] ?? '';
            if (text) {
                const inserted = insertTextAtPoint(working, {blockId: targetCellId, offset: 0}, text, context);
                working = inserted.state;
                ops.push(...inserted.ops);
            }
            focusCellId = targetCellId;
        }
    }

    const anchorCellId = targetCellRows[0]?.[0] ?? focusCellId ?? selection.anchorCellId;
    return {
        state: working,
        ops,
        selection: {
            type: 'table-cells',
            tableId: rectangle.tableId,
            anchorCellId,
            focusCellId: focusCellId ?? anchorCellId,
        },
    };
};

export const deleteTableCellSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): CommandResult | null => {
    if (selection.type !== 'table-cells') return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle) return null;
    const rows = tableRows(state, selection.tableId);
    const columnCount = tableColumnCount(state, selection.tableId);
    const isFullRows =
        rectangle.startColumnIndex === 0 &&
        rectangle.endColumnIndex >= columnCount - 1 &&
        rectangle.startRowIndex <= rectangle.endRowIndex;
    const isFullColumn =
        rectangle.startRowIndex === 0 &&
        rectangle.endRowIndex >= rows.length - 1 &&
        rectangle.startColumnIndex === rectangle.endColumnIndex;

    if (isFullRows) {
        return deleteTableRows(state, selection.tableId, rows.slice(rectangle.startRowIndex, rectangle.endRowIndex + 1));
    }
    if (isFullColumn) {
        return deleteTableColumn(state, selection.tableId, rectangle.startColumnIndex);
    }
    return clearTableCells(state, rectangle.cellIds, selection.focusCellId);
};

export const advanceFromTableCellEnd = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): CommandResult | null => {
    if (selection.type !== 'caret') return null;
    const point = selection.point;
    if (point.offset !== pointTextLength(state, point.blockId)) return null;
    const cell = tableCellContext(state, point.blockId);
    if (!cell) return null;

    const rows = tableRows(state, cell.tableId);
    const columnCount = Math.max(
        1,
        ...rows.map((rowId) => tableCells(state, rowId).length),
    );
    const nextColumn = cell.columnIndex + 1;
    const cells = tableCells(state, cell.rowId);
    if (nextColumn >= cells.length) {
        const added = addTableRow(state, cell.tableId, context, cell.rowId);
        const updatedRows = tableRows(added.state, cell.tableId);
        const insertedRowId = updatedRows[cell.rowIndex + 1] ?? updatedRows[updatedRows.length - 1] ?? null;
        const firstCellId = insertedRowId ? tableCells(added.state, insertedRowId)[0] : null;
        return {...added, selection: caret(firstCellId ?? point.blockId, 0)};
    }
    if (nextColumn >= columnCount) return null;

    const nextCellId = cells[nextColumn] ?? null;
    if (nextCellId) {
        return pointTextLength(state, nextCellId) === 0
            ? {state, ops: [], selection: caret(nextCellId, 0)}
            : null;
    }
    return null;
};

type TableCellContext = {
    tableId: string;
    rowId: string;
    rowIndex: number;
    columnIndex: number;
};

const tableCellContext = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
): TableCellContext | null => {
    const block = state.state.blocks[blockId];
    if (!block) return null;
    const rowId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    const row = state.state.blocks[rowId];
    if (!row || row.meta.type === 'table') return null;
    const rowContext = tableRowContext(state, rowId);
    if (!rowContext) return null;
    const tableId = rowContext.tableId;
    const rows = tableRows(state, tableId);
    const rowIndex = rowContext.rowIndex;
    const cells = tableCells(state, rowId);
    const columnIndex = cells.indexOf(blockId);
    if (rowIndex < 0 || columnIndex < 0) return null;
    return {tableId, rowId, rowIndex, columnIndex};
};

type TableRowContext = {
    tableId: string;
    rowId: string;
    rowIndex: number;
    rows: string[];
};

const tableRowContext = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
): TableRowContext | null => {
    const block = state.state.blocks[rowId];
    if (!block) return null;
    const tableId = lamportToString(materializedBlockParent(state, rowId, annotationVirtualParents(state)));
    if (state.state.blocks[tableId]?.meta.type !== 'table') return null;
    const rows = tableRows(state, tableId);
    const rowIndex = rows.indexOf(rowId);
    if (rowIndex < 0) return null;
    return {tableId, rowId, rowIndex, rows};
};

const tableRows = (state: CachedState<RichBlockMeta>, tableId: string): string[] => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') return [];
    return visibleBlockChildren(state, tableId, annotationVirtualParents(state));
};

const tableCells = (state: CachedState<RichBlockMeta>, rowId: string): string[] => {
    const row = state.state.blocks[rowId];
    if (!row || row.meta.type === 'table') return [];
    return visibleBlockChildren(state, rowId, annotationVirtualParents(state));
};

const tableColumnCount = (state: CachedState<RichBlockMeta>, tableId: string): number => {
    const rows = tableRows(state, tableId);
    return Math.max(
        1,
        ...rows.map((rowId) => tableCells(state, rowId).length),
    );
};

const deleteTableRows = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    rowIds: string[],
): CommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const rowId of rowIds) {
        if (!working.state.blocks[rowId] || working.state.blocks[rowId].deleted) continue;
        const deleted = deleteVisibleSubtreeOps(working, rowId);
        working = applyMany(working, deleted, annotationVirtualParents(working));
        ops.push(...deleted);
    }
    return {state: working, ops, selection: fallbackTableSelection(working, tableId)};
};

const deleteTableColumn = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    columnIndex: number,
): CommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const rowId of tableRows(state, tableId)) {
        const cellId = tableCells(working, rowId)[columnIndex];
        if (!cellId || !working.state.blocks[cellId] || working.state.blocks[cellId].deleted) continue;
        const deleted = deleteVisibleSubtreeOps(working, cellId);
        working = applyMany(working, deleted, annotationVirtualParents(working));
        ops.push(...deleted);
    }
    return {state: working, ops, selection: fallbackTableSelection(working, tableId)};
};

const clearTableCells = (
    state: CachedState<RichBlockMeta>,
    cellIds: string[],
    focusCellId: string,
): CommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const cellId of cellIds) {
        if (!working.state.blocks[cellId] || working.state.blocks[cellId].deleted) continue;
        const childIds = visibleBlockChildren(working, cellId, annotationVirtualParents(working));
        for (const childId of childIds) {
            if (!working.state.blocks[childId] || working.state.blocks[childId].deleted) continue;
            const deleted = deleteVisibleSubtreeOps(working, childId);
            working = applyMany(working, deleted, annotationVirtualParents(working));
            ops.push(...deleted);
        }
        const length = pointTextLength(working, cellId);
        if (length > 0) {
            const deletedText = deleteRangeOps(working, {
                block: parseLamportString(cellId),
                startOffset: 0,
                endOffset: length,
            });
            working = applyMany(working, deletedText, annotationVirtualParents(working));
            ops.push(...deletedText);
        }
    }
    const fallbackCellId =
        working.state.blocks[focusCellId] && !working.state.blocks[focusCellId].deleted
            ? focusCellId
            : cellIds.find((cellId) => working.state.blocks[cellId] && !working.state.blocks[cellId].deleted);
    const fallbackBlockId = fallbackCellId ?? editableBlockIds(working)[0] ?? focusCellId;
    const fallback = caret(fallbackBlockId, fallbackCellId ? 0 : pointTextLength(working, fallbackBlockId));
    return {state: working, ops, selection: fallback};
};

const clearCellContents = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    if (!working.state.blocks[cellId] || working.state.blocks[cellId].deleted) return {state: working, ops};
    const childIds = visibleBlockChildren(working, cellId, annotationVirtualParents(working));
    for (const childId of childIds) {
        if (!working.state.blocks[childId] || working.state.blocks[childId].deleted) continue;
        const deleted = deleteVisibleSubtreeOps(working, childId);
        working = applyMany(working, deleted, annotationVirtualParents(working));
        ops.push(...deleted);
    }
    const length = pointTextLength(working, cellId);
    if (length > 0) {
        const deletedText = deleteRangeOps(working, {
            block: parseLamportString(cellId),
            startOffset: 0,
            endOffset: length,
        });
        working = applyMany(working, deletedText, annotationVirtualParents(working));
        ops.push(...deletedText);
    }
    return {state: working, ops};
};

const fallbackTableSelection = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
): EditorSelection => {
    const firstRowId = tableRows(state, tableId)[0];
    const firstCellId = firstRowId ? tableCells(state, firstRowId)[0] : null;
    if (firstCellId) return caret(firstCellId, 0);
    if (state.state.blocks[tableId] && !state.state.blocks[tableId].deleted) {
        return caret(tableId, pointTextLength(state, tableId));
    }
    const fallbackBlockId = editableBlockIds(state)[0] ?? tableId;
    return caret(fallbackBlockId, pointTextLength(state, fallbackBlockId));
};

type TableNavigationLocation =
    | {
          kind: 'row-header';
          tableId: string;
          rowId: string;
          rowIndex: number;
          rows: string[];
      }
    | {
          kind: 'cell';
          tableId: string;
          rowId: string;
          rowIndex: number;
          columnIndex: number;
          cellId: string;
          blockIndex: number;
          cellBlocks: string[];
      };

const tableNavigationLocation = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
): TableNavigationLocation | null => {
    const row = tableRowContext(state, blockId);
    if (row && state.state.blocks[blockId]?.meta.type !== 'table') {
        return {kind: 'row-header', ...row};
    }

    const cell = tableCellContextForBlockOrAncestor(state, blockId);
    if (!cell) return null;
    const cellBlocks = cellSubtreeBlockIds(state, cell.cellId);
    const blockIndex = cellBlocks.indexOf(blockId);
    if (blockIndex < 0) return null;
    return {kind: 'cell', ...cell, blockIndex, cellBlocks};
};

const tableCellContextForBlockOrAncestor = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
): (TableCellContext & {cellId: string}) | null => {
    const direct = tableCellContext(state, blockId);
    if (direct) return {...direct, cellId: blockId};

    const path = materializedBlockPath(state, blockId, annotationVirtualParents(state)).map(lamportToString);
    for (let index = path.length - 1; index >= 0; index--) {
        const cellId = path[index];
        const cell = tableCellContext(state, cellId);
        if (cell) return {...cell, cellId};
    }
    return null;
};

const cellSubtreeBlockIds = (state: CachedState<RichBlockMeta>, cellId: string): string[] => {
    const outline = visibleBlockOutline(state, annotationVirtualParents(state));
    const index = outline.findIndex((block) => block.id === cellId);
    if (index < 0) return [cellId];
    const depth = outline[index].depth;
    const ids = [cellId];
    for (let cursor = index + 1; cursor < outline.length && outline[cursor].depth > depth; cursor++) {
        ids.push(outline[cursor].id);
    }
    return ids;
};

const moveFromTableRowHeader = (
    state: CachedState<RichBlockMeta>,
    row: Extract<TableNavigationLocation, {kind: 'row-header'}>,
    point: BlockPoint,
    direction: 'left' | 'right' | 'up' | 'down',
    context: CommandContext,
): CommandResult | null => {
    if (direction === 'up' || direction === 'down') {
        const targetRowId = row.rows[direction === 'up' ? row.rowIndex - 1 : row.rowIndex + 1];
        if (!targetRowId) return null;
        return {
            state,
            ops: [],
            selection: caret(targetRowId, Math.min(point.offset, pointTextLength(state, targetRowId))),
        };
    }

    if (direction === 'left') {
        const previousRowId = row.rows[row.rowIndex - 1];
        if (!previousRowId) return null;
        const previousCells = tableCells(state, previousRowId);
        const previousCellId = previousCells[previousCells.length - 1];
        if (!previousCellId) return null;
        const targetBlockId = lastBlockInCellSubtree(state, previousCellId);
        return {
            state,
            ops: [],
            selection: caret(targetBlockId, pointTextLength(state, targetBlockId)),
        };
    }

    if (direction === 'right') {
        const target = ensureTableCellAtColumn(state, row.rowId, 0, context);
        return {
            state: target.state,
            ops: target.ops,
            selection: caret(target.cellId, 0),
        };
    }

    return null;
};

const moveFromTableCellBlock = (
    state: CachedState<RichBlockMeta>,
    cell: Extract<TableNavigationLocation, {kind: 'cell'}>,
    point: BlockPoint,
    direction: 'left' | 'right' | 'up' | 'down',
    context: CommandContext,
): CommandResult | null => {
    if (direction === 'left' || direction === 'up') {
        const previousBlockId = cell.cellBlocks[cell.blockIndex - 1];
        if (previousBlockId) {
            return {
                state,
                ops: [],
                selection: caret(previousBlockId, pointTextLength(state, previousBlockId)),
            };
        }
    } else {
        const nextBlockId = cell.cellBlocks[cell.blockIndex + 1];
        if (nextBlockId) {
            return {state, ops: [], selection: caret(nextBlockId, 0)};
        }
    }

    if (direction === 'up' || direction === 'down') {
        const rows = tableRows(state, cell.tableId);
        const targetRowId = rows[direction === 'up' ? cell.rowIndex - 1 : cell.rowIndex + 1];
        if (!targetRowId) return null;
        const target = ensureTableCellAtColumn(state, targetRowId, cell.columnIndex, context);
        return {
            state: target.state,
            ops: target.ops,
            selection: caret(
                target.cellId,
                Math.min(point.offset, pointTextLength(target.state, target.cellId)),
            ),
        };
    }

    if (direction === 'left') {
        if (cell.columnIndex === 0) {
            return {
                state,
                ops: [],
                selection: caret(cell.rowId, pointTextLength(state, cell.rowId)),
            };
        }
        const previousCellId = tableCells(state, cell.rowId)[cell.columnIndex - 1];
        if (!previousCellId) return null;
        const targetBlockId = lastBlockInCellSubtree(state, previousCellId);
        return {
            state,
            ops: [],
            selection: caret(targetBlockId, pointTextLength(state, targetBlockId)),
        };
    }

    const cells = tableCells(state, cell.rowId);
    const nextCellId = cells[cell.columnIndex + 1];
    if (nextCellId) return {state, ops: [], selection: caret(nextCellId, 0)};
    const nextRowId = tableRows(state, cell.tableId)[cell.rowIndex + 1];
    return nextRowId ? {state, ops: [], selection: caret(nextRowId, 0)} : null;
};

const ensureTableCellAtColumn = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
    columnIndex: number,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; cellId: string} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    while (tableCells(working, rowId).length <= columnIndex) {
        const inserted = createMissingTableCell(working, rowId, tableCells(working, rowId).length, context);
        working = inserted.state;
        ops.push(...inserted.ops);
    }
    return {state: working, ops, cellId: tableCells(working, rowId)[columnIndex]};
};

const lastBlockInCellSubtree = (state: CachedState<RichBlockMeta>, cellId: string): string => {
    const ids = cellSubtreeBlockIds(state, cellId);
    return ids[ids.length - 1] ?? cellId;
};

const lastPointForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): BlockPoint => {
    if (selection.type === 'caret') return clampPoint(state, selection.point);
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return firstPointForSelection(state, selection);
    const segment = segments[segments.length - 1];
    return {blockId: segment.blockId, offset: segment.endOffset};
};

const areTableRowCellsEmpty = (state: CachedState<RichBlockMeta>, rowId: string): boolean => {
    const cells = tableCells(state, rowId);
    return cells.length > 0 && cells.every((cellId) => isVisibleSubtreeEmpty(state, cellId));
};

const isEmptyTableRow = (state: CachedState<RichBlockMeta>, rowId: string): boolean => {
    return pointTextLength(state, rowId) === 0 && areTableRowCellsEmpty(state, rowId);
};

const isVisibleSubtreeEmpty = (state: CachedState<RichBlockMeta>, blockId: string): boolean => {
    if (pointTextLength(state, blockId) !== 0) return false;
    return visibleBlockChildren(state, blockId, annotationVirtualParents(state)).every((childId) =>
        isVisibleSubtreeEmpty(state, childId),
    );
};

const createEmptyCellsForRow = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
    columnCount: number,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    const row = state.state.blocks[rowId];
    if (!row || !tableRowContext(state, rowId) || row.meta.type === 'table') return {state, ops: []};
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (let index = 0; index < columnCount; index++) {
        const existingCells = tableCells(working, rowId);
        const previousCellId = existingCells[existingCells.length - 1] ?? null;
        const cellOps = insertBlockOps(working, {
            actor: context.actor,
            parent: row.id,
            before: previousCellId ? working.state.blocks[previousCellId].id : null,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, cellOps, annotationVirtualParents(working));
        ops.push(...cellOps);
    }
    return {state: working, ops};
};

const deleteVisibleSubtreeOps = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
): Array<Op<RichBlockMeta>> => {
    return deleteBlockOps(state, {
        block: parseLamportString(blockId),
        mode: 'subtree',
        virtualParents: annotationVirtualParents(state),
    });
};

const insertParagraphAfterBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; blockId: string} => {
    return insertBlockAfterBlock(state, blockId, paragraphMeta(context.nextTs()), context);
};

const insertBlockAfterBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    meta: RichBlockMeta,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; blockId: string} => {
    const block = state.state.blocks[blockId];
    if (!block) return {state, ops: [], blockId};
    const parent = materializedBlockParent(state, blockId, annotationVirtualParents(state));
    const parentId = lamportToString(parent);
    const siblings = visibleBlockChildren(state, parentId, annotationVirtualParents(state));
    const index = siblings.indexOf(blockId);
    const afterId = index >= 0 ? siblings[index + 1] ?? null : null;
    const ts = context.nextTs();
    const ops = insertBlockOps(state, {
        actor: context.actor,
        parent,
        before: block.id,
        after: afterId ? state.state.blocks[afterId].id : null,
        meta,
        ts,
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, blockId: lamportToString(insertedBlockFromOps(ops).id)};
};

const rehomeVisibleSubtreeToRealParents = (
    state: CachedState<RichBlockMeta>,
    rootId: string,
    rootParent: Lamport,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const outline = visibleBlockOutline(state, annotationVirtualParents(state));
    const index = outline.findIndex((item) => item.id === rootId);
    if (index < 0) return {state, ops};
    const rootDepth = outline[index].depth;
    const ids = [rootId];
    for (let i = index + 1; i < outline.length && outline[i].depth > rootDepth; i++) {
        ids.push(outline[i].id);
    }

    ids.forEach((id, idIndex) => {
        const block = working.state.blocks[id];
        if (!block) return;
        const parent = idIndex === 0
            ? rootParent
            : materializedBlockParent(working, id, annotationVirtualParents(working));
        const parentId = lamportToString(parent);
        const siblings = visibleBlockChildren(working, parentId, annotationVirtualParents(working)).filter(
            (siblingId) => siblingId !== id,
        );
        const beforeId = siblings[siblings.length - 1] ?? null;
        const moveOps = moveBlockOps(working, {
            actor: context.actor,
            block: block.id,
            parent,
            before: beforeId ? working.state.blocks[beforeId].id : null,
            after: null,
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, moveOps, annotationVirtualParents(working));
        ops.push(...moveOps);
    });

    return {state: working, ops};
};

const nextTableCellId = (state: CachedState<RichBlockMeta>, cell: TableCellContext): string | null => {
    const rows = tableRows(state, cell.tableId);
    for (let rowIndex = cell.rowIndex; rowIndex < rows.length; rowIndex++) {
        const cells = tableCells(state, rows[rowIndex]);
        const start = rowIndex === cell.rowIndex ? cell.columnIndex + 1 : 0;
        if (cells[start]) return cells[start];
    }
    return null;
};

const previousTableCellId = (state: CachedState<RichBlockMeta>, cell: TableCellContext): string | null => {
    const rows = tableRows(state, cell.tableId);
    for (let rowIndex = cell.rowIndex; rowIndex >= 0; rowIndex--) {
        const cells = tableCells(state, rows[rowIndex]);
        const start = rowIndex === cell.rowIndex ? cell.columnIndex - 1 : cells.length - 1;
        if (cells[start]) return cells[start];
    }
    return null;
};

const sameTableRowBoundary = (
    state: CachedState<RichBlockMeta>,
    oneBlockId: string,
    otherBlockId: string,
): boolean => {
    const one = tableCellContext(state, oneBlockId);
    const other = tableCellContext(state, otherBlockId);
    if (!one && !other) return true;
    if (!one || !other) return false;
    return one.rowId === other.rowId;
};

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
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, selection: caret(movedBlockId, 0)};
};

const rowSlotAnchors = (
    state: CachedState<RichBlockMeta>,
    target: TableRowSlotTarget,
): {beforeId: string | null; afterId: string | null} | null => {
    const rows = tableRows(state, target.tableId);
    if (target.beforeRowId && !rows.includes(target.beforeRowId)) return null;
    if (target.afterRowId && !rows.includes(target.afterRowId)) return null;
    if (target.beforeRowId && target.afterRowId) {
        const beforeIndex = rows.indexOf(target.beforeRowId);
        const afterIndex = rows.indexOf(target.afterRowId);
        if (afterIndex !== beforeIndex + 1) return null;
    }
    if (!target.beforeRowId && !target.afterRowId && rows.length > 0) return null;
    return {beforeId: target.beforeRowId, afterId: target.afterRowId};
};

const orderBlockIdsByVisiblePosition = (
    state: CachedState<RichBlockMeta>,
    blockIds: string[],
): string[] => {
    const order = editableBlockIds(state);
    return [...new Set(blockIds)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

const orderDraggedBlockIdsForTarget = (
    state: CachedState<RichBlockMeta>,
    blockIds: string[],
    target: MoveTarget,
): string[] => {
    const sorted = orderBlockIdsByVisiblePosition(state, blockIds);
    if (target.type === 'after' || (target.type === 'child' && target.at === 'start')) {
        return sorted.reverse();
    }
    return sorted;
};

const focusTargetBlockId = (target: MoveTarget): string =>
    target.type === 'child' ? target.parentBlockId : target.targetBlockId;

const resolveInsertionTarget = (
    state: CachedState<RichBlockMeta>,
    target: MoveTarget,
): {parentPath: Lamport[]; beforeId: string | null; afterId: string | null} | null => {
    const targetParentId =
        target.type === 'child'
            ? target.parentBlockId
            : rawParentIdForVisibleBlock(state, target.targetBlockId);
    if (targetParentId === null) return null;
    if (target.type === 'child' && tableRowContext(state, target.parentBlockId)) return null;

    const siblings = visibleBlockChildren(state, targetParentId, annotationVirtualParents(state));
    let insertIndex: number;
    if (target.type === 'child') {
        if (targetParentId !== ROOT_ID && !state.state.blocks[targetParentId]) return null;
        insertIndex = target.at === 'start' ? 0 : siblings.length;
    } else {
        const targetIndex = siblings.indexOf(target.targetBlockId);
        if (targetIndex < 0) return null;
        insertIndex = target.type === 'after' ? targetIndex + 1 : targetIndex;
    }

    const parentPath = materializedPathForMoveParent(state, targetParentId);
    if (!parentPath) return null;
    return {
        parentPath,
        beforeId: insertIndex > 0 ? siblings[insertIndex - 1] : null,
        afterId: siblings[insertIndex] ?? null,
    };
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
    if (target.type === 'child' && tableRowContext(state, target.parentBlockId)) return null;
    if (target.type !== 'child' && target.targetBlockId === movedBlockId) return null;
    if (target.type !== 'child' && isDescendantOf(state, target.targetBlockId, movedBlockId)) return null;
    if (
        targetParentId !== ROOT_ID &&
        state.state.blocks[targetParentId] &&
        isDescendantOrSelf(state, targetParentId, movedBlockId)
    ) return null;

    const siblings = visibleBlockChildren(state, targetParentId, annotationVirtualParents(state)).filter((id) => id !== movedBlockId);
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
    const parentPath = materializedPathForMoveParent(state, targetParentId);
    if (!parentPath) return null;
    const currentParent = visibleParentIdForBlock(state, movedBlockId);
    if (currentParent === null) return null;
    const currentSiblings = visibleBlockChildren(state, currentParent, annotationVirtualParents(state));
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

const materializedPathForMoveParent = (
    state: CachedState<RichBlockMeta>,
    parentId: string,
): Lamport[] | null => {
    if (parentId === ROOT_ID) return [];
    if (state.state.blocks[parentId]) {
        return materializedBlockPath(state, parentId, annotationVirtualParents(state));
    }
    return null;
};

const isDescendantOrSelf = (state: CachedState<RichBlockMeta>, blockId: string, ancestorId: string): boolean =>
    blockId === ancestorId || isDescendantOf(state, blockId, ancestorId);

const rawParentIdForVisibleBlock = (state: CachedState<RichBlockMeta>, blockId: string): string | null => {
    const block = state.state.blocks[blockId];
    if (!block) return null;
    return visibleParentIdForBlock(state, blockId);
};

const visibleParentIdForBlock = (state: CachedState<RichBlockMeta>, blockId: string): string | null =>
    visibleBlockOutline(state, annotationVirtualParents(state)).find((item) => item.id === blockId)?.parentId ?? null;

const isDescendantOf = (state: CachedState<RichBlockMeta>, blockId: string, ancestorId: string): boolean => {
    const path = materializedBlockPath(state, blockId, annotationVirtualParents(state)).map(lamportToString);
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

    const parentId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    if (tableRowContext(state, parentId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
    const siblings = visibleBlockChildren(state, parentId, annotationVirtualParents(state));
    const index = siblings.indexOf(blockId);
    const previousBlockId = siblings[index - 1];
    const previous = previousBlockId ? state.state.blocks[previousBlockId] : null;
    if (index <= 0 || !previous) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const previousChildren = visibleBlockChildren(state, previousBlockId, annotationVirtualParents(state));
    const lastChildId = previousChildren[previousChildren.length - 1] ?? null;
    const ops = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent: previous.id,
        before: lastChildId ? state.state.blocks[lastChildId].id : null,
        after: null,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
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

    const parentId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    if (tableRowContext(state, parentId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
    if (parentId === ROOT_ID) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parent = state.state.blocks[parentId];
    if (!parent) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const parentPath = materializedBlockPath(state, parentId, annotationVirtualParents(state));
    const grandparentPath = parentPath.slice(0, -1);
    const grandparentId =
        grandparentPath.length > 0 ? lamportToString(grandparentPath[grandparentPath.length - 1]) : ROOT_ID;
    const grandparentChildren = visibleBlockChildren(state, grandparentId, annotationVirtualParents(state)).filter(
        (id) => id !== blockId,
    );
    const parentIndex = grandparentChildren.indexOf(parentId);
    const afterParentId = parentIndex >= 0 ? grandparentChildren[parentIndex + 1] : null;
    const siblings = visibleBlockChildren(state, parentId, annotationVirtualParents(state));
    const blockIndex = siblings.indexOf(blockId);
    const followingSiblings = blockIndex >= 0 ? siblings.slice(blockIndex + 1) : [];
    const ops: Array<Op<RichBlockMeta>> = moveBlockOps(state, {
        actor: context.actor,
        block: current.id,
        parent: parentFromPath(grandparentPath),
        before: parent.id,
        after: afterParentId ? state.state.blocks[afterParentId].id : null,
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(state),
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

    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, selection: caret(blockId, 0)};
};

export const joinWithPrevious = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const blocks = editableBlockIds(state);
    const index = blocks.indexOf(blockId);
    if (index <= 0) return {state, ops: [], selection: caret(blockId, 0)};
    if (tableRowContext(state, blockId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const previousBlockId = blocks[index - 1];
    if (tableRowContext(state, previousBlockId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
    if (!sameTableRowBoundary(state, previousBlockId, blockId)) {
        return {state, ops: [], selection: caret(blockId, 0)};
    }
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
    const next = applyMany(state, ops, annotationVirtualParents(state));
    return {state: next, ops, selection: caret(previousBlockId, previousLength)};
};

export const joinWithNext = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext,
): CommandResult => {
    const blocks = editableBlockIds(state);
    const index = blocks.indexOf(blockId);
    const nextBlockId = blocks[index + 1];
    if (index < 0 || !nextBlockId) {
        return {state, ops: [], selection: caret(blockId, pointTextLength(state, blockId))};
    }
    if (
        tableRowContext(state, blockId) ||
        tableRowContext(state, nextBlockId)
    ) {
        return {state, ops: [], selection: caret(blockId, pointTextLength(state, blockId))};
    }
    if (!sameTableRowBoundary(state, blockId, nextBlockId)) {
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
    const next = applyMany(state, ops, annotationVirtualParents(state));
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
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
    }

    const parentId = visibleParentIdForBlock(working, blockId);
    if (parentId === null) return {state: working, ops, selection: caret(blockId, pointTextLength(working, blockId))};

    const siblings = visibleBlockChildren(working, parentId, annotationVirtualParents(working));
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
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, insertOps, annotationVirtualParents(working));
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

    const ops = localInsertTextOps(state, {
        actor: context.actor,
        block: parseLamportString(point.blockId),
        offset: point.offset,
        text,
    });
    const next = applyCharInsertOpsOrApplyMany(state, ops);
    return {
        state: next,
        ops,
        point: {blockId: point.blockId, offset: point.offset + ops.length},
    };
};

const insertSortedRev = (array: string[], item: string): string[] => {
    for (let index = 0; index < array.length; index++) {
        if (compareLamportStrings(item, array[index]) > 0) {
            array.splice(index, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
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
    return {state: ops.length ? applyMany(state, ops, annotationVirtualParents(state)) : state, ops, point};
};

const deleteSelectionAndJoinBoundaries = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; point: BlockPoint} => {
    const span = normalizedSelectionSpan(state, selection);
    if (!span) return deleteSelection(state, selection);

    const blocks = editableBlockIds(state);
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
            working = applyMany(working, joinOps, annotationVirtualParents(working));
            ops.push(...joinOps);
        }
    }

    return {state: working, ops, point: clampPoint(working, span.start)};
};

const normalizedSelectionSpan = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): {start: BlockPoint; end: BlockPoint} | null => {
    if (selection.type !== 'range') return null;

    const anchor = clampPoint(state, selection.anchor);
    const focus = clampPoint(state, selection.focus);
    const blocks = editableBlockIds(state);
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

const visibleCharLocation = (
    state: CachedState<RichBlockMeta>,
    charId: string,
): {blockId: string; offset: number} | null => {
    for (const blockId of editableBlockIds(state)) {
        const index = orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).indexOf(charId);
        if (index >= 0) return {blockId, offset: index};
    }
    return null;
};

const selectionFullyHasMark = (
    state: CachedState<RichBlockMeta>,
    segments: ReturnType<typeof normalizeSelectionSegments>,
    markType: BareInlineMark,
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
        return selected.length > 0 && selected.every((marks) =>
            markType === CODE_MARK ? isCodeMarkValue(marks[markType]) : equal(marks[markType], true),
        );
    });
};

const setValuedMark = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    markType: string,
    value: string | undefined,
    remove: boolean,
    context: CommandContext,
): CommandResult => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return {state, ops: [], selection};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const segment of segments) {
        const op = markRangeOp(
            working,
            parseLamportString(segment.blockId),
            segment.startOffset,
            segment.endOffset,
            markType,
            value,
            remove,
            [working.state.maxSeenCount + 1, context.actor],
        );
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
    }

    return {state: working, ops, selection};
};
