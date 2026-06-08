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
} from 'react';
import {materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import type {FormattedBlock} from 'umkehr/block-crdt';
import {indentBlock, moveBlock, unindentBlock} from './blockCommands';
import {
    applyLocalChange,
    createDemoState,
    makeCommandContext,
    toggleOnline,
    type DemoState,
    type EditorId,
    type Replica,
} from './blockEditorRuntime';
import {
    closestCaretOffsetForHorizontalIntent,
    isCaretOnFirstVisualLine,
    isCaretOnLastVisualLine,
    readCaretHorizontalIntent,
    readPointFromMouseEvent,
    readSelectionFromDom,
    restoreCaretToDom,
    restoreSelectionToDom,
} from './domSelection';
import {
    caret,
    firstPointForSelection,
    pointTextLength,
    segmentText,
    type EditorSelection,
} from './selectionModel';
import {
    deleteBackwardEverywhere,
    deleteForwardEverywhere,
    insertTextEverywhere,
    moveSelectionsHorizontally,
    moveSelectionsVertically,
    pastePlainTextEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
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

export function App() {
    const [demo, setDemo] = useState<DemoState>(() => createDemoState());

    const runCommand = useCallback(
        (editorId: EditorId, command: (replica: Replica) => MultiCommandResult) => {
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
        },
        [],
    );

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
    onCommand(command: (replica: Replica) => MultiCommandResult): void;
    onToggleOnline(): void;
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
    const [hasFocus, setHasFocus] = useState(false);
    const blocks = materializeFormattedBlocks(replica.state);
    const blockIds = rootBlockIds(replica.state);
    const resolvedSelectionSet = resolveSelectionSet(replica.state, replica.selection);
    const primaryResolvedSelection = primarySelection(resolvedSelectionSet);
    const decorationsByBlock = useMemo(
        () =>
            decorationsForSelectionSet(replica.state, resolvedSelectionSet, {
                includePrimary: !hasFocus,
            }),
        [hasFocus, replica.state, resolvedSelectionSet],
    );
    const {draggingId, dropTarget, registerRow, startDrag} = useBlockReorder({
        blockIds,
        onMove: (blockId: string, target: DropTarget) =>
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

    const captureSelection = useCallback(
        (event: MouseEvent | KeyboardEvent) => {
            if (event.type === 'mouseup') {
                resetVerticalCaretIntent();
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
            const root = rootRef.current;
            if (!root) return;
            const point = readPointFromMouseEvent(root, event.nativeEvent);
            if (!point) return;

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
        (
            command: (current: Replica, selection: RetainedSelectionSet) => MultiCommandResult,
        ) => {
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

    const moveSelectionsHorizontallyEverywhere = useCallback(
        (direction: 'left' | 'right') => {
            handledNavigationKeyRef.current = true;
            runEditCommand((current, selection) =>
                moveSelectionsHorizontally(current.state, selection, direction),
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
            />
            <div
                ref={rootRef}
                className="blockList"
                onFocus={() => setHasFocus(true)}
                onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    resetVerticalCaretIntent();
                    setHasFocus(false);
                }}
                onMouseDown={captureMouseDown}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
            >
                {blocks.map((block, index) => (
                    <EditableBlock
                        key={block.id}
                        block={block}
                        canDrag={block.depth === 0}
                        previousBlockId={blocks[index - 1]?.id ?? null}
                        previousBlockLength={
                            blocks[index - 1]
                                ? pointTextLength(replica.state, blocks[index - 1].id)
                                : 0
                        }
                        blockLength={pointTextLength(replica.state, block.id)}
                        nextBlockId={blocks[index + 1]?.id ?? null}
                        selection={primaryResolvedSelection}
                        hasMultipleSelections={resolvedSelectionSet.entries.length > 1}
                        decorations={decorationsByBlock.get(block.id) ?? null}
                        pendingCaretRestoreBlockIdRef={pendingCaretRestoreBlockIdRef}
                        isDragging={draggingId === block.id}
                        dropTarget={dropTarget?.targetBlockId === block.id ? dropTarget : null}
                        registerRow={registerRow}
                        onStartDrag={startDrag}
                        onInsertText={(text) =>
                            runEditCommand((current, selection) =>
                                insertTextEverywhere(
                                    current.state,
                                    selection,
                                    text,
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onDeleteBackward={() =>
                            runEditCommand((current, selection) =>
                                deleteBackwardEverywhere(
                                    current.state,
                                    selection,
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onDeleteForward={() =>
                            runEditCommand((current, selection) =>
                                deleteForwardEverywhere(
                                    current.state,
                                    selection,
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onSplit={() =>
                            runEditCommand((current, selection) =>
                                splitBlockEverywhere(
                                    current.state,
                                    selection,
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onIndent={() =>
                            runEditCommand((current, selection) => {
                                const result = indentBlock(
                                    current.state,
                                    block.id,
                                    makeCommandContext(current),
                                );
                                return {
                                    state: result.state,
                                    ops: result.ops,
                                    selection: replacePrimarySelection(
                                        result.state,
                                        selection,
                                        result.selection,
                                    ),
                                };
                            })
                        }
                        onUnindent={() =>
                            runEditCommand((current, selection) => {
                                const result = unindentBlock(
                                    current.state,
                                    block.id,
                                    makeCommandContext(current),
                                );
                                return {
                                    state: result.state,
                                    ops: result.ops,
                                    selection: replacePrimarySelection(
                                        result.state,
                                        selection,
                                        result.selection,
                                    ),
                                };
                            })
                        }
                        onToggleBold={() =>
                            runEditCommand((current, selection) =>
                                toggleMarkEverywhere(
                                    current.state,
                                    selection,
                                    'bold',
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onToggleItalic={() =>
                            runEditCommand((current, selection) =>
                                toggleMarkEverywhere(
                                    current.state,
                                    selection,
                                    'italic',
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onPasteText={(text) =>
                            runEditCommand((current, selection) =>
                                pastePlainTextEverywhere(
                                    current.state,
                                    selection,
                                    text,
                                    makeCommandContext(current),
                                ),
                            )
                        }
                        onMoveCaret={(selection) => {
                            moveCaretHorizontally(selection);
                        }}
                        onMoveCaretVertically={moveCaretVertically}
                        onMoveSelectionsHorizontally={moveSelectionsHorizontallyEverywhere}
                        onMoveSelectionsVertically={moveSelectionsVerticallyEverywhere}
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
            <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onItalic}
            >
                <em>I</em>
            </button>
        </div>
    );
}

function EditableBlock({
    block,
    canDrag,
    previousBlockId,
    previousBlockLength,
    blockLength,
    nextBlockId,
    selection,
    hasMultipleSelections,
    decorations,
    pendingCaretRestoreBlockIdRef,
    isDragging,
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
    onPasteText,
    onMoveCaret,
    onMoveCaretVertically,
    onMoveSelectionsHorizontally,
    onMoveSelectionsVertically,
}: {
    block: FormattedBlock;
    canDrag: boolean;
    previousBlockId: string | null;
    previousBlockLength: number;
    blockLength: number;
    nextBlockId: string | null;
    selection: EditorSelection;
    hasMultipleSelections: boolean;
    decorations: BlockSelectionDecorations | null;
    pendingCaretRestoreBlockIdRef: MutableRefObject<string | null>;
    isDragging: boolean;
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
    onPasteText(text: string): void;
    onMoveCaret(selection: EditorSelection): void;
    onMoveCaretVertically(sourceBlock: HTMLElement, targetBlockId: string): void;
    onMoveSelectionsHorizontally(direction: 'left' | 'right'): void;
    onMoveSelectionsVertically(direction: 'up' | 'down'): void;
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
            style={{'--block-depth': block.depth} as CSSProperties}
        >
            <button
                type="button"
                className="dragHandle"
                aria-label="Move block"
                disabled={!canDrag}
                onPointerDown={canDrag ? (event) => onStartDrag(block.id, event) : undefined}
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
                    if (
                        !decorations ||
                        (!decorations.carets.length && !decorations.segments.length)
                    )
                        return;
                    event.currentTarget.replaceChildren(...renderRunNodes(block.runs, null));
                    renderedRunsRef.current = serializeRuns(block.runs, null);
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
                    } else if (event.key === 'Tab' && !event.altKey && !modifierPressed) {
                        const currentSelection = readSelectionFromDom(event.currentTarget);
                        event.preventDefault();
                        if (
                            currentSelection?.type === 'caret' &&
                            currentSelection.point.offset === 0
                        ) {
                            if (event.shiftKey) {
                                onUnindent();
                            } else {
                                onIndent();
                            }
                        }
                    } else if (event.key === 'Backspace') {
                        event.preventDefault();
                        onDeleteBackward();
                    } else if (event.key === 'Delete') {
                        event.preventDefault();
                        onDeleteForward();
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
        </div>
    );
}

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
    runs: FormattedBlock['runs'],
    decorations: BlockSelectionDecorations | null,
) =>
    JSON.stringify({
        runs: runs.map((run) => [run.text, run.marks.bold, run.marks.italic]),
        decorations,
    });

const renderRunNodes = (
    runs: FormattedBlock['runs'],
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

const applyRunClasses = (span: HTMLElement, run: FormattedBlock['runs'][number]) => {
    if (run.marks.bold) span.classList.add('markBold');
    if (run.marks.italic) span.classList.add('markItalic');
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
