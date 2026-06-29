import type {CachedState, JsonValue} from '../block-crdt/types.js';
import {isDeleted, orderedCharIdsForBlock, visibleBlockOutline} from '../block-crdt/index.js';
import {isEditableBlock} from './blockMeta';
import type {RichBlockMeta} from './blockMeta';
import {richTextVirtualParents} from './virtualParents';
import {
    selectedCellIdsForSelection as selectedTableCellIdsForSelection,
    tableCellPosition as tableSelectionCellPosition,
    tableCellRectangleForSelection as tableSelectionCellRectangleForSelection,
    tableCellsForSelection as tableSelectionCellsForSelection,
    tableRowsForSelection as tableSelectionRowsForSelection,
    tableSelectionPlugin,
    isTableCellSelection,
    type TableCellPosition,
    type TableCellRectangle,
    type TableCellSelection,
} from './tableSelectionPlugin';

export type DecorationAffinity = 'beforeDecorations' | 'afterDecorations';

export type BlockPoint = {
    blockId: string;
    offset: number;
    visualAffinity?: DecorationAffinity;
};

export type TextSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};

export type CoreBlockSelection = {type: 'block'; anchorBlockId: string; focusBlockId: string};

export type CoreEditorSelection = TextSelection | CoreBlockSelection;

export type PluginEditorSelection = {type: string} & Record<string, JsonValue>;
export type PluginRetainedSelection = {type: string} & Record<string, JsonValue>;

export type BlockLevelSelection = CoreBlockSelection | TableCellSelection;

export type EditorSelection = CoreEditorSelection | TableCellSelection;

export type SelectionSegment = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

export const caret = (blockId: string, offset: number): EditorSelection => ({
    type: 'caret',
    point: {blockId, offset},
});

export const blockSelection = (blockId: string): EditorSelection => ({
    type: 'block',
    anchorBlockId: blockId,
    focusBlockId: blockId,
});

export const tableCellSelection = (tableId: string, cellId: string): TableCellSelection => ({
    type: 'table-cells',
    tableId,
    anchorCellId: cellId,
    focusCellId: cellId,
});

export const pointTextLength = (state: CachedState<RichBlockMeta>, blockId: string): number =>
    orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).length;

export const visibleBlockIds = (state: CachedState<RichBlockMeta>): string[] =>
    visibleBlockOutline(state, richTextVirtualParents(state)).map((block) => block.id);

export const editableBlockIds = (state: CachedState<RichBlockMeta>): string[] =>
    visibleBlockOutline(state, richTextVirtualParents(state))
        .filter((block) => isEditableBlock(state.state.blocks[block.id]?.meta))
        .map((block) => block.id);

export const clampPoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): BlockPoint => {
    const currentBlock = state.state.blocks[point.blockId];
    if (
        currentBlock &&
        !isDeleted(currentBlock) &&
        !state.cache.joinedBlocks[point.blockId] &&
        isEditableBlock(currentBlock.meta)
    ) {
        return {
            blockId: point.blockId,
            offset: Math.max(0, Math.min(point.offset, pointTextLength(state, point.blockId))),
            visualAffinity: point.visualAffinity,
        };
    }

    const blocks = editableBlockIds(state);
    const blockId = blocks.includes(point.blockId) ? point.blockId : blocks[0];
    if (!blockId) return point;
    return {
        blockId,
        offset: Math.max(0, Math.min(point.offset, pointTextLength(state, blockId))),
        visualAffinity: point.visualAffinity,
    };
};

export const clampSelection = (state: CachedState<RichBlockMeta>, selection: EditorSelection): EditorSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: clampPoint(state, selection.point)};
    }
    if (selection.type === 'block') {
        return {
            type: 'block',
            anchorBlockId: clampBlockId(state, selection.anchorBlockId),
            focusBlockId: clampBlockId(state, selection.focusBlockId),
        };
    }
    if (selection.type === 'table-cells') {
        return (tableSelectionPlugin.clamp?.({state, selection}) ?? selection) as EditorSelection;
    }
    return {
        type: 'range',
        anchor: clampPoint(state, selection.anchor),
        focus: clampPoint(state, selection.focus),
    };
};

export const isTextSelection = (selection: EditorSelection): selection is TextSelection =>
    selection.type === 'caret' || selection.type === 'range';

export const isBlockLevelSelection = (selection: EditorSelection): selection is BlockLevelSelection =>
    selection.type !== 'caret' && selection.type !== 'range';

export const isCollapsed = (selection: EditorSelection): selection is {type: 'caret'; point: BlockPoint} =>
    selection.type === 'caret' ||
    (selection.type === 'range' &&
        selection.anchor.blockId === selection.focus.blockId &&
        selection.anchor.offset === selection.focus.offset);

export const focusPoint = (selection: EditorSelection): BlockPoint => {
    if (selection.type === 'caret') return selection.point;
    if (selection.type === 'range') return selection.focus;
    if (selection.type === 'block') return {blockId: selection.focusBlockId, offset: 0};
    if (isTableCellSelection(selection)) return {blockId: selection.focusCellId, offset: 0};
    return {blockId: '', offset: 0};
};

export const textFocusPoint = (selection: TextSelection): BlockPoint =>
    selection.type === 'caret' ? selection.point : selection.focus;

export const focusBlockId = (selection: EditorSelection): string => {
    if (selection.type === 'caret') return selection.point.blockId;
    if (selection.type === 'range') return selection.focus.blockId;
    if (selection.type === 'block') return selection.focusBlockId;
    if (isTableCellSelection(selection)) return selection.focusCellId;
    return '';
};

export const normalizeSelectionSegments = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): SelectionSegment[] => {
    if (selection.type !== 'range') return [];

    const blocks = editableBlockIds(state);
    const anchorIndex = blocks.indexOf(selection.anchor.blockId);
    const focusIndex = blocks.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) return [];

    let start = selection.anchor;
    let end = selection.focus;
    if (
        anchorIndex > focusIndex ||
        (anchorIndex === focusIndex && selection.anchor.offset > selection.focus.offset)
    ) {
        start = selection.focus;
        end = selection.anchor;
    }

    const startIndex = blocks.indexOf(start.blockId);
    const endIndex = blocks.indexOf(end.blockId);
    const segments: SelectionSegment[] = [];
    for (let index = startIndex; index <= endIndex; index++) {
        const blockId = blocks[index];
        const length = pointTextLength(state, blockId);
        const startOffset = index === startIndex ? Math.min(start.offset, length) : 0;
        const endOffset = index === endIndex ? Math.min(end.offset, length) : length;
        if (startOffset < endOffset) {
            segments.push({blockId, startOffset, endOffset});
        }
    }
    return segments;
};

export const firstPointForSelection = (state: CachedState<RichBlockMeta>, selection: EditorSelection): BlockPoint => {
    if (selection.type === 'caret') return clampPoint(state, selection.point);
    if (selection.type === 'block') return {blockId: clampBlockId(state, selection.anchorBlockId), offset: 0};
    if (isTableCellSelection(selection)) return {blockId: clampBlockId(state, selection.anchorCellId), offset: 0};
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return clampPoint(state, selection.focus);
    return {blockId: segments[0].blockId, offset: segments[0].startOffset};
};

export const selectedBlockIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    if (selection.type === 'caret') return [selection.point.blockId];
    if (selection.type === 'range') {
        const blocks = editableBlockIds(state);
        const anchorIndex = blocks.indexOf(selection.anchor.blockId);
        const focusIndex = blocks.indexOf(selection.focus.blockId);
        if (anchorIndex < 0 || focusIndex < 0) return [];
        const start = Math.min(anchorIndex, focusIndex);
        const end = Math.max(anchorIndex, focusIndex);
        return blocks.slice(start, end + 1);
    }
    if (selection.type === 'block') {
        return selectedBlockRange(state, selection.anchorBlockId, selection.focusBlockId);
    }
    return isTableCellSelection(selection) ? selectedCellIdsForSelection(state, selection) : [];
};

export const selectedCellIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    if (!isTableCellSelection(selection)) return [];
    return selectedTableCellIdsForSelection(state, selection);
};

export const tableCellRectangleForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): TableCellRectangle | null => {
    return isTableCellSelection(selection) ? tableSelectionCellRectangleForSelection(state, selection) : null;
};

export const tableCellPosition = (
    state: CachedState<RichBlockMeta>,
    cellId: string,
): TableCellPosition | null => {
    return tableSelectionCellPosition(state, cellId);
};

export const tableRowsForSelection = (
    state: CachedState<RichBlockMeta>,
    tableId: string,
): string[] => {
    return tableSelectionRowsForSelection(state, tableId);
};

export const tableCellsForSelection = (
    state: CachedState<RichBlockMeta>,
    rowId: string,
): string[] => {
    return tableSelectionCellsForSelection(state, rowId);
};

const selectedBlockRange = (
    state: CachedState<RichBlockMeta>,
    anchorBlockId: string,
    focusBlockId: string,
): string[] => {
    const blocks = visibleBlockIds(state);
    const anchorIndex = blocks.indexOf(anchorBlockId);
    const focusIndex = blocks.indexOf(focusBlockId);
    if (anchorIndex < 0 || focusIndex < 0) return [clampBlockId(state, focusBlockId)];
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return blocks.slice(start, end + 1);
};

export const selectedTopLevelBlockIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    const selected = new Set(selectedBlockIdsForSelection(state, selection));
    const result: string[] = [];
    const selectedAncestorDepths: number[] = [];
    for (const block of visibleBlockOutline(state, richTextVirtualParents(state))) {
        while (
            selectedAncestorDepths.length &&
            selectedAncestorDepths[selectedAncestorDepths.length - 1] >= block.depth
        ) {
            selectedAncestorDepths.pop();
        }
        if (!selected.has(block.id)) continue;
        if (!selectedAncestorDepths.length) {
            result.push(block.id);
            selectedAncestorDepths.push(block.depth);
        }
    }
    return result;
};

export const visibleSubtreeBlockIds = (
    state: CachedState<RichBlockMeta>,
    rootBlockId: string,
): string[] => {
    const outline = visibleBlockOutline(state, richTextVirtualParents(state));
    const rootIndex = outline.findIndex((block) => block.id === rootBlockId);
    if (rootIndex < 0) return [clampBlockId(state, rootBlockId)];
    const rootDepth = outline[rootIndex].depth;
    const result = [rootBlockId];
    for (let index = rootIndex + 1; index < outline.length; index++) {
        if (outline[index].depth <= rootDepth) break;
        result.push(outline[index].id);
    }
    return result;
};

const clampBlockId = (state: CachedState<RichBlockMeta>, blockId: string): string => {
    const block = state.state.blocks[blockId];
    if (block && !isDeleted(block) && !state.cache.joinedBlocks[blockId]) return blockId;
    return visibleBlockIds(state)[0] ?? blockId;
};

export const segmentText = (text: string): string[] =>
    /^[\x00-\x7F]*$/.test(text)
        ? text.split('')
        : Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
