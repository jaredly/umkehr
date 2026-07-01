import {
    materializedBlockParent,
    materializedBlockPath,
} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import {lamportToString} from '../block-crdt/utils.js';
import {annotationVirtualParents} from './annotations.js';
import type {RichBlockMeta} from './blockMeta.js';
import {focusPoint, type EditorSelection} from './selectionModel.js';
import {
    isTableCellSelection,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
} from './tableSelectionPlugin.js';

export const tableCellIdForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string | null => {
    const point = focusPoint(selection);
    const path = materializedBlockPath(state, point.blockId, annotationVirtualParents(state)).map(
        lamportToString,
    );
    for (let index = path.length - 1; index >= 0; index--) {
        const blockId = path[index];
        if (isTableCellBlock(state, blockId)) return blockId;
    }
    return null;
};

export const tableCellSelectionForCell = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
): EditorSelection | null => {
    if (!isTableCellBlock(state, cellId)) return null;
    const rowId = lamportToString(materializedBlockParent(state, cellId, annotationVirtualParents(state)));
    const tableId = lamportToString(materializedBlockParent(state, rowId, annotationVirtualParents(state)));
    if (state.state.blocks[tableId]?.meta.type !== 'table') return null;
    return {
        type: 'table-cells',
        tableId,
        anchorCellId: cellId,
        focusCellId: cellId,
    };
};

export const isTableCellBlock = (state: CachedState<RichBlockMeta>, blockId: string): boolean => {
    const block = state.state.blocks[blockId];
    if (!block) return false;
    const rowId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    const row = state.state.blocks[rowId];
    if (!row || row.meta.type === 'table') return false;
    const tableId = lamportToString(materializedBlockParent(state, rowId, annotationVirtualParents(state)));
    return state.state.blocks[tableId]?.meta.type === 'table';
};

export const fullColumnSelectionCellIds = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    tableId: string,
): string[] | null => {
    if (!isTableCellSelection(selection) || selection.tableId !== tableId) return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle || rectangle.startColumnIndex !== rectangle.endColumnIndex) return null;
    const rows = tableRowsForSelection(state, tableId);
    if (
        rectangle.startRowIndex !== 0 ||
        rectangle.endRowIndex < rows.length - 1 ||
        rows.length === 0
    ) {
        return null;
    }
    const cellIds = rows
        .map((rowId) => tableCellsForSelection(state, rowId)[rectangle.startColumnIndex])
        .filter((cellId): cellId is string => Boolean(cellId));
    return cellIds.length === rows.length ? cellIds : null;
};

export const selectedTableRectangleSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    tableId: string,
): EditorSelection | null => {
    if (!isTableCellSelection(selection) || selection.tableId !== tableId) return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle || rectangle.cellIds.length <= 1) return null;
    if (fullColumnSelectionCellIds(state, selection, tableId)) return null;
    return selection;
};

export const tableCellRectangleSelectionForTextSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    tableId: string,
): EditorSelection | null => {
    if (selection.type !== 'range') return null;
    const anchorCell = tableCellIdForSelection(state, {
        type: 'caret',
        point: selection.anchor,
    });
    const focusCell = tableCellIdForSelection(state, {
        type: 'caret',
        point: selection.focus,
    });
    if (!anchorCell || !focusCell || anchorCell === focusCell) return null;
    const cellSelection: EditorSelection = {
        type: 'table-cells',
        tableId,
        anchorCellId: anchorCell,
        focusCellId: focusCell,
    };
    return isTableCellSelection(cellSelection) && tableCellRectangleForSelection(state, cellSelection)
        ? cellSelection
        : null;
};
