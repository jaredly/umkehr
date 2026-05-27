import {useMemo, useState} from 'react';
import {useStore} from '../store';
import type {PeerJsSync, PeerRole} from './types';

export function PeerJsControls<TState>({
    role,
    setRole,
    sync,
    docId,
    initialHostPeerId = '',
}: {
    role: PeerRole;
    setRole: (role: PeerRole) => void;
    sync: PeerJsSync<TState>;
    docId: string;
    initialHostPeerId?: string;
}) {
    const [hostPeerId, setHostPeerId] = useState(initialHostPeerId);
    const [copied, setCopied] = useState(false);
    const state = useStore(sync.stateStore);
    const connections = useStore(sync.connectionsStore);
    const localPeerId = state.kind === 'ready' || state.kind === 'waiting-for-snapshot' ? state.peerId : '';
    const inviteUrl = role === 'host' && localPeerId ? createInviteUrl(localPeerId, docId) : '';
    const statusText = useMemo(() => {
        if (state.kind === 'initializing') return 'Initializing PeerJS';
        if (state.kind === 'error') return state.message;
        if (state.kind === 'waiting-for-snapshot') return `Waiting for snapshot from ${state.hostPeerId}`;
        return `Ready as ${state.peerId}`;
    }, [state]);

    return (
        <aside className="peerControls" aria-label="PeerJS controls">
            <div className="rolePicker">
                <button
                    type="button"
                    className={role === 'host' ? 'active' : ''}
                    onClick={() => setRole('host')}
                >
                    Host
                </button>
                <button
                    type="button"
                    className={role === 'client' ? 'active' : ''}
                    onClick={() => setRole('client')}
                >
                    Client
                </button>
            </div>

            <dl className="peerFacts">
                <div>
                    <dt>Peer ID</dt>
                    <dd>{localPeerId || '...'}</dd>
                </div>
                <div>
                    <dt>Status</dt>
                    <dd>{statusText}</dd>
                </div>
            </dl>

            {inviteUrl ? (
                <div className="inviteBox">
                    <label htmlFor="peerInviteLink">Client invite link</label>
                    <div>
                        <input id="peerInviteLink" value={inviteUrl} readOnly />
                        <button
                            type="button"
                            onClick={async () => {
                                await navigator.clipboard.writeText(inviteUrl);
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1400);
                            }}
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            ) : null}

            {role === 'client' ? (
                <form
                    className="peerConnect"
                    onSubmit={(event) => {
                        event.preventDefault();
                        sync.connect(hostPeerId);
                    }}
                >
                    <input
                        value={hostPeerId}
                        placeholder="Host Peer ID"
                        onChange={(event) => setHostPeerId(event.target.value)}
                    />
                    <button type="submit" disabled={!hostPeerId.trim()}>
                        Connect
                    </button>
                </form>
            ) : null}

            <div className="connectionList">
                {connections.length ? (
                    connections.map((connection) => (
                        <div key={connection.peerId} className="connectionRow">
                            <div>
                                <strong>{connection.actor ?? connection.peerId}</strong>
                                <span>{connection.open ? 'Open' : 'Closed'}</span>
                                {connection.error ? <em>{connection.error}</em> : null}
                            </div>
                            <div className="connectionActions">
                                <span>{connection.queuedOutgoing} queued</span>
                                <button
                                    type="button"
                                    onClick={() => sync.flushQueued(connection.peerId)}
                                    disabled={!connection.queuedOutgoing || !connection.open}
                                >
                                    Flush
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        connection.open
                                            ? sync.disconnect(connection.peerId)
                                            : sync.connect(connection.peerId)
                                    }
                                >
                                    {connection.open ? 'Disconnect' : 'Reconnect'}
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <p>No peer connections</p>
                )}
            </div>
        </aside>
    );
}

function createInviteUrl(peerId: string, docId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('peer', peerId);
    url.searchParams.set('doc', docId);
    url.hash = 'peerjs';
    return url.toString();
}
