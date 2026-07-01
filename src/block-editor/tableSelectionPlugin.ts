import {isDeleted, visibleBlockOutline} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta.js';
import type {BlockEditorSelectionPlugin, BlockEditorPlugin} from './plugins/types.js';
import type {BlockPoint, PluginEditorSelection, PluginRetainedSelection} from './selectionModel.js';
import type {BlockLevelSelectionDecorations} from './selectionSet.js';
import {richTextVirtualParents} from './virtualParents.js';

export type TableCellSelection = {
    type: 'table-cells';
    tableId: string;
    anchorCellId: string;
    focusCellId: string;
};

export type RetainedTableCellSelection = TableCellSelection;

export type TableCellPosition = {
    tableId: string;
    rowId: string;
    cellId: string;
    rowIndex: number;
    columnIndex: number;
};

export type TableCellRectangle = {
    tableId: string;
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
    cellIds: string[];
};

export const isTableCellSelection = (
    selection: {type: string; tableId?: unknown; anchorCellId?: unknown; focusCellId?: unknown},
): selection is TableCellSelection =>
    selection.type === 'table-cells' &&
    typeof selection.tableId === 'string' &&
    typeof selection.anchorCellId === 'string' &&
    typeof selection.focusCellId === 'string';

export const tableSelectionPlugin: BlockEditorSelectionPlugin<RichBlockMeta> = {
    id: 'table-cells',
    label: 'Table cells',
    retain: ({selection}) => normalizeTableSelection(selection),
    resolve: ({state, selection}) => resolveTableSelection(state, normalizeTableSelection(selection)),
    clamp: ({state, selection}) => clampTableSelection(state, normalizeTableSelection(selection)),
    focusPoint: ({selection}) => ({blockId: normalizeTableSelection(selection).focusCellId, offset: 0}),
    focusBlockId: ({selection}) => normalizeTableSelection(selection).focusCellId,
    firstPoint: ({selection}) => ({blockId: normalizeTableSelection(selection).anchorCellId, offset: 0}),
    selectedBlockIds: ({state, selection}) => selectedCellIdsForSelection(state, normalizeTableSelection(selection)),
    selectedTopLevelBlockIds: ({state, selection}) =>
        selectedTopLevelTableCellIdsForSelection(state, normalizeTableSelection(selection)),
    blockLevelDecorations: ({state, selection, primary}) =>
        tableCellBlockLevelDecorations(state, normalizeTableSelection(selection), primary),
    compare: ({state, one, two}) =>
        compareTableSelections(state, normalizeTableSelection(one), normalizeTableSelection(two)),
};

export const tableSelectionPluginBundle: BlockEditorPlugin<RichBlockMeta> = {
    id: 'table-selection',
    selectionTypes: [{id: 'table-cells', label: 'Table cells'}],
    selectionPlugins: [tableSelectionPlugin],
};

export const selectedCellIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
): string[] =>
    tableCellRectangleForSelection(state, selection)?.cellIds ?? [clampBlockId(state, selection.focusCellId)];

export const tableCellRectangleForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
): TableCellRectangle | null => {
    const anchor = tableCellPosition(state, selection.anchorCellId);
    const focus = tableCellPosition(state, selection.focusCellId);
    if (!anchor || !focus || anchor.tableId !== focus.tableId || anchor.tableId !== selection.tableId) {
        return null;
    }

    const startRowIndex = Math.min(anchor.rowIndex, focus.rowIndex);
    const endRowIndex = Math.max(anchor.rowIndex, focus.rowIndex);
    const startColumnIndex = Math.min(anchor.columnIndex, focus.columnIndex);
    const endColumnIndex = Math.max(anchor.columnIndex, focus.columnIndex);
    const rows = tableRowsForSelection(state, anchor.tableId);
    const cellIds: string[] = [];
    for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
        const rowId = rows[rowIndex];
        if (!rowId) continue;
        const cells = tableCellsForSelection(state, rowId);
        for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
            const cellId = cells[columnIndex];
            if (cellId) cellIds.push(cellId);
        }
    }

    return {
        tableId: anchor.tableId,
        startRowIndex,
        endRowIndex,
        startColumnIndex,
        endColumnIndex,
        cellIds,
    };
};

export const tableCellPosition = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
): TableCellPosition | null => {
    const outline = visibleBlockOutline(state, richTextVirtualParents(state));
    const stack: typeof outline = [];
    const rowsByTable = new Map<string, string[]>();
    for (const block of outline) {
        while (stack.length && stack[stack.length - 1].depth >= block.depth) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        const grandparent = stack[stack.length - 2];
        if (parent && grandparent && state.state.blocks[grandparent.id]?.meta.type === 'table') {
            const rowId = parent.id;
            const tableId = grandparent.id;
            const rows = rowsByTable.get(tableId) ?? tableRowsForSelection(state, tableId);
            rowsByTable.set(tableId, rows);
            const cells = tableCellsForSelection(state, rowId);
            if (block.id === cellId) {
                return {
                    tableId,
                    rowId,
                    cellId,
                    rowIndex: rows.indexOf(rowId),
                    columnIndex: cells.indexOf(cellId),
                };
            }
        }
        stack.push(block);
    }
    return null;
};

export const tableRowsForSelection = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
): string[] => {
    const outline = visibleBlockOutline(state, richTextVirtualParents(state));
    const tableIndex = outline.findIndex((block) => block.id === tableId);
    if (tableIndex < 0 || state.state.blocks[tableId]?.meta.type !== 'table') return [];
    const tableDepth = outline[tableIndex].depth;
    const rows: string[] = [];
    for (let index = tableIndex + 1; index < outline.length; index++) {
        const block = outline[index];
        if (block.depth <= tableDepth) break;
        if (block.depth === tableDepth + 1 && state.state.blocks[block.id]?.meta.type !== 'table') {
            rows.push(block.id);
        }
    }
    return rows;
};

export const tableCellsForSelection = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
): string[] => {
    const outline = visibleBlockOutline(state, richTextVirtualParents(state));
    const rowIndex = outline.findIndex((block) => block.id === rowId);
    if (rowIndex < 0 || state.state.blocks[rowId]?.meta.type === 'table') return [];
    const rowDepth = outline[rowIndex].depth;
    const cells: string[] = [];
    for (let index = rowIndex + 1; index < outline.length; index++) {
        const block = outline[index];
        if (block.depth <= rowDepth) break;
        if (block.depth === rowDepth + 1) cells.push(block.id);
    }
    return cells;
};

const normalizeTableSelection = (selection: PluginEditorSelection | PluginRetainedSelection): TableCellSelection => {
    if (isTableCellSelection(selection)) return selection;
    return {
        type: 'table-cells',
        tableId: stringField(selection, 'tableId'),
        anchorCellId: stringField(selection, 'anchorCellId'),
        focusCellId: stringField(selection, 'focusCellId'),
    };
};

const stringField = (selection: PluginEditorSelection | PluginRetainedSelection, key: string): string =>
    typeof selection[key] === 'string' ? selection[key] : '';

const clampTableSelection = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
): TableCellSelection => ({
    type: 'table-cells',
    tableId: clampBlockId(state, selection.tableId),
    anchorCellId: clampBlockId(state, selection.anchorCellId),
    focusCellId: clampBlockId(state, selection.focusCellId),
});

export const retainTableCellSelection = (selection: TableCellSelection): RetainedTableCellSelection => selection;

export const clampTableCellSelection = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
): TableCellSelection => clampTableSelection(state, selection);

const resolveTableSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedTableCellSelection,
): TableCellSelection => ({
    type: 'table-cells',
    tableId: resolveBlockId(state, selection.tableId),
    anchorCellId: resolveBlockId(state, selection.anchorCellId),
    focusCellId: resolveBlockId(state, selection.focusCellId),
});

export const resolveTableCellSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedTableCellSelection,
): TableCellSelection => resolveTableSelection(state, selection);

const selectedTopLevelTableCellIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
): string[] => selectedCellIdsForSelection(state, selection);

const tableCellBlockLevelDecorations = (
    state: CachedState<RichBlockMeta>,
    selection: TableCellSelection,
    primary: boolean,
): Map<string, BlockLevelSelectionDecorations> => {
    const result = new Map<string, BlockLevelSelectionDecorations>();
    const focusId = selection.focusCellId;
    for (const cellId of selectedCellIdsForSelection(state, selection)) {
        result.set(cellId, {
            selected: true,
            primary,
            focus: cellId === focusId,
        });
    }
    return result;
};

const compareTableSelections = (
    state: CachedState<RichBlockMeta>,
    one: TableCellSelection,
    two: TableCellSelection,
): number => comparePoints(state, {blockId: one.anchorCellId, offset: 0}, {blockId: two.anchorCellId, offset: 0});

const comparePoints = (state: CachedState<RichBlockMeta>, one: BlockPoint, two: BlockPoint): number => {
    const blocks = visibleBlockOutline(state, richTextVirtualParents(state)).map((block) => block.id);
    const oneBlock = blocks.indexOf(one.blockId);
    const twoBlock = blocks.indexOf(two.blockId);
    return oneBlock - twoBlock || one.offset - two.offset;
};

const clampBlockId = (state: CachedState<RichBlockMeta>, blockId: string): string => {
    const block = state.state.blocks[blockId];
    if (block && !isDeleted(block) && !state.cache.joinedBlocks[blockId]) return blockId;
    return visibleBlockOutline(state, richTextVirtualParents(state))[0]?.id ?? blockId;
};

const resolveBlockId = (state: CachedState<RichBlockMeta>, blockId: string): string => {
    const block = state.state.blocks[blockId];
    if (block && !isDeleted(block) && !state.cache.joinedBlocks[blockId]) return blockId;
    return visibleBlockOutline(state, richTextVirtualParents(state))[0]?.id ?? blockId;
};
