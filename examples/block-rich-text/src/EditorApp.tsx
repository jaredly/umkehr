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
import {BlockRichTextEditor, legacyRichTextPlugins} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {constrainSelectionToFullscreenSlide} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {useBlockReorder, type DropTarget} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {resolveSelection, retainSelection} from 'umkehr/block-editor';
import {findWordOccurrences, wordAtPoint} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {
    INLINE_EMBED_MARK,
    INLINE_EMBED_TEXT,
    inlineEmbedDataForRun,
    inlineEmbedPlugins,
    isInlineEmbedData,
    plainTextForInlineEmbed,
    renderInlineEmbed,
} from 'umkehr/block-editor';
import {BrowserMathJaxRenderer, type MathRenderer} from 'umkehr/block-editor';
import {highlightIngredientLine, type IngredientHighlightToken} from 'umkehr/block-editor';
import {highlightCode, type SyntaxToken} from 'umkehr/block-editor';
import {
    createAttachmentFromFile,
    deserializeAttachments,
    revokeAttachments,
    serializeAttachments,
    type AttachmentStore,
    type ImageAttachment,
    type SerializedImageAttachment,
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {Toolbar} from 'umkehr/block-editor';
import {
    CodeFloatingPopover,
    CodeHoverPopover,
    DateEmbedFloatingPopover,
    LinkFloatingPopover,
    LinkHoverPopover,
} from 'umkehr/block-editor';
import {deriveActiveInlineMarks} from 'umkehr/block-editor';
import {
    blockDropTargetFromPoint,
    orderDraggedBlockIds,
    orderDraggedBlockIdsForCellSlot,
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';
import {ImagePreview, PreviewableCodeBlock, PreviewBlockCard} from 'umkehr/block-editor';
import {blockTypeMenuValue, blockTypeMeta, deriveOrderedListNumbers} from 'umkehr/block-editor';
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
} from 'umkehr/block-editor';

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
                <BlockRichTextEditor
                    replica={displayDemo.left}
                    attachments={attachments}
                    plugins={legacyRichTextPlugins}
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
                <BlockRichTextEditor
                    replica={displayDemo.right}
                    attachments={attachments}
                    plugins={legacyRichTextPlugins}
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
