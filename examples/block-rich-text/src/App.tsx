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
    materializeFormattedBlocks,
    materializedBlockParent,
    materializedBlockPath,
    orderedCharIdsForBlock,
    visibleBlockChildren,
    visibleRangesForMark,
} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import type {CachedState, Op} from 'umkehr/block-crdt/types';
import {lamportToString, parseLamportString} from 'umkehr/block-crdt/utils';
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
import {paragraphMeta, type ImagePresentationSize, type PreviewMetadata, type RichBlockMeta} from './blockMeta';
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
    normalizeSelectionSegments,
    pointTextLength,
    selectedBlockIdsForSelection,
    segmentText,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
    visibleSubtreeBlockIds,
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
    insertImageBlockEverywhere,
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
import {
    fetchPreviewMetadata,
    normalizePreviewUrl,
    previewAssetUrl,
    previewDomain,
    type PreviewUrlInvalidReason,
} from './previewMetadata';
import {documentFixtures, fixtureById} from './documentFixtures';

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
type SlashTrigger = {
    selectionId: string;
    charId: string | null;
    fallbackBlockId: string;
    fallbackOffset: number;
};
type SlashMenuState = {
    triggers: SlashTrigger[];
    selection: RetainedSelectionSet;
    top: number;
    left: number;
    query: string;
    activeIndex: number;
};
type SlashCommand =
    | {type: 'block'; value: BlockTypeMenuValue; label: string; group: string; keywords: string[]}
    | {type: 'date-embed'; label: string; group: string; keywords: string[]};
type PendingInlineMarks = Partial<Record<BareInlineMark, boolean>>;
type KeyPerfSample = {
    id: number;
    editorId: EditorId;
    label: string;
    ms: number;
};
type KeyPerfSampleInput = Omit<KeyPerfSample, 'id'>;

const BOOLEAN_INLINE_MARKS: BooleanInlineMark[] = ['bold', 'italic', 'strikethrough'];
const BARE_INLINE_MARKS: BareInlineMark[] = [...BOOLEAN_INLINE_MARKS, CODE_MARK];
const DEFAULT_DATE_EMBED_DATA = {type: 'date', value: '2026-06-23'} as const;
const KEY_PERF_SAMPLE_LIMIT = 60;
const KEY_PERF_MAX_BAR_MS = 50;

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
    const [attachments, setAttachments] = useState<AttachmentStore>(() => new Map());
    const [keyPerfSamples, setKeyPerfSamples] = useState<KeyPerfSample[]>([]);
    const [transientSelections, setTransientSelections] = useState<
        Partial<Record<EditorId, RetainedSelectionSet>>
    >({});
    const [historyStatus, setHistoryStatus] = useState('');
    const [undoStatus, setUndoStatus] = useState<Partial<Record<EditorId, string>>>({});
    const [historyResetSignal, setHistoryResetSignal] = useState(0);
    const [rainbowLamportIds, setRainbowLamportIds] = useState(false);
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

const hasDemoQuery = () =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demos');

const orderDraggedBlockIds = (
    state: Replica['state'],
    blockIds: string[],
    target: Parameters<typeof moveBlock>[2],
): string[] => {
    const order = editableBlockIds(state);
    const sorted = [...new Set(blockIds)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (target.type === 'after' || (target.type === 'child' && target.at === 'start')) {
        return sorted.reverse();
    }
    return sorted;
};

const orderDraggedBlockIdsForCellSlot = (
    state: Replica['state'],
    blockIds: string[],
): string[] => {
    const order = editableBlockIds(state);
    return [...new Set(blockIds)].sort((a, b) => order.indexOf(b) - order.indexOf(a));
};

function KeyPerfMonitor({
    samples,
    rainbowLamportIds,
    onRainbowLamportIdsChange,
}: {
    samples: KeyPerfSample[];
    rainbowLamportIds: boolean;
    onRainbowLamportIdsChange(value: boolean): void;
}) {
    const latest = samples.at(-1);
    return (
        <aside className="keyPerfMonitor" aria-label="Keypress performance monitor">
            <div className="keyPerfHeader">
                <span>Event ms</span>
                <strong>{latest ? `${formatDuration(latest.ms)} ms` : '-- ms'}</strong>
            </div>
            <div className="keyPerfLatest">{latest ? latest.label : 'No samples'}</div>
            <div className="keyPerfBars" aria-label="Recent keypress durations">
                {samples.map((sample) => {
                    const capped = Math.min(sample.ms, KEY_PERF_MAX_BAR_MS);
                    const height = Math.max(4, (capped / KEY_PERF_MAX_BAR_MS) * 100);
                    return (
                        <span
                            key={sample.id}
                            className={`keyPerfBar ${keyPerfClass(sample.ms)}`}
                            style={{'--key-perf-height': `${height}%`} as CSSProperties}
                            title={`${sample.label}: ${formatDuration(sample.ms)} ms`}
                            data-testid="key-perf-bar"
                        />
                    );
                })}
            </div>
            <label className="keyPerfDebugToggle">
                <input
                    type="checkbox"
                    checked={rainbowLamportIds}
                    onChange={(event) => onRainbowLamportIdsChange(event.currentTarget.checked)}
                />
                <span>Rainbow IDs</span>
            </label>
        </aside>
    );
}

function BlockEditor({
    replica,
    attachments,
    resetSignal,
    undoState,
    undoStatus,
    rainbowLamportIds,
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
                includePrimary: !hasFocus || isExtendingSelection,
                includePrimaryBoundaryCaret: true,
            }),
        [hasFocus, isExtendingSelection, replica.state, resolvedSelectionSet],
    );
    const blockLevelDecorationsByBlock = useMemo(
        () => blockLevelDecorationsForSelectionSet(replica.state, resolvedSelectionSet),
        [replica.state, resolvedSelectionSet],
    );
    const [cellDragBlockDropTarget, setCellDragBlockDropTarget] = useState<DropTarget | null>(null);
    const {draggingId, draggingSubtreeIds, dropTarget, registerRow, startDrag} = useBlockReorder({
        blocks: blocks.map(({id, depth, parentId}) => ({id, depth, parentId})),
        onMove: (blockIds, target) =>
            onCommand((current) => {
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
                        `[data-block-id="${CSS.escape(focusBlockId)}"]`,
                    )
                  : null;
        suppressNextBlockFocusSelectionRef.current = true;
        suppressNextBlockKeySelectionRef.current = true;
        const focusTarget = target ?? rootRef.current;
        focusTarget?.focus({preventScroll: true});
        window.getSelection()?.removeAllRanges();
        if (target) pendingBlockSelectionFocusRef.current = null;
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
            if (
                event.type === 'mouseup' &&
                !addSelection &&
                resolvedSelectionSet.entries.length === 1 &&
                editorSelectionKey(selection) === editorSelectionKey(primaryResolvedSelection)
            ) {
                return;
            }
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
            onCommand((currentReplica) => ({
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
    }, [hasTextDragGesture, onCommand, scheduleSelectionRestore]);

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
        [liveSelectionSet, onCommand, resetVerticalCaretIntent, scheduleSelectionRestore],
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

    const copyRichSelection = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const payload = currentClipboardPayload();
            if (!payload) return;
            event.preventDefault();
            event.clipboardData.setData(BLOCK_RICH_TEXT_MIME, JSON.stringify(payload));
            event.clipboardData.setData('text/plain', payload.tsv ?? payload.plainText);
            event.clipboardData.setData('text/html', htmlWithClipboardPayload(payload));
            if (payload.tsv) {
                event.clipboardData.setData('text/tab-separated-values', payload.tsv);
            }
        },
        [currentClipboardPayload],
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
            onCommand((current) => {
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
            onCommand,
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
            onCommand((current) => {
                resetVerticalCaretIntent();
                const retainedSelection = current.selection;
                const currentPrimary = primarySelection(
                    resolveSelectionSet(current.state, retainedSelection),
                );
                const selection = isBlockLevelSelection(currentPrimary)
                    ? retainedSelection
                    : liveSelectionSet(current);
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
            onCommand,
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
            onCommand((current) => {
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
        [onCommand, resetVerticalCaretIntent, scheduleSelectionRestore, slashMenu],
    );

    const runBlockControlCommand = useCallback(
        (command: (current: Replica) => MultiCommandResult) => {
            onCommand((current) => command(current));
        },
        [onCommand],
    );

    const selectBlockSubtreeFromHandle = useCallback(
        (blockId: string) => {
            onCommand((current) => {
                const subtree = visibleSubtreeBlockIds(current.state, blockId);
                const focusBlockId = subtree[subtree.length - 1] ?? blockId;
                return {
                    state: current.state,
                    ops: [],
                    selection: replaceSelectionSet(current.state, {
                        type: 'block',
                        anchorBlockId: blockId,
                        focusBlockId,
                    }),
                };
            });
            focusBlockSelectionTarget({
                type: 'block',
                anchorBlockId: blockId,
                focusBlockId: visibleSubtreeBlockIds(replica.state, blockId).at(-1) ?? blockId,
            });
        },
        [focusBlockSelectionTarget, onCommand, replica.state],
    );

    const startBlockDragFromHandle = useCallback(
        (blockId: string, event: PointerEvent<HTMLElement>) => {
            const primary = primarySelection(resolvedSelectionSet);
            const selectedTopLevelBlockIds =
                primary.type === 'caret'
                    ? []
                    : selectedTopLevelBlockIdsForSelectionSet(replica.state, resolvedSelectionSet);
            const selectedGroup = selectedTopLevelBlockIds.filter((selectedBlockId) =>
                visibleSubtreeBlockIds(replica.state, selectedBlockId).includes(blockId),
            );
            if (selectedGroup.length) {
                startDrag(blockId, event, selectedTopLevelBlockIds);
                return;
            }
            selectBlockSubtreeFromHandle(blockId);
            startDrag(blockId, event, [blockId]);
        },
        [replica.state, resolvedSelectionSet, selectBlockSubtreeFromHandle, startDrag],
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
            const modifierPressed = event.metaKey || event.ctrlKey || event.altKey;

            if (event.key.length === 1 && !modifierPressed) {
                event.preventDefault();
                onCommand((current) => {
                    const textSelection = textCaretForBlockSelection(current.state, selection, 'focus');
                    const selectionSet = replacePrimarySelection(current.state, current.selection, textSelection);
                    const result = insertTextWithPendingMarks(current, selectionSet, event.key);
                    scheduleSelectionRestore(primarySelection(resolveSelectionSet(result.state, result.selection)));
                    return result;
                });
                return true;
            }

            if (event.key === 'Enter' && !modifierPressed) {
                event.preventDefault();
                onCommand((current) => {
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
                onCommand((current) => {
                    const activeSelection = primarySelection(
                        resolveSelectionSet(current.state, current.selection),
                    );
                    if (activeSelection.type === 'table-cells') {
                        const result = deleteTableCellSelection(current.state, activeSelection);
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
                        if (!working.state.blocks[blockId] || working.state.blocks[blockId].deleted) continue;
                        const deleted = deleteBlockOps(working, {
                            block: parseLamportString(blockId),
                            mode: 'subtree',
                            virtualParents: annotationVirtualParents(working),
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
                });
                return true;
            }

            return false;
        },
        [
            insertTextWithPendingMarks,
            onCommand,
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
            `[data-block-id="${CSS.escape(focusBlockId)}"]`,
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
                                charIdsByBlock,
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
                                runEditCommand,
                                runBlockControlCommand,
                                focusBlockSelectionTarget,
                                startBlockDragFromHandle,
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
    | 'recipe-ingredient'
    | 'table'
    | 'preview';

const SLASH_COMMANDS: SlashCommand[] = [
    {type: 'block', value: 'paragraph', label: 'Paragraph', group: 'Block type', keywords: ['text']},
    {type: 'block', value: 'heading1', label: 'Heading 1', group: 'Block type', keywords: ['h1', 'title']},
    {type: 'block', value: 'heading2', label: 'Heading 2', group: 'Block type', keywords: ['h2', 'subtitle']},
    {type: 'block', value: 'heading3', label: 'Heading 3', group: 'Block type', keywords: ['h3']},
    {type: 'block', value: 'unordered', label: 'Bulleted list', group: 'Block type', keywords: ['bullet', 'unordered']},
    {type: 'block', value: 'ordered', label: 'Numbered list', group: 'Block type', keywords: ['number', 'ordered']},
    {type: 'block', value: 'todo', label: 'Todo', group: 'Block type', keywords: ['task', 'checkbox']},
    {type: 'block', value: 'blockquote', label: 'Blockquote', group: 'Block type', keywords: ['quote']},
    {type: 'block', value: 'code', label: 'Code', group: 'Block type', keywords: ['pre']},
    {type: 'block', value: 'callout-info', label: 'Info callout', group: 'Block type', keywords: ['info']},
    {type: 'block', value: 'callout-warning', label: 'Warning callout', group: 'Block type', keywords: ['warning']},
    {type: 'block', value: 'callout-error', label: 'Error callout', group: 'Block type', keywords: ['error']},
    {type: 'block', value: 'recipe-ingredient', label: 'Ingredient', group: 'Block type', keywords: ['ingredient', 'recipe', 'food', 'line']},
    {type: 'block', value: 'table', label: 'Table', group: 'Block type', keywords: ['grid']},
    {type: 'block', value: 'preview', label: 'Preview', group: 'Block type', keywords: ['link', 'card', 'url']},
    {type: 'date-embed', label: 'Date', group: 'Inline embed', keywords: ['embed', 'calendar']},
];

const slashCommandId = (command: SlashCommand): string =>
    command.type === 'block' ? `block:${command.value}` : command.type;

const canOpenSlashMenuForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
): boolean => {
    const resolved = resolveSelectionSet(state, selection);
    return resolved.entries.every((entry) => {
        const block = state.state.blocks[focusPoint(entry.selection).blockId];
        return block?.meta.type !== 'code';
    });
};

const slashTriggersFromInsertResult = (result: MultiCommandResult): SlashTrigger[] => {
    const slashChars = result.ops.filter(
        (op): op is Op<RichBlockMeta> & {type: 'char'} =>
            op.type === 'char' && op.char.text === '/',
    );
    if (!slashChars.length) return [];

    const resolved = resolveSelectionSet(result.state, result.selection);
    const unusedEntries = [...resolved.entries];
    return slashChars.flatMap((op) => {
        const charId = lamportToString(op.char.id);
        const location = visibleCharLocation(result.state, charId);
        if (!location) return [];
        const entryIndex = unusedEntries.findIndex((entry) => {
            if (entry.selection.type !== 'caret') return false;
            return (
                entry.selection.point.blockId === location.blockId &&
                entry.selection.point.offset === location.offset + 1
            );
        });
        const entry =
            entryIndex >= 0
                ? unusedEntries.splice(entryIndex, 1)[0]
                : (unusedEntries.shift() ?? resolved.entries[0]);
        return [
            {
                selectionId: entry?.id ?? result.selection.primaryId,
                charId,
                fallbackBlockId: location.blockId,
                fallbackOffset: location.offset,
            },
        ];
    });
};

const visibleCharLocation = (
    state: CachedState<RichBlockMeta>,
    charId: string,
): {blockId: string; offset: number} | null => {
    const char = state.state.chars[charId];
    if (!char || char.deleted) return null;
    const parentId = lamportToString(char.parent.id);
    const parentIds = [parentId, ...Object.keys(state.state.blocks).filter((id) => id !== parentId)];
    for (const blockId of parentIds) {
        if (!state.state.blocks[blockId]) continue;
        const index = orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).indexOf(charId);
        if (index >= 0) return {blockId, offset: index};
    }
    return null;
};

const fallbackSlashLocation = (
    state: CachedState<RichBlockMeta>,
    trigger: SlashTrigger,
): {blockId: string; offset: number} | null => {
    if (!state.state.blocks[trigger.fallbackBlockId]) return null;
    const chars = segmentText(blockContents(state, trigger.fallbackBlockId));
    return chars[trigger.fallbackOffset] === '/'
        ? {blockId: trigger.fallbackBlockId, offset: trigger.fallbackOffset}
        : null;
};

const deleteSlashTriggers = (
    state: CachedState<RichBlockMeta>,
    menu: SlashMenuState,
    _context: ReturnType<typeof makeCommandContext>,
): {state: CachedState<RichBlockMeta>; ops: Array<Op<RichBlockMeta>>; selection: RetainedSelectionSet} => {
    let working = state;
    const ops: Array<Op<RichBlockMeta>> = [];
    const located = menu.triggers
        .map((trigger) => ({
            trigger,
            location:
                (trigger.charId ? visibleCharLocation(working, trigger.charId) : null) ??
                fallbackSlashLocation(working, trigger),
        }))
        .filter(
            (item): item is {trigger: SlashTrigger; location: {blockId: string; offset: number}} =>
                item.location !== null,
        )
        .sort((a, b) =>
            a.location.blockId === b.location.blockId
                ? b.location.offset - a.location.offset
                : a.location.blockId.localeCompare(b.location.blockId),
        );

    const caretBySelectionId = new Map<string, EditorSelection>();
    for (const {trigger, location} of located) {
        const deleteOps = deleteRangeOps(working, {
            block: parseLamportString(location.blockId),
            startOffset: location.offset,
            endOffset: location.offset + 1,
        });
        if (!deleteOps.length) continue;
        working = applyMany(working, deleteOps, annotationVirtualParents(working));
        ops.push(...deleteOps);
        caretBySelectionId.set(trigger.selectionId, caret(location.blockId, location.offset));
    }

    const selection = dedupeSelectionSet(working, {
        primaryId: menu.selection.primaryId,
        entries: menu.selection.entries.map((entry) => ({
            id: entry.id,
            selection: retainSelection(
                working,
                caretBySelectionId.get(entry.id) ?? resolveSelection(working, entry.selection),
            ),
        })),
    });
    return {state: working, ops, selection};
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
    charIdsByBlock: Map<string, string[]>;
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
    runBlockControlCommand(command: (current: Replica) => MultiCommandResult): void;
    focusBlockSelectionTarget(selection?: EditorSelection | null): void;
    startBlockDragFromHandle(blockId: string, event: PointerEvent<HTMLElement>): void;
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

const blockDropTargetFromPoint = (
    clientX: number,
    clientY: number,
    sourceTableId: string,
    context: RenderBlockContext,
): DropTarget | null => {
    const blockElement =
        typeof document.elementsFromPoint === 'function'
            ? document
                  .elementsFromPoint(clientX, clientY)
                  .map((element) => blockElementFromHitTestElement(element))
                  .find(
                      (element): element is HTMLElement =>
                          !!element?.dataset.blockId &&
                          element.closest<HTMLElement>('[data-table-id]')?.dataset.tableId !== sourceTableId,
                  )
            : null;
    if (blockElement) return dropTargetForBlockElement(blockElement, clientY, context);

    const rows = context.blocks
        .map((block) => {
            const editable = document.querySelector<HTMLElement>(
                `[data-block-id="${CSS.escape(block.id)}"]`,
            );
            const row = editable?.closest<HTMLElement>('.blockRow');
            if (!row || row.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === sourceTableId) {
                return null;
            }
            return {block, row, rect: row.getBoundingClientRect()};
        })
        .filter((row) => row !== null);
    if (!rows.length) return null;

    const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
    if (containing) return dropTargetForBlockElement(containing.row, clientY, context, containing.block);

    const before = rows.find(({rect}) => clientY < rect.top);
    if (before) {
        return {
            command: {type: 'before', targetBlockId: before.block.id},
            indicatorBlockId: before.block.id,
            indicatorPlacement: 'before',
            indicatorDepth: before.block.depth,
        };
    }
    const last = rows[rows.length - 1];
    return {
        command: {type: 'after', targetBlockId: last.block.id},
        indicatorBlockId: last.block.id,
        indicatorPlacement: 'after',
        indicatorDepth: last.block.depth,
    };
};

const blockElementFromHitTestElement = (element: Element): HTMLElement | null => {
    const editable = element.closest<HTMLElement>('[data-block-id]');
    if (editable) return editable;
    const row = element.closest<HTMLElement>('.blockRow');
    return row?.querySelector<HTMLElement>('[data-block-id]') ?? null;
};

const dropTargetForBlockElement = (
    blockElement: HTMLElement,
    clientY: number,
    context: RenderBlockContext,
    knownBlock?: RichFormattedBlock,
): DropTarget | null => {
    const blockId = blockElement.dataset.blockId;
    const block = knownBlock ?? (blockId ? context.blocks.find((candidate) => candidate.id === blockId) : null);
    if (!block) return null;
    const row = blockElement.classList.contains('blockRow')
        ? blockElement
        : blockElement.closest<HTMLElement>('.blockRow') ?? blockElement;
    const rect = row.getBoundingClientRect();
    const placement = rect.height > 0 && clientY > rect.top + rect.height / 2 ? 'after' : 'before';
    const command: MoveTarget =
        placement === 'after'
            ? {type: 'after', targetBlockId: block.id}
            : {type: 'before', targetBlockId: block.id};
    return {
        command,
        indicatorBlockId: block.id,
        indicatorPlacement: placement,
        indicatorDepth: block.depth,
    };
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
    registerBlockRow?: boolean;
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
            isTableCell={isTableCellBlock(context.state, block.id)}
            listNumber={context.orderedListNumbers.get(block.id) ?? null}
            previousBlockId={previousBlock?.id ?? null}
            previousBlockLength={
                previousBlock ? pointTextLength(context.state, previousBlock.id) : 0
            }
            blockLength={pointTextLength(context.state, block.id)}
            charIdsByOffset={context.charIdsByBlock.get(block.id) ?? []}
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
            blockLevelDecoration={context.blockLevelDecorationsByBlock.get(block.id) ?? null}
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
        case 'recipe-ingredient':
            return {type: 'recipe_ingredient', ts};
        case 'table':
            return current;
        case 'preview':
            return {
                type: 'preview',
                url: current.type === 'preview' ? current.url : '',
                preview: current.type === 'preview' ? current.preview : null,
                ts,
            };
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
        case 'recipe_ingredient':
            return 'recipe-ingredient';
        case 'table':
            return 'table';
        case 'image':
            return 'paragraph';
        case 'preview':
            return 'preview';
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

function SlashCommandPopover({
    state,
    onQueryChange,
    onActiveIndexChange,
    onSelect,
    onClose,
}: {
    state: SlashMenuState | null;
    onQueryChange(query: string): void;
    onActiveIndexChange(index: number): void;
    onSelect(command: SlashCommand): void;
    onClose(): void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const commands = useMemo(() => {
        const query = state?.query.trim().toLowerCase() ?? '';
        if (!query) return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter((command) => {
            const haystack = [command.label, command.group, ...command.keywords]
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
    }, [state?.query]);
    const activeIndex = commands.length
        ? Math.max(0, Math.min(state?.activeIndex ?? 0, commands.length - 1))
        : -1;

    useLayoutEffect(() => {
        if (state) inputRef.current?.focus();
    }, [state]);

    useLayoutEffect(() => {
        if (!state || activeIndex < 0) return;
        optionRefs.current[activeIndex]?.scrollIntoView?.({block: 'nearest'});
    }, [activeIndex, state, commands.length]);

    if (!state) return null;

    return (
        <div
            className="slashCommandPopover"
            role="dialog"
            aria-label="Slash commands"
            style={{top: state.top, left: state.left}}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                    return;
                }
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (commands.length) onActiveIndexChange((activeIndex + 1) % commands.length);
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (commands.length) {
                        onActiveIndexChange((activeIndex - 1 + commands.length) % commands.length);
                    }
                    return;
                }
                if (event.key === 'Enter' && activeIndex >= 0) {
                    event.preventDefault();
                    onSelect(commands[activeIndex]);
                }
            }}
        >
            <input
                ref={inputRef}
                value={state.query}
                aria-label="Search slash commands"
                placeholder="Search"
                onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
            <div className="slashCommandList" role="listbox" aria-label="Slash command results">
                {commands.length ? (
                    commands.map((command, index) => (
                        <button
                            key={slashCommandId(command)}
                            ref={(element) => {
                                optionRefs.current[index] = element;
                            }}
                            type="button"
                            className={index === activeIndex ? 'active' : ''}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseEnter={() => onActiveIndexChange(index)}
                            onClick={() => onSelect(command)}
                        >
                            <span>{command.label}</span>
                            <small>{command.group}</small>
                        </button>
                    ))
                ) : (
                    <div className="slashCommandEmpty">No commands</div>
                )}
            </div>
        </div>
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
    onImageUploadStart,
    onImageUpload,
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
    onImageUploadStart(): void;
    onImageUpload(files: File[]): void;
    onBlockType(kind: BlockTypeMenuValue): void;
    onAnnotation(presentation: AnnotationPresentation): void;
}) {
    const imageInputRef = useRef<HTMLInputElement>(null);
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
                <button
                    type="button"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        onImageUploadStart();
                    }}
                    onClick={() => {
                        onImageUploadStart();
                        imageInputRef.current?.click();
                    }}
                >
                    Image
                </button>
                <input
                    ref={imageInputRef}
                    className="imageUploadInput"
                    type="file"
                    accept="image/*"
                    aria-label="Upload image"
                    onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        event.currentTarget.value = '';
                        if (files.length) onImageUpload(files);
                    }}
                />
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
                <option value="recipe-ingredient">Ingredient line</option>
                <option value="table">Table</option>
                <option value="preview">Preview</option>
            </select>
        </div>
    );
}

function EditableBlock({
    block,
    attachment,
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
    onToggleTodo,
    onSetCodeLanguage,
    onSetCalloutKind,
    onSetImageSize,
    onSetPreviewUrl,
    onSetPreviewMetadata,
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
    onInputMeasured,
    onDisplayInputRenderStarted,
}: {
    block: RichFormattedBlock;
    attachment: ImageAttachment | null;
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
    onToggleTodo(): void;
    onSetCodeLanguage(language: string): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onSetImageSize(size: ImagePresentationSize): void;
    onSetPreviewUrl(url: string): void;
    onSetPreviewMetadata(url: string, metadata: PreviewMetadata | null): void;
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
    onInputMeasured(label: string, ms: number): void;
    onDisplayInputRenderStarted(label: string, started: number): void;
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
    const blockText = block.runs.map((run) => run.text).join('');
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
            rainbowLamportIds={rainbowLamportIds}
            decorations={decorations}
            pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
            suppressNextFocusSelectionRef={suppressNextFocusSelectionRef}
            suppressNextKeySelectionRef={suppressNextKeySelectionRef}
            selection={selection}
            className={[
                'editableBlock',
                meta.type === 'code' ? 'codeBlock' : '',
                meta.type === 'heading' ? `headingLevel${meta.level}` : '',
                meta.type === 'image' ? 'imageCaption' : '',
                meta.type === 'recipe_ingredient' ? 'recipeIngredientBlock' : '',
                surfaceClassName ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            trailingCodeNewline={codeHasTrailingNewline}
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
    );

    return (
        <div
            ref={(element) => {
                if (registerBlockRow) registerRow(block.id, element);
            }}
            className={[
                'blockRow',
                variant === 'table-row-header' ? 'tableRowHeaderBlock' : '',
                `blockType-${meta.type}`,
                meta.type === 'callout' ? `callout${capitalize(meta.kind)}` : '',
                blockLevelDecoration?.selected ? 'blockSelected' : '',
                blockLevelDecoration?.focus ? 'blockSelectionFocus' : '',
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
            ) : (
                editableSurface
            )}
            {!hideInlineControls && (
                <BlockInlineControls
                    meta={meta}
                    onSetCodeLanguage={onSetCodeLanguage}
                    onSetCalloutKind={onSetCalloutKind}
                    onSetImageSize={onSetImageSize}
                />
            )}
        </div>
    );
}

function RichTextEditableSurface({
    blockId,
    runs,
    charIdsByOffset,
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
    onPaste,
}: {
    blockId: string;
    runs: RichFormattedBlock['runs'];
    charIdsByOffset: string[];
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
                    popoverTextById,
                    footnoteNumberById,
                }),
            );
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
        pendingCaretRestoreBlockIdRef,
        pendingSelectionRestoreRef,
        popoverTextById,
        rainbowLamportIds,
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
                        popoverTextById,
                        footnoteNumberById,
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
                            popoverTextById,
                            footnoteNumberById,
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
            onPaste={(event) => {
                if (!onPaste) return;
                measureInput(onInputMeasured, 'Paste', () => onPaste(event));
            }}
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

function BlockInlineControls({
    meta,
    onSetCodeLanguage,
    onSetCalloutKind,
    onSetImageSize,
}: {
    meta: RichBlockMeta;
    onSetCodeLanguage(language: string): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onSetImageSize(size: ImagePresentationSize): void;
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
    if (meta.type === 'image') {
        return (
            <select
                className="imageSizeControl"
                value={meta.size}
                aria-label="Image size"
                onPointerDown={stopEditorControlEvent}
                onMouseDown={stopEditorControlEvent}
                onMouseUp={stopEditorControlEvent}
                onClick={stopEditorControlEvent}
                onChange={(event) =>
                    onSetImageSize(event.currentTarget.value as ImagePresentationSize)
                }
            >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="original">Original</option>
            </select>
        );
    }
    return null;
}

type PreviewFetchStatus =
    | {type: 'idle'}
    | {type: 'loading'; url: string}
    | {type: 'failed'; url: string; reason: string};

const PREVIEW_CORS_PROXY = import.meta.env.VITE_PREVIEW_CORS_PROXY?.trim() || undefined;

function PreviewBlockCard({
    meta,
    subtitle,
    onSetUrl,
    onSetMetadata,
}: {
    meta: Extract<RichBlockMeta, {type: 'preview'}>;
    subtitle: ReactElement;
    onSetUrl(url: string): void;
    onSetMetadata(url: string, metadata: PreviewMetadata | null): void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(meta.url === '');
    const [draft, setDraft] = useState(meta.url);
    const [draftDirty, setDraftDirty] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [invalidReason, setInvalidReason] = useState<string | null>(null);
    const [fetchStatus, setFetchStatus] = useState<PreviewFetchStatus>({type: 'idle'});
    const normalized = normalizePreviewUrl(meta.url);
    const domain = normalized.valid ? normalized.domain : previewDomain(meta.url);
    const normalizedUrl = normalized.valid ? normalized.url : '';

    useEffect(() => {
        if (draftDirty) return;
        setDraft(meta.url);
        setDraftDirty(false);
        setInvalidReason(null);
        setEditing(meta.url === '');
    }, [meta.url]);

    useEffect(() => {
        if (!editing && meta.url === '') return;
        if (!normalized.valid || meta.preview) {
            setFetchStatus({type: 'idle'});
            return;
        }

        const controller = new AbortController();
        setFetchStatus({type: 'loading', url: normalizedUrl});
        void fetchPreviewMetadata(normalizedUrl, {
            signal: controller.signal,
            corsProxy: PREVIEW_CORS_PROXY,
        }).then((result) => {
            if (controller.signal.aborted) return;
            if (result.type === 'loaded') {
                setFetchStatus({type: 'idle'});
                onSetMetadata(result.url, result.metadata);
            } else if (result.type === 'failed') {
                setFetchStatus({type: 'failed', url: result.url, reason: result.reason});
            } else {
                setFetchStatus({type: 'idle'});
            }
        });

        return () => controller.abort();
    }, [editing, meta.preview, meta.url, normalizedUrl]);

    useEffect(() => {
        if (!editing) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const commitDraft = () => {
        const next = normalizePreviewUrl(draft);
        if (!next.valid) {
            setInvalidReason(previewUrlInvalidMessage(next.reason));
            return;
        }
        setInvalidReason(null);
        setEditing(false);
        setDraftDirty(false);
        setMenuOpen(false);
        onSetUrl(next.url);
    };

    const cancelEditing = () => {
        setDraft(meta.url);
        setDraftDirty(false);
        setInvalidReason(null);
        setEditing(meta.url === '');
        setMenuOpen(false);
    };

    const title = meta.preview?.title || meta.url || 'Preview';
    const description = meta.preview?.description;
    const imageUrl = previewAssetUrl(meta.preview?.imageUrl, PREVIEW_CORS_PROXY);
    const loadedUrl = meta.preview?.resolvedUrl || meta.url;
    const isLoading = fetchStatus.type === 'loading' && fetchStatus.url === normalizedUrl;
    const failed = fetchStatus.type === 'failed' && fetchStatus.url === normalizedUrl ? fetchStatus : null;

    return (
        <div className="previewBlock">
            <div className="previewCard" contentEditable={false}>
                {editing ? (
                    <div className="previewUrlEditor">
                        <input
                            ref={inputRef}
                            value={draft}
                            placeholder="https://example.com"
                            aria-label="Preview URL"
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onMouseUp={stopEditorControlEvent}
                            onClick={stopEditorControlEvent}
                            onChange={(event) => {
                                setDraft(event.currentTarget.value);
                                setDraftDirty(true);
                                setInvalidReason(null);
                            }}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitDraft();
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelEditing();
                                }
                            }}
                        />
                        <button
                            type="button"
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onClick={(event) => {
                                stopEditorControlEvent(event);
                                commitDraft();
                            }}
                        >
                            Save
                        </button>
                        {invalidReason ? <span className="previewUrlError">{invalidReason}</span> : null}
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            className="previewMenuButton"
                            aria-label="Preview options"
                            aria-expanded={menuOpen}
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onClick={(event) => {
                                stopEditorControlEvent(event);
                                setMenuOpen((open) => !open);
                            }}
                        >
                            ...
                        </button>
                        {menuOpen ? (
                            <div
                                className="previewMenu"
                                role="menu"
                                onPointerDown={stopEditorControlEvent}
                                onMouseDown={stopEditorControlEvent}
                                onClick={stopEditorControlEvent}
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(event) => {
                                        stopEditorControlEvent(event);
                                        setDraft(meta.url);
                                        setDraftDirty(false);
                                        setEditing(true);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Edit URL
                                </button>
                            </div>
                        ) : null}
                        <a
                            className="previewCardLink"
                            href={loadedUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={stopEditorControlEvent}
                        >
                            {imageUrl ? (
                                <img className="previewImage" src={imageUrl} alt="" />
                            ) : (
                                <span className="previewImage previewImageFallback">{domain.slice(0, 1).toUpperCase()}</span>
                            )}
                            <span className="previewText">
                                <span className="previewSite">{domain}</span>
                                <strong>{isLoading ? 'Loading preview...' : title}</strong>
                                {description ? <span className="previewDescription">{description}</span> : null}
                                {failed ? <span className="previewDescription">Preview unavailable</span> : null}
                            </span>
                        </a>
                    </>
                )}
            </div>
            <div className="previewSubtitle">{subtitle}</div>
        </div>
    );
}

const previewUrlInvalidMessage = (reason: PreviewUrlInvalidReason): string => {
    switch (reason) {
        case 'empty':
            return 'Enter a URL.';
        case 'unsupported-protocol':
            return 'Use an http or https URL.';
        case 'invalid':
            return 'Enter an absolute URL.';
    }
};

function ImagePreview({
    attachment,
    attachmentId,
}: {
    attachment: ImageAttachment | null;
    attachmentId: string;
}) {
    if (attachment?.objectUrl) {
        return (
            <img
                className="imagePreview"
                src={attachment.objectUrl}
                alt={attachment.name || 'Uploaded image'}
                width={attachment.width}
                height={attachment.height}
                contentEditable={false}
            />
        );
    }
    return (
        <div className="imageMissing" contentEditable={false}>
            <span>Missing image</span>
            <code>{attachmentId}</code>
        </div>
    );
}

const stopEditorControlEvent = (event: {stopPropagation(): void}) => {
    event.stopPropagation();
};

const isJsdom = () => navigator.userAgent.includes('jsdom');

const imageFilesFromDataTransfer = (dataTransfer: DataTransfer): File[] => {
    const files = Array.from(dataTransfer.files ?? []).filter(isImageFile);
    if (files.length) return files;
    return Array.from(dataTransfer.items ?? [])
        .filter((item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')))
        .map((item) => item.getAsFile())
        .filter((file): file is File => {
            if (!file) return false;
            return isImageFile(file);
        });
};

const isImageFile = (file: File): boolean =>
    file.type.startsWith('image/') || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name);

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

const measureInput = (
    onInputMeasured: ((label: string, ms: number) => void) | undefined,
    label: string,
    action: () => void,
) => {
    const started = performance.now();
    try {
        action();
    } finally {
        onInputMeasured?.(label, performance.now() - started);
    }
};

const measureTextInput = (
    onInputMeasured: ((label: string, ms: number) => void) | undefined,
    onDisplayInputRenderStarted: ((label: string, started: number) => void) | undefined,
    text: string,
    action: () => void,
) => {
    const started = performance.now();
    const label = textInputLabel(text);
    try {
        action();
    } finally {
        const handledAt = performance.now();
        onInputMeasured?.(label, handledAt - started);
        if (isDisplayableKeyText(text)) {
            onDisplayInputRenderStarted?.(label, performance.now());
        }
    }
};

const textInputLabel = (text: string): string =>
    text.length <= 2 && !/\s/.test(text) ? text : 'text';

const isDisplayableKeyText = (text: string): boolean =>
    text.length > 0 && !/[\u0000-\u001f\u007f]/.test(text);

const beforeInputLabel = (event: InputEvent): string => {
    if (event.inputType === 'insertText' && event.data) {
        return textInputLabel(event.data);
    }
    if (event.inputType === 'deleteContentBackward') return 'Backspace';
    if (event.inputType === 'deleteContentForward') return 'Delete';
    return event.inputType || 'input';
};

const keyboardEventLabel = (event: KeyboardEvent): string => {
    const modifiers = [
        event.metaKey ? 'Meta' : '',
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    return [...modifiers, event.key].join('+') + (event.repeat ? ' repeat' : '');
};

const formatDuration = (ms: number): string => {
    if (ms >= 100) return String(Math.round(ms));
    if (ms >= 10) return ms.toFixed(1);
    return ms.toFixed(2);
};

const keyPerfClass = (ms: number): string => {
    if (ms > 16) return 'slow';
    if (ms >= 8) return 'medium';
    return 'fast';
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
    if (selection.type === 'block') {
        return `block:${selection.anchorBlockId}:${selection.focusBlockId}`;
    }
    if (selection.type === 'table-cells') {
        return `table-cells:${selection.tableId}:${selection.anchorCellId}:${selection.focusCellId}`;
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
        rainbowLamportIds,
        decorations,
        trailingCodeNewline,
        syntaxTokens,
        ingredientTokens,
        footnoteNumbers: [...footnoteNumberById.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });

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
        popoverTextById?: Map<string, string>;
        footnoteNumberById?: Map<string, number>;
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
    const span = document.createElement('span');
    span.textContent = chunk.text;
    applyRunClasses(span, chunk, options.popoverTextById);
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
