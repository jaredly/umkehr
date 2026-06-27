import {useCallback, useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory, type CrdtLocalHistory} from 'umkehr/crdt';
import {createInitialCrdtHistory} from '../../lib/crdtApp';
import {
    initialArtifactsForStore,
    loadSerializedArtifacts,
    serializedArtifactsForStore,
    type SerializedArtifact,
} from '../../lib/artifacts';
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

export function WordsearchPeerJsDemo() {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const [hostSession, setHostSession] = useState(createHostSession);
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
        initialDocument: role === 'host' ? hostSession.history.doc : undefined,
        initialArtifacts: role === 'host' ? hostSession.artifacts : [],
        onArtifacts: (artifacts) => loadSerializedArtifacts(wordsearchApp.artifacts, artifacts),
        protocol,
    });

    const saveHostHistory = useCallback(
        (history: CrdtLocalHistory<WordsearchState>) => {
            const artifacts = serializedArtifactsForStore(wordsearchApp.artifacts);
            setHostSession((current) => ({...current, history, artifacts}));
            sync.setSnapshotDocument(history.doc);
        },
        [sync],
    );

    const startNewGame = useCallback(() => {
        const next = createHostSession();
        setHostSession(next);
        sync.broadcastSnapshot(next.history.doc, next.artifacts);
    }, [sync]);

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
            {role === 'host' ? (
                <wordsearchCrdtRuntime.Provider
                    key={hostSession.id}
                    initial={hostSession.history}
                    transport={sync.transport}
                    save={saveHostHistory}
                >
                    <WordsearchHostPanel actor={actor} sync={sync} />
                </wordsearchCrdtRuntime.Provider>
            ) : (
                <WordsearchClientDocument actor={actor} sync={sync} />
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
}: {
    actor: string;
    sync: PeerJsSync<WordsearchState>;
}) {
    const snapshot = useStore(sync.snapshotStore);
    const state = useStore(sync.stateStore);
    const [snapshotKey, setSnapshotKey] = useState(0);
    const initial = useMemo(() => (snapshot ? createCrdtLocalHistory(snapshot) : null), [snapshot]);

    useEffect(() => {
        if (snapshot) setSnapshotKey((current) => current + 1);
    }, [snapshot]);

    if (!initial) {
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

function createHostSession(): HostSession {
    const artifacts = initialArtifactsForStore(wordsearchApp.artifacts);
    return {
        id: crypto.randomUUID(),
        artifacts,
        history: createInitialCrdtHistory(wordsearchApp),
    };
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
