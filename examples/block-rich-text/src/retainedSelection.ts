import {
    resolvePoint as resolveBlockPoint,
    retainPoint as retainBlockPoint,
} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import type {RichBlockMeta} from './blockMeta';
import {caret, editableBlockIds, type BlockPoint, type EditorSelection} from './selectionModel';

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
    const retained = retainBlockPoint(state, point);
    return {blockId: retained.blockId, charId: retained.charId, affinity: retained.affinity};
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
    return resolveBlockPoint(state, point);
};

const allBlockIds = (state: CachedState<RichBlockMeta>): string[] => Object.keys(state.state.blocks).sort();

export const retainedCaret = (state: CachedState<RichBlockMeta>, blockId: string, offset: number): RetainedSelection =>
    retainSelection(state, caret(blockId, offset));
