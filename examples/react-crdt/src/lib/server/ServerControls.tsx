import {useStore} from '../store';
import {SERVER_PORT} from './protocol';
import type {ServerSync} from './types';

export function ServerControls<TState>({sync}: {sync: ServerSync<TState>}) {
    const state = useStore(sync.stateStore);
    const stats = useStore(sync.statsStore);
    const manualOffline = useStore(sync.manualOfflineStore);

    return (
        <aside className="serverControls">
            <h2>Server sync</h2>
            <dl className="localFirstStats">
                <dt>Status</dt>
                <dd>{labelForState(state)}</dd>
                <dt>Client</dt>
                <dd>{sync.identity.replicaId}</dd>
                <dt>Port</dt>
                <dd>{SERVER_PORT}</dd>
                <dt>Last seen</dt>
                <dd>{stats.lastSeenMessageIndex}</dd>
                <dt>Pending</dt>
                <dd>{stats.pendingUploads}</dd>
                <dt>Received</dt>
                <dd>{stats.receivedChanges}</dd>
                <dt>Changes</dt>
                <dd>{stats.totalChanges}</dd>
                <dt>Last sync</dt>
                <dd>{stats.lastSyncAt ?? 'Never'}</dd>
            </dl>
            <button
                type="button"
                className={manualOffline ? '' : 'active'}
                onClick={() => sync.setManualOffline(!manualOffline)}
            >
                {manualOffline ? 'Go online' : 'Go offline'}
            </button>
            <button type="button" onClick={sync.requestSync} disabled={manualOffline}>
                Sync now
            </button>
            {state.kind === 'error' ? <p>{state.message}</p> : null}
        </aside>
    );
}

function labelForState(state: ReturnType<ServerSync<unknown>['stateStore']['getSnapshot']>) {
    switch (state.kind) {
        case 'connected':
            return 'Connected';
        case 'connecting':
            return 'Connecting';
        case 'offline':
            return state.reason === 'manual' ? 'Offline' : 'Disconnected';
        case 'error':
            return 'Error';
    }
}
