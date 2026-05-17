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
                <dt>Batches</dt>
                <dd>{stats.retainedBatches}</dd>
                <dt>Received</dt>
                <dd>{stats.receivedBatches}</dd>
                <dt>Pending</dt>
                <dd>{stats.pendingUpdates}</dd>
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
