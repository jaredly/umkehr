import equal from 'fast-deep-equal';
import {
    applyMany,
    blockContents,
    deleteBlockOps,
    deleteRangeOps,
    insertBlockOps,
    insertTextOps,
    joinBlocksOps,
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
    type Op,
} from 'umkehr/block-crdt';
import {createLseqIdBetween} from 'umkehr/block-crdt/lseq';
import type {BlockOrderTs, CachedState, Lamport} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import {paragraphMeta, sameTypeWithTs, type RichBlockMeta} from './blockMeta';
import {annotationVirtualParents} from './annotations';
import type {BooleanInlineMark} from './inlineMarks';
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
    if (!current || current.meta.type !== 'table_row') return noCommand();
    const row = tableRowContext(working, point.blockId);
    if (!row) return noCommand();

    const newRowId = lamportToString(nextBlockIdForActor(working, context.actor));
    if (point.offset === 0) {
        const anchors = visibleSiblingAnchorsForBlock(working, point.blockId, annotationVirtualParents(working));
        if (!anchors) return noCommand();
        const insertOps = insertBlockOps(working, {
            actor: context.actor,
            parent: anchors.parent,
            before: anchors.before,
            after: anchors.after,
            meta: {type: 'table_row', ts: context.nextTs()},
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
    if (!newRow || newRow.meta.type !== 'table_row') return noCommand();
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
    const rowCells = visibleBlockChildren(state, cell.rowId, annotationVirtualParents(state));
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
    const rowAncestorId = materializedBlockPath(state, focus.blockId, config)
        .map(lamportToString)
        .find((id) => state.state.blocks[id]?.meta.type === 'table_row');
    const rowParent: Lamport = [state.state.maxSeenCount + 1, `${context.actor}:rows`];
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    let tableId: string;

    if (rowAncestorId) {
        const tableOps = setBlockMetaOps(working, {
            block: focusBlock.id,
            meta: {type: 'table', rowParent, ts: context.nextTs()},
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
            meta: {type: 'table', rowParent, ts: context.nextTs()},
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, tableOps, annotationVirtualParents(working));
        ops.push(...tableOps);
        tableId = lamportToString(insertedBlockFromOps(tableOps).id);
    }
    let firstCellId: string | null = null;

    for (let rowIndex = 0; rowIndex < Math.max(1, size.rows); rowIndex++) {
        const existingRows = visibleBlockChildren(working, lamportToString(rowParent), annotationVirtualParents(working));
        const previousRowId = existingRows[existingRows.length - 1] ?? null;
        const rowOps = insertBlockOps(working, {
            actor: context.actor,
            parent: rowParent,
            before: previousRowId ? working.state.blocks[previousRowId].id : null,
            meta: {type: 'table_row', ts: context.nextTs()},
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, rowOps, annotationVirtualParents(working));
        ops.push(...rowOps);
        const rowBlock = insertedBlockFromOps(rowOps);
        const rowId = lamportToString(rowBlock.id);

        for (let columnIndex = 0; columnIndex < Math.max(1, size.columns); columnIndex++) {
            const existingCells = visibleBlockChildren(working, rowId, annotationVirtualParents(working));
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
    if (!focusBlock || focusBlock.meta.type === 'table_row') return {state, ops: [], selection};
    if (focusBlock.meta.type === 'table') return {state, ops: [], selection: caret(focus.blockId, focus.offset)};

    const rowParent: Lamport = [state.state.maxSeenCount + 1, `${context.actor}:rows`];
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    const tableOps = setBlockMetaOps(working, {
        block: focusBlock.id,
        meta: {type: 'table', rowParent, ts: context.nextTs()},
    });
    working = applyMany(working, tableOps, annotationVirtualParents(working));
    ops.push(...tableOps);

    let firstCellId: string | null = null;
    for (let rowIndex = 0; rowIndex < Math.max(1, size.rows); rowIndex++) {
        const existingRows = visibleBlockChildren(working, lamportToString(rowParent), annotationVirtualParents(working));
        const previousRowId = existingRows[existingRows.length - 1] ?? null;
        const rowOps = insertBlockOps(working, {
            actor: context.actor,
            parent: rowParent,
            before: previousRowId ? working.state.blocks[previousRowId].id : null,
            meta: {type: 'table_row', ts: context.nextTs()},
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, rowOps, annotationVirtualParents(working));
        ops.push(...rowOps);
        const rowBlock = insertedBlockFromOps(rowOps);
        const rowId = lamportToString(rowBlock.id);

        for (let columnIndex = 0; columnIndex < Math.max(1, size.columns); columnIndex++) {
            const existingCells = visibleBlockChildren(working, rowId, annotationVirtualParents(working));
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
    if (!row || row.meta.type !== 'table_row') return {state, ops: [], selection: caret(rowId, 0)};
    const config = annotationVirtualParents(state);
    const cells = visibleBlockChildren(state, rowId, config);
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

export const addTableRow = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
    context: CommandContext,
    afterRowId?: string,
): CommandResult => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') return {state, ops: [], selection: caret(tableId, 0)};
    const config = annotationVirtualParents(state);
    const rows = visibleBlockChildren(state, lamportToString(table.meta.rowParent), config);
    const columnCount = Math.max(1, ...rows.map((rowId) => visibleBlockChildren(state, rowId, config).length));
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    const afterIndex = afterRowId ? rows.indexOf(afterRowId) : -1;
    const previousRowId = afterIndex >= 0 ? rows[afterIndex] : rows[rows.length - 1] ?? null;
    const nextRowId = afterIndex >= 0 ? rows[afterIndex + 1] ?? null : null;
    const rowOps = insertBlockOps(working, {
        actor: context.actor,
        parent: table.meta.rowParent,
        before: previousRowId ? state.state.blocks[previousRowId].id : null,
        after: nextRowId ? state.state.blocks[nextRowId].id : null,
        meta: {type: 'table_row', ts: context.nextTs()},
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(working),
    });
    working = applyMany(working, rowOps, annotationVirtualParents(working));
    ops.push(...rowOps);
    const rowBlock = insertedBlockFromOps(rowOps);
    const rowId = lamportToString(rowBlock.id);
    let firstCellId: string | null = null;
    for (let index = 0; index < columnCount; index++) {
        const existingCells = visibleBlockChildren(working, rowId, annotationVirtualParents(working));
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
    const rows = visibleBlockChildren(state, lamportToString(table.meta.rowParent), annotationVirtualParents(state));
    const appendIndex = Math.max(0, ...rows.map((rowId) => visibleBlockChildren(state, rowId, annotationVirtualParents(state)).length));
    const targetIndex = columnIndex ?? appendIndex;
    const ops: Array<Op<RichBlockMeta>> = [];
    let working = state;
    let firstCellId: string | null = null;
    for (const rowId of rows) {
        const cells = visibleBlockChildren(working, rowId, annotationVirtualParents(working));
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
    if (!table || table.meta.type !== 'table' || !row || row.meta.type !== 'table_row') {
        return {state, ops: [], selection: caret(rowId, 0)};
    }
    const config = annotationVirtualParents(state);
    const rows = visibleBlockChildren(state, lamportToString(table.meta.rowParent), config);
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
        parent: table.meta.rowParent,
        before: beforeId ? state.state.blocks[beforeId].id : null,
        after: afterId ? state.state.blocks[afterId].id : null,
        ts: context.nextTs(),
        virtualParents: config,
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    const firstCellId = visibleBlockChildren(next, rowId, annotationVirtualParents(next))[0];
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
    const firstCellId = insertedRowId
        ? visibleBlockChildren(added.state, insertedRowId, annotationVirtualParents(added.state))[0]
        : null;
    return {...added, selection: caret(firstCellId ?? blockId, 0)};
};

export const moveTableCell = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
    target: {rowId: string; index: number},
    context: CommandContext,
): CommandResult => {
    const cell = tableCellContext(state, cellId);
    const targetRow = state.state.blocks[target.rowId];
    if (!cell || !targetRow || targetRow.meta.type !== 'table_row') {
        return {state, ops: [], selection: caret(cellId, 0)};
    }
    const sourceTable = state.state.blocks[cell.tableId];
    if (!sourceTable || sourceTable.meta.type !== 'table') {
        return {state, ops: [], selection: caret(cellId, 0)};
    }
    const targetPath = materializedBlockPath(state, target.rowId, annotationVirtualParents(state)).map(lamportToString);
    const targetTableId = targetPath[targetPath.length - 3];
    if (targetTableId !== cell.tableId) {
        return {state, ops: [], selection: caret(cellId, 0)};
    }

    const targetCells = visibleBlockChildren(state, target.rowId, annotationVirtualParents(state)).filter(
        (id) => id !== cellId,
    );
    const insertIndex = Math.max(0, Math.min(target.index, targetCells.length));
    const beforeId = insertIndex > 0 ? targetCells[insertIndex - 1] : null;
    const afterId = targetCells[insertIndex] ?? null;
    if (cell.rowId === target.rowId) {
        const currentCells = visibleBlockChildren(state, cell.rowId, annotationVirtualParents(state));
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
        ...rows.map((rowId) => visibleBlockChildren(state, rowId, annotationVirtualParents(state)).length),
    );
    const nextColumn = cell.columnIndex + 1;
    const cells = visibleBlockChildren(state, cell.rowId, annotationVirtualParents(state));
    if (nextColumn >= cells.length) {
        const added = addTableRow(state, cell.tableId, context, cell.rowId);
        const updatedRows = tableRows(added.state, cell.tableId);
        const insertedRowId = updatedRows[cell.rowIndex + 1] ?? updatedRows[updatedRows.length - 1] ?? null;
        const firstCellId = insertedRowId
            ? visibleBlockChildren(added.state, insertedRowId, annotationVirtualParents(added.state))[0]
            : null;
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
    rowParentId: string;
    rowId: string;
    rowIndex: number;
    columnIndex: number;
};

const tableCellContext = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
): TableCellContext | null => {
    const block = state.state.blocks[blockId];
    if (!block || block.meta.type === 'table_row') return null;
    const pathIds = materializedBlockPath(state, blockId, annotationVirtualParents(state)).map(lamportToString);
    const rowIndexInPath = pathIds.findLastIndex((id) => state.state.blocks[id]?.meta.type === 'table_row');
    if (rowIndexInPath < 2) return null;
    const rowId = pathIds[rowIndexInPath];
    const rowParentId = pathIds[rowIndexInPath - 1];
    const tableId = pathIds[rowIndexInPath - 2];
    if (state.state.blocks[tableId]?.meta.type !== 'table') return null;
    const rows = tableRows(state, tableId);
    const rowIndex = rows.indexOf(rowId);
    const cells = visibleBlockChildren(state, rowId, annotationVirtualParents(state));
    const columnIndex = cells.indexOf(blockId);
    if (rowIndex < 0 || columnIndex < 0) return null;
    return {tableId, rowParentId, rowId, rowIndex, columnIndex};
};

type TableRowContext = {
    tableId: string;
    rowParentId: string;
    rowId: string;
    rowIndex: number;
    rows: string[];
};

const tableRowContext = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
): TableRowContext | null => {
    const block = state.state.blocks[rowId];
    if (!block || block.meta.type !== 'table_row') return null;
    const pathIds = materializedBlockPath(state, rowId, annotationVirtualParents(state)).map(lamportToString);
    const rowIndexInPath = pathIds.findLastIndex((id) => id === rowId);
    if (rowIndexInPath < 2) return null;
    const rowParentId = pathIds[rowIndexInPath - 1];
    const tableId = pathIds[rowIndexInPath - 2];
    if (state.state.blocks[tableId]?.meta.type !== 'table') return null;
    const rows = tableRows(state, tableId);
    const rowIndex = rows.indexOf(rowId);
    if (rowIndex < 0) return null;
    return {tableId, rowParentId, rowId, rowIndex, rows};
};

const tableRows = (state: CachedState<RichBlockMeta>, tableId: string): string[] => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') return [];
    return visibleBlockChildren(state, lamportToString(table.meta.rowParent), annotationVirtualParents(state));
};

const tableColumnCount = (state: CachedState<RichBlockMeta>, tableId: string): number => {
    const rows = tableRows(state, tableId);
    return Math.max(
        1,
        ...rows.map((rowId) => visibleBlockChildren(state, rowId, annotationVirtualParents(state)).length),
    );
};

const areTableRowCellsEmpty = (state: CachedState<RichBlockMeta>, rowId: string): boolean => {
    const cells = visibleBlockChildren(state, rowId, annotationVirtualParents(state));
    return cells.length > 0 && cells.every((cellId) => pointTextLength(state, cellId) === 0);
};

const isEmptyTableRow = (state: CachedState<RichBlockMeta>, rowId: string): boolean => {
    return pointTextLength(state, rowId) === 0 && areTableRowCellsEmpty(state, rowId);
};

const createEmptyCellsForRow = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
    columnCount: number,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    const row = state.state.blocks[rowId];
    if (!row || row.meta.type !== 'table_row') return {state, ops: []};
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (let index = 0; index < columnCount; index++) {
        const existingCells = visibleBlockChildren(working, rowId, annotationVirtualParents(working));
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
        meta: paragraphMeta(ts),
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
        const cells = visibleBlockChildren(state, rows[rowIndex], annotationVirtualParents(state));
        const start = rowIndex === cell.rowIndex ? cell.columnIndex + 1 : 0;
        if (cells[start]) return cells[start];
    }
    return null;
};

const previousTableCellId = (state: CachedState<RichBlockMeta>, cell: TableCellContext): string | null => {
    const rows = tableRows(state, cell.tableId);
    for (let rowIndex = cell.rowIndex; rowIndex >= 0; rowIndex--) {
        const cells = visibleBlockChildren(state, rows[rowIndex], annotationVirtualParents(state));
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
    if (current.meta.type === 'table_row' && !isValidTableRowMoveTarget(state, movedBlockId, target)) {
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

const isValidTableRowMoveTarget = (
    state: CachedState<RichBlockMeta>,
    movedBlockId: string,
    target: MoveTarget,
): boolean => {
    if (target.type === 'child') return false;
    const targetBlock = state.state.blocks[target.targetBlockId];
    if (!targetBlock || targetBlock.meta.type !== 'table_row') return false;
    return visibleParentIdForBlock(state, movedBlockId) === visibleParentIdForBlock(state, target.targetBlockId);
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
    const owner = Object.values(state.state.blocks).find(
        (block) => block.meta.type === 'table' && lamportToString(block.meta.rowParent) === parentId,
    );
    return owner
        ? [...materializedBlockPath(state, lamportToString(owner.id), annotationVirtualParents(state)), parseLamportString(parentId)]
        : null;
};

const isDescendantOrSelf = (state: CachedState<RichBlockMeta>, blockId: string, ancestorId: string): boolean =>
    blockId === ancestorId || isDescendantOf(state, blockId, ancestorId);

const rawParentIdForVisibleBlock = (state: CachedState<RichBlockMeta>, blockId: string): string | null => {
    const block = state.state.blocks[blockId];
    if (!block) return null;
    if (block.meta.type === 'table_row') {
        return lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    }
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
    if (state.state.blocks[parentId]?.meta.type === 'table_row') {
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
    if (state.state.blocks[parentId]?.meta.type === 'table_row') {
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
    if (state.state.blocks[blockId]?.meta.type === 'table_row') {
        return {state, ops: [], selection: caret(blockId, 0)};
    }

    const previousBlockId = blocks[index - 1];
    if (state.state.blocks[previousBlockId]?.meta.type === 'table_row') {
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
        state.state.blocks[blockId]?.meta.type === 'table_row' ||
        state.state.blocks[nextBlockId]?.meta.type === 'table_row'
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

    const ops = insertTextOps(state, {
        actor: context.actor,
        block: parseLamportString(point.blockId),
        offset: point.offset,
        text,
        ts: context.nextTs,
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
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
    if (selection.type === 'caret') return null;

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

const selectionFullyHasMark = (
    state: CachedState<RichBlockMeta>,
    segments: ReturnType<typeof normalizeSelectionSegments>,
    markType: BooleanInlineMark,
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
