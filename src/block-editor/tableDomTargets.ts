import type {
    BlockEditorTableCellDragTarget,
    BlockEditorTableCellSlotTarget,
} from './plugins/types.js';
import {blockDropTargetFromPoint} from './blockDropTargets.js';
import type {RichBlockMeta} from './blockMeta.js';
import type {FormattedBlock} from '../block-crdt/index.js';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

export const isCellBorderPointer = (
    event: Pick<PointerEvent, 'isPrimary' | 'button' | 'clientX' | 'clientY'> & {
        currentTarget: HTMLElement;
    },
): boolean => {
    if (!event.isPrimary || event.button !== 0) return false;
    const cellId = event.currentTarget.dataset.cellId ?? null;
    if (!cellId) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = 7;
    return (
        event.clientX - rect.left <= edge ||
        rect.right - event.clientX <= edge ||
        event.clientY - rect.top <= edge ||
        rect.bottom - event.clientY <= edge
    );
};

export const tableCellDragTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
    context: {blocks: RichFormattedBlock[]},
): BlockEditorTableCellDragTarget | null => {
    const cellSlot = tableCellSlotTargetFromPoint(clientX, clientY, tableId);
    if (cellSlot) return {kind: 'cell-slot', ...cellSlot};
    const rowSlot = tableRowSlotTargetFromPoint(clientX, clientY, tableId);
    if (rowSlot) return rowSlot;
    const blockSlot = blockDropTargetFromPoint(clientX, clientY, tableId, context);
    return blockSlot ? {kind: 'block-slot', dropTarget: blockSlot} : null;
};

export const tableCellSlotTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
): BlockEditorTableCellSlotTarget | null => {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const row = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>('[data-row-id]'))
        .find(
            (element): element is HTMLElement =>
                !!element?.dataset.rowId &&
                element.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === tableId,
        );
    if (!row) return null;
    const rowId = row.dataset.rowId;
    if (!rowId) return null;
    const cells = Array.from(row.children).filter(
        (child): child is HTMLElement =>
            child instanceof HTMLElement && child.matches('.tableCell[data-cell-id]'),
    );
    if (!cells.length) return {rowId, index: 0};
    const before = cells.findIndex((cell) => {
        const rect = cell.getBoundingClientRect();
        return clientX < rect.left + rect.width / 2;
    });
    return {rowId, index: before >= 0 ? before : cells.length};
};

export const tableRowSlotTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
): BlockEditorTableCellDragTarget | null => {
    const slot =
        typeof document.elementsFromPoint === 'function'
            ? document
                  .elementsFromPoint(clientX, clientY)
                  .find(
                      (element): element is HTMLElement =>
                          element instanceof HTMLElement &&
                          element.matches('.tableRowInsertControl[data-table-id]') &&
                          element.dataset.tableId === tableId,
                  )
            : null;
    if (slot) {
        const afterRowId = slot.dataset.afterRowId ?? null;
        const beforeRowId = slot.dataset.beforeRowId ?? null;
        return {
            kind: 'row-slot',
            tableId,
            beforeRowId: afterRowId,
            afterRowId: beforeRowId,
            indicatorRowId: afterRowId ?? beforeRowId ?? tableId,
            indicatorPlacement: afterRowId ? 'after' : 'before',
        };
    }

    const table = document.querySelector<HTMLElement>(`[data-table-id="${CSS.escape(tableId)}"]`);
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll<HTMLElement>('.tableRow[data-row-id]')).filter(
        (row) => row.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === tableId,
    );
    if (!rows.length) return null;
    const rowRects = rows.map((row) => ({row, rect: row.getBoundingClientRect()}));
    const first = rowRects[0];
    const last = rowRects[rowRects.length - 1];
    const edgeBand = 8;
    if (clientY >= first.rect.top - edgeBand && clientY < first.rect.top + edgeBand) {
        const rowId = first.row.dataset.rowId;
        return rowId
            ? {
                  kind: 'row-slot',
                  tableId,
                  beforeRowId: null,
                  afterRowId: rowId,
                  indicatorRowId: rowId,
                  indicatorPlacement: 'before',
              }
            : null;
    }
    for (let index = 0; index < rowRects.length - 1; index++) {
        const before = rowRects[index];
        const after = rowRects[index + 1];
        if (clientY >= before.rect.bottom - edgeBand && clientY <= after.rect.top + edgeBand) {
            const beforeRowId = before.row.dataset.rowId;
            const afterRowId = after.row.dataset.rowId;
            return beforeRowId && afterRowId
                ? {
                      kind: 'row-slot',
                      tableId,
                      beforeRowId,
                      afterRowId,
                      indicatorRowId: beforeRowId,
                      indicatorPlacement: 'after',
                  }
                : null;
        }
    }
    if (clientY > last.rect.bottom - edgeBand && clientY <= last.rect.bottom + edgeBand) {
        const rowId = last.row.dataset.rowId;
        return rowId
            ? {
                  kind: 'row-slot',
                  tableId,
                  beforeRowId: rowId,
                  afterRowId: null,
                  indicatorRowId: rowId,
                  indicatorPlacement: 'after',
              }
            : null;
    }
    return null;
};

export const tableCellElementFromPoint = (
    clientX: number,
    clientY: number,
): HTMLElement | null =>
    document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>('.tableCell[data-cell-id]'))
        .find((element): element is HTMLElement => !!element?.dataset.cellId) ?? null;

export const tableDragTargetAtPoint = tableCellDragTargetFromPoint;
export const tableElementAtPoint = tableCellElementFromPoint;
export const tableCellSlotAtPoint = tableCellSlotTargetFromPoint;
export const tableRowSlotAtPoint = tableRowSlotTargetFromPoint;
export const cellBorderPointerHit = isCellBorderPointer;
