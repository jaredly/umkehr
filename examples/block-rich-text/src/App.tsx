import {
    useCallback,
    Fragment,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type MutableRefObject,
    type PointerEvent,
    type ReactElement,
} from 'react';
import {
    formattedMarkValues,
    materializeFormattedBlocks,
    materializedBlockParent,
    materializedBlockPath,
    orderedCharIdsForBlock,
    visibleBlockChildren,
    visibleRangesForMark,
} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    addTableColumn,
    addTableRow,
    advanceFromTableCellEnd,
    clearCodeLanguage,
    closeRetainedInlineMarkSessions,
    commandApplied,
    convertBlockToTable,
    createMissingTableCell,
    deleteEmptyTableRowBackward,
    exitEmptyLastTableRow,
    insertInlineEmbed,
    insertTextWithMarkdownShortcuts,
    insertTextWithRetainedMarks,
    moveBlock,
    moveTableSelectionByArrow,
    removeCodeMark,
    moveTableCell,
    moveTableCellByTab,
    setCodeMark,
    setInlineEmbedDataByCharId,
    setBlockMeta,
    splitTableTitleToParagraph,
    type CommandResult,
    type RetainedInlineMarkSession,
} from './blockCommands';
import {
    annotationVirtualParents,
    ANNOTATION_MARK,
    annotationMarkBehavior,
    annotationBodyBlockIds,
    clearAnnotationBodyCodeLanguage,
    createAnnotation,
    deleteAnnotationBodyBackward,
    deleteAnnotationBodyForward,
    renderedAnnotations,
    isAnnotationData,
    pasteAnnotationBodyTextWithMarkdownShortcuts,
    replaceAnnotationBodySelection,
    removeAnnotationBodyCodeMark,
    removeAnnotationBodyLink,
    resolveAnnotation,
    setAnnotationBodyCodeMark,
    setAnnotationBodyLink,
    splitAnnotationBodyBlock,
    toggleAnnotationBodyCodeMark,
    toggleAnnotationBodyMark,
    type AnnotationMarkData,
    type AnnotationPresentation,
} from './annotations';
import {
    applyLocalChange,
    makeCommandContext,
    nextReplicaTs,
    previewReplicaTs,
    type DemoState,
    type EditorId,
    type Replica,
} from './blockEditorRuntime';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {
    closestCaretOffsetForHorizontalIntent,
    isCaretOnFirstVisualLine,
    isCaretOnLastVisualLine,
    readCaretHorizontalIntent,
    readPointFromMouseEvent,
    readSelectionFocusHorizontalIntent,
    readSelectionFromDom,
    restoreCaretToDom,
    restoreSelectionToDom,
} from './domSelection';
import {
    caret,
    editableBlockIds,
    firstPointForSelection,
    focusPoint,
    normalizeSelectionSegments,
    pointTextLength,
    segmentText,
    type EditorSelection,
} from './selectionModel';
import {
    deleteBackwardEverywhere,
    deleteForwardEverywhere,
    extendSelectionsHorizontally,
    extendSelectionsVertically,
    indentSelections,
    insertTextWithMarkdownShortcutsEverywhere,
    insertTextWithRetainedMarksEverywhere,
    moveSelectionsHorizontally,
    moveSelectionsVertically,
    pastePlainTextWithMarkdownShortcutsEverywhere,
    pasteRichClipboardEverywhere,
    removeLinkMarkEverywhere,
    setLinkMarkEverywhere,
    setBlockTypeEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
    updateBlockMetaEverywhere,
    unindentSelections,
    closeRetainedInlineMarkSessionsEverywhere,
    toggleCodeMarkEverywhere,
    type HorizontalMovementUnit,
    type MultiCommandResult,
    type RetainedInlineMarkSessionMap,
} from './multiSelectionCommands';
import {
    BLOCK_RICH_TEXT_MIME,
    parseBlockRichTextClipboardPayload,
    serializeSelectionToClipboardPayload,
} from './clipboard';
import {useBlockReorder, type DropTarget} from './useBlockReorder';
import {
    appendSelection,
    decorationsForSelectionSet,
    primarySelection,
    replacePrimarySelection,
    replaceSelectionSet,
    resolveSelectionSet,
    retainSelectionSet,
    singleRetainedSelectionSet,
    type BlockSelectionDecorations,
    type EditorSelectionSet,
    type RetainedSelectionSet,
} from './selectionSet';
import {findWordOccurrences, wordAtPoint} from './wordOccurrences';
import {
    applyHistoryAction,
    appendHistoryAction,
    appendHistoryKeystroke,
    initialHistoryState,
    parseHistoryExport,
    replayHistory,
    resetHistoryState,
    serializeHistory,
    setHistoryCursor,
    type HistoryAction,
    type HistoryKeystroke,
    type HistoryState,
} from './history';
import {createRedoAction, createUndoAction, deriveUndoState} from './undoHistory';
import {BlogVisualDemos} from './BlogVisualDemos';
import {
    popoverIdsForTrigger,
    useAnnotationPopoverController,
    type ActivePopover,
    type PopoverPointerTransition,
} from './useAnnotationPopoverController';
import {
    isLinkLikeText,
    linkHrefForSelectionSegments,
    linkRangeAroundOffsetInRuns,
    LINK_MARK,
    CODE_MARK,
    codeLanguageFromMarkValue,
    codeLanguageForSelectionSegments,
    codeRangeAroundOffsetInRuns,
    isCodeMarkValue,
    type BareInlineMark,
    type CodeTargetRange,
    textForSelectionSegments,
    type BooleanInlineMark,
    type LinkTargetRange,
} from './inlineMarks';
import {
    INLINE_EMBED_MARK,
    INLINE_EMBED_TEXT,
    inlineEmbedDataForRun,
    inlineEmbedPlugins,
    isInlineEmbedData,
    plainTextForInlineEmbed,
    renderInlineEmbed,
} from './inlineEmbeds';
import {highlightCode, type SyntaxToken} from './syntaxHighlight';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;
type RenderedAnnotation = ReturnType<typeof renderedAnnotations>[number];
type CommentFocusRequest = {blockId: string; token: number; selection?: EditorSelection};
type LinkPopoverState = {
    ranges: LinkTargetRange[];
    href: string;
    top: number;
    left: number;
};
type LinkHoverPopoverState = LinkPopoverState;
type CodePopoverState = {
    ranges: CodeTargetRange[];
    language: string;
    top: number;
    left: number;
};
type CodeHoverPopoverState = CodePopoverState;
type EmbedPopoverState = {
    charId: string;
    type: string;
    value: string;
    top: number;
    left: number;
};
type PendingInlineMarks = Partial<Record<BareInlineMark, boolean>>;

const BOOLEAN_INLINE_MARKS: BooleanInlineMark[] = ['bold', 'italic', 'strikethrough'];
const BARE_INLINE_MARKS: BareInlineMark[] = [...BOOLEAN_INLINE_MARKS, CODE_MARK];

const activePendingInlineMarks = (marks: PendingInlineMarks): BareInlineMark[] =>
    BARE_INLINE_MARKS.filter((mark) => marks[mark]);

const hasPendingInlineMarks = (marks: PendingInlineMarks): boolean =>
    activePendingInlineMarks(marks).length > 0;

const hasRetainedInlineMarkSessions = (marks: RetainedInlineMarkSessionMap): boolean =>
    Object.values(marks).some((sessions) => sessions.length > 0);

export function App() {
    return hasDemoQuery() ? <BlogVisualDemos /> : <EditorApp />;
}

const actionsSharePrefix = (
    actions: HistoryAction[],
    prefix: HistoryAction[],
    length: number,
): boolean => {
    if (prefix.length < length || actions.length < length) return false;
    for (let index = 0; index < length; index++) {
        if (actions[index] !== prefix[index]) return false;
    }
    return true;
};

const deriveToolbarUndoState = (
    history: HistoryState,
    editorId: EditorId,
): ReturnType<typeof deriveUndoState> => {
    const undoStack: string[] = [];
    const redoStack: string[] = [];
    const cursor = Math.max(0, Math.min(history.cursor, history.actions.length));

    for (const action of history.actions.slice(0, cursor)) {
        if (action.type !== 'local-change' || action.command?.actor !== editorId) continue;
        const command = action.command;
        if (command.intent === 'edit') {
            undoStack.push(command.id);
            redoStack.splice(0);
        } else if (command.intent === 'undo' && command.targetCommandId) {
            removeLast(undoStack, command.targetCommandId);
            redoStack.push(command.targetCommandId);
        } else if (command.intent === 'redo' && command.targetCommandId) {
            removeLast(redoStack, command.targetCommandId);
            undoStack.push(command.targetCommandId);
        }
    }

    return {canUndo: undoStack.length > 0, canRedo: redoStack.length > 0};
};

const removeLast = (items: string[], value: string) => {
    const index = items.lastIndexOf(value);
    if (index >= 0) items.splice(index, 1);
};

function EditorApp() {
    const [history, setHistory] = useState<HistoryState>(() => initialHistoryState());
    const [transientSelections, setTransientSelections] = useState<
        Partial<Record<EditorId, RetainedSelectionSet>>
    >({});
    const [historyStatus, setHistoryStatus] = useState('');
    const [undoStatus, setUndoStatus] = useState<Partial<Record<EditorId, string>>>({});
    const [historyResetSignal, setHistoryResetSignal] = useState(0);
    const importInputRef = useRef<HTMLInputElement>(null);
    const replayCacheRef = useRef<{
        actions: HistoryAction[];
        cursor: number;
        demo: DemoState;
    } | null>(null);
    const demo = useMemo(() => {
        const cached = replayCacheRef.current;
        if (cached && cached.actions === history.actions && cached.cursor === history.cursor) {
            return cached.demo;
        }
        if (
            cached &&
            history.cursor === cached.cursor + 1 &&
            history.actions.length >= history.cursor &&
            actionsSharePrefix(history.actions, cached.actions, cached.cursor)
        ) {
            const nextDemo = applyHistoryAction(cached.demo, history.actions[history.cursor - 1]);
            replayCacheRef.current = {
                actions: history.actions,
                cursor: history.cursor,
                demo: nextDemo,
            };
            return nextDemo;
        }

        const nextDemo = replayHistory(history.actions, history.cursor);
        replayCacheRef.current = {actions: history.actions, cursor: history.cursor, demo: nextDemo};
        return nextDemo;
    }, [history.actions, history.cursor]);
    const displayDemo = useMemo(
        () => overlayTransientSelections(demo, transientSelections),
        [demo, transientSelections],
    );
    const undoStates = useMemo(
        () => ({
            left: deriveToolbarUndoState(history, 'left'),
            right: deriveToolbarUndoState(history, 'right'),
        }),
        [history.actions, history.cursor],
    );

    const clearReplayUiState = useCallback(() => {
        setTransientSelections({});
        setHistoryResetSignal((current) => current + 1);
    }, []);

    const runCommand = useCallback(
        (editorId: EditorId, command: (replica: Replica) => MultiCommandResult) => {
            const replica = displayDemo[editorId];
            const result = command(replica);
            if (!result.ops.length) {
                setTransientSelections((current) => ({...current, [editorId]: result.selection}));
                return;
            }
            const commandId = nextReplicaTs(replica);
            setHistory((current) => {
                const action: HistoryAction = {
                    type: 'local-change',
                    editorId,
                    ops: result.ops,
                    selection: result.selection,
                    command: {
                        id: commandId,
                        actor: replica.actor,
                        intent: 'edit',
                        beforeSelection: replica.selection,
                        afterSelection: result.selection,
                    },
                };
                const nextHistory = appendHistoryAction(current, action);
                if (
                    nextHistory.cursor === current.cursor + 1 &&
                    nextHistory.actions.length === current.actions.length + 1
                ) {
                    replayCacheRef.current = {
                        actions: nextHistory.actions,
                        cursor: nextHistory.cursor,
                        demo: applyLocalChange(displayDemo, {
                            editorId,
                            state: result.state,
                            selection: result.selection,
                            ops: result.ops,
                        }),
                    };
                }
                return nextHistory;
            });
            setTransientSelections((current) => {
                const next = {...current};
                delete next[editorId];
                return next;
            });
            setHistoryStatus('');
            setUndoStatus((current) => ({...current, [editorId]: ''}));
        },
        [displayDemo],
    );

    const updateCursor = useCallback(
        (cursor: number) => {
            setHistory((current) => setHistoryCursor(current, cursor));
            clearReplayUiState();
            setHistoryStatus('');
            setUndoStatus({});
        },
        [clearReplayUiState],
    );

    const toggleEditorOnline = useCallback((editorId: EditorId) => {
        setHistory((current) => appendHistoryAction(current, {type: 'toggle-online', editorId}));
        setHistoryStatus('');
        setUndoStatus((current) => ({...current, [editorId]: ''}));
    }, []);

    const recordKeystroke = useCallback(
        (editorId: EditorId, blockId: string, event: KeyboardEvent<HTMLElement>) => {
            setHistory((current) =>
                appendHistoryKeystroke(current, {
                    editorId,
                    blockId,
                    key: event.key,
                    code: event.code,
                    altKey: event.altKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                    repeat: event.repeat,
                }),
            );
        },
        [],
    );

    const exportHistory = useCallback(() => {
        const blob = new Blob([serializeHistory(history)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'block-rich-text-history.json';
        link.click();
        URL.revokeObjectURL(url);
        setHistoryStatus(`Exported ${history.actions.length} actions.`);
    }, [history]);

    const importHistoryFile = useCallback(
        async (file: File) => {
            if (history.actions.length && !window.confirm('Replace the current history?')) return;
            const text = await file.text();
            const parsed = parseHistoryExport(text);
            if ('error' in parsed) {
                setHistoryStatus(parsed.error);
                return;
            }
            setHistory(parsed.history);
            clearReplayUiState();
            setHistoryStatus(`Imported ${parsed.history.actions.length} actions.`);
            setUndoStatus({});
        },
        [clearReplayUiState, history.actions.length],
    );

    const resetHistory = useCallback(() => {
        if (history.actions.length && !window.confirm('Reset the current history?')) return;
        setHistory(resetHistoryState());
        clearReplayUiState();
        setHistoryStatus('');
        setUndoStatus({});
    }, [clearReplayUiState, history.actions.length]);

    const runUndoCommand = useCallback(
        (editorId: EditorId, direction: 'undo' | 'redo') => {
            const result =
                direction === 'undo'
                    ? createUndoAction(history, editorId)
                    : createRedoAction(history, editorId);
            if ('error' in result) {
                setUndoStatus((current) => ({...current, [editorId]: result.error}));
                return;
            }
            setHistory((current) => appendHistoryAction(current, result.action));
            setTransientSelections((current) => {
                const next = {...current};
                delete next[editorId];
                return next;
            });
            setUndoStatus((current) => ({...current, [editorId]: ''}));
            setHistoryStatus('');
        },
        [history],
    );

    return (
        <main className="appShell">
            <header className="topBar">
                <h1>Block Rich Text CRDT</h1>
                <p>Two local replicas exchange block rich-text operations.</p>
            </header>
            <section className="historyControls" aria-label="History controls">
                <input
                    type="range"
                    min={0}
                    max={history.actions.length}
                    value={history.cursor}
                    aria-label="History position"
                    onChange={(event) => updateCursor(Number(event.currentTarget.value))}
                />
                <span className="historyCount">
                    {history.cursor} / {history.actions.length}
                </span>
                <button type="button" onClick={exportHistory}>
                    Export
                </button>
                <button type="button" onClick={() => importInputRef.current?.click()}>
                    Import
                </button>
                <button type="button" onClick={resetHistory}>
                    Reset
                </button>
                <input
                    ref={importInputRef}
                    className="historyImportInput"
                    type="file"
                    accept="application/json,.json"
                    aria-label="Import history file"
                    onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file) void importHistoryFile(file);
                    }}
                />
                {historyStatus ? <span className="historyStatus">{historyStatus}</span> : null}
            </section>
            <details className="keystrokeLog">
                <summary>Keystrokes ({history.keystrokes.length})</summary>
                {history.keystrokes.length ? (
                    <ol>
                        {history.keystrokes.slice(-120).map((keystroke) => (
                            <li key={keystroke.sequence}>
                                <span>#{keystroke.sequence}</span>
                                <span>
                                    {keystroke.editorId === 'left' ? 'Editor A' : 'Editor B'}
                                </span>
                                <span>{formatKeystroke(keystroke)}</span>
                                <span>at {keystroke.actionIndex}</span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p>No keystrokes recorded.</p>
                )}
            </details>
            <section className="editorGrid" aria-label="Synced block editors">
                <BlockEditor
                    replica={displayDemo.left}
                    resetSignal={historyResetSignal}
                    undoState={undoStates.left}
                    undoStatus={undoStatus.left ?? ''}
                    onCommand={(command) => runCommand('left', command)}
                    onUndo={() => runUndoCommand('left', 'undo')}
                    onRedo={() => runUndoCommand('left', 'redo')}
                    onToggleOnline={() => toggleEditorOnline('left')}
                    onKeystroke={(blockId, event) => recordKeystroke('left', blockId, event)}
                />
                <BlockEditor
                    replica={displayDemo.right}
                    resetSignal={historyResetSignal}
                    undoState={undoStates.right}
                    undoStatus={undoStatus.right ?? ''}
                    onCommand={(command) => runCommand('right', command)}
                    onUndo={() => runUndoCommand('right', 'undo')}
                    onRedo={() => runUndoCommand('right', 'redo')}
                    onToggleOnline={() => toggleEditorOnline('right')}
                    onKeystroke={(blockId, event) => recordKeystroke('right', blockId, event)}
                />
            </section>
        </main>
    );
}

const hasDemoQuery = () =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demos');

function BlockEditor({
    replica,
    resetSignal,
    undoState,
    undoStatus,
    onCommand,
    onUndo,
    onRedo,
    onToggleOnline,
    onKeystroke,
}: {
    replica: Replica;
    resetSignal: number;
    undoState: ReturnType<typeof deriveUndoState>;
    undoStatus: string;
    onCommand(command: (replica: Replica) => MultiCommandResult): void;
    onUndo(): void;
    onRedo(): void;
    onToggleOnline(): void;
    onKeystroke(blockId: string, event: KeyboardEvent<HTMLElement>): void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const editorContentRef = useRef<HTMLDivElement>(null);
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const verticalCaretXRef = useRef<number | null>(null);
    const nextSelectionIdRef = useRef(1);
    const nextCommentFocusTokenRef = useRef(1);
    const handledTripleClickRef = useRef(false);
    const handledNavigationKeyRef = useRef(false);
    const pendingMultiselectClickRef = useRef<{
        point: {blockId: string; offset: number};
        x: number;
        y: number;
    } | null>(null);
    const pendingAddSelectionClickRef = useRef<{
        point: {blockId: string; offset: number};
        x: number;
        y: number;
    } | null>(null);
    const linkHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const codeHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hasFocus, setHasFocus] = useState(false);
    const [isExtendingSelection, setIsExtendingSelection] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [commentFocusRequest, setCommentFocusRequest] = useState<CommentFocusRequest | null>(
        null,
    );
    const [lastEditedCommentBodyByAnnotation, setLastEditedCommentBodyByAnnotation] = useState<
        Record<string, string>
    >({});
    const [commentGutterTops, setCommentGutterTops] = useState<Record<string, number>>({});
    const [activeAnnotationBodySelection, setActiveAnnotationBodySelection] =
        useState<EditorSelection | null>(null);
    const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);
    const [linkHoverPopover, setLinkHoverPopover] = useState<LinkHoverPopoverState | null>(null);
    const [codePopover, setCodePopover] = useState<CodePopoverState | null>(null);
    const [codeHoverPopover, setCodeHoverPopover] = useState<CodeHoverPopoverState | null>(null);
    const [embedPopover, setEmbedPopover] = useState<EmbedPopoverState | null>(null);
    const [pendingInlineMarks, setPendingInlineMarks] = useState<PendingInlineMarks>({});
    const [retainedInlineMarks, setRetainedInlineMarks] = useState<RetainedInlineMarkSessionMap>(
        {},
    );
    const blocksWithAnnotationBodies = materializeFormattedBlocks(
        replica.state,
        annotationVirtualParents(replica.state),
    );
    const annotationBodyIds = useMemo(() => {
        const result = new Set<string>();
        for (const mark of Object.values(replica.state.state.marks)) {
            if (mark.type !== ANNOTATION_MARK || mark.remove || !isAnnotationData(mark.data))
                continue;
            for (const bodyId of annotationBodyBlockIds(replica.state, mark.data.id)) {
                result.add(bodyId);
            }
        }
        return result;
    }, [replica.state]);
    const blocks = useMemo(
        () => blocksWithAnnotationBodies.filter((block) => !annotationBodyIds.has(block.id)),
        [annotationBodyIds, blocksWithAnnotationBodies],
    );
    const annotations = renderedAnnotations(replica.state, blocks, blocksWithAnnotationBodies);
    const sidebarAnnotations = useMemo(
        () => annotations.filter((item) => item.data.presentation === 'sidebar'),
        [annotations],
    );
    const sidebarAnnotationKey = sidebarAnnotations.map((annotation) => annotation.id).join('\0');
    const popoverAnnotationsById = useMemo(() => {
        const result = new Map<string, RenderedAnnotation>();
        for (const annotation of annotations) {
            if (annotation.data.presentation === 'popover') result.set(annotation.id, annotation);
        }
        return result;
    }, [annotations]);
    const popoverTextById = useMemo(() => {
        const result = new Map<string, string>();
        for (const annotation of annotations) {
            if (annotation.data.presentation !== 'popover') continue;
            const text = annotation.bodyBlocks
                .map((block) => block.text)
                .filter(Boolean)
                .join('\n');
            result.set(annotation.id, text || 'Empty popover');
        }
        return result;
    }, [annotations]);
    const footnoteNumberById = useMemo(() => {
        const result = new Map<string, number>();
        let nextNumber = 1;
        for (const annotation of annotations) {
            if (annotation.data.presentation !== 'footnote') continue;
            result.set(annotation.id, nextNumber);
            nextNumber++;
        }
        return result;
    }, [annotations]);
    const renderTree = useMemo(() => buildRenderTree(blocks), [blocks]);
    const charIdsByBlock = useMemo(() => {
        const result = new Map<string, string[]>();
        for (const block of blocksWithAnnotationBodies) {
            result.set(block.id, orderedCharIdsForBlock(replica.state, block.id, {visibleOnly: true}));
        }
        return result;
    }, [blocksWithAnnotationBodies, replica.state]);
    const orderedListNumbers = useMemo(() => deriveOrderedListNumbers(blocks), [blocks]);
    const resolvedSelectionSet = resolveSelectionSet(replica.state, replica.selection);
    const primaryResolvedSelection = primarySelection(resolvedSelectionSet);
    const selectedPopoverSelection = activeAnnotationBodySelection ?? primaryResolvedSelection;
    const selectedPopoverSelectionKey = editorSelectionKey(selectedPopoverSelection);
    const selectedPopoverIds = useMemo(
        () =>
            selectedPopoverIdsForSelection(
                blocksWithAnnotationBodies,
                selectedPopoverSelection,
                popoverTextById,
            ),
        [blocksWithAnnotationBodies, popoverTextById, selectedPopoverSelectionKey],
    );
    const selectedPopoverIdsKey = selectedPopoverIds.join('\0');
    const selectedBlockType = blockTypeMenuValue(
        replica.state.state.blocks[focusPoint(primaryResolvedSelection).blockId]?.meta,
    );
    const activeInlineMarks = useMemo(
        () =>
            deriveActiveInlineMarks(
                replica.state,
                blocks,
                primaryResolvedSelection,
                pendingInlineMarks,
            ),
        [blocks, pendingInlineMarks, primaryResolvedSelection, replica.state],
    );
    const decorationsByBlock = useMemo(
        () =>
            decorationsForSelectionSet(replica.state, resolvedSelectionSet, {
                includePrimary: !hasFocus || isExtendingSelection,
                includePrimaryBoundaryCaret: true,
            }),
        [hasFocus, isExtendingSelection, replica.state, resolvedSelectionSet],
    );
    const {draggingId, draggingSubtreeIds, dropTarget, registerRow, startDrag} = useBlockReorder({
        blocks: blocks.map(({id, depth, parentId}) => ({id, depth, parentId})),
        onMove: (blockId, target) =>
            onCommand((current) => {
                const result = moveBlock(
                    current.state,
                    blockId,
                    target,
                    makeCommandContext(current),
                );
                return {state: result.state, ops: result.ops, selection: current.selection};
            }),
    });

    const scheduleSelectionRestore = useCallback((selection: EditorSelection) => {
        if (selection.type === 'caret') {
            pendingCaretRestoreBlockIdRef.current = selection.point.blockId;
            pendingSelectionRestoreRef.current = null;
            return;
        }
        pendingCaretRestoreBlockIdRef.current = null;
        pendingSelectionRestoreRef.current = selection;
    }, []);

    const {
        activePopovers,
        cancelPopoverHide,
        closeAllPopovers,
        closeDeepestPopover,
        schedulePopoverHideFromPointer,
        setPopoverFocusPinned,
        showPopover,
    } = useAnnotationPopoverController({
        rootRef,
        selectedPopoverIds,
        selectedPopoverIdsKey,
        selectedPopoverSelectionKey,
    });

    const resetVerticalCaretIntent = useCallback(() => {
        verticalCaretXRef.current = null;
    }, []);

    const clearPendingInlineMarks = useCallback(() => {
        setPendingInlineMarks((current) =>
            hasPendingInlineMarks(current) && !hasRetainedInlineMarkSessions(retainedInlineMarks)
                ? {}
                : current,
        );
    }, [retainedInlineMarks]);

    const nextSelectionId = useCallback(() => `sel-${nextSelectionIdRef.current++}`, []);

    const requestCommentFocus = useCallback(
        (blockId: string | null | undefined, selection?: EditorSelection) => {
            if (!blockId) return;
            setCommentFocusRequest({blockId, selection, token: nextCommentFocusTokenRef.current++});
        },
        [],
    );

    const recordCommentBodyActivity = useCallback((annotationId: string, bodyBlockId: string) => {
        setLastEditedCommentBodyByAnnotation((current) =>
            current[annotationId] === bodyBlockId
                ? current
                : {...current, [annotationId]: bodyBlockId},
        );
    }, []);

    const focusBodyBlockForAnnotation = useCallback(
        (annotation: RenderedAnnotation): string | null => {
            const bodyIds = annotation.bodyBlocks.map((block) => block.id);
            const lastEdited = lastEditedCommentBodyByAnnotation[annotation.id];
            if (lastEdited && bodyIds.includes(lastEdited)) return lastEdited;
            return bodyIds.at(-1) ?? bodyIds[0] ?? null;
        },
        [lastEditedCommentBodyByAnnotation],
    );

    const handleSidebarCommentCreated = useCallback(
        (result: ReturnType<typeof createAnnotation>) => {
            if (!result.ops.length || !result.annotationId || !result.bodyBlockId) return;
            const annotationId = lamportToString(result.annotationId);
            setCommentsOpen(true);
            recordCommentBodyActivity(annotationId, result.bodyBlockId);
            requestCommentFocus(result.bodyBlockId);
        },
        [recordCommentBodyActivity, requestCommentFocus],
    );

    useLayoutEffect(() => {
        const root = rootRef.current;
        const content = editorContentRef.current;
        if (!root || !content || !sidebarAnnotations.length) {
            setCommentGutterTops((current) => (Object.keys(current).length ? {} : current));
            return;
        }

        const measure = () => {
            const contentRect = content.getBoundingClientRect();
            const rootRect = root.getBoundingClientRect();
            const minTop = Math.max(12, rootRect.top - contentRect.top + 12);
            const maxTop = Math.max(minTop, rootRect.bottom - contentRect.top - 12);
            const desired = sidebarAnnotations.map((annotation, index) => {
                const selector = `[data-sidebar-annotation-ids~="${CSS.escape(annotation.id)}"]`;
                const trigger = root.querySelector<HTMLElement>(selector);
                const triggerRect = trigger?.getBoundingClientRect();
                if (triggerRect && (triggerRect.height || triggerRect.top)) {
                    return {
                        id: annotation.id,
                        top: triggerRect.top - contentRect.top + triggerRect.height / 2,
                    };
                }

                const range = visibleRangesForMark(
                    replica.state,
                    annotation.mark,
                    annotationVirtualParents(replica.state),
                )[0];
                if (range) {
                    const block = root.querySelector<HTMLElement>(
                        `[data-block-id="${CSS.escape(range.blockId)}"]`,
                    );
                    const blockRect = block?.getBoundingClientRect();
                    if (blockRect && (blockRect.height || blockRect.top)) {
                        return {
                            id: annotation.id,
                            top: blockRect.top - contentRect.top + blockRect.height / 2,
                        };
                    }
                }

                return {id: annotation.id, top: minTop + index * 24};
            });

            desired.sort((a, b) => a.top - b.top);
            const next: Record<string, number> = {};
            let previousTop = minTop - 24;
            for (const item of desired) {
                const top = Math.min(maxTop, Math.max(minTop, item.top, previousTop + 24));
                next[item.id] = top;
                previousTop = top;
            }
            setCommentGutterTops((current) => (numberRecordEquals(current, next) ? current : next));
        };

        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [commentsOpen, replica.state, sidebarAnnotationKey]);

    useLayoutEffect(() => {
        pendingCaretRestoreBlockIdRef.current = null;
        pendingSelectionRestoreRef.current = null;
        verticalCaretXRef.current = null;
        pendingMultiselectClickRef.current = null;
        pendingAddSelectionClickRef.current = null;
        handledTripleClickRef.current = false;
        handledNavigationKeyRef.current = false;
        setIsExtendingSelection(false);
        setLinkPopover(null);
        setLinkHoverPopover(null);
        setCodePopover(null);
        setCodeHoverPopover(null);
        setPendingInlineMarks({});
        setRetainedInlineMarks({});
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = null;
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = null;
    }, [resetSignal]);

    useLayoutEffect(
        () => () => {
            if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
            if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        },
        [],
    );

    const captureSelection = useCallback(
        (event: MouseEvent | KeyboardEvent) => {
            if (event.type === 'mouseup') {
                resetVerticalCaretIntent();
                setIsExtendingSelection(false);
                if ('detail' in event && event.detail === 3 && handledTripleClickRef.current) {
                    handledTripleClickRef.current = false;
                    return;
                }
            } else if (
                'key' in event &&
                event.type === 'keyup' &&
                isPlainArrowKey(event.key) &&
                handledNavigationKeyRef.current
            ) {
                handledNavigationKeyRef.current = false;
                return;
            } else if ('key' in event && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                resetVerticalCaretIntent();
            }
            const root = rootRef.current;
            if (!root) return;
            if (event.type === 'mouseup' && pendingMultiselectClickRef.current) {
                const pendingClick = pendingMultiselectClickRef.current;
                pendingMultiselectClickRef.current = null;
                if (isSameClick(pendingClick, event)) {
                    const selection = caret(pendingClick.point.blockId, pendingClick.point.offset);
                    scheduleSelectionRestore(selection);
                    onCommand((current) => ({
                        state: current.state,
                        ops: [],
                        selection: replaceSelectionSet(
                            current.state,
                            selection,
                            current.selection.primaryId,
                        ),
                    }));
                    return;
                }
            }
            if (event.type === 'mouseup' && pendingAddSelectionClickRef.current) {
                const pendingClick = pendingAddSelectionClickRef.current;
                pendingAddSelectionClickRef.current = null;
                if (
                    isSameClick(pendingClick, event) &&
                    'metaKey' in event &&
                    (event.metaKey || event.ctrlKey)
                ) {
                    const selection = caret(pendingClick.point.blockId, pendingClick.point.offset);
                    scheduleSelectionRestore(selection);
                    onCommand((current) => ({
                        state: current.state,
                        ops: [],
                        selection: appendSelection(
                            current.state,
                            current.selection,
                            selection,
                            nextSelectionId(),
                        ),
                    }));
                    return;
                }
            }
            const selection = readSelectionFromDom(root);
            if (!selection) return;
            if (event.type === 'mouseup' && 'detail' in event && event.detail === 3) {
                scheduleSelectionRestore(selection);
                onCommand((current) => ({
                    state: current.state,
                    ops: [],
                    selection: occurrenceSelectionSet(
                        current.state,
                        selection,
                        nextSelectionId,
                        current.selection,
                    ),
                }));
                return;
            }
            const addSelection = 'metaKey' in event && (event.metaKey || event.ctrlKey);
            scheduleSelectionRestore(selection);
            onCommand((current) => ({
                state: current.state,
                ops: [],
                selection: addSelection
                    ? appendSelection(
                          current.state,
                          current.selection,
                          selection,
                          nextSelectionId(),
                      )
                    : event.type === 'keyup'
                      ? replacePrimarySelection(current.state, current.selection, selection)
                      : replaceSelectionSet(current.state, selection, current.selection.primaryId),
            }));
        },
        [
            clearPendingInlineMarks,
            nextSelectionId,
            onCommand,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const captureMouseDown = useCallback(
        (event: MouseEvent<HTMLElement>) => {
            const elementConstructor = event.currentTarget.ownerDocument.defaultView?.Element;
            if (
                elementConstructor &&
                event.target instanceof elementConstructor &&
                !event.target.closest('[data-popover-id]')
            ) {
                closeAllPopovers();
            }
            if (
                elementConstructor &&
                event.target instanceof elementConstructor &&
                !event.target.closest('.linkFloatingPopover')
            ) {
                setLinkPopover(null);
                setLinkHoverPopover(null);
                if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
                linkHoverHideTimerRef.current = null;
            }
            if (
                elementConstructor &&
                event.target instanceof elementConstructor &&
                !event.target.closest('.codeFloatingPopover')
            ) {
                setCodePopover(null);
                setCodeHoverPopover(null);
                if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
                codeHoverHideTimerRef.current = null;
            }
            setIsExtendingSelection(
                event.detail <= 1 && !event.shiftKey && (event.metaKey || event.ctrlKey),
            );
            const root = rootRef.current;
            if (!root) return;
            const point = readPointFromMouseEvent(root, event.nativeEvent);
            if (!point) return;

            if (
                event.detail <= 1 &&
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey
            ) {
                pendingAddSelectionClickRef.current = {
                    point,
                    x: event.clientX,
                    y: event.clientY,
                };
                return;
            }

            if (
                event.detail <= 1 &&
                resolvedSelectionSet.entries.length > 1 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
            ) {
                pendingMultiselectClickRef.current = {
                    point,
                    x: event.clientX,
                    y: event.clientY,
                };
                return;
            }

            if (event.detail !== 3) return;

            event.preventDefault();
            handledTripleClickRef.current = true;
            resetVerticalCaretIntent();
            const selection = caret(point.blockId, point.offset);
            onCommand((current) => {
                const nextSelection = occurrenceSelectionSet(
                    current.state,
                    selection,
                    nextSelectionId,
                    current.selection,
                );
                scheduleSelectionRestore(
                    primarySelection(resolveSelectionSet(current.state, nextSelection)),
                );
                return {
                    state: current.state,
                    ops: [],
                    selection: nextSelection,
                };
            });
        },
        [
            nextSelectionId,
            closeAllPopovers,
            onCommand,
            resetVerticalCaretIntent,
            resolvedSelectionSet.entries.length,
            scheduleSelectionRestore,
        ],
    );

    const liveSelectionSet = useCallback((current: Replica): RetainedSelectionSet => {
        const root = rootRef.current;
        const selection = root ? readSelectionFromDom(root) : null;
        return selection
            ? replacePrimarySelection(current.state, current.selection, selection)
            : current.selection;
    }, []);

    const runEditCommand = useCallback(
        (command: (current: Replica, selection: RetainedSelectionSet) => MultiCommandResult) => {
            onCommand((current) => {
                resetVerticalCaretIntent();
                const selection = liveSelectionSet(current);
                const result = command(current, selection);
                const primaryResultSelection = primarySelection(
                    resolveSelectionSet(result.state, result.selection),
                );
                scheduleSelectionRestore(primaryResultSelection);
                return result;
            });
        },
        [liveSelectionSet, onCommand, resetVerticalCaretIntent, scheduleSelectionRestore],
    );

    const copyRichSelection = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const payload = serializeSelectionToClipboardPayload(
                replica.state,
                liveSelectionSet(replica),
            );
            if (!payload) return;
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.plainText);
            event.clipboardData.setData('text/html', payload.html);
        },
        [liveSelectionSet, replica],
    );

    const pasteFromClipboard = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const rich = parseBlockRichTextClipboardPayload(
                event.clipboardData.getData(BLOCK_RICH_TEXT_MIME),
            );
            if (rich) {
                event.preventDefault();
                runEditCommand((current, selection) =>
                    pasteRichClipboardEverywhere(
                        current.state,
                        selection,
                        rich,
                        makeCommandContext(current),
                    ),
                );
                return;
            }

            event.preventDefault();
            const text = event.clipboardData.getData('text/plain');
            runEditCommand((current, selection) => {
                const primary = primarySelection(resolveSelectionSet(current.state, selection));
                if (isLinkLikeText(text) && primary.type === 'range') {
                    return setLinkMarkEverywhere(
                        current.state,
                        selection,
                        text.trim(),
                        makeCommandContext(current),
                    );
                }
                return pastePlainTextWithMarkdownShortcutsEverywhere(
                    current.state,
                    selection,
                    text,
                    makeCommandContext(current),
                );
            });
        },
        [runEditCommand],
    );

    const runInlineMarkToggle = useCallback(
        (markType: BooleanInlineMark) => {
            onCommand((current) => {
                resetVerticalCaretIntent();
                const selection = liveSelectionSet(current);
                const resolved = resolveSelectionSet(current.state, selection);
                if (resolved.entries.every((entry) => entry.selection.type === 'caret')) {
                    const primary = primarySelection(resolved);
                    scheduleSelectionRestore(primary);
                    if (pendingInlineMarks[markType]) {
                        const result = closeRetainedInlineMarkSessionsEverywhere(
                            current.state,
                            selection,
                            retainedInlineMarks,
                            markType,
                            makeCommandContext(current),
                        );
                        setRetainedInlineMarks(result.retainedMarks);
                        setPendingInlineMarks((currentMarks) => ({
                            ...currentMarks,
                            [markType]: false,
                        }));
                        return result;
                    }
                    setPendingInlineMarks((currentMarks) => ({
                        ...currentMarks,
                        [markType]: true,
                    }));
                    return {state: current.state, ops: [], selection};
                }

                clearPendingInlineMarks();
                const result = toggleMarkEverywhere(
                    current.state,
                    selection,
                    markType,
                    makeCommandContext(current),
                );
                const primaryResultSelection = primarySelection(
                    resolveSelectionSet(result.state, result.selection),
                );
                scheduleSelectionRestore(primaryResultSelection);
                return result;
            });
        },
        [
            clearPendingInlineMarks,
            liveSelectionSet,
            onCommand,
            pendingInlineMarks,
            retainedInlineMarks,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const runCodeToggle = useCallback(() => {
        onCommand((current) => {
            resetVerticalCaretIntent();
            const selection = liveSelectionSet(current);
            const resolved = resolveSelectionSet(current.state, selection);
            if (resolved.entries.every((entry) => entry.selection.type === 'caret')) {
                const primary = primarySelection(resolved);
                scheduleSelectionRestore(primary);
                if (pendingInlineMarks[CODE_MARK]) {
                    const result = closeRetainedInlineMarkSessionsEverywhere(
                        current.state,
                        selection,
                        retainedInlineMarks,
                        CODE_MARK,
                        makeCommandContext(current),
                    );
                    setRetainedInlineMarks(result.retainedMarks);
                    setPendingInlineMarks((currentMarks) => ({
                        ...currentMarks,
                        [CODE_MARK]: false,
                    }));
                    return result;
                }
                setPendingInlineMarks((currentMarks) => ({
                    ...currentMarks,
                    [CODE_MARK]: true,
                }));
                return {state: current.state, ops: [], selection};
            }

            clearPendingInlineMarks();
            const result = toggleCodeMarkEverywhere(
                current.state,
                selection,
                makeCommandContext(current),
            );
            const primaryResultSelection = primarySelection(
                resolveSelectionSet(result.state, result.selection),
            );
            scheduleSelectionRestore(primaryResultSelection);
            return result;
        });
    }, [
        clearPendingInlineMarks,
        liveSelectionSet,
        onCommand,
        pendingInlineMarks,
        retainedInlineMarks,
        resetVerticalCaretIntent,
        scheduleSelectionRestore,
    ]);

    const insertTextWithPendingMarks = useCallback(
        (current: Replica, selection: RetainedSelectionSet, text: string): MultiCommandResult => {
            const activeMarks = activePendingInlineMarks(pendingInlineMarks);
            if (!activeMarks.length) {
                return insertTextWithMarkdownShortcutsEverywhere(
                    current.state,
                    selection,
                    text,
                    makeCommandContext(current),
                );
            }
            const resolved = resolveSelectionSet(current.state, selection);
            if (!resolved.entries.every((entry) => entry.selection.type === 'caret')) {
                return insertTextWithMarkdownShortcutsEverywhere(
                    current.state,
                    selection,
                    text,
                    makeCommandContext(current),
                );
            }
            const result = insertTextWithRetainedMarksEverywhere(
                current.state,
                selection,
                text,
                activeMarks,
                retainedInlineMarks,
                makeCommandContext(current),
            );
            setRetainedInlineMarks(result.retainedMarks);
            return result;
        },
        [pendingInlineMarks, retainedInlineMarks],
    );

    const runBlockControlCommand = useCallback(
        (command: (current: Replica) => MultiCommandResult) => {
            onCommand((current) => command(current));
        },
        [onCommand],
    );

    const insertDateEmbedFromCurrentSelection = useCallback(() => {
        runEditCommand((current, selection) => {
            const result = insertInlineEmbed(
                current.state,
                primarySelection(resolveSelectionSet(current.state, selection)),
                {type: 'date', value: '2026-06-23'},
                makeCommandContext(current),
            );
            return {
                state: result.state,
                ops: result.ops,
                selection: replacePrimarySelection(result.state, selection, result.selection),
            };
        });
    }, [runEditCommand]);

    const openEmbedPopover = useCallback(
        (charId: string, element: HTMLElement) => {
            const data = inlineEmbedDataByCharId(replica.state, charId);
            if (!data) return;
            setEmbedPopover({
                charId,
                type: data.type,
                value: data.value,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [replica.state],
    );

    const applyEmbedPopover = useCallback(
        (value: string) => {
            const target = embedPopover;
            setEmbedPopover(null);
            if (!target) return;
            runBlockControlCommand((current) => {
                const result = setInlineEmbedDataByCharId(
                    current.state,
                    target.charId,
                    {type: target.type, value},
                    makeCommandContext(current),
                );
                if (!commandApplied(result)) return {state: current.state, ops: [], selection: current.selection};
                return {state: result.state, ops: result.ops, selection: current.selection};
            });
        },
        [embedPopover, runBlockControlCommand],
    );

    const applyLinkToRanges = useCallback(
        (ranges: LinkTargetRange[], href: string) => {
            runBlockControlCommand((current) => {
                const rangeSelection = retainedSelectionSetForRanges(current.state, ranges, 'link');
                const result = setLinkMarkEverywhere(
                    current.state,
                    rangeSelection,
                    href,
                    makeCommandContext(current),
                );
                return {state: result.state, ops: result.ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const removeLinkFromRanges = useCallback(
        (ranges: LinkTargetRange[]) => {
            runBlockControlCommand((current) => {
                const rangeSelection = retainedSelectionSetForRanges(current.state, ranges, 'link');
                const result = removeLinkMarkEverywhere(
                    current.state,
                    rangeSelection,
                    makeCommandContext(current),
                );
                return {state: result.state, ops: result.ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const applyCodeLanguageToRanges = useCallback(
        (ranges: CodeTargetRange[], language: string) => {
            runBlockControlCommand((current) => {
                const context = makeCommandContext(current);
                let working = current.state;
                const ops: CommandResult['ops'] = [];
                for (const range of ranges) {
                    const result = setCodeMark(working, rangeSelectionFromRange(range), language, context);
                    working = result.state;
                    ops.push(...result.ops);
                }
                return {state: working, ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const clearCodeLanguageFromRanges = useCallback(
        (ranges: CodeTargetRange[]) => {
            runBlockControlCommand((current) => {
                const context = makeCommandContext(current);
                let working = current.state;
                const ops: CommandResult['ops'] = [];
                for (const range of ranges) {
                    const result = clearCodeLanguage(working, rangeSelectionFromRange(range), context);
                    working = result.state;
                    ops.push(...result.ops);
                }
                return {state: working, ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const removeCodeFromRanges = useCallback(
        (ranges: CodeTargetRange[]) => {
            runBlockControlCommand((current) => {
                const context = makeCommandContext(current);
                let working = current.state;
                const ops: CommandResult['ops'] = [];
                for (const range of ranges) {
                    const result = removeCodeMark(working, rangeSelectionFromRange(range), context);
                    working = result.state;
                    ops.push(...result.ops);
                }
                return {state: working, ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const openLinkPopoverForRanges = useCallback(
        (
            state: Replica['state'],
            ranges: LinkTargetRange[],
            position: {top: number; left: number},
        ) => {
            if (!ranges.length) return;
            const formatted = materializeFormattedBlocks(state, annotationMarkBehavior);
            setLinkPopover({
                ranges,
                href: linkHrefForSelectionSegments(formatted, ranges) ?? '',
                ...position,
            });
        },
        [],
    );

    const openLinkFromCurrentSelection = useCallback(() => {
        onCommand((current) => {
            const selection = liveSelectionSet(current);
            const ranges = linkRangesForSelectionSet(current.state, selection);
            const formatted = materializeFormattedBlocks(current.state, annotationMarkBehavior);
            if (ranges.length) {
                const selectedText = textForSelectionSegments(formatted, ranges).trim();
                if (isLinkLikeText(selectedText)) {
                    const result = setLinkMarkEverywhere(
                        current.state,
                        selection,
                        selectedText,
                        makeCommandContext(current),
                    );
                    setLinkPopover(null);
                    return result;
                }
                openLinkPopoverForRanges(
                    current.state,
                    ranges,
                    linkPopoverPositionFromSelection(rootRef.current),
                );
                return {state: current.state, ops: [], selection};
            }

            const primary = primarySelection(resolveSelectionSet(current.state, selection));
            if (primary.type === 'caret') {
                const block = formatted.find((candidate) => candidate.id === primary.point.blockId);
                const linkRange = block
                    ? linkRangeAroundOffsetInRuns(block.id, block.runs, primary.point.offset)
                    : null;
                if (linkRange) {
                    openLinkPopoverForRanges(
                        current.state,
                        [linkRange],
                        linkPopoverPositionFromSelection(rootRef.current),
                    );
                }
            }

            return {state: current.state, ops: [], selection};
        });
    }, [liveSelectionSet, onCommand, openLinkPopoverForRanges]);

    const cancelLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = null;
    }, []);

    const scheduleLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = setTimeout(() => {
            setLinkHoverPopover(null);
            linkHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    const showLinkHoverFromRange = useCallback(
        (range: LinkTargetRange & {href: string}, element: HTMLElement) => {
            cancelLinkHoverHide();
            setLinkHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                href: range.href,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelLinkHoverHide],
    );

    const cancelCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = null;
    }, []);

    const scheduleCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = setTimeout(() => {
            setCodeHoverPopover(null);
            codeHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    const showCodeHoverFromRange = useCallback(
        (range: CodeTargetRange & {language: string}, element: HTMLElement) => {
            cancelCodeHoverHide();
            setCodeHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                language: range.language,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelCodeHoverHide],
    );

    const applyLinkPopover = useCallback(
        (href: string) => {
            const ranges = linkPopover?.ranges ?? [];
            setLinkPopover(null);
            if (!ranges.length) return;
            const value = href.trim();
            if (value) {
                applyLinkToRanges(ranges, value);
            } else {
                removeLinkFromRanges(ranges);
            }
        },
        [applyLinkToRanges, linkPopover?.ranges, removeLinkFromRanges],
    );

    const removeLinkPopover = useCallback(() => {
        const ranges = linkPopover?.ranges ?? [];
        setLinkPopover(null);
        if (ranges.length) removeLinkFromRanges(ranges);
    }, [linkPopover?.ranges, removeLinkFromRanges]);

    const applyCodePopover = useCallback(
        (language: string, ranges: CodeTargetRange[]) => {
            setCodePopover(null);
            if (!ranges.length) return;
            const value = language.trim();
            if (value) {
                applyCodeLanguageToRanges(ranges, value);
            } else {
                clearCodeLanguageFromRanges(ranges);
            }
        },
        [applyCodeLanguageToRanges, clearCodeLanguageFromRanges],
    );

    const clearCodePopoverLanguage = useCallback((ranges: CodeTargetRange[]) => {
        setCodePopover(null);
        if (ranges.length) clearCodeLanguageFromRanges(ranges);
    }, [clearCodeLanguageFromRanges]);

    const removeCodePopover = useCallback((ranges: CodeTargetRange[]) => {
        setCodePopover(null);
        if (ranges.length) removeCodeFromRanges(ranges);
    }, [removeCodeFromRanges]);

    const runAnnotationBodyCommand = useCallback(
        (
            command: (
                current: Replica,
                context: ReturnType<typeof makeCommandContext>,
            ) => CommandResult,
        ) => {
            runBlockControlCommand((current) => {
                const result = command(current, makeCommandContext(current));
                return {state: result.state, ops: result.ops, selection: current.selection};
            });
        },
        [runBlockControlCommand],
    );

    const moveSelectionsHorizontallyEverywhere = useCallback(
        (direction: 'left' | 'right', unit: HorizontalMovementUnit = 'character') => {
            handledNavigationKeyRef.current = true;
            runEditCommand((current, selection) =>
                moveSelectionsHorizontally(current.state, selection, direction, unit),
            );
        },
        [runEditCommand],
    );

    const moveSelectionsVerticallyEverywhere = useCallback(
        (direction: 'up' | 'down') => {
            handledNavigationKeyRef.current = true;
            runEditCommand((current, selection) =>
                moveSelectionsVertically(current.state, selection, direction),
            );
        },
        [runEditCommand],
    );

    const extendSelectionsHorizontallyEverywhere = useCallback(
        (direction: 'left' | 'right', unit: HorizontalMovementUnit = 'character') => {
            handledNavigationKeyRef.current = true;
            runEditCommand((current, selection) =>
                extendSelectionsHorizontally(current.state, selection, direction, unit),
            );
        },
        [runEditCommand],
    );

    const extendSelectionsVerticallyEverywhere = useCallback(
        (direction: 'up' | 'down') => {
            handledNavigationKeyRef.current = true;
            runEditCommand((current, selection) =>
                extendSelectionsVertically(current.state, selection, direction),
            );
        },
        [runEditCommand],
    );

    const extendSelectionVerticallyWithVisualIntent = useCallback(
        (direction: 'up' | 'down', sourceBlock: HTMLElement) => {
            handledNavigationKeyRef.current = true;
            onCommand((current) => {
                const root = rootRef.current;
                if (!root) return {state: current.state, ops: [], selection: current.selection};

                const liveSelection =
                    readSelectionFromDom(root) ??
                    primarySelection(resolveSelectionSet(current.state, current.selection));
                const focus = focusPoint(liveSelection);
                const blockOrder = editableBlockIds(current.state);
                const index = blockOrder.indexOf(focus.blockId);
                const targetBlockId = blockOrder[direction === 'up' ? index - 1 : index + 1];
                if (!targetBlockId) {
                    return {
                        state: current.state,
                        ops: [],
                        selection: replacePrimarySelection(
                            current.state,
                            current.selection,
                            liveSelection,
                        ),
                    };
                }

                const targetBlock = root.querySelector<HTMLElement>(
                    `[data-block-id="${CSS.escape(targetBlockId)}"]`,
                );
                if (!targetBlock) {
                    return {
                        state: current.state,
                        ops: [],
                        selection: replacePrimarySelection(
                            current.state,
                            current.selection,
                            liveSelection,
                        ),
                    };
                }

                if (verticalCaretXRef.current === null) {
                    const intent =
                        readSelectionFocusHorizontalIntent(root) ??
                        readCaretHorizontalIntent(sourceBlock);
                    if (!intent) {
                        return {
                            state: current.state,
                            ops: [],
                            selection: replacePrimarySelection(
                                current.state,
                                current.selection,
                                liveSelection,
                            ),
                        };
                    }
                    verticalCaretXRef.current = intent.x;
                }

                const offset = closestCaretOffsetForHorizontalIntent(targetBlock, {
                    x: verticalCaretXRef.current,
                });
                const nextSelection: EditorSelection = {
                    type: 'range',
                    anchor:
                        liveSelection.type === 'caret' ? liveSelection.point : liveSelection.anchor,
                    focus: {blockId: targetBlockId, offset},
                };
                scheduleSelectionRestore(nextSelection);
                return {
                    state: current.state,
                    ops: [],
                    selection: replacePrimarySelection(
                        current.state,
                        current.selection,
                        nextSelection,
                    ),
                };
            });
        },
        [onCommand, scheduleSelectionRestore],
    );

    const moveCaret = useCallback(
        (selection: EditorSelection) => {
            scheduleSelectionRestore(selection);
            onCommand((current) => ({
                state: current.state,
                ops: [],
                selection: replacePrimarySelection(current.state, current.selection, selection),
            }));
        },
        [onCommand, scheduleSelectionRestore],
    );

    const moveCaretHorizontally = useCallback(
        (selection: EditorSelection) => {
            resetVerticalCaretIntent();
            moveCaret(selection);
        },
        [moveCaret, resetVerticalCaretIntent],
    );

    const moveCaretVertically = useCallback(
        (sourceBlock: HTMLElement, targetBlockId: string) => {
            const root = rootRef.current;
            if (!root) return;
            const targetBlock = root.querySelector<HTMLElement>(
                `[data-block-id="${CSS.escape(targetBlockId)}"]`,
            );
            if (!targetBlock) return;

            if (verticalCaretXRef.current === null) {
                const intent = readCaretHorizontalIntent(sourceBlock);
                if (!intent) return;
                verticalCaretXRef.current = intent.x;
            }

            const offset = closestCaretOffsetForHorizontalIntent(targetBlock, {
                x: verticalCaretXRef.current,
            });
            moveCaret(caret(targetBlockId, offset));
        },
        [moveCaret],
    );

    const moveTableSelectionByArrowKey = useCallback(
        (
            selection: EditorSelection,
            direction: 'left' | 'right' | 'up' | 'down',
            sourceBlock?: HTMLElement,
        ): boolean => {
            const preview = moveTableSelectionByArrow(replica.state, selection, direction, {
                actor: replica.actor,
                nextTs: previewReplicaTs(replica),
            });
            if (!preview) return false;
            if (direction === 'left' || direction === 'right') resetVerticalCaretIntent();

            let applied = false;
            onCommand((current) => {
                const result = moveTableSelectionByArrow(
                    current.state,
                    selection,
                    direction,
                    makeCommandContext(current),
                );
                if (!result) {
                    return {state: current.state, ops: [], selection: current.selection};
                }
                applied = true;
                const nextSelection = adjustTableVerticalSelectionForIntent(
                    result.selection,
                    direction,
                    sourceBlock,
                );
                scheduleSelectionRestore(nextSelection);
                return {
                    state: result.state,
                    ops: result.ops,
                    selection: replacePrimarySelection(
                        result.state,
                        current.selection,
                        nextSelection,
                    ),
                };
            });
            return applied;
        },
        [onCommand, replica, resetVerticalCaretIntent, scheduleSelectionRestore],
    );

    const extendTableSelectionByArrowKey = useCallback(
        (
            selection: EditorSelection,
            direction: 'left' | 'right' | 'up' | 'down',
            sourceBlock?: HTMLElement,
        ): boolean => {
            const preview = moveTableSelectionByArrow(replica.state, selection, direction, {
                actor: replica.actor,
                nextTs: previewReplicaTs(replica),
            });
            if (!preview) return false;
            if (direction === 'left' || direction === 'right') resetVerticalCaretIntent();

            let applied = false;
            onCommand((current) => {
                const result = moveTableSelectionByArrow(
                    current.state,
                    selection,
                    direction,
                    makeCommandContext(current),
                );
                if (!result) {
                    return {state: current.state, ops: [], selection: current.selection};
                }
                applied = true;
                const adjusted = adjustTableVerticalSelectionForIntent(
                    result.selection,
                    direction,
                    sourceBlock,
                );
                const nextSelection: EditorSelection = {
                    type: 'range',
                    anchor: selection.type === 'caret' ? selection.point : selection.anchor,
                    focus: focusPoint(adjusted),
                };
                scheduleSelectionRestore(nextSelection);
                return {
                    state: result.state,
                    ops: result.ops,
                    selection: replacePrimarySelection(
                        result.state,
                        current.selection,
                        nextSelection,
                    ),
                };
            });
            return applied;
        },
        [onCommand, replica, resetVerticalCaretIntent, scheduleSelectionRestore],
    );

    const adjustTableVerticalSelectionForIntent = useCallback(
        (
            selection: EditorSelection,
            direction: 'left' | 'right' | 'up' | 'down',
            sourceBlock?: HTMLElement,
        ): EditorSelection => {
            if ((direction !== 'up' && direction !== 'down') || !sourceBlock) return selection;
            const root = rootRef.current;
            if (!root) return selection;
            const point = focusPoint(selection);
            const targetBlock = root.querySelector<HTMLElement>(
                `[data-block-id="${CSS.escape(point.blockId)}"]`,
            );
            if (!targetBlock) return selection;

            if (verticalCaretXRef.current === null) {
                const intent = readCaretHorizontalIntent(sourceBlock);
                if (!intent) return selection;
                verticalCaretXRef.current = intent.x;
            }

            const offset = closestCaretOffsetForHorizontalIntent(targetBlock, {
                x: verticalCaretXRef.current,
            });
            if (selection.type === 'caret') return caret(point.blockId, offset);
            return {...selection, focus: {...selection.focus, offset}};
        },
        [],
    );

    useLayoutEffect(() => {
        const root = rootRef.current;
        const selection = pendingSelectionRestoreRef.current;
        if (!root || !selection) return;
        if (document.activeElement === null || !root.contains(document.activeElement)) return;
        pendingSelectionRestoreRef.current = null;
        restoreSelectionToDom(root, selection);
    }, [replica.state, replica.selection]);

    return (
        <article className={replica.online ? 'editorPanel' : 'editorPanel offline'}>
            <header className="editorHeader">
                <div>
                    <h2>{replica.id === 'left' ? 'Editor A' : 'Editor B'}</h2>
                    <span>
                        {replica.online ? 'online' : 'offline'} · queued {replica.queue.length}
                    </span>
                </div>
                <label className="switch">
                    <input type="checkbox" checked={replica.online} onChange={onToggleOnline} />
                    <span>Online</span>
                </label>
            </header>
            <Toolbar
                canUndo={undoState.canUndo}
                canRedo={undoState.canRedo}
                blockType={selectedBlockType}
                activeMarks={activeInlineMarks}
                onUndo={onUndo}
                onRedo={onRedo}
                onBold={() => runInlineMarkToggle('bold')}
                onItalic={() => runInlineMarkToggle('italic')}
                onStrikethrough={() => runInlineMarkToggle('strikethrough')}
                onCode={() =>
                    activeAnnotationBodySelection
                        ? runAnnotationBodyCommand((current, context) =>
                              toggleAnnotationBodyCodeMark(
                                  current.state,
                                  activeAnnotationBodySelection,
                                  context,
                              ),
                          )
                        : runCodeToggle()
                }
                onLink={openLinkFromCurrentSelection}
                onDateEmbed={insertDateEmbedFromCurrentSelection}
                onAnnotation={(presentation) =>
                    activeAnnotationBodySelection
                        ? runBlockControlCommand((current) => {
                              const result = createAnnotation(
                                  current.state,
                                  activeAnnotationBodySelection,
                                  presentation,
                                  makeCommandContext(current),
                              );
                              if (presentation === 'sidebar') handleSidebarCommentCreated(result);
                              return {
                                  state: result.state,
                                  ops: result.ops,
                                  selection: current.selection,
                              };
                          })
                        : runEditCommand((current, selection) => {
                              const result = createAnnotation(
                                  current.state,
                                  primarySelection(resolveSelectionSet(current.state, selection)),
                                  presentation,
                                  makeCommandContext(current),
                              );
                              if (presentation === 'sidebar') handleSidebarCommentCreated(result);
                              return {state: result.state, ops: result.ops, selection};
                          })
                }
                onBlockType={(kind) =>
                    runEditCommand((current, selection) => {
                        if (kind === 'table') {
                            const result = convertBlockToTable(
                                current.state,
                                primarySelection(resolveSelectionSet(current.state, selection)),
                                makeCommandContext(current),
                            );
                            return {
                                state: result.state,
                                ops: result.ops,
                                selection: replacePrimarySelection(
                                    result.state,
                                    current.selection,
                                    result.selection,
                                ),
                            };
                        }
                        return setBlockTypeEverywhere(current.state, selection, (_blockId, meta) =>
                            blockTypeMeta(kind, meta, nextReplicaTs(current)),
                        );
                    })
                }
            />
            {undoStatus || undoState.undoReason || undoState.redoReason ? (
                <p className="editorUndoStatus">
                    {undoStatus || undoState.undoReason || undoState.redoReason}
                </p>
            ) : null}
            <div
                ref={editorContentRef}
                className={
                    commentsOpen ? 'editorContent commentsOpen' : 'editorContent commentsCollapsed'
                }
            >
                <div className="documentColumn">
                    <div
                        ref={rootRef}
                        className="blockList"
                        onFocus={() => {
                            setActiveAnnotationBodySelection(null);
                            setHasFocus(true);
                        }}
                        onBlur={(event) => {
                            if (event.currentTarget.contains(event.relatedTarget)) return;
                            resetVerticalCaretIntent();
                            setIsExtendingSelection(false);
                            clearPendingInlineMarks();
                            setHasFocus(false);
                        }}
                        onMouseDown={captureMouseDown}
                        onMouseUp={captureSelection}
                        onKeyDown={(event) => {
                            if (event.key !== 'Escape' || !activePopovers.length) return;
                            event.preventDefault();
                            closeDeepestPopover();
                        }}
                        onKeyUp={captureSelection}
                    >
                        {renderTree.map((node) =>
                            renderBlockNode(node, {
                                blocks,
                                state: replica.state,
                                charIdsByBlock,
                                selection: primaryResolvedSelection,
                                hasMultipleSelections: resolvedSelectionSet.entries.length > 1,
                                decorationsByBlock,
                                pendingCaretRestoreBlockIdRef,
                                draggingSubtreeIds,
                                draggingId,
                                dropTarget,
                                registerRow,
                                startDrag,
                                orderedListNumbers,
                                popoverTextById,
                                footnoteNumberById,
                                onPopoverTriggerEnter: showPopover,
                                onPopoverTriggerLeave: schedulePopoverHideFromPointer,
                                openLinkFromCurrentSelection,
                                showLinkHoverFromRange,
                                hideLinkHover: scheduleLinkHoverHide,
                                showCodeHoverFromRange,
                                hideCodeHover: scheduleCodeHoverHide,
                                openInlineEmbed: openEmbedPopover,
                                insertText: insertTextWithPendingMarks,
                                runInlineMarkToggle,
                                runCodeToggle,
                                createMissingTableCell: (tableId, rowId, columnIndex) =>
                                    runBlockControlCommand((current) => {
                                        const result = createMissingTableCell(
                                            current.state,
                                            rowId,
                                            columnIndex,
                                            makeCommandContext(current),
                                        );
                                        return {
                                            state: result.state,
                                            ops: result.ops,
                                            selection: current.selection,
                                        };
                                    }),
                                addTableRow: (tableId, afterRowId) =>
                                    runBlockControlCommand((current) => {
                                        const result = addTableRow(
                                            current.state,
                                            tableId,
                                            makeCommandContext(current),
                                            afterRowId,
                                        );
                                        return {
                                            state: result.state,
                                            ops: result.ops,
                                            selection: current.selection,
                                        };
                                    }),
                                addTableColumn: (tableId, columnIndex) =>
                                    runBlockControlCommand((current) => {
                                        const result = addTableColumn(
                                            current.state,
                                            tableId,
                                            makeCommandContext(current),
                                            columnIndex,
                                        );
                                        return {
                                            state: result.state,
                                            ops: result.ops,
                                            selection: current.selection,
                                        };
                                }),
                                runEditCommand,
                                runBlockControlCommand,
                                onCopy: copyRichSelection,
                                onPaste: pasteFromClipboard,
                                moveCaretHorizontally,
                                moveCaretVertically,
                                moveTableSelectionByArrowKey,
                                extendTableSelectionByArrowKey,
                                moveSelectionsHorizontallyEverywhere,
                                moveSelectionsVerticallyEverywhere,
                                extendSelectionsHorizontallyEverywhere,
                                extendSelectionsVerticallyEverywhere,
                                extendSelectionVerticallyWithVisualIntent,
                                onUndo,
                                onRedo,
                                onKeystroke,
                            }),
                        )}
                    </div>
                    <Footnotes
                        state={replica.state}
                        annotations={annotations.filter(
                            (item) => item.data.presentation === 'footnote',
                        )}
                        focusRequest={commentFocusRequest}
                        onFocusRequestHandled={() => setCommentFocusRequest(null)}
                        onBodyCommand={runAnnotationBodyCommand}
                        onBodyFocusRequest={requestCommentFocus}
                        onBodySelectionChange={setActiveAnnotationBodySelection}
                        popoverTextById={popoverTextById}
                        footnoteNumberById={footnoteNumberById}
                        onPopoverTriggerEnter={showPopover}
                        onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                    />
                </div>
                <AnnotationSidebar
                    state={replica.state}
                    annotations={sidebarAnnotations}
                    open={commentsOpen}
                    gutterTops={commentGutterTops}
                    focusRequest={commentFocusRequest}
                    onToggle={setCommentsOpen}
                    onFocusRequestHandled={() => setCommentFocusRequest(null)}
                    onFocusAnnotation={(annotation) => {
                        setCommentsOpen(true);
                        requestCommentFocus(focusBodyBlockForAnnotation(annotation));
                    }}
                    onBodyActivity={recordCommentBodyActivity}
                    onBodyCommand={runAnnotationBodyCommand}
                    onBodyFocusRequest={requestCommentFocus}
                    onBodySelectionChange={setActiveAnnotationBodySelection}
                    onResolveAnnotation={(annotation) => {
                        runAnnotationBodyCommand((current, context) =>
                            resolveAnnotation(current.state, annotation.id, context),
                        );
                    }}
                    popoverTextById={popoverTextById}
                    footnoteNumberById={footnoteNumberById}
                    onPopoverTriggerEnter={showPopover}
                    onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                />
            </div>
            {activePopovers.map((popover) => (
                <FloatingAnnotationPopover
                    state={replica.state}
                    key={popover.id}
                    annotation={popoverAnnotationsById.get(popover.id) ?? null}
                    position={popover}
                    onMouseEnter={cancelPopoverHide}
                    onMouseLeave={(event) =>
                        schedulePopoverHideFromPointer(popover.id, {
                            source: 'panel',
                            relatedTarget: event.relatedTarget,
                            clientX: event.clientX,
                            clientY: event.clientY,
                        })
                    }
                    onFocusChange={setPopoverFocusPinned}
                    onEscape={closeDeepestPopover}
                    focusRequest={commentFocusRequest}
                    onFocusRequestHandled={() => setCommentFocusRequest(null)}
                    onBodyCommand={runAnnotationBodyCommand}
                    onBodyFocusRequest={requestCommentFocus}
                    onBodySelectionChange={setActiveAnnotationBodySelection}
                    popoverTextById={popoverTextById}
                    footnoteNumberById={footnoteNumberById}
                    onPopoverTriggerEnter={showPopover}
                    onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                />
            ))}
            <LinkFloatingPopover
                state={linkPopover}
                onApply={applyLinkPopover}
                onRemove={removeLinkPopover}
                onClose={() => setLinkPopover(null)}
            />
            <LinkHoverPopover
                state={linkHoverPopover}
                onEdit={(state) => {
                    cancelLinkHoverHide();
                    setLinkHoverPopover(null);
                    setLinkPopover(state);
                }}
                onMouseEnter={cancelLinkHoverHide}
                onMouseLeave={scheduleLinkHoverHide}
            />
            <CodeFloatingPopover
                state={codePopover}
                onApply={applyCodePopover}
                onClearLanguage={clearCodePopoverLanguage}
                onRemove={removeCodePopover}
                onClose={() => setCodePopover(null)}
            />
            <CodeHoverPopover
                state={codeHoverPopover}
                onEdit={(state) => {
                    cancelCodeHoverHide();
                    setCodeHoverPopover(null);
                    setCodePopover(state);
                }}
                onMouseEnter={cancelCodeHoverHide}
                onMouseLeave={scheduleCodeHoverHide}
            />
            <DateEmbedFloatingPopover
                state={embedPopover}
                onApply={applyEmbedPopover}
                onClose={() => setEmbedPopover(null)}
            />
        </article>
    );
}

type RenderTreeNode = {
    block: RichFormattedBlock;
    children: RenderTreeNode[];
};

type BlockTypeMenuValue =
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'unordered'
    | 'ordered'
    | 'todo'
    | 'blockquote'
    | 'code'
    | 'callout-info'
    | 'callout-warning'
    | 'callout-error'
    | 'table';

type RenderBlockContext = {
    blocks: RichFormattedBlock[];
    state: Replica['state'];
    charIdsByBlock: Map<string, string[]>;
    selection: EditorSelection;
    hasMultipleSelections: boolean;
    decorationsByBlock: Map<string, BlockSelectionDecorations>;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    draggingSubtreeIds: Set<string>;
    draggingId: string | null;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    startDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    orderedListNumbers: Map<string, number>;
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    runEditCommand(
        command: (current: Replica, selection: RetainedSelectionSet) => MultiCommandResult,
    ): void;
    insertText(current: Replica, selection: RetainedSelectionSet, text: string): MultiCommandResult;
    runInlineMarkToggle(markType: BooleanInlineMark): void;
    runCodeToggle(): void;
    runBlockControlCommand(command: (current: Replica) => MultiCommandResult): void;
    onCopy(event: ClipboardEvent<HTMLElement>): void;
    onPaste(event: ClipboardEvent<HTMLElement>): void;
    moveCaretHorizontally(selection: EditorSelection): void;
    moveCaretVertically(sourceBlock: HTMLElement, targetBlockId: string): void;
    moveTableSelectionByArrowKey(
        selection: EditorSelection,
        direction: 'left' | 'right' | 'up' | 'down',
        sourceBlock?: HTMLElement,
    ): boolean;
    extendTableSelectionByArrowKey(
        selection: EditorSelection,
        direction: 'left' | 'right' | 'up' | 'down',
        sourceBlock?: HTMLElement,
    ): boolean;
    moveSelectionsHorizontallyEverywhere(
        direction: 'left' | 'right',
        unit?: HorizontalMovementUnit,
    ): void;
    moveSelectionsVerticallyEverywhere(direction: 'up' | 'down'): void;
    extendSelectionsHorizontallyEverywhere(
        direction: 'left' | 'right',
        unit?: HorizontalMovementUnit,
    ): void;
    extendSelectionsVerticallyEverywhere(direction: 'up' | 'down'): void;
    extendSelectionVerticallyWithVisualIntent(
        direction: 'up' | 'down',
        sourceBlock: HTMLElement,
    ): void;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    openLinkFromCurrentSelection(): void;
    showLinkHoverFromRange(range: LinkTargetRange & {href: string}, element: HTMLElement): void;
    hideLinkHover(): void;
    showCodeHoverFromRange(range: CodeTargetRange & {language: string}, element: HTMLElement): void;
    hideCodeHover(): void;
    openInlineEmbed(charId: string, element: HTMLElement): void;
    createMissingTableCell(tableId: string, rowId: string, columnIndex: number): void;
    addTableRow(tableId: string, afterRowId?: string): void;
    addTableColumn(tableId: string, columnIndex?: number): void;
    onUndo(): void;
    onRedo(): void;
    onKeystroke(blockId: string, event: KeyboardEvent<HTMLElement>): void;
};

const buildRenderTree = (blocks: RichFormattedBlock[]): RenderTreeNode[] => {
    const roots: RenderTreeNode[] = [];
    const stack: RenderTreeNode[] = [];
    for (const block of blocks) {
        const node = {block, children: []};
        while (stack.length && stack[stack.length - 1].block.depth >= block.depth) stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
        stack.push(node);
    }
    return roots;
};

const renderBlockNode = (node: RenderTreeNode, context: RenderBlockContext): ReactElement => {
    const meta = node.block.block.meta;
    if (meta.type === 'table') {
        return <TableBlock key={node.block.id} node={node} context={context} />;
    }
    if (meta.type === 'blockquote' || meta.type === 'callout') {
        return (
            <div
                key={node.block.id}
                className={[
                    'groupedSubtree',
                    meta.type === 'blockquote' ? 'blockquoteGroup' : 'calloutGroup',
                    meta.type === 'callout' ? `callout${capitalize(meta.kind)}` : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                style={{'--group-depth': node.block.depth} as CSSProperties}
            >
                {renderEditableBlock(node.block, context)}
                {node.children.map((child) => renderBlockNode(child, context))}
            </div>
        );
    }

    return (
        <div key={node.block.id} className="renderTreeBranch">
            {renderEditableBlock(node.block, context)}
            {node.children.map((child) => renderBlockNode(child, context))}
        </div>
    );
};

function TableBlock({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    const [cellDrag, setCellDrag] = useState<{
        sourceCellId: string;
        target: {rowId: string; index: number} | null;
    } | null>(null);
    const rowNodes = node.children;
    const columnCount = Math.max(
        1,
        ...rowNodes.map((row) => (row.block.block.meta.type === 'table' ? 0 : row.children.length)),
    );
    const selectedCellId = tableCellIdForSelection(context.state, context.selection);

    useLayoutEffect(() => {
        if (!cellDrag) return;
        const onPointerMove = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            setCellDrag((current) =>
                current
                    ? {
                          ...current,
                          target: tableCellDropTargetFromPoint(event.clientX, event.clientY),
                      }
                    : current,
            );
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target =
                tableCellDropTargetFromPoint(event.clientX, event.clientY) ?? cellDrag.target;
            const sourceCellId = cellDrag.sourceCellId;
            setCellDrag(null);
            if (!target) return;
            context.runBlockControlCommand((current) => {
                const result = moveTableCell(
                    current.state,
                    sourceCellId,
                    target,
                    makeCommandContext(current),
                );
                return {state: result.state, ops: result.ops, selection: current.selection};
            });
        };
        const onPointerCancel = () => setCellDrag(null);
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [cellDrag, context]);

    return (
        <div
            className="tableBlock"
            style={{'--block-depth': node.block.depth} as CSSProperties}
            data-table-id={node.block.id}
        >
            <div className="tableGrid" role="table" aria-label="Table block"
                style={{'--table-columns': columnCount} as CSSProperties}
            >
                <div className="tableTitleRow">{renderEditableBlock(node.block, context)}</div>
                <div
                    className="tableColumnInsertControls"
                    aria-label="Column insert controls"
                    style={{'--table-columns': columnCount} as CSSProperties}
                >
                    {Array.from({length: columnCount + 1}, (_, columnIndex) => (
                        <button
                            key={columnIndex}
                            type="button"
                            className="tableColumnInsert"
                            aria-label={`Add column ${columnIndex + 1}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => context.addTableColumn(node.block.id, columnIndex)}
                        >
                            +
                        </button>
                    ))}
                </div>
                {rowNodes.map((row, rowIndex) => (
                    <Fragment key={row.block.id}>
                        {row.block.block.meta.type === 'table' ? (
                            <div
                                ref={(element) => context.registerRow(row.block.id, element)}
                                className={[
                                    'tableInterstitialRow',
                                    context.draggingSubtreeIds.has(row.block.id) ? 'dragging' : '',
                                    context.draggingId === row.block.id ? 'draggingRoot' : '',
                                    context.dropTarget?.indicatorBlockId === row.block.id
                                        ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                role="row"
                                data-row-id={row.block.id}
                            >
                                <TableBlock node={{...row, block: {...row.block, depth: 0}}} context={context} />
                            </div>
                        ) : (
                            <div
                                ref={(element) => context.registerRow(row.block.id, element)}
                                className={[
                                    'tableRow',
                                    context.draggingSubtreeIds.has(row.block.id) ? 'dragging' : '',
                                    context.draggingId === row.block.id ? 'draggingRoot' : '',
                                    context.dropTarget?.indicatorBlockId === row.block.id
                                        ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                role="row"
                                data-row-id={row.block.id}
                                style={{'--table-columns': columnCount} as CSSProperties}
                            >
                                <TableRowHeader row={row.block} rowIndex={rowIndex} context={context} />
                                {Array.from({length: columnCount}, (_, columnIndex) => {
                                    const cell = row.children[columnIndex] ?? null;
                                    return (
                                        <div
                                            key={`${row.block.id}:${columnIndex}`}
                                            className={[
                                                cell ? 'tableCell' : 'tableCell missingTableCell',
                                                cell?.block.id === selectedCellId
                                                    ? 'activeTableCell'
                                                    : '',
                                                cellDrag?.sourceCellId === cell?.block.id
                                                    ? 'draggingCell'
                                                    : '',
                                                cellDrag?.target?.rowId === row.block.id &&
                                                cellDrag.target.index === columnIndex
                                                    ? 'cellDropBefore'
                                                    : '',
                                                cellDrag?.target?.rowId === row.block.id &&
                                                cellDrag.target.index === columnIndex + 1
                                                    ? 'cellDropAfter'
                                                    : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            role="cell"
                                            data-cell-id={cell?.block.id}
                                            onPointerDown={(event) => {
                                                if (
                                                    !cell ||
                                                    !isFocusedCellBorderDrag(event, selectedCellId)
                                                )
                                                    return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                event.currentTarget.setPointerCapture(event.pointerId);
                                                setCellDrag({
                                                    sourceCellId: cell.block.id,
                                                    target: {rowId: row.block.id, index: columnIndex},
                                                });
                                            }}
                                        >
                                            {cell ? (
                                                renderTableCell(cell, context)
                                            ) : (
                                                <button
                                                    type="button"
                                                    aria-label="Add cell"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() =>
                                                        context.createMissingTableCell(
                                                            node.block.id,
                                                            row.block.id,
                                                            columnIndex,
                                                        )
                                                    }
                                                >
                                                    +
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div
                            className="tableRowInsertControl"
                            aria-label={`Row ${rowIndex + 1} insert control`}
                        >
                            <button
                                type="button"
                                aria-label={`Add row after ${rowIndex + 1}`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => context.addTableRow(node.block.id, row.block.id)}
                            >
                                +
                            </button>
                        </div>
                    </Fragment>
                ))}
            </div>
        </div>
    );
}

const renderTableCell = (node: RenderTreeNode, context: RenderBlockContext): ReactElement => {
    if (node.block.block.meta.type === 'table') {
        return <TableBlock node={node} context={context} />;
    }
    return (
        <>
            {renderEditableBlock({...node.block, depth: 0}, context)}
            {node.children.length > 0 ? (
                <div className="tableCellChildren">
                    {node.children.map((child) => renderBlockNodeAtRelativeDepth(child, context, node.block.depth + 1))}
                </div>
            ) : null}
        </>
    );
};

const renderBlockNodeAtRelativeDepth = (
    node: RenderTreeNode,
    context: RenderBlockContext,
    baseDepth: number,
): ReactElement => {
    const relativeNode = withRelativeDepth(node, baseDepth);
    return renderBlockNode(relativeNode, context);
};

const withRelativeDepth = (node: RenderTreeNode, baseDepth: number): RenderTreeNode => ({
    block: {...node.block, depth: Math.max(0, node.block.depth - baseDepth)},
    children: node.children.map((child) => withRelativeDepth(child, baseDepth)),
});

function TableRowHeader({
    row,
    rowIndex,
    context,
}: {
    row: RichFormattedBlock;
    rowIndex: number;
    context: RenderBlockContext;
}) {
    return (
        <div className="tableRowHeader" role="rowheader" aria-label={`Row ${rowIndex + 1} header`}>
            <button
                type="button"
                className="tableRowDrag"
                aria-label={`Move row ${rowIndex + 1}`}
                onPointerDown={(event) => context.startDrag(row.id, event)}
            >
                ⋮
            </button>
            <RichTextEditableSurface
                blockId={row.id}
                runs={row.runs}
                charIdsByOffset={context.charIdsByBlock.get(row.id) ?? []}
                decorations={context.decorationsByBlock.get(row.id) ?? null}
                pendingCaretRestoreBlockIdRef={context.pendingCaretRestoreBlockIdRef}
                selection={context.selection}
                className="editableBlock tableRowHeaderText"
                ariaLabel={`Row header ${rowIndex + 1}`}
                placeholder={`${rowIndex + 1}`}
                popoverTextById={context.popoverTextById}
                footnoteNumberById={context.footnoteNumberById}
                onPopoverTriggerEnter={context.onPopoverTriggerEnter}
                onPopoverTriggerLeave={context.onPopoverTriggerLeave}
                onLinkHoverEnter={context.showLinkHoverFromRange}
                onLinkHoverLeave={context.hideLinkHover}
                onCodeHoverEnter={context.showCodeHoverFromRange}
                onCodeHoverLeave={context.hideCodeHover}
                onInlineEmbedOpen={context.openInlineEmbed}
                onInsertText={(text, activeSelection) =>
                    context.runEditCommand((current, selection) =>
                        context.insertText(
                            current,
                            activeSelection
                                ? replacePrimarySelection(current.state, selection, activeSelection)
                                : selection,
                            text,
                        ),
                    )
                }
                onDeleteBackward={(activeSelection) =>
                    context.runEditCommand((current, selection) =>
                        deleteBackwardEverywhere(
                            current.state,
                            activeSelection
                                ? replacePrimarySelection(current.state, selection, activeSelection)
                                : selection,
                            makeCommandContext(current),
                        ),
                    )
                }
                onDeleteForward={(activeSelection) =>
                    context.runEditCommand((current, selection) =>
                        deleteForwardEverywhere(
                            current.state,
                            activeSelection
                                ? replacePrimarySelection(current.state, selection, activeSelection)
                                : selection,
                            makeCommandContext(current),
                        ),
                    )
                }
                onKeyDown={(event) => {
                    context.onKeystroke(row.id, event);
                    const modifierPressed = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (modifierPressed && key === 'z' && event.shiftKey) {
                        event.preventDefault();
                        context.onRedo();
                    } else if (modifierPressed && key === 'z') {
                        event.preventDefault();
                        context.onUndo();
                    } else if (modifierPressed && key === 'y') {
                        event.preventDefault();
                        context.onRedo();
                    } else if (modifierPressed && key === 'b') {
                        event.preventDefault();
                        context.runInlineMarkToggle('bold');
                    } else if (modifierPressed && key === 'i') {
                        event.preventDefault();
                        context.runInlineMarkToggle('italic');
                    } else if (modifierPressed && key === 'k') {
                        event.preventDefault();
                        context.openLinkFromCurrentSelection();
                    } else if (event.key === 'Enter') {
                        event.preventDefault();
                        context.runEditCommand((current, selection) =>
                            splitBlockEverywhere(
                                current.state,
                                selection,
                                makeCommandContext(current),
                            ),
                        );
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        context.runEditCommand((current, selection) =>
                            deleteBackwardEverywhere(
                                current.state,
                                selection,
                                makeCommandContext(current),
                            ),
                        );
                    } else if (event.key === 'Delete') {
                        event.preventDefault();
                        context.runEditCommand((current, selection) =>
                            deleteForwardEverywhere(
                                current.state,
                                selection,
                                makeCommandContext(current),
                            ),
                        );
                    } else if (
                        isPlainArrowKey(event.key) &&
                        event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        const focus = currentSelection ? focusPoint(currentSelection) : null;
                        const direction =
                            event.key === 'ArrowLeft'
                                ? 'left'
                                : event.key === 'ArrowRight'
                                  ? 'right'
                                  : event.key === 'ArrowUp'
                                    ? 'up'
                                    : 'down';
                        const shouldHandle =
                            !!currentSelection &&
                            ((event.key === 'ArrowLeft' && focus?.offset === 0) ||
                                (event.key === 'ArrowRight' &&
                                    focus?.offset === pointTextLength(context.state, row.id)) ||
                                (event.key === 'ArrowUp' &&
                                    isCaretOnFirstVisualLine(event.currentTarget)) ||
                                (event.key === 'ArrowDown' &&
                                    isCaretOnLastVisualLine(event.currentTarget)));
                        if (
                            shouldHandle &&
                            context.extendTableSelectionByArrowKey(
                                currentSelection,
                                direction,
                                event.currentTarget,
                            )
                        ) {
                            event.preventDefault();
                        }
                    } else if (
                        isPlainArrowKey(event.key) &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        const focus = currentSelection ? focusPoint(currentSelection) : null;
                        const direction =
                            event.key === 'ArrowLeft'
                                ? 'left'
                                : event.key === 'ArrowRight'
                                  ? 'right'
                                  : event.key === 'ArrowUp'
                                    ? 'up'
                                    : 'down';
                        const shouldHandle =
                            currentSelection?.type === 'caret' &&
                            ((event.key === 'ArrowLeft' && focus?.offset === 0) ||
                                (event.key === 'ArrowRight' &&
                                    focus?.offset === pointTextLength(context.state, row.id)) ||
                                (event.key === 'ArrowUp' &&
                                    isCaretOnFirstVisualLine(event.currentTarget)) ||
                                (event.key === 'ArrowDown' &&
                                    isCaretOnLastVisualLine(event.currentTarget)));
                        if (
                            shouldHandle &&
                            context.moveTableSelectionByArrowKey(
                                currentSelection,
                                direction,
                                event.currentTarget,
                            )
                        ) {
                            event.preventDefault();
                        }
                    } else if (event.key === 'Tab' && !event.altKey && !modifierPressed) {
                        event.preventDefault();
                        context.moveSelectionsHorizontallyEverywhere(
                            event.shiftKey ? 'left' : 'right',
                            'block',
                        );
                    }
                }}
                onCopy={context.onCopy}
                onPaste={context.onPaste}
            />
        </div>
    );
}

const tableCellIdForSelection = (
    state: Replica['state'],
    selection: EditorSelection,
): string | null => {
    const point = focusPoint(selection);
    const path = materializedBlockPath(state, point.blockId, annotationVirtualParents(state)).map(
        lamportToString,
    );
    for (let index = path.length - 1; index >= 0; index--) {
        const blockId = path[index];
        if (isTableCellBlock(state, blockId)) return blockId;
    }
    return null;
};

const isTableCellBlock = (state: Replica['state'], blockId: string): boolean => {
    const block = state.state.blocks[blockId];
    if (!block) return false;
    const rowId = lamportToString(materializedBlockParent(state, blockId, annotationVirtualParents(state)));
    const row = state.state.blocks[rowId];
    if (!row || row.meta.type === 'table') return false;
    const tableId = lamportToString(materializedBlockParent(state, rowId, annotationVirtualParents(state)));
    return state.state.blocks[tableId]?.meta.type === 'table';
};

const isFocusedCellBorderDrag = (
    event: PointerEvent<HTMLDivElement>,
    selectedCellId: string | null,
): boolean => {
    if (!event.isPrimary || event.button !== 0) return false;
    const cellId = event.currentTarget.dataset.cellId ?? null;
    if (!cellId || cellId !== selectedCellId) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = 7;
    return (
        event.clientX - rect.left <= edge ||
        rect.right - event.clientX <= edge ||
        event.clientY - rect.top <= edge ||
        rect.bottom - event.clientY <= edge
    );
};

const tableCellDropTargetFromPoint = (
    clientX: number,
    clientY: number,
): {rowId: string; index: number} | null => {
    const row = document
        .elementsFromPoint(clientX, clientY)
        .find(
            (element): element is HTMLElement =>
                element instanceof HTMLElement && element.matches('[data-row-id]'),
        );
    if (!row) return null;
    const rowId = row.dataset.rowId;
    if (!rowId) return null;
    const cells = Array.from(row.children).filter(
        (child): child is HTMLElement =>
            child instanceof HTMLElement && child.matches('.tableCell[data-cell-id]'),
    );
    if (!cells.length) return {rowId, index: 0};
    const before = cells.findIndex((cell) => {
        const rect = cell.getBoundingClientRect();
        return clientX < rect.left + rect.width / 2;
    });
    return {rowId, index: before >= 0 ? before : cells.length};
};

const renderEditableBlock = (block: RichFormattedBlock, context: RenderBlockContext) => {
    const index = context.blocks.findIndex((candidate) => candidate.id === block.id);
    const previousBlock = context.blocks[index - 1] ?? null;
    const nextBlock = context.blocks[index + 1] ?? null;
    return (
        <EditableBlock
            key={block.id}
            block={block}
            isTableCell={isTableCellBlock(context.state, block.id)}
            listNumber={context.orderedListNumbers.get(block.id) ?? null}
            previousBlockId={previousBlock?.id ?? null}
            previousBlockLength={
                previousBlock ? pointTextLength(context.state, previousBlock.id) : 0
            }
            blockLength={pointTextLength(context.state, block.id)}
            charIdsByOffset={context.charIdsByBlock.get(block.id) ?? []}
            nextBlockId={nextBlock?.id ?? null}
            selection={context.selection}
            hasMultipleSelections={context.hasMultipleSelections}
            decorations={context.decorationsByBlock.get(block.id) ?? null}
            pendingCaretRestoreBlockIdRef={context.pendingCaretRestoreBlockIdRef}
            isDragging={context.draggingSubtreeIds.has(block.id)}
            isDraggingRoot={context.draggingId === block.id}
            dropTarget={
                context.dropTarget?.indicatorBlockId === block.id ? context.dropTarget : null
            }
            registerRow={context.registerRow}
            onStartDrag={context.startDrag}
            popoverTextById={context.popoverTextById}
            footnoteNumberById={context.footnoteNumberById}
            onPopoverTriggerEnter={context.onPopoverTriggerEnter}
            onPopoverTriggerLeave={context.onPopoverTriggerLeave}
            onInsertText={(text, activeSelection) =>
                context.runEditCommand((current, selection) =>
                    context.insertText(
                        current,
                        activeSelection
                            ? replacePrimarySelection(current.state, selection, activeSelection)
                            : selection,
                        text,
                    ),
                )
            }
            onDeleteBackward={() =>
                context.runEditCommand((current, selection) => {
                    const selected = primarySelection(
                        resolveSelectionSet(current.state, selection),
                    );
                    const tableResult = deleteEmptyTableRowBackward(
                        current.state,
                        selected,
                        makeCommandContext(current),
                    );
                    if (commandApplied(tableResult)) {
                        return {
                            state: tableResult.state,
                            ops: tableResult.ops,
                            selection: replacePrimarySelection(
                                tableResult.state,
                                current.selection,
                                tableResult.selection,
                            ),
                        };
                    }
                    return deleteBackwardEverywhere(
                        current.state,
                        selection,
                        makeCommandContext(current),
                    );
                })
            }
            onDeleteForward={() =>
                context.runEditCommand((current, selection) =>
                    deleteForwardEverywhere(current.state, selection, makeCommandContext(current)),
                )
            }
            onSplit={() =>
                context.runEditCommand((current, selection) => {
                    const selected = primarySelection(
                        resolveSelectionSet(current.state, selection),
                    );
                    const tableTitleResult = splitTableTitleToParagraph(
                        current.state,
                        selected,
                        makeCommandContext(current),
                    );
                    if (commandApplied(tableTitleResult)) {
                        return {
                            state: tableTitleResult.state,
                            ops: tableTitleResult.ops,
                            selection: replacePrimarySelection(
                                tableTitleResult.state,
                                current.selection,
                                tableTitleResult.selection,
                            ),
                        };
                    }
                    return splitBlockEverywhere(
                        current.state,
                        selection,
                        makeCommandContext(current),
                    );
                })
            }
            onAdvanceFromTableCellEnd={(selection) =>
                context.runEditCommand((current) => {
                    const exitResult = exitEmptyLastTableRow(
                        current.state,
                        selection,
                        makeCommandContext(current),
                    );
                    if (commandApplied(exitResult)) {
                        return {
                            state: exitResult.state,
                            ops: exitResult.ops,
                            selection: replacePrimarySelection(
                                exitResult.state,
                                current.selection,
                                exitResult.selection,
                            ),
                        };
                    }
                    const result = advanceFromTableCellEnd(
                        current.state,
                        selection,
                        makeCommandContext(current),
                    );
                    if (!result) {
                        return splitBlockEverywhere(
                            current.state,
                            replacePrimarySelection(current.state, current.selection, selection),
                            makeCommandContext(current),
                        );
                    }
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: replacePrimarySelection(
                            result.state,
                            current.selection,
                            result.selection,
                        ),
                    };
                })
            }
            onForceCodeNewline={() =>
                context.runEditCommand((current, selection) =>
                    splitBlockEverywhere(current.state, selection, makeCommandContext(current), {
                        forceCodeNewline: true,
                    }),
                )
            }
            onIndent={() =>
                context.runEditCommand((current, selection) =>
                    indentSelections(current.state, selection, makeCommandContext(current)),
                )
            }
            onUnindent={() =>
                context.runEditCommand((current, selection) =>
                    unindentSelections(current.state, selection, makeCommandContext(current)),
                )
            }
            onMoveTableCellByTab={(direction) =>
                context.runEditCommand((current, selection) => {
                    const selected = primarySelection(
                        resolveSelectionSet(current.state, selection),
                    );
                    const result = moveTableCellByTab(
                        current.state,
                        focusPoint(selected).blockId,
                        direction,
                        makeCommandContext(current),
                    );
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: replacePrimarySelection(
                            result.state,
                            current.selection,
                            result.selection,
                        ),
                    };
                })
            }
            onToggleBold={() => context.runInlineMarkToggle('bold')}
            onToggleItalic={() => context.runInlineMarkToggle('italic')}
            onToggleStrikethrough={() => context.runInlineMarkToggle('strikethrough')}
            onToggleCode={context.runCodeToggle}
            onOpenLink={context.openLinkFromCurrentSelection}
            onLinkHoverEnter={context.showLinkHoverFromRange}
            onLinkHoverLeave={context.hideLinkHover}
            onCodeHoverEnter={context.showCodeHoverFromRange}
            onCodeHoverLeave={context.hideCodeHover}
            onInlineEmbedOpen={context.openInlineEmbed}
            onToggleTodo={() =>
                context.runEditCommand((current, selection) =>
                    updateBlockMetaEverywhere(
                        current.state,
                        selection,
                        (currentMeta, ts) =>
                            currentMeta.type === 'todo'
                                ? {type: 'todo', checked: !currentMeta.checked, ts}
                                : currentMeta,
                        makeCommandContext(current),
                    ),
                )
            }
            onSetCodeLanguage={(language) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'code') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        type: 'code',
                        language,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetCalloutKind={(kind) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'callout') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        type: 'callout',
                        kind,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onCopy={context.onCopy}
            onPaste={context.onPaste}
            onMoveCaret={context.moveCaretHorizontally}
            onMoveCaretVertically={context.moveCaretVertically}
            onMoveTableSelectionByArrowKey={context.moveTableSelectionByArrowKey}
            onExtendTableSelectionByArrowKey={context.extendTableSelectionByArrowKey}
            onMoveSelectionsHorizontally={context.moveSelectionsHorizontallyEverywhere}
            onMoveSelectionsVertically={context.moveSelectionsVerticallyEverywhere}
            onExtendSelectionsHorizontally={context.extendSelectionsHorizontallyEverywhere}
            onExtendSelectionsVertically={context.extendSelectionsVerticallyEverywhere}
            onExtendSelectionVerticallyWithVisualIntent={
                context.extendSelectionVerticallyWithVisualIntent
            }
            onUndo={context.onUndo}
            onRedo={context.onRedo}
            onKeystroke={context.onKeystroke}
        />
    );
};

const deriveOrderedListNumbers = (blocks: RichFormattedBlock[]): Map<string, number> => {
    const result = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const block of blocks) {
        const parentKey = block.parentId;
        if (block.block.meta.type === 'list_item' && block.block.meta.kind === 'ordered') {
            const next = (counters.get(parentKey) ?? 0) + 1;
            counters.set(parentKey, next);
            result.set(block.id, next);
        } else {
            counters.set(parentKey, 0);
        }
    }
    return result;
};

const blockTypeMeta = (
    kind: BlockTypeMenuValue,
    current: RichBlockMeta,
    ts: string,
): RichBlockMeta => {
    switch (kind) {
        case 'paragraph':
            return paragraphMeta(ts);
        case 'heading1':
            return {type: 'heading', level: 1, ts};
        case 'heading2':
            return {type: 'heading', level: 2, ts};
        case 'heading3':
            return {type: 'heading', level: 3, ts};
        case 'unordered':
            return {type: 'list_item', kind: 'unordered', ts};
        case 'ordered':
            return {type: 'list_item', kind: 'ordered', ts};
        case 'todo':
            return {type: 'todo', checked: current.type === 'todo' ? current.checked : false, ts};
        case 'blockquote':
            return {type: 'blockquote', ts};
        case 'code':
            return {type: 'code', language: current.type === 'code' ? current.language : '', ts};
        case 'callout-info':
            return {type: 'callout', kind: 'info', ts};
        case 'callout-warning':
            return {type: 'callout', kind: 'warning', ts};
        case 'callout-error':
            return {type: 'callout', kind: 'error', ts};
        case 'table':
            return current;
    }
};

const blockTypeMenuValue = (meta: RichBlockMeta | undefined): BlockTypeMenuValue => {
    if (!meta) return 'paragraph';
    switch (meta.type) {
        case 'paragraph':
            return 'paragraph';
        case 'heading':
            return meta.level === 1 ? 'heading1' : meta.level === 2 ? 'heading2' : 'heading3';
        case 'list_item':
            return meta.kind;
        case 'todo':
            return 'todo';
        case 'blockquote':
            return 'blockquote';
        case 'code':
            return 'code';
        case 'callout':
            return meta.kind === 'info'
                ? 'callout-info'
                : meta.kind === 'warning'
                  ? 'callout-warning'
                  : 'callout-error';
        case 'table':
            return 'table';
    }
};

export const deriveActiveInlineMarks = (
    state: Replica['state'],
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    pendingMarks: PendingInlineMarks,
): PendingInlineMarks => {
    const result: PendingInlineMarks = {};
    for (const mark of BARE_INLINE_MARKS) {
        result[mark] =
            selection.type === 'caret'
                ? !!pendingMarks[mark] || caretInsertionHasInlineMark(blocks, selection.point, mark)
                : selectionHasInlineMark(state, blocks, selection, mark);
    }
    return result;
};

const selectionHasInlineMark = (
    state: Replica['state'],
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    markType: BareInlineMark,
): boolean => {
    if (selection.type === 'caret') return false;

    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return false;
    return segments.every((segment) => {
        const block = blocks.find((candidate) => candidate.id === segment.blockId);
        if (!block) return false;
        const marksByOffset = inlineMarksByOffset(block);
        const selected = marksByOffset.slice(segment.startOffset, segment.endOffset);
        return selected.length > 0 && selected.every((marks) =>
            markType === CODE_MARK ? isCodeMarkValue(marks[markType]) : marks[markType] === true,
        );
    });
};

const caretInsertionHasInlineMark = (
    blocks: RichFormattedBlock[],
    point: ReturnType<typeof focusPoint>,
    markType: BareInlineMark,
): boolean => {
    const block = blocks.find((candidate) => candidate.id === point.blockId);
    if (!block) return false;
    const marksByOffset = inlineMarksByOffset(block);
    const value = marksByOffset[point.offset]?.[markType];
    return markType === CODE_MARK ? isCodeMarkValue(value) : value === true;
};

const inlineMarksByOffset = (block: RichFormattedBlock): Record<string, unknown>[] => {
    const result: Record<string, unknown>[] = [];
    for (const run of block.runs) {
        for (const _ of segmentText(run.text)) {
            result.push(run.marks);
        }
    }
    return result;
};

function AnnotationSidebar({
    state,
    annotations,
    open,
    gutterTops,
    focusRequest,
    onToggle,
    onFocusAnnotation,
    onFocusRequestHandled,
    onBodyActivity,
    onBodyCommand,
    onBodyFocusRequest,
    onBodySelectionChange,
    onResolveAnnotation,
    popoverTextById,
    footnoteNumberById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    state: Replica['state'];
    annotations: ReturnType<typeof renderedAnnotations>;
    open: boolean;
    gutterTops: Record<string, number>;
    focusRequest: CommentFocusRequest | null;
    onToggle(open: boolean): void;
    onFocusAnnotation(annotation: RenderedAnnotation): void;
    onFocusRequestHandled(): void;
    onBodyActivity(annotationId: string, bodyBlockId: string): void;
    onBodyCommand(
        command: (
            current: Replica,
            context: ReturnType<typeof makeCommandContext>,
        ) => CommandResult,
    ): void;
    onBodyFocusRequest(blockId: string, selection: EditorSelection): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    onResolveAnnotation(annotation: RenderedAnnotation): void;
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
}) {
    // if (!annotations.length && !open) return null;
    return (
        <aside
            className={
                open
                    ? 'annotationSidebar commentSidebarOpen'
                    : 'annotationSidebar commentSidebarCollapsed'
            }
            aria-label="Comments"
        >
            <button
                type="button"
                className="commentSidebarToggle"
                aria-label={open ? 'Close comments' : 'Open comments'}
                onClick={() => onToggle(!open)}
            >
                {open ? 'x' : '...'}
            </button>
            {open ? (
                <div className="commentCards">
                    {annotations.length ? (
                        annotations.map((annotation) => (
                            <section key={annotation.id} className="annotationCard">
                                <div className="annotationCardHeader">
                                    <strong>Comment on “{annotation.referenceText}”</strong>
                                    <button
                                        type="button"
                                        className="annotationResolveButton"
                                        aria-label="Resolve comment"
                                        title="Resolve comment"
                                        onClick={() => onResolveAnnotation(annotation)}
                                    >
                                        x
                                    </button>
                                </div>
                                {annotation.bodyBlocks.map((block) => (
                                    <AnnotationBodyBlock
                                        key={block.id}
                                        state={state}
                                        annotationId={annotation.id}
                                        block={block}
                                        focusRequest={focusRequest}
                                        onFocusRequestHandled={onFocusRequestHandled}
                                        onBodyActivity={onBodyActivity}
                                        onBodyCommand={onBodyCommand}
                                        onBodyFocusRequest={onBodyFocusRequest}
                                        onBodySelectionChange={onBodySelectionChange}
                                        popoverTextById={popoverTextById}
                                        footnoteNumberById={footnoteNumberById}
                                        onPopoverTriggerEnter={onPopoverTriggerEnter}
                                        onPopoverTriggerLeave={onPopoverTriggerLeave}
                                    />
                                ))}
                            </section>
                        ))
                    ) : (
                        <p className="commentEmpty">No comments</p>
                    )}
                </div>
            ) : (
                <div className="commentGutter" aria-label="Comment markers">
                    {annotations.map((annotation, index) => (
                        <button
                            key={annotation.id}
                            type="button"
                            className="commentGutterDot"
                            aria-label={`Open comment on ${annotation.referenceText}`}
                            style={{top: gutterTops[annotation.id] ?? 18 + index * 24}}
                            onClick={() => onFocusAnnotation(annotation)}
                        />
                    ))}
                </div>
            )}
        </aside>
    );
}

function Footnotes({
    state,
    annotations,
    focusRequest,
    onFocusRequestHandled,
    onBodyCommand,
    onBodyFocusRequest,
    onBodySelectionChange,
    popoverTextById,
    footnoteNumberById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    state: Replica['state'];
    annotations: ReturnType<typeof renderedAnnotations>;
    focusRequest: CommentFocusRequest | null;
    onFocusRequestHandled(): void;
    onBodyCommand(
        command: (
            current: Replica,
            context: ReturnType<typeof makeCommandContext>,
        ) => CommandResult,
    ): void;
    onBodyFocusRequest(blockId: string, selection: EditorSelection): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
}) {
    if (!annotations.length) return null;
    return (
        <ol className="footnotes" aria-label="Footnotes">
            {annotations.map((annotation) => (
                <li key={annotation.id}>
                    {annotation.bodyBlocks.length
                        ? annotation.bodyBlocks.map((block) => (
                              <AnnotationBodyBlock
                                  key={block.id}
                                  state={state}
                                  block={block}
                                  fallbackText={annotation.referenceText}
                                  focusRequest={focusRequest}
                                  onFocusRequestHandled={onFocusRequestHandled}
                                  onBodyCommand={onBodyCommand}
                                  onBodyFocusRequest={onBodyFocusRequest}
                                  onBodySelectionChange={onBodySelectionChange}
                                  popoverTextById={popoverTextById}
                                  footnoteNumberById={footnoteNumberById}
                                  onPopoverTriggerEnter={onPopoverTriggerEnter}
                                  onPopoverTriggerLeave={onPopoverTriggerLeave}
                              />
                          ))
                        : annotation.referenceText}
                </li>
            ))}
        </ol>
    );
}

function FloatingAnnotationPopover({
    state,
    annotation,
    position,
    onMouseEnter,
    onMouseLeave,
    onFocusChange,
    onEscape,
    focusRequest,
    onFocusRequestHandled,
    onBodyCommand,
    onBodyFocusRequest,
    onBodySelectionChange,
    popoverTextById,
    footnoteNumberById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    state: Replica['state'];
    annotation: RenderedAnnotation | null;
    position: ActivePopover | null;
    onMouseEnter(): void;
    onMouseLeave(event: MouseEvent<HTMLElement>): void;
    onFocusChange(focused: boolean, id?: string, relatedTarget?: EventTarget | null): void;
    onEscape(): void;
    focusRequest: CommentFocusRequest | null;
    onFocusRequestHandled(): void;
    onBodyCommand(
        command: (
            current: Replica,
            context: ReturnType<typeof makeCommandContext>,
        ) => CommandResult,
    ): void;
    onBodyFocusRequest(blockId: string, selection: EditorSelection): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
}) {
    if (!annotation || !position) return null;
    return (
        <section
            className="annotationFloatingPopover"
            role="dialog"
            aria-label="Popover"
            data-popover-id={position.id}
            style={{top: position.top, left: position.left}}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={() => onFocusChange(true, position.id)}
            onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                onFocusChange(false, position.id, event.relatedTarget);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onEscape();
            }}
        >
            {annotation.bodyBlocks.map((block) => (
                <AnnotationBodyBlock
                    key={block.id}
                    state={state}
                    block={block}
                    fallbackText={annotation.referenceText}
                    focusRequest={focusRequest}
                    onFocusRequestHandled={onFocusRequestHandled}
                    onBodyCommand={onBodyCommand}
                    onBodyFocusRequest={onBodyFocusRequest}
                    onBodySelectionChange={onBodySelectionChange}
                    popoverTextById={popoverTextById}
                    footnoteNumberById={footnoteNumberById}
                    onPopoverTriggerEnter={onPopoverTriggerEnter}
                    onPopoverTriggerLeave={onPopoverTriggerLeave}
                />
            ))}
        </section>
    );
}

function LinkFloatingPopover({
    state,
    onApply,
    onRemove,
    onClose,
}: {
    state: LinkPopoverState | null;
    onApply(href: string): void;
    onRemove(): void;
    onClose(): void;
}) {
    const [href, setHref] = useState('');

    useLayoutEffect(() => {
        setHref(state?.href ?? '');
    }, [state?.href]);

    if (!state) return null;

    const targetHref = href.trim();

    return (
        <form
            className="linkFloatingPopover"
            role="dialog"
            aria-label="Link"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(href);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                value={href}
                autoFocus
                aria-label="Link target"
                onChange={(event) => setHref(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
            <button type="button" onClick={onRemove}>
                Remove
            </button>
        </form>
    );
}

function DateEmbedFloatingPopover({
    state,
    onApply,
    onClose,
}: {
    state: EmbedPopoverState | null;
    onApply(value: string): void;
    onClose(): void;
}) {
    const [value, setValue] = useState('');

    useLayoutEffect(() => {
        setValue(state?.value ?? '');
    }, [state?.value]);

    if (!state) return null;

    return (
        <form
            className="embedFloatingPopover"
            role="dialog"
            aria-label="Date embed"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(value);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                type="date"
                value={value}
                autoFocus
                aria-label="Date value"
                onChange={(event) => setValue(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
        </form>
    );
}

function LinkHoverPopover({
    state,
    onEdit,
    onMouseEnter,
    onMouseLeave,
}: {
    state: LinkHoverPopoverState | null;
    onEdit(state: LinkPopoverState): void;
    onMouseEnter(): void;
    onMouseLeave(): void;
}) {
    if (!state) return null;
    const targetHref = state.href.trim();

    return (
        <div
            className="linkHoverPopover"
            role="dialog"
            aria-label="Link actions"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <a className="linkHoverUrl" href={targetHref} target="_blank" rel="noreferrer">
                {state.href}
            </a>
            <button type="button" onClick={() => onEdit(state)}>
                Edit
            </button>
        </div>
    );
}

function CodeFloatingPopover({
    state,
    onApply,
    onClearLanguage,
    onRemove,
    onClose,
}: {
    state: CodePopoverState | null;
    onApply(language: string, ranges: CodeTargetRange[]): void;
    onClearLanguage(ranges: CodeTargetRange[]): void;
    onRemove(ranges: CodeTargetRange[]): void;
    onClose(): void;
}) {
    const [language, setLanguage] = useState('');

    useLayoutEffect(() => {
        if (state) setLanguage(state.language);
    }, [state?.language]);

    if (!state) return null;

    return (
        <form
            className="linkFloatingPopover codeFloatingPopover"
            role="dialog"
            aria-label="Inline code language"
            style={{top: state.top, left: state.left}}
            onSubmit={(event) => {
                event.preventDefault();
                onApply(language, state.ranges);
            }}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                onClose();
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <input
                value={language}
                name="language"
                autoFocus
                aria-label="Code language"
                placeholder="language"
                onChange={(event) => setLanguage(event.currentTarget.value)}
            />
            <button type="submit">Apply</button>
            <button type="button" onClick={() => onClearLanguage(state.ranges)}>
                Clear language
            </button>
            <button type="button" onClick={() => onRemove(state.ranges)}>
                Remove code
            </button>
        </form>
    );
}

function CodeHoverPopover({
    state,
    onEdit,
    onMouseEnter,
    onMouseLeave,
}: {
    state: CodeHoverPopoverState | null;
    onEdit(state: CodePopoverState): void;
    onMouseEnter(): void;
    onMouseLeave(): void;
}) {
    if (!state) return null;

    return (
        <div
            className="linkHoverPopover codeHoverPopover"
            role="dialog"
            aria-label="Inline code actions"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <span className="codeHoverLanguage">{state.language || 'No language'}</span>
            <button type="button" onClick={() => onEdit(state)}>
                Edit
            </button>
        </div>
    );
}

function AnnotationBodyBlock({
    state,
    annotationId,
    block,
    fallbackText = '',
    focusRequest,
    onFocusRequestHandled,
    onBodyActivity,
    onBodyCommand,
    onBodyFocusRequest,
    onBodySelectionChange,
    popoverTextById,
    footnoteNumberById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    state: Replica['state'];
    annotationId?: string;
    block: ReturnType<typeof renderedAnnotations>[number]['bodyBlocks'][number];
    fallbackText?: string;
    focusRequest?: CommentFocusRequest | null;
    onFocusRequestHandled?(): void;
    onBodyActivity?(annotationId: string, bodyBlockId: string): void;
    onBodyCommand(
        command: (
            current: Replica,
            context: ReturnType<typeof makeCommandContext>,
        ) => CommandResult,
    ): void;
    onBodyFocusRequest?(blockId: string, selection: EditorSelection): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
}) {
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const linkHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const codeHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [selection, setSelection] = useState<EditorSelection>(() =>
        caret(block.id, block.text.length),
    );
    const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);
    const [linkHoverPopover, setLinkHoverPopover] = useState<LinkHoverPopoverState | null>(null);
    const [codePopover, setCodePopover] = useState<CodePopoverState | null>(null);
    const [codeHoverPopover, setCodeHoverPopover] = useState<CodeHoverPopoverState | null>(null);
    const [pendingCodeMark, setPendingCodeMark] = useState(false);
    const [retainedCodeMarks, setRetainedCodeMarks] = useState<RetainedInlineMarkSession[]>([]);

    const restoreAfter = useCallback(
        (selection: EditorSelection) => {
            pendingCaretRestoreBlockIdRef.current =
                selection.type === 'caret' && selection.point.blockId === block.id
                    ? block.id
                    : null;
            pendingSelectionRestoreRef.current = selection.type === 'range' ? selection : null;
            setSelection(selection);
            onBodySelectionChange(selection);
            if (annotationId) onBodyActivity?.(annotationId, block.id);
        },
        [annotationId, block.id, onBodyActivity, onBodySelectionChange],
    );

    const updateSelection = useCallback(
        (nextSelection: EditorSelection | null) => {
            setSelection(nextSelection ?? caret(block.id, block.text.length));
            onBodySelectionChange(nextSelection);
        },
        [block.id, block.text.length, onBodySelectionChange],
    );

    const copyBodySelection = useCallback(
        (event: ClipboardEvent<HTMLDivElement>) => {
            const selected = readSelectionFromDom(event.currentTarget) ?? selection;
            const payload = serializeSelectionToClipboardPayload(
                state,
                singleRetainedSelectionSet(state, selected),
            );
            if (!payload) return;
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.plainText);
            event.clipboardData.setData('text/html', payload.html);
        },
        [selection, state],
    );

    useLayoutEffect(() => {
        if (focusRequest?.blockId !== block.id) return;
        const nextSelection = focusRequest.selection ?? caret(block.id, block.text.length);
        pendingCaretRestoreBlockIdRef.current =
            nextSelection.type === 'caret' && nextSelection.point.blockId === block.id
                ? block.id
                : null;
        pendingSelectionRestoreRef.current = nextSelection.type === 'range' ? nextSelection : null;
        setSelection(nextSelection);
        onBodySelectionChange(nextSelection);
        onFocusRequestHandled?.();
    }, [
        block.id,
        block.text.length,
        focusRequest?.blockId,
        focusRequest?.token,
        onBodySelectionChange,
        onFocusRequestHandled,
        focusRequest?.selection,
    ]);

    const run = useCallback(
        (
            selection: EditorSelection,
            apply: (
                state: Replica['state'],
                selection: EditorSelection,
                context: ReturnType<typeof makeCommandContext>,
            ) => CommandResult,
        ) => {
            onBodyCommand((current, context) => {
                const result = apply(current.state, selection, context);
                if (focusPoint(result.selection).blockId !== block.id) {
                    onBodyFocusRequest?.(focusPoint(result.selection).blockId, result.selection);
                }
                restoreAfter(result.selection);
                return result;
            });
        },
        [block.id, onBodyCommand, onBodyFocusRequest, restoreAfter],
    );

    const rangeSelection = useCallback(
        (range: LinkTargetRange): EditorSelection => ({
            type: 'range',
            anchor: {blockId: range.blockId, offset: range.startOffset},
            focus: {blockId: range.blockId, offset: range.endOffset},
        }),
        [],
    );

    const openBodyLinkPopover = useCallback(
        (ranges: LinkTargetRange[], href: string, position: {top: number; left: number}) => {
            setLinkPopover({ranges, href, ...position});
        },
        [],
    );

    const applyBodyLink = useCallback(
        (href: string) => {
            const range = linkPopover?.ranges[0];
            setLinkPopover(null);
            if (!range) return;
            const selected = rangeSelection(range);
            const value = href.trim();
            run(selected, (state, activeSelection, context) =>
                value
                    ? setAnnotationBodyLink(state, activeSelection, value, context)
                    : removeAnnotationBodyLink(state, activeSelection, context),
            );
        },
        [linkPopover?.ranges, rangeSelection, run],
    );

    const removeBodyLink = useCallback(() => {
        const range = linkPopover?.ranges[0];
        setLinkPopover(null);
        if (!range) return;
        run(rangeSelection(range), removeAnnotationBodyLink);
    }, [linkPopover?.ranges, rangeSelection, run]);

    const applyBodyCodeLanguage = useCallback(
        (language: string, ranges: CodeTargetRange[]) => {
            const range = ranges[0];
            setCodePopover(null);
            if (!range) return;
            const selected = rangeSelection(range);
            const value = language.trim();
            run(selected, (state, activeSelection, context) =>
                value
                    ? setAnnotationBodyCodeMark(state, activeSelection, value, context)
                    : clearAnnotationBodyCodeLanguage(state, activeSelection, context),
            );
        },
        [rangeSelection, run],
    );

    const clearBodyCodeLanguage = useCallback((ranges: CodeTargetRange[]) => {
        const range = ranges[0];
        setCodePopover(null);
        if (!range) return;
        run(rangeSelection(range), clearAnnotationBodyCodeLanguage);
    }, [rangeSelection, run]);

    const removeBodyCode = useCallback((ranges: CodeTargetRange[]) => {
        const range = ranges[0];
        setCodePopover(null);
        if (!range) return;
        run(rangeSelection(range), removeAnnotationBodyCodeMark);
    }, [rangeSelection, run]);

    const cancelBodyLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = null;
    }, []);

    const scheduleBodyLinkHoverHide = useCallback(() => {
        if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
        linkHoverHideTimerRef.current = setTimeout(() => {
            setLinkHoverPopover(null);
            linkHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    const cancelBodyCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = null;
    }, []);

    const scheduleBodyCodeHoverHide = useCallback(() => {
        if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        codeHoverHideTimerRef.current = setTimeout(() => {
            setCodeHoverPopover(null);
            codeHoverHideTimerRef.current = null;
        }, 100);
    }, []);

    useLayoutEffect(
        () => () => {
            if (linkHoverHideTimerRef.current) clearTimeout(linkHoverHideTimerRef.current);
            if (codeHoverHideTimerRef.current) clearTimeout(codeHoverHideTimerRef.current);
        },
        [],
    );

    const showBodyLinkHover = useCallback(
        (range: LinkTargetRange & {href: string}, element: HTMLElement) => {
            cancelBodyLinkHoverHide();
            setLinkHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                href: range.href,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelBodyLinkHoverHide],
    );

    const showBodyCodeHover = useCallback(
        (range: CodeTargetRange & {language: string}, element: HTMLElement) => {
            cancelBodyCodeHoverHide();
            setCodeHoverPopover({
                ranges: [
                    {
                        blockId: range.blockId,
                        startOffset: range.startOffset,
                        endOffset: range.endOffset,
                    },
                ],
                language: range.language,
                ...linkPopoverPositionFromElement(element),
            });
        },
        [cancelBodyCodeHoverHide],
    );

    return (
        <>
            {annotationBodyMarker(block.meta)}
            <RichTextEditableSurface
                blockId={block.id}
                runs={block.runs}
                charIdsByOffset={orderedCharIdsForBlock(state, block.id, {visibleOnly: true})}
                decorations={null}
                pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
                pendingSelectionRestoreRef={pendingSelectionRestoreRef}
                selection={selection}
                className="annotationBodyEditor"
                ariaLabel="Annotation body"
                placeholder={fallbackText || 'Annotation body'}
                popoverTextById={popoverTextById}
                footnoteNumberById={footnoteNumberById}
                onPopoverTriggerEnter={onPopoverTriggerEnter}
                onPopoverTriggerLeave={onPopoverTriggerLeave}
                onLinkHoverEnter={showBodyLinkHover}
                onLinkHoverLeave={scheduleBodyLinkHoverHide}
                onCodeHoverEnter={showBodyCodeHover}
                onCodeHoverLeave={scheduleBodyCodeHoverHide}
                onSelectionChange={updateSelection}
                onInsertText={(text, activeSelection) =>
                    run(activeSelection ?? selection, (state, selected, context) => {
                        if (pendingCodeMark && selected.type === 'caret') {
                            const result = insertTextWithRetainedMarks(
                                state,
                                selected,
                                text,
                                [CODE_MARK],
                                retainedCodeMarks,
                                context,
                            );
                            setRetainedCodeMarks(result.sessions);
                            return result;
                        }
                        return text === '`'
                            ? insertTextWithMarkdownShortcuts(state, selected, text, context)
                            : replaceAnnotationBodySelection(state, selected, text, context);
                    })
                }
                onDeleteBackward={(activeSelection) =>
                    run(activeSelection ?? selection, (state, selected, context) =>
                        deleteAnnotationBodyBackward(state, selected, context, {
                            annotationId,
                            bodyBlockId: block.id,
                        }),
                    )
                }
                onDeleteForward={(activeSelection) =>
                    run(activeSelection ?? selection, deleteAnnotationBodyForward)
                }
                onCopy={copyBodySelection}
                onPaste={(event) => {
                    const selected = readSelectionFromDom(event.currentTarget) ?? selection;
                    const rich = parseBlockRichTextClipboardPayload(
                        event.clipboardData.getData(BLOCK_RICH_TEXT_MIME),
                    );
                    if (rich) {
                        event.preventDefault();
                        run(selected, (state, activeSelection, context) => {
                            const result = pasteRichClipboardEverywhere(
                                state,
                                singleRetainedSelectionSet(state, activeSelection),
                                rich,
                                context,
                            );
                            return {
                                state: result.state,
                                ops: result.ops,
                                selection: primarySelection(resolveSelectionSet(result.state, result.selection)),
                            };
                        });
                        return;
                    }

                    event.preventDefault();
                    const text = event.clipboardData.getData('text/plain');
                    if (isLinkLikeText(text) && selected.type === 'range') {
                        run(selected, (state, activeSelection, context) =>
                            setAnnotationBodyLink(state, activeSelection, text.trim(), context),
                        );
                        return;
                    }
                    run(selected, (state, activeSelection, context) =>
                        pasteAnnotationBodyTextWithMarkdownShortcuts(state, activeSelection, text, context),
                    );
                }}
                onKeyDown={(event) => {
                    const currentSelection = readSelectionFromDom(event.currentTarget);
                    if (currentSelection) updateSelection(currentSelection);
                    const selected = currentSelection ?? selection;
                    const modifierPressed = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        run(selected, (state, activeSelection, context) =>
                            splitAnnotationBodyBlock(state, activeSelection, context),
                        );
                        return;
                    }
                    if (modifierPressed && (key === 'b' || key === 'i')) {
                        event.preventDefault();
                        run(selected, (state, activeSelection, context) =>
                            toggleAnnotationBodyMark(
                                state,
                                activeSelection,
                                key === 'b' ? 'bold' : 'italic',
                                context,
                            ),
                        );
                    } else if (modifierPressed && event.shiftKey && key === 'x') {
                        event.preventDefault();
                        run(selected, (state, activeSelection, context) =>
                            toggleAnnotationBodyMark(
                                state,
                                activeSelection,
                                'strikethrough',
                                context,
                            ),
                        );
                    } else if (modifierPressed && key === 'e') {
                        event.preventDefault();
                        if (selected.type === 'caret') {
                            if (pendingCodeMark) {
                                run(selected, (state, _activeSelection, context) => {
                                    const result = closeRetainedInlineMarkSessions(
                                        state,
                                        retainedCodeMarks,
                                        CODE_MARK,
                                        context,
                                    );
                                    setRetainedCodeMarks(result.sessions);
                                    setPendingCodeMark(false);
                                    return {
                                        state: result.state,
                                        ops: result.ops,
                                        selection: selected,
                                    };
                                });
                            } else {
                                setPendingCodeMark(true);
                            }
                        } else {
                            run(selected, (state, activeSelection, context) =>
                                toggleAnnotationBodyCodeMark(state, activeSelection, context),
                            );
                        }
                    } else if (modifierPressed && key === 'k') {
                        event.preventDefault();
                        if (selected.type === 'range') {
                            const ranges = [
                                {
                                    blockId: block.id,
                                    startOffset: Math.min(
                                        selected.anchor.offset,
                                        selected.focus.offset,
                                    ),
                                    endOffset: Math.max(
                                        selected.anchor.offset,
                                        selected.focus.offset,
                                    ),
                                },
                            ];
                            const selectedText = textForSelectionSegments(
                                [
                                    {
                                        id: block.id,
                                        runs: block.runs,
                                        depth: 0,
                                        parentId: '',
                                        block: {} as RichFormattedBlock['block'],
                                    },
                                ],
                                ranges,
                            ).trim();
                            if (isLinkLikeText(selectedText)) {
                                run(selected, (state, activeSelection, context) =>
                                    setAnnotationBodyLink(
                                        state,
                                        activeSelection,
                                        selectedText,
                                        context,
                                    ),
                                );
                            } else {
                                openBodyLinkPopover(
                                    ranges,
                                    linkHrefForSelectionSegments(
                                        [
                                            {
                                                id: block.id,
                                                runs: block.runs,
                                                depth: 0,
                                                parentId: '',
                                                block: {} as RichFormattedBlock['block'],
                                            },
                                        ],
                                        ranges,
                                    ) ?? '',
                                    linkPopoverPositionFromSelection(event.currentTarget),
                                );
                            }
                        } else {
                            const range = linkRangeAroundOffsetInRuns(
                                block.id,
                                block.runs,
                                selected.point.offset,
                            );
                            if (range) {
                                openBodyLinkPopover(
                                    [range],
                                    range.href,
                                    linkPopoverPositionFromSelection(event.currentTarget),
                                );
                            }
                        }
                    }
                }}
            />
            <LinkFloatingPopover
                state={linkPopover}
                onApply={applyBodyLink}
                onRemove={removeBodyLink}
                onClose={() => setLinkPopover(null)}
            />
            <LinkHoverPopover
                state={linkHoverPopover}
                onEdit={(state) => {
                    cancelBodyLinkHoverHide();
                    setLinkHoverPopover(null);
                    setLinkPopover(state);
                }}
                onMouseEnter={cancelBodyLinkHoverHide}
                onMouseLeave={scheduleBodyLinkHoverHide}
            />
            <CodeFloatingPopover
                state={codePopover}
                onApply={applyBodyCodeLanguage}
                onClearLanguage={clearBodyCodeLanguage}
                onRemove={removeBodyCode}
                onClose={() => setCodePopover(null)}
            />
            <CodeHoverPopover
                state={codeHoverPopover}
                onEdit={(state) => {
                    cancelBodyCodeHoverHide();
                    setCodeHoverPopover(null);
                    setCodePopover(state);
                }}
                onMouseEnter={cancelBodyCodeHoverHide}
                onMouseLeave={scheduleBodyCodeHoverHide}
            />
        </>
    );
}

const annotationBodyMarker = (meta: RichBlockMeta): ReactElement | null => {
    if (meta.type === 'list_item') {
        return (
            <span className="annotationBodyMarker" aria-hidden="true">
                {meta.kind === 'ordered' ? '1.' : '•'}
            </span>
        );
    }
    if (meta.type === 'todo') {
        return (
            <span className="annotationBodyMarker" aria-hidden="true">
                {meta.checked ? '☑' : '☐'}
            </span>
        );
    }
    return null;
};

const renderStaticRuns = (runs: RichFormattedBlock['runs']): ReactElement[] =>
    runs.map((run, index) => (
        <span
            key={index}
            className={[
                run.marks.bold ? 'markBold' : '',
                run.marks.italic ? 'markItalic' : '',
                run.marks.strikethrough ? 'markStrikethrough' : '',
                typeof run.marks[LINK_MARK] === 'string' ? 'markLink' : '',
                isCodeMarkValue(run.marks[CODE_MARK]) ? 'markCode' : '',
                hasAnnotationMark(run) ? 'markAnnotation' : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-link-href={
                typeof run.marks[LINK_MARK] === 'string' ? run.marks[LINK_MARK] : undefined
            }
        >
            {run.text}
        </span>
    ));

function Toolbar({
    canUndo,
    canRedo,
    blockType,
    activeMarks,
    onUndo,
    onRedo,
    onBold,
    onItalic,
    onStrikethrough,
    onCode,
    onLink,
    onDateEmbed,
    onBlockType,
    onAnnotation,
}: {
    canUndo: boolean;
    canRedo: boolean;
    blockType: BlockTypeMenuValue;
    activeMarks: PendingInlineMarks;
    onUndo(): void;
    onRedo(): void;
    onBold(): void;
    onItalic(): void;
    onStrikethrough(): void;
    onCode(): void;
    onLink(): void;
    onDateEmbed(): void;
    onBlockType(kind: BlockTypeMenuValue): void;
    onAnnotation(presentation: AnnotationPresentation): void;
}) {
    return (
        <div className="toolbar" aria-label="Formatting">
            <div className="toolbarGroup" aria-label="History">
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onUndo}
                    disabled={!canUndo}
                >
                    Undo
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onRedo}
                    disabled={!canRedo}
                >
                    Redo
                </button>
            </div>
            <div className="toolbarGroup" aria-label="Inline marks">
                <button
                    type="button"
                    aria-pressed={!!activeMarks.bold}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onBold}
                >
                    <strong>B</strong>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.italic}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onItalic}
                >
                    <em>I</em>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.strikethrough}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onStrikethrough}
                    aria-label="Strikethrough"
                >
                    <span className="toolbarStrike">S</span>
                </button>
                <button
                    type="button"
                    aria-pressed={!!activeMarks.code}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onCode}
                >
                    Code
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onLink}
                >
                    Link
                </button>
                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onDateEmbed}
                >
                    Date
                </button>
            </div>
            <div className="toolbarGroup" aria-label="Annotations">
                <button
                    type="button"
                    aria-label="Comment"
                    title="Comment"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('sidebar')}
                >
                    C
                </button>
                <button
                    type="button"
                    aria-label="Footnote"
                    title="Footnote"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('footnote')}
                >
                    F
                </button>
                <button
                    type="button"
                    aria-label="Popover"
                    title="Popover"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAnnotation('popover')}
                >
                    P
                </button>
            </div>
            <select
                aria-label="Block type"
                value={blockType}
                onChange={(event) => {
                    onBlockType(event.currentTarget.value as BlockTypeMenuValue);
                }}
            >
                <option value="paragraph">Paragraph</option>
                <option value="heading1">Heading 1</option>
                <option value="heading2">Heading 2</option>
                <option value="heading3">Heading 3</option>
                <option value="unordered">Bulleted list</option>
                <option value="ordered">Numbered list</option>
                <option value="todo">Todo</option>
                <option value="blockquote">Quote</option>
                <option value="code">Code</option>
                <option value="callout-info">Info callout</option>
                <option value="callout-warning">Warning callout</option>
                <option value="callout-error">Error callout</option>
                <option value="table">Table</option>
            </select>
        </div>
    );
}

function EditableBlock({
    block,
    isTableCell,
    listNumber,
    previousBlockId,
    previousBlockLength,
    blockLength,
    charIdsByOffset,
    nextBlockId,
    selection,
    hasMultipleSelections,
    decorations,
    pendingCaretRestoreBlockIdRef,
    isDragging,
    isDraggingRoot,
    dropTarget,
    registerRow,
    onStartDrag,
    popoverTextById,
    footnoteNumberById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInsertText,
    onDeleteBackward,
    onDeleteForward,
    onSplit,
    onAdvanceFromTableCellEnd,
    onForceCodeNewline,
    onIndent,
    onUnindent,
    onMoveTableCellByTab,
    onToggleBold,
    onToggleItalic,
    onToggleStrikethrough,
    onToggleCode,
    onOpenLink,
    onLinkHoverEnter,
    onLinkHoverLeave,
    onCodeHoverEnter,
    onCodeHoverLeave,
    onInlineEmbedOpen,
    onToggleTodo,
    onSetCodeLanguage,
    onSetCalloutKind,
    onCopy,
    onPaste,
    onMoveCaret,
    onMoveCaretVertically,
    onMoveTableSelectionByArrowKey,
    onExtendTableSelectionByArrowKey,
    onMoveSelectionsHorizontally,
    onMoveSelectionsVertically,
    onExtendSelectionsHorizontally,
    onExtendSelectionsVertically,
    onExtendSelectionVerticallyWithVisualIntent,
    onUndo,
    onRedo,
    onKeystroke,
}: {
    block: RichFormattedBlock;
    isTableCell: boolean;
    listNumber: number | null;
    previousBlockId: string | null;
    previousBlockLength: number;
    blockLength: number;
    charIdsByOffset: string[];
    nextBlockId: string | null;
    selection: EditorSelection;
    hasMultipleSelections: boolean;
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    isDragging: boolean;
    isDraggingRoot: boolean;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    onInsertText(text: string, selection?: EditorSelection): void;
    onDeleteBackward(selection?: EditorSelection): void;
    onDeleteForward(selection?: EditorSelection): void;
    onSplit(): void;
    onAdvanceFromTableCellEnd(selection: EditorSelection): void;
    onForceCodeNewline(): void;
    onIndent(): void;
    onUnindent(): void;
    onMoveTableCellByTab(direction: 'forward' | 'backward'): void;
    onToggleBold(): void;
    onToggleItalic(): void;
    onToggleStrikethrough(): void;
    onToggleCode(): void;
    onOpenLink(): void;
    onLinkHoverEnter(range: LinkTargetRange & {href: string}, element: HTMLElement): void;
    onLinkHoverLeave(): void;
    onCodeHoverEnter(range: CodeTargetRange & {language: string}, element: HTMLElement): void;
    onCodeHoverLeave(): void;
    onInlineEmbedOpen(charId: string, element: HTMLElement): void;
    onToggleTodo(): void;
    onSetCodeLanguage(language: string): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onCopy(event: ClipboardEvent<HTMLElement>): void;
    onPaste(event: ClipboardEvent<HTMLElement>): void;
    onMoveCaret(selection: EditorSelection): void;
    onMoveCaretVertically(sourceBlock: HTMLElement, targetBlockId: string): void;
    onMoveTableSelectionByArrowKey(
        selection: EditorSelection,
        direction: 'left' | 'right' | 'up' | 'down',
        sourceBlock?: HTMLElement,
    ): boolean;
    onExtendTableSelectionByArrowKey(
        selection: EditorSelection,
        direction: 'left' | 'right' | 'up' | 'down',
        sourceBlock?: HTMLElement,
    ): boolean;
    onMoveSelectionsHorizontally(direction: 'left' | 'right', unit?: HorizontalMovementUnit): void;
    onMoveSelectionsVertically(direction: 'up' | 'down'): void;
    onExtendSelectionsHorizontally(
        direction: 'left' | 'right',
        unit?: HorizontalMovementUnit,
    ): void;
    onExtendSelectionsVertically(direction: 'up' | 'down'): void;
    onExtendSelectionVerticallyWithVisualIntent(
        direction: 'up' | 'down',
        sourceBlock: HTMLElement,
    ): void;
    onUndo(): void;
    onRedo(): void;
    onKeystroke(blockId: string, event: KeyboardEvent<HTMLElement>): void;
}) {
    const meta = block.block.meta;
    const codeHasTrailingNewline =
        meta.type === 'code' &&
        block.runs
            .map((run) => run.text)
            .join('')
            .endsWith('\n');
    const isCodeBlock = meta.type === 'code';
    const codeText = isCodeBlock ? block.runs.map((run) => run.text).join('') : '';
    const codeLanguage = isCodeBlock ? meta.language : '';
    const syntaxTokens = useMemo(
        () => (isCodeBlock ? highlightCode(codeText, codeLanguage) : undefined),
        [codeLanguage, codeText, isCodeBlock],
    );

    return (
        <div
            ref={(element) => registerRow(block.id, element)}
            className={[
                'blockRow',
                `blockType-${meta.type}`,
                meta.type === 'callout' ? `callout${capitalize(meta.kind)}` : '',
                isDragging ? 'dragging' : '',
                isDraggingRoot ? 'draggingRoot' : '',
                dropTarget ? `drop${capitalize(dropTarget.indicatorPlacement)}` : '',
            ]
                .filter(Boolean)
                .join(' ')}
            style={
                {
                    '--block-depth': block.depth,
                    '--drop-depth': dropTarget?.indicatorDepth ?? block.depth,
                    '--drop-offset': `${((dropTarget?.indicatorDepth ?? block.depth) - block.depth) * 24}px`,
                } as CSSProperties
            }
        >
            {!isTableCell && (
                <BlockAffordance
                    blockId={block.id}
                    meta={meta}
                    listNumber={listNumber}
                    onStartDrag={onStartDrag}
                    onToggleTodo={onToggleTodo}
                />
            )}
            <RichTextEditableSurface
                blockId={block.id}
                runs={block.runs}
                charIdsByOffset={charIdsByOffset}
                decorations={decorations}
                pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
                selection={selection}
                className={[
                    'editableBlock',
                    meta.type === 'code' ? 'codeBlock' : '',
                    meta.type === 'heading' ? `headingLevel${meta.level}` : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                ariaLabel="Block text"
                trailingCodeNewline={codeHasTrailingNewline}
                syntaxTokens={syntaxTokens}
                popoverTextById={popoverTextById}
                footnoteNumberById={footnoteNumberById}
                onPopoverTriggerEnter={onPopoverTriggerEnter}
                onPopoverTriggerLeave={onPopoverTriggerLeave}
                onLinkHoverEnter={onLinkHoverEnter}
                onLinkHoverLeave={onLinkHoverLeave}
                onCodeHoverEnter={onCodeHoverEnter}
                onCodeHoverLeave={onCodeHoverLeave}
                onInlineEmbedOpen={onInlineEmbedOpen}
                onInsertText={onInsertText}
                onDeleteBackward={onDeleteBackward}
                onDeleteForward={onDeleteForward}
                onCopy={onCopy}
                onKeyDown={(event) => {
                    onKeystroke(block.id, event);
                    const modifierPressed = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (modifierPressed && key === 'z' && event.shiftKey) {
                        event.preventDefault();
                        onRedo();
                    } else if (modifierPressed && key === 'z') {
                        event.preventDefault();
                        onUndo();
                    } else if (modifierPressed && key === 'y') {
                        event.preventDefault();
                        onRedo();
                    } else if (modifierPressed && key === 'b') {
                        event.preventDefault();
                        onToggleBold();
                    } else if (modifierPressed && key === 'i') {
                        event.preventDefault();
                        onToggleItalic();
                    } else if (modifierPressed && event.shiftKey && key === 'x') {
                        event.preventDefault();
                        onToggleStrikethrough();
                    } else if (modifierPressed && key === 'e') {
                        event.preventDefault();
                        onToggleCode();
                    } else if (modifierPressed && key === 'k') {
                        event.preventDefault();
                        onOpenLink();
                    } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (meta.type === 'code' && event.shiftKey) {
                            onForceCodeNewline();
                        } else if (meta.type === 'code') {
                            onSplit();
                        } else if (isTableCell && !event.shiftKey) {
                            onAdvanceFromTableCellEnd(
                                readSelectionFromDom(event.currentTarget) ??
                                    caret(block.id, blockLength),
                            );
                        } else {
                            onSplit();
                        }
                    } else if (event.key === 'Tab' && !event.altKey && !modifierPressed) {
                        event.preventDefault();
                        if (meta.type === 'code') {
                            onInsertText('    ');
                        } else if (isTableCell) {
                            onMoveTableCellByTab(event.shiftKey ? 'backward' : 'forward');
                        } else if (event.shiftKey) {
                            onUnindent();
                        } else {
                            onIndent();
                        }
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        onDeleteBackward();
                    } else if (event.key === 'Delete') {
                        event.preventDefault();
                        onDeleteForward();
                    } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        const direction = event.key === 'Home' ? 'left' : 'right';
                        if (event.shiftKey) {
                            onExtendSelectionsHorizontally(direction, 'block');
                        } else {
                            onMoveSelectionsHorizontally(direction, 'block');
                        }
                    } else if (
                        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
                        (event.altKey || modifierPressed)
                    ) {
                        event.preventDefault();
                        const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
                        const unit = event.altKey ? 'word' : 'block';
                        if (event.shiftKey) {
                            onExtendSelectionsHorizontally(direction, unit);
                        } else {
                            onMoveSelectionsHorizontally(direction, unit);
                        }
                    } else if (
                        isPlainArrowKey(event.key) &&
                        event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed
                    ) {
                        event.preventDefault();
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        if (currentSelection && !hasMultipleSelections) {
                            const focus = focusPoint(currentSelection);
                            if (
                                event.key === 'ArrowLeft' &&
                                focus.offset === 0 &&
                                onExtendTableSelectionByArrowKey(currentSelection, 'left')
                            ) {
                                return;
                            }
                            if (
                                event.key === 'ArrowRight' &&
                                focus.offset === blockLength &&
                                onExtendTableSelectionByArrowKey(currentSelection, 'right')
                            ) {
                                return;
                            }
                            if (
                                event.key === 'ArrowUp' &&
                                isCaretOnFirstVisualLine(event.currentTarget) &&
                                onExtendTableSelectionByArrowKey(
                                    currentSelection,
                                    'up',
                                    event.currentTarget,
                                )
                            ) {
                                return;
                            }
                            if (
                                event.key === 'ArrowDown' &&
                                isCaretOnLastVisualLine(event.currentTarget) &&
                                onExtendTableSelectionByArrowKey(
                                    currentSelection,
                                    'down',
                                    event.currentTarget,
                                )
                            ) {
                                return;
                            }
                        }
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            onExtendSelectionsHorizontally(
                                event.key === 'ArrowLeft' ? 'left' : 'right',
                            );
                        } else if (hasMultipleSelections) {
                            onExtendSelectionsVertically(event.key === 'ArrowUp' ? 'up' : 'down');
                        } else {
                            onExtendSelectionVerticallyWithVisualIntent(
                                event.key === 'ArrowUp' ? 'up' : 'down',
                                event.currentTarget,
                            );
                        }
                    } else if (
                        hasMultipleSelections &&
                        isPlainArrowKey(event.key) &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed
                    ) {
                        event.preventDefault();
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            onMoveSelectionsHorizontally(
                                event.key === 'ArrowLeft' ? 'left' : 'right',
                            );
                        } else {
                            onMoveSelectionsVertically(event.key === 'ArrowUp' ? 'up' : 'down');
                        }
                    } else if (
                        event.key === 'ArrowLeft' &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed &&
                        previousBlockId
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        if (
                            currentSelection?.type === 'caret' &&
                            currentSelection.point.offset === 0
                        ) {
                            if (onMoveTableSelectionByArrowKey(currentSelection, 'left')) {
                                event.preventDefault();
                                return;
                            }
                            event.preventDefault();
                            onMoveCaret(caret(previousBlockId, previousBlockLength));
                        }
                    } else if (
                        event.key === 'ArrowRight' &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed &&
                        nextBlockId
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        if (
                            currentSelection?.type === 'caret' &&
                            currentSelection.point.offset === blockLength
                        ) {
                            if (onMoveTableSelectionByArrowKey(currentSelection, 'right')) {
                                event.preventDefault();
                                return;
                            }
                            event.preventDefault();
                            onMoveCaret(caret(nextBlockId, 0));
                        }
                    } else if (
                        event.key === 'ArrowUp' &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed &&
                        previousBlockId
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        if (
                            currentSelection?.type === 'caret' &&
                            isCaretOnFirstVisualLine(event.currentTarget)
                        ) {
                            if (
                                onMoveTableSelectionByArrowKey(
                                    currentSelection,
                                    'up',
                                    event.currentTarget,
                                )
                            ) {
                                event.preventDefault();
                                return;
                            }
                            event.preventDefault();
                            onMoveCaretVertically(event.currentTarget, previousBlockId);
                        }
                    } else if (
                        event.key === 'ArrowDown' &&
                        !event.shiftKey &&
                        !event.altKey &&
                        !modifierPressed &&
                        nextBlockId
                    ) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        if (
                            currentSelection?.type === 'caret' &&
                            isCaretOnLastVisualLine(event.currentTarget)
                        ) {
                            if (
                                onMoveTableSelectionByArrowKey(
                                    currentSelection,
                                    'down',
                                    event.currentTarget,
                                )
                            ) {
                                event.preventDefault();
                                return;
                            }
                            event.preventDefault();
                            onMoveCaretVertically(event.currentTarget, nextBlockId);
                        }
                    }
                }}
                onPaste={onPaste}
            />
            <BlockInlineControls
                meta={meta}
                onSetCodeLanguage={onSetCodeLanguage}
                onSetCalloutKind={onSetCalloutKind}
            />
        </div>
    );
}

function RichTextEditableSurface({
    blockId,
    runs,
    charIdsByOffset,
    decorations,
    pendingCaretRestoreBlockIdRef,
    pendingSelectionRestoreRef,
    selection,
    className,
    ariaLabel,
    placeholder,
    trailingCodeNewline = false,
    syntaxTokens,
    popoverTextById = new Map(),
    footnoteNumberById = new Map(),
    onInsertText,
    onDeleteBackward,
    onDeleteForward,
    onSelectionChange,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onLinkHoverEnter,
    onLinkHoverLeave,
    onCodeHoverEnter,
    onCodeHoverLeave,
    onInlineEmbedOpen,
    onKeyDown,
    onCopy,
    onPaste,
}: {
    blockId: string;
    runs: RichFormattedBlock['runs'];
    charIdsByOffset: string[];
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    pendingSelectionRestoreRef?: MutableRefObject<EditorSelection | null>;
    selection: EditorSelection;
    className: string;
    ariaLabel: string;
    placeholder?: string;
    trailingCodeNewline?: boolean;
    syntaxTokens?: SyntaxToken[];
    popoverTextById?: Map<string, string>;
    footnoteNumberById?: Map<string, number>;
    onInsertText(text: string, selection?: EditorSelection): void;
    onDeleteBackward(selection?: EditorSelection): void;
    onDeleteForward(selection?: EditorSelection): void;
    onSelectionChange?(selection: EditorSelection | null): void;
    onPopoverTriggerEnter?(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave?(id?: string, transition?: PopoverPointerTransition): void;
    onLinkHoverEnter?(range: LinkTargetRange & {href: string}, element: HTMLElement): void;
    onLinkHoverLeave?(): void;
    onCodeHoverEnter?(range: CodeTargetRange & {language: string}, element: HTMLElement): void;
    onCodeHoverLeave?(): void;
    onInlineEmbedOpen?(charId: string, element: HTMLElement): void;
    onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
    onCopy?(event: ClipboardEvent<HTMLDivElement>): void;
    onPaste?(event: ClipboardEvent<HTMLDivElement>): void;
}) {
    const handledBeforeInputRef = useRef(false);
    const editableRef = useRef<HTMLDivElement>(null);
    const renderedRunsRef = useRef('');

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;

        const onBeforeInput = (event: InputEvent) => {
            if (event.isComposing) return;
            const selection = readSelectionFromDom(element) ?? undefined;
            if (event.inputType === 'insertText' && event.data) {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onInsertText(event.data, selection);
            } else if (event.inputType === 'deleteContentBackward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onDeleteBackward(selection);
            } else if (event.inputType === 'deleteContentForward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onDeleteForward(selection);
            }
        };

        element.addEventListener('beforeinput', onBeforeInput);
        return () => element.removeEventListener('beforeinput', onBeforeInput);
    }, [onDeleteBackward, onDeleteForward, onInsertText]);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;
        const renderedRuns = serializeRuns(
            runs,
            charIdsByOffset,
            decorations,
            trailingCodeNewline,
            footnoteNumberById,
            syntaxTokens,
        );
        if (renderedRunsRef.current !== renderedRuns) {
            renderedRunsRef.current = renderedRuns;
            element.replaceChildren(
                ...renderRunNodes(runs, decorations, {
                    blockId,
                    charIdsByOffset,
                    trailingCodeNewline,
                    syntaxTokens,
                    popoverTextById,
                    footnoteNumberById,
                }),
            );
        }
        const point = selection.type === 'caret' ? selection.point : null;
        if (point?.blockId === blockId && pendingCaretRestoreBlockIdRef.current === blockId) {
            pendingCaretRestoreBlockIdRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreCaretToDom(element, point.offset);
        }
        const rangeSelection = pendingSelectionRestoreRef?.current;
        if (rangeSelection) {
            pendingSelectionRestoreRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreSelectionToDom(element, rangeSelection);
        }
    }, [
        blockId,
        charIdsByOffset,
        decorations,
        footnoteNumberById,
        pendingCaretRestoreBlockIdRef,
        pendingSelectionRestoreRef,
        popoverTextById,
        runs,
        selection,
        syntaxTokens,
        trailingCodeNewline,
    ]);

    return (
        <div
            ref={editableRef}
            className={className}
            contentEditable
            role="textbox"
            aria-label={ariaLabel}
            suppressContentEditableWarning
            spellCheck
            data-block-id={blockId}
            data-empty={runs.length === 0 ? 'true' : undefined}
            data-placeholder={placeholder ?? '...'}
            data-trailing-newline={trailingCodeNewline ? 'true' : undefined}
            onFocus={(event) => {
                onSelectionChange?.(readSelectionFromDom(event.currentTarget));
                const nextDecorations = removePrimaryDecorations(decorations);
                if (nextDecorations === decorations) return;
                event.currentTarget.replaceChildren(
                    ...renderRunNodes(runs, nextDecorations, {
                        blockId,
                        charIdsByOffset,
                        trailingCodeNewline,
                        syntaxTokens,
                        popoverTextById,
                        footnoteNumberById,
                    }),
                );
                renderedRunsRef.current = serializeRuns(
                    runs,
                    charIdsByOffset,
                    nextDecorations,
                    trailingCodeNewline,
                    footnoteNumberById,
                    syntaxTokens,
                );
            }}
            onMouseUp={(event) => onSelectionChange?.(readSelectionFromDom(event.currentTarget))}
            onKeyUp={(event) => onSelectionChange?.(readSelectionFromDom(event.currentTarget))}
            onMouseOver={(event) => {
                const linkTrigger = linkTriggerFromEvent(event.currentTarget, event.target);
                if (linkTrigger) {
                    const relatedLinkTrigger = linkTriggerFromEvent(
                        event.currentTarget,
                        event.relatedTarget,
                    );
                    if (relatedLinkTrigger !== linkTrigger) {
                        const range = linkRangeFromTrigger(linkTrigger, blockId, runs);
                        if (range) onLinkHoverEnter?.(range, linkTrigger);
                    }
                }
                const codeTrigger = codeTriggerFromEvent(event.currentTarget, event.target);
                if (codeTrigger) {
                    const relatedCodeTrigger = codeTriggerFromEvent(
                        event.currentTarget,
                        event.relatedTarget,
                    );
                    if (relatedCodeTrigger !== codeTrigger) {
                        const range = codeRangeFromTrigger(codeTrigger, blockId, runs);
                        if (range) onCodeHoverEnter?.(range, codeTrigger);
                    }
                }
                const trigger = popoverTriggerFromEvent(event.currentTarget, event.target);
                if (!trigger) return;
                const relatedTrigger = popoverTriggerFromEvent(
                    event.currentTarget,
                    event.relatedTarget,
                );
                if (relatedTrigger === trigger) return;
                for (const id of popoverIdsForTrigger(trigger)) {
                    onPopoverTriggerEnter?.(id, trigger);
                }
            }}
            onMouseOut={(event) => {
                const linkTrigger = linkTriggerFromEvent(event.currentTarget, event.target);
                if (linkTrigger) {
                    const relatedLinkTrigger = linkTriggerFromEvent(
                        event.currentTarget,
                        event.relatedTarget,
                    );
                    if (relatedLinkTrigger !== linkTrigger) {
                        onLinkHoverLeave?.();
                    }
                }
                const codeTrigger = codeTriggerFromEvent(event.currentTarget, event.target);
                if (codeTrigger) {
                    const relatedCodeTrigger = codeTriggerFromEvent(
                        event.currentTarget,
                        event.relatedTarget,
                    );
                    if (relatedCodeTrigger !== codeTrigger) {
                        onCodeHoverLeave?.();
                    }
                }
                const trigger = popoverTriggerFromEvent(event.currentTarget, event.target);
                if (!trigger) return;
                const relatedTrigger = popoverTriggerFromEvent(
                    event.currentTarget,
                    event.relatedTarget,
                );
                if (relatedTrigger === trigger) return;
                for (const id of popoverIdsForTrigger(trigger)) {
                    onPopoverTriggerLeave?.(id, {
                        source: 'trigger',
                        relatedTarget: event.relatedTarget,
                        clientX: event.clientX,
                        clientY: event.clientY,
                    });
                }
            }}
            onClick={(event) => {
                const embedTrigger = embedTriggerFromEvent(event.currentTarget, event.target);
                if (embedTrigger?.dataset.embedCharId) {
                    event.preventDefault();
                    onInlineEmbedOpen?.(embedTrigger.dataset.embedCharId, embedTrigger);
                    return;
                }
                const trigger = popoverTriggerFromEvent(event.currentTarget, event.target);
                if (!trigger) return;
                for (const id of popoverIdsForTrigger(trigger)) {
                    onPopoverTriggerEnter?.(id, trigger);
                }
            }}
            onInput={(event) => {
                const native = event.nativeEvent as InputEvent;
                if (handledBeforeInputRef.current) {
                    handledBeforeInputRef.current = false;
                    event.currentTarget.replaceChildren(
                        ...renderRunNodes(runs, decorations, {
                            blockId,
                            charIdsByOffset,
                            trailingCodeNewline,
                            syntaxTokens,
                            popoverTextById,
                            footnoteNumberById,
                        }),
                    );
                    return;
                }
                if (native.isComposing) return;
                if (isJsdom() && native.inputType === 'insertText' && native.data) {
                    onInsertText(
                        native.data,
                        readSelectionFromDom(event.currentTarget) ?? undefined,
                    );
                }
            }}
            onKeyDown={onKeyDown}
            onCopy={onCopy}
            onPaste={onPaste}
        />
    );
}

function BlockAffordance({
    blockId,
    meta,
    listNumber,
    onStartDrag,
    onToggleTodo,
}: {
    blockId: string;
    meta: RichBlockMeta;
    listNumber: number | null;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onToggleTodo(): void;
}) {
    if (meta.type === 'list_item') {
        return (
            <button
                type="button"
                className="blockAffordance blockAffordanceButton blockAffordanceMarker"
                aria-label="Move block"
                onPointerDown={(event) => onStartDrag(blockId, event)}
            >
                {meta.kind === 'ordered' ? `${listNumber ?? 1}.` : '•'}
            </button>
        );
    }
    if (meta.type === 'todo') {
        return (
            <span
                className="blockAffordance blockAffordanceTodo"
                data-block-drag-affordance="todo"
                onPointerDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    onStartDrag(blockId, event);
                }}
                onClickCapture={(event) => {
                    if (event.currentTarget.dataset.blockDragSuppressClick !== 'true') return;
                    delete event.currentTarget.dataset.blockDragSuppressClick;
                    event.preventDefault();
                    event.stopPropagation();
                }}
            >
                <input
                    className="todoToggle"
                    type="checkbox"
                    checked={meta.checked}
                    aria-label="Toggle todo"
                    onPointerDown={(event) => onStartDrag(blockId, event)}
                    onClickCapture={(event) => {
                        if (event.currentTarget.dataset.blockDragSuppressClick !== 'true') return;
                        delete event.currentTarget.dataset.blockDragSuppressClick;
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onChange={onToggleTodo}
                />
            </span>
        );
    }
    return (
        <button
            type="button"
            className="blockAffordance blockAffordanceButton blockAffordanceHandle"
            aria-label="Move block"
            onPointerDown={(event) => onStartDrag(blockId, event)}
        >
            ⋮⋮
        </button>
    );
}

function BlockInlineControls({
    meta,
    onSetCodeLanguage,
    onSetCalloutKind,
}: {
    meta: RichBlockMeta;
    onSetCodeLanguage(language: string): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
}) {
    if (meta.type === 'code') {
        return (
            <input
                className="codeLanguage"
                value={meta.language}
                placeholder="plain"
                aria-label="Code language"
                onPointerDown={stopEditorControlEvent}
                onMouseDown={stopEditorControlEvent}
                onMouseUp={stopEditorControlEvent}
                onClick={stopEditorControlEvent}
                onChange={(event) => onSetCodeLanguage(event.currentTarget.value)}
            />
        );
    }
    if (meta.type === 'callout') {
        return (
            <select
                className="calloutKind"
                value={meta.kind}
                aria-label="Callout kind"
                onPointerDown={stopEditorControlEvent}
                onMouseDown={stopEditorControlEvent}
                onMouseUp={stopEditorControlEvent}
                onClick={stopEditorControlEvent}
                onChange={(event) =>
                    onSetCalloutKind(event.currentTarget.value as 'info' | 'warning' | 'error')
                }
            >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
            </select>
        );
    }
    return null;
}

const stopEditorControlEvent = (event: {stopPropagation(): void}) => {
    event.stopPropagation();
};

const isJsdom = () => navigator.userAgent.includes('jsdom');

const isPlainArrowKey = (key: string) =>
    key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

const isSameClick = (
    start: {x: number; y: number},
    event: MouseEvent | KeyboardEvent,
): event is MouseEvent => {
    if (event.type !== 'mouseup' || !('clientX' in event) || !('clientY' in event)) return false;
    return Math.abs(event.clientX - start.x) <= 3 && Math.abs(event.clientY - start.y) <= 3;
};

const removePrimaryDecorations = (
    decorations: BlockSelectionDecorations | null,
): BlockSelectionDecorations | null => {
    if (!decorations) return decorations;
    if (
        !decorations.carets.some((caret) => caret.primary) &&
        !decorations.segments.some((segment) => segment.primary)
    ) {
        return decorations;
    }

    const nextDecorations = {
        carets: decorations.carets.filter((caret) => !caret.primary),
        segments: decorations.segments.filter((segment) => !segment.primary),
    };
    return nextDecorations.carets.length || nextDecorations.segments.length
        ? nextDecorations
        : null;
};

const popoverTriggerFromEvent = (
    root: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null => {
    const elementConstructor = root.ownerDocument.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return null;
    const trigger = target.closest<HTMLElement>('[data-popover-id]');
    return trigger && root.contains(trigger) ? trigger : null;
};

const linkTriggerFromEvent = (
    root: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null => {
    const elementConstructor = root.ownerDocument.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return null;
    const trigger = target.closest<HTMLElement>('[data-link-href]');
    return trigger && root.contains(trigger) ? trigger : null;
};

const codeTriggerFromEvent = (
    root: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null => {
    const elementConstructor = root.ownerDocument.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return null;
    const trigger = target.closest<HTMLElement>('[data-code-start-offset]');
    return trigger && root.contains(trigger) ? trigger : null;
};

const embedTriggerFromEvent = (
    root: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null => {
    const elementConstructor = root.ownerDocument.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return null;
    const trigger = target.closest<HTMLElement>('[data-inline-embed="true"]');
    return trigger && root.contains(trigger) ? trigger : null;
};

const linkRangeFromTrigger = (
    trigger: HTMLElement,
    blockId: string,
    runs: RichFormattedBlock['runs'],
): (LinkTargetRange & {href: string}) | null => {
    const startOffset = Number(trigger.dataset.linkStartOffset);
    if (!Number.isFinite(startOffset)) return null;
    return linkRangeAroundOffsetInRuns(blockId, runs, startOffset);
};

const codeRangeFromTrigger = (
    trigger: HTMLElement,
    blockId: string,
    runs: RichFormattedBlock['runs'],
): (CodeTargetRange & {language: string}) | null => {
    const startOffset = Number(trigger.dataset.codeStartOffset);
    if (!Number.isFinite(startOffset)) return null;
    return codeRangeAroundOffsetInRuns(blockId, runs, startOffset);
};

const inlineEmbedDataByCharId = (
    state: Replica['state'],
    charId: string,
): {type: string; value: string} | null => {
    const blocks = materializeFormattedBlocks(state, annotationMarkBehavior);
    for (const block of blocks) {
        const charIds = orderedCharIdsForBlock(state, block.id, {visibleOnly: true});
        const offset = charIds.indexOf(charId);
        if (offset < 0) continue;
        let runStart = 0;
        for (const run of block.runs) {
            const length = segmentText(run.text).length;
            if (offset >= runStart && offset < runStart + length) {
                const data = run.marks[INLINE_EMBED_MARK];
                if (!isInlineEmbedData(data)) return null;
                return {type: data.type, value: inlineEmbedInputValue(data.value)};
            }
            runStart += length;
        }
    }
    return null;
};

const inlineEmbedInputValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as {date?: unknown}).date === 'string') {
        return (value as {date: string}).date;
    }
    return '';
};

const overlayTransientSelections = (
    demo: DemoState,
    selections: Partial<Record<EditorId, RetainedSelectionSet>>,
): DemoState => ({
    left: selections.left ? {...demo.left, selection: selections.left} : demo.left,
    right: selections.right ? {...demo.right, selection: selections.right} : demo.right,
});

const formatKeystroke = (keystroke: HistoryKeystroke) => {
    const modifiers = [
        keystroke.metaKey ? 'Meta' : '',
        keystroke.ctrlKey ? 'Ctrl' : '',
        keystroke.altKey ? 'Alt' : '',
        keystroke.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    return [...modifiers, keystroke.key].join('+') + (keystroke.repeat ? ' repeat' : '');
};

const occurrenceSelectionSet = (
    state: Replica['state'],
    clickedSelection: EditorSelection,
    nextSelectionId: () => string,
    fallback: RetainedSelectionSet,
): RetainedSelectionSet => {
    const word = wordAtPoint(state, firstPointForSelection(state, clickedSelection));
    if (!word) return fallback;
    const occurrences = findWordOccurrences(state, word.text);
    if (!occurrences.length) return fallback;

    let primaryId = '';
    const entries = occurrences.map((selection) => {
        const id = nextSelectionId();
        if (!primaryId && sameSelectionRange(selection, word.selection)) {
            primaryId = id;
        }
        return {id, selection};
    });
    const resolved: EditorSelectionSet = {primaryId: primaryId || entries[0].id, entries};
    return retainSelectionSet(state, resolved);
};

const sameSelectionRange = (one: EditorSelection, two: EditorSelection) => {
    if (one.type !== 'range' || two.type !== 'range') return false;
    return (
        one.anchor.blockId === two.anchor.blockId &&
        one.anchor.offset === two.anchor.offset &&
        one.focus.blockId === two.focus.blockId &&
        one.focus.offset === two.focus.offset
    );
};

const numberRecordEquals = (one: Record<string, number>, two: Record<string, number>) => {
    const oneKeys = Object.keys(one);
    const twoKeys = Object.keys(two);
    if (oneKeys.length !== twoKeys.length) return false;
    return oneKeys.every((key) => one[key] === two[key]);
};

const editorSelectionKey = (selection: EditorSelection): string => {
    if (selection.type === 'caret') {
        return `caret:${selection.point.blockId}:${selection.point.offset}`;
    }
    return [
        'range',
        selection.anchor.blockId,
        selection.anchor.offset,
        selection.focus.blockId,
        selection.focus.offset,
    ].join(':');
};

const selectedPopoverIdsForSelection = (
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    popoverTextById: Map<string, string>,
): string[] => {
    const segments = selectionSegmentsForBlocks(blocks, selection);
    if (!segments.length) return [];

    const selectedByBlock = new Map(segments.map((segment) => [segment.blockId, segment] as const));
    const popoverRanges = new Map<
        string,
        Array<{blockId: string; startOffset: number; endOffset: number}>
    >();

    for (const block of blocks) {
        let offset = 0;
        for (const run of block.runs) {
            const length = segmentText(run.text).length;
            const ids = popoverIdsForRun(run, popoverTextById);
            if (length && ids.length) {
                for (const id of ids) {
                    const ranges = popoverRanges.get(id) ?? [];
                    ranges.push({
                        blockId: block.id,
                        startOffset: offset,
                        endOffset: offset + length,
                    });
                    popoverRanges.set(id, ranges);
                }
            }
            offset += length;
        }
    }

    const result: string[] = [];
    for (const [id, ranges] of popoverRanges) {
        if (
            ranges.every((range) => {
                const selected = selectedByBlock.get(range.blockId);
                return (
                    selected &&
                    selected.startOffset <= range.startOffset &&
                    selected.endOffset >= range.endOffset
                );
            })
        ) {
            result.push(id);
        }
    }
    return result;
};

const selectionSegmentsForBlocks = (
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
): Array<{blockId: string; startOffset: number; endOffset: number}> => {
    if (selection.type === 'caret') return [];
    const blockIds = blocks.map((block) => block.id);
    const anchorIndex = blockIds.indexOf(selection.anchor.blockId);
    const focusIndex = blockIds.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) return [];

    let start = selection.anchor;
    let end = selection.focus;
    if (
        anchorIndex > focusIndex ||
        (anchorIndex === focusIndex && selection.anchor.offset > selection.focus.offset)
    ) {
        start = selection.focus;
        end = selection.anchor;
    }

    const startIndex = blockIds.indexOf(start.blockId);
    const endIndex = blockIds.indexOf(end.blockId);
    const segments: Array<{blockId: string; startOffset: number; endOffset: number}> = [];
    for (let index = startIndex; index <= endIndex; index++) {
        const block = blocks[index];
        const length = formattedBlockTextLength(block);
        const startOffset = index === startIndex ? Math.min(start.offset, length) : 0;
        const endOffset = index === endIndex ? Math.min(end.offset, length) : length;
        if (startOffset < endOffset) {
            segments.push({blockId: block.id, startOffset, endOffset});
        }
    }
    return segments;
};

const formattedBlockTextLength = (block: RichFormattedBlock): number =>
    block.runs.reduce((length, run) => length + segmentText(run.text).length, 0);

const linkRangesForSelectionSet = (
    state: Replica['state'],
    selection: RetainedSelectionSet,
): LinkTargetRange[] =>
    resolveSelectionSet(state, selection).entries.flatMap((entry) =>
        normalizeSelectionSegments(state, entry.selection),
    );

const retainedSelectionSetForRanges = (
    state: Replica['state'],
    ranges: Array<LinkTargetRange | CodeTargetRange>,
    prefix: string,
): RetainedSelectionSet => {
    const entries = ranges.map((range, index) => ({
        id: `${prefix}-${index}`,
        selection: {
            type: 'range' as const,
            anchor: {blockId: range.blockId, offset: range.startOffset},
            focus: {blockId: range.blockId, offset: range.endOffset},
        },
    }));
    return retainSelectionSet(state, {primaryId: entries[0]?.id ?? `${prefix}-0`, entries});
};

const rangeSelectionFromRange = (range: LinkTargetRange | CodeTargetRange): EditorSelection => ({
    type: 'range',
    anchor: {blockId: range.blockId, offset: range.startOffset},
    focus: {blockId: range.blockId, offset: range.endOffset},
});

const linkPopoverPositionFromSelection = (
    root: HTMLElement | null,
): {top: number; left: number} => {
    const fallbackRect = root?.getBoundingClientRect();
    const selection = root?.ownerDocument.defaultView?.getSelection();
    const rect =
        selection &&
        selection.rangeCount > 0 &&
        typeof selection.getRangeAt(0).getBoundingClientRect === 'function'
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
    const top = rect && rect.height ? rect.bottom + 8 : (fallbackRect?.top ?? 0) + 28;
    const left = rect && rect.width ? rect.left : (fallbackRect?.left ?? 0);
    return {top, left};
};

const linkPopoverPositionFromElement = (element: HTMLElement): {top: number; left: number} => {
    const rect = element.getBoundingClientRect();
    return {top: rect.bottom + 8, left: rect.left};
};

const serializeRuns = (
    runs: RichFormattedBlock['runs'],
    charIdsByOffset: string[],
    decorations: BlockSelectionDecorations | null,
    trailingCodeNewline = false,
    footnoteNumberById: Map<string, number> = new Map(),
    syntaxTokens?: SyntaxToken[],
) =>
    JSON.stringify({
        runs: runs.map((run) => [
            run.text,
            run.marks.bold,
            run.marks.italic,
            run.marks.strikethrough,
            run.marks[LINK_MARK],
            run.marks[CODE_MARK],
            run.marks[INLINE_EMBED_MARK],
        ]),
        stackedMarks: runs.map((run) => run.stackedMarks),
        charIdsByOffset,
        decorations,
        trailingCodeNewline,
        syntaxTokens,
        footnoteNumbers: [...footnoteNumberById.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });

const renderRunNodes = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    options: {
        blockId?: string;
        charIdsByOffset?: string[];
        trailingCodeNewline?: boolean;
        syntaxTokens?: SyntaxToken[];
        popoverTextById?: Map<string, string>;
        footnoteNumberById?: Map<string, number>;
    } = {},
): Node[] => {
    const chunks = runRenderChunks(runs, decorations, options.syntaxTokens);
    const nodes: Node[] = [];
    const renderedCarets = new Set<string>();
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        if (decorations) {
            const chunkStart = chunk.blockStartOffset;
            const chunkEnd = chunk.blockEndOffset;
            renderCaretsAtOffset(nodes, decorations, renderedCarets, chunkStart);

            const node = renderRunChunkNode(chunk, options);
            const highlight = decorations.segments.find(
                (selectionSegment) =>
                    chunkStart >= selectionSegment.startOffset &&
                    chunkEnd <= selectionSegment.endOffset,
            );
            if (highlight) {
                node.classList.add('retainedSelectionHighlight');
                node.dataset.retainedSelection = 'highlight';
                node.dataset.selectionEntryId = highlight.id;
                node.dataset.selectionPrimary = String(highlight.primary);
            }
            nodes.push(node);
        } else {
            nodes.push(renderRunChunkNode(chunk, options));
        }
        nodes.push(
            ...renderEndingFootnoteReferences(
                chunk,
                chunks[index + 1] ?? null,
                options.footnoteNumberById,
            ),
        );
    }
    if (decorations) {
        const finalOffset = chunks.at(-1)?.blockEndOffset ?? formattedRunsTextLength(runs);
        renderCaretsAtOffset(nodes, decorations, renderedCarets, finalOffset);
    }
    return appendTrailingCodeNewlineSentinel(nodes, options);
};

const renderRunChunkNode = (
    chunk: RunRenderChunk,
    options: {
        blockId?: string;
        charIdsByOffset?: string[];
        popoverTextById?: Map<string, string>;
    },
): HTMLElement => {
    if (chunk.text === INLINE_EMBED_TEXT && segmentText(chunk.text).length === 1) {
        const data = inlineEmbedDataForRun(chunk.run);
        const plainText = plainTextForInlineEmbed(data, inlineEmbedPlugins, {
            ambientMarks: chunk.run.marks,
        });
        return renderInlineEmbed(data, inlineEmbedPlugins, {
            blockId: options.blockId ?? '',
            charId: options.charIdsByOffset?.[chunk.blockStartOffset] ?? '',
            startOffset: chunk.blockStartOffset,
            ambientMarks: chunk.run.marks,
            plainText,
        });
    }
    const span = document.createElement('span');
    span.textContent = chunk.text;
    applyRunClasses(span, chunk, options.popoverTextById);
    return span;
};

type RunRenderChunk = {
    run: RichFormattedBlock['runs'][number];
    text: string;
    blockStartOffset: number;
    blockEndOffset: number;
    syntaxClassName: string | null;
};

const runRenderChunks = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    syntaxTokens?: SyntaxToken[],
): RunRenderChunk[] => {
    const chunks: RunRenderChunk[] = [];
    const syntaxRanges = [
        ...syntaxTokenRanges(syntaxTokens, formattedRunsTextLength(runs)),
        ...inlineCodeSyntaxRanges(runs),
    ];
    let offset = 0;
    for (const run of runs) {
        const runSegments = segmentText(run.text);
        const runStart = offset;
        const runEnd = runStart + runSegments.length;
        const boundaries = new Set([0, runSegments.length]);
        for (let index = 0; index < runSegments.length; index++) {
            if (runSegments[index] !== INLINE_EMBED_TEXT) continue;
            boundaries.add(index);
            boundaries.add(index + 1);
        }

        if (decorations) {
            for (const selectionSegment of decorations.segments) {
                addBoundaryInRun(
                    boundaries,
                    selectionSegment.startOffset - runStart,
                    runSegments.length,
                );
                addBoundaryInRun(
                    boundaries,
                    selectionSegment.endOffset - runStart,
                    runSegments.length,
                );
            }
            for (const caret of decorations.carets) {
                addBoundaryInRun(boundaries, caret.offset - runStart, runSegments.length);
            }
        }
        for (const range of syntaxRanges) {
            addBoundaryInRun(boundaries, range.startOffset - runStart, runSegments.length);
            addBoundaryInRun(boundaries, range.endOffset - runStart, runSegments.length);
        }

        const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
        for (let index = 0; index < sortedBoundaries.length - 1; index++) {
            const start = sortedBoundaries[index];
            const end = sortedBoundaries[index + 1];
            if (start === end) continue;
            chunks.push({
                run,
                text: runSegments.slice(start, end).join(''),
                blockStartOffset: runStart + start,
                blockEndOffset: runStart + end,
                syntaxClassName: syntaxClassNameForRange(
                    syntaxRanges,
                    runStart + start,
                    runStart + end,
                ),
            });
        }
        offset = runEnd;
    }
    return chunks;
};

const formattedRunsTextLength = (runs: RichFormattedBlock['runs']): number =>
    runs.reduce((length, run) => length + segmentText(run.text).length, 0);

type SyntaxTokenRange = {
    startOffset: number;
    endOffset: number;
    className: string | null;
};

const syntaxTokenRanges = (
    syntaxTokens: SyntaxToken[] | undefined,
    expectedLength: number,
): SyntaxTokenRange[] => {
    if (!syntaxTokens?.length) return [];
    const ranges: SyntaxTokenRange[] = [];
    let offset = 0;
    for (const token of syntaxTokens) {
        const length = segmentText(token.text).length;
        if (length) {
            ranges.push({
                startOffset: offset,
                endOffset: offset + length,
                className: token.className,
            });
        }
        offset += length;
    }
    return offset === expectedLength ? ranges : [];
};

const syntaxClassNameForRange = (
    ranges: SyntaxTokenRange[],
    startOffset: number,
    endOffset: number,
): string | null => {
    for (let index = ranges.length - 1; index >= 0; index--) {
        const range = ranges[index];
        if (startOffset >= range.startOffset && endOffset <= range.endOffset) return range.className;
    }
    return null;
};

const inlineCodeSyntaxRanges = (runs: RichFormattedBlock['runs']): SyntaxTokenRange[] => {
    const ranges: SyntaxTokenRange[] = [];
    let active:
        | {
              language: string;
              startOffset: number;
              text: string;
          }
        | null = null;
    let offset = 0;

    const flush = () => {
        if (!active) return;
        const current = active;
        ranges.push(...syntaxTokenRanges(highlightCode(current.text, current.language), segmentText(current.text).length).map((range) => ({
            ...range,
            startOffset: range.startOffset + current.startOffset,
            endOffset: range.endOffset + current.startOffset,
        })));
        active = null;
    };

    for (const run of runs) {
        const length = segmentText(run.text).length;
        const language = codeLanguageFromMarkValue(run.marks[CODE_MARK]);
        if (language) {
            if (!active || active.language !== language) {
                flush();
                active = {language, startOffset: offset, text: ''};
            }
            active.text += run.text;
        } else {
            flush();
        }
        offset += length;
    }
    flush();

    return ranges;
};

const renderEndingFootnoteReferences = (
    chunk: RunRenderChunk,
    nextChunk: RunRenderChunk | null,
    footnoteNumberById: Map<string, number> = new Map(),
): HTMLElement[] => {
    const currentIds = footnoteIdsForRun(chunk.run, footnoteNumberById);
    if (!currentIds.length) return [];
    const nextIds = nextChunk
        ? new Set(footnoteIdsForRun(nextChunk.run, footnoteNumberById))
        : new Set<string>();
    return currentIds
        .filter((id) => !nextIds.has(id))
        .sort((a, b) => (footnoteNumberById.get(a) ?? 0) - (footnoteNumberById.get(b) ?? 0))
        .map((id) => renderFootnoteReferenceNumber(footnoteNumberById.get(id) ?? 0));
};

const appendTrailingCodeNewlineSentinel = (
    nodes: Node[],
    options: {trailingCodeNewline?: boolean},
): Node[] => {
    if (!options.trailingCodeNewline) return nodes;

    const caretTarget = document.createElement('span');
    caretTarget.dataset.offsetSentinel = 'true';
    caretTarget.dataset.trailingCodeNewline = 'true';
    caretTarget.append(document.createTextNode('\u200b'));

    return [...nodes, caretTarget];
};

const addBoundaryInRun = (boundaries: Set<number>, boundary: number, runLength: number) => {
    if (boundary > 0 && boundary < runLength) boundaries.add(boundary);
};

const renderCaretsAtOffset = (
    nodes: Node[],
    decorations: BlockSelectionDecorations,
    renderedCarets: Set<string>,
    offset: number,
) => {
    for (const caret of decorations.carets.filter((caret) => caret.offset === offset)) {
        const key = `${caret.id}:${caret.offset}`;
        if (renderedCarets.has(key)) continue;
        renderedCarets.add(key);
        nodes.push(renderRetainedCaret(caret.id, caret.primary));
    }
};

const applyRunClasses = (
    span: HTMLElement,
    chunk: RunRenderChunk,
    popoverTextById?: Map<string, string>,
) => {
    const run = chunk.run;
    if (chunk.syntaxClassName) span.classList.add(chunk.syntaxClassName);
    if (run.marks.bold) span.classList.add('markBold');
    if (run.marks.italic) span.classList.add('markItalic');
    if (run.marks.strikethrough) span.classList.add('markStrikethrough');
    if (isCodeMarkValue(run.marks[CODE_MARK])) {
        span.classList.add('markCode');
        if (typeof run.marks[CODE_MARK] === 'string') span.classList.add('markCodeHighlighted');
        span.dataset.codeLanguage = typeof run.marks[CODE_MARK] === 'string' ? run.marks[CODE_MARK] : '';
        span.dataset.codeStartOffset = String(chunk.blockStartOffset);
        span.dataset.codeEndOffset = String(chunk.blockEndOffset);
    }
    if (typeof run.marks[LINK_MARK] === 'string') {
        span.classList.add('markLink');
        span.dataset.linkHref = run.marks[LINK_MARK];
        span.dataset.linkStartOffset = String(chunk.blockStartOffset);
        span.dataset.linkEndOffset = String(chunk.blockEndOffset);
    }
    if (hasAnnotationMark(run)) span.classList.add('markAnnotation');
    const sidebarIds = sidebarIdsForRun(run);
    if (sidebarIds.length) {
        span.dataset.sidebarAnnotationIds = sidebarIds.join(' ');
    }
    const popoverIds = popoverIdsForRun(run, popoverTextById);
    if (popoverIds.length) {
        span.classList.add('markPopover');
        span.dataset.popoverId = popoverIds[0];
        span.dataset.popoverIds = popoverIds.join(' ');
        span.setAttribute('aria-label', 'Popover');
    }
};

const hasAnnotationMark = (run: RichFormattedBlock['runs'][number]) =>
    annotationDataForRun(run).length > 0;

const annotationDataForRun = (run: RichFormattedBlock['runs'][number]): AnnotationMarkData[] => {
    return formattedMarkValues(run, ANNOTATION_MARK).filter(isActiveAnnotationMarkData);
};

const sidebarIdsForRun = (run: RichFormattedBlock['runs'][number]): string[] => {
    const result: string[] = [];
    for (const data of annotationDataForRun(run)) {
        if (data.presentation !== 'sidebar') continue;
        const id = lamportToString(data.id);
        if (!result.includes(id)) result.push(id);
    }
    return result;
};

const popoverIdsForRun = (
    run: RichFormattedBlock['runs'][number],
    popoverTextById?: Map<string, string>,
): string[] => {
    if (!popoverTextById) return [];
    const result: string[] = [];
    for (const data of annotationDataForRun(run)) {
        if (data.presentation !== 'popover') continue;
        const id = lamportToString(data.id);
        if (popoverTextById.has(id) && !result.includes(id)) result.push(id);
    }
    return result;
};

const footnoteIdsForRun = (
    run: RichFormattedBlock['runs'][number],
    footnoteNumberById: Map<string, number>,
): string[] => {
    const result: string[] = [];
    for (const data of annotationDataForRun(run)) {
        if (data.presentation !== 'footnote') continue;
        const id = lamportToString(data.id);
        if (footnoteNumberById.has(id) && !result.includes(id)) result.push(id);
    }
    return result;
};

const isAnnotationMarkData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AnnotationMarkData).id) &&
    ['sidebar', 'footnote', 'popover'].includes((value as AnnotationMarkData).presentation);

const isActiveAnnotationMarkData = (value: unknown): value is AnnotationMarkData =>
    isAnnotationMarkData(value) && !value.resolved;

const capitalize = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

const renderFootnoteReferenceNumber = (number: number) => {
    const sup = document.createElement('sup');
    sup.className = 'footnoteReferenceNumber';
    sup.dataset.offsetSentinel = 'true';
    sup.dataset.footnoteReference = 'true';
    sup.contentEditable = 'false';
    sup.textContent = String(number);
    return sup;
};

const renderRetainedCaret = (id: string, primary: boolean) => {
    const span = document.createElement('span');
    span.className = 'retainedSelectionCaret';
    span.dataset.retainedSelection = 'caret';
    span.dataset.selectionEntryId = id;
    span.dataset.selectionPrimary = String(primary);
    span.contentEditable = 'false';
    return span;
};
