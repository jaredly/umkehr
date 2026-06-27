import {
    useCallback,
    Fragment,
    useEffect,
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
    applyMany,
    blockContents,
    deleteBlockOps,
    deleteRangeOps,
    formattedMarkValues,
    isDeleted,
    materializeFormattedBlocks,
    materializedBlockParent,
    materializedBlockPath,
    orderedCharIdsForBlock,
    visibleBlockChildren,
    visibleRangesForMark,
} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import type {BlockStyle, CachedState, Op} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
import {
    addTableColumn,
    addTableRow,
    addSlide,
    advanceFromTableCellEnd,
    clearCodeLanguage,
    closeRetainedInlineMarkSessions,
    commandApplied,
    convertBlockToColumns,
    convertBlockToSlide,
    convertBlockToSlideDeck,
    convertBlockToTable,
    createMissingTableCell,
    deleteEmptyTableRowBackward,
    deleteTableRowHeaderBackward,
    deleteTableCellSelection,
    exitEmptyLastTableRow,
    insertInlineEmbed,
    insertPreviewBlock,
    insertTextWithMarkdownShortcuts,
    insertTextWithRetainedMarks,
    moveBlock,
    moveBlockToTableCellSlot,
    moveCellRectangleOutToNewTable,
    moveTableSelectionByArrow,
    removeCodeMark,
    moveTableCell,
    moveTableCellRectangleContents,
    moveTableCellByTab,
    moveTableCellsOutAsBlocks,
    moveTableCellsToNewRow,
    setCodeMark,
    setInlineEmbedDataByCharId,
    setBlockMeta,
    setPreviewBlockData,
    updateBlockStyle,
    slideChildren,
    slideDeckForSlide,
    splitTableTitleToParagraph,
    type CommandResult,
    type MoveTarget,
    type RetainedInlineMarkSession,
    type TableCellSlotTarget,
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
import {
    codeMetaWithPreviewForLanguage,
    codePreviewKindForLanguage,
    isPreviewableCodeMeta,
    normalizeSlideDeckSize,
    paragraphMeta,
    richBlockStyleValue,
    type PollChoiceMode,
    type PollDisplayMode,
    type PollMeta,
    type PollRatingPresentation,
    type PollVote,
    type ColumnsDisplayMode,
    type ImagePresentationSize,
    type PreviewMetadata,
    type RichBlockStyleAttribute,
    type RichBlockStyleSize,
    type RichBlockMeta,
    type SlideDeckFooterMode,
    type SlideTransition,
} from './blockMeta';
import {
    closestCaretOffsetForHorizontalIntent,
    caretRectForBlockOffset,
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
    isBlockLevelSelection,
    isCollapsed,
    normalizeSelectionSegments,
    pointTextLength,
    selectedBlockIdsForSelection,
    segmentText,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
    visibleBlockIds,
    visibleSubtreeBlockIds,
    type EditorSelection,
} from './selectionModel';
import {constrainSelectionToFullscreenSlide} from './slidePresentationSelection';
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
    insertImageBlockEverywhere,
    removeLinkMarkEverywhere,
    setLinkMarkEverywhere,
    setBlockTypeEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
    toggleDisplayMathMarkEverywhere,
    toggleMathMarkEverywhere,
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
    blockIdFromBlockLinkHref,
    blockDomIdForBlockId,
    blockLinkHrefForClipboardPayload,
    htmlWithClipboardPayload,
    parseBlockRichTextClipboardHtml,
    parseBlockRichTextClipboardPayload,
    serializeSelectionToClipboardPayload,
    type RichClipboardPayload,
} from './clipboard';
import {useBlockReorder, type DropTarget} from './useBlockReorder';
import {
    appendSelection,
    blockLevelDecorationsForSelectionSet,
    dedupeSelectionSet,
    decorationsForSelectionSet,
    mergeOverlappingRanges,
    primarySelection,
    replacePrimarySelection,
    replaceSelectionSet,
    resolveSelectionSet,
    reverseSortedRetainedEntries,
    retainSelectionSet,
    selectedTopLevelBlockIdsForSelectionSet,
    singleRetainedSelectionSet,
    type BlockLevelSelectionDecorations,
    type BlockSelectionDecorations,
    type EditorSelectionSet,
    type RetainedSelectionEntry,
    type RetainedSelectionSet,
} from './selectionSet';
import {resolveSelection, retainSelection} from './retainedSelection';
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
    MATH_MARK,
    codeLanguageFromMarkValue,
    codeLanguageForSelectionSegments,
    codeRangeAroundOffsetInRuns,
    isCodeMarkValue,
    mathModeForRun,
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
import {BrowserMathJaxRenderer, type MathRenderer} from './mathRendering';
import {highlightIngredientLine, type IngredientHighlightToken} from './ingredientHighlight';
import {highlightCode, type SyntaxToken} from './syntaxHighlight';
import {
    createAttachmentFromFile,
    deserializeAttachments,
    revokeAttachments,
    serializeAttachments,
    type AttachmentStore,
    type ImageAttachment,
    type SerializedImageAttachment,
} from './attachments';
import {documentFixtures, fixtureById} from './documentFixtures';
import {
    KEY_PERF_SAMPLE_LIMIT,
    KeyPerfMonitor,
    type KeyPerfSample,
    type KeyPerfSampleInput,
} from './KeyPerfMonitor';
import type {
    BlockTypeMenuValue,
    CodeHoverPopoverState,
    CodePopoverState,
    EmbedPopoverState,
    LinkHoverPopoverState,
    LinkPopoverState,
    PendingInlineMarks,
} from './blockEditorTypes';
import {Toolbar} from './Toolbar';
import {
    CodeFloatingPopover,
    CodeHoverPopover,
    DateEmbedFloatingPopover,
    LinkFloatingPopover,
    LinkHoverPopover,
} from './floatingPopovers';
import {deriveActiveInlineMarks} from './inlineRunRendering';
import {
    blockDropTargetFromPoint,
    orderDraggedBlockIds,
    orderDraggedBlockIdsForCellSlot,
} from './blockDropTargets';
import {
    activePollVotes,
    choiceResults,
    currentUserVote,
    matrixPollResults,
    normalizeUserId,
    pollMetaWithChoiceMode,
    ratingOptionIds,
    singleChoiceResults,
    votedOptionIds,
    type PollResult,
    type PollVoteCommandData,
} from './pollBlocks';
import {
    beforeInputLabel,
    editorSelectionKey,
    imageFilesFromDataTransfer,
    isImageFile,
    isJsdom,
    isPlainArrowKey,
    isSameClick,
    keyboardEventLabel,
    measureInput,
    measureTextInput,
    numberRecordEquals,
    removePrimaryDecorations,
    sameSelectionRange,
    stopEditorControlEvent,
} from './editorUiUtils';
import {ImagePreview, PreviewableCodeBlock, PreviewBlockCard} from './mediaBlocks';
import {blockTypeMenuValue, blockTypeMeta, deriveOrderedListNumbers} from './blockTypeHelpers';
import {
    actionsSharePrefix,
    deriveToolbarUndoState,
    formatKeystroke,
    overlayTransientSelections,
} from './editorAppUtils';
import {
    canOpenSlashMenuForSelection,
    deleteSlashTriggers,
    SlashCommandPopover,
    slashTriggersFromInsertResult,
    type SlashCommand,
    type SlashMenuState,
} from './slashCommands';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;
type RenderedAnnotation = ReturnType<typeof renderedAnnotations>[number];
type CommentFocusRequest = {blockId: string; token: number; selection?: EditorSelection};
type PollOptionView = {id: string; label: string; archived?: boolean};
type MatrixPollView = {rows: PollOptionView[]; columns: PollOptionView[]};
type PollEditorMode = 'view' | 'edit';
type SubmitCommandOptions = {constrainFullscreenSlideSelection?: boolean};

const BOOLEAN_INLINE_MARKS: BooleanInlineMark[] = ['bold', 'italic', 'strikethrough'];
const BARE_INLINE_MARKS: BareInlineMark[] = [...BOOLEAN_INLINE_MARKS, CODE_MARK];
const DEFAULT_DATE_EMBED_DATA = {type: 'date', value: '2026-06-23'} as const;

const activePendingInlineMarks = (marks: PendingInlineMarks): BareInlineMark[] =>
    BARE_INLINE_MARKS.filter((mark) => marks[mark]);

const hasPendingInlineMarks = (marks: PendingInlineMarks): boolean =>
    activePendingInlineMarks(marks).length > 0;

const hasRetainedInlineMarkSessions = (marks: RetainedInlineMarkSessionMap): boolean =>
    Object.values(marks).some((sessions) => sessions.length > 0);

export function EditorApp() {
    const [history, setHistory] = useState<HistoryState>(() => initialHistoryState());
    const [attachments, setAttachments] = useState<AttachmentStore>(() => new Map());
    const [keyPerfSamples, setKeyPerfSamples] = useState<KeyPerfSample[]>([]);
    const [transientSelections, setTransientSelections] = useState<
        Partial<Record<EditorId, RetainedSelectionSet>>
    >({});
    const [historyStatus, setHistoryStatus] = useState('');
    const [undoStatus, setUndoStatus] = useState<Partial<Record<EditorId, string>>>({});
    const [historyResetSignal, setHistoryResetSignal] = useState(0);
    const [rainbowLamportIds, setRainbowLamportIds] = useState(false);
    const [userIds, setUserIds] = useState<Record<EditorId, string>>({
        left: 'ulrich',
        right: 'uwe',
    });
    const importInputRef = useRef<HTMLInputElement>(null);
    const attachmentsRef = useRef(attachments);
    const nextKeyPerfSampleIdRef = useRef(1);
    const replayCacheRef = useRef<{
        actions: HistoryAction[];
        cursor: number;
        demo: DemoState;
    } | null>(null);

    useLayoutEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useLayoutEffect(
        () => () => {
            revokeAttachments(attachmentsRef.current);
        },
        [],
    );
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

    const createImageAttachment = useCallback(async (file: File): Promise<ImageAttachment> => {
        const attachment = await createAttachmentFromFile(file);
        setAttachments((current) => {
            const next = new Map(current);
            next.set(attachment.id, attachment);
            return next;
        });
        return attachment;
    }, []);

    const mergeSerializedAttachments = useCallback((serialized: SerializedImageAttachment[]) => {
        const pastedAttachments = deserializeAttachments(serialized);
        setAttachments((current) => {
            const next = new Map(current);
            for (const [id, attachment] of pastedAttachments) next.set(id, attachment);
            return next;
        });
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
                        ...(result.commandLabel ? {label: result.commandLabel} : {}),
                        ...(result.pollVote ? {pollVote: result.pollVote} : {}),
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

    const recordKeyPerfSample = useCallback((sample: KeyPerfSampleInput) => {
        const ms = Number.isFinite(sample.ms) ? Math.max(0, sample.ms) : 0;
        const nextSample: KeyPerfSample = {
            ...sample,
            ms,
            id: nextKeyPerfSampleIdRef.current++,
        };
        setKeyPerfSamples((current) =>
            [...current, nextSample].slice(-KEY_PERF_SAMPLE_LIMIT),
        );
    }, []);

    const exportHistory = useCallback(() => {
        const blob = new Blob([serializeHistory(history, serializeAttachments(attachments))], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'block-rich-text-history.json';
        link.click();
        URL.revokeObjectURL(url);
        setHistoryStatus(`Exported ${history.actions.length} actions.`);
    }, [attachments, history]);

    const importHistoryFile = useCallback(
        async (file: File) => {
            if (history.actions.length && !window.confirm('Replace the current history?')) return;
            const text = await file.text();
            const parsed = parseHistoryExport(text);
            if ('error' in parsed) {
                setHistoryStatus(parsed.error);
                return;
            }
            const nextAttachments = deserializeAttachments(parsed.attachments);
            revokeAttachments(attachmentsRef.current);
            setAttachments(nextAttachments);
            setHistory(parsed.history);
            clearReplayUiState();
            setHistoryStatus(
                `Imported ${parsed.history.actions.length} actions and ${parsed.attachments.length} attachments.`,
            );
            setUndoStatus({});
        },
        [clearReplayUiState, history.actions.length],
    );

    const resetHistory = useCallback(() => {
        if (history.actions.length && !window.confirm('Reset the current history?')) return;
        revokeAttachments(attachmentsRef.current);
        setAttachments(new Map());
        setHistory(resetHistoryState());
        clearReplayUiState();
        setHistoryStatus('');
        setUndoStatus({});
    }, [clearReplayUiState, history.actions.length]);

    const replaceDocumentFromFixture = useCallback(
        async (fixtureId: string) => {
            const fixture = fixtureById(fixtureId);
            if (!fixture) return;
            if (history.actions.length && !window.confirm('Replace the current document and reset history?')) return;

            const nextAttachments = fixture.attachments ? await fixture.attachments() : new Map();
            revokeAttachments(attachmentsRef.current);
            setAttachments(nextAttachments);
            setHistory({
                actions: [
                    {
                        type: 'replace-document',
                        document: fixture.document(),
                        fixtureId: fixture.id,
                    },
                ],
                cursor: 1,
                keystrokes: [],
            });
            clearReplayUiState();
            setHistoryStatus(`Loaded fixture: ${fixture.label}.`);
            setUndoStatus({});
        },
        [clearReplayUiState, history.actions.length],
    );

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
            <KeyPerfMonitor
                samples={keyPerfSamples}
                rainbowLamportIds={rainbowLamportIds}
                onRainbowLamportIdsChange={setRainbowLamportIds}
            />
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
                <select
                    aria-label="Replace document from fixture"
                    value=""
                    onChange={(event) => {
                        const fixtureId = event.currentTarget.value;
                        event.currentTarget.value = '';
                        if (fixtureId) void replaceDocumentFromFixture(fixtureId);
                    }}
                >
                    <option value="">Replace document...</option>
                    {documentFixtures.map((fixture) => (
                        <option key={fixture.id} value={fixture.id}>
                            {fixture.label}
                        </option>
                    ))}
                </select>
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
                    attachments={attachments}
                    resetSignal={historyResetSignal}
                    undoState={undoStates.left}
                    undoStatus={undoStatus.left ?? ''}
                    rainbowLamportIds={rainbowLamportIds}
                    userId={userIds.left}
                    onUserIdChange={(value) =>
                        setUserIds((current) => ({...current, left: normalizeUserId(value)}))
                    }
                    onCommand={(command) => runCommand('left', command)}
                    onUndo={() => runUndoCommand('left', 'undo')}
                    onRedo={() => runUndoCommand('left', 'redo')}
                    onToggleOnline={() => toggleEditorOnline('left')}
                    onCreateImageAttachment={createImageAttachment}
                    onMergeSerializedAttachments={mergeSerializedAttachments}
                    onKeystroke={(blockId, event) => recordKeystroke('left', blockId, event)}
                    onKeyPerfSample={(sample) =>
                        recordKeyPerfSample({...sample, editorId: 'left'})
                    }
                />
                <BlockEditor
                    replica={displayDemo.right}
                    attachments={attachments}
                    resetSignal={historyResetSignal}
                    undoState={undoStates.right}
                    undoStatus={undoStatus.right ?? ''}
                    rainbowLamportIds={rainbowLamportIds}
                    userId={userIds.right}
                    onUserIdChange={(value) =>
                        setUserIds((current) => ({...current, right: normalizeUserId(value)}))
                    }
                    onCommand={(command) => runCommand('right', command)}
                    onUndo={() => runUndoCommand('right', 'undo')}
                    onRedo={() => runUndoCommand('right', 'redo')}
                    onToggleOnline={() => toggleEditorOnline('right')}
                    onCreateImageAttachment={createImageAttachment}
                    onMergeSerializedAttachments={mergeSerializedAttachments}
                    onKeystroke={(blockId, event) => recordKeystroke('right', blockId, event)}
                    onKeyPerfSample={(sample) =>
                        recordKeyPerfSample({...sample, editorId: 'right'})
                    }
                />
            </section>
        </main>
    );
}

function BlockEditor({
    replica,
    attachments,
    resetSignal,
    undoState,
    undoStatus,
    rainbowLamportIds,
    userId,
    onUserIdChange,
    onCommand,
    onUndo,
    onRedo,
    onToggleOnline,
    onCreateImageAttachment,
    onMergeSerializedAttachments,
    onKeystroke,
    onKeyPerfSample,
}: {
    replica: Replica;
    attachments: AttachmentStore;
    resetSignal: number;
    undoState: ReturnType<typeof deriveUndoState>;
    undoStatus: string;
    rainbowLamportIds: boolean;
    userId: string;
    onUserIdChange(value: string): void;
    onCommand(command: (replica: Replica) => MultiCommandResult): void;
    onUndo(): void;
    onRedo(): void;
    onToggleOnline(): void;
    onCreateImageAttachment(file: File): Promise<ImageAttachment>;
    onMergeSerializedAttachments(attachments: SerializedImageAttachment[]): void;
    onKeystroke(blockId: string, event: KeyboardEvent<HTMLElement>): void;
    onKeyPerfSample(sample: Omit<KeyPerfSampleInput, 'editorId'>): void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const editorContentRef = useRef<HTMLDivElement>(null);
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const pendingBlockSelectionFocusRef = useRef<EditorSelection | null>(null);
    const verticalCaretXRef = useRef<number | null>(null);
    const nextSelectionIdRef = useRef(1);
    const nextCommentFocusTokenRef = useRef(1);
    const handledTripleClickRef = useRef(false);
    const handledNavigationKeyRef = useRef(false);
    const suppressNextBlockFocusSelectionRef = useRef(false);
    const suppressNextBlockKeySelectionRef = useRef(false);
    const pendingMultiselectClickRef = useRef<{
        point: {blockId: string; offset: number};
        x: number;
        y: number;
    } | null>(null);
    const pendingTextDragRef = useRef<{
        pointerId: number;
        anchor: {blockId: string; offset: number};
        startX: number;
        startY: number;
        dragging: boolean;
    } | null>(null);
    const suppressNextMouseSelectionRef = useRef(false);
    const pendingAddSelectionClickRef = useRef<{
        point: {blockId: string; offset: number};
        x: number;
        y: number;
    } | null>(null);
    const pendingDisplayInputRenderRef = useRef<{label: string; started: number} | null>(null);
    const pendingDomSelectionRef = useRef<{started: number} | null>(null);
    const pendingDomSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingImageUploadSelectionRef = useRef<RetainedSelectionSet | null>(null);
    const linkHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const codeHoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hasFocus, setHasFocus] = useState(false);
    const [isExtendingSelection, setIsExtendingSelection] = useState(false);
    const [dragSelection, setDragSelection] = useState<EditorSelection | null>(null);
    const [hasTextDragGesture, setHasTextDragGesture] = useState(false);
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
    const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
    const [pollModesByBlockId, setPollModesByBlockId] = useState<
        Record<string, PollEditorMode>
    >({});
    const [slideDeckUiByBlockId, setSlideDeckUiByBlockId] = useState<Record<string, SlideDeckUiState>>({});
    const [orphanSlideModesByBlockId, setOrphanSlideModesByBlockId] = useState<
        Record<string, OrphanSlideDisplayMode>
    >({});
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
    const visibleBlockIdSet = useMemo(
        () => new Set(blocksWithAnnotationBodies.map((block) => block.id)),
        [blocksWithAnnotationBodies],
    );
    const orderedListNumbers = useMemo(() => deriveOrderedListNumbers(blocks), [blocks]);
    const retainedResolvedSelectionSet = resolveSelectionSet(replica.state, replica.selection);
    const resolvedSelectionSet: EditorSelectionSet = dragSelection
        ? {
              primaryId: retainedResolvedSelectionSet.primaryId,
              entries: retainedResolvedSelectionSet.entries.length
                  ? retainedResolvedSelectionSet.entries.map((entry) =>
                        entry.id === retainedResolvedSelectionSet.primaryId
                            ? {...entry, selection: dragSelection}
                            : entry,
                    )
                  : [{id: retainedResolvedSelectionSet.primaryId, selection: dragSelection}],
          }
        : retainedResolvedSelectionSet;
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
                includePrimary: !hasFocus || isExtendingSelection || dragSelection !== null,
                includePrimaryBoundaryCaret: true,
            }),
        [dragSelection, hasFocus, isExtendingSelection, replica.state, resolvedSelectionSet],
    );
    const blockLevelDecorationsByBlock = useMemo(
        () => blockLevelDecorationsForSelectionSet(replica.state, resolvedSelectionSet),
        [replica.state, resolvedSelectionSet],
    );
    const [cellDragBlockDropTarget, setCellDragBlockDropTarget] = useState<DropTarget | null>(null);

    const focusBlockSelectionTarget = useCallback((editorSelection?: EditorSelection | null) => {
        const domSelection = window.getSelection();
        if (domSelection) domSelection.removeAllRanges();
        pendingBlockSelectionFocusRef.current = editorSelection ?? null;
        const focusBlockId = editorSelection ? focusPoint(editorSelection).blockId : null;
        const target =
            editorSelection?.type === 'table-cells'
                ? rootRef.current?.querySelector<HTMLElement>(
                      `.tableCell[data-cell-id="${CSS.escape(focusBlockId ?? '')}"]`,
                  )
                : focusBlockId
                  ? rootRef.current?.querySelector<HTMLElement>(
                        `.slideViewport[data-slide-id="${CSS.escape(focusBlockId)}"], [data-block-id="${CSS.escape(focusBlockId)}"]`,
                    )
                  : null;
        suppressNextBlockFocusSelectionRef.current = true;
        suppressNextBlockKeySelectionRef.current = true;
        const focusTarget = target ?? rootRef.current;
        focusTarget?.focus({preventScroll: true});
        window.getSelection()?.removeAllRanges();
        if (target && !target.matches('.slideViewport:not(.slideViewport-presentation)')) {
            pendingBlockSelectionFocusRef.current = null;
        }
    }, []);

    const submitCommand = useCallback(
        (command: (replica: Replica) => MultiCommandResult, options: SubmitCommandOptions = {}) => {
            onCommand((current) => {
                const result = command(current);
                if (options.constrainFullscreenSlideSelection === false) return result;
                const constrained = constrainSelectionToFullscreenSlide(
                    result.state,
                    result.selection,
                    slideDeckUiByBlockId,
                );
                if (!constrained.fallbackSelection) return result;
                focusBlockSelectionTarget(constrained.fallbackSelection);
                return {...result, selection: constrained.selection};
            });
        },
        [focusBlockSelectionTarget, onCommand, slideDeckUiByBlockId],
    );

    const {draggingId, draggingSubtreeIds, dropTarget, registerRow, startDrag} = useBlockReorder({
        blocks: blocks.map(({id, depth, parentId}) => ({id, depth, parentId})),
        onMove: (blockIds, target) =>
            submitCommand((current) => {
                let working = current.state;
                const ops: Array<Op<RichBlockMeta>> = [];
                if (target.type === 'table-cell-slot') {
                    const orderedBlockIds = orderDraggedBlockIdsForCellSlot(current.state, blockIds);
                    for (const blockId of orderedBlockIds) {
                        const result = moveBlockToTableCellSlot(
                            working,
                            blockId,
                            target.target,
                            makeCommandContext(current),
                        );
                        working = result.state;
                        ops.push(...result.ops);
                    }
                    return {state: working, ops, selection: current.selection};
                }
                const orderedBlockIds = orderDraggedBlockIds(current.state, blockIds, target);
                for (const blockId of orderedBlockIds) {
                    const result = moveBlock(
                        working,
                        blockId,
                        target,
                        makeCommandContext(current),
                    );
                    working = result.state;
                    ops.push(...result.ops);
                }
                return {state: working, ops, selection: current.selection};
            }),
    });

    const scheduleSelectionRestore = useCallback((selection: EditorSelection) => {
        if (selection.type === 'caret') {
            pendingCaretRestoreBlockIdRef.current = selection.point.blockId;
            pendingSelectionRestoreRef.current = null;
            return;
        }
        if (selection.type !== 'range') {
            pendingCaretRestoreBlockIdRef.current = null;
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

    const onInputMeasured = useCallback(
        (label: string, ms: number) => onKeyPerfSample({label, ms}),
        [onKeyPerfSample],
    );

    const onDisplayInputRenderStarted = useCallback((label: string, started: number) => {
        pendingDisplayInputRenderRef.current = {label, started};
    }, []);

    useLayoutEffect(() => {
        const pending = pendingDisplayInputRenderRef.current;
        if (!pending) return;
        pendingDisplayInputRenderRef.current = null;
        onKeyPerfSample({
            label: `Render ${pending.label}`,
            ms: performance.now() - pending.started,
        });
    });

    useLayoutEffect(() => {
        const onSelectionChange = () => {
            const pending = pendingDomSelectionRef.current;
            const root = rootRef.current;
            if (!pending || !root || !readSelectionFromDom(root)) return;
            pendingDomSelectionRef.current = null;
            if (pendingDomSelectionTimerRef.current) {
                clearTimeout(pendingDomSelectionTimerRef.current);
                pendingDomSelectionTimerRef.current = null;
            }
            onKeyPerfSample({
                label: 'DOM selection',
                ms: performance.now() - pending.started,
            });
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [onKeyPerfSample]);

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
        pendingTextDragRef.current = null;
        suppressNextMouseSelectionRef.current = false;
        pendingDomSelectionRef.current = null;
        if (pendingDomSelectionTimerRef.current) clearTimeout(pendingDomSelectionTimerRef.current);
        pendingDomSelectionTimerRef.current = null;
        handledTripleClickRef.current = false;
        handledNavigationKeyRef.current = false;
        setIsExtendingSelection(false);
        setDragSelection(null);
        setHasTextDragGesture(false);
        setLinkPopover(null);
        setLinkHoverPopover(null);
        setCodePopover(null);
        setCodeHoverPopover(null);
        setEmbedPopover(null);
        setSlashMenu(null);
        setPollModesByBlockId({});
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
            if (pendingDomSelectionTimerRef.current) {
                clearTimeout(pendingDomSelectionTimerRef.current);
            }
        },
        [],
    );

    useLayoutEffect(() => {
        if (!slashMenu) return;
        const nextPosition = slashPopoverPositionFromTrigger(rootRef.current, slashMenu);
        if (!nextPosition) return;
        if (
            Math.abs(nextPosition.top - slashMenu.top) < 0.5 &&
            Math.abs(nextPosition.left - slashMenu.left) < 0.5
        ) {
            return;
        }
        setSlashMenu((current) => (current ? {...current, ...nextPosition} : current));
    }, [replica.state, slashMenu]);

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
            if (event.type === 'mouseup' && suppressNextMouseSelectionRef.current) {
                suppressNextMouseSelectionRef.current = false;
                return;
            }
            if (event.type === 'mouseup' && pendingMultiselectClickRef.current) {
                const pendingClick = pendingMultiselectClickRef.current;
                pendingMultiselectClickRef.current = null;
                if (isSameClick(pendingClick, event)) {
                    const selection = caret(pendingClick.point.blockId, pendingClick.point.offset);
                    scheduleSelectionRestore(selection);
                    submitCommand((current) => ({
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
                    submitCommand((current) => ({
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
                submitCommand((current) => ({
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
            if (
                event.type === 'mouseup' &&
                !addSelection &&
                resolvedSelectionSet.entries.length === 1 &&
                editorSelectionKey(selection) === editorSelectionKey(primaryResolvedSelection)
            ) {
                return;
            }
            scheduleSelectionRestore(selection);
            submitCommand((current) => ({
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
            submitCommand,
            primaryResolvedSelection,
            resetVerticalCaretIntent,
            resolvedSelectionSet.entries.length,
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
            if (
                elementConstructor &&
                event.target instanceof elementConstructor &&
                !event.target.closest('.slashCommandPopover')
            ) {
                setSlashMenu(null);
            }
            setIsExtendingSelection(
                event.detail <= 1 && !event.shiftKey && (event.metaKey || event.ctrlKey),
            );
            const root = rootRef.current;
            if (!root) return;
            const point = readPointFromMouseEvent(root, event.nativeEvent);
            if (!point) return;
            if (pendingDomSelectionTimerRef.current) {
                clearTimeout(pendingDomSelectionTimerRef.current);
            }
            pendingDomSelectionRef.current = {started: performance.now()};
            pendingDomSelectionTimerRef.current = setTimeout(() => {
                pendingDomSelectionRef.current = null;
                pendingDomSelectionTimerRef.current = null;
            }, 1000);

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
            submitCommand((current) => {
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
            submitCommand,
            resetVerticalCaretIntent,
            resolvedSelectionSet.entries.length,
            scheduleSelectionRestore,
        ],
    );

    const startTextDragSelection = useCallback((event: PointerEvent<HTMLElement>) => {
        if (!event.isPrimary || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        const root = rootRef.current;
        if (!root) return;
        const elementConstructor = event.currentTarget.ownerDocument.defaultView?.Element;
        if (!elementConstructor || !(event.target instanceof elementConstructor)) return;
        if (
            event.target.closest(
                'button,input,select,textarea,[data-popover-id],[contenteditable="false"],.blockAffordance,.tableRowDrag,.tableColumnInsert,.tableRowInsertControl',
            )
        ) {
            return;
        }
        const editable = event.target.closest('[data-block-id]');
        if (!editable || !root.contains(editable)) return;
        const point = readPointFromMouseEvent(root, event.nativeEvent);
        if (!point) return;
        pendingTextDragRef.current = {
            pointerId: event.pointerId,
            anchor: point,
            startX: event.clientX,
            startY: event.clientY,
            dragging: false,
        };
        setHasTextDragGesture(true);
    }, []);

    useLayoutEffect(() => {
        if (!hasTextDragGesture) return;
        const pending = pendingTextDragRef.current;
        if (!pending) {
            setHasTextDragGesture(false);
            return;
        }

        const onPointerMove = (event: globalThis.PointerEvent) => {
            const current = pendingTextDragRef.current;
            const root = rootRef.current;
            if (!current || !root || event.pointerId !== current.pointerId) return;
            const deltaX = event.clientX - current.startX;
            const deltaY = event.clientY - current.startY;
            if (!current.dragging && Math.hypot(deltaX, deltaY) < 4) return;
            const focus = readPointFromMouseEvent(root, event);
            if (!focus) return;
            event.preventDefault();
            window.getSelection()?.removeAllRanges();
            current.dragging = true;
            const selection: EditorSelection =
                current.anchor.blockId === focus.blockId && current.anchor.offset === focus.offset
                    ? caret(focus.blockId, focus.offset)
                    : {type: 'range', anchor: current.anchor, focus};
            setDragSelection(selection);
        };

        const onPointerUp = (event: globalThis.PointerEvent) => {
            const current = pendingTextDragRef.current;
            const root = rootRef.current;
            if (!current || !root || event.pointerId !== current.pointerId) return;
            pendingTextDragRef.current = null;
            setHasTextDragGesture(false);
            const focus = readPointFromMouseEvent(root, event);
            const committed =
                current.dragging && focus
                    ? current.anchor.blockId === focus.blockId && current.anchor.offset === focus.offset
                        ? caret(focus.blockId, focus.offset)
                        : ({type: 'range', anchor: current.anchor, focus} satisfies EditorSelection)
                    : null;
            setDragSelection(null);
            if (!committed) return;
            event.preventDefault();
            suppressNextMouseSelectionRef.current = true;
            scheduleSelectionRestore(committed);
            submitCommand((currentReplica) => ({
                state: currentReplica.state,
                ops: [],
                selection: replaceSelectionSet(
                    currentReplica.state,
                    committed,
                    currentReplica.selection.primaryId,
                ),
            }));
        };

        const onPointerCancel = (event: globalThis.PointerEvent) => {
            const current = pendingTextDragRef.current;
            if (!current || event.pointerId !== current.pointerId) return;
            pendingTextDragRef.current = null;
            setHasTextDragGesture(false);
            setDragSelection(null);
        };

        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [hasTextDragGesture, scheduleSelectionRestore, submitCommand]);

    const liveSelectionSet = useCallback((current: Replica): RetainedSelectionSet => {
        const root = rootRef.current;
        const selection = root ? readSelectionFromDom(root) : null;
        return selection
            ? replacePrimarySelection(current.state, current.selection, selection)
            : current.selection;
    }, []);

    const runEditCommand = useCallback(
        (command: (current: Replica, selection: RetainedSelectionSet) => MultiCommandResult) => {
            submitCommand((current) => {
                resetVerticalCaretIntent();
                const retainedSelection = current.selection;
                const currentPrimary = primarySelection(
                    resolveSelectionSet(current.state, retainedSelection),
                );
                const selection = isBlockLevelSelection(currentPrimary)
                    ? retainedSelection
                    : liveSelectionSet(current);
                const result = command(current, selection);
                const primaryResultSelection = primarySelection(
                    resolveSelectionSet(result.state, result.selection),
                );
                scheduleSelectionRestore(primaryResultSelection);
                return result;
            });
        },
        [liveSelectionSet, resetVerticalCaretIntent, scheduleSelectionRestore, submitCommand],
    );

    const currentClipboardPayload = useCallback((): RichClipboardPayload | null => {
            const currentPrimary = primarySelection(resolvedSelectionSet);
            const selection = isBlockLevelSelection(currentPrimary)
                ? retainSelectionSet(replica.state, resolvedSelectionSet)
                : liveSelectionSet(replica);
            return serializeSelectionToClipboardPayload(
                replica.state,
                selection,
                serializeAttachments(attachments),
            );
        },
        [attachments, liveSelectionSet, replica, resolvedSelectionSet],
    );

    const writeCurrentSelectionToClipboard = useCallback(async () => {
        const payload = currentClipboardPayload();
        if (!payload) return;
        await writeClipboardPayload(payload);
    }, [currentClipboardPayload]);

    const writeClipboardEventPayload = useCallback(
        (event: ClipboardEvent<HTMLElement>, payload: RichClipboardPayload): void => {
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.tsv ?? payload.plainText);
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
            if (payload.tsv) {
                event.clipboardData.setData('text/tab-separated-values', payload.tsv);
            }
        },
        [],
    );

    const copyRichSelection = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const payload = currentClipboardPayload();
            if (!payload) return;
            writeClipboardEventPayload(event, payload);
        },
        [currentClipboardPayload, writeClipboardEventPayload],
    );

    const captureImageUploadSelection = useCallback(() => {
        pendingImageUploadSelectionRef.current = liveSelectionSet(replica);
    }, [liveSelectionSet, replica]);

    const insertImageFiles = useCallback(
        async (files: File[], selectionSnapshot?: RetainedSelectionSet | null) => {
            const file = files.find(isImageFile);
            if (!file) return;
            const retainedSelection =
                selectionSnapshot ?? pendingImageUploadSelectionRef.current ?? liveSelectionSet(replica);
            pendingImageUploadSelectionRef.current = null;
            const attachment = await onCreateImageAttachment(file);
            submitCommand((current) => {
                resetVerticalCaretIntent();
                const result = insertImageBlockEverywhere(
                    current.state,
                    retainedSelection,
                    attachment.id,
                    'medium',
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
            liveSelectionSet,
            submitCommand,
            onCreateImageAttachment,
            replica,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const pasteRichPayload = useCallback(
        (rich: RichClipboardPayload) => {
            if (rich.attachments?.length) {
                onMergeSerializedAttachments(rich.attachments);
            }
            submitCommand((current) => {
                resetVerticalCaretIntent();
                const retainedSelection = current.selection;
                const currentPrimary = primarySelection(
                    resolveSelectionSet(current.state, retainedSelection),
                );
                const selection = isBlockLevelSelection(currentPrimary)
                    ? retainedSelection
                    : liveSelectionSet(current);
                const pastePrimary = primarySelection(resolveSelectionSet(current.state, selection));
                const isBlockLinkPaste =
                    pastePrimary.type === 'range' &&
                    !isCollapsed(pastePrimary) &&
                    (rich.sourceSelectionType === 'block' || rich.sourceSelectionType === 'table-cells');
                if (isBlockLinkPaste) {
                    const blockLinkHref = blockLinkHrefForClipboardPayload(current.state, rich);
                    const result = blockLinkHref
                        ? setLinkMarkEverywhere(
                              current.state,
                              selection,
                              blockLinkHref,
                              makeCommandContext(current),
                          )
                        : {state: current.state, ops: [], selection};
                    const primaryResultSelection = primarySelection(
                        resolveSelectionSet(result.state, result.selection),
                    );
                    scheduleSelectionRestore(primaryResultSelection);
                    return result;
                }
                const result = pasteRichClipboardEverywhere(
                    current.state,
                    selection,
                    rich,
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
            liveSelectionSet,
            submitCommand,
            onMergeSerializedAttachments,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const pastePlainClipboardText = useCallback(
        (text: string) => {
            runEditCommand((current, selection) => {
                const primary = primarySelection(resolveSelectionSet(current.state, selection));
                const primaryFocus = focusPoint(primary);
                const pasteSelection = isBlockLevelSelection(primary)
                    ? replacePrimarySelection(
                          current.state,
                          selection,
                          caret(
                              primaryFocus.blockId,
                              pointTextLength(current.state, primaryFocus.blockId),
                          ),
                      )
                    : selection;
                const pastePrimary = primarySelection(resolveSelectionSet(current.state, pasteSelection));
                if (isLinkLikeText(text) && pastePrimary.type === 'range') {
                    return setLinkMarkEverywhere(
                        current.state,
                        pasteSelection,
                        text.trim(),
                        makeCommandContext(current),
                    );
                }
                return pastePlainTextWithMarkdownShortcutsEverywhere(
                    current.state,
                    pasteSelection,
                    text,
                    makeCommandContext(current),
                );
            });
        },
        [
            runEditCommand,
        ],
    );

    const pasteFromClipboard = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const imageFiles = imageFilesFromDataTransfer(event.clipboardData);
            if (imageFiles.length) {
                event.preventDefault();
                void insertImageFiles(imageFiles, liveSelectionSet(replica));
                return;
            }

            const rich = richClipboardPayloadFromDataTransfer(event.clipboardData);
            if (rich) {
                event.preventDefault();
                pasteRichPayload(rich);
                return;
            }

            event.preventDefault();
            pastePlainClipboardText(event.clipboardData.getData('text/plain'));
        },
        [
            insertImageFiles,
            liveSelectionSet,
            pastePlainClipboardText,
            pasteRichPayload,
            replica,
        ],
    );

    const runInlineMarkToggle = useCallback(
        (markType: BooleanInlineMark) => {
            submitCommand((current) => {
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
            submitCommand,
            pendingInlineMarks,
            retainedInlineMarks,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const runCodeToggle = useCallback(() => {
        submitCommand((current) => {
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
        submitCommand,
        pendingInlineMarks,
        retainedInlineMarks,
        resetVerticalCaretIntent,
        scheduleSelectionRestore,
    ]);

    const runMathToggle = useCallback(
        (mode: 'inline' | 'display') => {
            submitCommand((current) => {
                resetVerticalCaretIntent();
                const selection = liveSelectionSet(current);
                const resolved = resolveSelectionSet(current.state, selection);
                if (resolved.entries.every((entry) => entry.selection.type === 'caret')) {
                    const primary = primarySelection(resolved);
                    scheduleSelectionRestore(primary);
                    return {state: current.state, ops: [], selection};
                }

                clearPendingInlineMarks();
                const result =
                    mode === 'display'
                        ? toggleDisplayMathMarkEverywhere(
                              current.state,
                              selection,
                              makeCommandContext(current),
                          )
                        : toggleMathMarkEverywhere(
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
        },
        [
            clearPendingInlineMarks,
            liveSelectionSet,
            submitCommand,
            resetVerticalCaretIntent,
            scheduleSelectionRestore,
        ],
    );

    const insertTextWithPendingMarks = useCallback(
        (current: Replica, selection: RetainedSelectionSet, text: string): MultiCommandResult => {
            const activeMarks = activePendingInlineMarks(pendingInlineMarks);
            const result = !activeMarks.length
                ? insertTextWithMarkdownShortcutsEverywhere(
                    current.state,
                    selection,
                    text,
                    makeCommandContext(current),
                )
                : (() => {
                      const resolved = resolveSelectionSet(current.state, selection);
                      if (!resolved.entries.every((entry) => entry.selection.type === 'caret')) {
                          return insertTextWithMarkdownShortcutsEverywhere(
                              current.state,
                              selection,
                              text,
                              makeCommandContext(current),
                          );
                      }
                      const marked = insertTextWithRetainedMarksEverywhere(
                          current.state,
                          selection,
                          text,
                          activeMarks,
                          retainedInlineMarks,
                          makeCommandContext(current),
                      );
                      setRetainedInlineMarks(marked.retainedMarks);
                      return marked;
                  })();
            if (text === '/' && canOpenSlashMenuForSelection(current.state, selection)) {
                const triggers = slashTriggersFromInsertResult(result);
                if (triggers.length) {
                    setSlashMenu({
                        triggers,
                        selection: result.selection,
                        ...slashPopoverPositionFromSelection(rootRef.current),
                        query: '',
                        activeIndex: 0,
                    });
                }
            } else if (text !== '/') {
                setSlashMenu(null);
            }
            return result;
        },
        [pendingInlineMarks, retainedInlineMarks],
    );

    const closeSlashMenuAndRestoreSelection = useCallback(() => {
        const menu = slashMenu;
        setSlashMenu(null);
        if (!menu) return;
        scheduleSelectionRestore(primarySelection(resolveSelectionSet(replica.state, menu.selection)));
    }, [replica.state, scheduleSelectionRestore, slashMenu]);

    const updateSlashMenuQuery = useCallback((query: string) => {
        setSlashMenu((current) => (current ? {...current, query, activeIndex: 0} : current));
    }, []);

    const updateSlashMenuActiveIndex = useCallback((activeIndex: number) => {
        setSlashMenu((current) => (current ? {...current, activeIndex} : current));
    }, []);

    const runSlashCommand = useCallback(
        (command: SlashCommand) => {
            const menu = slashMenu;
            if (!menu) return;
            setSlashMenu(null);
            submitCommand((current) => {
                resetVerticalCaretIntent();
                const context = makeCommandContext(current);
                const deleted = deleteSlashTriggers(current.state, menu, context);
                let result: MultiCommandResult;
                if (command.type === 'date-embed') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            insertInlineEmbed(
                                working,
                                resolveSelection(working, entry.selection),
                                DEFAULT_DATE_EMBED_DATA,
                                context,
                            ),
                    );
                } else if (command.value === 'table') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            convertBlockToTable(
                                working,
                                resolveSelection(working, entry.selection),
                                context,
                            ),
                    );
                } else if (command.value === 'columns' || command.value === 'card-columns') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            convertBlockToColumns(
                                working,
                                resolveSelection(working, entry.selection),
                                context,
                                command.value === 'card-columns' ? 'cards' : 'blocks',
                            ),
                    );
                } else if (command.value === 'slide-deck') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            convertBlockToSlideDeck(
                                working,
                                resolveSelection(working, entry.selection),
                                context,
                            ),
                    );
                } else if (command.value === 'slide') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            convertBlockToSlide(
                                working,
                                resolveSelection(working, entry.selection),
                                context,
                            ),
                    );
                } else if (command.value === 'preview') {
                    result = runSelectionCommandEverywhere(
                        deleted.state,
                        deleted.selection,
                        (working, entry) =>
                            insertPreviewBlock(
                                working,
                                resolveSelection(working, entry.selection),
                                '',
                                context,
                            ),
                    );
                } else {
                    result = setBlockTypeEverywhere(
                        deleted.state,
                        deleted.selection,
                        (_blockId, meta) => blockTypeMeta(command.value, meta, context.nextTs()),
                    );
                }
                const primary = primarySelection(resolveSelectionSet(result.state, result.selection));
                scheduleSelectionRestore(primary);
                return {
                    state: result.state,
                    ops: [...deleted.ops, ...result.ops],
                    selection: result.selection,
                };
            });
        },
        [resetVerticalCaretIntent, scheduleSelectionRestore, slashMenu, submitCommand],
    );

    const runBlockControlCommand = useCallback(
        (command: (current: Replica) => MultiCommandResult, options?: SubmitCommandOptions) => {
            submitCommand((current) => command(current), options);
        },
        [submitCommand],
    );

    const pollModeForBlock = useCallback(
        (blockId: string): PollEditorMode => pollModesByBlockId[blockId] ?? 'view',
        [pollModesByBlockId],
    );

    const moveSelectionFromHiddenPollChildren = useCallback(
        (blockId: string) => {
            submitCommand((current) => {
                const hiddenBlockIds = new Set(
                    visibleSubtreeBlockIds(current.state, blockId).filter((id) => id !== blockId),
                );
                const currentSelection = primarySelection(
                    resolveSelectionSet(current.state, current.selection),
                );
                const selectedBlockIds = selectedBlockIdsForSelection(
                    current.state,
                    currentSelection,
                );
                if (!selectedBlockIds.some((id) => hiddenBlockIds.has(id))) {
                    return {state: current.state, ops: [], selection: current.selection};
                }
                const nextSelection = caret(blockId, pointTextLength(current.state, blockId));
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
        [scheduleSelectionRestore, submitCommand],
    );

    const setPollModeForBlock = useCallback(
        (blockId: string, mode: PollEditorMode) => {
            const currentMode = pollModeForBlock(blockId);
            setPollModesByBlockId((current) => {
                if ((current[blockId] ?? 'view') === mode) return current;
                return {...current, [blockId]: mode};
            });
            if (currentMode === 'edit' && mode === 'view') {
                moveSelectionFromHiddenPollChildren(blockId);
            }
        },
        [moveSelectionFromHiddenPollChildren, pollModeForBlock],
    );

    const slideDeckUiForBlock = useCallback(
        (blockId: string): SlideDeckUiState => {
            const slides = slideChildren(replica.state, blockId);
            const current = slideDeckUiByBlockId[blockId];
            const currentSlideId =
                current?.currentSlideId && slides.includes(current.currentSlideId)
                    ? current.currentSlideId
                    : slides[0] ?? null;
            return {
                mode: current?.mode ?? 'overview',
                currentSlideId,
                fullScreen: current?.fullScreen ?? false,
            };
        },
        [replica.state, slideDeckUiByBlockId],
    );

    const setSlideDeckUiForBlock = useCallback(
        (blockId: string, update: (current: SlideDeckUiState) => SlideDeckUiState) => {
            setSlideDeckUiByBlockId((current) => {
                const slides = slideChildren(replica.state, blockId);
                const previous = slideDeckUiForBlock(blockId);
                const next = update(previous);
                const currentSlideId =
                    next.currentSlideId && slides.includes(next.currentSlideId)
                        ? next.currentSlideId
                        : slides[0] ?? null;
                return {
                    ...current,
                    [blockId]: {
                        mode: next.mode,
                        currentSlideId,
                        fullScreen: next.fullScreen,
                    },
                };
            });
        },
        [replica.state, slideDeckUiForBlock],
    );

    const orphanSlideModeForBlock = useCallback(
        (blockId: string): OrphanSlideDisplayMode => orphanSlideModesByBlockId[blockId] ?? 'view',
        [orphanSlideModesByBlockId],
    );

    const setOrphanSlideModeForBlock = useCallback(
        (blockId: string, mode: OrphanSlideDisplayMode) => {
            setOrphanSlideModesByBlockId((current) =>
                (current[blockId] ?? 'view') === mode ? current : {...current, [blockId]: mode},
            );
        },
        [],
    );

    const addSlideToDeck = useCallback(
        (deckId: string, afterSlideId?: string) => {
            runBlockControlCommand((current) => {
                const result = addSlide(
                    current.state,
                    deckId,
                    makeCommandContext(current),
                    afterSlideId ? {type: 'after', slideId: afterSlideId} : {type: 'end'},
                );
                const nextSlideId = focusPoint(result.selection).blockId;
                setSlideDeckUiByBlockId((ui) => ({
                    ...ui,
                    [deckId]: {
                        mode: ui[deckId]?.mode ?? 'overview',
                        currentSlideId: nextSlideId,
                        fullScreen: ui[deckId]?.fullScreen ?? false,
                    },
                }));
                return {
                    state: result.state,
                    ops: result.ops,
                    selection: replacePrimarySelection(result.state, current.selection, result.selection),
                };
            });
        },
        [runBlockControlCommand],
    );

    const selectBlockFromHandle = useCallback(
        (blockId: string) => {
            submitCommand((current) => {
                return {
                    state: current.state,
                    ops: [],
                    selection: replaceSelectionSet(current.state, {
                        type: 'block',
                        anchorBlockId: blockId,
                        focusBlockId: blockId,
                    }),
                };
            });
            focusBlockSelectionTarget({
                type: 'block',
                anchorBlockId: blockId,
                focusBlockId: blockId,
            });
        },
        [focusBlockSelectionTarget, submitCommand],
    );

    const startBlockDragFromHandle = useCallback(
        (blockId: string, event: PointerEvent<HTMLElement>) => {
            const primary = primarySelection(resolvedSelectionSet);
            const selectedTopLevelBlockIds =
                primary.type === 'caret'
                    ? []
                    : selectedTopLevelBlockIdsForSelectionSet(replica.state, resolvedSelectionSet);
            if (selectedTopLevelBlockIds.includes(blockId)) {
                startDrag(blockId, event, selectedTopLevelBlockIds);
                return;
            }
            selectBlockFromHandle(blockId);
            startDrag(blockId, event, [blockId]);
        },
        [replica.state, resolvedSelectionSet, selectBlockFromHandle, startDrag],
    );

    const textCaretForBlockSelection = useCallback(
        (state: Replica['state'], selection: EditorSelection, placement: 'focus' | 'document-end') => {
            const selectedBlockIds = selectedBlockIdsForSelection(state, selection);
            const blockId =
                placement === 'focus'
                    ? focusPoint(selection).blockId
                    : selectedBlockIds[selectedBlockIds.length - 1] ?? focusPoint(selection).blockId;
            return caret(blockId, pointTextLength(state, blockId));
        },
        [],
    );

    const deleteBlockLevelSelection = useCallback(
        (current: Replica): MultiCommandResult => {
            const activeSelection = primarySelection(
                resolveSelectionSet(current.state, current.selection),
            );
            const context = makeCommandContext(current);
            if (activeSelection.type === 'table-cells') {
                const result = deleteTableCellSelection(current.state, activeSelection, context);
                if (!result) return {state: current.state, ops: [], selection: current.selection};
                scheduleSelectionRestore(result.selection);
                return {
                    state: result.state,
                    ops: result.ops,
                    selection: replaceSelectionSet(
                        result.state,
                        result.selection,
                        current.selection.primaryId,
                    ),
                };
            }
            const resolved = resolveSelectionSet(current.state, current.selection);
            const blockIds = selectedTopLevelBlockIdsForSelectionSet(current.state, resolved);
            if (!blockIds.length) {
                return {state: current.state, ops: [], selection: current.selection};
            }
            let working = current.state;
            const ops: Array<Op<RichBlockMeta>> = [];
            for (const blockId of blockIds) {
                if (!working.state.blocks[blockId] || isDeleted(working.state.blocks[blockId])) continue;
                const deleted = deleteBlockOps(working, {
                    block: parseLamportString(blockId),
                    mode: 'subtree',
                    virtualParents: annotationVirtualParents(working),
                    ts: context.nextTs,
                });
                working = applyMany(working, deleted, annotationVirtualParents(working));
                ops.push(...deleted);
            }
            const fallbackBlockId = editableBlockIds(working)[0] ?? blockIds[0];
            const fallback = caret(fallbackBlockId, pointTextLength(working, fallbackBlockId));
            scheduleSelectionRestore(fallback);
            return {
                state: working,
                ops,
                selection: replaceSelectionSet(working, fallback, current.selection.primaryId),
            };
        },
        [scheduleSelectionRestore],
    );

    const cutRichSelection = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const payload = currentClipboardPayload();
            if (!payload) return;
            writeClipboardEventPayload(event, payload);
            const currentPrimary = primarySelection(resolvedSelectionSet);
            if (isBlockLevelSelection(currentPrimary)) {
                submitCommand(deleteBlockLevelSelection);
                return;
            }
            runEditCommand((current, selection) =>
                deleteBackwardEverywhere(current.state, selection, makeCommandContext(current)),
            );
        },
        [
            currentClipboardPayload,
            deleteBlockLevelSelection,
            resolvedSelectionSet,
            runEditCommand,
            submitCommand,
            writeClipboardEventPayload,
        ],
    );

    const handleBlockSelectionKeyDown = useCallback(
        (event: KeyboardEvent<HTMLElement>): boolean => {
            const selection = primarySelection(resolvedSelectionSet);
            if (selection.type !== 'block' && selection.type !== 'table-cells') return false;
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                event.key.toLowerCase() === 'c'
            ) {
                event.preventDefault();
                void writeCurrentSelectionToClipboard();
                return true;
            }
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === 'x'
            ) {
                event.preventDefault();
                void writeCurrentSelectionToClipboard();
                submitCommand(deleteBlockLevelSelection);
                return true;
            }
            const modifierPressed = event.metaKey || event.ctrlKey || event.altKey;

            if (event.key.length === 1 && !modifierPressed) {
                event.preventDefault();
                submitCommand((current) => {
                    const textSelection = textCaretForBlockSelection(current.state, selection, 'focus');
                    const selectionSet = replacePrimarySelection(current.state, current.selection, textSelection);
                    const result = insertTextWithPendingMarks(current, selectionSet, event.key);
                    scheduleSelectionRestore(primarySelection(resolveSelectionSet(result.state, result.selection)));
                    return result;
                });
                return true;
            }

            if (
                selection.type === 'block' &&
                !modifierPressed &&
                (event.key === 'ArrowUp' ||
                    event.key === 'ArrowDown' ||
                    event.key === 'ArrowLeft' ||
                    event.key === 'ArrowRight')
            ) {
                event.preventDefault();
                submitCommand((current) => {
                    const blocks = visibleBlockIds(current.state);
                    const focusIndex = blocks.indexOf(selection.focusBlockId);
                    const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
                    const targetBlockId =
                        focusIndex >= 0
                            ? blocks[Math.max(0, Math.min(blocks.length - 1, focusIndex + delta))]
                            : null;
                    if (!targetBlockId) return {state: current.state, ops: [], selection: current.selection};
                    const nextSelection: EditorSelection = {
                        type: 'block',
                        anchorBlockId: targetBlockId,
                        focusBlockId: targetBlockId,
                    };
                    focusBlockSelectionTarget(nextSelection);
                    return {
                        state: current.state,
                        ops: [],
                        selection: replacePrimarySelection(current.state, current.selection, nextSelection),
                    };
                });
                return true;
            }

            if (selection.type === 'block' && event.key === 'Tab' && !modifierPressed) {
                event.preventDefault();
                submitCommand((current) => {
                    const result = (event.shiftKey ? unindentSelections : indentSelections)(
                        current.state,
                        current.selection,
                        makeCommandContext(current),
                    );
                    const nextSelection = primarySelection(resolveSelectionSet(result.state, result.selection));
                    if (nextSelection.type === 'block') focusBlockSelectionTarget(nextSelection);
                    return result;
                });
                return true;
            }

            if (event.key === 'Enter' && !modifierPressed) {
                event.preventDefault();
                if (selection.type === 'block') {
                    submitCommand((current) => {
                        const blockId = focusPoint(selection).blockId;
                        const nextSelection: EditorSelection = {
                            type: 'range',
                            anchor: {blockId, offset: 0},
                            focus: {blockId, offset: pointTextLength(current.state, blockId)},
                        };
                        scheduleSelectionRestore(nextSelection);
                        return {
                            state: current.state,
                            ops: [],
                            selection: replacePrimarySelection(current.state, current.selection, nextSelection),
                        };
                    });
                    return true;
                }
                submitCommand((current) => {
                    const textSelection = textCaretForBlockSelection(current.state, selection, 'document-end');
                    const selectionSet = replacePrimarySelection(current.state, current.selection, textSelection);
                    const result = splitBlockEverywhere(current.state, selectionSet, makeCommandContext(current));
                    scheduleSelectionRestore(primarySelection(resolveSelectionSet(result.state, result.selection)));
                    return result;
                });
                return true;
            }

            if ((event.key === 'Backspace' || event.key === 'Delete') && !modifierPressed) {
                event.preventDefault();
                submitCommand(deleteBlockLevelSelection);
                return true;
            }

            return false;
        },
        [
            focusBlockSelectionTarget,
            insertTextWithPendingMarks,
            submitCommand,
            deleteBlockLevelSelection,
            resolvedSelectionSet,
            scheduleSelectionRestore,
            textCaretForBlockSelection,
            writeCurrentSelectionToClipboard,
        ],
    );

    const insertDateEmbedFromCurrentSelection = useCallback(() => {
        runEditCommand((current, selection) => {
            const result = insertInlineEmbed(
                current.state,
                primarySelection(resolveSelectionSet(current.state, selection)),
                DEFAULT_DATE_EMBED_DATA,
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
        submitCommand((current) => {
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
    }, [liveSelectionSet, openLinkPopoverForRanges, submitCommand]);

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
            submitCommand((current) => {
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
                        liveSelection.type === 'range'
                            ? liveSelection.anchor
                            : firstPointForSelection(current.state, liveSelection),
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
        [scheduleSelectionRestore, submitCommand],
    );

    const moveCaret = useCallback(
        (selection: EditorSelection) => {
            scheduleSelectionRestore(selection);
            submitCommand((current) => ({
                state: current.state,
                ops: [],
                selection: replacePrimarySelection(current.state, current.selection, selection),
            }));
        },
        [scheduleSelectionRestore, submitCommand],
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
            submitCommand((current) => {
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
        [replica, resetVerticalCaretIntent, scheduleSelectionRestore, submitCommand],
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
            submitCommand((current) => {
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
                anchor:
                    selection.type === 'range'
                        ? selection.anchor
                        : firstPointForSelection(result.state, selection),
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
        [replica, resetVerticalCaretIntent, scheduleSelectionRestore, submitCommand],
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
            if (selection.type !== 'range') return selection;
            return {...selection, focus: {...selection.focus, offset}};
        },
        [],
    );

    useLayoutEffect(() => {
        const root = rootRef.current;
        const selection = pendingSelectionRestoreRef.current;
        if (!root || !selection || selection.type !== 'range') return;
        if (document.activeElement === null || !root.contains(document.activeElement)) return;
        pendingSelectionRestoreRef.current = null;
        restoreSelectionToDom(root, selection);
    }, [replica.state, replica.selection]);

    useLayoutEffect(() => {
        const selection = pendingBlockSelectionFocusRef.current;
        const root = rootRef.current;
        if (!selection || !root) return;
        const focusBlockId = focusPoint(selection).blockId;
        const target = root.querySelector<HTMLElement>(
            `.slideViewport[data-slide-id="${CSS.escape(focusBlockId)}"], [data-block-id="${CSS.escape(focusBlockId)}"]`,
        );
        if (!target) return;
        const domSelection = window.getSelection();
        if (domSelection) domSelection.removeAllRanges();
        suppressNextBlockFocusSelectionRef.current = true;
        suppressNextBlockKeySelectionRef.current = true;
        target.focus({preventScroll: true});
        window.getSelection()?.removeAllRanges();
        pendingBlockSelectionFocusRef.current = null;
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
                <label className="userIdControl">
                    <span>User</span>
                    <input
                        type="text"
                        value={userId}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(event) => onUserIdChange(event.currentTarget.value)}
                    />
                </label>
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
                onMath={() => {
                    if (!activeAnnotationBodySelection) runMathToggle('inline');
                }}
                onDisplayMath={() => {
                    if (!activeAnnotationBodySelection) runMathToggle('display');
                }}
                onLink={openLinkFromCurrentSelection}
                onDateEmbed={insertDateEmbedFromCurrentSelection}
                onImageUploadStart={captureImageUploadSelection}
                onImageUpload={(files) => void insertImageFiles(files)}
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
                        if (kind === 'columns' || kind === 'card-columns') {
                            const result = convertBlockToColumns(
                                current.state,
                                primarySelection(resolveSelectionSet(current.state, selection)),
                                makeCommandContext(current),
                                kind === 'card-columns' ? 'cards' : 'blocks',
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
                        if (kind === 'slide-deck') {
                            const result = convertBlockToSlideDeck(
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
                        if (kind === 'slide') {
                            const result = convertBlockToSlide(
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
                        if (kind === 'preview') {
                            const result = insertPreviewBlock(
                                current.state,
                                primarySelection(resolveSelectionSet(current.state, selection)),
                                '',
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
                        tabIndex={-1}
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
                        onPointerDown={startTextDragSelection}
                        onMouseDown={captureMouseDown}
                        onMouseUp={captureSelection}
                        onCopy={copyRichSelection}
                        onCut={cutRichSelection}
                        onPaste={pasteFromClipboard}
                        onKeyDown={(event) => {
                            if (handleBlockSelectionKeyDown(event)) return;
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
                                attachments,
                                userId,
                                charIdsByBlock,
                                visibleBlockIdSet,
                                rainbowLamportIds,
                                selection: primaryResolvedSelection,
                                hasMultipleSelections: resolvedSelectionSet.entries.length > 1,
                                decorationsByBlock,
                                blockLevelDecorationsByBlock,
                                pendingCaretRestoreBlockIdRef,
                                suppressNextBlockFocusSelectionRef,
                                suppressNextBlockKeySelectionRef,
                                draggingSubtreeIds,
                                draggingId,
                                dropTarget,
                                cellDragBlockDropTarget,
                                setCellDragBlockDropTarget,
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
                                pollModeForBlock,
                                setPollModeForBlock,
                                slideDeckUiForBlock,
                                setSlideDeckUiForBlock,
                                orphanSlideModeForBlock,
                                setOrphanSlideModeForBlock,
                                addSlideToDeck,
                                runEditCommand,
                                runBlockControlCommand,
                                focusBlockSelectionTarget,
                                startBlockDragFromHandle,
                                onCopy: copyRichSelection,
                                onCut: cutRichSelection,
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
                                onInputMeasured,
                                onDisplayInputRenderStarted,
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
                        rainbowLamportIds={rainbowLamportIds}
                        onPopoverTriggerEnter={showPopover}
                        onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                        onInputMeasured={onInputMeasured}
                        onDisplayInputRenderStarted={onDisplayInputRenderStarted}
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
                    rainbowLamportIds={rainbowLamportIds}
                    onPopoverTriggerEnter={showPopover}
                    onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                    onInputMeasured={onInputMeasured}
                    onDisplayInputRenderStarted={onDisplayInputRenderStarted}
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
                    rainbowLamportIds={rainbowLamportIds}
                    onPopoverTriggerEnter={showPopover}
                    onPopoverTriggerLeave={schedulePopoverHideFromPointer}
                    onInputMeasured={onInputMeasured}
                    onDisplayInputRenderStarted={onDisplayInputRenderStarted}
                />
            ))}
            <SlashCommandPopover
                state={slashMenu}
                onQueryChange={updateSlashMenuQuery}
                onActiveIndexChange={updateSlashMenuActiveIndex}
                onSelect={runSlashCommand}
                onClose={closeSlashMenuAndRestoreSelection}
            />
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

type SlideDeckDisplayMode = 'presentation' | 'overview' | 'outline';
type OrphanSlideDisplayMode = 'view' | 'outline';

type SlideDeckUiState = {
    mode: SlideDeckDisplayMode;
    currentSlideId: string | null;
    fullScreen: boolean;
};

type ElementSize = {
    width: number;
    height: number;
};

const emptyElementSize: ElementSize = {width: 0, height: 0};

const calculateSlideScale = (
    viewport: ElementSize,
    deck: Pick<Extract<RichBlockMeta, {type: 'slide_deck'}>, 'width' | 'height'>,
): number => {
    if (viewport.width <= 0 || viewport.height <= 0 || deck.width <= 0 || deck.height <= 0) {
        return 1;
    }
    return Math.min(viewport.width / deck.width, viewport.height / deck.height);
};

const useElementSize = <T extends HTMLElement>(): [(element: T | null) => void, ElementSize] => {
    const [element, setElement] = useState<T | null>(null);
    const [size, setSize] = useState<ElementSize>(emptyElementSize);

    useLayoutEffect(() => {
        if (!element) {
            setSize(emptyElementSize);
            return;
        }

        const updateSize = () => {
            const rect = element.getBoundingClientRect();
            setSize((current) =>
                current.width === rect.width && current.height === rect.height
                    ? current
                    : {width: rect.width, height: rect.height},
            );
        };

        updateSize();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return [setElement, size];
};

const runSelectionCommandEverywhere = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    command: (
        working: CachedState<RichBlockMeta>,
        entry: RetainedSelectionEntry,
    ) => CommandResult,
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

type RenderBlockContext = {
    blocks: RichFormattedBlock[];
    state: Replica['state'];
    attachments: AttachmentStore;
    userId: string;
    charIdsByBlock: Map<string, string[]>;
    visibleBlockIdSet: Set<string>;
    rainbowLamportIds: boolean;
    selection: EditorSelection;
    hasMultipleSelections: boolean;
    decorationsByBlock: Map<string, BlockSelectionDecorations>;
    blockLevelDecorationsByBlock: Map<string, BlockLevelSelectionDecorations>;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    suppressNextBlockFocusSelectionRef: MutableRefObject<boolean>;
    suppressNextBlockKeySelectionRef: MutableRefObject<boolean>;
    draggingSubtreeIds: Set<string>;
    draggingId: string | null;
    dropTarget: DropTarget | null;
    cellDragBlockDropTarget: DropTarget | null;
    setCellDragBlockDropTarget(target: DropTarget | null): void;
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
    runBlockControlCommand(
        command: (current: Replica) => MultiCommandResult,
        options?: SubmitCommandOptions,
    ): void;
    focusBlockSelectionTarget(selection?: EditorSelection | null): void;
    startBlockDragFromHandle(blockId: string, event: PointerEvent<HTMLElement>): void;
    onCopy(event: ClipboardEvent<HTMLElement>): void;
    onCut(event: ClipboardEvent<HTMLElement>): void;
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
    pollModeForBlock(blockId: string): PollEditorMode;
    setPollModeForBlock(blockId: string, mode: PollEditorMode): void;
    slideDeckUiForBlock(blockId: string): SlideDeckUiState;
    setSlideDeckUiForBlock(blockId: string, update: (current: SlideDeckUiState) => SlideDeckUiState): void;
    orphanSlideModeForBlock(blockId: string): OrphanSlideDisplayMode;
    setOrphanSlideModeForBlock(blockId: string, mode: OrphanSlideDisplayMode): void;
    addSlideToDeck(deckId: string, afterSlideId?: string): void;
    onUndo(): void;
    onRedo(): void;
    onKeystroke(blockId: string, event: KeyboardEvent<HTMLElement>): void;
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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

const blockPlainText = (block: RichFormattedBlock): string =>
    block.runs.map((run) => run.text).join('');

const matrixPollViewForNode = (node: RenderTreeNode): MatrixPollView => {
    const [rowGroup, columnGroup] = node.children;
    return {
        rows: (rowGroup?.children ?? []).map((row) => ({
            id: row.block.id,
            label: blockPlainText(row.block) || 'Untitled row',
        })),
        columns: (columnGroup?.children ?? []).map((column) => ({
            id: column.block.id,
            label: blockPlainText(column.block) || 'Untitled column',
        })),
    };
};

const renderBlockNode = (node: RenderTreeNode, context: RenderBlockContext): ReactElement => {
    const meta = node.block.block.meta;
    const isChildBackedPoll =
        meta.type === 'poll' && (meta.kind === 'children' || meta.kind === 'matrix');
    const pollEditorMode = isChildBackedPoll ? context.pollModeForBlock(node.block.id) : undefined;
    if (meta.type === 'table') {
        return <TableBlock key={node.block.id} node={node} context={context} />;
    }
    if (meta.type === 'columns') {
        return <ColumnsBlock key={node.block.id} node={node} context={context} />;
    }
    if (meta.type === 'slide_deck') {
        return <SlideDeckBlock key={node.block.id} node={node} context={context} />;
    }
    if (meta.type === 'slide' && !slideDeckForSlide(context.state, node.block.id)) {
        return <OrphanSlideBlock key={node.block.id} node={node} context={context} />;
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
            {renderEditableBlock(node.block, context, {
                pollOptions:
                    meta.type === 'poll' && meta.kind === 'children'
                        ? node.children.map((child) => ({
                              id: child.block.id,
                              label: blockPlainText(child.block) || 'Untitled option',
                          }))
                        : undefined,
                matrixPoll:
                    meta.type === 'poll' && meta.kind === 'matrix'
                        ? matrixPollViewForNode(node)
                        : undefined,
                pollEditorMode,
                onSetPollEditorMode: pollEditorMode
                    ? (mode) => context.setPollModeForBlock(node.block.id, mode)
                    : undefined,
            })}
            {(!isChildBackedPoll || pollEditorMode === 'edit')
                ? node.children.map((child) => renderBlockNode(child, context))
                : null}
        </div>
    );
};

type TableCellDragTarget =
    | ({kind: 'cell-slot'} & TableCellSlotTarget)
    | {
          kind: 'row-slot';
          tableId: string;
          beforeRowId: string | null;
          afterRowId: string | null;
          indicatorRowId: string;
          indicatorPlacement: 'before' | 'after';
      }
    | {
          kind: 'block-slot';
          dropTarget: DropTarget;
      };

function SlideDeckBlock({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    const presentationRef = useRef<HTMLElement>(null);
    const meta = node.block.block.meta;
    if (meta.type !== 'slide_deck') {
        return <div className="renderTreeBranch">{renderEditableBlock(node.block, context)}</div>;
    }
    const slides = node.children.filter((child) => child.block.block.meta.type === 'slide');
    const ui = context.slideDeckUiForBlock(node.block.id);
    const currentSlideId =
        ui.currentSlideId && slides.some((slide) => slide.block.id === ui.currentSlideId)
            ? ui.currentSlideId
            : slides[0]?.block.id ?? null;
    const currentIndex = currentSlideId
        ? Math.max(0, slides.findIndex((slide) => slide.block.id === currentSlideId))
        : -1;
    const currentSlide = currentIndex >= 0 ? slides[currentIndex] : null;
    const deckTitle = blockPlainText(node.block);
    const selectSlideBlock = (slideId: string | null) => {
        if (!slideId) return;
        const selection = {
            type: 'block' as const,
            anchorBlockId: slideId,
            focusBlockId: slideId,
        };
        context.runBlockControlCommand(
            (current) => ({
                state: current.state,
                ops: [],
                selection: replaceSelectionSet(current.state, selection, current.selection.primaryId),
            }),
            {constrainFullscreenSlideSelection: false},
        );
        context.focusBlockSelectionTarget(selection);
    };
    const setMode = (mode: SlideDeckDisplayMode) => {
        if (mode === 'presentation') selectSlideBlock(currentSlideId);
        context.setSlideDeckUiForBlock(node.block.id, (current) => ({...current, mode}));
    };
    const setCurrentSlide = (slideId: string | null, select = ui.mode === 'presentation') => {
        if (select) selectSlideBlock(slideId);
        context.setSlideDeckUiForBlock(node.block.id, (current) => ({...current, currentSlideId: slideId}));
    };
    const showPrevious = () => {
        if (!slides.length) return;
        const previous = slides[Math.max(0, currentIndex - 1)] ?? slides[0];
        setCurrentSlide(previous.block.id);
    };
    const showNext = () => {
        if (!slides.length) return;
        const next = slides[Math.min(slides.length - 1, currentIndex + 1)] ?? slides[slides.length - 1];
        setCurrentSlide(next.block.id);
    };
    const setFullScreen = (fullScreen: boolean) =>
        context.setSlideDeckUiForBlock(node.block.id, (current) => ({...current, fullScreen}));
    const exitFullScreen = () => {
        if (document.fullscreenElement === presentationRef.current) {
            void document.exitFullscreen?.();
        }
        setFullScreen(false);
    };
    const toggleFullScreen = () => {
        const element = presentationRef.current;
        if (!element) return;
        if (document.fullscreenElement === element) {
            exitFullScreen();
        } else {
            void element.requestFullscreen?.();
            setFullScreen(true);
        }
    };

    useEffect(() => {
        const onFullScreenChange = () => {
            if (document.fullscreenElement !== presentationRef.current && ui.fullScreen) {
                setFullScreen(false);
            }
        };
        document.addEventListener('fullscreenchange', onFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
    }, [ui.fullScreen]);

    const handlePresentationKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const modifierPressed = event.altKey || event.metaKey || event.ctrlKey;
        const activeElement = event.currentTarget.ownerDocument.activeElement;
        const currentSlideElement = currentSlideId
            ? presentationRef.current?.querySelector<HTMLElement>(
                  `.slideViewport[data-slide-id="${CSS.escape(currentSlideId)}"]`,
              )
            : null;
        const hasCurrentSlideBlockSelection =
            currentSlideId !== null &&
            activeElement === currentSlideElement &&
            context.selection.type === 'block' &&
            context.selection.anchorBlockId === currentSlideId &&
            context.selection.focusBlockId === currentSlideId;
        if (
            hasCurrentSlideBlockSelection &&
            !modifierPressed &&
            (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ')
        ) {
            event.preventDefault();
            event.stopPropagation();
            showNext();
        } else if (
            hasCurrentSlideBlockSelection &&
            !modifierPressed &&
            (event.key === 'ArrowLeft' || event.key === 'PageUp')
        ) {
            event.preventDefault();
            event.stopPropagation();
            showPrevious();
        } else if (event.key === 'Escape' && document.fullscreenElement === presentationRef.current) {
            if (eventFromEditableSurface(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            exitFullScreen();
        }
    };

    if (ui.mode === 'outline') {
        return (
            <section
                className="slideDeckBlock slideDeckOutline"
                data-slide-deck-id={node.block.id}
                style={{'--block-depth': node.block.depth} as CSSProperties}
            >
                <SlideDeckToolbar
                    mode={ui.mode}
                    currentIndex={currentIndex}
                    slideCount={slides.length}
                    onMode={setMode}
                    onPrevious={showPrevious}
                    onNext={showNext}
                    onAddSlide={() => context.addSlideToDeck(node.block.id, currentSlideId ?? undefined)}
                    onToggleFullScreen={toggleFullScreen}
                    fullScreen={ui.fullScreen}
                />
                {renderEditableBlock(node.block, context, {surfaceClassName: 'slideDeckTitleText'})}
                <div className="slideDeckOutlineChildren">
                    {node.children.map((child) => renderBlockNode(child, context))}
                </div>
            </section>
        );
    }

    return (
        <section
            ref={ui.mode === 'presentation' ? presentationRef : undefined}
            className={[
                'slideDeckBlock',
                ui.mode === 'presentation' ? 'slideDeckPresentation' : 'slideDeckOverview',
                ui.fullScreen ? 'slideDeckFullScreen' : '',
            ].join(' ')}
            data-slide-deck-id={node.block.id}
            style={{'--block-depth': node.block.depth} as CSSProperties}
            tabIndex={ui.mode === 'presentation' ? 0 : undefined}
            onKeyDown={ui.mode === 'presentation' ? handlePresentationKeyDown : undefined}
        >
            {ui.fullScreen ? null : (
                <div className="slideDeckHeader">
                    {renderEditableBlock(node.block, context, {
                        surfaceClassName: 'slideDeckTitleText',
                        hideBlockAffordance: true,
                        registerBlockRow: false,
                    })}
                    <SlideDeckToolbar
                        mode={ui.mode}
                        currentIndex={currentIndex}
                        slideCount={slides.length}
                        onMode={setMode}
                        onPrevious={showPrevious}
                        onNext={showNext}
                        onAddSlide={() => context.addSlideToDeck(node.block.id, currentSlideId ?? undefined)}
                        onToggleFullScreen={toggleFullScreen}
                        fullScreen={ui.fullScreen}
                    />
                </div>
            )}
            {ui.mode === 'presentation' ? (
                currentSlide ? (
                    <>
                        <SlideBlockView
                            node={currentSlide}
                            context={context}
                            deckId={node.block.id}
                            deck={meta}
                            deckTitle={deckTitle}
                            slideIndex={currentIndex}
                            slideCount={slides.length}
                            mode="presentation"
                        />
                        {ui.fullScreen ? (
                            <SlideFullScreenControls
                                currentIndex={currentIndex}
                                slideCount={slides.length}
                                onPrevious={showPrevious}
                                onNext={showNext}
                                onExitFullScreen={exitFullScreen}
                            />
                        ) : null}
                    </>
                ) : (
                    <div className="slideDeckEmpty">No slides</div>
                )
            ) : (
                <div className="slideOverviewList">
                    {slides.length ? (
                        slides.map((slide, index) => (
                            <SlideBlockView
                                key={slide.block.id}
                                node={slide}
                                context={context}
                                deckId={node.block.id}
                                deck={meta}
                                deckTitle={deckTitle}
                                slideIndex={index}
                                slideCount={slides.length}
                                mode="overview"
                            />
                        ))
                    ) : (
                        <div className="slideDeckEmpty">No slides</div>
                    )}
                </div>
            )}
        </section>
    );
}

function SlideFullScreenControls({
    currentIndex,
    slideCount,
    onPrevious,
    onNext,
    onExitFullScreen,
}: {
    currentIndex: number;
    slideCount: number;
    onPrevious(): void;
    onNext(): void;
    onExitFullScreen(): void;
}) {
    return (
        <div
            className="slideFullScreenControls"
            contentEditable={false}
            onMouseDown={stopEditorControlEvent}
            aria-label="Full screen slide controls"
        >
            <button type="button" onClick={onPrevious} disabled={currentIndex <= 0} aria-label="Previous slide">
                Prev
            </button>
            <span>
                {slideCount ? currentIndex + 1 : 0}/{slideCount}
            </span>
            <button type="button" onClick={onNext} disabled={currentIndex < 0 || currentIndex >= slideCount - 1} aria-label="Next slide">
                Next
            </button>
            <button type="button" onClick={onExitFullScreen}>
                Exit full screen
            </button>
        </div>
    );
}

function SlideDeckToolbar({
    mode,
    currentIndex,
    slideCount,
    onMode,
    onPrevious,
    onNext,
    onAddSlide,
    onToggleFullScreen,
    fullScreen,
}: {
    mode: SlideDeckDisplayMode;
    currentIndex: number;
    slideCount: number;
    onMode(mode: SlideDeckDisplayMode): void;
    onPrevious(): void;
    onNext(): void;
    onAddSlide(): void;
    onToggleFullScreen(): void;
    fullScreen: boolean;
}) {
    return (
        <div className="slideDeckToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
            <div className="slideModeTabs" role="group" aria-label="Slide deck display mode">
                {(['presentation', 'overview', 'outline'] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={mode === value}
                        onClick={() => onMode(value)}
                    >
                        {capitalize(value)}
                    </button>
                ))}
            </div>
            <div className="slideNavigation" aria-label="Slide navigation">
                <button type="button" onClick={onPrevious} disabled={currentIndex <= 0}>
                    Prev
                </button>
                <span>
                    {slideCount ? currentIndex + 1 : 0}/{slideCount}
                </span>
                <button type="button" onClick={onNext} disabled={currentIndex < 0 || currentIndex >= slideCount - 1}>
                    Next
                </button>
            </div>
            <button type="button" onClick={onAddSlide}>
                Add slide
            </button>
            {mode === 'presentation' ? (
                <button type="button" onClick={onToggleFullScreen} aria-pressed={fullScreen}>
                    {fullScreen ? 'Exit full screen' : 'Full screen'}
                </button>
            ) : null}
        </div>
    );
}

function OrphanSlideBlock({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    const mode = context.orphanSlideModeForBlock(node.block.id);
    if (mode === 'outline') {
        return (
            <section className="orphanSlideBlock orphanSlideOutline">
                <div className="orphanSlideToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
                    <button type="button" aria-pressed={false} onClick={() => context.setOrphanSlideModeForBlock(node.block.id, 'view')}>
                        View
                    </button>
                    <button type="button" aria-pressed>
                        Outline
                    </button>
                </div>
                {renderEditableBlock(node.block, context)}
                {node.children.map((child) => renderBlockNode(child, context))}
            </section>
        );
    }
    return (
        <section className="orphanSlideBlock orphanSlideView">
            <div className="orphanSlideToolbar" contentEditable={false} onMouseDown={stopEditorControlEvent}>
                <button type="button" aria-pressed>
                    View
                </button>
                <button type="button" aria-pressed={false} onClick={() => context.setOrphanSlideModeForBlock(node.block.id, 'outline')}>
                    Outline
                </button>
            </div>
            <SlideBlockView
                node={node}
                context={context}
                deckId={null}
                deck={{type: 'slide_deck', width: 1920, height: 1080, footer: 'none', ts: node.block.block.meta.ts}}
                deckTitle=""
                slideIndex={0}
                slideCount={1}
                mode="orphan"
            />
        </section>
    );
}

function SlideBlockView({
    node,
    context,
    deckId,
    deck,
    deckTitle,
    slideIndex,
    slideCount,
    mode,
}: {
    node: RenderTreeNode;
    context: RenderBlockContext;
    deckId: string | null;
    deck: Extract<RichBlockMeta, {type: 'slide_deck'}>;
    deckTitle: string;
    slideIndex: number;
    slideCount: number;
    mode: 'presentation' | 'overview' | 'orphan';
}) {
    const meta = node.block.block.meta;
    const [setViewportElement, viewportSize] = useElementSize<HTMLElement>();
    const contextRef = useRef(context);
    contextRef.current = context;
    if (meta.type !== 'slide') {
        return <div className="renderTreeBranch">{renderEditableBlock(node.block, context)}</div>;
    }
    const footer = slideFooterText(deck.footer, deckTitle, slideIndex, slideCount);
    const scale = calculateSlideScale(viewportSize, deck);
    const style = {
        '--slide-width': deck.width,
        '--slide-height': deck.height,
        backgroundColor: richBlockStyleValue(node.block.block.style, 'background-color') ?? '#ffffff',
    } as CSSProperties;
    const scaleLayerStyle = {
        width: `${deck.width}px`,
        height: `${deck.height}px`,
        transform: `scale(${scale})`,
    } as CSSProperties;
    const handleRimPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        context.startBlockDragFromHandle(node.block.id, event);
    };
    const selectSlideBlock = () => {
        const selection = {
            type: 'block' as const,
            anchorBlockId: node.block.id,
            focusBlockId: node.block.id,
        };
        context.runBlockControlCommand((current) => ({
            state: current.state,
            ops: [],
            selection: replaceSelectionSet(current.state, selection, current.selection.primaryId),
        }));
        context.focusBlockSelectionTarget(selection);
    };
    const handleSurfacePointerDown = (event: PointerEvent<HTMLElement>) => {
        if (eventFromEditableSurface(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        selectSlideBlock();
    };
    const stopSurfaceMouseDown = (event: MouseEvent<HTMLElement>) => {
        if (eventFromEditableSurface(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
    };
    const stopRimMouseDown = (event: MouseEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
    };
    const setSlideViewportElement = useCallback((element: HTMLElement | null) => {
        contextRef.current.registerRow(node.block.id, element);
        setViewportElement(element);
    }, [node.block.id, setViewportElement]);
    return (
        <article
            ref={setSlideViewportElement}
            className={[
                'slideViewport',
                `slideViewport-${mode}`,
                `slideTransition-${meta.transition}`,
                context.draggingSubtreeIds.has(node.block.id) ? 'dragging' : '',
                context.draggingId === node.block.id ? 'draggingRoot' : '',
                context.blockLevelDecorationsByBlock.get(node.block.id)?.selected ? 'blockSelected' : '',
                context.blockLevelDecorationsByBlock.get(node.block.id)?.focus ? 'blockSelectionFocus' : '',
                context.dropTarget?.indicatorBlockId === node.block.id
                    ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                    : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-slide-id={node.block.id}
            data-slide-logical-width={deck.width}
            data-slide-logical-height={deck.height}
            data-slide-scale={scale}
            tabIndex={-1}
            style={style}
            onPointerDown={handleRimPointerDown}
            onMouseDown={stopRimMouseDown}
        >
            <div className="slideScaleLayer" style={scaleLayerStyle}>
                <div
                    className="slideSurface"
                    onPointerDown={handleSurfacePointerDown}
                    onMouseDown={stopSurfaceMouseDown}
                >
                    {meta.showTitle ? (
                        <div className="slideTitle">
                            {renderEditableBlock({...node.block, depth: 0}, context, {
                                surfaceClassName: 'slideTitleText',
                                hideBlockAffordance: true,
                                hideInlineControls: true,
                                hideBlockLevelDecoration: true,
                                registerBlockRow: false,
                                ...(deckId ? {onSplit: () => context.addSlideToDeck(deckId, node.block.id)} : {}),
                            })}
                        </div>
                    ) : null}
                    <div className="slideBody">
                        {node.children.map((child) =>
                            renderBlockNodeAtRelativeDepth(child, context, node.block.depth + 1),
                        )}
                    </div>
                    {footer ? <div className="slideFooter">{footer}</div> : null}
                </div>
            </div>
            {mode === 'overview' ? (
                <SlideBlockOptions blockId={node.block.id} meta={meta} context={context} />
            ) : null}
        </article>
    );
}

function SlideBlockOptions({
    blockId,
    meta,
    context,
}: {
    blockId: string;
    meta: Extract<RichBlockMeta, {type: 'slide'}>;
    context: RenderBlockContext;
}) {
    const noop = () => undefined;
    const style = context.state.state.blocks[blockId]?.style;
    return (
        <BlockOptions
            className="slideBlockOptions"
            meta={meta}
            style={style}
            onSetCodeLanguage={noop}
            onSetCodePreview={noop}
            onSetCalloutKind={noop}
            onSetImageSize={noop}
            onSetPollChoiceMode={noop}
            onSetPollDisplayMode={noop}
            onSetColumnsDisplay={noop}
            onSetPollAllowChange={noop}
            onSetRatingPollMax={noop}
            onSetRatingPollPresentation={noop}
            onSetSlideDeckSize={noop}
            onSetSlideDeckFooter={noop}
            onSetSlideShowTitle={(showTitle) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[blockId];
                    if (!currentBlock || currentBlock.meta.type !== 'slide') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, blockId, {
                        ...currentBlock.meta,
                        showTitle,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetSlideTransition={(transition) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[blockId];
                    if (!currentBlock || currentBlock.meta.type !== 'slide') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, blockId, {
                        ...currentBlock.meta,
                        transition,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetBlockStyle={(attribute, value) =>
                context.runBlockControlCommand((current) => {
                    const result = updateBlockStyle(
                        current.state,
                        blockId,
                        attribute,
                        value,
                        makeCommandContext(current),
                    );
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: current.selection,
                        commandLabel: `Set block ${attribute}`,
                    };
                })
            }
        />
    );
}

const slideFooterText = (
    footer: Extract<RichBlockMeta, {type: 'slide_deck'}>['footer'],
    deckTitle: string,
    slideIndex: number,
    slideCount: number,
): string => {
    const number = slideCount ? `${slideIndex + 1}/${slideCount}` : '';
    if (footer === 'deck-title') return deckTitle;
    if (footer === 'slide-number') return number;
    if (footer === 'deck-title-and-slide-number') return [deckTitle, number].filter(Boolean).join(' · ');
    return '';
};

const eventFromEditableSurface = (target: EventTarget | null): boolean => {
    const ownerDocument = (target as {ownerDocument?: Document} | null)?.ownerDocument;
    const elementConstructor = ownerDocument?.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return false;
    return Boolean(target.closest('[contenteditable="true"], input, textarea, select, button'));
};

function ColumnsBlock({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    const display = node.block.block.meta.type === 'columns' ? node.block.block.meta.display : 'blocks';
    return (
        <section
            className={['columnsBlock', display === 'cards' ? 'columnsBlockCards' : 'columnsBlockBlocks'].join(' ')}
            data-columns-board-id={node.block.id}
            data-columns-display={display}
            style={{'--block-depth': node.block.depth} as CSSProperties}
        >
            <div className="columnsTitle">
                {renderEditableBlock(node.block, context, {
                    surfaceClassName: 'columnsTitleText',
                })}
            </div>
            <div className="columnsColumns" data-columns-board-id={node.block.id} data-columns-display={display}>
                {display === 'cards'
                    ? node.children.map((column) => (
                          <ColumnsCardModeColumn key={column.block.id} node={column} context={context} />
                      ))
                    : node.children.map((column) => (
                          <ColumnsBlockModeColumn
                              key={column.block.id}
                              node={column}
                              context={context}
                              baseDepth={node.block.depth + 1}
                          />
                      ))}
            </div>
        </section>
    );
}

function ColumnsBlockModeColumn({
    node,
    context,
    baseDepth,
}: {
    node: RenderTreeNode;
    context: RenderBlockContext;
    baseDepth: number;
}) {
    return (
        <div
            ref={(element) => context.registerRow(node.block.id, element)}
            className={[
                'columnsColumn',
                'columnsColumnBlocks',
                context.draggingSubtreeIds.has(node.block.id) ? 'dragging' : '',
                context.draggingId === node.block.id ? 'draggingRoot' : '',
                context.dropTarget?.indicatorBlockId === node.block.id
                    ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                    : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-columns-column-id={node.block.id}
            data-columns-column-display="blocks"
        >
            {renderBlockNodeAtRelativeDepth(node, context, baseDepth)}
        </div>
    );
}

function ColumnsCardModeColumn({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    return (
        <section
            ref={(element) => context.registerRow(node.block.id, element)}
            className={[
                'columnsColumn',
                'columnsColumnCards',
                context.draggingSubtreeIds.has(node.block.id) ? 'dragging' : '',
                context.draggingId === node.block.id ? 'draggingRoot' : '',
                context.dropTarget?.indicatorBlockId === node.block.id
                    ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                    : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-columns-column-id={node.block.id}
            data-columns-column-display="cards"
        >
            <div className="columnsColumnHeader">
                <button
                    type="button"
                    className="columnsColumnHandle"
                    aria-label="Move column"
                    onPointerDown={(event) => context.startBlockDragFromHandle(node.block.id, event)}
                >
                    ::
                </button>
                {renderEditableBlock({...node.block, depth: 0}, context, {
                    surfaceClassName: 'columnsColumnTitle',
                    hideBlockAffordance: true,
                    registerBlockRow: false,
                })}
            </div>
            <div className="columnsCards" data-columns-column-cards={node.block.id}>
                {node.children.map((card) => (
                    <ColumnsCard key={card.block.id} node={card} context={context} baseDepth={node.block.depth + 1} />
                ))}
            </div>
        </section>
    );
}

function ColumnsCard({
    node,
    context,
    baseDepth,
}: {
    node: RenderTreeNode;
    context: RenderBlockContext;
    baseDepth: number;
}) {
    return (
        <article
            ref={(element) => context.registerRow(node.block.id, element)}
            className={[
                'columnsCard',
                context.blockLevelDecorationsByBlock.get(node.block.id)?.selected ? 'blockSelected' : '',
                context.blockLevelDecorationsByBlock.get(node.block.id)?.focus ? 'blockSelectionFocus' : '',
                context.draggingSubtreeIds.has(node.block.id) ? 'dragging' : '',
                context.draggingId === node.block.id ? 'draggingRoot' : '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-columns-card-id={node.block.id}
        >
            <button
                type="button"
                className="columnsCardHandle"
                aria-label="Move card"
                onPointerDown={(event) => context.startBlockDragFromHandle(node.block.id, event)}
            >
                ::
            </button>
            <div className="columnsCardBody">
                {renderEditableBlock({...node.block, depth: 0}, context, {
                    surfaceClassName: 'columnsCardTitle',
                    hideBlockAffordance: true,
                    registerBlockRow: false,
                })}
                {node.children.length > 0 ? (
                    <div className="columnsCardChildren">
                        {node.children.map((child) => renderBlockNodeAtRelativeDepth(child, context, baseDepth + 1))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function TableBlock({node, context}: {node: RenderTreeNode; context: RenderBlockContext}) {
    const [cellDrag, setCellDrag] = useState<{
        sourceCellId: string;
        columnCellIds?: string[];
        rectangleSelection?: EditorSelection;
        target: TableCellDragTarget | null;
    } | null>(null);
    const [cellSelectionDrag, setCellSelectionDrag] = useState<{
        tableId: string;
        anchorCellId: string;
        focusCellId: string;
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
            const nextTarget = tableCellDragTargetFromPoint(
                event.clientX,
                event.clientY,
                node.block.id,
                context,
            );
            context.setCellDragBlockDropTarget(
                nextTarget?.kind === 'block-slot' ? nextTarget.dropTarget : null,
            );
            setCellDrag((current) =>
                current
                    ? {
                          ...current,
                          target: nextTarget,
                      }
                    : current,
            );
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target =
                tableCellDragTargetFromPoint(event.clientX, event.clientY, node.block.id, context) ??
                cellDrag.target;
            const sourceCellId = cellDrag.sourceCellId;
            setCellDrag(null);
            context.setCellDragBlockDropTarget(null);
            if (!target) return;
            context.runBlockControlCommand((current) => {
                const rectangle = cellDrag.rectangleSelection
                    ? tableCellRectangleForSelection(current.state, cellDrag.rectangleSelection)
                    : null;
                const draggedCellIds = cellDrag.columnCellIds?.length
                    ? cellDrag.columnCellIds
                    : rectangle?.cellIds.length
                      ? rectangle.cellIds
                      : [sourceCellId];
                if (target.kind === 'row-slot') {
                    const result = moveTableCellsToNewRow(
                        current.state,
                        draggedCellIds,
                        {
                            tableId: target.tableId,
                            beforeRowId: target.beforeRowId,
                            afterRowId: target.afterRowId,
                        },
                        makeCommandContext(current),
                    );
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: replaceSelectionSet(
                            result.state,
                            result.selection,
                            current.selection.primaryId,
                        ),
                    };
                }
                if (target.kind === 'block-slot') {
                    const command = target.dropTarget.command;
                    if (command.type === 'table-cell-slot') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    if (cellDrag.rectangleSelection) {
                        const result = moveCellRectangleOutToNewTable(
                            current.state,
                            cellDrag.rectangleSelection,
                            command,
                            makeCommandContext(current),
                        );
                        return result
                            ? {
                                  state: result.state,
                                  ops: result.ops,
                                  selection: replaceSelectionSet(
                                      result.state,
                                      result.selection,
                                      current.selection.primaryId,
                                  ),
                              }
                            : {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = moveTableCellsOutAsBlocks(
                        current.state,
                        draggedCellIds,
                        command,
                        makeCommandContext(current),
                    );
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: replaceSelectionSet(
                            result.state,
                            result.selection,
                            current.selection.primaryId,
                        ),
                    };
                }
                if (cellDrag.rectangleSelection) {
                    const result = moveTableCellRectangleContents(
                        current.state,
                        cellDrag.rectangleSelection,
                        target,
                        makeCommandContext(current),
                    );
                    return result
                        ? {
                              state: result.state,
                              ops: result.ops,
                              selection: replaceSelectionSet(
                                  result.state,
                                  result.selection,
                                  current.selection.primaryId,
                              ),
                          }
                        : {state: current.state, ops: [], selection: current.selection};
                }
                if (!cellDrag.columnCellIds?.length) {
                    const result = moveTableCell(
                        current.state,
                        sourceCellId,
                        target,
                        makeCommandContext(current),
                    );
                    return {state: result.state, ops: result.ops, selection: current.selection};
                }
                let working = current.state;
                const ops: Array<Op<RichBlockMeta>> = [];
                for (const cellId of cellDrag.columnCellIds) {
                    const rowId = lamportToString(
                        materializedBlockParent(working, cellId, annotationVirtualParents(working)),
                    );
                    const result = moveTableCell(
                        working,
                        cellId,
                        {rowId, index: target.index},
                        makeCommandContext(current),
                    );
                    working = result.state;
                    ops.push(...result.ops);
                }
                return {state: working, ops, selection: current.selection};
            });
        };
        const onPointerCancel = () => {
            setCellDrag(null);
            context.setCellDragBlockDropTarget(null);
        };
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [cellDrag, context]);

    useLayoutEffect(() => {
        if (!cellSelectionDrag) return;
        const selectCells = (focusCellId: string) => {
            const selection: EditorSelection = {
                type: 'table-cells',
                tableId: cellSelectionDrag.tableId,
                anchorCellId: cellSelectionDrag.anchorCellId,
                focusCellId,
            };
            context.runBlockControlCommand((current) => ({
                state: current.state,
                ops: [],
                selection: replaceSelectionSet(current.state, selection, current.selection.primaryId),
            }));
        };
        const onPointerMove = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            const target = tableCellElementFromPoint(event.clientX, event.clientY);
            const focusCellId = target?.dataset.cellId ?? null;
            if (!focusCellId || target?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId !== cellSelectionDrag.tableId) {
                return;
            }
            setCellSelectionDrag((current) =>
                current ? {...current, focusCellId} : current,
            );
            selectCells(focusCellId);
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            event.preventDefault();
            setCellSelectionDrag((current) => {
                if (current) selectCells(current.focusCellId);
                return null;
            });
        };
        const onPointerCancel = () => setCellSelectionDrag(null);
        window.addEventListener('pointermove', onPointerMove, {passive: false});
        window.addEventListener('pointerup', onPointerUp, {passive: false});
        window.addEventListener('pointercancel', onPointerCancel);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [cellSelectionDrag, context]);

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
                                    context.blockLevelDecorationsByBlock.get(row.block.id)?.selected
                                        ? 'blockSelected'
                                        : '',
                                    context.blockLevelDecorationsByBlock.get(row.block.id)?.focus
                                        ? 'blockSelectionFocus'
                                        : '',
                                    context.draggingSubtreeIds.has(row.block.id) ? 'dragging' : '',
                                    context.draggingId === row.block.id ? 'draggingRoot' : '',
                                    context.dropTarget?.indicatorBlockId === row.block.id
                                        ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                                        : '',
                                    cellDrag?.target?.kind === 'row-slot' &&
                                    cellDrag.target.indicatorRowId === row.block.id
                                        ? `drop${capitalize(cellDrag.target.indicatorPlacement)}`
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
                                    context.blockLevelDecorationsByBlock.get(row.block.id)?.selected
                                        ? 'blockSelected'
                                        : '',
                                    context.blockLevelDecorationsByBlock.get(row.block.id)?.focus
                                        ? 'blockSelectionFocus'
                                        : '',
                                    context.draggingSubtreeIds.has(row.block.id) ? 'dragging' : '',
                                    context.draggingId === row.block.id ? 'draggingRoot' : '',
                                    context.dropTarget?.indicatorBlockId === row.block.id
                                        ? `drop${capitalize(context.dropTarget.indicatorPlacement)}`
                                        : '',
                                    cellDrag?.target?.kind === 'row-slot' &&
                                    cellDrag.target.indicatorRowId === row.block.id
                                        ? `drop${capitalize(cellDrag.target.indicatorPlacement)}`
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
                                    const canStartCellDrag =
                                        !!cell &&
                                        cell.block.id === selectedCellId;
                                    return (
                                        <div
                                            key={`${row.block.id}:${columnIndex}`}
                                            className={[
                                                cell ? 'tableCell' : 'tableCell missingTableCell',
                                                cell &&
                                                context.blockLevelDecorationsByBlock.get(cell.block.id)
                                                    ?.selected
                                                    ? 'cellSelected'
                                                    : '',
                                                cell &&
                                                context.blockLevelDecorationsByBlock.get(cell.block.id)
                                                    ?.focus
                                                    ? 'cellSelectionFocus'
                                                    : '',
                                                cell?.block.id === selectedCellId
                                                    ? 'activeTableCell'
                                                    : '',
                                                cellDrag?.sourceCellId === cell?.block.id
                                                    ? 'draggingCell'
                                                    : '',
                                                canStartCellDrag ? 'cellDragCandidate' : '',
                                                cellDrag?.target?.kind === 'cell-slot' &&
                                                cellDrag.target.rowId === row.block.id &&
                                                cellDrag.target.index === columnIndex
                                                    ? 'cellDropBefore'
                                                    : '',
                                                cellDrag?.target?.kind === 'cell-slot' &&
                                                cellDrag.target.rowId === row.block.id &&
                                                cellDrag.target.index === columnIndex + 1
                                                    ? 'cellDropAfter'
                                                    : '',
                                                context.dropTarget?.indicatorBlockId === cell?.block.id &&
                                                context.dropTarget?.indicatorPlacement === 'before'
                                                    ? 'cellDropBefore'
                                                    : '',
                                                context.dropTarget?.indicatorBlockId === cell?.block.id &&
                                                context.dropTarget?.indicatorPlacement === 'after'
                                                    ? 'cellDropAfter'
                                                    : '',
                                                context.dropTarget?.command.type === 'table-cell-slot' &&
                                                context.dropTarget.command.target.rowId === row.block.id &&
                                                context.dropTarget.command.target.index === columnIndex
                                                    ? 'cellDropBefore'
                                                    : '',
                                                context.dropTarget?.command.type === 'table-cell-slot' &&
                                                context.dropTarget.command.target.rowId === row.block.id &&
                                                context.dropTarget.command.target.index === columnIndex + 1
                                                    ? 'cellDropAfter'
                                                    : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            role="cell"
                                            data-cell-id={cell?.block.id}
                                            tabIndex={cell ? -1 : undefined}
                                            onCopy={context.onCopy}
                                            onCut={context.onCut}
                                            onPaste={context.onPaste}
                                            onKeyDown={(event) => {
                                                if (!cell || event.target !== event.currentTarget) return;
                                                context.onKeystroke(cell.block.id, event);
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
                                                }
                                            }}
                                            onPointerDown={(event) => {
                                                if (!cell || !isCellBorderPointer(event))
                                                    return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                if (cell.block.id !== selectedCellId) {
                                                    event.currentTarget.setPointerCapture?.(event.pointerId);
                                                    setCellSelectionDrag({
                                                        tableId: node.block.id,
                                                        anchorCellId: cell.block.id,
                                                        focusCellId: cell.block.id,
                                                    });
                                                    context.focusBlockSelectionTarget({
                                                        type: 'table-cells',
                                                        tableId: node.block.id,
                                                        anchorCellId: cell.block.id,
                                                        focusCellId: cell.block.id,
                                                    });
                                                    context.runBlockControlCommand((current) => {
                                                        const selection = tableCellSelectionForCell(
                                                            current.state,
                                                            cell.block.id,
                                                        );
                                                        return {
                                                            state: current.state,
                                                            ops: [],
                                                            selection: selection
                                                                ? replaceSelectionSet(
                                                                      current.state,
                                                                      selection,
                                                                      current.selection.primaryId,
                                                                  )
                                                                : current.selection,
                                                        };
                                                    });
                                                    return;
                                                }
                                                event.currentTarget.setPointerCapture?.(event.pointerId);
                                                context.focusBlockSelectionTarget(context.selection);
                                                const selectedColumnCellIds = fullColumnSelectionCellIds(
                                                    context.state,
                                                    context.selection,
                                                    node.block.id,
                                                );
                                                const selectedRectangle = selectedTableRectangleSelection(
                                                    context.state,
                                                    context.selection,
                                                    node.block.id,
                                                ) ?? tableCellRectangleSelectionForTextSelection(
                                                    context.state,
                                                    context.selection,
                                                    node.block.id,
                                                );
                                                setCellDrag({
                                                    sourceCellId: cell.block.id,
                                                    ...(selectedColumnCellIds
                                                        ? {columnCellIds: selectedColumnCellIds}
                                                        : selectedRectangle
                                                          ? {rectangleSelection: selectedRectangle}
                                                        : {}),
                                                    target: {kind: 'cell-slot', rowId: row.block.id, index: columnIndex},
                                                });
                                            }}
                                        >
                                            {canStartCellDrag ? (
                                                <>
                                                    <span
                                                        className="tableCellDragEdge tableCellDragEdgeLeft"
                                                        aria-hidden="true"
                                                    />
                                                    <span
                                                        className="tableCellDragEdge tableCellDragEdgeRight"
                                                        aria-hidden="true"
                                                    />
                                                </>
                                            ) : null}
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
                            data-table-id={node.block.id}
                            data-after-row-id={row.block.id}
                            data-before-row-id={rowNodes[rowIndex + 1]?.block.id}
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
                onPointerDown={(event) => {
                    context.startBlockDragFromHandle(row.id, event);
                }}
            >
                ⋮
            </button>
            {renderEditableBlock({...row, depth: 0}, context, {
                variant: 'table-row-header',
                ariaLabel: `Row header ${rowIndex + 1}`,
                placeholder: `${rowIndex + 1}`,
                surfaceClassName: 'tableRowHeaderText',
                hideBlockAffordance: true,
                hideInlineControls: true,
                registerBlockRow: false,
            })}
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

const tableCellSelectionForCell = (
    state: Replica['state'],
    cellId: string,
): EditorSelection | null => {
    if (!isTableCellBlock(state, cellId)) return null;
    const rowId = lamportToString(materializedBlockParent(state, cellId, annotationVirtualParents(state)));
    const tableId = lamportToString(materializedBlockParent(state, rowId, annotationVirtualParents(state)));
    if (state.state.blocks[tableId]?.meta.type !== 'table') return null;
    return {
        type: 'table-cells',
        tableId,
        anchorCellId: cellId,
        focusCellId: cellId,
    };
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

const fullColumnSelectionCellIds = (
    state: Replica['state'],
    selection: EditorSelection,
    tableId: string,
): string[] | null => {
    if (selection.type !== 'table-cells' || selection.tableId !== tableId) return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle || rectangle.startColumnIndex !== rectangle.endColumnIndex) return null;
    const rows = tableRowsForSelection(state, tableId);
    if (
        rectangle.startRowIndex !== 0 ||
        rectangle.endRowIndex < rows.length - 1 ||
        rows.length === 0
    ) {
        return null;
    }
    const cellIds = rows
        .map((rowId) => tableCellsForSelection(state, rowId)[rectangle.startColumnIndex])
        .filter((cellId): cellId is string => Boolean(cellId));
    return cellIds.length === rows.length ? cellIds : null;
};

const selectedTableRectangleSelection = (
    state: Replica['state'],
    selection: EditorSelection,
    tableId: string,
): EditorSelection | null => {
    if (selection.type !== 'table-cells' || selection.tableId !== tableId) return null;
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle || rectangle.cellIds.length <= 1) return null;
    if (fullColumnSelectionCellIds(state, selection, tableId)) return null;
    return selection;
};

const tableCellRectangleSelectionForTextSelection = (
    state: Replica['state'],
    selection: EditorSelection,
    tableId: string,
): EditorSelection | null => {
    if (selection.type !== 'range') return null;
    const anchorCell = tableCellIdForSelection(state, {
        type: 'caret',
        point: selection.anchor,
    });
    const focusCell = tableCellIdForSelection(state, {
        type: 'caret',
        point: selection.focus,
    });
    if (!anchorCell || !focusCell || anchorCell === focusCell) return null;
    const cellSelection: EditorSelection = {
        type: 'table-cells',
        tableId,
        anchorCellId: anchorCell,
        focusCellId: focusCell,
    };
    return tableCellRectangleForSelection(state, cellSelection) ? cellSelection : null;
};

const isFocusedCellBorderDrag = (
    event: PointerEvent<HTMLDivElement>,
    selectedCellId: string | null,
): boolean => {
    if (!event.isPrimary || event.button !== 0) return false;
    const cellId = event.currentTarget.dataset.cellId ?? null;
    if (!cellId || cellId !== selectedCellId) return false;
    return isCellBorderPointer(event);
};

const isCellBorderPointer = (
    event: PointerEvent<HTMLDivElement>,
): boolean => {
    if (!event.isPrimary || event.button !== 0) return false;
    const cellId = event.currentTarget.dataset.cellId ?? null;
    if (!cellId) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = 7;
    return (
        event.clientX - rect.left <= edge ||
        rect.right - event.clientX <= edge ||
        event.clientY - rect.top <= edge ||
        rect.bottom - event.clientY <= edge
    );
};

const tableCellDragTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
    context: RenderBlockContext,
): TableCellDragTarget | null => {
    const cellSlot = tableCellSlotTargetFromPoint(clientX, clientY, tableId);
    if (cellSlot) return {kind: 'cell-slot', ...cellSlot};
    const rowSlot = tableRowSlotTargetFromPoint(clientX, clientY, tableId);
    if (rowSlot) return rowSlot;
    const blockSlot = blockDropTargetFromPoint(clientX, clientY, tableId, context);
    return blockSlot ? {kind: 'block-slot', dropTarget: blockSlot} : null;
};

const tableCellSlotTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
): TableCellSlotTarget | null => {
    if (typeof document.elementsFromPoint !== 'function') return null;
    const row = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>('[data-row-id]'))
        .find(
            (element): element is HTMLElement =>
                !!element?.dataset.rowId &&
                element.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === tableId,
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

const tableRowSlotTargetFromPoint = (
    clientX: number,
    clientY: number,
    tableId: string,
): TableCellDragTarget | null => {
    const slot =
        typeof document.elementsFromPoint === 'function'
            ? document
                  .elementsFromPoint(clientX, clientY)
                  .find(
                      (element): element is HTMLElement =>
                          element instanceof HTMLElement &&
                          element.matches('.tableRowInsertControl[data-table-id]') &&
                          element.dataset.tableId === tableId,
                  )
            : null;
    if (slot) {
        const afterRowId = slot.dataset.afterRowId ?? null;
        const beforeRowId = slot.dataset.beforeRowId ?? null;
        return {
            kind: 'row-slot',
            tableId,
            beforeRowId: afterRowId,
            afterRowId: beforeRowId,
            indicatorRowId: afterRowId ?? beforeRowId ?? tableId,
            indicatorPlacement: afterRowId ? 'after' : 'before',
        };
    }

    const table = document.querySelector<HTMLElement>(`[data-table-id="${CSS.escape(tableId)}"]`);
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll<HTMLElement>('.tableRow[data-row-id]')).filter(
        (row) => row.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === tableId,
    );
    if (!rows.length) return null;
    const rowRects = rows.map((row) => ({row, rect: row.getBoundingClientRect()}));
    const first = rowRects[0];
    const last = rowRects[rowRects.length - 1];
    const edgeBand = 8;
    if (clientY >= first.rect.top - edgeBand && clientY < first.rect.top + edgeBand) {
        const rowId = first.row.dataset.rowId;
        return rowId
            ? {
                  kind: 'row-slot',
                  tableId,
                  beforeRowId: null,
                  afterRowId: rowId,
                  indicatorRowId: rowId,
                  indicatorPlacement: 'before',
              }
            : null;
    }
    for (let index = 0; index < rowRects.length - 1; index++) {
        const before = rowRects[index];
        const after = rowRects[index + 1];
        if (clientY >= before.rect.bottom - edgeBand && clientY <= after.rect.top + edgeBand) {
            const beforeRowId = before.row.dataset.rowId;
            const afterRowId = after.row.dataset.rowId;
            return beforeRowId && afterRowId
                ? {
                      kind: 'row-slot',
                      tableId,
                      beforeRowId,
                      afterRowId,
                      indicatorRowId: beforeRowId,
                      indicatorPlacement: 'after',
                  }
                : null;
        }
    }
    if (clientY > last.rect.bottom - edgeBand && clientY <= last.rect.bottom + edgeBand) {
        const rowId = last.row.dataset.rowId;
        return rowId
            ? {
                  kind: 'row-slot',
                  tableId,
                  beforeRowId: rowId,
                  afterRowId: null,
                  indicatorRowId: rowId,
                  indicatorPlacement: 'after',
              }
            : null;
    }
    return null;
};

const tableCellElementFromPoint = (
    clientX: number,
    clientY: number,
): HTMLElement | null =>
    document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>('.tableCell[data-cell-id]'))
        .find((element): element is HTMLElement => !!element?.dataset.cellId) ?? null;

type EditableBlockRenderOptions = {
    variant?: 'block' | 'table-row-header';
    ariaLabel?: string;
    placeholder?: string;
    surfaceClassName?: string;
    hideBlockAffordance?: boolean;
    hideInlineControls?: boolean;
    hideBlockLevelDecoration?: boolean;
    registerBlockRow?: boolean;
    pollOptions?: PollOptionView[];
    matrixPoll?: MatrixPollView;
    pollEditorMode?: PollEditorMode;
    onSetPollEditorMode?(mode: PollEditorMode): void;
    onSplit?(): void;
};

const renderEditableBlock = (
    block: RichFormattedBlock,
    context: RenderBlockContext,
    options: EditableBlockRenderOptions = {},
) => {
    const index = context.blocks.findIndex((candidate) => candidate.id === block.id);
    const previousBlock = context.blocks[index - 1] ?? null;
    const nextBlock = context.blocks[index + 1] ?? null;
    return (
        <EditableBlock
            key={block.id}
            block={block}
            userId={context.userId}
            attachment={
                block.block.meta.type === 'image'
                    ? context.attachments.get(block.block.meta.attachmentId) ?? null
                    : null
            }
            variant={options.variant}
            ariaLabel={options.ariaLabel}
            placeholder={options.placeholder}
            surfaceClassName={options.surfaceClassName}
            hideBlockAffordance={options.hideBlockAffordance}
            hideInlineControls={options.hideInlineControls}
            registerBlockRow={options.registerBlockRow}
            pollOptions={options.pollOptions ?? []}
            matrixPoll={options.matrixPoll ?? {rows: [], columns: []}}
            pollEditorMode={options.pollEditorMode}
            onSetPollEditorMode={options.onSetPollEditorMode}
            isTableCell={isTableCellBlock(context.state, block.id)}
            listNumber={context.orderedListNumbers.get(block.id) ?? null}
            previousBlockId={previousBlock?.id ?? null}
            previousBlockLength={
                previousBlock ? pointTextLength(context.state, previousBlock.id) : 0
            }
            blockLength={pointTextLength(context.state, block.id)}
            charIdsByOffset={context.charIdsByBlock.get(block.id) ?? []}
            visibleBlockIdSet={context.visibleBlockIdSet}
            rainbowLamportIds={context.rainbowLamportIds}
            nextBlockId={nextBlock?.id ?? null}
            selection={context.selection}
            hasMultipleSelections={context.hasMultipleSelections}
            decorations={context.decorationsByBlock.get(block.id) ?? null}
            pendingCaretRestoreBlockIdRef={context.pendingCaretRestoreBlockIdRef}
            suppressNextFocusSelectionRef={context.suppressNextBlockFocusSelectionRef}
            suppressNextKeySelectionRef={context.suppressNextBlockKeySelectionRef}
            isDragging={context.draggingSubtreeIds.has(block.id)}
            isDraggingRoot={context.draggingId === block.id}
            blockLevelDecoration={
                options.hideBlockLevelDecoration
                    ? null
                    : context.blockLevelDecorationsByBlock.get(block.id) ?? null
            }
            dropTarget={
                context.dropTarget?.indicatorBlockId === block.id
                    ? context.dropTarget
                    : context.cellDragBlockDropTarget?.indicatorBlockId === block.id
                      ? context.cellDragBlockDropTarget
                      : null
            }
            registerRow={context.registerRow}
            onStartDrag={context.startDrag}
            onStartBlockDragFromHandle={context.startBlockDragFromHandle}
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
                    const rowHeaderResult = deleteTableRowHeaderBackward(
                        current.state,
                        selected,
                        makeCommandContext(current),
                    );
                    if (commandApplied(rowHeaderResult)) {
                        return {
                            state: rowHeaderResult.state,
                            ops: rowHeaderResult.ops,
                            selection: replacePrimarySelection(
                                rowHeaderResult.state,
                                current.selection,
                                rowHeaderResult.selection,
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
            onSplit={options.onSplit ?? (() =>
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
            )}
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
                {
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
                        const targetCellId = focusPoint(result.selection).blockId;
                        const targetCellSelection = tableCellSelectionForCell(result.state, targetCellId);
                        context.focusBlockSelectionTarget(targetCellSelection ?? result.selection);
                        return {
                            state: result.state,
                            ops: result.ops,
                            selection: replacePrimarySelection(
                                result.state,
                                current.selection,
                                targetCellSelection ?? result.selection,
                            ),
                        };
                    });
                }
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
            onPollVote={(optionId, rowId) => {
                context.runEditCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !context.userId ||
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        (
                            currentBlock.meta.kind !== 'rating' &&
                            currentBlock.meta.kind !== 'children' &&
                            currentBlock.meta.kind !== 'matrix'
                        )
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    if (currentBlock.meta.kind === 'matrix' && !rowId) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const previous = currentBlock.meta.votes[context.userId];
                    if (previous && !previous.deleted && !currentBlock.meta.allowChange) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const voteTs = nextReplicaTs(current);
                    const after: PollVote =
                        currentBlock.meta.kind === 'children' && currentBlock.meta.choiceMode === 'multiple'
                            ? {
                                  type: 'multiple',
                                  optionIds: toggleOptionId(
                                      previous?.type === 'multiple' && !previous.deleted
                                          ? previous.optionIds
                                          : [],
                                      optionId,
                                  ),
                                  ts: voteTs,
                              }
                            : currentBlock.meta.kind === 'matrix'
                              ? {
                                    type: 'matrix',
                                    answers: nextMatrixAnswers(
                                        previous?.type === 'matrix' && !previous.deleted
                                            ? previous.answers
                                            : {},
                                        rowId ?? '',
                                        optionId,
                                        currentBlock.meta.choiceMode === 'multiple',
                                    ),
                                    ts: voteTs,
                                }
                            : {type: 'single', optionId, ts: voteTs};
                    const nextMeta = {
                        ...currentBlock.meta,
                        votes: {...currentBlock.meta.votes, [context.userId]: after},
                        ts: nextReplicaTs(current),
                    };
                    const result = setBlockMeta(current.state, block.id, nextMeta);
                    const pollVote: PollVoteCommandData = {
                        blockId: block.id,
                        userId: context.userId,
                        ...(previous ? {before: previous} : {}),
                        after,
                    };
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: current.selection,
                        commandLabel: 'Vote in poll',
                        pollVote,
                    };
                });
            }}
            onPollLongAnswer={(text) => {
                context.runEditCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !context.userId ||
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        currentBlock.meta.kind !== 'long' ||
                        !text.trim()
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const previous = currentBlock.meta.votes[context.userId];
                    if (previous && !previous.deleted && !currentBlock.meta.allowChange) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const after: PollVote = {type: 'long', text, ts: nextReplicaTs(current)};
                    const nextMeta = {
                        ...currentBlock.meta,
                        votes: {...currentBlock.meta.votes, [context.userId]: after},
                        ts: nextReplicaTs(current),
                    };
                    const result = setBlockMeta(current.state, block.id, nextMeta);
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: current.selection,
                        commandLabel: 'Answer poll',
                        pollVote: {
                            blockId: block.id,
                            userId: context.userId,
                            ...(previous ? {before: previous} : {}),
                            after,
                        },
                    };
                });
            }}
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
                    const nextMeta = codeMetaWithPreviewForLanguage(
                        {
                            type: 'code',
                            language,
                            ...(currentBlock.meta.preview ? {preview: currentBlock.meta.preview} : {}),
                            ts: nextReplicaTs(current),
                        },
                        !!currentBlock.meta.preview,
                    );
                    const result = setBlockMeta(current.state, block.id, {
                        ...nextMeta,
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetCodePreview={(enabled) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'code') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(
                        current.state,
                        block.id,
                        codeMetaWithPreviewForLanguage(
                            {...currentBlock.meta, ts: nextReplicaTs(current)},
                            enabled,
                        ),
                    );
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
            onSetImageSize={(size) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'image') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        size,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetPollChoiceMode={(choiceMode) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        (currentBlock.meta.kind !== 'children' && currentBlock.meta.kind !== 'matrix')
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(
                        current.state,
                        block.id,
                        pollMetaWithChoiceMode(currentBlock.meta, choiceMode, nextReplicaTs(current)),
                    );
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetPollDisplayMode={(displayMode) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        currentBlock.meta.kind !== 'children'
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        displayMode,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetColumnsDisplay={(display) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'columns') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        display,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetPollAllowChange={(allowChange) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'poll') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        allowChange,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetRatingPollMax={(max) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        currentBlock.meta.kind !== 'rating'
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        max: normalizedRatingMax(max),
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetRatingPollPresentation={(ratingPresentation) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !currentBlock ||
                        currentBlock.meta.type !== 'poll' ||
                        currentBlock.meta.kind !== 'rating'
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        ratingPresentation,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetSlideDeckSize={(width, height) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'slide_deck') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const size = normalizeSlideDeckSize(width, height);
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        width: size.width,
                        height: size.height,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetSlideDeckFooter={(footer) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'slide_deck') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        footer,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetSlideShowTitle={(showTitle) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'slide') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        showTitle,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetSlideTransition={(transition) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'slide') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setBlockMeta(current.state, block.id, {
                        ...currentBlock.meta,
                        transition,
                        ts: nextReplicaTs(current),
                    });
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetBlockStyle={(attribute, value) =>
                context.runBlockControlCommand((current) => {
                    const result = updateBlockStyle(
                        current.state,
                        block.id,
                        attribute,
                        value,
                        makeCommandContext(current),
                    );
                    return {
                        state: result.state,
                        ops: result.ops,
                        selection: current.selection,
                        commandLabel: `Set block ${attribute}`,
                    };
                })
            }
            onSetPreviewUrl={(url) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (!currentBlock || currentBlock.meta.type !== 'preview') {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setPreviewBlockData(
                        current.state,
                        block.id,
                        url,
                        null,
                        makeCommandContext(current),
                    );
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onSetPreviewMetadata={(url, metadata) =>
                context.runBlockControlCommand((current) => {
                    const currentBlock = current.state.state.blocks[block.id];
                    if (
                        !currentBlock ||
                        currentBlock.meta.type !== 'preview' ||
                        currentBlock.meta.url !== url
                    ) {
                        return {state: current.state, ops: [], selection: current.selection};
                    }
                    const result = setPreviewBlockData(
                        current.state,
                        block.id,
                        url,
                        metadata,
                        makeCommandContext(current),
                    );
                    return {state: result.state, ops: result.ops, selection: current.selection};
                })
            }
            onCopy={context.onCopy}
            onCut={context.onCut}
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
            onInputMeasured={context.onInputMeasured}
            onDisplayInputRenderStarted={context.onDisplayInputRenderStarted}
        />
    );
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
    rainbowLamportIds,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInputMeasured,
    onDisplayInputRenderStarted,
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
    rainbowLamportIds: boolean;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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
                                        rainbowLamportIds={rainbowLamportIds}
                                        onPopoverTriggerEnter={onPopoverTriggerEnter}
                                        onPopoverTriggerLeave={onPopoverTriggerLeave}
                                        onInputMeasured={onInputMeasured}
                                        onDisplayInputRenderStarted={onDisplayInputRenderStarted}
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
    rainbowLamportIds,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInputMeasured,
    onDisplayInputRenderStarted,
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
    rainbowLamportIds: boolean;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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
                                  rainbowLamportIds={rainbowLamportIds}
                                  onPopoverTriggerEnter={onPopoverTriggerEnter}
                                  onPopoverTriggerLeave={onPopoverTriggerLeave}
                                  onInputMeasured={onInputMeasured}
                                  onDisplayInputRenderStarted={onDisplayInputRenderStarted}
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
    rainbowLamportIds,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInputMeasured,
    onDisplayInputRenderStarted,
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
    rainbowLamportIds: boolean;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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
                    rainbowLamportIds={rainbowLamportIds}
                    onPopoverTriggerEnter={onPopoverTriggerEnter}
                    onPopoverTriggerLeave={onPopoverTriggerLeave}
                    onInputMeasured={onInputMeasured}
                    onDisplayInputRenderStarted={onDisplayInputRenderStarted}
                />
            ))}
        </section>
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
    rainbowLamportIds,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInputMeasured,
    onDisplayInputRenderStarted,
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
    rainbowLamportIds: boolean;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(id?: string, transition?: PopoverPointerTransition): void;
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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
    const visibleBlockIdSet = useMemo(
        () => new Set(materializeFormattedBlocks(state, annotationVirtualParents(state)).map((item) => item.id)),
        [state],
    );

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
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
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

    const cutBodySelection = useCallback(
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
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
            run(selected, (currentState, activeSelection, context) =>
                replaceAnnotationBodySelection(currentState, activeSelection, '', context),
            );
        },
        [run, selection, state],
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
                visibleBlockIdSet={visibleBlockIdSet}
                rainbowLamportIds={rainbowLamportIds}
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
                onInputMeasured={onInputMeasured}
                onDisplayInputRenderStarted={onDisplayInputRenderStarted}
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
                onCut={cutBodySelection}
                onPaste={(event) => {
                    const selected = readSelectionFromDom(event.currentTarget) ?? selection;
                    const rich = richClipboardPayloadFromDataTransfer(event.clipboardData);
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
                        } else if (selected.type === 'caret') {
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

function EditableBlock({
    block,
    userId,
    attachment,
    pollOptions,
    matrixPoll,
    pollEditorMode,
    onSetPollEditorMode,
    variant = 'block',
    ariaLabel = 'Block text',
    placeholder,
    surfaceClassName,
    hideBlockAffordance = false,
    hideInlineControls = false,
    registerBlockRow = true,
    isTableCell,
    listNumber,
    previousBlockId,
    previousBlockLength,
    blockLength,
    charIdsByOffset,
    visibleBlockIdSet,
    rainbowLamportIds,
    nextBlockId,
    selection,
    hasMultipleSelections,
    decorations,
    pendingCaretRestoreBlockIdRef,
    suppressNextFocusSelectionRef,
    suppressNextKeySelectionRef,
    isDragging,
    isDraggingRoot,
    blockLevelDecoration,
    dropTarget,
    registerRow,
    onStartDrag,
    onStartBlockDragFromHandle,
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
    onPollVote,
    onPollLongAnswer,
    onToggleTodo,
    onSetCodeLanguage,
    onSetCodePreview,
    onSetCalloutKind,
    onSetImageSize,
    onSetPollChoiceMode,
    onSetPollDisplayMode,
    onSetColumnsDisplay,
    onSetPollAllowChange,
    onSetRatingPollMax,
    onSetRatingPollPresentation,
    onSetSlideDeckSize,
    onSetSlideDeckFooter,
    onSetSlideShowTitle,
    onSetSlideTransition,
    onSetBlockStyle,
    onSetPreviewUrl,
    onSetPreviewMetadata,
    onCopy,
    onCut,
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
    onInputMeasured,
    onDisplayInputRenderStarted,
}: {
    block: RichFormattedBlock;
    userId: string;
    attachment: ImageAttachment | null;
    pollOptions: PollOptionView[];
    matrixPoll: MatrixPollView;
    pollEditorMode?: PollEditorMode;
    onSetPollEditorMode?(mode: PollEditorMode): void;
    variant?: 'block' | 'table-row-header';
    ariaLabel?: string;
    placeholder?: string;
    surfaceClassName?: string;
    hideBlockAffordance?: boolean;
    hideInlineControls?: boolean;
    registerBlockRow?: boolean;
    isTableCell: boolean;
    listNumber: number | null;
    previousBlockId: string | null;
    previousBlockLength: number;
    blockLength: number;
    charIdsByOffset: string[];
    visibleBlockIdSet: Set<string>;
    rainbowLamportIds: boolean;
    nextBlockId: string | null;
    selection: EditorSelection;
    hasMultipleSelections: boolean;
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    suppressNextFocusSelectionRef: MutableRefObject<boolean>;
    suppressNextKeySelectionRef: MutableRefObject<boolean>;
    isDragging: boolean;
    isDraggingRoot: boolean;
    blockLevelDecoration: BlockLevelSelectionDecorations | null;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onStartBlockDragFromHandle(blockId: string, event: PointerEvent<HTMLElement>): void;
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
    onPollVote(optionId: string, rowId?: string): void;
    onPollLongAnswer(text: string): void;
    onToggleTodo(): void;
    onSetCodeLanguage(language: string): void;
    onSetCodePreview(enabled: boolean): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onSetImageSize(size: ImagePresentationSize): void;
    onSetPollChoiceMode(mode: PollChoiceMode): void;
    onSetPollDisplayMode(mode: PollDisplayMode): void;
    onSetColumnsDisplay(display: ColumnsDisplayMode): void;
    onSetPollAllowChange(allowChange: boolean): void;
    onSetRatingPollMax(max: number): void;
    onSetRatingPollPresentation(presentation: PollRatingPresentation): void;
    onSetSlideDeckSize(width: number, height: number): void;
    onSetSlideDeckFooter(footer: SlideDeckFooterMode): void;
    onSetSlideShowTitle(showTitle: boolean): void;
    onSetSlideTransition(transition: SlideTransition): void;
    onSetBlockStyle(attribute: RichBlockStyleAttribute, value: string | null): void;
    onSetPreviewUrl(url: string): void;
    onSetPreviewMetadata(url: string, metadata: PreviewMetadata | null): void;
    onCopy(event: ClipboardEvent<HTMLElement>): void;
    onCut(event: ClipboardEvent<HTMLElement>): void;
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
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
}) {
    const meta = block.block.meta;
    const isCodeBlock = meta.type === 'code';
    const isPlainTextCodeLikeBlock = meta.type === 'code';
    const codeLikeHasTrailingNewline =
        isPlainTextCodeLikeBlock &&
        block.runs
            .map((run) => run.text)
            .join('')
            .endsWith('\n');
    const codeText = isCodeBlock ? block.runs.map((run) => run.text).join('') : '';
    const codeLanguage = isCodeBlock ? meta.language : '';
    const blockText = block.runs.map((run) => run.text).join('');
    const blockStyle = blockStyleProps(block.block.style);
    const syntaxTokens = useMemo(
        () => (isCodeBlock ? highlightCode(codeText, codeLanguage) : undefined),
        [codeLanguage, codeText, isCodeBlock],
    );
    const ingredientTokens = useMemo(
        () => (meta.type === 'recipe_ingredient' ? highlightIngredientLine(blockText) : undefined),
        [blockText, meta.type],
    );
    const editableSurface = (
        <RichTextEditableSurface
            blockId={block.id}
            runs={block.runs}
            charIdsByOffset={charIdsByOffset}
            visibleBlockIdSet={visibleBlockIdSet}
            rainbowLamportIds={rainbowLamportIds}
            decorations={decorations}
            pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
            suppressNextFocusSelectionRef={suppressNextFocusSelectionRef}
            suppressNextKeySelectionRef={suppressNextKeySelectionRef}
            selection={selection}
            className={[
                'editableBlock',
                isPlainTextCodeLikeBlock ? 'codeBlock' : '',
                isPreviewableCodeMeta(meta) ? 'previewCodeEditor' : '',
                meta.type === 'heading' ? `headingLevel${meta.level}` : '',
                meta.type === 'image' ? 'imageCaption' : '',
                meta.type === 'recipe_ingredient' ? 'recipeIngredientBlock' : '',
                surfaceClassName ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            trailingCodeNewline={codeLikeHasTrailingNewline}
            syntaxTokens={syntaxTokens}
            ingredientTokens={ingredientTokens}
            popoverTextById={popoverTextById}
            footnoteNumberById={footnoteNumberById}
            onPopoverTriggerEnter={onPopoverTriggerEnter}
            onPopoverTriggerLeave={onPopoverTriggerLeave}
            onLinkHoverEnter={onLinkHoverEnter}
            onLinkHoverLeave={onLinkHoverLeave}
            onCodeHoverEnter={onCodeHoverEnter}
            onCodeHoverLeave={onCodeHoverLeave}
            onInlineEmbedOpen={onInlineEmbedOpen}
            onInputMeasured={onInputMeasured}
            onDisplayInputRenderStarted={onDisplayInputRenderStarted}
            onInsertText={onInsertText}
            onDeleteBackward={onDeleteBackward}
            onDeleteForward={onDeleteForward}
            onCopy={onCopy}
            onCut={onCut}
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
                    } else if (isPlainTextCodeLikeBlock) {
                        onSplit();
                    } else if (isTableCell && !event.shiftKey && meta.type !== 'image') {
                        onAdvanceFromTableCellEnd(
                            readSelectionFromDom(event.currentTarget) ??
                                caret(block.id, blockLength),
                        );
                    } else {
                        onSplit();
                    }
                } else if (event.key === 'Tab' && !event.altKey && !modifierPressed) {
                    event.preventDefault();
                    if (isPlainTextCodeLikeBlock) {
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
    );

    return (
        <div
            ref={(element) => {
                if (registerBlockRow) registerRow(block.id, element);
            }}
            className={[
                'blockRow',
                hideBlockAffordance ? 'blockRowNoAffordance' : '',
                variant === 'table-row-header' ? 'tableRowHeaderBlock' : '',
                `blockType-${meta.type}`,
                meta.type === 'callout' ? `callout${capitalize(meta.kind)}` : '',
                blockLevelDecoration?.selected ? 'blockSelected' : '',
                blockLevelDecoration?.focus ? 'blockSelectionFocus' : '',
                isDragging ? 'dragging' : '',
                isDraggingRoot ? 'draggingRoot' : '',
                dropTarget ? `drop${capitalize(dropTarget.indicatorPlacement)}` : '',
                dropTarget?.command.type === 'child' && dropTarget.command.parentBlockId === block.id
                    ? 'dropChildTarget'
                    : '',
            ]
                .filter(Boolean)
                .join(' ')}
            style={
                {
                    '--block-depth': block.depth,
                    '--drop-depth': dropTarget?.indicatorDepth ?? block.depth,
                    '--drop-offset': `${((dropTarget?.indicatorDepth ?? block.depth) - block.depth) * 24}px`,
                    ...blockStyle,
                } as CSSProperties
            }
        >
            {!isTableCell && !hideBlockAffordance && (
                <BlockAffordance
                    blockId={block.id}
                    meta={meta}
                    listNumber={listNumber}
                    onStartDrag={onStartDrag}
                    onStartBlockDragFromHandle={onStartBlockDragFromHandle}
                    onToggleTodo={onToggleTodo}
                />
            )}
            {meta.type === 'image' ? (
                <figure className={`imageBlock imageSize-${meta.size}`}>
                    <ImagePreview attachment={attachment} attachmentId={meta.attachmentId} />
                    <figcaption>{editableSurface}</figcaption>
                </figure>
            ) : meta.type === 'preview' ? (
                <PreviewBlockCard
                    meta={meta}
                    subtitle={editableSurface}
                    onSetUrl={onSetPreviewUrl}
                    onSetMetadata={onSetPreviewMetadata}
                />
            ) : meta.type === 'poll' ? (
                <PollBlock
                    meta={meta}
                    userId={userId}
                    question={editableSurface}
                    childOptions={pollOptions}
                    matrixPoll={matrixPoll}
                    editorMode={pollEditorMode}
                    onSetEditorMode={onSetPollEditorMode}
                    onVote={onPollVote}
                    onLongAnswer={onPollLongAnswer}
                />
            ) : isPreviewableCodeMeta(meta) ? (
                <PreviewableCodeBlock
                    blockId={block.id}
                    previewKind={meta.preview}
                    source={blockText}
                    editor={editableSurface}
                />
            ) : (
                editableSurface
            )}
            {!hideInlineControls && (
                <BlockOptions
                    meta={meta}
                    style={block.block.style}
                    onSetCodeLanguage={onSetCodeLanguage}
                    onSetCodePreview={onSetCodePreview}
                    onSetCalloutKind={onSetCalloutKind}
                    onSetImageSize={onSetImageSize}
                    onSetPollChoiceMode={onSetPollChoiceMode}
                    onSetPollDisplayMode={onSetPollDisplayMode}
                    onSetColumnsDisplay={onSetColumnsDisplay}
                    onSetPollAllowChange={onSetPollAllowChange}
                    onSetRatingPollMax={onSetRatingPollMax}
                    onSetRatingPollPresentation={onSetRatingPollPresentation}
                    onSetSlideDeckSize={onSetSlideDeckSize}
                    onSetSlideDeckFooter={onSetSlideDeckFooter}
                    onSetSlideShowTitle={onSetSlideShowTitle}
                    onSetSlideTransition={onSetSlideTransition}
                    onSetBlockStyle={onSetBlockStyle}
                />
            )}
        </div>
    );
}

function PollBlock({
    meta,
    userId,
    question,
    childOptions,
    matrixPoll,
    editorMode,
    onSetEditorMode,
    onVote,
    onLongAnswer,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    childOptions: PollOptionView[];
    matrixPoll: MatrixPollView;
    editorMode?: PollEditorMode;
    onSetEditorMode?(mode: PollEditorMode): void;
    onVote(optionId: string, rowId?: string): void;
    onLongAnswer(text: string): void;
}) {
    if (meta.kind === 'long') {
        return (
            <LongAnswerPollBlock
                meta={meta}
                userId={userId}
                question={question}
                onAnswer={onLongAnswer}
            />
        );
    }
    if (meta.kind === 'matrix') {
        return (
            <MatrixPollBlock
                meta={meta}
                userId={userId}
                question={question}
                matrixPoll={matrixPollWithArchivedOptions(meta, matrixPoll)}
                editorMode={editorMode ?? 'view'}
                onSetEditorMode={onSetEditorMode}
                onVote={onVote}
            />
        );
    }
    if (meta.kind !== 'rating' && meta.kind !== 'children') {
        return <div className="pollBlock">{question}</div>;
    }
    const options: PollOptionView[] =
        meta.kind === 'rating'
            ? ratingOptionIds(meta).map((id) => ({id, label: id}))
            : childPollOptions(meta, childOptions);
    const optionIds = options.map((option) => option.id);
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const selectedOptionIds = selectedPollOptionIds(userVote);
    const results = meta.kind === 'rating' ? singleChoiceResults(meta, optionIds) : choiceResults(meta, optionIds);
    const resultsByOption = new Map(results.map((result) => [result.optionId, result]));
    const canVote = Boolean(userId) && (!userVote || meta.allowChange);
    const showResults = Boolean(userVote);
    const multiple = meta.kind === 'children' && meta.choiceMode === 'multiple';
    const displayMode = meta.kind === 'children' ? meta.displayMode ?? 'inline' : 'inline';
    const useResultBackground =
        showResults && (meta.kind === 'rating' || displayMode === 'inline');
    const modeToggle =
        meta.kind === 'children' && onSetEditorMode ? (
            <PollEditorModeToggle mode={editorMode ?? 'view'} onSetMode={onSetEditorMode} />
        ) : null;

    if (meta.kind === 'rating' && meta.ratingPresentation === 'stars') {
        return (
            <div className="pollBlock">
                {question}
                <div className="pollControls" contentEditable={false}>
                    <RatingStars
                        userVote={userVote}
                        canVote={canVote}
                        showResults={showResults}
                        resultsByOption={resultsByOption}
                        max={Number.isInteger(meta.max) ? meta.max ?? 5 : 5}
                        onVote={onVote}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="pollBlock">
            {question}
            {modeToggle}
            {(editorMode ?? 'view') === 'view' ? (
                <div className="pollControls" contentEditable={false}>
                    <div
                        className={['pollOptions', `pollOptions-${displayMode}`].join(' ')}
                        role={multiple ? 'group' : 'radiogroup'}
                        aria-label="Poll options"
                    >
                        {options.map((option) => {
                            const result = resultsByOption.get(option.id);
                            const selected = selectedOptionIds.has(option.id);
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={[
                                        'pollOption',
                                        selected ? 'selected' : '',
                                        option.archived ? 'archived' : '',
                                        useResultBackground ? 'pollResultBackground' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    aria-pressed={selected}
                                    disabled={!canVote}
                                    data-poll-result={
                                        useResultBackground
                                            ? pollResultTitle(result)
                                            : undefined
                                    }
                                    style={
                                        useResultBackground
                                            ? pollResultBackgroundStyle(result, selected)
                                            : undefined
                                    }
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onVote(option.id)}
                                >
                                    <span>{option.label}</span>
                                    {showResults && !useResultBackground ? (
                                        <span className="pollResult">
                                            {result?.percentage ?? 0}% · {result?.count ?? 0}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function PollEditorModeToggle({
    mode,
    onSetMode,
}: {
    mode: PollEditorMode;
    onSetMode(mode: PollEditorMode): void;
}) {
    return (
        <div className="pollEditorMode" contentEditable={false} aria-label="Poll editor mode">
            {(['view', 'edit'] as const).map((option) => (
                <button
                    key={option}
                    type="button"
                    className={[
                        'pollEditorModeButton',
                        mode === option ? 'selected' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    aria-label={`${capitalize(option)} poll`}
                    aria-pressed={mode === option}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSetMode(option)}
                >
                    {capitalize(option)}
                </button>
            ))}
        </div>
    );
}

function RatingStars({
    userVote,
    canVote,
    showResults,
    resultsByOption,
    max,
    onVote,
}: {
    userVote: PollVote | null;
    canVote: boolean;
    showResults: boolean;
    resultsByOption: Map<string, PollResult>;
    max: number;
    onVote(optionId: string): void;
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const selected = userVote?.type === 'single' ? Number(userVote.optionId) : 0;
    const active = hovered ?? (Number.isInteger(selected) ? selected : 0);
    const starValues = Array.from({length: normalizedRatingMax(max)}, (_, index) => index + 1);

    return (
        <div
            className="ratingStars"
            role="radiogroup"
            aria-label="Poll options"
            onMouseLeave={() => setHovered(null)}
        >
            {starValues.map((value) => {
                const selectedValue = selected === value;
                const result = resultsByOption.get(String(value));
                return (
                    <button
                        key={value}
                        type="button"
                        className={[
                            'ratingStar',
                            value <= active ? 'lit' : '',
                            selectedValue ? 'selected' : '',
                            showResults ? 'pollResultBackground' : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
                        aria-pressed={selectedValue}
                        disabled={!canVote}
                        data-poll-result={showResults ? pollResultTitle(result) : undefined}
                        style={
                            showResults
                                ? pollResultBackgroundStyle(result, selectedValue)
                                : undefined
                        }
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHovered(value)}
                        onFocus={() => setHovered(value)}
                        onBlur={() => setHovered(null)}
                        onClick={() => onVote(String(value))}
                    >
                        ★
                    </button>
                );
            })}
        </div>
    );
}

const selectedPollOptionIds = (vote: PollVote | null): Set<string> => {
    if (!vote) return new Set();
    if (vote.type === 'single') return new Set([vote.optionId]);
    if (vote.type === 'multiple') return new Set(vote.optionIds);
    return new Set();
};

const childPollOptions = (meta: PollMeta, childOptions: PollOptionView[]): PollOptionView[] => {
    const activeIds = new Set(childOptions.map((option) => option.id));
    const archived = votedOptionIds(meta)
        .filter((id) => !activeIds.has(id))
        .map((id) => ({id, label: 'Deleted option', archived: true}));
    return [...childOptions, ...archived];
};

const toggleOptionId = (optionIds: string[], optionId: string): string[] =>
    optionIds.includes(optionId)
        ? optionIds.filter((id) => id !== optionId)
        : [...optionIds, optionId];

const normalizedRatingMax = (max: number): number => {
    const normalizedMax = Number.isFinite(max) ? Math.trunc(max) : 5;
    return Math.max(1, Math.min(10, normalizedMax));
};

const pollResultTitle = (result: PollResult | undefined): string =>
    result && result.voterIds.length > 0
        ? `${result.percentage}% · ${result.count} ${result.count === 1 ? 'vote' : 'votes'} · ${result.voterIds.join(', ')}`
        : result
          ? `${result.percentage}% · ${result.count} ${result.count === 1 ? 'vote' : 'votes'}`
          : '0% · 0 votes';

const pollResultBackgroundStyle = (
    result: PollResult | undefined,
    selected = false,
): CSSProperties => {
    const percentage = Math.max(0, Math.min(100, result?.percentage ?? 0));
    return {
        '--poll-result-fill': `${percentage}%`,
        '--poll-result-base': selected ? '#eef6fb' : '#fff',
    } as CSSProperties;
};

function MatrixPollBlock({
    meta,
    userId,
    question,
    matrixPoll,
    editorMode,
    onSetEditorMode,
    onVote,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    matrixPoll: MatrixPollView;
    editorMode: PollEditorMode;
    onSetEditorMode?(mode: PollEditorMode): void;
    onVote(optionId: string, rowId?: string): void;
}) {
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const matrixVote = userVote?.type === 'matrix' ? userVote : null;
    const canVote = Boolean(userId) && (!userVote || meta.allowChange);
    const showResults = Boolean(matrixVote);
    const multiple = meta.choiceMode === 'multiple';
    const results = matrixPollResults(meta, matrixPoll.rows.map((row) => row.id), matrixPoll.columns.map((column) => column.id));

    return (
        <div className="pollBlock">
            {question}
            {onSetEditorMode ? (
                <PollEditorModeToggle mode={editorMode} onSetMode={onSetEditorMode} />
            ) : null}
            {editorMode === 'view' ? (
                <div className="pollControls matrixPollControls" contentEditable={false}>
                    <div
                        className="matrixPollGrid"
                        style={{'--matrix-columns': matrixPoll.columns.length} as CSSProperties}
                    >
                        <div className="matrixPollCorner" />
                        {matrixPoll.columns.map((column) => (
                            <div
                                key={column.id}
                                className={
                                    column.archived
                                        ? 'matrixPollHeader archived'
                                        : 'matrixPollHeader'
                                }
                            >
                                {column.label}
                            </div>
                        ))}
                        {matrixPoll.rows.map((row) => (
                            <Fragment key={row.id}>
                                <div
                                    className={
                                        row.archived
                                            ? 'matrixPollRowLabel archived'
                                            : 'matrixPollRowLabel'
                                    }
                                >
                                    {row.label}
                                </div>
                                {matrixPoll.columns.map((column) => {
                                    const selected = matrixVote
                                        ? matrixAnswerSelected(matrixVote.answers[row.id], column.id)
                                        : false;
                                    const result = results.get(row.id)?.get(column.id);
                                    return (
                                        <button
                                            key={column.id}
                                            type="button"
                                            className={[
                                                'matrixPollCell',
                                                selected ? 'selected' : '',
                                                showResults ? 'pollResultBackground' : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                            aria-pressed={selected}
                                            disabled={!canVote}
                                            data-poll-result={
                                                showResults
                                                    ? pollResultTitle(result)
                                                    : undefined
                                            }
                                            style={
                                                showResults
                                                    ? pollResultBackgroundStyle(result, selected)
                                                    : undefined
                                            }
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => onVote(column.id, row.id)}
                                        >
                                            <span>
                                                {multiple
                                                    ? selected
                                                        ? '✓'
                                                        : '+'
                                                    : selected
                                                      ? '●'
                                                      : '○'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function LongAnswerPollBlock({
    meta,
    userId,
    question,
    onAnswer,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    onAnswer(text: string): void;
}) {
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const userText = userVote?.type === 'long' ? userVote.text : '';
    const [draft, setDraft] = useState(userText);
    useEffect(() => setDraft(userText), [userText]);
    const canSubmit = Boolean(userId) && (!userVote || meta.allowChange) && draft.trim().length > 0;
    const showResponses = Boolean(userVote);
    const responses = Object.entries(activePollVotes(meta))
        .filter(([, vote]) => vote.type === 'long' && vote.text.trim().length > 0)
        .map(([responseUserId, vote]) => ({userId: responseUserId, text: vote.type === 'long' ? vote.text : ''}));

    return (
        <div className="pollBlock">
            {question}
            <div className="pollControls longPollControls" contentEditable={false}>
                {(!userVote || meta.allowChange) ? (
                    <div className="longPollComposer">
                        <textarea
                            value={draft}
                            rows={3}
                            disabled={!userId}
                            onChange={(event) => setDraft(event.currentTarget.value)}
                        />
                        <button
                            type="button"
                            disabled={!canSubmit}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onAnswer(draft)}
                        >
                            Submit
                        </button>
                    </div>
                ) : null}
                {showResponses ? (
                    <div className="longPollResponses">
                        {responses.map((response) => (
                            <div key={response.userId} className="longPollResponse">
                                <span>{response.userId}</span>
                                <p>{response.text}</p>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

const nextMatrixAnswers = (
    answers: Record<string, string | string[]>,
    rowId: string,
    columnId: string,
    multiple: boolean,
): Record<string, string | string[]> => {
    if (!multiple) return {...answers, [rowId]: columnId};
    const current = answers[rowId];
    const currentIds = Array.isArray(current) ? current : typeof current === 'string' ? [current] : [];
    return {...answers, [rowId]: toggleOptionId(currentIds, columnId)};
};

const matrixAnswerSelected = (answer: string | string[] | undefined, columnId: string): boolean =>
    Array.isArray(answer) ? answer.includes(columnId) : answer === columnId;

const matrixPollWithArchivedOptions = (meta: PollMeta, matrixPoll: MatrixPollView): MatrixPollView => {
    const rowIds = new Set(matrixPoll.rows.map((row) => row.id));
    const columnIds = new Set(matrixPoll.columns.map((column) => column.id));
    const archivedRows = new Set<string>();
    const archivedColumns = new Set<string>();
    for (const vote of Object.values(activePollVotes(meta))) {
        if (vote.type !== 'matrix') continue;
        for (const [rowId, answer] of Object.entries(vote.answers)) {
            if (!rowIds.has(rowId)) archivedRows.add(rowId);
            const answers = Array.isArray(answer) ? answer : [answer];
            for (const columnId of answers) {
                if (!columnIds.has(columnId)) archivedColumns.add(columnId);
            }
        }
    }
    return {
        rows: [
            ...matrixPoll.rows,
            ...[...archivedRows].map((id) => ({id, label: 'Deleted row', archived: true})),
        ],
        columns: [
            ...matrixPoll.columns,
            ...[...archivedColumns].map((id) => ({id, label: 'Deleted column', archived: true})),
        ],
    };
};

function RichTextEditableSurfaceInner({
    blockId,
    runs,
    charIdsByOffset,
    visibleBlockIdSet = new Set(),
    rainbowLamportIds,
    decorations,
    pendingCaretRestoreBlockIdRef,
    pendingSelectionRestoreRef,
    suppressNextFocusSelectionRef,
    suppressNextKeySelectionRef,
    selection,
    className,
    ariaLabel,
    placeholder,
    trailingCodeNewline = false,
    syntaxTokens,
    ingredientTokens,
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
    onInputMeasured,
    onDisplayInputRenderStarted,
    onKeyDown,
    onCopy,
    onCut,
    onPaste,
    activeMathSourceKey,
    setActiveMathSourceKey,
    mathRenderVersion,
    mathRenderer,
}: {
    blockId: string;
    runs: RichFormattedBlock['runs'];
    charIdsByOffset: string[];
    visibleBlockIdSet?: Set<string>;
    rainbowLamportIds: boolean;
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    pendingSelectionRestoreRef?: MutableRefObject<EditorSelection | null>;
    suppressNextFocusSelectionRef?: MutableRefObject<boolean>;
    suppressNextKeySelectionRef?: MutableRefObject<boolean>;
    selection: EditorSelection;
    className: string;
    ariaLabel: string;
    placeholder?: string;
    trailingCodeNewline?: boolean;
    syntaxTokens?: SyntaxToken[];
    ingredientTokens?: IngredientHighlightToken[];
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
    onInputMeasured?(label: string, ms: number): void;
    onDisplayInputRenderStarted?(label: string, started: number): void;
    onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
    onCopy?(event: ClipboardEvent<HTMLDivElement>): void;
    onCut?(event: ClipboardEvent<HTMLDivElement>): void;
    onPaste?(event: ClipboardEvent<HTMLDivElement>): void;
    activeMathSourceKey: string | null;
    setActiveMathSourceKey(value: string | null): void;
    mathRenderVersion: number;
    mathRenderer: MathRenderer | null;
}) {
    const handledBeforeInputRef = useRef(false);
    const editableRef = useRef<HTMLDivElement>(null);
    const renderedRunsRef = useRef('');
    const pendingMathSourceRestoreRef = useRef<EditorSelection | null>(null);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;

        const onBeforeInput = (event: InputEvent) => {
            if (event.isComposing) return;
            const selection = readSelectionFromDom(element) ?? undefined;
            if (event.inputType === 'insertText' && event.data) {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                measureTextInput(
                    onInputMeasured,
                    onDisplayInputRenderStarted,
                    event.data,
                    () => onInsertText(event.data ?? '', selection),
                );
            } else if (event.inputType === 'deleteContentBackward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                measureInput(onInputMeasured, 'Backspace', () => onDeleteBackward(selection));
            } else if (event.inputType === 'deleteContentForward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                measureInput(onInputMeasured, 'Delete', () => onDeleteForward(selection));
            } else if (event.inputType === 'deleteByCut') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                measureInput(onInputMeasured, 'Cut', () => onDeleteBackward(selection));
            }
        };

        element.addEventListener('beforeinput', onBeforeInput);
        return () => element.removeEventListener('beforeinput', onBeforeInput);
    }, [
        onDeleteBackward,
        onDeleteForward,
        onDisplayInputRenderStarted,
        onInputMeasured,
        onInsertText,
    ]);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;
        const renderedRuns = serializeRuns(
            runs,
            charIdsByOffset,
            rainbowLamportIds,
            decorations,
            trailingCodeNewline,
            footnoteNumberById,
            syntaxTokens,
            ingredientTokens,
            visibleBlockIdSet,
            selection,
            activeMathSourceKey,
            mathRenderVersion,
        );
        if (renderedRunsRef.current !== renderedRuns) {
            renderedRunsRef.current = renderedRuns;
            element.replaceChildren(
                ...renderRunNodes(runs, decorations, {
                    blockId,
                    charIdsByOffset,
                    rainbowLamportIds,
                    trailingCodeNewline,
                    syntaxTokens,
                    ingredientTokens,
                    visibleBlockIdSet,
                    popoverTextById,
                    footnoteNumberById,
                    selection,
                    activeMathSourceKey,
                    mathRenderer,
                }),
            );
        }
        const pendingMathSelection = pendingMathSourceRestoreRef.current;
        if (pendingMathSelection) {
            pendingMathSourceRestoreRef.current = null;
            if (document.activeElement !== element) element.focus();
            if (pendingMathSelection.type === 'caret') {
                restoreCaretToDom(element, pendingMathSelection.point);
            } else if (pendingMathSelection.type === 'range') {
                restoreSelectionToDom(element, pendingMathSelection);
            }
        }
        const point = selection.type === 'caret' ? selection.point : null;
        if (point?.blockId === blockId && pendingCaretRestoreBlockIdRef.current === blockId) {
            pendingCaretRestoreBlockIdRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreCaretToDom(element, point);
        }
        const rangeSelection = pendingSelectionRestoreRef?.current;
        if (pendingSelectionRestoreRef && rangeSelection?.type === 'range') {
            pendingSelectionRestoreRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreSelectionToDom(element, rangeSelection);
        }
    }, [
        blockId,
        charIdsByOffset,
        decorations,
        footnoteNumberById,
        ingredientTokens,
        activeMathSourceKey,
        mathRenderVersion,
        mathRenderer,
        pendingCaretRestoreBlockIdRef,
        pendingSelectionRestoreRef,
        popoverTextById,
        rainbowLamportIds,
        runs,
        selection,
        syntaxTokens,
        trailingCodeNewline,
        visibleBlockIdSet,
    ]);

    useEffect(() => {
        if (!activeMathSourceKey) return;
        if (selection.type === 'caret') {
            const range = mathRangeFromSourceKey(activeMathSourceKey);
            if (
                range &&
                selection.point.blockId === range.blockId &&
                selection.point.offset >= range.startOffset &&
                selection.point.offset <= range.endOffset
            ) {
                return;
            }
        }
        setActiveMathSourceKey(null);
    }, [activeMathSourceKey, selection]);

    return (
        <div
            ref={editableRef}
            className={className}
            contentEditable
            role="textbox"
            aria-label={ariaLabel}
            suppressContentEditableWarning
            spellCheck
            id={blockDomIdForBlockId(blockId)}
            data-block-id={blockId}
            data-empty={runs.length === 0 ? 'true' : undefined}
            data-placeholder={placeholder ?? '...'}
            data-trailing-newline={trailingCodeNewline ? 'true' : undefined}
            onFocus={(event) => {
                if (suppressNextFocusSelectionRef?.current) {
                    suppressNextFocusSelectionRef.current = false;
                } else {
                    onSelectionChange?.(readSelectionFromDom(event.currentTarget));
                }
                const nextDecorations = removePrimaryDecorations(decorations);
                if (nextDecorations === decorations) return;
                event.currentTarget.replaceChildren(
                    ...renderRunNodes(runs, nextDecorations, {
                        blockId,
                        charIdsByOffset,
                        rainbowLamportIds,
                        trailingCodeNewline,
                        syntaxTokens,
                        ingredientTokens,
                        visibleBlockIdSet,
                        popoverTextById,
                        footnoteNumberById,
                        selection,
                        activeMathSourceKey,
                        mathRenderer,
                    }),
                );
                renderedRunsRef.current = serializeRuns(
                    runs,
                    charIdsByOffset,
                    rainbowLamportIds,
                    nextDecorations,
                    trailingCodeNewline,
                    footnoteNumberById,
                    syntaxTokens,
                    ingredientTokens,
                    visibleBlockIdSet,
                    selection,
                    activeMathSourceKey,
                    mathRenderVersion,
                );
            }}
            onMouseUp={(event) => onSelectionChange?.(readSelectionFromDom(event.currentTarget))}
            onKeyUp={(event) => {
                if (suppressNextKeySelectionRef?.current) {
                    suppressNextKeySelectionRef.current = false;
                    event.stopPropagation();
                    return;
                }
                onSelectionChange?.(readSelectionFromDom(event.currentTarget));
            }}
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
                const mathTrigger = mathPreviewFromEvent(event.currentTarget, event.target);
                if (mathTrigger?.dataset.mathStartOffset && mathTrigger.dataset.mathEndOffset && mathTrigger.dataset.mathMode) {
                    event.preventDefault();
                    const startOffset = Number(mathTrigger.dataset.mathStartOffset);
                    const endOffset = Number(mathTrigger.dataset.mathEndOffset);
                    const mode = mathTrigger.dataset.mathMode === 'display' ? 'display' : 'inline';
                    const nextSelection = caret(blockId, startOffset);
                    setActiveMathSourceKey(mathSourceKey(blockId, startOffset, endOffset, mode));
                    pendingMathSourceRestoreRef.current = nextSelection;
                    onSelectionChange?.(nextSelection);
                    return;
                }
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
                            rainbowLamportIds,
                            trailingCodeNewline,
                            syntaxTokens,
                            ingredientTokens,
                            visibleBlockIdSet,
                            popoverTextById,
                            footnoteNumberById,
                            selection,
                            activeMathSourceKey,
                            mathRenderer,
                        }),
                    );
                    return;
                }
                if (native.isComposing) return;
                if (isJsdom() && native.inputType === 'insertText' && native.data) {
                    measureTextInput(
                        onInputMeasured,
                        onDisplayInputRenderStarted,
                        native.data,
                        () => onInsertText(
                            native.data ?? '',
                            readSelectionFromDom(event.currentTarget) ?? undefined,
                        ),
                    );
                }
            }}
            onKeyDown={(event) => {
                if (!onKeyDown) return;
                const started = performance.now();
                onKeyDown(event);
                if (!event.defaultPrevented) return;
                onInputMeasured?.(keyboardEventLabel(event), performance.now() - started);
            }}
            onCopy={onCopy}
            onCut={(event) => {
                if (!onCut) return;
                measureInput(onInputMeasured, 'Cut', () => onCut(event));
                if (event.defaultPrevented) event.stopPropagation();
            }}
            onPaste={(event) => {
                if (!onPaste) return;
                measureInput(onInputMeasured, 'Paste', () => onPaste(event));
            }}
        />
    );
}

type RichTextEditableSurfaceProps = Omit<
    Parameters<typeof RichTextEditableSurfaceInner>[0],
    'activeMathSourceKey' | 'setActiveMathSourceKey' | 'mathRenderVersion' | 'mathRenderer'
>;

function RichTextEditableSurface(props: RichTextEditableSurfaceProps) {
    if (blockHasMathRuns(props.runs)) {
        return <MathRichTextEditableSurface {...props} />;
    }
    return (
        <RichTextEditableSurfaceInner
            {...props}
            activeMathSourceKey={null}
            setActiveMathSourceKey={() => {}}
            mathRenderVersion={0}
            mathRenderer={null}
        />
    );
}

function MathRichTextEditableSurface(props: RichTextEditableSurfaceProps) {
    const [activeMathSourceKey, setActiveMathSourceKey] = useState<string | null>(null);
    const [mathRenderVersion, setMathRenderVersion] = useState(0);
    const mathRendererRef = useRef<MathRenderer | null>(null);
    if (!mathRendererRef.current) {
        mathRendererRef.current = new BrowserMathJaxRenderer(() =>
            setMathRenderVersion((version) => version + 1),
        );
    }

    return (
        <RichTextEditableSurfaceInner
            {...props}
            activeMathSourceKey={activeMathSourceKey}
            setActiveMathSourceKey={setActiveMathSourceKey}
            mathRenderVersion={mathRenderVersion}
            mathRenderer={mathRendererRef.current}
        />
    );
}

function BlockAffordance({
    blockId,
    meta,
    listNumber,
    onStartDrag,
    onStartBlockDragFromHandle,
    onToggleTodo,
}: {
    blockId: string;
    meta: RichBlockMeta;
    listNumber: number | null;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onStartBlockDragFromHandle(blockId: string, event: PointerEvent<HTMLElement>): void;
    onToggleTodo(): void;
}) {
    const selectAndStartDrag = (event: PointerEvent<HTMLElement>) => {
        onStartBlockDragFromHandle(blockId, event);
    };

    if (meta.type === 'list_item') {
        return (
            <button
                type="button"
                className="blockAffordance blockAffordanceButton blockAffordanceMarker"
                aria-label="Move block"
                onPointerDown={selectAndStartDrag}
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
                    selectAndStartDrag(event);
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
                    onPointerDown={selectAndStartDrag}
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
    if (meta.type === 'recipe_ingredient') {
        return (
            <button
                type="button"
                className="blockAffordance blockAffordanceButton blockAffordanceIngredient"
                aria-label="Move block"
                onPointerDown={selectAndStartDrag}
            >
                🥕
            </button>
        );
    }
    return (
        <button
            type="button"
            className="blockAffordance blockAffordanceButton blockAffordanceHandle"
            aria-label="Move block"
            onPointerDown={selectAndStartDrag}
        >
            ⋮⋮
        </button>
    );
}

function BlockOptions({
    className,
    meta,
    style,
    onSetCodeLanguage,
    onSetCodePreview,
    onSetCalloutKind,
    onSetImageSize,
    onSetPollChoiceMode,
    onSetPollDisplayMode,
    onSetColumnsDisplay,
    onSetPollAllowChange,
    onSetRatingPollMax,
    onSetRatingPollPresentation,
    onSetSlideDeckSize,
    onSetSlideDeckFooter,
    onSetSlideShowTitle,
    onSetSlideTransition,
    onSetBlockStyle,
}: {
    className?: string;
    meta: RichBlockMeta;
    style?: BlockStyle;
    onSetCodeLanguage(language: string): void;
    onSetCodePreview(enabled: boolean): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onSetImageSize(size: ImagePresentationSize): void;
    onSetPollChoiceMode(mode: PollChoiceMode): void;
    onSetPollDisplayMode(mode: PollDisplayMode): void;
    onSetColumnsDisplay(display: ColumnsDisplayMode): void;
    onSetPollAllowChange(allowChange: boolean): void;
    onSetRatingPollMax(max: number): void;
    onSetRatingPollPresentation(presentation: PollRatingPresentation): void;
    onSetSlideDeckSize(width: number, height: number): void;
    onSetSlideDeckFooter(footer: SlideDeckFooterMode): void;
    onSetSlideShowTitle(showTitle: boolean): void;
    onSetSlideTransition(transition: SlideTransition): void;
    onSetBlockStyle(attribute: RichBlockStyleAttribute, value: string | null): void;
}) {
    let label = 'Block style options';
    let controls: ReactElement | null = null;

    if (meta.type === 'code') {
        const previewKind = codePreviewKindForLanguage(meta.language);
        label = 'Code block options';
        controls = (
            <>
                <input
                    className="codeLanguage"
                    value={meta.language}
                    placeholder="plain"
                    aria-label="Code language"
                    onChange={(event) => onSetCodeLanguage(event.currentTarget.value)}
                />
                {previewKind ? (
                    <label className="blockOptionsToggle">
                        <input
                            type="checkbox"
                            checked={meta.preview === previewKind}
                            aria-label="Preview code"
                            onChange={(event) => onSetCodePreview(event.currentTarget.checked)}
                        />
                        Preview
                    </label>
                ) : null}
            </>
        );
    } else if (meta.type === 'callout') {
        label = 'Callout block options';
        controls = (
            <label className="blockOptionsField">
                <span>Kind</span>
                <select
                    className="blockOptionsSelect"
                    value={meta.kind}
                    aria-label="Callout kind"
                    onChange={(event) =>
                        onSetCalloutKind(event.currentTarget.value as 'info' | 'warning' | 'error')
                    }
                >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                </select>
            </label>
        );
    } else if (meta.type === 'image') {
        label = 'Image block options';
        controls = (
            <label className="blockOptionsField">
                <span>Size</span>
                <select
                    className="blockOptionsSelect"
                    value={meta.size}
                    aria-label="Image size"
                    onChange={(event) =>
                        onSetImageSize(event.currentTarget.value as ImagePresentationSize)
                    }
                >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    <option value="original">Original</option>
                </select>
            </label>
        );
    } else if (meta.type === 'poll') {
        label = 'Poll block options';
        controls = (
            <>
                {meta.kind === 'rating' ? (
                    <>
                        <label className="blockOptionsToggle">
                            <input
                                type="checkbox"
                                checked={meta.allowChange}
                                aria-label="Allow vote changes"
                                onChange={(event) => onSetPollAllowChange(event.currentTarget.checked)}
                            />
                            Allow changes
                        </label>
                        <label className="blockOptionsField">
                            <span>Max</span>
                            <input
                                className="blockOptionsNumber"
                                type="number"
                                min={1}
                                max={10}
                                value={meta.max ?? 5}
                                aria-label="Rating maximum"
                                onChange={(event) => onSetRatingPollMax(Number(event.currentTarget.value))}
                            />
                        </label>
                        <label className="blockOptionsField">
                            <span>Style</span>
                            <select
                                className="blockOptionsSelect"
                                value={meta.ratingPresentation ?? 'numbers'}
                                aria-label="Rating presentation"
                                onChange={(event) =>
                                    onSetRatingPollPresentation(
                                        event.currentTarget.value as PollRatingPresentation,
                                    )
                                }
                            >
                                <option value="numbers">Numbers</option>
                                <option value="stars">Stars</option>
                            </select>
                        </label>
                    </>
                ) : null}
                {meta.kind === 'children' ? (
                    <>
                        <label className="blockOptionsField">
                            <span>Display</span>
                            <select
                                className="blockOptionsSelect"
                                value={meta.displayMode ?? 'inline'}
                                aria-label="Answer poll display"
                                onChange={(event) =>
                                    onSetPollDisplayMode(event.currentTarget.value as PollDisplayMode)
                                }
                            >
                                <option value="inline">Inline</option>
                                <option value="list">List</option>
                            </select>
                        </label>
                        <label className="blockOptionsField">
                            <span>Selection</span>
                            <select
                                className="blockOptionsSelect"
                                value={meta.choiceMode ?? 'single'}
                                aria-label="Poll selection mode"
                                onChange={(event) =>
                                    onSetPollChoiceMode(event.currentTarget.value as PollChoiceMode)
                                }
                            >
                                <option value="single">Select one</option>
                                <option value="multiple">Select all</option>
                            </select>
                        </label>
                        <label className="blockOptionsToggle">
                            <input
                                type="checkbox"
                                checked={meta.allowChange}
                                aria-label="Allow vote changes"
                                onChange={(event) => onSetPollAllowChange(event.currentTarget.checked)}
                            />
                            Allow changes
                        </label>
                    </>
                ) : null}
                {meta.kind === 'matrix' ? (
                    <>
                        <label className="blockOptionsField">
                            <span>Selection</span>
                            <select
                                className="blockOptionsSelect"
                                value={meta.choiceMode ?? 'single'}
                                aria-label="Poll selection mode"
                                onChange={(event) =>
                                    onSetPollChoiceMode(event.currentTarget.value as PollChoiceMode)
                                }
                            >
                                <option value="single">Select one</option>
                                <option value="multiple">Select all</option>
                            </select>
                        </label>
                        <label className="blockOptionsToggle">
                            <input
                                type="checkbox"
                                checked={meta.allowChange}
                                aria-label="Allow vote changes"
                                onChange={(event) => onSetPollAllowChange(event.currentTarget.checked)}
                            />
                            Allow changes
                        </label>
                    </>
                ) : null}
                {meta.kind === 'long' ? (
                    <label className="blockOptionsToggle">
                        <input
                            type="checkbox"
                            checked={meta.allowChange}
                            aria-label="Allow answer changes"
                            onChange={(event) => onSetPollAllowChange(event.currentTarget.checked)}
                        />
                        Allow changes
                    </label>
                ) : null}
            </>
        );
    } else if (meta.type === 'columns') {
        label = 'Columns block options';
        controls = (
            <label className="blockOptionsField">
                <span>Display</span>
                <select
                    className="blockOptionsSelect"
                    value={meta.display}
                    aria-label="Columns display"
                    onChange={(event) =>
                        onSetColumnsDisplay(event.currentTarget.value as ColumnsDisplayMode)
                    }
                >
                    <option value="blocks">Blocks</option>
                    <option value="cards">Cards</option>
                </select>
            </label>
        );
    } else if (meta.type === 'slide_deck') {
        label = 'Slide deck options';
        controls = (
            <>
                <div className="blockOptionsNumberRow">
                    <label className="blockOptionsField">
                        <span>Width</span>
                        <input
                            className="blockOptionsNumber"
                            type="number"
                            min={1}
                            value={meta.width}
                            aria-label="Slide deck width"
                            onChange={(event) => onSetSlideDeckSize(Number(event.currentTarget.value), meta.height)}
                        />
                    </label>
                    <label className="blockOptionsField">
                        <span>Height</span>
                        <input
                            className="blockOptionsNumber"
                            type="number"
                            min={1}
                            value={meta.height}
                            aria-label="Slide deck height"
                            onChange={(event) => onSetSlideDeckSize(meta.width, Number(event.currentTarget.value))}
                        />
                    </label>
                </div>
                <label className="blockOptionsField">
                    <span>Footer</span>
                    <select
                        className="blockOptionsSelect"
                        value={meta.footer}
                        aria-label="Slide deck footer"
                        onChange={(event) => onSetSlideDeckFooter(event.currentTarget.value as SlideDeckFooterMode)}
                    >
                        <option value="none">None</option>
                        <option value="deck-title">Deck title</option>
                        <option value="slide-number">Slide number</option>
                        <option value="deck-title-and-slide-number">Title and number</option>
                    </select>
                </label>
            </>
        );
    } else if (meta.type === 'slide') {
        label = 'Slide options';
        controls = (
            <>
                <label className="blockOptionsToggle">
                    <input
                        type="checkbox"
                        checked={meta.showTitle}
                        aria-label="Show slide title"
                        onChange={(event) => onSetSlideShowTitle(event.currentTarget.checked)}
                    />
                    Show title
                </label>
                <label className="blockOptionsField">
                    <span>Transition</span>
                    <select
                        className="blockOptionsSelect"
                        value={meta.transition}
                        aria-label="Slide transition"
                        onChange={(event) => onSetSlideTransition(event.currentTarget.value as SlideTransition)}
                    >
                        <option value="none">None</option>
                        <option value="fade">Fade</option>
                        <option value="slide">Slide</option>
                    </select>
                </label>
            </>
        );
    }

    const styleControls = (
        <>
            <label className="blockOptionsField">
                <span>Text</span>
                <input
                    className="blockOptionsText"
                    value={richBlockStyleValue(style, 'color') ?? ''}
                    placeholder="default"
                    aria-label="Block text color"
                    onChange={(event) => onSetBlockStyle('color', event.currentTarget.value || null)}
                />
            </label>
            <label className="blockOptionsField">
                <span>Background</span>
                <input
                    className="blockOptionsText"
                    value={richBlockStyleValue(style, 'background-color') ?? ''}
                    placeholder="default"
                    aria-label="Block background color"
                    onChange={(event) => onSetBlockStyle('background-color', event.currentTarget.value || null)}
                />
            </label>
            <label className="blockOptionsField">
                <span>Size</span>
                <select
                    className="blockOptionsSelect"
                    value={richBlockStyleValue(style, 'font-size') ?? ''}
                    aria-label="Block font size"
                    onChange={(event) => onSetBlockStyle('font-size', event.currentTarget.value || null)}
                >
                    <option value="">Default</option>
                    <option value="xsmall">Extra small</option>
                    <option value="small">Small</option>
                    <option value="normal">Normal</option>
                    <option value="large">Large</option>
                    <option value="xlarge">Extra large</option>
                </select>
            </label>
            <label className="blockOptionsField">
                <span>Padding</span>
                <select
                    className="blockOptionsSelect"
                    value={richBlockStyleValue(style, 'padding') ?? ''}
                    aria-label="Block padding"
                    onChange={(event) => onSetBlockStyle('padding', event.currentTarget.value || null)}
                >
                    <option value="">Default</option>
                    <option value="xsmall">Extra small</option>
                    <option value="small">Small</option>
                    <option value="normal">Normal</option>
                    <option value="large">Large</option>
                    <option value="xlarge">Extra large</option>
                </select>
            </label>
        </>
    );
    controls = controls ? <>{controls}{styleControls}</> : styleControls;

    return (
        <details
            className={['blockOptions', className ?? ''].filter(Boolean).join(' ')}
            contentEditable={false}
            onPointerDown={stopEditorControlEvent}
            onMouseDown={stopEditorControlEvent}
            onMouseUp={stopEditorControlEvent}
            onClick={stopEditorControlEvent}
        >
            <summary className="blockOptionsButton" aria-label={label}>
                <span aria-hidden="true">...</span>
            </summary>
            <div className="blockOptionsMenu">{controls}</div>
        </details>
    );
}

const BLOCK_STYLE_SIZE_VALUES: Record<RichBlockStyleSize, string> = {
    xsmall: '0.85em',
    small: '0.93em',
    normal: '1em',
    large: '1.15em',
    xlarge: '1.35em',
};

const BLOCK_STYLE_PADDING_VALUES: Record<RichBlockStyleSize, string> = {
    xsmall: '2px 4px',
    small: '4px 8px',
    normal: '8px 12px',
    large: '12px 16px',
    xlarge: '18px 22px',
};

const blockStyleProps = (style: BlockStyle | undefined): CSSProperties => {
    const result: CSSProperties = {};
    const backgroundColor = richBlockStyleValue(style, 'background-color');
    const color = richBlockStyleValue(style, 'color');
    const fontSize = richBlockStyleValue(style, 'font-size') as RichBlockStyleSize | null;
    const padding = richBlockStyleValue(style, 'padding') as RichBlockStyleSize | null;
    if (backgroundColor) result.backgroundColor = backgroundColor;
    if (color) result.color = color;
    if (fontSize) result.fontSize = BLOCK_STYLE_SIZE_VALUES[fontSize];
    if (padding) result.padding = BLOCK_STYLE_PADDING_VALUES[padding];
    return result;
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

const mathPreviewFromEvent = (
    root: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null => {
    const elementConstructor = root.ownerDocument.defaultView?.Element;
    if (!elementConstructor || !(target instanceof elementConstructor)) return null;
    const trigger = target.closest<HTMLElement>('[data-math-preview="true"]');
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

const writeClipboardPayload = async (payload: RichClipboardPayload): Promise<void> => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    const plainText = payload.tsv ?? payload.plainText;
    if (typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
        const items: Record<string, Blob> = {
            'text/plain': new Blob([plainText], {type: 'text/plain'}),
            'text/html': new Blob([htmlWithClipboardPayload(payload)], {type: 'text/html'}),
        };
        try {
            await clipboard.write([new ClipboardItem(items)]);
            return;
        } catch {
            // Some browsers reject rich async clipboard writes outside direct user gestures.
        }
    }
    await clipboard.writeText?.(plainText);
};

const richClipboardPayloadFromDataTransfer = (
    data: DataTransfer,
): RichClipboardPayload | null => {
    const types = data.types;
    const hasTypedClipboard = Boolean(types?.length);
    const canReadType = (type: string) => !hasTypedClipboard || Array.prototype.includes.call(types, type);
    return (
        (canReadType(BLOCK_RICH_TEXT_MIME)
            ? parseBlockRichTextClipboardPayload(data.getData(BLOCK_RICH_TEXT_MIME))
            : null) ??
        (canReadType('text/html')
            ? parseBlockRichTextClipboardHtml(data.getData('text/html'))
            : null)
    );
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
    if (selection.type !== 'range') return [];
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

const slashPopoverPositionFromSelection = (
    root: HTMLElement | null,
): {top: number; left: number} => {
    const fallbackRect = root?.getBoundingClientRect();
    const selection = root?.ownerDocument.defaultView?.getSelection();
    const range =
        root &&
        selection &&
        selection.rangeCount > 0 &&
        root.contains(selection.getRangeAt(0).startContainer)
            ? selection.getRangeAt(0)
            : null;
    const rect =
        range && typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : null;
    const clientRect =
        rect && (rect.top || rect.bottom || rect.left || rect.right)
            ? rect
            : (range?.getClientRects?.()[0] ?? null);
    return {
        top: clientRect ? clientRect.bottom + 8 : (fallbackRect?.top ?? 0) + 28,
        left: clientRect ? clientRect.left : (fallbackRect?.left ?? 0),
    };
};

const slashPopoverPositionFromTrigger = (
    root: HTMLElement | null,
    menu: SlashMenuState,
): {top: number; left: number} | null => {
    const trigger =
        menu.triggers.find((item) => item.selectionId === menu.selection.primaryId) ??
        menu.triggers[0];
    if (!root || !trigger) return null;
    const block = root.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(trigger.fallbackBlockId)}"]`,
    );
    if (!block) return null;
    try {
        const rect = caretRectForBlockOffset(block, trigger.fallbackOffset + 1);
        return {top: rect.bottom + 8, left: rect.left};
    } catch {
        return null;
    }
};

const linkPopoverPositionFromElement = (element: HTMLElement): {top: number; left: number} => {
    const rect = element.getBoundingClientRect();
    return {top: rect.bottom + 8, left: rect.left};
};

const serializeRuns = (
    runs: RichFormattedBlock['runs'],
    charIdsByOffset: string[],
    rainbowLamportIds: boolean,
    decorations: BlockSelectionDecorations | null,
    trailingCodeNewline = false,
    footnoteNumberById: Map<string, number> = new Map(),
    syntaxTokens?: SyntaxToken[],
    ingredientTokens?: IngredientHighlightToken[],
    visibleBlockIdSet: Set<string> = new Set(),
    selection?: EditorSelection,
    activeMathSourceKey?: string | null,
    mathRenderVersion = 0,
) => {
    const hasMath = blockHasMathRuns(runs);
    return JSON.stringify({
        runs: runs.map((run) => [
            run.text,
            run.marks.bold,
            run.marks.italic,
            run.marks.strikethrough,
            run.marks[LINK_MARK],
            run.marks[CODE_MARK],
            run.marks[MATH_MARK],
            run.marks[INLINE_EMBED_MARK],
        ]),
        stackedMarks: runs.map((run) => run.stackedMarks),
        charIdsByOffset,
        rainbowLamportIds,
        decorations,
        trailingCodeNewline,
        syntaxTokens,
        ingredientTokens,
        visibleBlockIds: [...visibleBlockIdSet].sort(),
        mathRendering: hasMath
            ? {
                  selection,
                  activeMathSourceKey,
                  mathRenderVersion,
              }
            : undefined,
        footnoteNumbers: [...footnoteNumberById.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });
};

const blockHasMathRuns = (runs: RichFormattedBlock['runs']): boolean =>
    runs.some((run) => run.marks[MATH_MARK] !== undefined);

const renderRunNodes = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    options: {
        blockId?: string;
        charIdsByOffset?: string[];
        rainbowLamportIds?: boolean;
        trailingCodeNewline?: boolean;
        syntaxTokens?: SyntaxToken[];
        ingredientTokens?: IngredientHighlightToken[];
        visibleBlockIdSet?: Set<string>;
        popoverTextById?: Map<string, string>;
        footnoteNumberById?: Map<string, number>;
        selection?: EditorSelection;
        activeMathSourceKey?: string | null;
        mathRenderer?: MathRenderer | null;
    } = {},
): Node[] => {
    const chunks = runRenderChunks(
        runs,
        decorations,
        options.rainbowLamportIds ?? false,
        options.syntaxTokens,
        options.ingredientTokens,
    );
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
        rainbowLamportIds?: boolean;
        popoverTextById?: Map<string, string>;
        visibleBlockIdSet?: Set<string>;
        selection?: EditorSelection;
        activeMathSourceKey?: string | null;
        mathRenderer?: MathRenderer | null;
    },
): HTMLElement => {
    const rainbowColor = options.rainbowLamportIds
        ? rainbowLamportColor(options.charIdsByOffset?.[chunk.blockStartOffset])
        : null;
    if (chunk.text === INLINE_EMBED_TEXT && segmentText(chunk.text).length === 1) {
        const data = inlineEmbedDataForRun(chunk.run);
        const plainText = plainTextForInlineEmbed(data, inlineEmbedPlugins, {
            ambientMarks: chunk.run.marks,
        });
        const element = renderInlineEmbed(data, inlineEmbedPlugins, {
            blockId: options.blockId ?? '',
            charId: options.charIdsByOffset?.[chunk.blockStartOffset] ?? '',
            startOffset: chunk.blockStartOffset,
            ambientMarks: chunk.run.marks,
            plainText,
        });
        if (rainbowColor) element.style.backgroundColor = rainbowColor;
        return element;
    }
    const mathMode =
        chunk.run.marks[MATH_MARK] !== undefined ? mathModeForRun(chunk.run) : null;
    if (mathMode) {
        const key = mathSourceKey(options.blockId ?? '', chunk.blockStartOffset, chunk.blockEndOffset, mathMode);
        if (
            options.activeMathSourceKey !== key &&
            !selectionIntersectsChunk(options.blockId ?? '', options.selection, chunk) &&
            options.mathRenderer
        ) {
            const element = renderMathPreview(
                options.blockId ?? '',
                chunk.text,
                mathMode,
                chunk.blockStartOffset,
                chunk.blockEndOffset,
                options.mathRenderer,
            );
            if (rainbowColor) element.style.backgroundColor = rainbowColor;
            return element;
        }
    }
    const span = document.createElement('span');
    span.textContent = chunk.text;
    applyRunClasses(span, chunk, options.popoverTextById, options.visibleBlockIdSet);
    if (rainbowColor) span.style.backgroundColor = rainbowColor;
    return span;
};

const rainbowLamportColor = (charId: string | undefined): string | null => {
    if (!charId) return null;
    try {
        const counter = parseLamportString(charId)[0];
        return `hsl(${(counter % 72) * 5}, 100%, 50%)`;
    } catch {
        return null;
    }
};

const renderMathPreview = (
    blockId: string,
    source: string,
    mode: 'inline' | 'display',
    startOffset: number,
    endOffset: number,
    renderer: MathRenderer,
): HTMLElement => {
    const span = document.createElement(mode === 'display' ? 'div' : 'span');
    span.className = mode === 'display' ? 'mathPreview mathPreviewDisplay' : 'mathPreview mathPreviewInline';
    span.contentEditable = 'false';
    span.dataset.mathPreview = 'true';
    span.dataset.mathMode = mode;
    span.dataset.mathStartOffset = String(startOffset);
    span.dataset.mathEndOffset = String(endOffset);
    span.setAttribute('role', 'button');
    span.tabIndex = -1;

    const rendered = document.createElement('span');
    rendered.className = 'mathPreviewRendered';
    rendered.dataset.offsetSentinel = 'true';
    const result = renderer.render(source, mode, {
        fallbackKey: mathSourceFallbackKey(blockId, startOffset, mode),
    });
    if (result.type === 'html') {
        rendered.innerHTML = result.html;
    } else {
        rendered.textContent = result.text;
        span.classList.add('mathPreviewLiteral');
    }

    const offsetText = document.createElement('span');
    offsetText.className = 'mathPreviewOffsetText';
    offsetText.textContent = source;

    span.append(rendered, offsetText);
    return span;
};

const mathSourceFallbackKey = (
    blockId: string,
    startOffset: number,
    mode: 'inline' | 'display',
): string => `${blockId}\0${startOffset}\0${mode}`;

const selectionIntersectsChunk = (
    blockId: string,
    selection: EditorSelection | undefined,
    chunk: RunRenderChunk,
): boolean => {
    if (!selection) return false;
    if (selection.type === 'caret') {
        return (
            selection.point.blockId === blockId &&
            selection.point.offset >= chunk.blockStartOffset &&
            selection.point.offset <= chunk.blockEndOffset
        );
    }
    if (selection.type !== 'range') return false;
    const anchor = selection.anchor.blockId === blockId ? selection.anchor.offset : null;
    const focus = selection.focus.blockId === blockId ? selection.focus.offset : null;
    if (anchor === null && focus === null) return false;
    const start = Math.min(anchor ?? 0, focus ?? 0);
    const end = Math.max(anchor ?? Number.POSITIVE_INFINITY, focus ?? Number.POSITIVE_INFINITY);
    return start <= chunk.blockEndOffset && end >= chunk.blockStartOffset;
};

const mathSourceKey = (
    blockId: string,
    startOffset: number,
    endOffset: number,
    mode: 'inline' | 'display',
): string => `${blockId}:${startOffset}:${endOffset}:${mode}`;

const mathRangeFromSourceKey = (
    key: string,
): {blockId: string; startOffset: number; endOffset: number; mode: 'inline' | 'display'} | null => {
    const [blockId, start, end, mode] = key.split(':');
    const startOffset = Number(start);
    const endOffset = Number(end);
    if (!blockId || !Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return null;
    if (mode !== 'inline' && mode !== 'display') return null;
    return {blockId, startOffset, endOffset, mode};
};

type RunRenderChunk = {
    run: RichFormattedBlock['runs'][number];
    text: string;
    blockStartOffset: number;
    blockEndOffset: number;
    decoratorClassNames: string[];
};

const runRenderChunks = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    rainbowLamportIds: boolean,
    syntaxTokens?: SyntaxToken[],
    ingredientTokens?: IngredientHighlightToken[],
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
        if (rainbowLamportIds) {
            for (let index = 1; index < runSegments.length; index++) {
                boundaries.add(index);
            }
        }
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
        for (const token of ingredientTokens ?? []) {
            addBoundaryInRun(boundaries, token.startOffset - runStart, runSegments.length);
            addBoundaryInRun(boundaries, token.endOffset - runStart, runSegments.length);
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
                decoratorClassNames: decoratorClassNamesForRange(
                    syntaxRanges,
                    ingredientTokens ?? [],
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

const decoratorClassNamesForRange = (
    ranges: SyntaxTokenRange[],
    ingredientTokens: IngredientHighlightToken[],
    startOffset: number,
    endOffset: number,
): string[] => {
    const classNames: string[] = [];
    for (let index = ranges.length - 1; index >= 0; index--) {
        const range = ranges[index];
        if (startOffset >= range.startOffset && endOffset <= range.endOffset) {
            if (range.className) classNames.push(range.className);
            break;
        }
    }
    for (const token of ingredientTokens) {
        if (startOffset >= token.startOffset && endOffset <= token.endOffset) {
            classNames.push(token.className);
        }
    }
    return classNames;
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
    visibleBlockIdSet?: Set<string>,
) => {
    const run = chunk.run;
    if (chunk.decoratorClassNames.length) span.classList.add(...chunk.decoratorClassNames);
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
    const mathMode = mathModeForRun(run);
    if (mathMode) {
        span.classList.add('markMath');
        if (mathMode === 'display') span.classList.add('markMathDisplay');
    }
    if (typeof run.marks[LINK_MARK] === 'string') {
        span.classList.add('markLink');
        const targetBlockId = blockIdFromBlockLinkHref(run.marks[LINK_MARK]);
        if (targetBlockId && !visibleBlockIdSet?.has(targetBlockId)) {
            span.classList.add('markLinkDead');
        }
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
