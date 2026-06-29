import {
    isDeleted,
    resolvePoint as resolveBlockPoint,
    retainPoint as retainBlockPoint,
} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import {
    caret,
    editableBlockIds,
    type BlockPoint,
    type DecorationAffinity,
    type EditorSelection,
} from './selectionModel';
import {tableSelectionPlugin, type RetainedTableCellSelection} from './tableSelectionPlugin';

export type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
    visualAffinity?: DecorationAffinity;
};

export type CoreRetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint}
    | {type: 'block'; anchorBlockId: string; focusBlockId: string};

export type RetainedSelection = CoreRetainedSelection | RetainedTableCellSelection;

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
    if (selection.type === 'block') {
        return {
            type: 'block',
            anchorBlockId: selection.anchorBlockId,
            focusBlockId: selection.focusBlockId,
        };
    }
    if (selection.type === 'table-cells') {
        return tableSelectionPlugin.retain({state, selection}) as RetainedSelection;
    }
    return {
        type: 'range',
        anchor: retainPoint(state, selection.anchor),
        focus: retainPoint(state, selection.focus),
    };
};

export const retainPoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): RetainedPoint => {
    const retained = retainBlockPoint(state, point);
    const result: RetainedPoint = {
        blockId: retained.blockId,
        charId: retained.charId,
        affinity: retained.affinity,
    };
    if (point.visualAffinity) result.visualAffinity = point.visualAffinity;
    return result;
};

export const resolveSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelection,
): EditorSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: resolvePoint(state, selection.point)};
    }
    if (selection.type === 'block') {
        return {
            type: 'block',
            anchorBlockId: resolveBlockId(state, selection.anchorBlockId),
            focusBlockId: resolveBlockId(state, selection.focusBlockId),
        };
    }
    if (selection.type === 'table-cells') {
        return tableSelectionPlugin.resolve({state, selection}) as EditorSelection;
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
    const resolved = resolveBlockPoint(state, point);
    return point.visualAffinity ? {...resolved, visualAffinity: point.visualAffinity} : resolved;
};

const allBlockIds = (state: CachedState<RichBlockMeta>): string[] => Object.keys(state.state.blocks).sort();

export const resolveBlockId = (state: CachedState<RichBlockMeta>, blockId: string): string => {
    const block = state.state.blocks[blockId];
    if (block && !isDeleted(block) && !state.cache.joinedBlocks[blockId]) return blockId;
    return editableBlockIds(state)[0] ?? allBlockIds(state)[0] ?? blockId;
};

export const retainedCaret = (state: CachedState<RichBlockMeta>, blockId: string, offset: number): RetainedSelection =>
    retainSelection(state, caret(blockId, offset));
