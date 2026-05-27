import {useStore} from '../store';
import {colorForUserId, initialForNickname} from './presence';
import {serverStateNoticeTone} from './states';
import type {ServerSync} from './types';

export function ServerControls<TState>({
    sync,
    onLogout,
}: {
    sync: ServerSync<TState>;
    onLogout(): void;
}) {
    const state = useStore(sync.stateStore);
    const stats = useStore(sync.statsStore);
    const presenceUsers = useStore(sync.presenceStore);
    const manualOffline = useStore(sync.manualOfflineStore);
    const isConnected = state.kind === 'connected';
    const isDisconnected = state.kind === 'offline' || state.kind === 'error';
    const statusLabel = labelForState(state);
    const noticeTone = serverStateNoticeTone(state);
    const hasUnsyncedChanges = stats.pendingUploads > 0;
    const unsyncedLabel = hasUnsyncedChanges
        ? `${stats.pendingUploads} unsynced local ${
              stats.pendingUploads === 1 ? 'event' : 'events'
          }`
        : 'No unsynced local events';

    return (
        <header
            className={isDisconnected ? 'serverControls disconnected' : 'serverControls'}
            aria-label="Server sync toolbar"
        >
            <div className="serverIdentity">
                <span
                    className="presenceAvatar"
                    style={{backgroundColor: colorForUserId(sync.identity.user.userId)}}
                    aria-hidden="true"
                >
                    {initialForNickname(sync.identity.user.nickname)}
                </span>
                <strong>{sync.identity.user.nickname}</strong>
            </div>
            <div className="serverToolbarActions">
                <span
                    className={
                        hasUnsyncedChanges ? 'serverSyncIndicator active' : 'serverSyncIndicator'
                    }
                    role="img"
                    aria-label={unsyncedLabel}
                    title={unsyncedLabel}
                >
                    <CloudIcon />
                </span>
                <button
                    type="button"
                    className={isConnected ? 'serverIconButton active' : 'serverIconButton'}
                    onClick={() => sync.setManualOffline(!manualOffline)}
                    aria-label={manualOffline ? 'Reconnect to server' : 'Disconnect from server'}
                    title={`${statusLabel}: ${manualOffline ? 'reconnect' : 'disconnect'}`}
                >
                    {manualOffline ? <ConnectIcon /> : <DisconnectIcon />}
                </button>
                <button
                    type="button"
                    className="serverIconButton"
                    onClick={onLogout}
                    aria-label="Log out"
                    title="Log out"
                >
                    <LogoutIcon />
                </button>
            </div>
            <section className="presenceRoster" aria-label="Online users">
                {isDisconnected ? (
                    <span className="presenceEmpty disconnected">Disconnected from server</span>
                ) : presenceUsers.length ? (
                    <ul>
                        {presenceUsers.map((user) => (
                            <li key={user.userId} title={user.nickname}>
                                <span
                                    className="presenceAvatar"
                                    style={{backgroundColor: user.color}}
                                    aria-hidden="true"
                                >
                                    {initialForNickname(user.nickname)}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className="presenceEmpty">No one else online</span>
                )}
            </section>
            {'message' in state ? (
                <div className={`serverToolbarNotice ${noticeClassForState(state, noticeTone)}`}>
                    {state.kind === 'client-migration-required' ||
                    state.kind === 'migration-required' ? (
                        <span aria-hidden="true" className="serverToolbarNoticeIcon">
                            🚨
                        </span>
                    ) : null}
                    <span style={{flex: 1}}>{state.message}</span>
                    {state.kind === 'migration-required' ? (
                        <button type="button" onClick={sync.requestServerMigration}>
                            Migrate document
                        </button>
                    ) : null}
                </div>
            ) : null}
        </header>
    );
}

function noticeClassForState(
    state: ReturnType<ServerSync<unknown>['stateStore']['getSnapshot']>,
    tone: ReturnType<typeof serverStateNoticeTone>,
) {
    if (state.kind === 'client-migration-required' || state.kind === 'migration-required')
        return 'warning';
    return tone === 'error' ? 'error' : 'info';
}

function labelForState(state: ReturnType<ServerSync<unknown>['stateStore']['getSnapshot']>) {
    switch (state.kind) {
        case 'connected':
            return 'Connected';
        case 'connecting':
            return 'Connecting';
        case 'offline':
            return state.reason === 'manual' ? 'Offline' : 'Disconnected';
        case 'migration-required':
            return 'Migration required';
        case 'migration-running':
            return 'Migration in progress';
        case 'migration-cancelled':
            return 'Migration cancelled';
        case 'client-migration-required':
            return 'Update required';
        case 'schema-mismatch':
            return 'Schema mismatch';
        case 'error':
            return 'Error';
    }
}

function CloudIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7.5 18.5h9.2a4.1 4.1 0 0 0 .5-8.2 5.7 5.7 0 0 0-10.8-1.5A4.9 4.9 0 0 0 7.5 18.5Z" />
            <path d="M12 8.8v6.4" />
            <path d="m9.6 12.8 2.4 2.4 2.4-2.4" />
        </svg>
    );
}

function DisconnectIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6.3 6.3 17.7 17.7" />
            <path d="M8.8 14.4 5 18.2" />
            <path d="m15.2 9.6 3.8-3.8" />
            <path d="M10.7 6.2 8.8 4.3a2.7 2.7 0 0 0-3.8 0l-.7.7a2.7 2.7 0 0 0 0 3.8l1.9 1.9" />
            <path d="m13.3 17.8 1.9 1.9a2.7 2.7 0 0 0 3.8 0l.7-.7a2.7 2.7 0 0 0 0-3.8l-1.9-1.9" />
        </svg>
    );
}

function ConnectIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m8.8 14.4-3.8 3.8" />
            <path d="m15.2 9.6 3.8-3.8" />
            <path d="M7.4 12.6 4.3 9.5a2.7 2.7 0 0 1 0-3.8l.7-.7a2.7 2.7 0 0 1 3.8 0l3.1 3.1" />
            <path d="m12.1 15.9 3.1 3.1a2.7 2.7 0 0 0 3.8 0l.7-.7a2.7 2.7 0 0 0 0-3.8l-3.1-3.1" />
            <path d="m9.8 14.2 4.4-4.4" />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M10 6H6.8A2.8 2.8 0 0 0 4 8.8v6.4A2.8 2.8 0 0 0 6.8 18H10" />
            <path d="M14 8l4 4-4 4" />
            <path d="M18 12H9" />
        </svg>
    );
}
