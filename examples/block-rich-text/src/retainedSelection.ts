import {orderedCharIdsForBlock, rootBlockIds} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import {caret, clampPoint, type BlockPoint, type EditorSelection} from './selectionModel';

export type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};

export type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};

export const initialRetainedSelection = (state: CachedState): RetainedSelection => {
    const blockId = rootBlockIds(state)[0] ?? rootBlockIds(state, true)[0] ?? '';
    return {type: 'caret', point: {blockId, charId: null, affinity: 'after'}};
};

export const retainSelection = (
    state: CachedState,
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

export const retainPoint = (state: CachedState, point: BlockPoint): RetainedPoint => {
    const clamped = clampPoint(state, point);
    if (clamped.offset <= 0) {
        return {blockId: clamped.blockId, charId: null, affinity: 'after'};
    }
    const visibleCharIds = orderedCharIdsForBlock(state, clamped.blockId, {visibleOnly: true});
    const charId = visibleCharIds[clamped.offset - 1] ?? null;
    return {blockId: clamped.blockId, charId, affinity: 'after'};
};

export const resolveSelection = (
    state: CachedState,
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

export const resolvePoint = (state: CachedState, point: RetainedPoint): BlockPoint => {
    if (point.charId) {
        const resolved = resolveCharPoint(state, point);
        if (resolved) return resolved;
    }

    if (point.blockId && rootBlockIds(state).includes(point.blockId)) {
        return clampPoint(state, {blockId: point.blockId, offset: 0});
    }

    const firstVisibleBlock = rootBlockIds(state)[0];
    if (firstVisibleBlock) return {blockId: firstVisibleBlock, offset: 0};

    return {blockId: point.blockId, offset: 0};
};

const resolveCharPoint = (state: CachedState, point: RetainedPoint): BlockPoint | null => {
    for (const blockId of rootBlockIds(state, true)) {
        const logicalCharIds = orderedCharIdsForBlock(state, blockId);
        let visibleOffset = 0;

        for (const charId of logicalCharIds) {
            if (charId === point.charId) {
                return {
                    blockId: visibleBlockOrFallback(state, blockId),
                    offset: point.affinity === 'before' ? visibleOffset : visibleOffset + visibleCount(state, charId),
                };
            }
            if (!state.state.chars[charId]?.deleted) visibleOffset++;
        }
    }
    return null;
};

const visibleCount = (state: CachedState, charId: string) =>
    state.state.chars[charId]?.deleted ? 0 : 1;

const visibleBlockOrFallback = (state: CachedState, blockId: string) => {
    if (rootBlockIds(state).includes(blockId)) return blockId;
    return rootBlockIds(state)[0] ?? blockId;
};

export const retainedCaret = (state: CachedState, blockId: string, offset: number): RetainedSelection =>
    retainSelection(state, caret(blockId, offset));
