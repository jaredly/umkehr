import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
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
import {readSelectionFromDom, restoreSelectionToDom} from './domSelection';
import {useBlockReorder, type DropTarget} from './useBlockReorder';

export function App() {
    const [demo, setDemo] = useState<DemoState>(() => createDemoState());

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

    return (
        <main className="appShell">
            <header className="topBar">
                <h1>Block Rich Text CRDT</h1>
                <p>Two local replicas exchange block rich-text operations.</p>
            </header>
            <section className="editorGrid" aria-label="Synced block editors">
                <BlockEditor
                    replica={demo.left}
                    onCommand={(command) => runCommand('left', command)}
                    onToggleOnline={() => setDemo((current) => toggleOnline(current, 'left'))}
                />
                <BlockEditor
                    replica={demo.right}
                    onCommand={(command) => runCommand('right', command)}
                    onToggleOnline={() => setDemo((current) => toggleOnline(current, 'right'))}
                />
            </section>
        </main>
    );
}

function BlockEditor({
    replica,
    onCommand,
    onToggleOnline,
}: {
    replica: Replica;
    onCommand(command: (replica: Replica) => CommandResult): void;
    onToggleOnline(): void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
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
        onCommand((current) => ({state: current.state, ops: [], selection}));
    }, [onCommand]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || document.activeElement === null || !root.contains(document.activeElement)) return;
        restoreSelectionToDom(root, replica.selection);
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
                onBold={() => onCommand((current) => toggleMark(current.state, current.selection, 'bold', makeCommandContext(current)))}
                onItalic={() => onCommand((current) => toggleMark(current.state, current.selection, 'italic', makeCommandContext(current)))}
            />
            <div
                ref={rootRef}
                className="blockList"
                onSelect={captureSelection}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
            >
                {blocks.map((block) => (
                    <EditableBlock
                        key={block.id}
                        block={block}
                        isDragging={draggingId === block.id}
                        dropTarget={dropTarget?.targetBlockId === block.id ? dropTarget : null}
                        registerRow={registerRow}
                        onStartDrag={startDrag}
                        onInsertText={(text) =>
                            onCommand((current) => insertText(current.state, current.selection, text, makeCommandContext(current)))
                        }
                        onDeleteBackward={() =>
                            onCommand((current) => deleteBackward(current.state, current.selection, makeCommandContext(current)))
                        }
                        onSplit={() =>
                            onCommand((current) => splitBlock(current.state, current.selection, makeCommandContext(current)))
                        }
                        onPasteText={(text) =>
                            onCommand((current) => pastePlainText(current.state, current.selection, text, makeCommandContext(current)))
                        }
                    />
                ))}
            </div>
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
    isDragging,
    dropTarget,
    registerRow,
    onStartDrag,
    onInsertText,
    onDeleteBackward,
    onSplit,
    onPasteText,
}: {
    block: FormattedBlock;
    isDragging: boolean;
    dropTarget: DropTarget | null;
    registerRow(id: string, element: HTMLElement | null): void;
    onStartDrag: ReturnType<typeof useBlockReorder>['startDrag'];
    onInsertText(text: string): void;
    onDeleteBackward(): void;
    onSplit(): void;
    onPasteText(text: string): void;
}) {
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
                className="editableBlock"
                contentEditable
                role="textbox"
                aria-label="Block text"
                suppressContentEditableWarning
                spellCheck
                data-block-id={block.id}
                data-empty={block.runs.length === 0 ? 'true' : undefined}
                onBeforeInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (native.isComposing) return;
                    if (native.inputType === 'insertText' && native.data) {
                        event.preventDefault();
                        onInsertText(native.data);
                    }
                }}
                onInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (native.isComposing) return;
                    if (native.inputType === 'insertText' && native.data) {
                        onInsertText(native.data);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
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
            >
                {block.runs.map((run, index) => (
                    <span
                        key={index}
                        className={[
                            run.marks.bold ? 'markBold' : '',
                            run.marks.italic ? 'markItalic' : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                    >
                        {run.text}
                    </span>
                ))}
            </div>
        </div>
    );
}
