import type {CachedState} from 'umkehr/block-crdt/types';
import type {Op} from 'umkehr/block-crdt';
import {
    deleteBackward,
    deleteForward,
    insertText,
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

const moveSelectionVertically = (
    state: CachedState,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const point = focusPoint(selection);
    const blocks = visibleBlockIds(state);
    const index = blocks.indexOf(point.blockId);
    const targetBlockId = blocks[direction === 'up' ? index - 1 : index + 1];
    if (!targetBlockId) return caret(point.blockId, point.offset);
    return caret(targetBlockId, Math.min(point.offset, pointTextLength(state, targetBlockId)));
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
