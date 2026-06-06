import {useCallback, useLayoutEffect, useRef, useState, type MutableRefObject} from 'react';
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
                selection: result.selection,
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
    const activeBlockIdRef = useRef<string | null>(null);
    const blocks = materializeFormattedBlocks(replica.state);
    const blockIds = rootBlockIds(replica.state);
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
        return (root ? readSelectionFromDom(root) : null) ?? current.selection;
    }, []);

    const markActiveBlock = useCallback((blockId: string) => {
        activeBlockIdRef.current = blockId;
    }, []);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (replica.selection.type === 'caret') return;
        if (!root || document.activeElement === null || !root.contains(document.activeElement)) return;
        restoreSelectionToDom(root, replica.selection);
    }, [replica.state, replica.selection]);

    const runEditCommand = useCallback(
        (
            label: string,
            command: (current: Replica, selection: Replica['selection']) => CommandResult,
        ) => {
            onCommand((current) => {
                const selection = liveSelection(current);
                onDebug(
                    `${label} begin stored=${formatSelection(current.selection)} live=${formatSelection(
                        selection,
                    )} text=${formatReplicaText(current)}`,
                );
                const result = command(current, selection);
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
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
            >
                {blocks.map((block) => (
                    <EditableBlock
                        key={block.id}
                        block={block}
                        selection={replica.selection}
                        activeBlockIdRef={activeBlockIdRef}
                        isDragging={draggingId === block.id}
                        dropTarget={dropTarget?.targetBlockId === block.id ? dropTarget : null}
                        registerRow={registerRow}
                        onStartDrag={startDrag}
                        onInsertText={(text) =>
                            runEditCommand(`insert "${text}"`, (current, selection) =>
                                insertText(current.state, selection, text, makeCommandContext(current)),
                            )
                        }
                        onActive={() => markActiveBlock(block.id)}
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
    activeBlockIdRef,
    isDragging,
    dropTarget,
    registerRow,
    onStartDrag,
    onInsertText,
    onActive,
    onDeleteBackward,
    onSplit,
    onPasteText,
}: {
    block: FormattedBlock;
    selection: Replica['selection'];
    activeBlockIdRef: MutableRefObject<string | null>;
    isDragging: boolean;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onInsertText(text: string): void;
    onActive(): void;
    onDeleteBackward(): void;
    onSplit(): void;
    onPasteText(text: string): void;
}) {
    const handledBeforeInputRef = useRef(false);
    const editableRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;

        const onBeforeInput = (event: InputEvent) => {
            if (event.isComposing) return;
            if (event.inputType === 'insertText' && event.data) {
                event.preventDefault();
                handledBeforeInputRef.current = true;
                onActive();
                onInsertText(event.data);
            }
        };

        element.addEventListener('beforeinput', onBeforeInput);
        return () => element.removeEventListener('beforeinput', onBeforeInput);
    }, [onActive, onInsertText]);

    useLayoutEffect(() => {
        const element = editableRef.current;
        if (!element) return;
        const children = block.runs.map((run) => {
            const span = document.createElement('span');
            span.textContent = run.text;
            if (run.marks.bold) span.classList.add('markBold');
            if (run.marks.italic) span.classList.add('markItalic');
            return span;
        });
        element.replaceChildren(...children);
        const point = selection.type === 'caret' ? selection.point : null;
        if (point?.blockId === block.id && activeBlockIdRef.current === block.id) {
            restoreCaretToDom(element, point.offset);
        }
    }, [activeBlockIdRef, block.id, block.runs, selection]);

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
                onFocus={onActive}
                onInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (handledBeforeInputRef.current) {
                        handledBeforeInputRef.current = false;
                        event.currentTarget.replaceChildren(
                            ...block.runs.map((run) => {
                                const span = document.createElement('span');
                                span.textContent = run.text;
                                if (run.marks.bold) span.classList.add('markBold');
                                if (run.marks.italic) span.classList.add('markItalic');
                                return span;
                            }),
                        );
                        return;
                    }
                    if (native.isComposing) return;
                    if (isJsdom() && native.inputType === 'insertText' && native.data) {
                        onActive();
                        onInsertText(native.data);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        onActive();
                        onSplit();
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        onActive();
                        onDeleteBackward();
                    }
                }}
                onPaste={(event) => {
                    event.preventDefault();
                    onActive();
                    onPasteText(event.clipboardData.getData('text/plain'));
                }}
            />
        </div>
    );
}

const isJsdom = () => navigator.userAgent.includes('jsdom');

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

const formatSelection = (selection: Replica['selection']) =>
    selection.type === 'caret'
        ? `caret(${selection.point.blockId}@${selection.point.offset})`
        : `range(${selection.anchor.blockId}@${selection.anchor.offset}->${selection.focus.blockId}@${selection.focus.offset})`;

const formatReplicaText = (replica: Replica) => formatStateText(replica.state);

const formatStateText = (state: Replica['state']) =>
    rootBlockIds(state)
        .map((id) => `${id}:${JSON.stringify(blockContents(state, id))}`)
        .join(' | ');
