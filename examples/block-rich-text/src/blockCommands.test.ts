import {describe, expect, it} from 'vitest';
import {
    applyMany,
    blockContents,
    cachedState,
    insertBlockOps,
    materializedBlockParent,
    materializeFormattedBlocks,
    organizeState,
    rootBlockIds,
    visibleBlockChildren,
    visibleBlockOutline,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    deleteBackward,
    deleteEmptyTableRowBackward,
    deleteForward,
    exitEmptyLastTableRow,
    advanceFromTableCellEnd,
    addTableRow,
    commandApplied,
    createMissingTableCell,
    createTable,
    indentBlock,
    insertText,
    moveBlock,
    moveTableCell,
    moveTableCellByTab,
    moveTableRow,
    pastePlainText,
    removeLinkMark,
    setBlockType,
    setLinkMark,
    splitBlock,
    splitTableTitleToParagraph,
    toggleMark,
    unindentBlock,
    type CommandContext,
} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext, toggleOnline} from './blockEditorRuntime';
import {annotationVirtualParents, createAnnotation} from './annotations';
import type {RichBlockMeta} from './blockMeta';
import {toggleMarkEverywhere} from './multiSelectionCommands';
import {retainSelection} from './retainedSelection';
import {caret, focusPoint, pointTextLength, type EditorSelection} from './selectionModel';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: CachedState) => rootBlockIds(state)[0];

const lines = (state: CachedState) => rootBlockIds(state).map((id) => blockContents(state, id));

const outline = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => ({
        text: blockContents(state, block.id),
        depth: block.depth,
    }));

const expectCache = (state: CachedState) => {
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars, state.state.joins));
};

const tableShape = (state: CachedState<RichBlockMeta>, tableId: string) => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') throw new Error(`table ${tableId} not found`);
    const rows = visibleBlockChildren(state, lamportToString(table.meta.rowParent), annotationVirtualParents(state));
    return {
        table,
        rows,
        cells: rows.map((rowId) => visibleBlockChildren(state, rowId, annotationVirtualParents(state))),
    };
};

describe('block rich text commands', () => {
    it('syncs metadata command updates to the peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = setBlockType(demo.left.state, blockId, {type: 'heading', level: 2, ts: '00001'});

        const synced = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });

        expect(synced.left.state.state.blocks[blockId].meta).toEqual({type: 'heading', level: 2, ts: '00001'});
        expect(synced.right.state.state.blocks[blockId].meta).toEqual({type: 'heading', level: 2, ts: '00001'});
    });

    it('creates a table block with a virtual row parent, rows, and cells', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), ctx(), {rows: 2, columns: 3});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);

        expect(shape.table.meta.type).toBe('table');
        expect(shape.rows).toHaveLength(2);
        expect(shape.cells.map((row) => row.length)).toEqual([3, 3]);
        expect(shape.rows.every((rowId) => result.state.state.blocks[rowId].meta.type === 'table_row')).toBe(true);
        expect(shape.cells.flat().every((cellId) => result.state.state.blocks[cellId].meta.type === 'paragraph')).toBe(true);
    });

    it('orders table rows by normal block order under the row virtual parent', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const before = tableShape(result.state, tableId).rows;

        result = moveTableRow(result.state, tableId, before[1], 'up', context);

        expect(tableShape(result.state, tableId).rows).toEqual([before[1], before[0]]);
    });

    it('keeps normal children under a table block outside the row grid', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), ctx(), {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const tableChildren = visibleBlockChildren(result.state, tableId, annotationVirtualParents(result.state));
        const previousChild = tableChildren[tableChildren.length - 1] ?? null;
        const ops = insertBlockOps(result.state, {
            actor: 'left',
            parent: result.state.state.blocks[tableId].id,
            before: previousChild ? result.state.state.blocks[previousChild].id : null,
            meta: {type: 'paragraph', ts: '00050'},
            ts: '00051',
            virtualParents: annotationVirtualParents(result.state),
        });
        const state = applyMany(result.state, ops, annotationVirtualParents(result.state));

        const outline = visibleBlockOutline(state, annotationVirtualParents(state));
        const normalChild = ops[0].type === 'block' ? lamportToString(ops[0].block.id) : '';
        expect(outline.find((entry) => entry.id === normalChild)).toMatchObject({
            parentId: tableId,
            depth: 1,
        });
        expect(tableShape(state, tableId).rows).toHaveLength(1);
    });

    it('creates sparse missing cells at the clicked column position', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        result = addTableRow(result.state, tableId, context);
        const shape = tableShape(result.state, tableId);

        result = createMissingTableCell(result.state, shape.rows[0], 1, context);

        expect(tableShape(result.state, tableId).cells.map((row) => row.length)).toEqual([2, 1]);
    });

    it('allows a cell block to become a nested table', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const cellId = tableShape(result.state, tableId).cells[0][0];

        result = createTable(result.state, caret(cellId, 0), context, {rows: 1, columns: 2});

        expect(result.state.state.blocks[cellId].meta.type).toBe('table');
        expect(tableShape(result.state, cellId).cells[0]).toHaveLength(2);
    });

    it('syncs row reordering across replicas', () => {
        let demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });
        const tableId = rootBlockIds(demo.left.state)[1];
        const rows = tableShape(demo.left.state, tableId).rows;

        result = moveTableRow(demo.left.state, tableId, rows[1], 'up', context);
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });

        expect(tableShape(demo.right.state, tableId).rows).toEqual(tableShape(demo.left.state, tableId).rows);
    });

    it('keeps Tab navigation working after generic row drag reorder', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const rows = tableShape(result.state, tableId).rows;

        result = moveBlock(result.state, rows[1], {type: 'before', targetBlockId: rows[0]}, context);
        const shape = tableShape(result.state, tableId);
        expect(shape.rows).toEqual([rows[1], rows[0]]);

        result = moveTableCellByTab(result.state, shape.cells[0][1], 'forward', context);

        expect(result.selection).toEqual(caret(shape.cells[1][0], 0));
    });

    it('refuses to move rows under other rows as children', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const rows = tableShape(result.state, tableId).rows;

        result = moveBlock(result.state, rows[1], {type: 'child', parentBlockId: rows[0], at: 'end'}, context);

        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).rows).toEqual(rows);
    });

    it('moves across table cells with Tab and creates a row at the final cell', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];

        result = moveTableCellByTab(result.state, firstCell, 'forward', context);
        expect(result.selection).toEqual(caret(secondCell, 0));

        result = moveTableCellByTab(result.state, secondCell, 'backward', context);
        expect(result.selection).toEqual(caret(firstCell, 0));

        result = moveTableCellByTab(result.state, secondCell, 'forward', context);
        const shape = tableShape(result.state, tableId);
        expect(shape.rows).toHaveLength(2);
        expect(shape.cells[1]).toHaveLength(2);
        expect(result.selection).toEqual(caret(shape.cells[1][0], 0));
    });

    it('advances from a cell end into an empty cell to the right on Enter', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);

        const advanced = advanceFromTableCellEnd(
            result.state,
            caret(firstCell, pointTextLength(result.state, firstCell)),
            context,
        );

        expect(advanced).toMatchObject({ops: [], selection: caret(secondCell, 0)});
    });

    it('creates a new row on Enter at the end of a row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        result = createMissingTableCell(result.state, shape.rows[1], 1, context);
        shape = tableShape(result.state, tableId);
        const firstRowCell = shape.cells[0][0];
        result = insertText(result.state, caret(firstRowCell, 0), 'one', context);

        const advanced = advanceFromTableCellEnd(
            result.state,
            caret(firstRowCell, pointTextLength(result.state, firstRowCell)),
            context,
        );

        expect(advanced).not.toBeNull();
        if (!advanced) return;
        const nextShape = tableShape(advanced.state, tableId);
        expect(nextShape.rows).toHaveLength(3);
        expect(nextShape.rows[1]).not.toBe(shape.rows[1]);
        expect(nextShape.cells[1]).toHaveLength(2);
        expect(advanced.selection).toEqual(caret(nextShape.cells[1][0], 0));
    });

    it('joins cells in the same row but blocks accidental joins across rows', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [rowOneA, rowOneB] = shape.cells[0];
        const [rowTwoA, rowTwoB] = shape.cells[1];
        result = insertText(result.state, caret(rowOneA, 0), 'A', context);
        result = insertText(result.state, caret(rowOneB, 0), 'B', context);
        result = insertText(result.state, caret(rowTwoA, 0), 'C', context);

        result = deleteBackward(result.state, caret(rowOneB, 0), context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([rowOneA]);
        expect(blockContents(result.state, rowOneA)).toBe('AB');

        result = deleteBackward(result.state, caret(rowTwoA, 0), context);
        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).cells[1]).toEqual([rowTwoA, rowTwoB]);

        result = deleteForward(result.state, caret(rowOneA, pointTextLength(result.state, rowOneA)), context);
        expect(result.ops).toEqual([]);
    });

    it('moves Backspace at a non-first empty cell start to the previous cell end', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);

        const moved = deleteEmptyTableRowBackward(result.state, caret(secondCell, 0), context);

        expect(moved).toMatchObject({ops: [], selection: caret(firstCell, 3)});
    });

    it('deletes an all-empty table row on Backspace at the first cell start', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][1], 0), 'prev', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(shape.cells[1][0], 0), context);
        if (!('state' in deleted)) throw new Error('expected delete command');

        expect(tableShape(deleted.state, tableId).rows).toEqual([shape.rows[0]]);
        expect(deleted.selection).toEqual(caret(shape.cells[0][1], 4));
    });

    it('does not delete a row on Backspace when any row cell has content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[1][1], 0), 'x', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(shape.cells[1][0], 0), context);

        expect(commandApplied(deleted)).toBe(false);
    });

    it('converts a table to a paragraph when Backspace deletes its only empty row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [row] = tableShape(result.state, tableId).rows;

        const converted = deleteEmptyTableRowBackward(
            result.state,
            caret(tableShape(result.state, tableId).cells[0][0], 0),
            context,
        );
        if (!('state' in converted)) throw new Error('expected convert command');

        expect(converted.state.state.blocks[tableId].meta).toMatchObject({type: 'paragraph'});
        expect(converted.state.state.blocks[row].deleted).toBe(true);
        expect(converted.selection).toEqual(caret(tableId, 0));
    });

    it('exits an empty last table row on Enter by creating a paragraph after the table', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][0], 0), 'keep', context);

        const exited = exitEmptyLastTableRow(result.state, caret(shape.cells[1][0], 0), context);
        if (!('state' in exited)) throw new Error('expected exit command');

        expect(tableShape(exited.state, tableId).rows).toEqual([shape.rows[0]]);
        const roots = rootBlockIds(exited.state);
        expect(roots[roots.indexOf(tableId) + 1]).toBe(exited.selection.type === 'caret' ? exited.selection.point.blockId : '');
        expect(exited.state.state.blocks[focusPoint(exited.selection).blockId].meta).toMatchObject({type: 'paragraph'});
    });

    it('does not exit the only table row on Enter', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const cellId = tableShape(result.state, tableId).cells[0][0];

        const exited = exitEmptyLastTableRow(result.state, caret(cellId, 0), context);

        expect(commandApplied(exited)).toBe(false);
    });

    it('splits a table title into a following paragraph with trailing text', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        result = insertText(result.state, caret(tableId, 0), 'AlphaBeta', context);

        const split = splitTableTitleToParagraph(result.state, caret(tableId, 5), context);
        if (!('state' in split)) throw new Error('expected split command');

        const roots = rootBlockIds(split.state);
        const paragraphId = roots[roots.indexOf(tableId) + 1];
        expect(blockContents(split.state, tableId)).toBe('Alpha');
        expect(blockContents(split.state, paragraphId)).toBe('Beta');
        expect(split.state.state.blocks[paragraphId].meta).toMatchObject({type: 'paragraph'});
        expect(split.selection).toEqual(caret(paragraphId, 0));
    });

    it('moves table cells within and across rows with splice semantics', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 3});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [a, b, c] = shape.cells[0];
        const [d, e, f] = shape.cells[1];

        result = moveTableCell(result.state, a, {rowId: shape.rows[0], index: 2}, context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([b, c, a]);

        result = moveTableCell(result.state, e, {rowId: shape.rows[0], index: 1}, context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([b, e, c, a]);
        expect(shape.cells[1]).toEqual([d, f]);
    });

    it('does not indent table cells out of their structural rows', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [, secondCell] = tableShape(result.state, tableId).cells[0];

        result = indentBlock(result.state, secondCell, context);

        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).cells[0]).toContain(secondCell);
    });

    it('applies multi-selection marks across table cells', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);
        result = insertText(result.state, caret(secondCell, 0), 'two', context);

        const marked = toggleMarkEverywhere(
            result.state,
            {
                primaryId: 'one',
                entries: [
                    {
                        id: 'one',
                        selection: retainSelection(result.state, {
                            type: 'range',
                            anchor: {blockId: firstCell, offset: 0},
                            focus: {blockId: firstCell, offset: 3},
                        }),
                    },
                    {
                        id: 'two',
                        selection: retainSelection(result.state, {
                            type: 'range',
                            anchor: {blockId: secondCell, offset: 0},
                            focus: {blockId: secondCell, offset: 3},
                        }),
                    },
                ],
            },
            'bold',
            context,
        );

        const formatted = materializeFormattedBlocks(marked.state, annotationVirtualParents(marked.state));
        expect(formatted.find((block) => block.id === firstCell)?.runs).toEqual([
            {text: 'one', marks: {bold: true}},
        ]);
        expect(formatted.find((block) => block.id === secondCell)?.runs).toEqual([
            {text: 'two', marks: {bold: true}},
        ]);
    });

    it('turns empty non-paragraph Enter into paragraph metadata', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const typed = setBlockType(demo.left.state, blockId, {type: 'blockquote', ts: '00001'});

        const result = splitBlock(typed.state, caret(blockId, 0), ctx());

        expect(rootBlockIds(result.state)).toHaveLength(1);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'paragraph'});
    });

    it('preserves metadata on non-empty splits', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'Title', ctx());
        result = setBlockType(result.state, blockId, {type: 'heading', level: 1, ts: '00010'});

        result = splitBlock(result.state, caret(blockId, 2), ctx());

        const [first, second] = rootBlockIds(result.state);
        expect(result.state.state.blocks[first].meta).toMatchObject({type: 'heading', level: 1});
        expect(result.state.state.blocks[second].meta).toMatchObject({type: 'heading', level: 1});
        expect(lines(result.state)).toEqual(['Ti', 'tle']);
    });

    it('inserts newline text instead of splitting code blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});

        result = splitBlock(result.state, caret(blockId, 1), ctx());

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(lines(result.state)).toEqual(['a\nb']);
    });

    it('exits a code block on Enter at a trailing blank line', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});
        result = splitBlock(result.state, caret(blockId, 2), ctx());

        result = splitBlock(result.state, result.selection, ctx());

        const [code, paragraph] = rootBlockIds(result.state);
        expect(result.selection).toEqual(caret(paragraph, 0));
        expect(lines(result.state)).toEqual(['ab', '']);
        expect(result.state.state.blocks[code].meta).toMatchObject({type: 'code'});
        expect(result.state.state.blocks[paragraph].meta).toMatchObject({type: 'paragraph'});
    });

    it('keeps Shift+Enter as a newline inside code blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});
        result = splitBlock(result.state, caret(blockId, 2), ctx());

        result = splitBlock(result.state, result.selection, ctx(), {forceCodeNewline: true});

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(lines(result.state)).toEqual(['ab\n\n']);
    });

    it('inserts text and deletes ordinary backspace inside a block', () => {
        let state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        let result = insertText(state, caret(blockId, 0), 'abc', context);
        expect(lines(result.state)).toEqual(['abc']);
        expect(result.selection).toEqual(caret(blockId, 3));

        result = deleteBackward(result.state, caret(blockId, 2), context);
        expect(lines(result.state)).toEqual(['ac']);
        expect(result.selection).toEqual(caret(blockId, 1));
        expectCache(result.state);
    });

    it('calculates middle Backspace deletion and caret shift without DOM state', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteBackward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['acd']);
        expect(result.selection).toEqual(caret(blockId, 1));

        result = insertText(result.state, result.selection, 'X', context);

        expect(lines(result.state)).toEqual(['aXcd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('calculates middle Delete deletion without moving the caret', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteForward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['abd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('splits at start, middle, and end', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', context);
        const blockId = onlyBlock(result.state);

        result = splitBlock(result.state, caret(blockId, 3), context);
        expect(lines(result.state)).toEqual(['abc', 'def']);

        const first = rootBlockIds(result.state)[0];
        result = splitBlock(result.state, caret(first, 0), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def']);

        const last = rootBlockIds(result.state)[2];
        result = splitBlock(result.state, caret(last, 3), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def', '']);
        expectCache(result.state);
    });

    it('joins with the previous block on backspace at block start', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const second = rootBlockIds(result.state)[1];

        result = deleteBackward(result.state, caret(second, 0), context);
        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(rootBlockIds(result.state)[0], 3));
        expectCache(result.state);
    });

    it('joins with the next block on Delete at block end', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const first = rootBlockIds(result.state)[0];

        result = deleteForward(result.state, caret(first, 3), context);

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(first, 3));
        expectCache(result.state);
    });

    it('joins blocks after Backspace deletes a cross-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 2},
            focus: {blockId: second, offset: 1},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('joins blocks after Delete deletes a cross-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 2},
            focus: {blockId: second, offset: 1},
        };

        result = deleteForward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('joins a boundary-only cross-block selection', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 3},
            focus: {blockId: second, offset: 0},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(first, 3));
        expectCache(result.state);
    });

    it('joins cross-block selection even when the first block is fully selected', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 0},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['two']);
        expect(result.selection).toEqual(caret(first, 0));
        expectCache(result.state);
    });

    it('joins every visible boundary in a three-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd\nef', context);
        const [first, , third] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 1},
            focus: {blockId: third, offset: 1},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['af']);
        expect(result.selection).toEqual(caret(first, 1));
        expectCache(result.state);
    });

    it('joins a reversed cross-block selection', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: second, offset: 1},
            focus: {blockId: first, offset: 2},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('splits pasted newlines into blocks', () => {
        const state = init();
        const result = pastePlainText(state, caret(onlyBlock(state), 0), 'a\nb\n', ctx());

        expect(lines(result.state)).toEqual(['a', 'b', '']);
        expectCache(result.state);
    });

    it('toggles bold over a multi-block selection using per-block marks', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 2},
        };

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {bold: true}}],
            [{text: 'cd', marks: {bold: true}}],
        ]);

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {}}],
            [{text: 'cd', marks: {}}],
        ]);
        expectCache(result.state);
    });

    it('toggles strikethrough over a range', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'strike', context);
        const blockId = onlyBlock(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 0},
            focus: {blockId, offset: 6},
        };

        result = toggleMark(result.state, selection, 'strikethrough', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'strike', marks: {strikethrough: true}}],
        ]);

        result = toggleMark(result.state, selection, 'strikethrough', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'strike', marks: {}}],
        ]);
    });

    it('sets, updates, and removes non-stacking link marks', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'link', context);
        const blockId = onlyBlock(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 0},
            focus: {blockId, offset: 4},
        };

        result = setLinkMark(result.state, selection, 'https://one.test', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {link: 'https://one.test'}}],
        ]);

        result = setLinkMark(result.state, selection, 'https://two.test', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {link: 'https://two.test'}}],
        ]);
        expect(materializeFormattedBlocks(result.state)[0].runs[0].stackedMarks?.link).toBeUndefined();

        result = removeLinkMark(result.state, selection, context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {}}],
        ]);
    });

    it('sets links over a multi-block selection using per-block marks', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 2},
        };

        result = setLinkMark(result.state, selection, 'https://example.test', context);

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {link: 'https://example.test'}}],
            [{text: 'cd', marks: {link: 'https://example.test'}}],
        ]);
    });

    it('moves root blocks with a block:move op', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, , third] = rootBlockIds(result.state);

        result = moveBlock(result.state, first, {type: 'after', targetBlockId: third}, context);
        expect(lines(result.state)).toEqual(['b', 'c', 'a']);
        expectCache(result.state);
    });

    it('moves a peer-created second root block before the first root block', () => {
        let demo = createDemoState();
        const first = onlyBlock(demo.left.state);
        const pasted = pastePlainText(demo.left.state, caret(first, 0), 'a\nb', makeCommandContext(demo.left));
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: pasted.state,
            selection: demo.left.selection,
            ops: pasted.ops,
        });
        const [rightFirst, rightSecond] = rootBlockIds(demo.right.state);

        const moved = moveBlock(
            demo.right.state,
            rightSecond,
            {type: 'before', targetBlockId: rightFirst},
            makeCommandContext(demo.right),
        );

        expect(lines(moved.state)).toEqual(['b', 'a']);
        expect(moved.ops).toHaveLength(1);
        expectCache(moved.state);
    });

    it('moves a peer-created third root block before the first root block on the first attempt', () => {
        let demo = createDemoState();
        const first = onlyBlock(demo.left.state);
        const pasted = pastePlainText(demo.left.state, caret(first, 0), 'a\nb\nc', makeCommandContext(demo.left));
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: pasted.state,
            selection: demo.left.selection,
            ops: pasted.ops,
        });
        const [rightFirst, , rightThird] = rootBlockIds(demo.right.state);

        const moved = moveBlock(
            demo.right.state,
            rightThird,
            {type: 'before', targetBlockId: rightFirst},
            makeCommandContext(demo.right),
        );

        expect(lines(moved.state)).toEqual(['c', 'a', 'b']);
        expect(moved.ops).toHaveLength(1);
        expectCache(moved.state);
    });

    it('moves a root block as the first child of an empty block', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [first, second] = rootBlockIds(result.state);

        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, second)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a root block as the last child of a parent with children', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        result = moveBlock(result.state, third, {type: 'child', parentBlockId: first, at: 'end'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a nested block back to root', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        result = moveBlock(result.state, second, {type: 'after', targetBlockId: third}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 0},
            {text: 'b', depth: 0},
        ]);
        expect(materializedBlockParent(result.state, second)).toEqual([0, 'root']);
        expectCache(result.state);
    });

    it('moves a nested block under another nested parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: first, at: 'end'}, context);

        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: third, at: 'start'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 2},
        ]);
        expect(materializedBlockParent(result.state, fourth)).toEqual(result.state.state.blocks[third].id);
        expectCache(result.state);
    });

    it('moves a parent with children as one subtree', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);

        result = moveBlock(result.state, second, {type: 'after', targetBlockId: fourth}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'd', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual(result.state.state.blocks[second].id);
        expectCache(result.state);
    });

    it('rejects invalid and no-op block moves', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        const base = result.state;

        expect(moveBlock(base, first, {type: 'child', parentBlockId: first, at: 'start'}, context).ops).toEqual([]);
        expect(moveBlock(base, first, {type: 'child', parentBlockId: third, at: 'start'}, context).ops).toEqual([]);
        expect(moveBlock(base, first, {type: 'before', targetBlockId: second}, context).ops).toEqual([]);
        expect(moveBlock(base, second, {type: 'child', parentBlockId: first, at: 'start'}, context).ops).toEqual([]);
        expectCache(base);
    });

    it('moves children that are visibly spliced through a joined parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = deleteForward(result.state, caret(first, 1), context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
        ]);

        result = moveBlock(result.state, fourth, {type: 'before', targetBlockId: third}, context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'd', depth: 1},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, fourth)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a visibly spliced child out to root', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = deleteForward(result.state, caret(first, 1), context);

        result = moveBlock(result.state, third, {type: 'after', targetBlockId: first}, context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'd', depth: 1},
            {text: 'c', depth: 0},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual([0, 'root']);
        expectCache(result.state);
    });

    it('drops an outside block into the middle of children spliced through a deleted parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd\ne', context);
        const [first, second, third, fourth, fifth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = {
            ...result,
            state: applyMany(result.state, [{type: 'block:delete', id: result.state.state.blocks[second].id}]),
        };

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
            {text: 'e', depth: 0},
        ]);

        result = moveBlock(result.state, fifth, {type: 'before', targetBlockId: fourth}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 1},
            {text: 'e', depth: 1},
            {text: 'd', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, fifth)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('indents a block under its previous visible sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [, second] = rootBlockIds(result.state);

        result = indentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 0},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('indents a block when an annotation body exists', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [first, second] = rootBlockIds(result.state);
        result = createAnnotation(
            result.state,
            {type: 'range', anchor: {blockId: first, offset: 0}, focus: {blockId: first, offset: 1}},
            'sidebar',
            context,
        );

        result = indentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
        ]);
        expect(result.state.cache).toEqual(
            organizeState(
                result.state.state.blocks,
                result.state.state.chars,
                result.state.state.joins,
                annotationVirtualParents(result.state),
                result.state.state.marks,
            ),
        );
    });

    it('does not indent the first sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const first = rootBlockIds(result.state)[0];

        result = indentBlock(result.state, first, context);

        expect(result.ops).toEqual([]);
        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
        ]);
        expectCache(result.state);
    });

    it('unindents a block and reparents following siblings under it', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);

        result = unindentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('converges concurrent unindents by source sibling order', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);
        const base = result.state;

        const left = unindentBlock(base, second, ctx('left')).ops;
        const right = unindentBlock(base, third, ctx('right')).ops;
        const one = applyMany(base, [...left, ...right]);
        const two = applyMany(base, [...right, ...left]);

        expect(materializedBlockParent(one, fourth)).toEqual(one.state.blocks[third].id);
        expect(materializedBlockParent(two, fourth)).toEqual(two.state.blocks[third].id);
        expect(visibleBlockOutline(one).map(({id, depth}) => ({id, depth}))).toEqual(
            visibleBlockOutline(two).map(({id, depth}) => ({id, depth})),
        );
        expectCache(one);
        expectCache(two);
    });

    it('joins using visible adjacency across nesting', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [, second] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);

        result = deleteForward(result.state, caret(rootBlockIds(result.state)[0], 1), context);

        expect(outline(result.state)).toEqual([{text: 'ab', depth: 0}]);
        expectCache(result.state);
    });
});

describe('block rich text runtime', () => {
    it('queues offline local changes and flushes them on reconnect', () => {
        let demo = createDemoState();
        demo = toggleOnline(demo, 'left');
        const leftBlock = rootBlockIds(demo.left.state)[0];
        const context = makeCommandContext(demo.left);
        const result = insertText(demo.left.state, caret(leftBlock, 0), 'offline', context);

        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: retainSelection(result.state, result.selection),
            ops: result.ops,
        });

        expect(lines(demo.left.state)).toEqual(['offline']);
        expect(lines(demo.right.state)).toEqual(['']);
        expect(demo.left.queue).toHaveLength(1);

        demo = toggleOnline(demo, 'left');
        expect(lines(demo.right.state)).toEqual(['offline']);
        expect(demo.left.queue).toHaveLength(0);
    });
});
