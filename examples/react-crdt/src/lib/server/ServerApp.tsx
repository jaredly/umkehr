import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {createInitialCrdtHistory, type AppDefinition, type CrdtRuntime} from '../crdtApp';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {ServerControls} from './ServerControls';
import {ServerHistoryView} from './ServerHistoryView';
import {
    clearServerUser,
    loadServerUser,
    loadServerReplica,
    saveServerReplica,
    saveServerUser,
} from './persistence';
import {SERVER_HTTP_URL, SERVER_PROTOCOL_VERSION} from './protocol';
import {actorForSession, ensureServerSessionId} from './session';
import {useServerSync} from './useServerSync';
import {migrateServerReplica, normalizeServerReplica} from './migration';
import {defaultServerSchemaConfig, type ServerSchemaConfig} from './schemaConfig';
import type {PersistedServerReplica, ServerSessionIdentity, ServerSync, ServerUser} from './types';

type Loaded<TState> = {
    identity: ServerSessionIdentity;
    replica: PersistedServerReplica<TState>;
    source: 'created' | 'loaded';
};

type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'needsUser'; sessionId: string; users: ServerUser[]; message?: string}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'error'; message: string};

export function ServerApp<TState>({
    app,
    runtime,
    schemaConfig: schemaConfigProp,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    schemaConfig?: ServerSchemaConfig<TState>;
}) {
    const activeDocId = readActiveDocId() ?? runtime.docId;
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const schemaConfig = useMemo(
        () => schemaConfigProp ?? defaultServerSchemaConfig<TState>(),
        [schemaConfigProp],
    );
    const [loadState, setLoadState] = useState<LoadState<TState>>({kind: 'loading'});

    useEffect(() => {
        let alive = true;
        setLoadState({kind: 'loading'});
        bootstrapInitialState(app, activeDocId, fingerprint, fingerprintHash, schemaConfig)
            .then((loaded) => {
                if (!alive) return;
                if (loaded.kind === 'ready') {
                    setLoadState({kind: 'ready', loaded: loaded.loaded});
                } else {
                    setLoadState(loaded);
                }
            })
            .catch((error) => {
                if (!alive) return;
                setLoadState({
                    kind: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprint, fingerprintHash, schemaConfig]);

    const login = useCallback(
        async (sessionId: string, nickname: string) => {
            setLoadState({kind: 'loading'});
            try {
                const user = await loginServerUser(nickname);
                await saveServerUser(user);
                const loaded = await loadInitialState(
                    app,
                    activeDocId,
                    fingerprint,
                    fingerprintHash,
                    schemaConfig,
                    createSessionIdentity(user, sessionId),
                );
                setLoadState({kind: 'ready', loaded});
            } catch (error) {
                const users = await fetchKnownUsers().catch(() => []);
                setLoadState({
                    kind: 'needsUser',
                    sessionId,
                    users,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [activeDocId, app, fingerprint, fingerprintHash, schemaConfig],
    );

    const logout = useCallback(async () => {
        const sessionId = ensureServerSessionId();
        await clearServerUser();
        const users = await fetchKnownUsers().catch(() => []);
        setLoadState({kind: 'needsUser', sessionId, users});
    }, []);

    if (loadState.kind === 'loading') {
        return (
            <main className="serverShell">
                <section className="waitingPanel">
                    <h1>Loading server replica</h1>
                    <p>Reading durable state from this browser.</p>
                </section>
            </main>
        );
    }

    if (loadState.kind === 'error') {
        return (
            <main className="serverShell">
                <section className="waitingPanel">
                    <h1>Server replica unavailable</h1>
                    <p>{loadState.message}</p>
                </section>
            </main>
        );
    }

    if (loadState.kind === 'needsUser') {
        return (
            <main className="serverShell">
                <ServerLogin
                    users={loadState.users}
                    message={loadState.message}
                    onLogin={(nickname) => void login(loadState.sessionId, nickname)}
                />
            </main>
        );
    }

    return (
        <ServerReadyApp
            app={app}
            runtime={runtime}
            docId={activeDocId}
            schemaFingerprint={fingerprint}
            schemaFingerprintHash={fingerprintHash}
            schemaConfig={schemaConfig}
            loaded={loadState.loaded}
            onLogout={() => void logout()}
        />
    );
}

function ServerReadyApp<TState>({
    app,
    runtime,
    docId,
    schemaFingerprint,
    schemaFingerprintHash,
    schemaConfig,
    loaded,
    onLogout,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    docId: string;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schemaConfig: ServerSchemaConfig<TState>;
    loaded: Loaded<TState>;
    onLogout(): void;
}) {
    const activeBranch = loaded.replica.branches[loaded.replica.activeBranchId];
    const [currentHistory, setCurrentHistory] = useState(activeBranch.history);
    const sync = useServerSync({
        app,
        docId,
        schema: app.schema,
        schemaVersion: loaded.replica.schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        schemaConfig,
        identity: loaded.identity,
        initialReplica: loaded.replica,
        replaceHistory: setCurrentHistory,
    });
    const {Provider} = runtime;

    return (
        <main className="serverShell">
            <ServerControls sync={sync} onLogout={onLogout} />
            <section className="serverDocument">
                <Provider
                    initial={currentHistory}
                    transport={sync.transport}
                    save={sync.saveHistory}
                    statuses={sync.statusStore}
                >
                    <ServerDocumentWorkspace
                        app={app}
                        runtime={runtime}
                        actor={loaded.identity.actor}
                        sync={sync}
                    />
                </Provider>
            </section>
        </main>
    );
}

function ServerLogin({
    users,
    message,
    onLogin,
}: {
    users: ServerUser[];
    message?: string;
    onLogin(nickname: string): void;
}) {
    const [nickname, setNickname] = useState('');

    function submit(event: FormEvent) {
        event.preventDefault();
        const trimmed = nickname.trim();
        if (trimmed) onLogin(trimmed);
    }

    return (
        <section className="serverLogin waitingPanel">
            <h1>Log in to server sync</h1>
            <p>Choose a known nickname or enter a new one.</p>
            {users.length ? (
                <div className="serverKnownUsers">
                    {users.map((user) => (
                        <button
                            key={user.userId}
                            type="button"
                            onClick={() => onLogin(user.nickname)}
                        >
                            {user.nickname}
                        </button>
                    ))}
                </div>
            ) : null}
            <form className="serverLoginForm" onSubmit={submit}>
                <input
                    value={nickname}
                    onChange={(event) => setNickname(event.currentTarget.value)}
                    placeholder="Nickname"
                    aria-label="Nickname"
                />
                <button type="submit" disabled={!nickname.trim()}>
                    Log in
                </button>
            </form>
            {message ? <p className="serverLoginError">{message}</p> : null}
        </section>
    );
}

function ServerDocumentWorkspace<TState>({
    app,
    runtime,
    actor,
    sync,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    actor: string;
    sync: ServerSync<TState>;
}) {
    const editor = runtime.useEditorContext();
    const [readOnly, setReadOnly] = useState(false);
    editor.useLocalHistory();

    return (
        <>
            {app.renderPanel({
                actor,
                editor,
                title: `${app.title} server client`,
                gridSlot: 'full',
                readOnly,
                setPresenceSelection: sync.setPresenceSelection,
            })}
            <ServerHistoryView
                app={app}
                sync={sync}
                editor={editor}
                onPreviewingChange={setReadOnly}
            />
        </>
    );
}

async function loadInitialState<TState>(
    app: AppDefinition<TState>,
    docId: string,
    fingerprint: string,
    fingerprintHash: string,
    schemaConfig: ServerSchemaConfig<TState>,
    identity: ServerSessionIdentity,
): Promise<Loaded<TState>> {
    const persisted = await loadServerReplica<TState>(docId);
    if (persisted) {
        const normalized = normalizeServerReplica(persisted);
        if (normalized.schemaFingerprintHash === fingerprintHash) {
            return {
                identity,
                replica: normalized,
                source: 'loaded',
            };
        }
        const migrated = migrateServerReplica({
            app,
            replica: normalized,
            schemaConfig,
            schemaFingerprint: fingerprint,
            schemaFingerprintHash: fingerprintHash,
        });
        await saveServerReplica(migrated);
        return {
            identity,
            replica: migrated,
            source: 'loaded',
        };
    }

    const history = createInitialCrdtHistory(app);
    const now = new Date().toISOString();
    const replica: PersistedServerReplica<TState> = {
        docId,
        storageVersion: 3,
        protocolVersion: SERVER_PROTOCOL_VERSION,
        schemaVersion: schemaConfig.version,
        schemaFingerprint: fingerprint,
        schemaFingerprintHash: fingerprintHash,
        activeBranchId: 'main',
        branchList: [
            {
                docId,
                branchId: 'main',
                name: 'main',
                tipEventIndex: 0,
                createdAt: now,
                updatedAt: now,
            },
        ],
        branches: {
            main: {
                branchId: 'main',
                history,
                lastSeenEventIndex: 0,
                undoCheckpointEventIndex: 0,
                events: [],
                mirrored: true,
            },
        },
        updatedAt: now,
    };
    await saveServerReplica(replica);
    return {
        identity,
        replica,
        source: 'created',
    };
}

async function bootstrapInitialState<TState>(
    app: AppDefinition<TState>,
    docId: string,
    fingerprint: string,
    fingerprintHash: string,
    schemaConfig: ServerSchemaConfig<TState>,
): Promise<
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'needsUser'; sessionId: string; users: ServerUser[]; message?: string}
> {
    const sessionId = ensureServerSessionId();
    const user = await loadServerUser();
    if (!user) {
        const users = await fetchKnownUsers();
        return {kind: 'needsUser', sessionId, users};
    }
    const loaded = await loadInitialState(
        app,
        docId,
        fingerprint,
        fingerprintHash,
        schemaConfig,
        createSessionIdentity(user, sessionId),
    );
    return {kind: 'ready', loaded};
}

function createSessionIdentity(user: ServerUser, sessionId: string): ServerSessionIdentity {
    return {
        user,
        sessionId,
        actor: actorForSession(user.userId, sessionId),
        createdAt: new Date().toISOString(),
    };
}

async function fetchKnownUsers(): Promise<ServerUser[]> {
    const response = await fetchWithTimeout(`${SERVER_HTTP_URL}/users`);
    const body = await parseJsonResponse(response);
    if (!isRecord(body) || !Array.isArray(body.users)) {
        throw new Error('Server returned an invalid user list.');
    }
    const users: ServerUser[] = [];
    for (const user of body.users) {
        if (!isServerUser(user)) throw new Error('Server returned an invalid user.');
        users.push(user);
    }
    return users;
}

async function loginServerUser(nickname: string): Promise<ServerUser> {
    const response = await fetchWithTimeout(`${SERVER_HTTP_URL}/users/login`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({nickname}),
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
        const message =
            isRecord(body) && typeof body.error === 'string' ? body.error : response.statusText;
        throw new Error(message);
    }
    if (!isRecord(body) || !isServerUser(body.user)) {
        throw new Error('Server returned an invalid user.');
    }
    return body.user;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
        return await fetch(input, {...init, signal: controller.signal});
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Timed out connecting to the React CRDT server.');
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

async function parseJsonResponse(response: Response) {
    try {
        return await response.json();
    } catch {
        throw new Error(`Server returned invalid JSON from ${response.url}.`);
    }
}

function isServerUser(value: unknown): value is ServerUser {
    return (
        isRecord(value) &&
        typeof value.userId === 'string' &&
        value.userId.length > 0 &&
        typeof value.nickname === 'string' &&
        value.nickname.length > 0
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readActiveDocId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('doc')?.trim() || undefined;
}
