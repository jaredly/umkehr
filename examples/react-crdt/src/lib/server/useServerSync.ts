import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
    applyRemoteHistoryUpdate,
    changedNormalPathsForCrdtUpdate,
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createStatusStore} from 'umkehr/react-crdt';
import {createExternalStore} from '../store';
import {
    SERVER_PROTOCOL_VERSION,
    SERVER_WS_URL,
    parseServerMessage,
    type ClientServerMessage,
    type ServerLogEntry,
} from './protocol';
import {parseSessionActor} from './session';
import {saveServerReplica, sortServerChanges} from './persistence';
import {
    collapsePathToTodoRow,
    colorForUserId,
    lastEditStatusId,
    presenceSessionForActor,
    sanitizePresenceUsers,
    statusForLastEdit,
    upsertPresenceUser,
} from './presence';
import type {
    PersistedServerReplica,
    ServerChange,
    ServerPresenceUser,
    ServerSessionIdentity,
    ServerSync,
    ServerSyncState,
    ServerSyncStats,
} from './types';
import type {IJsonSchemaCollection} from 'typia';

export function useServerSync<TState>({
    docId,
    schema,
    schemaFingerprint,
    identity,
    initialHistory,
    initialLastSeenMessageIndex,
    initialChanges,
    replaceHistory,
}: {
    docId: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    schemaFingerprint: string;
    identity: ServerSessionIdentity;
    initialHistory: CrdtLocalHistory<TState>;
    initialLastSeenMessageIndex: number;
    initialChanges: ServerChange[];
    replaceHistory(history: CrdtLocalHistory<TState>): void;
}): ServerSync<TState> {
    const historyRef = useRef(initialHistory);
    const lastSeenRef = useRef(initialLastSeenMessageIndex);
    const changesRef = useRef(sortServerChanges(initialChanges));
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | undefined>(undefined);
    const statusTimersRef = useRef(new Map<string, number>());
    const manualOfflineRef = useRef(false);
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const clockRef = useRef(initialClock(identity.actor, changesRef.current));

    const stateStore = useMemo(
        () => createExternalStore<ServerSyncState>({kind: 'offline', reason: 'starting'}),
        [],
    );
    const statsStore = useMemo(
        () =>
            createExternalStore<ServerSyncStats>(statsFor(lastSeenRef.current, changesRef.current)),
        [],
    );
    const changesStore = useMemo(() => createExternalStore<ServerChange[]>(changesRef.current), []);
    const presenceStore = useMemo(() => createExternalStore<ServerPresenceUser[]>([]), []);
    const statusStore = useMemo(() => createStatusStore(), []);
    const manualOfflineStore = useMemo(() => createExternalStore(false), []);

    const persist = useCallback(async () => {
        const replica: PersistedServerReplica<TState> = {
            docId,
            storageVersion: 2,
            protocolVersion: SERVER_PROTOCOL_VERSION,
            schemaFingerprint,
            history: historyRef.current,
            lastSeenMessageIndex: lastSeenRef.current,
            changes: changesRef.current,
            updatedAt: new Date().toISOString(),
        };
        await saveServerReplica(replica);
        publishStores({
            lastSeen: lastSeenRef.current,
            changes: changesRef.current,
            statsStore,
            changesStore,
        });
    }, [changesStore, docId, schemaFingerprint, statsStore]);

    const send = useCallback((message: ClientServerMessage) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
    }, []);

    const flushPending = useCallback(() => {
        const pending = changesRef.current.filter(
            (change) => change.source === 'local' && !change.recorded,
        );
        for (const change of pending) {
            const actor = parseSessionActor(change.origin);
            if (!actor) continue;
            if (
                !send({
                    kind: 'clientUpdate',
                    version: SERVER_PROTOCOL_VERSION,
                    actor: change.origin,
                    userId: actor.userId,
                    docId,
                    schemaFingerprint,
                    hlcTimestamp: change.timestamp,
                    update: change.update,
                })
            ) {
                break;
            }
        }
    }, [docId, schemaFingerprint, send]);

    const requestSync = useCallback(() => {
        send({
            kind: 'syncRequest',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            docId,
            schemaFingerprint,
            lastSeenMessageIndex: lastSeenRef.current,
        });
    }, [docId, identity.actor, identity.user.userId, schemaFingerprint, send]);

    const sendPresenceHello = useCallback(() => {
        send({
            kind: 'presenceHello',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            docId,
            color: colorForUserId(identity.user.userId),
        });
    }, [docId, identity.actor, identity.user.userId, send]);

    const clearLastEditStatus = useCallback(
        (actor: string) => {
            const timer = statusTimersRef.current.get(actor);
            if (timer !== undefined) {
                window.clearTimeout(timer);
                statusTimersRef.current.delete(actor);
            }
            statusStore.clear(lastEditStatusId(actor));
        },
        [statusStore],
    );

    const scheduleLastEditStatusClear = useCallback(
        (actor: string) => {
            const existing = statusTimersRef.current.get(actor);
            if (existing !== undefined) window.clearTimeout(existing);
            const timer = window.setTimeout(() => {
                statusTimersRef.current.delete(actor);
                statusStore.clear(lastEditStatusId(actor));
            }, 60_000);
            statusTimersRef.current.set(actor, timer);
        },
        [statusStore],
    );

    const clearPresenceState = useCallback(() => {
        presenceStore.setSnapshot([]);
        for (const timer of statusTimersRef.current.values()) {
            window.clearTimeout(timer);
        }
        statusTimersRef.current.clear();
        statusStore.clearAll();
    }, [presenceStore, statusStore]);

    const recordRemoteLastEdit = useCallback(
        (entry: ServerLogEntry) => {
            const session = presenceSessionForActor(presenceStore.getSnapshot(), entry.origin);
            if (!session) return;
            const before = historyRef.current.doc;
            const preview = applyRemoteHistoryUpdate(historyRef.current, entry.update);
            const changedPaths = changedNormalPathsForCrdtUpdate(before, preview.doc, entry.update);
            const rowPath = changedPaths
                ?.toReversed()
                .map(collapsePathToTodoRow)
                .find((path) => path !== null);
            if (!rowPath) return;
            statusStore.add([
                statusForLastEdit({
                    path: rowPath,
                    session,
                    timestamp: entry.hlcTimestamp,
                    receivedAt: entry.receivedAt,
                }),
            ]);
            scheduleLastEditStatusClear(entry.origin);
        },
        [presenceStore, scheduleLastEditStatusClear, statusStore],
    );

    const receiveServerEntries = useCallback(
        async (entries: ServerLogEntry[]) => {
            let changed = false;
            for (const entry of entries) {
                lastSeenRef.current = Math.max(lastSeenRef.current, entry.messageIndex);
                if (entry.origin === identity.actor) continue;
                if (changesRef.current.some((change) => change.timestamp === entry.hlcTimestamp)) {
                    continue;
                }
                changesRef.current = sortServerChanges([
                    ...changesRef.current,
                    {
                        docId,
                        timestamp: entry.hlcTimestamp,
                        origin: entry.origin,
                        source: 'remote',
                        update: entry.update,
                        recorded: true,
                        messageIndex: entry.messageIndex,
                        receivedAt: entry.receivedAt,
                    },
                ]);
                recordRemoteLastEdit(entry);
                transport.receive(entry.update);
                changed = true;
            }
            if (entries.length || changed) {
                await persist();
            }
        },
        [docId, identity.actor, persist, recordRemoteLastEdit],
    );

    const markAcknowledged = useCallback(
        async (timestamp: string) => {
            let changed = false;
            changesRef.current = changesRef.current.map((change) => {
                if (change.timestamp !== timestamp || change.recorded) return change;
                changed = true;
                return {...change, recorded: true};
            });
            if (changed) await persist();
        },
        [persist],
    );

    const connect = useCallback(() => {
        if (manualOfflineRef.current) return;
        if (socketRef.current?.readyState === WebSocket.OPEN) return;
        if (socketRef.current?.readyState === WebSocket.CONNECTING) return;

        stateStore.setSnapshot({kind: 'connecting'});
        const socket = new WebSocket(SERVER_WS_URL);
        socketRef.current = socket;

        socket.addEventListener('open', () => {
            stateStore.setSnapshot({kind: 'connected'});
            send({
                kind: 'hello',
                version: SERVER_PROTOCOL_VERSION,
                actor: identity.actor,
                userId: identity.user.userId,
                docId,
                schemaFingerprint,
                lastSeenMessageIndex: lastSeenRef.current,
            });
            sendPresenceHello();
            flushPending();
        });

        socket.addEventListener('message', (event) => {
            const parsed = parseServerMessage<TState>(safeJsonParse(event.data), {docId, schema});
            if (!parsed) {
                stateStore.setSnapshot({
                    kind: 'error',
                    message: 'Received invalid server message.',
                });
                return;
            }
            if (parsed.kind === 'hello') {
                requestSync();
            } else if (parsed.kind === 'serverUpdates') {
                void receiveServerEntries(parsed.entries).then(flushPending);
            } else if (parsed.kind === 'ack') {
                void markAcknowledged(parsed.hlcTimestamp).then(flushPending);
            } else if (parsed.kind === 'error') {
                stateStore.setSnapshot({kind: 'error', message: parsed.message});
            } else if (parsed.kind === 'presenceSnapshot') {
                presenceStore.setSnapshot(sanitizePresenceUsers(parsed.users, identity.actor));
            } else if (parsed.kind === 'presenceUpdate') {
                presenceStore.setSnapshot(
                    upsertPresenceUser(
                        presenceStore.getSnapshot(),
                        parsed.user,
                        identity.actor,
                    ),
                );
            } else if (parsed.kind === 'presenceLeave') {
                presenceStore.setSnapshot(
                    presenceStore
                        .getSnapshot()
                        .map((user) => ({
                            ...user,
                            sessions: user.sessions.filter(
                                (session) => session.actor !== parsed.actor,
                            ),
                        }))
                        .filter((user) => user.sessions.length > 0),
                );
                clearLastEditStatus(parsed.actor);
            }
        });

        socket.addEventListener('close', () => {
            if (socketRef.current === socket) socketRef.current = null;
            clearPresenceState();
            if (manualOfflineRef.current) {
                stateStore.setSnapshot({kind: 'offline', reason: 'manual'});
                return;
            }
            stateStore.setSnapshot({kind: 'offline', reason: 'starting'});
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = window.setTimeout(connect, 1000);
        });

        socket.addEventListener('error', () => {
            stateStore.setSnapshot({kind: 'error', message: 'WebSocket connection failed.'});
        });
    }, [
        docId,
        flushPending,
        sendPresenceHello,
        identity.actor,
        identity.user.userId,
        clearLastEditStatus,
        clearPresenceState,
        markAcknowledged,
        presenceStore,
        receiveServerEntries,
        requestSync,
        schema,
        schemaFingerprint,
        send,
        stateStore,
    ]);

    const setManualOffline = useCallback(
        (offline: boolean) => {
            manualOfflineRef.current = offline;
            manualOfflineStore.setSnapshot(offline);
            if (offline) {
                window.clearTimeout(reconnectTimerRef.current);
                socketRef.current?.close();
                socketRef.current = null;
                stateStore.setSnapshot({kind: 'offline', reason: 'manual'});
                return;
            }
            connect();
        },
        [connect, manualOfflineStore, stateStore],
    );

    const transport = useMemo(() => {
        return {
            actor: identity.actor,
            tick() {
                clockRef.current = hlc.inc(clockRef.current, Date.now());
                return clockRef.current;
            },
            publish(updates: CrdtUpdate[]) {
                const nextChanges = [...changesRef.current];
                let added = false;
                for (const update of updates) {
                    const timestamp = latestCrdtUpdateTimestamp(update);
                    if (!timestamp) continue;
                    clockRef.current = hlc.recv(
                        clockRef.current,
                        hlc.unpack(timestamp),
                        Date.now(),
                    );
                    if (nextChanges.some((change) => change.timestamp === timestamp)) continue;
                    nextChanges.push({
                        docId,
                        timestamp,
                        origin: identity.actor,
                        source: 'local',
                        update,
                        recorded: false,
                        receivedAt: new Date().toISOString(),
                    });
                    added = true;
                }
                if (!added) return;
                changesRef.current = sortServerChanges(nextChanges);
                void persist().then(flushPending);
            },
            subscribe(receive: (update: CrdtUpdate) => void) {
                listenersRef.current.add(receive);
                return () => {
                    listenersRef.current.delete(receive);
                };
            },
            receive(update: CrdtUpdate) {
                const timestamp = latestCrdtUpdateTimestamp(update);
                if (timestamp) {
                    clockRef.current = hlc.recv(
                        clockRef.current,
                        hlc.unpack(timestamp),
                        Date.now(),
                    );
                }
                for (const listener of listenersRef.current) listener(update);
            },
        };
    }, [docId, flushPending, identity.actor, persist]);

    useEffect(() => {
        connect();
        return () => {
            window.clearTimeout(reconnectTimerRef.current);
            socketRef.current?.close();
            clearPresenceState();
        };
    }, [clearPresenceState, connect]);

    return {
        transport,
        identity,
        stateStore,
        statsStore,
        changesStore,
        presenceStore,
        statusStore,
        manualOfflineStore,
        setManualOffline,
        requestSync,
        saveHistory(history) {
            historyRef.current = history;
            replaceHistory(history);
            void persist();
        },
    };
}

function publishStores({
    lastSeen,
    changes,
    statsStore,
    changesStore,
}: {
    lastSeen: number;
    changes: ServerChange[];
    statsStore: ReturnType<typeof createExternalStore<ServerSyncStats>>;
    changesStore: ReturnType<typeof createExternalStore<ServerChange[]>>;
}) {
    changesStore.setSnapshot(changes);
    statsStore.setSnapshot(statsFor(lastSeen, changes));
}

function statsFor(lastSeenMessageIndex: number, changes: ServerChange[]): ServerSyncStats {
    return {
        lastSeenMessageIndex,
        pendingUploads: changes.filter((change) => change.source === 'local' && !change.recorded)
            .length,
        totalChanges: changes.length,
        receivedChanges: changes.filter((change) => change.source === 'remote').length,
        lastSyncAt: changes.findLast((change) => change.recorded)?.receivedAt,
    };
}

function initialClock(actor: string, changes: ServerChange[]) {
    let clock = hlc.init(actor, Date.now());
    for (const change of changes) {
        clock = hlc.recv(clock, hlc.unpack(change.timestamp), Date.now());
    }
    return clock;
}

function safeJsonParse(input: unknown) {
    if (typeof input !== 'string') return null;
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}
