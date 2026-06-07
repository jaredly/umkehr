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
    type RetainedSelectionEntry,
    type RetainedSelectionSet,
} from './selectionSet';
import {isCollapsed} from './selectionModel';

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
