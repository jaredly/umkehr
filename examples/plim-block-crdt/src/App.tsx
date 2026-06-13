import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {boldMark, codeMark, defineAction, italicMark, linkMark, PlimDriver, triggers} from '@plim/core';
import {PlimEditor, SlashCommandMenu, slashCommandExtension, useEditorHandle} from '@plim/react';
import type {EditorState, Transaction} from '@plim/core';
import {stateToString} from 'umkehr/block-crdt';
import {
    applyLocalTransaction,
    selectionToRetained,
    type AdapterState,
} from './plimBlockCrdtAdapter';
import {
    applyLocalAdapterChange,
    createDemoState,
    toggleReplicaOnline,
    type EditorId,
    type Replica,
} from './plimDemoRuntime';
import './style.css';

export function App() {
    const [demo, setDemo] = useState(createDemoState);
    const [log, setLog] = useState<string[]>(['Initialized side-by-side CRDT-backed Plim example.']);

    const appendMessages = useCallback((messages: string[]) => {
        if (!messages.length) return;
        setLog((items) => [...items, ...messages]);
    }, []);

    const onTransaction = useCallback(
        (id: EditorId, tx: Transaction, state: EditorState) => {
            setDemo((current) => {
                const source = current[id];
                if (tx.ops.every((op) => op.kind === 'setSelection')) {
                    const adapter: AdapterState = {
                        crdt: source.adapter.crdt,
                        plim: state,
                        retainedSelection:
                            selectionToRetained(source.adapter.crdt, state.doc, state.selection) ??
                            source.adapter.retainedSelection,
                    };
                    return {...current, [id]: {...source, adapter}};
                }

                const next = applyLocalTransaction(
                    source.adapter,
                    tx,
                    {actor: source.actor, ts: source.ts},
                    state,
                );
                const messages = [
                    `${id} tx: ${tx.ops.map((op) => op.kind).join(', ') || 'empty'} -> ${next.ops.length} ops`,
                    ...(
                        next.unsupported.length
                            ? [`${id} unsupported: ${next.unsupported.map((op) => op.kind).join(', ')}`]
                            : []
                    ),
                ];
                const result = applyLocalAdapterChange(
                    current,
                    id,
                    {
                        crdt: next.crdt,
                        plim: next.plim,
                        retainedSelection: next.retainedSelection,
                    },
                    next.ops,
                );
                appendMessages([...messages, ...result.messages]);
                return result.demo;
            });
        },
        [appendMessages],
    );

    const onToggleOnline = useCallback(
        (id: EditorId) => {
            setDemo((current) => {
                const result = toggleReplicaOnline(current, id);
                appendMessages(result.messages);
                return result.demo;
            });
        },
        [appendMessages],
    );

    return (
        <main className="appShell">
            <header className="topBar">
                <h1>Plim Block CRDT</h1>
                <p>Two Plim editors exchange block CRDT operations.</p>
            </header>
            <section className="editorGrid" aria-label="Synced Plim editors">
                <PlimReplicaEditor
                    replica={demo.left}
                    onTransaction={onTransaction}
                    onToggleOnline={onToggleOnline}
                />
                <PlimReplicaEditor
                    replica={demo.right}
                    onTransaction={onTransaction}
                    onToggleOnline={onToggleOnline}
                />
            </section>
            <section className="debugGrid" aria-label="Debug output">
                <ReplicaDebug replica={demo.left} />
                <ReplicaDebug replica={demo.right} />
                <details className="logPane">
                    <summary>Log ({log.length})</summary>
                    <ol>
                        {log.slice(-12).map((item, index) => (
                            <li key={`${index}-${item}`}>{item}</li>
                        ))}
                    </ol>
                </details>
            </section>
        </main>
    );
}

function PlimReplicaEditor({
    replica,
    onTransaction,
    onToggleOnline,
}: {
    replica: Replica;
    onTransaction(id: EditorId, tx: Transaction, state: EditorState): void;
    onToggleOnline(id: EditorId): void;
}) {
    const plim = useMemo(
        () =>
            new PlimDriver({
                extensions: [slashCommandExtension()],
                registeredMarks: [boldMark, italicMark, codeMark, linkMark],
                registeredActions: [markShortcutAction('bold', 'B'), markShortcutAction('italic', 'I')],
            }),
        [],
    );
    const handle = useEditorHandle();
    const applyingFromCrdt = useRef(false);
    const paneRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const editor = handle.current;
        if (!editor) return;
        const pane = paneRef.current;
        const activeElement = document.activeElement;
        const hasPaneFocus = !!pane && !!activeElement && pane.contains(activeElement);
        const restoreTarget = hasPaneFocus ? null : snapshotFocusAndSelection();
        applyingFromCrdt.current = true;
        editor.setState(replica.adapter.plim);
        restoreTarget?.();
        queueMicrotask(() => {
            applyingFromCrdt.current = false;
        });
    }, [handle, replica.adapter.plim]);

    const handleTransaction = useCallback(
        (tx: Transaction, state: EditorState) => {
            if (applyingFromCrdt.current) return;
            onTransaction(replica.id, tx, state);
        },
        [onTransaction, replica.id],
    );

    return (
        <section ref={paneRef} className="editorPane" aria-label={replica.label} data-editor-id={replica.id}>
            <div className="paneHeader">
                <div>
                    <h2>{replica.label}</h2>
                    <p>actor: {replica.actor}</p>
                </div>
                <div className="paneActions">
                    <span className="queueBadge">{replica.queue.length} queued</span>
                    <button
                        type="button"
                        className={replica.online ? 'onlineToggle isOnline' : 'onlineToggle'}
                        aria-pressed={replica.online}
                        onClick={() => onToggleOnline(replica.id)}
                    >
                        {replica.online ? 'Online' : 'Offline'}
                    </button>
                </div>
            </div>
            <PlimEditor
                plim={plim}
                handle={handle}
                initialContent={replica.adapter.plim.doc}
                onTransaction={handleTransaction}
                className="plimHost"
            />
            <SlashCommandMenu editor={handle} />
        </section>
    );
}

function ReplicaDebug({replica}: {replica: Replica}) {
    return (
        <details className="debugPane">
            <summary>{replica.label} Debug</summary>
            <section>
                <h2>CRDT Text</h2>
                <pre>{stateToString(replica.adapter.crdt)}</pre>
            </section>
            <section>
                <h2>Plim JSON</h2>
                <pre>{JSON.stringify(replica.adapter.plim, null, 2)}</pre>
            </section>
            <section>
                <h2>Status</h2>
                <pre>{JSON.stringify({online: replica.online, queuedBatches: replica.queue.length}, null, 2)}</pre>
            </section>
        </details>
    );
}

const markShortcutAction = (mark: 'bold' | 'italic', key: 'B' | 'I') =>
    defineAction(`${mark}Shortcut`, {
        trigger: [triggers.keyboard.shortcut(`Meta+${key}`), triggers.keyboard.shortcut(`Ctrl+${key}`)],
        triggerValidationRules: ({and}) => and(['selectionNotEmpty', 'blockSupportsDecoration']),
        perform: (state, ctx) => {
            const tx = ctx.createTransaction();
            tx.toggleMark(mark, {
                from: {path: state.selection.anchor.path, offset: state.selection.anchor.offset},
                to: {path: state.selection.head.path, offset: state.selection.head.offset},
            });
            tx.commit();
        },
    });

const snapshotFocusAndSelection = (): (() => void) | null => {
    const activeElement = document.activeElement;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorOffset = selection?.anchorOffset ?? 0;
    const focusNode = selection?.focusNode ?? null;
    const focusOffset = selection?.focusOffset ?? 0;

    if (!(activeElement instanceof HTMLElement) || !anchorNode || !focusNode) return null;

    return () => {
        if (!activeElement.isConnected || !anchorNode.isConnected || !focusNode.isConnected) return;
        activeElement.focus({preventScroll: true});
        const nextSelection = window.getSelection();
        if (!nextSelection) return;
        try {
            nextSelection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
        } catch {
            const range = document.createRange();
            range.setStart(anchorNode, anchorOffset);
            range.setEnd(focusNode, focusOffset);
            nextSelection.removeAllRanges();
            nextSelection.addRange(range);
        }
    };
};
