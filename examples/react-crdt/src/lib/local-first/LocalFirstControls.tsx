import {useState} from 'react';
import {useStore} from '../store';
import type {LocalFirstSync} from './types';

export function LocalFirstControls<TState>({
    sync,
    docId,
    schemaVersion,
    schemaFingerprint,
}: {
    sync: LocalFirstSync<TState>;
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
}) {
    const state = useStore(sync.stateStore);
    const persistence = useStore(sync.persistenceStore);
    const stats = useStore(sync.statsStore);
    const connections = useStore(sync.connectionsStore);
    const compactionRisks = stats.mesh.compactionRisks;
    const inviteUrl = state.kind === 'ready' ? createInviteUrl(state.peerId, docId) : '';
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
                <dd>
                    v{schemaVersion} / {schemaFingerprint.slice(0, 16)}
                </dd>
                {stats.lineage ? (
                    <>
                        <dt>Lineage</dt>
                        <dd>
                            {stats.lineage.sourceDocId} / v{stats.lineage.sourceSchemaVersion}
                        </dd>
                        <dt>Migrated</dt>
                        <dd>{stats.lineage.migratedAt}</dd>
                    </>
                ) : null}
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
                <dt>Discovered</dt>
                <dd>{stats.mesh.discoveredMembers}</dd>
                <dt>Direct</dt>
                <dd>{stats.mesh.directConnections}</dd>
                <dt>Connected</dt>
                <dd>{stats.mesh.connectedPeers}</dd>
                <dt>Members</dt>
                <dd>{stats.mesh.lastMemberUpdateAt ?? 'none'}</dd>
                <dt>Snapshot</dt>
                <dd>{stats.snapshotStatus ?? 'none'}</dd>
                {stats.pendingSnapshot ? (
                    <>
                        <dt>Remote</dt>
                        <dd>{stats.pendingSnapshot.actor}</dd>
                    </>
                ) : null}
                {stats.replayPreview ? (
                    <>
                        <dt>Preview</dt>
                        <dd>
                            {stats.replayPreview.localBatches} local batches
                            {stats.replayPreview.skippedUpdates
                                ? ` / ${stats.replayPreview.skippedUpdates} skipped`
                                : ''}
                        </dd>
                    </>
                ) : null}
                <dt>Compaction</dt>
                <dd>{stats.compactionStatus ?? 'none'}</dd>
                <dt>Behind</dt>
                <dd>{compactionRisks.length || 'none'}</dd>
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
            <div className="connectionActions" role="group" aria-label="Local-first role">
                <button
                    type="button"
                    className={state.role === 'host' ? 'active' : ''}
                    onClick={() => sync.setRole('host')}
                >
                    Host
                </button>
                <button
                    type="button"
                    className={state.role === 'client' ? 'active' : ''}
                    onClick={() => sync.setRole('client')}
                >
                    Client
                </button>
            </div>
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
                onClick={() => void compact(sync, compactionRisks)}
            >
                Compact retained log
            </button>
            {compactionRisks.length ? (
                <section className="compactionRiskList">
                    {compactionRisks.map((risk) => (
                        <div className="connectionRow" key={risk.peerId}>
                            <strong>{risk.actor ?? risk.peerId}</strong>
                            <span>
                                {risk.reason === 'unknown'
                                    ? 'vector unknown; request sync before compacting'
                                    : 'behind this replica; will need a snapshot after compaction'}
                            </span>
                        </div>
                    ))}
                </section>
            ) : null}
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
                onClick={() => void previewSnapshot(sync)}
            >
                Preview local on snapshot
            </button>
            {stats.replayPreview ? (
                <pre className="replayPreview">
                    {JSON.stringify(stats.replayPreview.state, null, 2)}
                </pre>
            ) : null}
            <button
                type="button"
                disabled={!stats.replayPreview}
                onClick={() => void replaySnapshot(sync)}
            >
                Apply preview
            </button>
            <div className="connectionActions">
                <button type="button" onClick={() => void exportState(sync)}>
                    Export JSON
                </button>
                <button type="button" onClick={() => void importState(sync)}>
                    Import JSON
                </button>
            </div>
            <section className="connectionList">
                {connections.map((connection) => (
                    <div className="connectionRow" key={connection.peerId}>
                        <strong>{connection.actor ?? connection.peerId}</strong>
                        <span>
                            {connection.open ? 'open' : 'closed'}
                            {connection.role ? ` / ${connection.role}` : ''}
                            {connection.vector
                                ? ` / vector ${Object.keys(connection.vector).length}`
                                : ' / vector unknown'}
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

function createInviteUrl(peerId: string, docId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('peer', peerId);
    url.searchParams.set('doc', docId);
    url.hash = 'local-first';
    return url.toString();
}

async function reset<TState>(sync: LocalFirstSync<TState>) {
    if (!window.confirm('Reset the local-first document for this browser?')) return;
    await sync.resetLocalReplica();
}

async function compact<TState>(
    sync: LocalFirstSync<TState>,
    risks: ReturnType<LocalFirstSync<TState>['statsStore']['getSnapshot']>['mesh']['compactionRisks'],
) {
    const riskText = risks.length
        ? `\n\nPeers affected:\n${risks
              .map(
                  (risk) =>
                      `- ${risk.actor ?? risk.peerId}: ${
                          risk.reason === 'unknown' ? 'vector unknown' : 'behind'
                      }`,
              )
              .join('\n')}`
        : '';
    if (
        !window.confirm(
            `Compact retained batches for this replica? Peers behind this frontier will need a snapshot.${riskText}`,
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

async function previewSnapshot<TState>(sync: LocalFirstSync<TState>) {
    await sync.previewLocalBatchesOnSnapshot();
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

async function exportState<TState>(sync: LocalFirstSync<TState>) {
    const json = await sync.exportLocalState();
    await navigator.clipboard.writeText(json);
}

async function importState<TState>(sync: LocalFirstSync<TState>) {
    const json = window.prompt('Paste exported local-first JSON');
    if (!json) return;
    await sync.importLocalState(json);
}

function statusText(status: ReturnType<LocalFirstSync<unknown>['persistenceStore']['getSnapshot']>) {
    switch (status.kind) {
        case 'loading':
            return 'Loading persisted state';
        case 'ready':
            return status.source === 'loaded'
                ? 'Loaded from this browser'
                : status.source === 'migrated'
                  ? 'Created from a migrated document'
                  : 'Created in this browser';
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
        case 'needs-rebase-or-discard':
            return `${state.role} needs rebase/discard from ${state.actor}`;
        case 'error':
            return state.message;
    }
}
