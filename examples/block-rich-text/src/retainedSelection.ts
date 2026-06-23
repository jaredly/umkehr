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
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint}
    | {type: 'block'; anchorBlockId: string; focusBlockId: string}
    | {
          type: 'table-cells';
          tableId: string;
          anchorCellId: string;
          focusCellId: string;
      };

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
        return {
            type: 'table-cells',
            tableId: selection.tableId,
            anchorCellId: selection.anchorCellId,
            focusCellId: selection.focusCellId,
        };
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
    if (selection.type === 'block') {
        return {
            type: 'block',
            anchorBlockId: resolveBlockId(state, selection.anchorBlockId),
            focusBlockId: resolveBlockId(state, selection.focusBlockId),
        };
    }
    if (selection.type === 'table-cells') {
        return {
            type: 'table-cells',
            tableId: resolveBlockId(state, selection.tableId),
            anchorCellId: resolveBlockId(state, selection.anchorCellId),
            focusCellId: resolveBlockId(state, selection.focusCellId),
        };
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

const resolveBlockId = (state: CachedState<RichBlockMeta>, blockId: string): string => {
    const block = state.state.blocks[blockId];
    if (block && !block.deleted && !state.cache.joinedBlocks[blockId]) return blockId;
    return editableBlockIds(state)[0] ?? allBlockIds(state)[0] ?? blockId;
};

export const retainedCaret = (state: CachedState<RichBlockMeta>, blockId: string, offset: number): RetainedSelection =>
    retainSelection(state, caret(blockId, offset));
