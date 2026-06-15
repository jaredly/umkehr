import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type MutableRefObject,
    type ReactElement,
} from 'react';
import {materializeFormattedBlocks} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {moveBlock, setBlockMeta, type CommandResult} from './blockCommands';
import {
    annotationVirtualParents,
    annotationMarkBehavior,
    createAnnotation,
    deleteAnnotationBodyBackward,
    deleteAnnotationBodyForward,
    renderedAnnotations,
    replaceAnnotationBodySelection,
    toggleAnnotationBodyMark,
    type AnnotationMarkData,
    type AnnotationPresentation,
} from './annotations';
import {
    makeCommandContext,
    nextReplicaTs,
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
    insertTextEverywhere,
    moveSelectionsHorizontally,
    moveSelectionsVertically,
    pastePlainTextEverywhere,
    setBlockTypeEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
    updateBlockMetaEverywhere,
    unindentSelections,
    type HorizontalMovementUnit,
    type MultiCommandResult,
} from './multiSelectionCommands';
import {useBlockReorder, type DropTarget} from './useBlockReorder';
import {
    appendSelection,
    decorationsForSelectionSet,
    primarySelection,
    replacePrimarySelection,
    replaceSelectionSet,
    resolveSelectionSet,
    retainSelectionSet,
    type BlockSelectionDecorations,
    type EditorSelectionSet,
    type RetainedSelectionSet,
} from './selectionSet';
import {findWordOccurrences, wordAtPoint} from './wordOccurrences';
import {
    appendHistoryAction,
    appendHistoryKeystroke,
    initialHistoryState,
    parseHistoryExport,
    replayHistory,
    resetHistoryState,
    serializeHistory,
    setHistoryCursor,
    type HistoryKeystroke,
    type HistoryState,
} from './history';
import {createRedoAction, createUndoAction, deriveUndoState} from './undoHistory';
import {BlogVisualDemos} from './BlogVisualDemos';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;
type RenderedAnnotation = ReturnType<typeof renderedAnnotations>[number];
type ActivePopover = {
    id: string;
    top: number;
    left: number;
    source: 'hover' | 'selection';
};

export function App() {
    return hasDemoQuery() ? <BlogVisualDemos /> : <EditorApp />;
}

function EditorApp() {
    const [history, setHistory] = useState<HistoryState>(() => initialHistoryState());
    const [transientSelections, setTransientSelections] = useState<
        Partial<Record<EditorId, RetainedSelectionSet>>
    >({});
    const [historyStatus, setHistoryStatus] = useState('');
    const [undoStatus, setUndoStatus] = useState<Partial<Record<EditorId, string>>>({});
    const [historyResetSignal, setHistoryResetSignal] = useState(0);
    const importInputRef = useRef<HTMLInputElement>(null);
    const demo = useMemo(
        () => replayHistory(history.actions, history.cursor),
        [history.actions, history.cursor],
    );
    const displayDemo = useMemo(
        () => overlayTransientSelections(demo, transientSelections),
        [demo, transientSelections],
    );
    const undoStates = useMemo(
        () => ({
            left: deriveUndoState(history, 'left'),
            right: deriveUndoState(history, 'right'),
        }),
        [history],
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
            setHistory((current) =>
                appendHistoryAction(current, {
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
                }),
            );
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
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const verticalCaretXRef = useRef<number | null>(null);
    const nextSelectionIdRef = useRef(1);
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
    const [hasFocus, setHasFocus] = useState(false);
    const [isExtendingSelection, setIsExtendingSelection] = useState(false);
    const [activeAnnotationBodySelection, setActiveAnnotationBodySelection] =
        useState<EditorSelection | null>(null);
    const [activePopover, setActivePopover] = useState<ActivePopover | null>(null);
    const popoverHideTimerRef = useRef<number | null>(null);
    const popoverHasFocusRef = useRef(false);
    const blocks = materializeFormattedBlocks(replica.state, annotationMarkBehavior);
    const blocksWithAnnotationBodies = materializeFormattedBlocks(
        replica.state,
        annotationVirtualParents(replica.state),
    );
    const annotations = renderedAnnotations(replica.state, blocks, blocksWithAnnotationBodies);
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
            const text = annotation.bodyBlocks.map((block) => block.text).filter(Boolean).join('\n');
            result.set(annotation.id, text || 'Empty popover');
        }
        return result;
    }, [annotations]);
    const renderTree = useMemo(() => buildRenderTree(blocks), [blocks]);
    const orderedListNumbers = useMemo(() => deriveOrderedListNumbers(blocks), [blocks]);
    const resolvedSelectionSet = resolveSelectionSet(replica.state, replica.selection);
    const primaryResolvedSelection = primarySelection(resolvedSelectionSet);
    const selectedPopoverSelection = activeAnnotationBodySelection ?? primaryResolvedSelection;
    const selectedPopoverSelectionKey = editorSelectionKey(selectedPopoverSelection);
    const selectedPopoverId = useMemo(
        () =>
            selectedPopoverIdForSelection(
                blocksWithAnnotationBodies,
                selectedPopoverSelection,
                popoverTextById,
            ),
        [blocksWithAnnotationBodies, popoverTextById, selectedPopoverSelectionKey],
    );
    const selectedBlockType = blockTypeMenuValue(
        replica.state.state.blocks[focusPoint(primaryResolvedSelection).blockId]?.meta,
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

    const cancelPopoverHide = useCallback(() => {
        if (popoverHideTimerRef.current === null) return;
        window.clearTimeout(popoverHideTimerRef.current);
        popoverHideTimerRef.current = null;
    }, []);

    const popoverContainsFocus = useCallback(() => {
        const panel = rootRef.current?.closest<HTMLElement>('.editorPanel');
        const popover = panel?.querySelector<HTMLElement>('.annotationFloatingPopover');
        return Boolean(
            popover && document.activeElement instanceof Node && popover.contains(document.activeElement),
        );
    }, []);

    const schedulePopoverHide = useCallback(() => {
        if (popoverHasFocusRef.current && popoverContainsFocus()) return;
        cancelPopoverHide();
        popoverHideTimerRef.current = window.setTimeout(() => {
            popoverHideTimerRef.current = null;
            if (popoverHasFocusRef.current && popoverContainsFocus()) return;
            setActivePopover((current) => (current?.source === 'selection' ? current : null));
        }, 300);
    }, [cancelPopoverHide, popoverContainsFocus]);

    const schedulePopoverHideFromPointer = useCallback(() => {
        if (popoverHasFocusRef.current && popoverContainsFocus()) return;
        schedulePopoverHide();
    }, [popoverContainsFocus, schedulePopoverHide]);

    const showPopover = useCallback(
        (id: string, element: HTMLElement, source: ActivePopover['source'] = 'hover') => {
            cancelPopoverHide();
            const rect = element.getBoundingClientRect();
            const width = 320;
            const margin = 12;
            const availableWidth = window.innerWidth || document.documentElement.clientWidth || width;
            setActivePopover({
                id,
                top: rect.bottom + 8,
                left: Math.max(margin, Math.min(rect.left, availableWidth - width - margin)),
                source,
            });
        },
        [cancelPopoverHide],
    );

    const setPopoverFocusPinned = useCallback(
        (focused: boolean) => {
            popoverHasFocusRef.current = focused;
            if (focused) {
                cancelPopoverHide();
            } else {
                schedulePopoverHide();
            }
        },
        [cancelPopoverHide, schedulePopoverHide],
    );

    const resetVerticalCaretIntent = useCallback(() => {
        verticalCaretXRef.current = null;
    }, []);

    const nextSelectionId = useCallback(() => `sel-${nextSelectionIdRef.current++}`, []);

    useLayoutEffect(() => {
        pendingCaretRestoreBlockIdRef.current = null;
        pendingSelectionRestoreRef.current = null;
        verticalCaretXRef.current = null;
        pendingMultiselectClickRef.current = null;
        pendingAddSelectionClickRef.current = null;
        handledTripleClickRef.current = false;
        handledNavigationKeyRef.current = false;
        setIsExtendingSelection(false);
    }, [resetSignal]);

    useLayoutEffect(
        () => () => {
            if (popoverHideTimerRef.current !== null) {
                window.clearTimeout(popoverHideTimerRef.current);
            }
        },
        [],
    );

    useLayoutEffect(() => {
        if (!selectedPopoverId) {
            setActivePopover((current) =>
                current?.source === 'selection' && !popoverContainsFocus() ? null : current,
            );
            return;
        }
        const root = rootRef.current;
        const panel = root?.closest<HTMLElement>('.editorPanel');
        const trigger = panel?.querySelector<HTMLElement>(
            `[data-popover-id="${CSS.escape(selectedPopoverId)}"]`,
        );
        if (!trigger) return;
        showPopover(selectedPopoverId, trigger, 'selection');
    }, [popoverContainsFocus, selectedPopoverId, selectedPopoverSelectionKey, showPopover]);

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
        [nextSelectionId, onCommand, resetVerticalCaretIntent, scheduleSelectionRestore],
    );

    const captureMouseDown = useCallback(
        (event: MouseEvent<HTMLElement>) => {
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

    const runBlockControlCommand = useCallback(
        (command: (current: Replica) => MultiCommandResult) => {
            onCommand((current) => command(current));
        },
        [onCommand],
    );

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
                onUndo={onUndo}
                onRedo={onRedo}
                onBold={() =>
                    runEditCommand((current, selection) =>
                        toggleMarkEverywhere(
                            current.state,
                            selection,
                            'bold',
                            makeCommandContext(current),
                        ),
                    )
                }
                onItalic={() =>
                    runEditCommand((current, selection) =>
                        toggleMarkEverywhere(
                            current.state,
                            selection,
                            'italic',
                            makeCommandContext(current),
                        ),
                    )
                }
                onAnnotation={(presentation) =>
                    activeAnnotationBodySelection
                        ? runBlockControlCommand((current) => {
                              const result = createAnnotation(
                                  current.state,
                                  activeAnnotationBodySelection,
                                  presentation,
                                  makeCommandContext(current),
                              );
                              return {state: result.state, ops: result.ops, selection: current.selection};
                          })
                        : runEditCommand((current, selection) => {
                              const result = createAnnotation(
                                  current.state,
                                  primarySelection(resolveSelectionSet(current.state, selection)),
                                  presentation,
                                  makeCommandContext(current),
                              );
                              return {state: result.state, ops: result.ops, selection};
                          })
                }
                onBlockType={(kind) =>
                    runEditCommand((current, selection) =>
                        setBlockTypeEverywhere(current.state, selection, (_blockId, meta) =>
                            blockTypeMeta(kind, meta, nextReplicaTs(current)),
                        ),
                    )
                }
            />
            {undoStatus || undoState.undoReason || undoState.redoReason ? (
                <p className="editorUndoStatus">
                    {undoStatus || undoState.undoReason || undoState.redoReason}
                </p>
            ) : null}
            <AnnotationSidebar
                annotations={annotations.filter((item) => item.data.presentation === 'sidebar')}
                onBodyCommand={runAnnotationBodyCommand}
                onBodySelectionChange={setActiveAnnotationBodySelection}
                popoverTextById={popoverTextById}
                onPopoverTriggerEnter={showPopover}
                onPopoverTriggerLeave={schedulePopoverHideFromPointer}
            />
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
                    setHasFocus(false);
                }}
                onMouseDown={captureMouseDown}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
            >
                {renderTree.map((node) =>
                    renderBlockNode(node, {
                        blocks,
                        state: replica.state,
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
                        onPopoverTriggerEnter: showPopover,
                        onPopoverTriggerLeave: schedulePopoverHide,
                        runEditCommand,
                        runBlockControlCommand,
                        moveCaretHorizontally,
                        moveCaretVertically,
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
            <FloatingAnnotationPopover
                annotation={
                    activePopover ? popoverAnnotationsById.get(activePopover.id) ?? null : null
                }
                position={activePopover}
                onMouseEnter={cancelPopoverHide}
                onMouseLeave={schedulePopoverHideFromPointer}
                onFocusChange={setPopoverFocusPinned}
                onBodyCommand={runAnnotationBodyCommand}
                onBodySelectionChange={setActiveAnnotationBodySelection}
                popoverTextById={popoverTextById}
                onPopoverTriggerEnter={showPopover}
                onPopoverTriggerLeave={schedulePopoverHideFromPointer}
            />
            <Footnotes
                annotations={annotations.filter((item) => item.data.presentation === 'footnote')}
                onBodyCommand={runAnnotationBodyCommand}
                onBodySelectionChange={setActiveAnnotationBodySelection}
                popoverTextById={popoverTextById}
                onPopoverTriggerEnter={showPopover}
                onPopoverTriggerLeave={schedulePopoverHideFromPointer}
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
    | 'callout-error';

type RenderBlockContext = {
    blocks: RichFormattedBlock[];
    state: Replica['state'];
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
    runEditCommand(
        command: (current: Replica, selection: RetainedSelectionSet) => MultiCommandResult,
    ): void;
    runBlockControlCommand(command: (current: Replica) => MultiCommandResult): void;
    moveCaretHorizontally(selection: EditorSelection): void;
    moveCaretVertically(sourceBlock: HTMLElement, targetBlockId: string): void;
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
    onPopoverTriggerLeave(): void;
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

const renderEditableBlock = (block: RichFormattedBlock, context: RenderBlockContext) => {
    const index = context.blocks.findIndex((candidate) => candidate.id === block.id);
    const previousBlock = context.blocks[index - 1] ?? null;
    const nextBlock = context.blocks[index + 1] ?? null;
    return (
        <EditableBlock
            key={block.id}
            block={block}
            listNumber={context.orderedListNumbers.get(block.id) ?? null}
            previousBlockId={previousBlock?.id ?? null}
            previousBlockLength={
                previousBlock ? pointTextLength(context.state, previousBlock.id) : 0
            }
            blockLength={pointTextLength(context.state, block.id)}
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
            onPopoverTriggerEnter={context.onPopoverTriggerEnter}
            onPopoverTriggerLeave={context.onPopoverTriggerLeave}
            onInsertText={(text) =>
                context.runEditCommand((current, selection) =>
                    insertTextEverywhere(
                        current.state,
                        selection,
                        text,
                        makeCommandContext(current),
                    ),
                )
            }
            onDeleteBackward={() =>
                context.runEditCommand((current, selection) =>
                    deleteBackwardEverywhere(current.state, selection, makeCommandContext(current)),
                )
            }
            onDeleteForward={() =>
                context.runEditCommand((current, selection) =>
                    deleteForwardEverywhere(current.state, selection, makeCommandContext(current)),
                )
            }
            onSplit={() =>
                context.runEditCommand((current, selection) =>
                    splitBlockEverywhere(current.state, selection, makeCommandContext(current)),
                )
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
            onToggleBold={() =>
                context.runEditCommand((current, selection) =>
                    toggleMarkEverywhere(
                        current.state,
                        selection,
                        'bold',
                        makeCommandContext(current),
                    ),
                )
            }
            onToggleItalic={() =>
                context.runEditCommand((current, selection) =>
                    toggleMarkEverywhere(
                        current.state,
                        selection,
                        'italic',
                        makeCommandContext(current),
                    ),
                )
            }
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
            onPasteText={(text) =>
                context.runEditCommand((current, selection) =>
                    pastePlainTextEverywhere(
                        current.state,
                        selection,
                        text,
                        makeCommandContext(current),
                    ),
                )
            }
            onMoveCaret={context.moveCaretHorizontally}
            onMoveCaretVertically={context.moveCaretVertically}
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
        case 'table_row':
            return 'paragraph';
    }
};


function AnnotationSidebar({
    annotations,
    onBodyCommand,
    onBodySelectionChange,
    popoverTextById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    annotations: ReturnType<typeof renderedAnnotations>;
    onBodyCommand(
        command: (current: Replica, context: ReturnType<typeof makeCommandContext>) => CommandResult,
    ): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(): void;
}) {
    if (!annotations.length) return null;
    return (
        <aside className="annotationSidebar" aria-label="Comments">
            {annotations.map((annotation) => (
                <section key={annotation.id} className="annotationCard">
                    <strong>Comment on “{annotation.referenceText}”</strong>
                    {annotation.bodyBlocks.map((block) => (
                        <AnnotationBodyBlock
                            key={block.id}
                            block={block}
                            onBodyCommand={onBodyCommand}
                            onBodySelectionChange={onBodySelectionChange}
                            popoverTextById={popoverTextById}
                            onPopoverTriggerEnter={onPopoverTriggerEnter}
                            onPopoverTriggerLeave={onPopoverTriggerLeave}
                        />
                    ))}
                </section>
            ))}
        </aside>
    );
}

function Footnotes({
    annotations,
    onBodyCommand,
    onBodySelectionChange,
    popoverTextById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    annotations: ReturnType<typeof renderedAnnotations>;
    onBodyCommand(
        command: (current: Replica, context: ReturnType<typeof makeCommandContext>) => CommandResult,
    ): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(): void;
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
                                  block={block}
                                  fallbackText={annotation.referenceText}
                                  onBodyCommand={onBodyCommand}
                                  onBodySelectionChange={onBodySelectionChange}
                                  popoverTextById={popoverTextById}
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
    annotation,
    position,
    onMouseEnter,
    onMouseLeave,
    onFocusChange,
    onBodyCommand,
    onBodySelectionChange,
    popoverTextById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    annotation: RenderedAnnotation | null;
    position: ActivePopover | null;
    onMouseEnter(): void;
    onMouseLeave(): void;
    onFocusChange(focused: boolean): void;
    onBodyCommand(
        command: (current: Replica, context: ReturnType<typeof makeCommandContext>) => CommandResult,
    ): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(): void;
}) {
    if (!annotation || !position) return null;
    return (
        <section
            className="annotationFloatingPopover"
            role="dialog"
            aria-label="Popover"
            style={{top: position.top, left: position.left}}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={() => onFocusChange(true)}
            onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                onFocusChange(false);
            }}
        >
            <strong>Popover on “{annotation.referenceText}”</strong>
            {annotation.bodyBlocks.map((block) => (
                <AnnotationBodyBlock
                    key={block.id}
                    block={block}
                    fallbackText={annotation.referenceText}
                    onBodyCommand={onBodyCommand}
                    onBodySelectionChange={onBodySelectionChange}
                    popoverTextById={popoverTextById}
                    onPopoverTriggerEnter={onPopoverTriggerEnter}
                    onPopoverTriggerLeave={onPopoverTriggerLeave}
                />
            ))}
        </section>
    );
}

function AnnotationBodyBlock({
    block,
    fallbackText = '',
    onBodyCommand,
    onBodySelectionChange,
    popoverTextById,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
}: {
    block: ReturnType<typeof renderedAnnotations>[number]['bodyBlocks'][number];
    fallbackText?: string;
    onBodyCommand(
        command: (current: Replica, context: ReturnType<typeof makeCommandContext>) => CommandResult,
    ): void;
    onBodySelectionChange(selection: EditorSelection | null): void;
    popoverTextById: Map<string, string>;
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(): void;
}) {
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const [selection, setSelection] = useState<EditorSelection>(() => caret(block.id, block.text.length));

    const restoreAfter = useCallback((selection: EditorSelection) => {
        pendingCaretRestoreBlockIdRef.current =
            selection.type === 'caret' && selection.point.blockId === block.id ? block.id : null;
        pendingSelectionRestoreRef.current = selection.type === 'range' ? selection : null;
        setSelection(selection);
        onBodySelectionChange(selection);
    }, [block.id, onBodySelectionChange]);

    const updateSelection = useCallback((nextSelection: EditorSelection | null) => {
        setSelection(nextSelection ?? caret(block.id, block.text.length));
        onBodySelectionChange(nextSelection);
    }, [block.id, block.text.length, onBodySelectionChange]);

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
                restoreAfter(result.selection);
                return result;
            });
        },
        [onBodyCommand, restoreAfter],
    );

    return (
        <RichTextEditableSurface
            blockId={block.id}
            runs={block.runs}
            decorations={null}
            pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
            pendingSelectionRestoreRef={pendingSelectionRestoreRef}
            selection={selection}
            className="annotationBodyEditor"
            ariaLabel="Annotation body"
            placeholder={fallbackText || 'Annotation body'}
            popoverTextById={popoverTextById}
            onPopoverTriggerEnter={onPopoverTriggerEnter}
            onPopoverTriggerLeave={onPopoverTriggerLeave}
            onSelectionChange={updateSelection}
            onInsertText={(text, activeSelection) =>
                run(activeSelection ?? selection, (state, selected, context) =>
                    replaceAnnotationBodySelection(state, selected, text, context),
                )
            }
            onDeleteBackward={(activeSelection) =>
                run(activeSelection ?? selection, deleteAnnotationBodyBackward)
            }
            onDeleteForward={(activeSelection) =>
                run(activeSelection ?? selection, deleteAnnotationBodyForward)
            }
            onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData('text/plain');
                run(readSelectionFromDom(event.currentTarget) ?? selection, (state, selected, context) =>
                    replaceAnnotationBodySelection(state, selected, text, context),
                );
            }}
            onKeyDown={(event) => {
                const currentSelection = readSelectionFromDom(event.currentTarget);
                if (currentSelection) updateSelection(currentSelection);
                const modifierPressed = event.metaKey || event.ctrlKey;
                const key = event.key.toLowerCase();
                if (event.key === 'Enter') {
                    event.preventDefault();
                    run(currentSelection ?? selection, (state, selected, context) =>
                        replaceAnnotationBodySelection(state, selected, '\n', context),
                    );
                    return;
                }
                if (modifierPressed && (key === 'b' || key === 'i')) {
                    const selected = currentSelection ?? selection;
                    event.preventDefault();
                    run(selected, (state, activeSelection, context) =>
                        toggleAnnotationBodyMark(state, activeSelection, key === 'b' ? 'bold' : 'italic', context),
                    );
                }
            }}
        />
    );
}

const renderStaticRuns = (runs: RichFormattedBlock['runs']): ReactElement[] =>
    runs.map((run, index) => (
        <span
            key={index}
            className={[
                run.marks.bold ? 'markBold' : '',
                run.marks.italic ? 'markItalic' : '',
                hasAnnotationMark(run) ? 'markAnnotation' : '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            {run.text}
        </span>
    ));

function Toolbar({
    canUndo,
    canRedo,
    blockType,
    onUndo,
    onRedo,
    onBold,
    onItalic,
    onBlockType,
    onAnnotation,
}: {
    canUndo: boolean;
    canRedo: boolean;
    blockType: BlockTypeMenuValue;
    onUndo(): void;
    onRedo(): void;
    onBold(): void;
    onItalic(): void;
    onBlockType(kind: BlockTypeMenuValue): void;
    onAnnotation(presentation: AnnotationPresentation): void;
}) {
    return (
        <div className="toolbar" aria-label="Formatting">
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
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onBold}>
                <strong>B</strong>
            </button>
            <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onItalic}
            >
                <em>I</em>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAnnotation('sidebar')}>
                Comment
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAnnotation('footnote')}>
                Footnote
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAnnotation('popover')}>
                Popover
            </button>
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
            </select>
        </div>
    );
}

function EditableBlock({
    block,
    listNumber,
    previousBlockId,
    previousBlockLength,
    blockLength,
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
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onInsertText,
    onDeleteBackward,
    onDeleteForward,
    onSplit,
    onForceCodeNewline,
    onIndent,
    onUnindent,
    onToggleBold,
    onToggleItalic,
    onToggleTodo,
    onSetCodeLanguage,
    onSetCalloutKind,
    onPasteText,
    onMoveCaret,
    onMoveCaretVertically,
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
    listNumber: number | null;
    previousBlockId: string | null;
    previousBlockLength: number;
    blockLength: number;
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
    onPopoverTriggerEnter(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave(): void;
    onInsertText(text: string, selection?: EditorSelection): void;
    onDeleteBackward(selection?: EditorSelection): void;
    onDeleteForward(selection?: EditorSelection): void;
    onSplit(): void;
    onForceCodeNewline(): void;
    onIndent(): void;
    onUnindent(): void;
    onToggleBold(): void;
    onToggleItalic(): void;
    onToggleTodo(): void;
    onSetCodeLanguage(language: string): void;
    onSetCalloutKind(kind: 'info' | 'warning' | 'error'): void;
    onPasteText(text: string): void;
    onMoveCaret(selection: EditorSelection): void;
    onMoveCaretVertically(sourceBlock: HTMLElement, targetBlockId: string): void;
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
        meta.type === 'code' && block.runs.map((run) => run.text).join('').endsWith('\n');

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
            <button
                type="button"
                className="dragHandle"
                aria-label="Move block"
                onPointerDown={(event) => onStartDrag(block.id, event)}
            >
                ⋮⋮
            </button>
            <BlockAffordance meta={meta} listNumber={listNumber} onToggleTodo={onToggleTodo} />
            <RichTextEditableSurface
                blockId={block.id}
                runs={block.runs}
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
                popoverTextById={popoverTextById}
                onPopoverTriggerEnter={onPopoverTriggerEnter}
                onPopoverTriggerLeave={onPopoverTriggerLeave}
                onInsertText={onInsertText}
                onDeleteBackward={onDeleteBackward}
                onDeleteForward={onDeleteForward}
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
                    } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (meta.type === 'code' && event.shiftKey) {
                            onForceCodeNewline();
                        } else {
                            onSplit();
                        }
                    } else if (event.key === 'Tab' && !event.altKey && !modifierPressed) {
                        event.preventDefault();
                        if (meta.type === 'code') {
                            onInsertText('    ');
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
                            event.preventDefault();
                            onMoveCaretVertically(event.currentTarget, nextBlockId);
                        }
                    }
                }}
                onPaste={(event) => {
                    event.preventDefault();
                    onPasteText(event.clipboardData.getData('text/plain'));
                }}
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
    decorations,
    pendingCaretRestoreBlockIdRef,
    pendingSelectionRestoreRef,
    selection,
    className,
    ariaLabel,
    placeholder,
    trailingCodeNewline = false,
    popoverTextById = new Map(),
    onInsertText,
    onDeleteBackward,
    onDeleteForward,
    onSelectionChange,
    onPopoverTriggerEnter,
    onPopoverTriggerLeave,
    onKeyDown,
    onPaste,
}: {
    blockId: string;
    runs: RichFormattedBlock['runs'];
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    pendingSelectionRestoreRef?: MutableRefObject<EditorSelection | null>;
    selection: EditorSelection;
    className: string;
    ariaLabel: string;
    placeholder?: string;
    trailingCodeNewline?: boolean;
    popoverTextById?: Map<string, string>;
    onInsertText(text: string, selection?: EditorSelection): void;
    onDeleteBackward(selection?: EditorSelection): void;
    onDeleteForward(selection?: EditorSelection): void;
    onSelectionChange?(selection: EditorSelection | null): void;
    onPopoverTriggerEnter?(id: string, element: HTMLElement): void;
    onPopoverTriggerLeave?(): void;
    onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
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
        const renderedRuns = serializeRuns(runs, decorations, trailingCodeNewline);
        if (renderedRunsRef.current !== renderedRuns) {
            renderedRunsRef.current = renderedRuns;
            element.replaceChildren(
                ...renderRunNodes(runs, decorations, {trailingCodeNewline, popoverTextById}),
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
    }, [blockId, decorations, pendingCaretRestoreBlockIdRef, pendingSelectionRestoreRef, runs, selection, trailingCodeNewline]);

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
            data-placeholder={placeholder}
            data-trailing-newline={trailingCodeNewline ? 'true' : undefined}
            onFocus={(event) => {
                onSelectionChange?.(readSelectionFromDom(event.currentTarget));
                const nextDecorations = removePrimaryDecorations(decorations);
                if (nextDecorations === decorations) return;
                event.currentTarget.replaceChildren(
                    ...renderRunNodes(runs, nextDecorations, {trailingCodeNewline, popoverTextById}),
                );
                renderedRunsRef.current = serializeRuns(
                    runs,
                    nextDecorations,
                    trailingCodeNewline,
                );
            }}
            onMouseUp={(event) => onSelectionChange?.(readSelectionFromDom(event.currentTarget))}
            onKeyUp={(event) => onSelectionChange?.(readSelectionFromDom(event.currentTarget))}
            onMouseOver={(event) => {
                const trigger = popoverTriggerFromEvent(event.currentTarget, event.target);
                if (!trigger) return;
                const relatedTrigger = popoverTriggerFromEvent(
                    event.currentTarget,
                    event.relatedTarget,
                );
                if (relatedTrigger === trigger) return;
                onPopoverTriggerEnter?.(trigger.dataset.popoverId ?? '', trigger);
            }}
            onMouseOut={(event) => {
                const trigger = popoverTriggerFromEvent(event.currentTarget, event.target);
                if (!trigger) return;
                const relatedTrigger = popoverTriggerFromEvent(
                    event.currentTarget,
                    event.relatedTarget,
                );
                if (relatedTrigger === trigger) return;
                onPopoverTriggerLeave?.();
            }}
            onInput={(event) => {
                const native = event.nativeEvent as InputEvent;
                if (handledBeforeInputRef.current) {
                    handledBeforeInputRef.current = false;
                    event.currentTarget.replaceChildren(
                        ...renderRunNodes(runs, decorations, {trailingCodeNewline, popoverTextById}),
                    );
                    return;
                }
                if (native.isComposing) return;
                if (isJsdom() && native.inputType === 'insertText' && native.data) {
                    onInsertText(native.data, readSelectionFromDom(event.currentTarget) ?? undefined);
                }
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
        />
    );
}

function BlockAffordance({
    meta,
    listNumber,
    onToggleTodo,
}: {
    meta: RichBlockMeta;
    listNumber: number | null;
    onToggleTodo(): void;
}) {
    if (meta.type === 'list_item') {
        return (
            <span className="blockMarker">
                {meta.kind === 'ordered' ? `${listNumber ?? 1}.` : '•'}
            </span>
        );
    }
    if (meta.type === 'todo') {
        return (
            <input
                className="todoToggle"
                type="checkbox"
                checked={meta.checked}
                aria-label="Toggle todo"
                onMouseDown={(event) => event.preventDefault()}
                onChange={onToggleTodo}
            />
        );
    }
    return <span className="blockMarker" aria-hidden="true" />;
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

const selectedPopoverIdForSelection = (
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    popoverTextById: Map<string, string>,
): string | null => {
    const segments = selectionSegmentsForBlocks(blocks, selection);
    if (!segments.length) return null;

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
            return id;
        }
    }
    return null;
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

const serializeRuns = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    trailingCodeNewline = false,
) =>
    JSON.stringify({
        runs: runs.map((run) => [run.text, run.marks.bold, run.marks.italic]),
        stackedMarks: runs.map((run) => run.stackedMarks),
        decorations,
        trailingCodeNewline,
    });

const renderRunNodes = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
    options: {trailingCodeNewline?: boolean; popoverTextById?: Map<string, string>} = {},
): Node[] => {
    if (!decorations || (!decorations.carets.length && !decorations.segments.length)) {
        return appendTrailingCodeNewlineSentinel(
            runs.map((run) => {
            const span = document.createElement('span');
            span.textContent = run.text;
            applyRunClasses(span, run, options.popoverTextById);
            return span;
            }),
            options,
        );
    }

    const nodes: Node[] = [];
    let offset = 0;
    const renderedCarets = new Set<string>();
    for (const run of runs) {
        const runSegments = segmentText(run.text);
        const runStart = offset;
        const runEnd = runStart + runSegments.length;
        const boundaries = new Set([0, runSegments.length]);

        for (const selectionSegment of decorations.segments) {
            addBoundaryInRun(
                boundaries,
                selectionSegment.startOffset - runStart,
                runSegments.length,
            );
            addBoundaryInRun(boundaries, selectionSegment.endOffset - runStart, runSegments.length);
        }
        for (const caret of decorations.carets) {
            addBoundaryInRun(boundaries, caret.offset - runStart, runSegments.length);
        }

        const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
        for (let index = 0; index < sortedBoundaries.length - 1; index++) {
            const start = sortedBoundaries[index];
            const end = sortedBoundaries[index + 1];
            const chunkStart = runStart + start;
            const chunkEnd = runStart + end;
            renderCaretsAtOffset(nodes, decorations, renderedCarets, chunkStart);
            if (start === end) continue;

            const span = document.createElement('span');
            span.textContent = runSegments.slice(start, end).join('');
            applyRunClasses(span, run, options.popoverTextById);
            const highlight = decorations.segments.find(
                (selectionSegment) =>
                    chunkStart >= selectionSegment.startOffset &&
                    chunkEnd <= selectionSegment.endOffset,
            );
            if (highlight) {
                span.classList.add('retainedSelectionHighlight');
                span.dataset.retainedSelection = 'highlight';
                span.dataset.selectionEntryId = highlight.id;
                span.dataset.selectionPrimary = String(highlight.primary);
            }
            nodes.push(span);
        }
        offset = runEnd;
    }
    renderCaretsAtOffset(nodes, decorations, renderedCarets, offset);
    return appendTrailingCodeNewlineSentinel(nodes, options);
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
    run: RichFormattedBlock['runs'][number],
    popoverTextById?: Map<string, string>,
) => {
    if (run.marks.bold) span.classList.add('markBold');
    if (run.marks.italic) span.classList.add('markItalic');
    if (hasAnnotationMark(run)) span.classList.add('markAnnotation');
    const popoverId = popoverIdsForRun(run, popoverTextById)[0] ?? null;
    if (popoverId) {
        span.classList.add('markPopover');
        span.dataset.popoverId = popoverId;
        span.setAttribute('aria-label', 'Popover');
    }
};

const hasAnnotationMark = (run: RichFormattedBlock['runs'][number]) =>
    Boolean(run.marks.annotation || run.stackedMarks?.annotation?.length);

const popoverIdsForRun = (
    run: RichFormattedBlock['runs'][number],
    popoverTextById?: Map<string, string>,
): string[] => {
    if (!popoverTextById) return [];
    const result: string[] = [];
    for (const value of run.stackedMarks?.annotation ?? []) {
        if (!isAnnotationMarkData(value)) continue;
        const id = lamportToString(value.id);
        if (popoverTextById.has(id)) result.push(id);
    }
    if (isAnnotationMarkData(run.marks.annotation)) {
        const id = lamportToString(run.marks.annotation.id);
        if (popoverTextById.has(id)) result.push(id);
    }
    return result;
};

const isAnnotationMarkData = (value: unknown): value is AnnotationMarkData =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AnnotationMarkData).id) &&
    (value as AnnotationMarkData).presentation === 'popover';

const capitalize = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

const renderRetainedCaret = (id: string, primary: boolean) => {
    const span = document.createElement('span');
    span.className = 'retainedSelectionCaret';
    span.dataset.retainedSelection = 'caret';
    span.dataset.selectionEntryId = id;
    span.dataset.selectionPrimary = String(primary);
    span.contentEditable = 'false';
    return span;
};
