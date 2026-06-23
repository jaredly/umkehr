import {orderedCharIdsForBlock} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import type {RichBlockMeta} from './blockMeta';
import {caret, clampPoint, editableBlockIds, type BlockPoint, type EditorSelection} from './selectionModel';
import {visibleCharIdBeforeOffset} from './charUtils';

export type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};

export type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};

export const initialRetainedSelection = (state: CachedState<RichBlockMeta>): RetainedSelection => {
    const blockId = editableBlockIds(state)[0] ?? allBlockIds(state)[0] ?? '';
    return {type: 'caret', point: {blockId, charId: null, affinity: 'after'}};
};

export const retainSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): RetainedSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: retainPoint(state, selection.point)};
    }
    return {
        type: 'range',
        anchor: retainPoint(state, selection.anchor),
        focus: retainPoint(state, selection.focus),
    };
};

export const retainPoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): RetainedPoint => {
    const clamped = clampPoint(state, point);
    if (clamped.offset <= 0) {
        return {blockId: clamped.blockId, charId: null, affinity: 'after'};
    }
    const charId = visibleCharIdBeforeOffset(state, clamped.blockId, clamped.offset);
    return {blockId: clamped.blockId, charId, affinity: 'after'};
};

export const resolveSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelection,
): EditorSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: resolvePoint(state, selection.point)};
    }
    const anchor = resolvePoint(state, selection.anchor);
    const focus = resolvePoint(state, selection.focus);
    if (anchor.blockId === focus.blockId && anchor.offset === focus.offset) {
        return {type: 'caret', point: focus};
    }
    return {
        type: 'range',
        anchor,
        focus,
    };
};

export const resolvePoint = (state: CachedState<RichBlockMeta>, point: RetainedPoint): BlockPoint => {
    if (point.charId) {
        const resolved = resolveCharPoint(state, point);
        if (resolved) return resolved;
    }

    const visibleBlocks = editableBlockIds(state);
    if (point.blockId && visibleBlocks.includes(point.blockId)) {
        return clampPoint(state, {blockId: point.blockId, offset: 0});
    }

    const firstVisibleBlock = visibleBlocks[0];
    if (firstVisibleBlock) return {blockId: firstVisibleBlock, offset: 0};

    return {blockId: point.blockId, offset: 0};
};

const resolveCharPoint = (state: CachedState<RichBlockMeta>, point: RetainedPoint): BlockPoint | null => {
    for (const blockId of allBlockIds(state)) {
        const logicalCharIds = orderedCharIdsForBlock(state, blockId);
        let visibleOffset = 0;

        for (const charId of logicalCharIds) {
            if (charId === point.charId) {
                return {
                    blockId: visibleBlockOrFallback(state, blockId),
                    offset: point.affinity === 'before' ? visibleOffset : visibleOffset + visibleCount(state, charId),
                };
            }
            const char = state.state.chars[charId];
            if (char && !char.deleted) visibleOffset++;
        }
    }
    return null;
};

const visibleCount = (state: CachedState<RichBlockMeta>, charId: string) =>
    state.state.chars[charId] && !state.state.chars[charId].deleted ? 1 : 0;

const visibleBlockOrFallback = (state: CachedState<RichBlockMeta>, blockId: string) => {
    const visibleBlocks = editableBlockIds(state);
    if (visibleBlocks.includes(blockId)) return blockId;
    return visibleBlocks[0] ?? blockId;
};

const allBlockIds = (state: CachedState<RichBlockMeta>): string[] => Object.keys(state.state.blocks).sort();

export const retainedCaret = (state: CachedState<RichBlockMeta>, blockId: string, offset: number): RetainedSelection =>
    retainSelection(state, caret(blockId, offset));
