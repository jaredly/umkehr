import {
    Fragment,
    useLayoutEffect,
    useState,
    type CSSProperties,
    type ReactElement,
} from 'react';

import type {FormattedBlock} from '../../block-crdt/index.js';
import type {RichBlockMeta} from '../blockMeta.js';
import type {
    BlockEditorBlockRenderContext,
    BlockEditorBlockRenderer,
    BlockEditorRenderedBlockNode,
    BlockEditorTableCellDragState,
    BlockEditorTableCellSelectionDragState,
} from './types.js';
import type {EditorSelection} from '../selectionModel.js';

type TableNode = BlockEditorRenderedBlockNode<RichBlockMeta>;
type TableContext = BlockEditorBlockRenderContext<RichBlockMeta>;
type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

export const tableBlockRenderer: BlockEditorBlockRenderer<RichBlockMeta> = {
    id: 'render:table',
    blockType: 'table',
    children: 'renderer',
    render(node, context) {
        if (node.block.block.meta.type !== 'table') return null;
        return <TableBlock node={node} context={context} />;
    },
};

function TableBlock({node, context}: {node: TableNode; context: TableContext}) {
    const [cellDrag, setCellDrag] = useState<BlockEditorTableCellDragState | null>(null);
    const [cellSelectionDrag, setCellSelectionDrag] =
        useState<BlockEditorTableCellSelectionDragState | null>(null);
    const rowNodes = node.children;
    const columnCount = Math.max(
        1,
        ...rowNodes.map((row) => (row.block.block.meta.type === 'table' ? 0 : row.children.length)),
    );
    const selectedCellId = context.table.cellIdForSelection(context.table.currentSelection());

    useLayoutEffect(() => {
        if (!cellDrag) return;
        const onPointerMove = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const nextTarget = context.table.dragTargetFromPoint(
                event.clientX,
                event.clientY,
                node.block.id,
            );
            context.table.setCellDragBlockDropTarget(
                nextTarget?.kind === 'block-slot' ? nextTarget.dropTarget : null,
            );
            setCellDrag((current) => current ? {...current, target: nextTarget} : current);
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target =
                context.table.dragTargetFromPoint(event.clientX, event.clientY, node.block.id) ??
                cellDrag.target;
            const sourceCellId = cellDrag.sourceCellId;
            setCellDrag(null);
            context.table.setCellDragBlockDropTarget(null);
            if (!target) return;
            const rectangle = cellDrag.rectangleSelection
                ? context.table.rectangleForSelection(cellDrag.rectangleSelection)
                : null;
            const draggedCellIds = cellDrag.columnCellIds?.length
                ? cellDrag.columnCellIds
                : rectangle?.cellIds.length
                  ? rectangle.cellIds
                  : [sourceCellId];
            if (target.kind === 'row-slot') {
                context.table.moveCellsToNewRow(draggedCellIds, {
                    tableId: target.tableId,
                    beforeRowId: target.beforeRowId,
                    afterRowId: target.afterRowId,
                });
                return;
            }
            if (target.kind === 'block-slot') {
                const command = target.dropTarget.command;
                if (command.type === 'table-cell-slot') return;
                if (cellDrag.rectangleSelection) {
                    context.table.moveRectangleOutToNewTable(cellDrag.rectangleSelection, command);
                    return;
                }
                context.table.moveCellsOutAsBlocks(draggedCellIds, command);
                return;
            }
            if (cellDrag.rectangleSelection) {
                context.table.moveCellRectangleContents(cellDrag.rectangleSelection, target);
                return;
            }
            if (!cellDrag.columnCellIds?.length) {
                context.table.moveCell(sourceCellId, target);
                return;
            }
            context.table.moveColumnCells(cellDrag.columnCellIds, target.index);
        };
        const onPointerCancel = () => {
            setCellDrag(null);
            context.table.setCellDragBlockDropTarget(null);
        };
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [cellDrag, context, node.block.id]);

    useLayoutEffect(() => {
        if (!cellSelectionDrag) return;
        const selectCells = (focusCellId: string) => {
            const selection: EditorSelection = {
                type: 'table-cells',
                tableId: cellSelectionDrag.tableId,
                anchorCellId: cellSelectionDrag.anchorCellId,
                focusCellId,
            };
            context.table.selectCells(selection);
        };
        const onPointerMove = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target = context.table.cellElementFromPoint(event.clientX, event.clientY);
            const focusCellId = target?.dataset.cellId ?? null;
            if (!focusCellId || target?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId !== cellSelectionDrag.tableId) {
                return;
            }
            setCellSelectionDrag((current) => current ? {...current, focusCellId} : current);
            selectCells(focusCellId);
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            setCellSelectionDrag((current) => {
                if (current) selectCells(current.focusCellId);
                return null;
            });
        };
        const onPointerCancel = () => setCellSelectionDrag(null);
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [cellSelectionDrag, context]);

    const blockDropTarget = context.table.dropTarget();

    return (
        <div
            className="tableBlock"
            style={{'--block-depth': node.block.depth} as CSSProperties}
            data-table-id={node.block.id}
        >
            <div
                className="tableGrid"
                role="table"
                aria-label="Table block"
                style={{'--table-columns': columnCount} as CSSProperties}
            >
                <div className="tableTitleRow">{context.blocks.renderEditableBlock(node)}</div>
                <div
                    className="tableColumnInsertControls"
                    aria-label="Column insert controls"
                    style={{'--table-columns': columnCount} as CSSProperties}
                >
                    {Array.from({length: columnCount + 1}, (_, columnIndex) => (
                        <button
                            key={columnIndex}
                            type="button"
                            className="tableColumnInsert"
                            aria-label={`Add column ${columnIndex + 1}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => context.table.addColumn(node.block.id, columnIndex)}
                        >
                            +
                        </button>
                    ))}
                </div>
                {rowNodes.map((row, rowIndex) => (
                    <Fragment key={row.block.id}>
                        {row.block.block.meta.type === 'table' ? (
                            <div
                                ref={(element) => context.dragDrop.registerRow(row.block.id, element)}
                                className={tableRowClassNames({
                                    rowId: row.block.id,
                                    context,
                                    blockDropTarget,
                                    cellDrag,
                                    interstitial: true,
                                })}
                                role="row"
                                data-row-id={row.block.id}
                            >
                                <TableBlock node={{...row, block: {...row.block, depth: 0}}} context={context} />
                            </div>
                        ) : (
                            <div
                                ref={(element) => context.dragDrop.registerRow(row.block.id, element)}
                                className={tableRowClassNames({
                                    rowId: row.block.id,
                                    context,
                                    blockDropTarget,
                                    cellDrag,
                                    interstitial: false,
                                })}
                                role="row"
                                data-row-id={row.block.id}
                                style={{'--table-columns': columnCount} as CSSProperties}
                            >
                                <TableRowHeader row={row.block} rowIndex={rowIndex} context={context} />
                                {Array.from({length: columnCount}, (_, columnIndex) => {
                                    const cell = row.children[columnIndex] ?? null;
                                    const canStartCellDrag = !!cell && cell.block.id === selectedCellId;
                                    return (
                                        <TableCell
                                            key={`${row.block.id}:${columnIndex}`}
                                            tableId={node.block.id}
                                            rowId={row.block.id}
                                            columnIndex={columnIndex}
                                            cell={cell}
                                            context={context}
                                            selectedCellId={selectedCellId}
                                            canStartCellDrag={canStartCellDrag}
                                            cellDrag={cellDrag}
                                            blockDropTarget={blockDropTarget}
                                            onStartCellDrag={setCellDrag}
                                            onStartCellSelectionDrag={setCellSelectionDrag}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        <div
                            className="tableRowInsertControl"
                            aria-label={`Row ${rowIndex + 1} insert control`}
                            data-table-id={node.block.id}
                            data-after-row-id={row.block.id}
                            data-before-row-id={rowNodes[rowIndex + 1]?.block.id}
                        >
                            <button
                                type="button"
                                aria-label={`Add row after ${rowIndex + 1}`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => context.table.addRow(node.block.id, row.block.id)}
                            >
                                +
                            </button>
                        </div>
                    </Fragment>
                ))}
            </div>
        </div>
    );
}

function TableCell({
    tableId,
    rowId,
    columnIndex,
    cell,
    context,
    selectedCellId,
    canStartCellDrag,
    cellDrag,
    blockDropTarget,
    onStartCellDrag,
    onStartCellSelectionDrag,
}: {
    tableId: string;
    rowId: string;
    columnIndex: number;
    cell: TableNode | null;
    context: TableContext;
    selectedCellId: string | null;
    canStartCellDrag: boolean;
    cellDrag: BlockEditorTableCellDragState | null;
    blockDropTarget: ReturnType<TableContext['table']['dropTarget']>;
    onStartCellDrag(next: BlockEditorTableCellDragState): void;
    onStartCellSelectionDrag(next: BlockEditorTableCellSelectionDragState): void;
}) {
    return (
        <div
            className={tableCellClassNames({
                cellId: cell?.block.id ?? null,
                rowId,
                columnIndex,
                context,
                selectedCellId,
                canStartCellDrag,
                cellDrag,
                blockDropTarget,
            })}
            role="cell"
            data-cell-id={cell?.block.id}
            tabIndex={cell ? -1 : undefined}
            onCopy={context.table.onCopy}
            onCut={context.table.onCut}
            onPaste={context.table.onPaste}
            onKeyDown={(event) => {
                if (!cell || event.target !== event.currentTarget) return;
                context.table.onKeystroke(cell.block.id, event);
                const modifierPressed = event.metaKey || event.ctrlKey;
                const key = event.key.toLowerCase();
                if (modifierPressed && key === 'z' && event.shiftKey) {
                    event.preventDefault();
                    context.table.onRedo();
                } else if (modifierPressed && key === 'z') {
                    event.preventDefault();
                    context.table.onUndo();
                } else if (modifierPressed && key === 'y') {
                    event.preventDefault();
                    context.table.onRedo();
                }
            }}
            onPointerDown={(event) => {
                if (!cell || !context.table.isCellBorderPointer(event)) return;
                event.preventDefault();
                event.stopPropagation();
                if (cell.block.id !== selectedCellId) {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    const next = {
                        tableId,
                        anchorCellId: cell.block.id,
                        focusCellId: cell.block.id,
                    };
                    onStartCellSelectionDrag(next);
                    context.selection.focus({
                        type: 'table-cells',
                        tableId,
                        anchorCellId: cell.block.id,
                        focusCellId: cell.block.id,
                    });
                    const selection = context.table.cellSelectionForCell(cell.block.id);
                    if (selection) context.table.selectCells(selection);
                    return;
                }
                event.currentTarget.setPointerCapture?.(event.pointerId);
                context.selection.focus(context.table.currentSelection());
                const selectedColumnCellIds = context.table.fullColumnSelectionCellIds(
                    context.table.currentSelection(),
                    tableId,
                );
                const selectedRectangle =
                    context.table.selectedRectangleSelection(context.table.currentSelection(), tableId) ??
                    context.table.rectangleSelectionForTextSelection(context.table.currentSelection(), tableId);
                onStartCellDrag({
                    sourceCellId: cell.block.id,
                    ...(selectedColumnCellIds
                        ? {columnCellIds: selectedColumnCellIds}
                        : selectedRectangle
                          ? {rectangleSelection: selectedRectangle}
                          : {}),
                    target: {kind: 'cell-slot', rowId, index: columnIndex},
                });
            }}
        >
            {canStartCellDrag ? (
                <>
                    <span className="tableCellDragEdge tableCellDragEdgeLeft" aria-hidden="true" />
                    <span className="tableCellDragEdge tableCellDragEdgeRight" aria-hidden="true" />
                </>
            ) : null}
            {cell ? (
                renderTableCell(cell, context)
            ) : (
                <button
                    type="button"
                    aria-label="Add cell"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => context.table.createMissingCell(tableId, rowId, columnIndex)}
                >
                    +
                </button>
            )}
        </div>
    );
}

const renderTableCell = (node: TableNode, context: TableContext): ReactElement => {
    if (node.block.block.meta.type === 'table') {
        return <TableBlock node={node} context={context} />;
    }
    return (
        <>
            {context.blocks.renderEditableBlock({...node.block, depth: 0})}
            {node.children.length > 0 ? (
                <div className="tableCellChildren">
                    {node.children.map((child) =>
                        context.blocks.renderNodeAtRelativeDepth(child, node.block.depth + 1),
                    )}
                </div>
            ) : null}
        </>
    );
};

function TableRowHeader({
    row,
    rowIndex,
    context,
}: {
    row: RichFormattedBlock;
    rowIndex: number;
    context: TableContext;
}) {
    return (
        <div className="tableRowHeader" role="rowheader" aria-label={`Row ${rowIndex + 1} header`}>
            <button
                type="button"
                className="tableRowDrag"
                aria-label={`Move row ${rowIndex + 1}`}
                onPointerDown={(event) => {
                    context.dragDrop.startBlockDragFromHandle(row.id, event);
                }}
            >
                ⋮
            </button>
            {context.blocks.renderEditableBlock({...row, depth: 0}, {
                variant: 'table-row-header',
                ariaLabel: `Row header ${rowIndex + 1}`,
                placeholder: `${rowIndex + 1}`,
                surfaceClassName: 'tableRowHeaderText',
                hideBlockAffordance: true,
                hideInlineControls: true,
                registerBlockRow: false,
            })}
        </div>
    );
}

const tableRowClassNames = ({
    rowId,
    context,
    blockDropTarget,
    cellDrag,
    interstitial,
}: {
    rowId: string;
    context: TableContext;
    blockDropTarget: ReturnType<TableContext['table']['dropTarget']>;
    cellDrag: BlockEditorTableCellDragState | null;
    interstitial: boolean;
}): string =>
    [
        interstitial ? 'tableInterstitialRow' : 'tableRow',
        context.table.blockLevelDecoration(rowId)?.selected ? 'blockSelected' : '',
        context.table.blockLevelDecoration(rowId)?.focus ? 'blockSelectionFocus' : '',
        context.dragDrop.isDragging(rowId) ? 'dragging' : '',
        context.dragDrop.isDraggingRoot(rowId) ? 'draggingRoot' : '',
        blockDropTarget?.indicatorBlockId === rowId
            ? `drop${capitalize(blockDropTarget.indicatorPlacement)}`
            : '',
        cellDrag?.target?.kind === 'row-slot' && cellDrag.target.indicatorRowId === rowId
            ? `drop${capitalize(cellDrag.target.indicatorPlacement)}`
            : '',
    ].filter(Boolean).join(' ');

const tableCellClassNames = ({
    cellId,
    rowId,
    columnIndex,
    context,
    selectedCellId,
    canStartCellDrag,
    cellDrag,
    blockDropTarget,
}: {
    cellId: string | null;
    rowId: string;
    columnIndex: number;
    context: TableContext;
    selectedCellId: string | null;
    canStartCellDrag: boolean;
    cellDrag: BlockEditorTableCellDragState | null;
    blockDropTarget: ReturnType<TableContext['table']['dropTarget']>;
}): string =>
    [
        cellId ? 'tableCell' : 'tableCell missingTableCell',
        cellId && context.table.blockLevelDecoration(cellId)?.selected ? 'cellSelected' : '',
        cellId && context.table.blockLevelDecoration(cellId)?.focus ? 'cellSelectionFocus' : '',
        cellId === selectedCellId ? 'activeTableCell' : '',
        cellDrag?.sourceCellId === cellId ? 'draggingCell' : '',
        canStartCellDrag ? 'cellDragCandidate' : '',
        cellDrag?.target?.kind === 'cell-slot' &&
        cellDrag.target.rowId === rowId &&
        cellDrag.target.index === columnIndex
            ? 'cellDropBefore'
            : '',
        cellDrag?.target?.kind === 'cell-slot' &&
        cellDrag.target.rowId === rowId &&
        cellDrag.target.index === columnIndex + 1
            ? 'cellDropAfter'
            : '',
        blockDropTarget?.indicatorBlockId === cellId &&
        blockDropTarget?.indicatorPlacement === 'before'
            ? 'cellDropBefore'
            : '',
        blockDropTarget?.indicatorBlockId === cellId &&
        blockDropTarget?.indicatorPlacement === 'after'
            ? 'cellDropAfter'
            : '',
        blockDropTarget?.command.type === 'table-cell-slot' &&
        blockDropTarget.command.target.rowId === rowId &&
        blockDropTarget.command.target.index === columnIndex
            ? 'cellDropBefore'
            : '',
        blockDropTarget?.command.type === 'table-cell-slot' &&
        blockDropTarget.command.target.rowId === rowId &&
        blockDropTarget.command.target.index === columnIndex + 1
            ? 'cellDropAfter'
            : '',
    ].filter(Boolean).join(' ');

const capitalize = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value);
