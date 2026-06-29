import type {BlockStylePatch, CachedState, JsonValue, Lamport} from '../block-crdt/types.js';
import * as hlc from '../crdt/hlc.js';
import {
    applyMany,
    blockContents,
    insertBlockOpsWithId,
    markRangeOp,
    materializeFormattedBlocks,
    materializedBlockParent,
    setBlockMetaOps,
    setBlockStyleOps,
    visibleBlockChildren,
    type Op,
} from '../block-crdt/index.js';
import {lamportToString, parseLamportString} from '../block-crdt/utils.js';
import type {ImagePresentationSize, RichBlockDocumentStyle, RichBlockMeta, RichBlockStyleAttribute} from './blockMeta';
import {
    deleteBackward,
    deleteTableRowHeaderBackward,
    deleteForward,
    insertText,
    insertTextWithMarkdownShortcuts,
    insertTextWithMarks,
    insertTextWithRetainedMarks,
    insertImageBlock,
    moveBlock,
    pastePlainText,
    pastePlainTextDetailed,
    pastePlainTextWithMarkdownShortcuts,
    removeLinkMark,
    removeCodeMark,
    setBlockMeta,
    setBlockStyle,
    setCodeMark,
    setMathMark,
    clearCodeLanguage,
    setLinkMark,
    setBlockType,
    splitBlock,
    splitTableRowHeader,
    toggleCodeMark,
    toggleDisplayMathMark,
    toggleMathMark,
    toggleMark,
    updateBlockMeta,
    updateBlockStyle,
    commandApplied,
    noCommand,
    addTableColumn,
    addTableRow,
    closeRetainedInlineMarkSessions,
    type CommandResult,
    type CommandContext,
    type RetainedInlineMarkSession,
} from './blockCommands';
import {LINK_MARK, MATH_MARK, mathMarkValueForMode, type BareInlineMark, type BooleanInlineMark} from './inlineMarks';
import {INLINE_EMBED_MARK, isInlineEmbedData} from './inlineEmbeds';
import {resolveSelection, retainSelection} from './retainedSelection';
import {
    dedupeSelectionSet,
    mergeOverlappingRanges,
    primarySelection,
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
    selectedBlockIdsForSelection,
    segmentText,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
    type BlockPoint,
    type EditorSelection,
} from './selectionModel';
import {
    ANNOTATION_MARK,
    richTextVirtualParents,
    type AnnotationMarkData,
} from './virtualParents';
import {annotationVirtualParents} from './annotations';
import {
    filterRichClipboardPayloadInlineFeatures,
    isClipboardAnnotationRef,
    isClipboardMathData,
    type ClipboardAnnotation,
    type ClipboardAnnotationRef,
    type ClipboardFragment,
    type ClipboardInlineFeatureSet,
    type ClipboardMarkRange,
    type RichClipboardPayload,
} from './clipboard';
import type {PollVoteCommandData} from './pollBlocks';

export type MultiCommandResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    selection: RetainedSelectionSet;
    commandLabel?: string;
    pollVote?: PollVoteCommandData;
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
    markTypes: BareInlineMark[],
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertTextWithMarks(working, resolveSelection(working, entry.selection), text, markTypes, context),
    );

export const insertTextWithRetainedMarksEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    text: string,
    markTypes: BareInlineMark[],
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
    markType: BareInlineMark,
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

export const pasteRichClipboardEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    payload: RichClipboardPayload,
    context: CommandContext,
    inlineFeatures?: ClipboardInlineFeatureSet,
): MultiCommandResult => {
    const pastePayload = inlineFeatures
        ? filterRichClipboardPayloadInlineFeatures(payload, inlineFeatures)
        : payload;
    const blockLevelPaste = pasteRichClipboardIntoBlockSelection(state, selection, pastePayload, context);
    if (blockLevelPaste) return blockLevelPaste;

    const deduped = dedupeSelectionSet(state, selection);
    const commandEntries = reverseSortedRetainedEntries(state, mergeOverlappingRanges(state, deduped));
    if (!commandEntries.length || !pastePayload.fragments.length) return {state, ops: [], selection: deduped};

    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const nextEntries: RetainedSelectionEntry[] = [];

    for (const entry of commandEntries) {
        const pasted = pasteRichClipboardAtSelection(
            working,
            resolveSelection(working, entry.selection),
            pastePayload,
            context,
        );
        working = pasted.state;
        ops.push(...pasted.ops);
        nextEntries.push({id: entry.id, selection: retainSelection(working, pasted.selection)});
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

const pasteRichClipboardIntoBlockSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    payload: RichClipboardPayload,
    context: CommandContext,
): MultiCommandResult | null => {
    const resolved = resolveSelectionSet(state, selection);
    const primary = primarySelection(resolved);
    if (primary.type !== 'block' && primary.type !== 'table-cells') return null;
    const noOp = {state, ops: [], selection: dedupeSelectionSet(state, selection)};
    if (primary.type !== 'table-cells' || !payload.fragments.length) return noOp;

    const rectangle = tableCellRectangleForSelection(state, primary);
    if (!rectangle) return noOp;
    if (rectangle.cellIds.length === 1) {
        return pasteRichClipboardAsCellChildren(
            state,
            selection,
            payload,
            rectangle.cellIds[0],
            context,
        );
    }
    const rows = tableRowsForSelection(state, rectangle.tableId);
    const columnCount = Math.max(
        1,
        ...rows.map((rowId) => tableCellsForSelection(state, rowId).length),
    );
    const isFullRow =
        rectangle.startColumnIndex === 0 &&
        rectangle.endColumnIndex >= columnCount - 1 &&
        rectangle.startRowIndex === rectangle.endRowIndex;
    const isFullColumn =
        rectangle.startRowIndex === 0 &&
        rectangle.endRowIndex >= rows.length - 1 &&
        rectangle.startColumnIndex === rectangle.endColumnIndex;

    if (isFullRow) {
        return pasteRichClipboardAsTableRow(state, selection, payload, primary.tableId, rows[rectangle.endRowIndex], context);
    }
    if (isFullColumn) {
        return pasteRichClipboardAsTableColumn(
            state,
            selection,
            payload,
            primary.tableId,
            rectangle.endColumnIndex + 1,
            context,
        );
    }
    return noOp;
};

const pasteRichClipboardAsCellChildren = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    payload: RichClipboardPayload,
    cellId: string,
    context: CommandContext,
): MultiCommandResult => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const richContext: RichPasteContext = {
        actor: context.actor,
        nextTs: context.nextTs,
        payloadAnnotations: new Map(payload.annotations.map((annotation) => [annotation.originalId, annotation])),
        annotationIds: new Map(),
        freshAnnotationIds: new Set(),
        importedAnnotationBodies: new Set(),
    };
    let previousBlockId = visibleBlockChildren(working, cellId, annotationVirtualParents(working)).at(-1) ?? null;
    let nextSelection: EditorSelection = caret(cellId, pointTextLength(working, cellId));

    for (const fragment of payload.fragments) {
        const parent = working.state.blocks[cellId];
        if (!parent) break;
        const inserted = insertBlockOpsWithId(working, {
            actor: context.actor,
            id: nextCommandLamport(working, context),
            parent: parent.id,
            before: previousBlockId ? working.state.blocks[previousBlockId].id : null,
            meta: fragment.meta,
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(working),
        });
        working = applyMany(working, inserted.ops, annotationVirtualParents(working));
        ops.push(...inserted.ops);
        previousBlockId = inserted.blockId;

        const styleOps = clipboardStyleOps(working, inserted.blockId, fragment.style, context);
        working = applyMany(working, styleOps, annotationVirtualParents(working));
        ops.push(...styleOps);

        const textInserted = insertText(working, caret(inserted.blockId, 0), fragment.text, context);
        working = textInserted.state;
        ops.push(...textInserted.ops);

        const marked = applyClipboardMarksToBlock(working, inserted.blockId, 0, fragment.marks, richContext);
        working = marked.state;
        ops.push(...marked.ops);
        nextSelection = caret(inserted.blockId, pointTextLength(working, inserted.blockId));
    }

    const imported = importFreshAnnotationBodies(working, richContext);
    working = imported.state;
    ops.push(...imported.ops);

    return {
        state: working,
        ops,
        selection: {
            primaryId: selection.primaryId,
            entries: [{id: selection.primaryId, selection: retainSelection(working, nextSelection)}],
        },
    };
};

const nextCommandLamport = (state: CachedState<RichBlockMeta>, context: CommandContext): Lamport => {
    const timestamp = context.nextTs();
    const unpacked = hlc.tryUnpack(timestamp);
    const count = unpacked ? unpacked.count : parseLamportString(timestamp)[0];
    return [Math.max(state.state.maxSeenCount + 1, count), context.actor];
};

const pasteRichClipboardAsTableRow = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    payload: RichClipboardPayload,
    tableId: string,
    afterRowId: string | undefined,
    context: CommandContext,
): MultiCommandResult => {
    const added = addTableRow(state, tableId, context, afterRowId);
    let working = added.state;
    const ops = [...added.ops];
    const firstCellId = focusPoint(added.selection).blockId;
    const rowId = working.state.blocks[firstCellId]
        ? lamportToString(materializedBlockParent(working, firstCellId, annotationVirtualParents(working)))
        : null;
    const cells = rowId ? tableCellsForSelection(working, rowId) : [];
    const pasted = pasteFragmentsIntoCells(working, cells, payload, context);
    working = pasted.state;
    ops.push(...pasted.ops);
    const nextSelection = pasted.selection ?? added.selection;
    return {
        state: working,
        ops,
        selection: {
            primaryId: selection.primaryId,
            entries: [{id: selection.primaryId, selection: retainSelection(working, nextSelection)}],
        },
    };
};

const pasteRichClipboardAsTableColumn = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    payload: RichClipboardPayload,
    tableId: string,
    columnIndex: number,
    context: CommandContext,
): MultiCommandResult => {
    const added = addTableColumn(state, tableId, context, columnIndex);
    let working = added.state;
    const ops = [...added.ops];
    const rows = tableRowsForSelection(working, tableId);
    const cells = rows
        .map((rowId) => tableCellsForSelection(working, rowId)[columnIndex])
        .filter((cellId): cellId is string => Boolean(cellId));
    const pasted = pasteFragmentsIntoCells(working, cells, payload, context);
    working = pasted.state;
    ops.push(...pasted.ops);
    const nextSelection = pasted.selection ?? added.selection;
    return {
        state: working,
        ops,
        selection: {
            primaryId: selection.primaryId,
            entries: [{id: selection.primaryId, selection: retainSelection(working, nextSelection)}],
        },
    };
};

const pasteFragmentsIntoCells = (
    state: CachedState<RichBlockMeta>,
    cellIds: string[],
    payload: RichClipboardPayload,
    context: CommandContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; selection: EditorSelection | null} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    let selection: EditorSelection | null = null;
    const fragments = payload.fragments.slice(0, cellIds.length);
    fragments.forEach((fragment, index) => {
        const cellId = cellIds[index];
        if (!cellId) return;
        const pasted = pasteRichClipboardAtSelection(
            working,
            caret(cellId, 0),
            {...payload, fragments: [fragment]},
            context,
        );
        working = pasted.state;
        ops.push(...pasted.ops);
        selection = pasted.selection;
    });
    return {state: working, ops, selection};
};

export const insertImageBlockEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    attachmentId: string,
    size: ImagePresentationSize,
    context: CommandContext,
): MultiCommandResult =>
    runReplacingCommand(state, selection, (working, entry) =>
        insertImageBlock(
            working,
            resolveSelection(working, entry.selection),
            attachmentId,
            size,
            context,
        ),
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

export const toggleCodeMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, toggleCodeMark);

export const toggleMathMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, toggleMathMark);

export const toggleDisplayMathMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, toggleDisplayMathMark);

export const setLinkMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    href: string,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, (working, selected, commandContext) =>
    setLinkMark(working, selected, href, commandContext),
);

export const removeLinkMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, removeLinkMark);

export const setCodeMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    language: string,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, (working, selected, commandContext) =>
    setCodeMark(working, selected, language, commandContext),
);

export const setMathMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    mode: 'inline' | 'display',
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, (working, selected, commandContext) =>
    setMathMark(working, selected, mode, commandContext),
);

export const clearCodeLanguageEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, clearCodeLanguage);

export const removeCodeMarkEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    context: CommandContext,
): MultiCommandResult => runRangeMarkCommand(state, selection, context, removeCodeMark);

const runRangeMarkCommand = (
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

export const setBlockStyleEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    styleForBlock: (blockId: string, current: BlockStylePatch) => BlockStylePatch,
): MultiCommandResult =>
    runBlockMetaCommand(state, selection, (working, blockId) => {
        const current = working.state.blocks[blockId];
        return current ? setBlockStyle(working, blockId, styleForBlock(blockId, current.style)) : null;
    });

export const updateBlockStyleEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    attribute: RichBlockStyleAttribute,
    value: string | null,
    context: CommandContext,
): MultiCommandResult =>
    runBlockMetaCommand(state, selection, (working, blockId) =>
        updateBlockStyle(working, blockId, attribute, value, context),
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
    if (selection.type !== 'range') return selectedBlockIdsForSelection(state, selection);

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
    const anchor = selection.type === 'range' ? selection.anchor : firstPointForSelection(state, selection);
    const focus = movePointHorizontally(state, focusPoint(selection), direction, unit);
    return {type: 'range', anchor, focus};
};

const extendSelectionVertically = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'up' | 'down',
): EditorSelection => {
    const anchor = selection.type === 'range' ? selection.anchor : firstPointForSelection(state, selection);
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

type RichPasteContext = {
    actor: string;
    nextTs(): string;
    payloadAnnotations: Map<string, ClipboardAnnotation>;
    annotationIds: Map<string, Lamport>;
    freshAnnotationIds: Set<string>;
    importedAnnotationBodies: Set<string>;
};

type InsertedFragmentTarget = {
    fragment: ClipboardFragment;
    blockId: string;
    startOffset: number;
};

const clipboardStyleOps = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    style: RichBlockDocumentStyle | undefined,
    context: CommandContext,
): Array<Op<RichBlockMeta>> => {
    if (!style) return [];
    const entries = Object.entries(style).filter((entry): entry is [RichBlockStyleAttribute, string | null] => (
        entry[1] !== undefined
    ));
    if (!entries.length) return [];
    return setBlockStyleOps(state, {
        block: state.state.blocks[blockId].id,
        style: Object.fromEntries(
            entries.map(([attribute, value]) => [attribute, {value, ts: context.nextTs()}]),
        ),
    });
};

const pasteRichClipboardAtSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    payload: RichClipboardPayload,
    context: CommandContext,
): CommandResult => {
    const text = payload.fragments.map((fragment) => fragment.text).join('\n');
    const pasted = pastePlainTextDetailed(state, selection, text, context);
    let working = pasted.result.state;
    const ops = [...pasted.result.ops];
    const richContext: RichPasteContext = {
        actor: context.actor,
        nextTs: context.nextTs,
        payloadAnnotations: new Map(payload.annotations.map((annotation) => [annotation.originalId, annotation])),
        annotationIds: new Map(),
        freshAnnotationIds: new Set(),
        importedAnnotationBodies: new Set(),
    };
    const targets = payload.fragments
        .map((fragment, index): InsertedFragmentTarget | null => {
            const line = pasted.touchedLines[index];
            return line ? {fragment, blockId: line.blockId, startOffset: line.startOffset} : null;
        })
        .filter((target): target is InsertedFragmentTarget => Boolean(target));

    for (const target of targets) {
        const block = working.state.blocks[target.blockId];
        if (!block) continue;
        const metaOps = setBlockMetaOps(working, {block: block.id, meta: target.fragment.meta});
        working = applyMany(working, metaOps, annotationVirtualParents(working));
        ops.push(...metaOps);
        const styleOps = clipboardStyleOps(working, target.blockId, target.fragment.style, context);
        working = applyMany(working, styleOps, annotationVirtualParents(working));
        ops.push(...styleOps);
    }

    const marked = applyClipboardMarksToTargets(working, targets, richContext);
    working = marked.state;
    ops.push(...marked.ops);

    const imported = importFreshAnnotationBodies(working, richContext);
    working = imported.state;
    ops.push(...imported.ops);

    return {state: working, ops, selection: pasted.result.selection};
};

const applyClipboardMarksToTargets = (
    state: CachedState<RichBlockMeta>,
    targets: InsertedFragmentTarget[],
    context: RichPasteContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const target of targets) {
        const result = applyClipboardMarksToBlock(
            working,
            target.blockId,
            target.startOffset,
            target.fragment.marks,
            context,
        );
        working = result.state;
        ops.push(...result.ops);
    }
    return {state: working, ops};
};

const applyClipboardMarksToBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    baseOffset: number,
    marks: ClipboardMarkRange[],
    context: RichPasteContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    for (const mark of marks) {
        const op = clipboardMarkOp(working, blockId, baseOffset, mark, context);
        if (!op) continue;
        working = applyMany(working, [op], annotationVirtualParents(working));
        ops.push(op);
    }
    return {state: working, ops};
};

const clipboardMarkOp = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    baseOffset: number,
    mark: ClipboardMarkRange,
    context: RichPasteContext,
): Op<RichBlockMeta> | null => {
    const startOffset = baseOffset + mark.startOffset;
    const endOffset = baseOffset + mark.endOffset;
    if (mark.type === 'link') {
        if (typeof mark.data !== 'string') return null;
        return markRangeOp(
            state,
            parseLamportString(blockId),
            startOffset,
            endOffset,
            LINK_MARK,
            mark.data,
            false,
            [state.state.maxSeenCount + 1, context.actor],
        );
    }
    if (mark.type === 'annotation') {
        if (!isClipboardAnnotationRef(mark.data)) return null;
        const annotationId = destinationAnnotationId(state, mark.data, context);
        const data: AnnotationMarkData = {
            id: annotationId,
            presentation: mark.data.presentation,
            ...(mark.data.resolved ? {resolved: true} : {}),
        };
        return markRangeOp(
            state,
            parseLamportString(blockId),
            startOffset,
            endOffset,
            ANNOTATION_MARK,
            data as unknown as JsonValue,
            false,
            [state.state.maxSeenCount + 1, context.actor],
        );
    }
    if (mark.type === 'embed') {
        if (!isInlineEmbedData(mark.data)) return null;
        return markRangeOp(
            state,
            parseLamportString(blockId),
            startOffset,
            endOffset,
            INLINE_EMBED_MARK,
            mark.data as unknown as JsonValue,
            false,
            [state.state.maxSeenCount + 1, context.actor],
        );
    }
    if (mark.type === 'math') {
        const mode = isClipboardMathData(mark.data) && mark.data.display ? 'display' : 'inline';
        return markRangeOp(
            state,
            parseLamportString(blockId),
            startOffset,
            endOffset,
            MATH_MARK,
            mathMarkValueForMode(mode) as JsonValue,
            false,
            [state.state.maxSeenCount + 1, context.actor],
        );
    }
    return markRangeOp(
        state,
        parseLamportString(blockId),
        startOffset,
        endOffset,
        mark.type,
        undefined,
        false,
        [state.state.maxSeenCount + 1, context.actor],
    );
};

const destinationAnnotationId = (
    state: CachedState<RichBlockMeta>,
    ref: ClipboardAnnotationRef,
    context: RichPasteContext,
): Lamport => {
    const existing = context.annotationIds.get(ref.originalId);
    if (existing) return existing;

    const parsed = parseLamportStringOrNull(ref.originalId);
    if (parsed && annotationExists(state, parsed)) {
        context.annotationIds.set(ref.originalId, parsed);
        return parsed;
    }

    const fresh: Lamport = [state.state.maxSeenCount + 1, context.actor];
    context.annotationIds.set(ref.originalId, fresh);
    context.freshAnnotationIds.add(ref.originalId);
    return fresh;
};

const importFreshAnnotationBodies = (
    state: CachedState<RichBlockMeta>,
    context: RichPasteContext,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];

    while (true) {
        const nextOriginalId = [...context.freshAnnotationIds].find(
            (originalId) => !context.importedAnnotationBodies.has(originalId),
        );
        if (!nextOriginalId) break;
        context.importedAnnotationBodies.add(nextOriginalId);
        const annotation = context.payloadAnnotations.get(nextOriginalId);
        const parent = context.annotationIds.get(nextOriginalId);
        if (!annotation || !parent) continue;

        let previousBodyId: string | null = null;
        for (const fragment of annotation.bodyBlocks) {
            const inserted: {ops: Array<Op<RichBlockMeta>>; id: Lamport; blockId: string} = insertBlockOpsWithId(working, {
                actor: context.actor,
                parent,
                before: previousBodyId ? working.state.blocks[previousBodyId].id : null,
                meta: fragment.meta,
                ts: context.nextTs(),
                virtualParents: annotationVirtualParents(working),
            });
            working = applyMany(working, inserted.ops, annotationVirtualParents(working));
            ops.push(...inserted.ops);
            previousBodyId = inserted.blockId;

            const styleOps = clipboardStyleOps(working, inserted.blockId, fragment.style, context);
            working = applyMany(working, styleOps, annotationVirtualParents(working));
            ops.push(...styleOps);

            const textInserted = insertText(working, caret(inserted.blockId, 0), fragment.text, context);
            working = textInserted.state;
            ops.push(...textInserted.ops);

            const marked = applyClipboardMarksToBlock(working, inserted.blockId, 0, fragment.marks, context);
            working = marked.state;
            ops.push(...marked.ops);
        }
    }

    return {state: working, ops};
};

const annotationExists = (state: CachedState<RichBlockMeta>, annotationId: Lamport): boolean => {
    const id = lamportToString(annotationId);
    for (const mark of Object.values(state.state.marks)) {
        if (mark.type !== ANNOTATION_MARK || mark.remove || !isAnnotationMarkData(mark.data)) continue;
        if (lamportToString(mark.data.id) === id) return true;
    }
    return visibleBlockChildren(state, id, annotationVirtualParents(state)).length > 0;
};

const isAnnotationMarkData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);

const parseLamportStringOrNull = (value: string): Lamport | null => {
    try {
        return parseLamportString(value);
    } catch {
        return null;
    }
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
