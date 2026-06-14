import type {CachedState} from 'umkehr/block-crdt/types';
import {materializeFormattedBlocks, orderedCharIdsForBlock} from 'umkehr/block-crdt';
import type {RichBlockMeta} from './blockMeta';

export type BlockPoint = {blockId: string; offset: number};

export type EditorSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};

export type SelectionSegment = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

export const caret = (blockId: string, offset: number): EditorSelection => ({
    type: 'caret',
    point: {blockId, offset},
});

export const pointTextLength = (state: CachedState<RichBlockMeta>, blockId: string): number =>
    orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).length;

export const visibleBlockIds = (state: CachedState<RichBlockMeta>): string[] =>
    materializeFormattedBlocks(state).map((block) => block.id);

export const clampPoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): BlockPoint => {
    const blocks = visibleBlockIds(state);
    const blockId = blocks.includes(point.blockId) ? point.blockId : blocks[0];
    if (!blockId) return point;
    return {
        blockId,
        offset: Math.max(0, Math.min(point.offset, pointTextLength(state, blockId))),
    };
};

export const clampSelection = (state: CachedState<RichBlockMeta>, selection: EditorSelection): EditorSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: clampPoint(state, selection.point)};
    }
    return {
        type: 'range',
        anchor: clampPoint(state, selection.anchor),
        focus: clampPoint(state, selection.focus),
    };
};

export const isCollapsed = (selection: EditorSelection): selection is {type: 'caret'; point: BlockPoint} =>
    selection.type === 'caret' ||
    (selection.anchor.blockId === selection.focus.blockId &&
        selection.anchor.offset === selection.focus.offset);

export const focusPoint = (selection: EditorSelection): BlockPoint =>
    selection.type === 'caret' ? selection.point : selection.focus;

export const normalizeSelectionSegments = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): SelectionSegment[] => {
    if (selection.type === 'caret') return [];

    const blocks = visibleBlockIds(state);
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
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return clampPoint(state, selection.focus);
    return {blockId: segments[0].blockId, offset: segments[0].startOffset};
};

export const segmentText = (text: string): string[] =>
    Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
