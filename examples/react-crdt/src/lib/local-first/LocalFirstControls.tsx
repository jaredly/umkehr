import {useState} from 'react';
import {useStore} from '../store';
import type {LocalFirstSync} from './types';

export function LocalFirstControls<TState>({
    sync,
    docId,
    schemaFingerprint,
}: {
    sync: LocalFirstSync<TState>;
    docId: string;
    schemaFingerprint: string;
}) {
    const state = useStore(sync.stateStore);
    const persistence = useStore(sync.persistenceStore);
    const stats = useStore(sync.statsStore);
    const connections = useStore(sync.connectionsStore);
    const inviteUrl = state.kind === 'ready' ? createInviteUrl(state.peerId) : '';
    const [peerId, setPeerId] = useState('');

    return (
        <aside className="localFirstControls">
            <div>
                <h2>Local-first</h2>
                <p>{statusText(persistence)}</p>
            </div>
            <dl className="localFirstStats">
                <dt>Replica</dt>
                <dd>{sync.identity.replicaId}</dd>
                <dt>Network</dt>
                <dd>{networkText(state)}</dd>
                <dt>Document</dt>
                <dd>{docId}</dd>
                <dt>Schema</dt>
                <dd>{schemaFingerprint.slice(0, 16)}</dd>
                <dt>Vector</dt>
                <dd>{Object.keys(stats.vector).length || 'empty'}</dd>
                <dt>Compacted</dt>
                <dd>{stats.compactedThrough ? Object.keys(stats.compactedThrough).length : 'none'}</dd>
                <dt>Batches</dt>
                <dd>{stats.retainedBatches}</dd>
                <dt>Received</dt>
                <dd>{stats.receivedBatches}</dd>
                <dt>Pending</dt>
                <dd>{stats.pendingUpdates}</dd>
                <dt>Snapshot</dt>
                <dd>{stats.snapshotStatus ?? 'none'}</dd>
                {stats.pendingSnapshot ? (
                    <>
                        <dt>Remote</dt>
                        <dd>{stats.pendingSnapshot.actor}</dd>
                    </>
                ) : null}
                <dt>Compaction</dt>
                <dd>{stats.compactionStatus ?? 'none'}</dd>
                <dt>Peers</dt>
                <dd>{connections.length}</dd>
            </dl>
            <section className="inviteBox">
                <label htmlFor="local-first-invite">Invite link</label>
                <div>
                    <input
                        id="local-first-invite"
                        value={inviteUrl || 'Waiting for PeerJS'}
                        readOnly
                    />
                    <button
                        type="button"
                        disabled={!inviteUrl}
                        onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                    >
                        Copy
                    </button>
                </div>
            </section>
            <form
                className="peerConnect"
                onSubmit={(event) => {
                    event.preventDefault();
                    sync.connect(peerId);
                    setPeerId('');
                }}
            >
                <input
                    value={peerId}
                    placeholder="Peer ID"
                    onChange={(event) => setPeerId(event.target.value)}
                />
                <button type="submit" disabled={!peerId.trim()}>
                    Connect
                </button>
            </form>
            <button
                type="button"
                disabled={!connections.some((connection) => connection.open)}
                onClick={() => sync.requestSync()}
            >
                Request sync
            </button>
            <button
                type="button"
                disabled={stats.retainedBatches === 0}
                onClick={() => void compact(sync)}
            >
                Compact retained log
            </button>
            <button
                type="button"
                disabled={!stats.pendingSnapshot}
                onClick={() => void acceptSnapshot(sync)}
            >
                Discard local and accept snapshot
            </button>
            <button
                type="button"
                disabled={!stats.pendingSnapshot}
                onClick={() => void replaySnapshot(sync)}
            >
                Replay local on snapshot
            </button>
            <section className="connectionList">
                {connections.map((connection) => (
                    <div className="connectionRow" key={connection.peerId}>
                        <strong>{connection.actor ?? connection.peerId}</strong>
                        <span>
                            {connection.open ? 'open' : 'closed'}
                            {connection.role ? ` / ${connection.role}` : ''}
                            {connection.queuedOutgoing
                                ? ` / ${connection.queuedOutgoing} queued`
                                : ''}
                        </span>
                        {connection.error ? <em>{connection.error}</em> : null}
                        <div className="connectionActions">
                            <button type="button" onClick={() => sync.requestSync(connection.peerId)}>
                                Sync
                            </button>
                            <button type="button" onClick={() => sync.disconnect(connection.peerId)}>
                                Disconnect
                            </button>
                        </div>
                    </div>
                ))}
            </section>
            <button type="button" onClick={() => void reset(sync)}>
                Reset local replica
            </button>
        </aside>
    );
}

function createInviteUrl(peerId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('peer', peerId);
    url.hash = 'local-first';
    return url.toString();
}

async function reset<TState>(sync: LocalFirstSync<TState>) {
    if (!window.confirm('Reset the local-first document for this browser?')) return;
    await sync.resetLocalReplica();
}

async function compact<TState>(sync: LocalFirstSync<TState>) {
    if (
        !window.confirm(
            'Compact retained batches for this replica? Peers behind this frontier will need a snapshot.',
        )
    ) {
        return;
    }
    await sync.compactRetainedLog();
}

async function acceptSnapshot<TState>(sync: LocalFirstSync<TState>) {
    if (
        !window.confirm(
            'Discard this browser’s local document and retained log, then accept the pending peer snapshot?',
        )
    ) {
        return;
    }
    await sync.discardLocalAndAcceptSnapshot();
}

async function replaySnapshot<TState>(sync: LocalFirstSync<TState>) {
    if (
        !window.confirm(
            'Replace this document with the pending peer snapshot, then replay retained local batches on top?',
        )
    ) {
        return;
    }
    await sync.replayLocalBatchesOnSnapshot();
}

function statusText(status: ReturnType<LocalFirstSync<unknown>['persistenceStore']['getSnapshot']>) {
    switch (status.kind) {
        case 'loading':
            return 'Loading persisted state';
        case 'ready':
            return status.source === 'loaded' ? 'Loaded from this browser' : 'Created in this browser';
        case 'saving':
            return 'Saving';
        case 'incompatible':
        case 'error':
            return status.message;
    }
}

function networkText(state: ReturnType<LocalFirstSync<unknown>['stateStore']['getSnapshot']>) {
    switch (state.kind) {
        case 'offline':
            return 'offline';
        case 'initializing':
            return `initializing ${state.role}`;
        case 'ready':
            return `${state.role} ${state.peerId}`;
        case 'error':
            return state.message;
    }
}
