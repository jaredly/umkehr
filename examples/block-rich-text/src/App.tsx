import {useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject} from 'react';
import {blockContents, materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import {
    deleteBackward,
    insertText,
    moveBlock,
    pastePlainText,
    splitBlock,
    toggleMark,
    type CommandResult,
} from './blockCommands';
import {
    applyLocalChange,
    createDemoState,
    makeCommandContext,
    toggleOnline,
    type DemoState,
    type EditorId,
    type Replica,
} from './blockEditorRuntime';
import {readSelectionFromDom, restoreCaretToDom, restoreSelectionToDom} from './domSelection';
import {resolveSelection, retainSelection} from './retainedSelection';
import {
    normalizeSelectionSegments,
    segmentText,
    type EditorSelection,
    type SelectionSegment,
} from './selectionModel';
import {useBlockReorder, type DropTarget} from './useBlockReorder';

export function App() {
    const [demo, setDemo] = useState<DemoState>(() => createDemoState());
    const [logs, setLogs] = useState<Record<EditorId, string[]>>({left: [], right: []});

    const runCommand = useCallback((editorId: EditorId, command: (replica: Replica) => CommandResult) => {
        setDemo((current) => {
            const replica = current[editorId];
            const result = command(replica);
            return applyLocalChange(current, {
                editorId,
                state: result.state,
                selection: retainSelection(result.state, result.selection),
                ops: result.ops,
            });
        });
    }, []);

    const appendLog = useCallback((editorId: EditorId, message: string) => {
        setLogs((current) => ({
            ...current,
            [editorId]: [`${new Date().toLocaleTimeString()} ${message}`, ...current[editorId]].slice(
                0,
                80,
            ),
        }));
    }, []);

    return (
        <main className="appShell">
            <header className="topBar">
                <h1>Block Rich Text CRDT</h1>
                <p>Two local replicas exchange block rich-text operations.</p>
            </header>
            <section className="editorGrid" aria-label="Synced block editors">
                <BlockEditor
                    replica={demo.left}
                    logs={logs.left}
                    onCommand={(command) => runCommand('left', command)}
                    onDebug={(message) => appendLog('left', message)}
                    onClearDebug={() => setLogs((current) => ({...current, left: []}))}
                    onToggleOnline={() => setDemo((current) => toggleOnline(current, 'left'))}
                />
                <BlockEditor
                    replica={demo.right}
                    logs={logs.right}
                    onCommand={(command) => runCommand('right', command)}
                    onDebug={(message) => appendLog('right', message)}
                    onClearDebug={() => setLogs((current) => ({...current, right: []}))}
                    onToggleOnline={() => setDemo((current) => toggleOnline(current, 'right'))}
                />
            </section>
        </main>
    );
}

function BlockEditor({
    replica,
    logs,
    onCommand,
    onDebug,
    onClearDebug,
    onToggleOnline,
}: {
    replica: Replica;
    logs: string[];
    onCommand(command: (replica: Replica) => CommandResult): void;
    onDebug(message: string): void;
    onClearDebug(): void;
    onToggleOnline(): void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const pendingCaretRestoreBlockIdRef = useRef<string | null>(null);
    const pendingSelectionRestoreRef = useRef<EditorSelection | null>(null);
    const [hasFocus, setHasFocus] = useState(false);
    const blocks = materializeFormattedBlocks(replica.state);
    const blockIds = rootBlockIds(replica.state);
    const resolvedSelection = resolveSelection(replica.state, replica.selection);
    const inactiveSelection = hasFocus ? null : resolvedSelection;
    const inactiveSegmentsByBlock = useMemo(() => {
        const segments = new Map<string, SelectionSegment>();
        if (!inactiveSelection) return segments;
        for (const segment of normalizeSelectionSegments(replica.state, inactiveSelection)) {
            segments.set(segment.blockId, segment);
        }
        return segments;
    }, [inactiveSelection, replica.state]);
    const inactiveCaret =
        inactiveSelection?.type === 'caret'
            ? {blockId: inactiveSelection.point.blockId, offset: inactiveSelection.point.offset}
            : null;
    const {draggingId, dropTarget, registerRow, startDrag} = useBlockReorder({
        blockIds,
        onMove: (blockId: string, target: DropTarget) =>
            onCommand((current) => moveBlock(current.state, blockId, target, makeCommandContext(current))),
    });

    const captureSelection = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;
        const selection = readSelectionFromDom(root);
        if (!selection) return;
        onDebug(`captureSelection ${formatSelection(selection)}`);
        onCommand((current) => ({state: current.state, ops: [], selection}));
    }, [onCommand, onDebug]);

    const liveSelection = useCallback((current: Replica) => {
        const root = rootRef.current;
        return (root ? readSelectionFromDom(root) : null) ?? resolveSelection(current.state, current.selection);
    }, []);

    const runEditCommand = useCallback(
        (
            label: string,
            command: (current: Replica, selection: EditorSelection) => CommandResult,
        ) => {
            onCommand((current) => {
                const selection = liveSelection(current);
                onDebug(
                    `${label} begin stored=${formatSelection(
                        resolveSelection(current.state, current.selection),
                    )} live=${formatSelection(selection)} text=${formatReplicaText(current)}`,
                );
                const result = command(current, selection);
                if (result.selection.type === 'caret') {
                    pendingCaretRestoreBlockIdRef.current = result.selection.point.blockId;
                    pendingSelectionRestoreRef.current = null;
                } else {
                    pendingCaretRestoreBlockIdRef.current = null;
                    pendingSelectionRestoreRef.current = result.selection;
                }
                onDebug(
                    `${label} end next=${formatSelection(result.selection)} ops=${
                        result.ops.length
                    } text=${formatStateText(result.state)}`,
                );
                return result;
            });
        },
        [liveSelection, onCommand, onDebug],
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
                    <span>{replica.online ? 'online' : 'offline'} · queued {replica.queue.length}</span>
                </div>
                <label className="switch">
                    <input type="checkbox" checked={replica.online} onChange={onToggleOnline} />
                    <span>Online</span>
                </label>
            </header>
            <Toolbar
                onBold={() =>
                    runEditCommand('toggle bold', (current, selection) =>
                        toggleMark(current.state, selection, 'bold', makeCommandContext(current)),
                    )
                }
                onItalic={() =>
                    runEditCommand('toggle italic', (current, selection) =>
                        toggleMark(current.state, selection, 'italic', makeCommandContext(current)),
                    )
                }
            />
            <div
                ref={rootRef}
                className="blockList"
                onFocus={() => setHasFocus(true)}
                onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    setHasFocus(false);
                }}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
            >
                {blocks.map((block) => (
                    <EditableBlock
                        key={block.id}
                        block={block}
                        selection={resolvedSelection}
                        inactiveSelectionSegment={inactiveSegmentsByBlock.get(block.id) ?? null}
                        inactiveCaretOffset={
                            inactiveCaret?.blockId === block.id ? inactiveCaret.offset : null
                        }
                        pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
                        isDragging={draggingId === block.id}
                        dropTarget={dropTarget?.targetBlockId === block.id ? dropTarget : null}
                        registerRow={registerRow}
                        onStartDrag={startDrag}
                        onInsertText={(text) =>
                            runEditCommand(`insert "${text}"`, (current, selection) =>
                                insertText(current.state, selection, text, makeCommandContext(current)),
                            )
                        }
                        onDeleteBackward={() =>
                            runEditCommand('backspace', (current, selection) =>
                                deleteBackward(current.state, selection, makeCommandContext(current)),
                            )
                        }
                        onSplit={() =>
                            runEditCommand('split', (current, selection) =>
                                splitBlock(current.state, selection, makeCommandContext(current)),
                            )
                        }
                        onToggleBold={() =>
                            runEditCommand('toggle bold', (current, selection) =>
                                toggleMark(current.state, selection, 'bold', makeCommandContext(current)),
                            )
                        }
                        onToggleItalic={() =>
                            runEditCommand('toggle italic', (current, selection) =>
                                toggleMark(current.state, selection, 'italic', makeCommandContext(current)),
                            )
                        }
                        onPasteText={(text) =>
                            runEditCommand(`paste ${JSON.stringify(text)}`, (current, selection) =>
                                pastePlainText(current.state, selection, text, makeCommandContext(current)),
                            )
                        }
                    />
                ))}
            </div>
            <DebugLog logs={logs} onClear={onClearDebug} />
        </article>
    );
}

function Toolbar({onBold, onItalic}: {onBold(): void; onItalic(): void}) {
    return (
        <div className="toolbar" aria-label="Formatting">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onBold}>
                <strong>B</strong>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onItalic}>
                <em>I</em>
            </button>
        </div>
    );
}

function EditableBlock({
    block,
    selection,
    inactiveSelectionSegment,
    inactiveCaretOffset,
    pendingCaretRestoreBlockIdRef,
    isDragging,
    dropTarget,
    registerRow,
    onStartDrag,
    onInsertText,
    onDeleteBackward,
    onSplit,
    onToggleBold,
    onToggleItalic,
    onPasteText,
}: {
    block: FormattedBlock;
    selection: EditorSelection;
    inactiveSelectionSegment: SelectionSegment | null;
    inactiveCaretOffset: number | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    isDragging: boolean;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onInsertText(text: string): void;
    onDeleteBackward(): void;
    onSplit(): void;
    onToggleBold(): void;
    onToggleItalic(): void;
    onPasteText(text: string): void;
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
            }
        };

        element.addEventListener('beforeinput', onBeforeInput);
        return () => element.removeEventListener('beforeinput', onBeforeInput);
    }, [onInsertText]);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;
        const renderedRuns = serializeRuns(block.runs, inactiveSelectionSegment, inactiveCaretOffset);
        if (renderedRunsRef.current === renderedRuns) return;
        renderedRunsRef.current = renderedRuns;
        const children = renderRunNodes(block.runs, inactiveSelectionSegment, inactiveCaretOffset);
        element.replaceChildren(...children);
        const point = selection.type === 'caret' ? selection.point : null;
        if (point?.blockId === block.id && pendingCaretRestoreBlockIdRef.current === block.id) {
            pendingCaretRestoreBlockIdRef.current = null;
            if (document.activeElement !== element) element.focus();
            restoreCaretToDom(element, point.offset);
        }
    }, [
        block.id,
        block.runs,
        inactiveCaretOffset,
        inactiveSelectionSegment,
        pendingCaretRestoreBlockIdRef,
        selection,
    ]);

    return (
        <div
            ref={(element) => registerRow(block.id, element)}
            className={[
                'blockRow',
                isDragging ? 'dragging' : '',
                dropTarget ? (dropTarget.after ? 'dropAfter' : 'dropBefore') : '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <button
                type="button"
                className="dragHandle"
                aria-label="Move block"
                onPointerDown={(event) => onStartDrag(block.id, event)}
            >
                ⋮⋮
            </button>
            <div
                ref={editableRef}
                className="editableBlock"
                contentEditable
                role="textbox"
                aria-label="Block text"
                suppressContentEditableWarning
                spellCheck
                data-block-id={block.id}
                data-empty={block.runs.length === 0 ? 'true' : undefined}
                onFocus={(event) => {
                    if (!inactiveSelectionSegment && inactiveCaretOffset === null) return;
                    event.currentTarget.replaceChildren(...renderRunNodes(block.runs, null, null));
                    renderedRunsRef.current = serializeRuns(block.runs, null, null);
                }}
                onInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (handledBeforeInputRef.current) {
                        handledBeforeInputRef.current = false;
                        event.currentTarget.replaceChildren(
                            ...renderRunNodes(block.runs, inactiveSelectionSegment, inactiveCaretOffset),
                        );
                        return;
                    }
                    if (native.isComposing) return;
                    if (isJsdom() && native.inputType === 'insertText' && native.data) {
                        onInsertText(native.data);
                    }
                }}
                onKeyDown={(event) => {
                    const modifierPressed = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (modifierPressed && key === 'b') {
                        event.preventDefault();
                        onToggleBold();
                    } else if (modifierPressed && key === 'i') {
                        event.preventDefault();
                        onToggleItalic();
                    } else if (event.key === 'Enter') {
                        event.preventDefault();
                        onSplit();
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        onDeleteBackward();
                    }
                }}
                onPaste={(event) => {
                    event.preventDefault();
                    onPasteText(event.clipboardData.getData('text/plain'));
                }}
            />
        </div>
    );
}

const isJsdom = () => navigator.userAgent.includes('jsdom');

const serializeRuns = (
    runs: FormattedBlock['runs'],
    inactiveSelectionSegment: SelectionSegment | null,
    inactiveCaretOffset: number | null,
) =>
    JSON.stringify({
        runs: runs.map((run) => [run.text, run.marks.bold, run.marks.italic]),
        inactiveSelectionSegment,
        inactiveCaretOffset,
    });

const renderRunNodes = (
    runs: FormattedBlock['runs'],
    inactiveSelectionSegment: SelectionSegment | null,
    inactiveCaretOffset: number | null,
): Node[] => {
    if (!inactiveSelectionSegment && inactiveCaretOffset === null) {
        return runs.map((run) => {
            const span = document.createElement('span');
            span.textContent = run.text;
            applyRunClasses(span, run);
            return span;
        });
    }

    const nodes: Node[] = [];
    let offset = 0;
    let caretRendered = false;
    for (const run of runs) {
        const runSegments = segmentText(run.text);
        const runStart = offset;
        const runEnd = runStart + runSegments.length;
        const boundaries = new Set([0, runSegments.length]);
        if (inactiveSelectionSegment) {
            addBoundaryInRun(boundaries, inactiveSelectionSegment.startOffset - runStart, runSegments.length);
            addBoundaryInRun(boundaries, inactiveSelectionSegment.endOffset - runStart, runSegments.length);
        }
        if (inactiveCaretOffset !== null) {
            addBoundaryInRun(boundaries, inactiveCaretOffset - runStart, runSegments.length);
        }
        const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

        for (let index = 0; index < sortedBoundaries.length - 1; index++) {
            const start = sortedBoundaries[index];
            const end = sortedBoundaries[index + 1];
            const chunkStart = runStart + start;
            const chunkEnd = runStart + end;
            if (!caretRendered && inactiveCaretOffset === chunkStart) {
                nodes.push(renderRetainedCaret());
                caretRendered = true;
            }
            if (start === end) continue;
            const span = document.createElement('span');
            span.textContent = runSegments.slice(start, end).join('');
            applyRunClasses(span, run);
            if (
                inactiveSelectionSegment &&
                chunkStart >= inactiveSelectionSegment.startOffset &&
                chunkEnd <= inactiveSelectionSegment.endOffset
            ) {
                span.classList.add('retainedSelectionHighlight');
                span.dataset.retainedSelection = 'highlight';
            }
            nodes.push(span);
        }
        if (!caretRendered && inactiveCaretOffset === runEnd) {
            nodes.push(renderRetainedCaret());
            caretRendered = true;
        }
        offset = runEnd;
    }
    if (!caretRendered && inactiveCaretOffset === offset) nodes.push(renderRetainedCaret());
    return nodes;
};

const addBoundaryInRun = (boundaries: Set<number>, boundary: number, runLength: number) => {
    if (boundary > 0 && boundary < runLength) boundaries.add(boundary);
};

const applyRunClasses = (span: HTMLElement, run: FormattedBlock['runs'][number]) => {
    if (run.marks.bold) span.classList.add('markBold');
    if (run.marks.italic) span.classList.add('markItalic');
};

const renderRetainedCaret = () => {
    const span = document.createElement('span');
    span.className = 'retainedSelectionCaret';
    span.dataset.retainedSelection = 'caret';
    span.contentEditable = 'false';
    return span;
};

function DebugLog({logs, onClear}: {logs: string[]; onClear(): void}) {
    return (
        <details className="debugLog" open>
            <summary>
                Debug log
                <button
                    type="button"
                    onClick={(event) => {
                        event.preventDefault();
                        onClear();
                    }}
                >
                    clear
                </button>
            </summary>
            <pre>{logs.join('\n')}</pre>
        </details>
    );
}

const formatSelection = (selection: EditorSelection) =>
    selection.type === 'caret'
        ? `caret(${selection.point.blockId}@${selection.point.offset})`
        : `range(${selection.anchor.blockId}@${selection.anchor.offset}->${selection.focus.blockId}@${selection.focus.offset})`;

const formatReplicaText = (replica: Replica) => formatStateText(replica.state);

const formatStateText = (state: Replica['state']) =>
    rootBlockIds(state)
        .map((id) => `${id}:${JSON.stringify(blockContents(state, id))}`)
        .join(' | ');
