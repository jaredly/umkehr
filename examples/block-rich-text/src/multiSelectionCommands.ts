import type {CachedState} from 'umkehr/block-crdt/types';
import {materializeFormattedBlocks, type Op} from 'umkehr/block-crdt';
import {
    deleteBackward,
    deleteForward,
    insertText,
    moveBlock,
    pastePlainText,
    splitBlock,
    toggleMark,
    type CommandContext,
} from './blockCommands';
import {resolveSelection, retainSelection} from './retainedSelection';
import {
    dedupeSelectionSet,
    mergeOverlappingRanges,
    reverseSortedRetainedEntries,
    resolveSelectionSet,
    type RetainedSelectionEntry,
    type RetainedSelectionSet,
} from './selectionSet';
import {
    caret,
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    visibleBlockIds,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';

export type MultiCommandResult = {
    state: CachedState;
    ops: Op[];
    selection: RetainedSelectionSet;
};

export const insertTextEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertText(working, resolveSelection(working, entry.selection), text, context),
    );

export const pastePlainTextEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        pastePlainText(working, resolveSelection(working, entry.selection), text, context),
    );

export const deleteBackwardEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        deleteBackward(working, resolveSelection(working, entry.selection), context),
    );

export const deleteForwardEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        deleteForward(working, resolveSelection(working, entry.selection), context),
    );

export const splitBlockEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        splitBlock(working, resolveSelection(working, entry.selection), context),
    );

export const toggleMarkEverywhere = (
    state: CachedState,
    selection: RetainedSelectionSet,
    markType: 'bold' | 'italic',
    context: CommandContext,
): MultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = mergeOverlappingRanges(state, deduped).filter((entry) => {
        const resolved = resolveSelection(state, entry.selection);
        return !isCollapsed(resolved);
    });
    if (!commandEntries.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Op[] = [];
    for (const entry of commandEntries) {
        const result = toggleMark(
            working,
            resolveSelection(working, entry.selection),
            markType,
            context,
        );
        working = result.state;
        ops.push(...result.ops);
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, deduped),
    };
};

export const indentSelections = (
    state: CachedState,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => moveSelectedBlocks(state, selection, 'indent', context);

export const unindentSelections = (
    state: CachedState,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => moveSelectedBlocks(state, selection, 'unindent', context);

export const moveSelectionsHorizontally = (
    state: CachedState,
    selection: RetainedSelectionSet,
    direction: 'left' | 'right',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, moveSelectionHorizontally(state, entry.selection, direction)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

const moveSelectedBlocks = (
    state: CachedState,
    selection: RetainedSelectionSet,
    direction: 'indent' | 'unindent',
    context: CommandContext,
): MultiCommandResult => {
    const blockIds = topLevelSelectedBlockIds(state, selection);
    if (!blockIds.length) {
        return {state, ops: [], selection};
    }

    let working = state;
    const ops: Op[] = [];
    for (const move of blockMovesForSelection(state, blockIds, direction)) {
        const result = moveBlock(working, move.blockId, move.target, context);
        working = result.state;
        ops.push(...result.ops);
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, selection),
    };
};

const topLevelSelectedBlockIds = (
    state: CachedState,
    selection: RetainedSelectionSet,
): string[] => {
    const selected = new Set<string>();
    for (const entry of resolveSelectionSet(state, selection).entries) {
        for (const blockId of blockIdsForSelection(state, entry.selection)) {
            selected.add(blockId);
        }
    }

    const outline = materializeFormattedBlocks(state);
    const result: string[] = [];
    const selectedAncestorDepths: number[] = [];
    for (const block of outline) {
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

const blockIdsForSelection = (state: CachedState, selection: EditorSelection): string[] => {
    if (selection.type === 'caret') return [selection.point.blockId];

    const blocks = visibleBlockIds(state);
    const anchorIndex = blocks.indexOf(selection.anchor.blockId);
    const focusIndex = blocks.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) return [];
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return blocks.slice(start, end + 1);
};

const blockMovesForSelection = (
    state: CachedState,
    selectedBlockIds: string[],
    direction: 'indent' | 'unindent',
): Array<{blockId: string; target: Parameters<typeof moveBlock>[2]}> => {
    const selected = new Set(selectedBlockIds);
    const outline = materializeFormattedBlocks(state);
    const byParent = new Map<string, typeof outline>();
    for (const block of outline) {
        const siblings = byParent.get(block.parentId) ?? [];
        siblings.push(block);
        byParent.set(block.parentId, siblings);
    }

    const moves: Array<{blockId: string; target: Parameters<typeof moveBlock>[2]}> = [];
    for (const siblings of byParent.values()) {
        for (let index = 0; index < siblings.length; index++) {
            if (!selected.has(siblings[index].id)) continue;
            const start = index;
            while (index + 1 < siblings.length && selected.has(siblings[index + 1].id)) {
                index++;
            }
            const run = siblings.slice(start, index + 1);
            if (direction === 'indent') {
                const previousSibling = siblings[start - 1];
                if (!previousSibling) continue;
                for (const block of run) {
                    moves.push({
                        blockId: block.id,
                        target: {type: 'child', parentBlockId: previousSibling.id, at: 'end'},
                    });
                }
            } else {
                const parentId = run[0].parentId;
                if (parentId === '0000-root') continue;
                let targetBlockId = parentId;
                for (const block of run) {
                    moves.push({
                        blockId: block.id,
                        target: {type: 'after', targetBlockId},
                    });
                    targetBlockId = block.id;
                }
            }
        }
    }
    return moves;
};

export const moveSelectionsVertically = (
    state: CachedState,
    selection: RetainedSelectionSet,
    direction: 'up' | 'down',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, moveSelectionVertically(state, entry.selection, direction)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

export const extendSelectionsHorizontally = (
    state: CachedState,
    selection: RetainedSelectionSet,
    direction: 'left' | 'right',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, extendSelectionHorizontally(state, entry.selection, direction)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

export const extendSelectionsVertically = (
    state: CachedState,
    selection: RetainedSelectionSet,
    direction: 'up' | 'down',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, extendSelectionVertically(state, entry.selection, direction)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

const moveSelectionHorizontally = (
    state: CachedState,
    selection: EditorSelection,
    direction: 'left' | 'right',
): EditorSelection => {
    if (!isCollapsed(selection)) {
        const point =
            direction === 'left'
                ? firstPointForSelection(state, selection)
                : lastPointForSelection(state, selection);
        return caret(point.blockId, point.offset);
    }
    return caretAtPoint(movePointHorizontally(state, focusPoint(selection), direction));
};

const extendSelectionHorizontally = (
    state: CachedState,
    selection: EditorSelection,
    direction: 'left' | 'right',
): EditorSelection => {
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = movePointHorizontally(state, focusPoint(selection), direction);
    return {type: 'range', anchor, focus};
};

const extendSelectionVertically = (
    state: CachedState,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = movePointVertically(state, focusPoint(selection), direction);
    return {type: 'range', anchor, focus};
};

const moveSelectionVertically = (
    state: CachedState,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const point = focusPoint(selection);
    return caretAtPoint(movePointVertically(state, point, direction));
};

const movePointVertically = (
    state: CachedState,
    point: BlockPoint,
    direction: 'up' | 'down',
): BlockPoint => {
    const blocks = visibleBlockIds(state);
    const index = blocks.indexOf(point.blockId);
    const targetBlockId = blocks[direction === 'up' ? index - 1 : index + 1];
    if (!targetBlockId) return point;
    return {blockId: targetBlockId, offset: Math.min(point.offset, pointTextLength(state, targetBlockId))};
};

const movePointHorizontally = (
    state: CachedState,
    point: BlockPoint,
    direction: 'left' | 'right',
): BlockPoint => {
    const blocks = visibleBlockIds(state);
    const index = blocks.indexOf(point.blockId);
    if (index < 0) return point;

    if (direction === 'left') {
        if (point.offset > 0) return {blockId: point.blockId, offset: point.offset - 1};
        const previousBlockId = blocks[index - 1];
        return previousBlockId
            ? {blockId: previousBlockId, offset: pointTextLength(state, previousBlockId)}
            : point;
    }

    const length = pointTextLength(state, point.blockId);
    if (point.offset < length) return {blockId: point.blockId, offset: point.offset + 1};
    const nextBlockId = blocks[index + 1];
    return nextBlockId ? {blockId: nextBlockId, offset: 0} : point;
};

const caretAtPoint = (point: BlockPoint): EditorSelection => caret(point.blockId, point.offset);

const lastPointForSelection = (state: CachedState, selection: EditorSelection): BlockPoint => {
    const segments = normalizeSelectionSegments(state, selection);
    const last = segments[segments.length - 1];
    if (!last) return focusPoint(selection);
    return {blockId: last.blockId, offset: last.endOffset};
};

const runReplacingCommand = (
    state: CachedState,
    selection: RetainedSelectionSet,
    command: (
        working: CachedState,
        entry: RetainedSelectionEntry,
    ) => {state: CachedState; ops: Op[]; selection: ReturnType<typeof resolveSelection>},
): MultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = reverseSortedRetainedEntries(state, mergeOverlappingRanges(state, deduped));
    if (!commandEntries.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Op[] = [];
    const nextEntries: RetainedSelectionEntry[] = [];

    for (const entry of commandEntries) {
        const result = command(working, entry);
        working = result.state;
        ops.push(...result.ops);
        nextEntries.push({id: entry.id, selection: retainSelection(working, result.selection)});
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, {
            primaryId: selection.primaryId,
            entries: nextEntries,
        }),
    };
};
