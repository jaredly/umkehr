import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type MutableRefObject,
    type ReactElement,
} from 'react';
import {materializeFormattedBlocks} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import {moveBlock, setBlockMeta} from './blockCommands';
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
    firstPointForSelection,
    focusPoint,
    pointTextLength,
    segmentText,
    visibleBlockIds,
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
    const blocks = materializeFormattedBlocks(replica.state);
    const renderTree = useMemo(() => buildRenderTree(blocks), [blocks]);
    const orderedListNumbers = useMemo(() => deriveOrderedListNumbers(blocks), [blocks]);
    const resolvedSelectionSet = resolveSelectionSet(replica.state, replica.selection);
    const primaryResolvedSelection = primarySelection(resolvedSelectionSet);
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
                const blockOrder = visibleBlockIds(current.state);
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
            <div
                ref={rootRef}
                className="blockList"
                onFocus={() => setHasFocus(true)}
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

function Toolbar({
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onBold,
    onItalic,
    onBlockType,
}: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo(): void;
    onRedo(): void;
    onBold(): void;
    onItalic(): void;
    onBlockType(kind: BlockTypeMenuValue): void;
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
            <select
                aria-label="Block type"
                defaultValue="paragraph"
                onChange={(event) => {
                    onBlockType(event.currentTarget.value as BlockTypeMenuValue);
                    event.currentTarget.value = 'paragraph';
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
    onInsertText,
    onDeleteBackward,
    onDeleteForward,
    onSplit,
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
    onInsertText(text: string): void;
    onDeleteBackward(): void;
    onDeleteForward(): void;
    onSplit(): void;
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
    const handledBeforeInputRef = useRef(false);
    const editableRef = useRef<HTMLDivElement>(null);
    const renderedRunsRef = useRef('');

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;

        const onBeforeInput = (event: InputEvent) => {
            if (event.isComposing) return;
            if (event.inputType === 'insertText' && event.data) {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onInsertText(event.data);
            } else if (event.inputType === 'deleteContentBackward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onDeleteBackward();
            } else if (event.inputType === 'deleteContentForward') {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onDeleteForward();
            }
        };

        element.addEventListener('beforeinput', onBeforeInput);
        return () => element.removeEventListener('beforeinput', onBeforeInput);
    }, [onDeleteBackward, onDeleteForward, onInsertText]);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;
        const renderedRuns = serializeRuns(block.runs, decorations);
        if (renderedRunsRef.current !== renderedRuns) {
            renderedRunsRef.current = renderedRuns;
            const children = renderRunNodes(block.runs, decorations);
            element.replaceChildren(...children);
        }
        const point = selection.type === 'caret' ? selection.point : null;
        if (point?.blockId === block.id && pendingCaretRestoreBlockIdRef.current === block.id) {
            pendingCaretRestoreBlockIdRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreCaretToDom(element, point.offset);
        }
    }, [block.id, block.runs, decorations, pendingCaretRestoreBlockIdRef, selection]);

    const meta = block.block.meta;

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
            <div
                ref={editableRef}
                className={[
                    'editableBlock',
                    meta.type === 'code' ? 'codeBlock' : '',
                    meta.type === 'heading' ? `headingLevel${meta.level}` : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                contentEditable
                role="textbox"
                aria-label="Block text"
                suppressContentEditableWarning
                spellCheck
                data-block-id={block.id}
                data-empty={block.runs.length === 0 ? 'true' : undefined}
                onFocus={(event) => {
                    const nextDecorations = removePrimaryDecorations(decorations);
                    if (nextDecorations === decorations) return;
                    event.currentTarget.replaceChildren(
                        ...renderRunNodes(block.runs, nextDecorations),
                    );
                    renderedRunsRef.current = serializeRuns(block.runs, nextDecorations);
                }}
                onInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (handledBeforeInputRef.current) {
                        handledBeforeInputRef.current = false;
                        event.currentTarget.replaceChildren(
                            ...renderRunNodes(block.runs, decorations),
                        );
                        return;
                    }
                    if (native.isComposing) return;
                    if (isJsdom() && native.inputType === 'insertText' && native.data) {
                        onInsertText(native.data);
                    }
                }}
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
                        onSplit();
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

const serializeRuns = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
) =>
    JSON.stringify({
        runs: runs.map((run) => [run.text, run.marks.bold, run.marks.italic]),
        decorations,
    });

const renderRunNodes = (
    runs: RichFormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
): Node[] => {
    if (!decorations || (!decorations.carets.length && !decorations.segments.length)) {
        return runs.map((run) => {
            const span = document.createElement('span');
            span.textContent = run.text;
            applyRunClasses(span, run);
            return span;
        });
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
            applyRunClasses(span, run);
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
    return nodes;
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

const applyRunClasses = (span: HTMLElement, run: RichFormattedBlock['runs'][number]) => {
    if (run.marks.bold) span.classList.add('markBold');
    if (run.marks.italic) span.classList.add('markItalic');
};

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
