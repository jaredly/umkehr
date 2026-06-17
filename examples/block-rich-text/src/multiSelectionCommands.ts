import type {CachedState} from 'umkehr/block-crdt/types';
import {blockContents, materializeFormattedBlocks, materializedBlockParent, type Op} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import type {RichBlockMeta} from './blockMeta';
import {
    deleteBackward,
    deleteTableRowHeaderBackward,
    deleteForward,
    insertText,
    insertTextWithMarkdownShortcuts,
    insertTextWithMarks,
    insertTextWithRetainedMarks,
    moveBlock,
    pastePlainText,
    pastePlainTextWithMarkdownShortcuts,
    removeLinkMark,
    setBlockMeta,
    setLinkMark,
    setBlockType,
    splitBlock,
    splitTableRowHeader,
    toggleMark,
    updateBlockMeta,
    commandApplied,
    noCommand,
    closeRetainedInlineMarkSessions,
    type CommandResult,
    type CommandContext,
    type RetainedInlineMarkSession,
} from './blockCommands';
import type {BooleanInlineMark} from './inlineMarks';
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
    editableBlockIds,
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    segmentText,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';
import {richTextVirtualParents} from './virtualParents';

export type MultiCommandResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    selection: RetainedSelectionSet;
};

export type RetainedInlineMarkSessionMap = Record<string, RetainedInlineMarkSession[]>;

export type RetainedInlineMarkMultiCommandResult = MultiCommandResult & {
    retainedMarks: RetainedInlineMarkSessionMap;
};

export type HorizontalMovementUnit = 'character' | 'word' | 'block';

export const insertTextEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertText(working, resolveSelection(working, entry.selection), text, context),
    );

export const insertTextWithMarkdownShortcutsEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertTextWithMarkdownShortcuts(working, resolveSelection(working, entry.selection), text, context),
    );

export const insertTextWithMarksEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    markTypes: BooleanInlineMark[],
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertTextWithMarks(working, resolveSelection(working, entry.selection), text, markTypes, context),
    );

export const insertTextWithRetainedMarksEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    markTypes: BooleanInlineMark[],
    retainedMarks: RetainedInlineMarkSessionMap,
    context: CommandContext,
): RetainedInlineMarkMultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = reverseSortedRetainedEntries(state, mergeOverlappingRanges(state, deduped));
    if (!commandEntries.length) return {state, ops: [], selection: deduped, retainedMarks};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const nextEntries: RetainedSelectionEntry[] = [];
    const nextRetainedMarks: RetainedInlineMarkSessionMap = {...retainedMarks};

    for (const entry of commandEntries) {
        const result = insertTextWithRetainedMarks(
            working,
            resolveSelection(working, entry.selection),
            text,
            markTypes,
            nextRetainedMarks[entry.id] ?? [],
            context,
        );
        working = result.state;
        ops.push(...result.ops);
        nextEntries.push({id: entry.id, selection: retainSelection(working, result.selection)});
        if (result.sessions.length) {
            nextRetainedMarks[entry.id] = result.sessions;
        } else {
            delete nextRetainedMarks[entry.id];
        }
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, {
            primaryId: selection.primaryId,
            entries: nextEntries,
        }),
        retainedMarks: nextRetainedMarks,
    };
};

export const closeRetainedInlineMarkSessionsEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    retainedMarks: RetainedInlineMarkSessionMap,
    markType: BooleanInlineMark,
    context: CommandContext,
): RetainedInlineMarkMultiCommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const nextRetainedMarks: RetainedInlineMarkSessionMap = {};

    for (const [selectionId, sessions] of Object.entries(retainedMarks)) {
        const result = closeRetainedInlineMarkSessions(working, sessions, markType, context);
        working = result.state;
        ops.push(...result.ops);
        if (result.sessions.length) {
            nextRetainedMarks[selectionId] = result.sessions;
        }
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, selection),
        retainedMarks: nextRetainedMarks,
    };
};

export const pastePlainTextEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        pastePlainText(working, resolveSelection(working, entry.selection), text, context),
    );

export const pastePlainTextWithMarkdownShortcutsEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        pastePlainTextWithMarkdownShortcuts(working, resolveSelection(working, entry.selection), text, context),
    );

export const deleteBackwardEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) => {
        const resolved = resolveSelection(working, entry.selection);
        const rowHeaderDeleted = deleteTableRowHeaderBackward(working, resolved, context);
        return commandApplied(rowHeaderDeleted)
            ? rowHeaderDeleted
            : deleteBackward(working, resolved, context);
    });

export const deleteForwardEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        deleteForward(working, resolveSelection(working, entry.selection), context),
    );

export const splitBlockEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
    options: {forceCodeNewline?: boolean} = {},
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) => {
        const resolved = resolveSelection(working, entry.selection);
        const rowHeaderSplit = options.forceCodeNewline
            ? noCommand()
            : splitTableRowHeader(working, resolved, context);
        return commandApplied(rowHeaderSplit)
            ? rowHeaderSplit
            : splitBlock(working, resolved, context, options);
    });

export const toggleMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    markType: BooleanInlineMark,
    context: CommandContext,
): MultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = mergeOverlappingRanges(state, deduped).filter((entry) => {
        const resolved = resolveSelection(state, entry.selection);
        return !isCollapsed(resolved);
    });
    if (!commandEntries.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
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

export const setLinkMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    href: string,
    context: CommandContext,
): MultiCommandResult => runLinkMarkCommand(state, selection, context, (working, selected, commandContext) =>
    setLinkMark(working, selected, href, commandContext),
);

export const removeLinkMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runLinkMarkCommand(state, selection, context, removeLinkMark);

const runLinkMarkCommand = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
    command: (
        state: CachedState<RichBlockMeta>,
        selection: EditorSelection,
        context: CommandContext,
    ) => CommandResult,
): MultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = mergeOverlappingRanges(state, deduped).filter((entry) => {
        const resolved = resolveSelection(state, entry.selection);
        return !isCollapsed(resolved);
    });
    if (!commandEntries.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const entry of commandEntries) {
        const result = command(working, resolveSelection(working, entry.selection), context);
        working = result.state;
        ops.push(...result.ops);
    }

    return {
        state: working,
        ops,
        selection: dedupeSelectionSet(working, deduped),
    };
};

export const setBlockTypeEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    metaForBlock: (blockId: string, current: RichBlockMeta) => RichBlockMeta,
): MultiCommandResult =>
    runBlockMetaCommand(state, selection, (working, blockId) => {
        const current = working.state.blocks[blockId];
        return current ? setBlockType(working, blockId, metaForBlock(blockId, current.meta)) : null;
    });

export const setBlockMetaEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    metaForBlock: (blockId: string, current: RichBlockMeta) => RichBlockMeta,
): MultiCommandResult =>
    runBlockMetaCommand(state, selection, (working, blockId) => {
        const current = working.state.blocks[blockId];
        return current ? setBlockMeta(working, blockId, metaForBlock(blockId, current.meta)) : null;
    });

export const updateBlockMetaEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    update: (current: RichBlockMeta, ts: string) => RichBlockMeta,
    context: CommandContext,
): MultiCommandResult =>
    runBlockMetaCommand(state, selection, (working, blockId) =>
        updateBlockMeta(working, blockId, update, context),
    );

export const indentSelections = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => moveSelectedBlocks(state, selection, 'indent', context);

export const unindentSelections = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => moveSelectedBlocks(state, selection, 'unindent', context);

export const moveSelectionsHorizontally = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    direction: 'left' | 'right',
    unit: HorizontalMovementUnit = 'character',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, moveSelectionHorizontally(state, entry.selection, direction, unit)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

const moveSelectedBlocks = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    direction: 'indent' | 'unindent',
    context: CommandContext,
): MultiCommandResult => {
    const blockIds = topLevelSelectedBlockIds(state, selection);
    if (!blockIds.length) {
        return {state, ops: [], selection};
    }

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
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
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
): string[] => {
    const selected = new Set<string>();
    for (const entry of resolveSelectionSet(state, selection).entries) {
        for (const blockId of blockIdsForSelection(state, entry.selection)) {
            selected.add(blockId);
        }
    }

    const outline = materializeFormattedBlocks(state, richTextVirtualParents(state));
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

const blockIdsForSelection = (state: CachedState<RichBlockMeta>, selection: EditorSelection): string[] => {
    if (selection.type === 'caret') return [selection.point.blockId];

    const blocks = editableBlockIds(state);
    const anchorIndex = blocks.indexOf(selection.anchor.blockId);
    const focusIndex = blocks.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) return [];
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return blocks.slice(start, end + 1);
};

const blockMovesForSelection = (
    state: CachedState<RichBlockMeta>,
    selectedBlockIds: string[],
    direction: 'indent' | 'unindent',
): Array<{blockId: string; target: Parameters<typeof moveBlock>[2]}> => {
    const selected = new Set(selectedBlockIds);
    const outline = materializeFormattedBlocks(state, richTextVirtualParents(state));
    const byParent = new Map<string, typeof outline>();
    for (const block of outline) {
        const siblings = byParent.get(block.parentId) ?? [];
        siblings.push(block);
        byParent.set(block.parentId, siblings);
    }

    const moves: Array<{blockId: string; target: Parameters<typeof moveBlock>[2]}> = [];
    for (const siblings of byParent.values()) {
        for (let index = 0; index < siblings.length; index++) {
            if (!selected.has(siblings[index].id) || isTableCellOutlineItem(state, siblings[index])) continue;
            const start = index;
            while (
                index + 1 < siblings.length &&
                selected.has(siblings[index + 1].id) &&
                !isTableCellOutlineItem(state, siblings[index + 1])
            ) {
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

const isTableCellOutlineItem = (
    state: CachedState<RichBlockMeta>,
    block: {parentId: string},
): boolean => {
    const parent = state.state.blocks[block.parentId];
    if (!parent || parent.meta.type === 'table') return false;
    const grandparentId = lamportToString(materializedBlockParent(state, block.parentId));
    return state.state.blocks[grandparentId]?.meta.type === 'table';
};

export const moveSelectionsVertically = (
    state: CachedState<RichBlockMeta>,
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
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    direction: 'left' | 'right',
    unit: HorizontalMovementUnit = 'character',
): MultiCommandResult => {
    const resolved = resolveSelectionSet(state, selection);
    const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, extendSelectionHorizontally(state, entry.selection, direction, unit)),
    }));

    return {
        state,
        ops: [],
        selection: dedupeSelectionSet(state, {primaryId: resolved.primaryId, entries}),
    };
};

export const extendSelectionsVertically = (
    state: CachedState<RichBlockMeta>,
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
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'left' | 'right',
    unit: HorizontalMovementUnit,
): EditorSelection => {
    if (!isCollapsed(selection)) {
        const point =
            direction === 'left'
                ? firstPointForSelection(state, selection)
                : lastPointForSelection(state, selection);
        return caret(point.blockId, point.offset);
    }
    return caretAtPoint(movePointHorizontally(state, focusPoint(selection), direction, unit));
};

const extendSelectionHorizontally = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'left' | 'right',
    unit: HorizontalMovementUnit,
): EditorSelection => {
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = movePointHorizontally(state, focusPoint(selection), direction, unit);
    return {type: 'range', anchor, focus};
};

const extendSelectionVertically = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const anchor = selection.type === 'caret' ? selection.point : selection.anchor;
    const focus = movePointVertically(state, focusPoint(selection), direction);
    return {type: 'range', anchor, focus};
};

const moveSelectionVertically = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const point = focusPoint(selection);
    return caretAtPoint(movePointVertically(state, point, direction));
};

const movePointVertically = (
    state: CachedState<RichBlockMeta>,
    point: BlockPoint,
    direction: 'up' | 'down',
): BlockPoint => {
    const blocks = editableBlockIds(state);
    const index = blocks.indexOf(point.blockId);
    const targetBlockId = blocks[direction === 'up' ? index - 1 : index + 1];
    if (!targetBlockId) return point;
    return {blockId: targetBlockId, offset: Math.min(point.offset, pointTextLength(state, targetBlockId))};
};

const movePointHorizontally = (
    state: CachedState<RichBlockMeta>,
    point: BlockPoint,
    direction: 'left' | 'right',
    unit: HorizontalMovementUnit,
): BlockPoint => {
    if (unit === 'block') {
        return {
            blockId: point.blockId,
            offset: direction === 'left' ? 0 : pointTextLength(state, point.blockId),
        };
    }
    if (unit === 'word') {
        return movePointByWord(state, point, direction);
    }

    const blocks = editableBlockIds(state);
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

const movePointByWord = (
    state: CachedState<RichBlockMeta>,
    point: BlockPoint,
    direction: 'left' | 'right',
): BlockPoint => {
    const text = blockContents(state, point.blockId);
    const boundaries = wordBoundaries(text);
    const target =
        direction === 'left'
            ? [...boundaries].reverse().find((offset) => offset < point.offset)
            : boundaries.find((offset) => offset > point.offset);
    if (target !== undefined) return {blockId: point.blockId, offset: target};

    const blocks = editableBlockIds(state);
    const index = blocks.indexOf(point.blockId);
    const targetBlockId = blocks[direction === 'left' ? index - 1 : index + 1];
    if (!targetBlockId) return point;
    return {
        blockId: targetBlockId,
        offset: direction === 'left' ? pointTextLength(state, targetBlockId) : 0,
    };
};

const wordBoundaries = (text: string): number[] => {
    const boundaries = new Set<number>([0, segmentText(text).length]);
    const segmenter = new Intl.Segmenter(undefined, {granularity: 'word'});
    for (const segment of segmenter.segment(text)) {
        if (!segment.isWordLike) continue;
        boundaries.add(segmentText(text.slice(0, segment.index)).length);
        boundaries.add(segmentText(text.slice(0, segment.index + segment.segment.length)).length);
    }
    return [...boundaries].sort((a, b) => a - b);
};

const caretAtPoint = (point: BlockPoint): EditorSelection => caret(point.blockId, point.offset);

const lastPointForSelection = (state: CachedState<RichBlockMeta>, selection: EditorSelection): BlockPoint => {
    const segments = normalizeSelectionSegments(state, selection);
    const last = segments[segments.length - 1];
    if (!last) return focusPoint(selection);
    return {blockId: last.blockId, offset: last.endOffset};
};

const runReplacingCommand = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    command: (
        working: CachedState<RichBlockMeta>,
        entry: RetainedSelectionEntry,
    ) => {
        state: CachedState<RichBlockMeta>;
        ops: Array<Op<RichBlockMeta>>;
        selection: ReturnType<typeof resolveSelection>;
    },
): MultiCommandResult => {
    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = reverseSortedRetainedEntries(state, mergeOverlappingRanges(state, deduped));
    if (!commandEntries.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
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

const runBlockMetaCommand = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    command: (
        working: CachedState<RichBlockMeta>,
        blockId: string,
    ) => CommandResult | null,
): MultiCommandResult => {
    const blockIds = topLevelSelectedBlockIds(state, selection);
    if (!blockIds.length) return {state, ops: [], selection};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const blockId of blockIds) {
        const result = command(working, blockId);
        if (!result) continue;
        working = result.state;
        ops.push(...result.ops);
    }

    return {state: working, ops, selection: dedupeSelectionSet(working, selection)};
};
