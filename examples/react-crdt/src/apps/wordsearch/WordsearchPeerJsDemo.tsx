import {useCallback, useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory, type CrdtLocalHistory} from 'umkehr/crdt';
import {
    cloneSerializableCrdtLocalHistory,
    createInitialCrdtHistory,
    hydrateCrdtLocalHistoryForApp,
} from '../../lib/crdtApp';
import {
    initialArtifactsForStore,
    loadSerializedArtifacts,
    serializedArtifactsForStore,
    type SerializedArtifact,
} from '../../lib/artifacts';
import {schemaFingerprintHash} from '../../lib/local-first/schemaFingerprint';
import {PeerJsControls} from '../../lib/peerjs/PeerJsControls';
import {usePeerJsSync} from '../../lib/peerjs/usePeerJsSync';
import type {PeerProtocolConfig} from '../../lib/peerjs/protocol';
import type {PeerJsSync, PeerRole} from '../../lib/peerjs/types';
import {useStore} from '../../lib/store';
import {wordsearchApp, wordsearchCrdtRuntime} from './WordsearchApp';
import type {WordsearchState} from './model';

type HostSession = {
    id: string;
    history: CrdtLocalHistory<WordsearchState>;
    artifacts: SerializedArtifact[];
};

type PersistedHostSession = {
    kind: 'umkehr.react-crdt.wordsearch-peerjs.host';
    version: 1;
    schemaVersion: number;
    schemaFingerprintHash: string;
    history: CrdtLocalHistory<WordsearchState>;
    artifacts: SerializedArtifact[];
};

const HOST_SESSION_STORAGE_KEY = 'umkehr:wordsearch-peerjs:host-session:v1';

export function WordsearchPeerJsDemo() {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const fingerprintHash = useMemo(() => schemaFingerprintHash(wordsearchApp), []);
    const [hostSession, setHostSession] = useState<HostSession | null>(() =>
        initialHostPeerId ? null : loadOrCreateHostSession(fingerprintHash),
    );
    const actor = useMemo(() => `${role}-${crypto.randomUUID().slice(0, 8)}`, [role]);
    const protocol = useMemo(
        (): PeerProtocolConfig<WordsearchState> => ({
            docId: wordsearchCrdtRuntime.docId,
            tagKey: wordsearchApp.tagKey,
            schema: wordsearchApp.schema,
            leafPlugins: wordsearchApp.leafPlugins,
            validateState: wordsearchApp.validateState,
        }),
        [],
    );
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostSession?.history.doc : undefined,
        initialArtifacts: role === 'host' ? (hostSession?.artifacts ?? []) : [],
        onArtifacts: (artifacts) => loadSerializedArtifacts(wordsearchApp.artifacts, artifacts),
        protocol,
    });

    useEffect(() => {
        if (role !== 'host' || hostSession) return;
        setHostSession(loadOrCreateHostSession(fingerprintHash));
    }, [fingerprintHash, hostSession, role]);

    const saveHostHistory = useCallback(
        (history: CrdtLocalHistory<WordsearchState>) => {
            const artifacts = serializedArtifactsForStore(wordsearchApp.artifacts);
            const next = {id: hostSession?.id ?? crypto.randomUUID(), history, artifacts};
            setHostSession(next);
            saveHostSession(next, fingerprintHash);
            sync.setSnapshotDocument(history.doc);
        },
        [fingerprintHash, hostSession?.id, sync],
    );

    const startNewGame = useCallback(() => {
        const next = createHostSession({persist: true, fingerprintHash});
        setHostSession(next);
        sync.broadcastSnapshot(next.history.doc, next.artifacts);
    }, [fingerprintHash, sync]);

    return (
        <main className="wordsearchPeerDemo">
            <PeerInviteConnector hostPeerId={initialHostPeerId} role={role} sync={sync} />
            <section className="wordsearchPeerControls" aria-label="Wordsearch peer controls">
                <PeerJsControls
                    role={role}
                    setRole={setRole}
                    sync={sync}
                    docId={wordsearchCrdtRuntime.docId}
                    initialHostPeerId={initialHostPeerId}
                    createInviteUrl={createDedicatedInviteUrl}
                    variant="bar"
                />
                {role === 'host' ? (
                    <button type="button" className="newGameButton" onClick={startNewGame}>
                        New game
                    </button>
                ) : null}
            </section>
            {role === 'host' && hostSession ? (
                <wordsearchCrdtRuntime.Provider
                    key={hostSession.id}
                    initial={hostSession.history}
                    transport={sync.transport}
                    save={saveHostHistory}
                >
                    <WordsearchHostPanel actor={actor} sync={sync} />
                </wordsearchCrdtRuntime.Provider>
            ) : role === 'host' ? (
                <section className="waitingPanel">
                    <h1>Loading game</h1>
                </section>
            ) : (
                <WordsearchClientDocument
                    actor={actor}
                    sync={sync}
                    setRole={setRole}
                    initialHostPeerId={initialHostPeerId}
                />
            )}
        </main>
    );
}

function WordsearchHostPanel({
    actor,
    sync,
}: {
    actor: string;
    sync: PeerJsSync<WordsearchState>;
}) {
    const editor = wordsearchCrdtRuntime.useEditorContext();
    const history = editor.useLocalHistory();

    useEffect(() => {
        sync.setSnapshotDocument(history.doc);
    }, [history.doc, sync]);

    return wordsearchApp.renderPanel({
        actor,
        editor,
        title: `Host ${wordsearchApp.title}`,
    });
}

function WordsearchClientDocument({
    actor,
    sync,
    setRole,
    initialHostPeerId,
}: {
    actor: string;
    sync: PeerJsSync<WordsearchState>;
    setRole: (role: PeerRole) => void;
    initialHostPeerId: string;
}) {
    const snapshot = useStore(sync.snapshotStore);
    const state = useStore(sync.stateStore);
    const [hostPeerId, setHostPeerId] = useState(initialHostPeerId);
    const [snapshotKey, setSnapshotKey] = useState(0);
    const initial = useMemo(() => (snapshot ? createCrdtLocalHistory(snapshot) : null), [snapshot]);

    useEffect(() => {
        if (snapshot) setSnapshotKey((current) => current + 1);
    }, [snapshot]);

    if (!initial) {
        if (state.kind === 'error') {
            return (
                <section className="waitingPanel peerErrorPanel">
                    <h1>Unable to contact host</h1>
                    <p>{friendlyPeerError(state.message)}</p>
                    <div className="peerRecoveryActions">
                        <button type="button" onClick={() => setRole('host')}>
                            Switch to host mode
                        </button>
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
                                aria-label="Host Peer ID"
                                onChange={(event) => setHostPeerId(event.target.value)}
                            />
                            <button type="submit" disabled={!hostPeerId.trim()}>
                                Connect
                            </button>
                        </form>
                    </div>
                </section>
            );
        }

        return (
            <section className="waitingPanel">
                <h1>Waiting for host snapshot</h1>
                <p>
                    {state.kind === 'waiting-for-snapshot'
                        ? `Connected to ${state.hostPeerId}`
                        : 'Enter the host Peer ID to join.'}
                </p>
            </section>
        );
    }

    return (
        <wordsearchCrdtRuntime.Provider
            key={snapshotKey}
            initial={initial}
            transport={sync.transport}
        >
            <WordsearchClientPanel actor={actor} />
        </wordsearchCrdtRuntime.Provider>
    );
}

function friendlyPeerError(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return 'Enter a different host Peer ID, or start a new host on this device.';
    return `${trimmed}. Enter a different host Peer ID, or start a new host on this device.`;
}

function WordsearchClientPanel({actor}: {actor: string}) {
    const editor = wordsearchCrdtRuntime.useEditorContext();

    return wordsearchApp.renderPanel({
        actor,
        editor,
        title: `Client ${wordsearchApp.title}`,
    });
}

function PeerInviteConnector({
    hostPeerId,
    role,
    sync,
}: {
    hostPeerId: string;
    role: PeerRole;
    sync: PeerJsSync<WordsearchState>;
}) {
    const state = useStore(sync.stateStore);
    const connections = useStore(sync.connectionsStore);
    const hasConnected = connections.some((connection) => connection.peerId === hostPeerId);

    useEffect(() => {
        if (!hostPeerId || role !== 'client' || hasConnected || state.kind !== 'ready') return;
        sync.connect(hostPeerId);
    }, [hasConnected, hostPeerId, role, state.kind, sync]);

    return null;
}

function createHostSession({
    persist,
    fingerprintHash,
}: {
    persist: boolean;
    fingerprintHash: string;
}): HostSession {
    const artifacts = initialArtifactsForStore(wordsearchApp.artifacts);
    const session = {
        id: crypto.randomUUID(),
        artifacts,
        history: createInitialCrdtHistory(wordsearchApp),
    };
    if (persist) saveHostSession(session, fingerprintHash);
    return session;
}

function loadOrCreateHostSession(fingerprintHash: string): HostSession {
    const persisted = loadHostSession(fingerprintHash);
    if (persisted) return persisted;
    return createHostSession({persist: true, fingerprintHash});
}

function loadHostSession(fingerprintHash: string): HostSession | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(HOST_SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PersistedHostSession>;
        if (
            parsed.kind !== 'umkehr.react-crdt.wordsearch-peerjs.host' ||
            parsed.version !== 1 ||
            parsed.schemaVersion !== wordsearchApp.schemaVersion ||
            parsed.schemaFingerprintHash !== fingerprintHash ||
            !parsed.history ||
            !Array.isArray(parsed.artifacts)
        ) {
            return null;
        }
        loadSerializedArtifacts(wordsearchApp.artifacts, parsed.artifacts);
        return {
            id: crypto.randomUUID(),
            artifacts: parsed.artifacts,
            history: hydrateCrdtLocalHistoryForApp(parsed.history, wordsearchApp),
        };
    } catch (error) {
        console.warn('Could not load persisted Wordsearch host session.', error);
        return null;
    }
}

function saveHostSession(session: HostSession, fingerprintHash: string) {
    if (typeof window === 'undefined') return;
    try {
        const persisted: PersistedHostSession = {
            kind: 'umkehr.react-crdt.wordsearch-peerjs.host',
            version: 1,
            schemaVersion: wordsearchApp.schemaVersion,
            schemaFingerprintHash: fingerprintHash,
            history: cloneSerializableCrdtLocalHistory(session.history),
            artifacts: session.artifacts,
        };
        window.localStorage.setItem(HOST_SESSION_STORAGE_KEY, JSON.stringify(persisted));
    } catch (error) {
        console.warn('Could not save persisted Wordsearch host session.', error);
    }
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
}

function createDedicatedInviteUrl(peerId: string) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('peer', peerId);
    url.hash = '';
    return url.toString();
}
