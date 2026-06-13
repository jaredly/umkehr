import {useEffect, useMemo, useRef, useState} from 'react';
import {PlimDriver} from '@plim/core';
import {PlimEditor, useEditorHandle} from '@plim/react';
import type {Transaction} from '@plim/core';
import {
    insertTextOps,
    splitBlockOps,
    stateToString,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {
    applyLocalTransaction,
    applyRemoteOps,
    createAdapterState,
    type AdapterOptions,
    type AdapterState,
} from './plimBlockCrdtAdapter';
import {createFixtureState, makeTs} from './fixtures';
import './style.css';

const actor = 'plim-local';

export function App() {
    const ts = useMemo(() => makeTs(500), []);
    const plim = useMemo(() => new PlimDriver(), []);
    const handle = useEditorHandle();
    const applyingFromCrdt = useRef(false);
    const [adapter, setAdapter] = useState<AdapterState>(() => createAdapterState(createFixtureState()));
    const adapterRef = useRef(adapter);
    const [log, setLog] = useState<string[]>(['Initialized CRDT-backed Plim example.']);

    useEffect(() => {
        adapterRef.current = adapter;
        const editor = handle.current;
        if (!editor) return;
        applyingFromCrdt.current = true;
        editor.setState(adapter.plim);
        queueMicrotask(() => {
            applyingFromCrdt.current = false;
        });
    }, [adapter, handle]);

    const options: AdapterOptions = useMemo(() => ({actor, ts}), [ts]);

    const onTransaction = (tx: Transaction) => {
        if (applyingFromCrdt.current) return;
        setAdapter((current) => {
            const next = applyLocalTransaction(current, tx, options);
            appendLog(setLog, `local tx: ${tx.ops.map((op) => op.kind).join(', ') || 'empty'} -> ${next.ops.length} ops`);
            if (next.unsupported.length) {
                appendLog(setLog, `unsupported: ${next.unsupported.map((op) => op.kind).join(', ')}`);
            }
            return {
                crdt: next.crdt,
                plim: next.plim,
                retainedSelection: next.retainedSelection,
            };
        });
    };

    const applyRemoteInsert = () => {
        setAdapter((current) => {
            const blockId = visibleBlockChildren(current.crdt, '0000-root')[0];
            if (!blockId) return current;
            const block = current.crdt.state.blocks[blockId].id;
            const ops = insertTextOps(current.crdt, {
                actor: 'remote',
                block,
                offset: 0,
                text: 'Remote ',
                ts,
            });
            const next = applyRemoteOps(current, ops);
            appendLog(setLog, `remote insert -> applied ${next.applied.length}, pending ${next.pending.length}`);
            return {
                crdt: next.crdt,
                plim: next.plim,
                retainedSelection: next.retainedSelection,
            };
        });
    };

    const applyRemoteSplit = () => {
        setAdapter((current) => {
            const blockId = visibleBlockChildren(current.crdt, '0000-root')[0];
            if (!blockId) return current;
            const block = current.crdt.state.blocks[blockId].id;
            const ops = splitBlockOps(current.crdt, {
                actor: 'remote',
                block,
                offset: Math.min(4, current.crdt.cache.charContents[blockId]?.length ?? 0),
                ts: ts(),
            });
            const next = applyRemoteOps(current, ops);
            appendLog(setLog, `remote split -> applied ${next.applied.length}, pending ${next.pending.length}`);
            return {
                crdt: next.crdt,
                plim: next.plim,
                retainedSelection: next.retainedSelection,
            };
        });
    };

    return (
        <main className="appShell">
            <section className="editorPane">
                <div className="toolbar">
                    <button type="button" onClick={applyRemoteInsert}>Remote Insert</button>
                    <button type="button" onClick={applyRemoteSplit}>Remote Split</button>
                </div>
                <PlimEditor
                    plim={plim}
                    handle={handle}
                    initialContent={adapter.plim.doc}
                    onTransaction={onTransaction}
                    className="plimHost"
                />
            </section>
            <aside className="debugPane">
                <section>
                    <h2>CRDT Text</h2>
                    <pre>{stateToString(adapter.crdt)}</pre>
                </section>
                <section>
                    <h2>Plim JSON</h2>
                    <pre>{JSON.stringify(adapter.plim.doc, null, 2)}</pre>
                </section>
                <section>
                    <h2>Log</h2>
                    <ol>
                        {log.slice(-8).map((item, index) => (
                            <li key={`${index}-${item}`}>{item}</li>
                        ))}
                    </ol>
                </section>
            </aside>
        </main>
    );
}

const appendLog = (setLog: (fn: (items: string[]) => string[]) => void, message: string) => {
    setLog((items) => [...items, message]);
};
