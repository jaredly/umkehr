import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
    applyRemoteHistoryUpdate,
    changedNormalPathsForCrdtUpdate,
    createCrdtLocalHistory,
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createStatusStore} from 'umkehr/react-crdt';
import {createExternalStore} from '../store';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import {
    SERVER_PROTOCOL_VERSION,
    SERVER_WS_URL,
    parseServerMessage,
    type ClientServerMessage,
} from './protocol';
import {parseSessionActor} from './session';
import {saveServerReplica, sortServerEvents} from './persistence';
import {
    collapsePathToTodoRow,
    colorForUserId,
    lastEditStatusId,
    presenceSessionForActor,
    removePresenceSession,
    sanitizePresenceUsers,
    statusForLastEdit,
    upsertPresenceUser,
} from './presence';
import {buildMergePathPreview, materializeServerBranch} from './materialize';
import type {
    PersistedServerBranch,
    PersistedServerReplica,
    ServerBranch,
    ServerBranchEvent,
    ServerPresenceUser,
    ServerSessionIdentity,
    ServerSync,
    ServerSyncState,
    ServerSyncStats,
    ServerUpdateEvent,
} from './types';
import type {IJsonSchemaCollection} from 'typia';

export function useServerSync<TState>({
    app,
    docId,
    schema,
    schemaFingerprint,
    identity,
    initialReplica,
    replaceHistory,
}: {
    app: AppDefinition<TState>;
    docId: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    schemaFingerprint: string;
    identity: ServerSessionIdentity;
    initialReplica: PersistedServerReplica<TState>;
    replaceHistory(history: CrdtLocalHistory<TState>): void;
}): ServerSync<TState> {
    const activeBranchIdRef = useRef(initialReplica.activeBranchId);
    const branchesRef = useRef(initialReplica.branches);
    const branchListRef = useRef(initialReplica.branchList);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | undefined>(undefined);
    const statusTimersRef = useRef(new Map<string, number>());
    const manualOfflineRef = useRef(false);
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const clockRef = useRef(initialClock(identity.actor, allEvents(branchesRef.current)));

    const stateStore = useMemo(
        () => createExternalStore<ServerSyncState>({kind: 'offline', reason: 'starting'}),
        [],
    );
    const statsStore = useMemo(
        () => createExternalStore<ServerSyncStats>(statsFor(activeBranch(branchesRef.current, activeBranchIdRef.current))),
        [],
    );
    const eventsStore = useMemo(
        () => createExternalStore<ServerBranchEvent[]>(activeBranch(branchesRef.current, activeBranchIdRef.current).events),
        [],
    );
    const branchesStore = useMemo(() => createExternalStore<ServerBranch[]>(branchListRef.current), []);
    const activeBranchStore = useMemo(() => createExternalStore(activeBranchIdRef.current), []);
    const presenceStore = useMemo(() => createExternalStore<ServerPresenceUser[]>([]), []);
    const statusStore = useMemo(() => createStatusStore(), []);
    const manualOfflineStore = useMemo(() => createExternalStore(false), []);

    const persist = useCallback(async () => {
        const replica: PersistedServerReplica<TState> = {
            docId,
            storageVersion: 3,
            protocolVersion: SERVER_PROTOCOL_VERSION,
            schemaFingerprint,
            activeBranchId: activeBranchIdRef.current,
            branches: branchesRef.current,
            branchList: branchListRef.current,
            updatedAt: new Date().toISOString(),
        };
        await saveServerReplica(replica);
        publishStores({
            branch: activeBranch(branchesRef.current, activeBranchIdRef.current),
            statsStore,
            eventsStore,
            branchesStore,
            activeBranchStore,
            branchList: branchListRef.current,
            activeBranchId: activeBranchIdRef.current,
        });
    }, [activeBranchStore, branchesStore, docId, eventsStore, schemaFingerprint, statsStore]);

    const send = useCallback((message: ClientServerMessage) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
    }, []);

    const subscribeActiveBranch = useCallback(() => {
        const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
        send({
            kind: 'branchSubscribe',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            docId,
            branchId: branch.branchId,
            lastSeenEventIndex: branch.lastSeenEventIndex,
        });
    }, [docId, identity.actor, identity.user.userId, send]);

    const sendPresenceHello = useCallback(() => {
        send({
            kind: 'presenceHello',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            docId,
            branchId: activeBranchIdRef.current,
            color: colorForUserId(identity.user.userId),
        });
    }, [docId, identity.actor, identity.user.userId, send]);

    const flushPending = useCallback(() => {
        for (const branch of Object.values(branchesRef.current)) {
            const listed = branchListRef.current.find((candidate) => candidate.branchId === branch.branchId);
            if (listed?.pending) {
                if (
                    !send({
                        kind: 'createBranch',
                        version: SERVER_PROTOCOL_VERSION,
                        actor: identity.actor,
                        userId: identity.user.userId,
                        docId,
                        branchId: listed.branchId,
                        sourceBranchId: listed.sourceBranchId ?? 'main',
                        forkEventIndex: listed.forkEventIndex ?? 0,
                        name: listed.name,
                    })
                ) {
                    return;
                }
            }
            for (const event of branch.events) {
                if (event.kind !== 'update' || event.recorded) continue;
                const actor = parseSessionActor(event.origin);
                if (!actor) continue;
                if (
                    !send({
                        kind: 'clientUpdate',
                        version: SERVER_PROTOCOL_VERSION,
                        actor: event.origin,
                        userId: actor.userId,
                        docId,
                        branchId: event.branchId,
                        schemaFingerprint,
                        hlcTimestamp: event.hlcTimestamp,
                        update: event.update,
                    })
                ) {
                    return;
                }
            }
            for (const event of branch.events) {
                if (event.kind !== 'merge' || event.recorded) continue;
                if (
                    !send({
                        kind: 'mergeBranch',
                        version: SERVER_PROTOCOL_VERSION,
                        actor: identity.actor,
                        userId: identity.user.userId,
                        docId,
                        mergeId: event.mergeId,
                        targetBranchId: event.branchId,
                        sourceBranchId: event.sourceBranchId,
                        sourceThroughEventIndex: event.sourceThroughEventIndex,
                    })
                ) {
                    return;
                }
            }
        }
    }, [docId, identity.actor, identity.user.userId, schemaFingerprint, send]);

    const requestSync = useCallback(() => {
        subscribeActiveBranch();
    }, [subscribeActiveBranch]);

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
        for (const timer of statusTimersRef.current.values()) window.clearTimeout(timer);
        statusTimersRef.current.clear();
        statusStore.clearAll();
    }, [presenceStore, statusStore]);

    const recordRemoteLastEdit = useCallback(
        (entry: ServerUpdateEvent) => {
            const session = presenceSessionForActor(presenceStore.getSnapshot(), entry.origin);
            if (!session) return;
            const current = activeBranch(branchesRef.current, activeBranchIdRef.current).history;
            const before = current.doc;
            const preview = applyRemoteHistoryUpdate(current, entry.update);
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

    const receiveServerEvents = useCallback(
        async (branchId: string, events: ServerBranchEvent[]) => {
            const branch = ensureBranch(branchesRef.current, branchListRef.current, branchId, app);
            let changed = false;
            for (const event of events) {
                branch.lastSeenEventIndex = Math.max(branch.lastSeenEventIndex, event.eventIndex);
                if (hasEquivalentEvent(branch.events, event)) continue;
                branch.events = sortServerEvents([...branch.events, markRecorded(event)]);
                if (event.kind === 'update') {
                    const pending = branch.events.find(
                        (candidate) =>
                            candidate.kind === 'update' &&
                            candidate.hlcTimestamp === event.hlcTimestamp &&
                            candidate !== event,
                    );
                    if (pending && pending.kind === 'update') pending.recorded = true;
                }
                changed = true;
                if (branchId === activeBranchIdRef.current && event.kind === 'update') {
                    if (event.origin !== identity.actor) {
                        recordRemoteLastEdit(event);
                        transport.receive(event.update);
                    }
                }
            }
            if (changed) {
                branch.history = materializeServerBranch({
                    app,
                    branches: branchesRef.current,
                    branchId,
                });
                if (branchId === activeBranchIdRef.current) replaceHistory(branch.history);
                await persist();
            }
        },
        [app, identity.actor, persist, recordRemoteLastEdit, replaceHistory],
    );

    const markAcknowledged = useCallback(
        async (parsed: {
            branchId?: string;
            hlcTimestamp?: string;
            mergeId?: string;
            eventIndex?: number;
            branchIdCreated?: string;
        }) => {
            if (parsed.branchIdCreated) {
                branchListRef.current = branchListRef.current.map((branch) =>
                    branch.branchId === parsed.branchIdCreated ? {...branch, pending: false} : branch,
                );
            }
            if (parsed.branchId && parsed.hlcTimestamp) {
                const branch = branchesRef.current[parsed.branchId];
                if (branch) {
                    branch.events = sortServerEvents(
                        branch.events.map((event) =>
                            event.kind === 'update' && event.hlcTimestamp === parsed.hlcTimestamp
                                ? {...event, recorded: true, eventIndex: parsed.eventIndex ?? event.eventIndex}
                                : event,
                        ),
                    );
                    branch.lastSeenEventIndex = Math.max(branch.lastSeenEventIndex, parsed.eventIndex ?? 0);
                }
            }
            if (parsed.branchId && parsed.mergeId) {
                const branch = branchesRef.current[parsed.branchId];
                if (branch) {
                    branch.events = sortServerEvents(
                        branch.events.map((event) =>
                            event.kind === 'merge' && event.mergeId === parsed.mergeId
                                ? {...event, recorded: true, eventIndex: parsed.eventIndex ?? event.eventIndex}
                                : event,
                        ),
                    );
                    branch.lastSeenEventIndex = Math.max(branch.lastSeenEventIndex, parsed.eventIndex ?? 0);
                }
            }
            await persist();
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
            });
            sendPresenceHello();
            flushPending();
        });

        socket.addEventListener('message', (event) => {
            const parsed = parseServerMessage<TState>(safeJsonParse(event.data), {docId, schema});
            if (!parsed) {
                stateStore.setSnapshot({kind: 'error', message: 'Received invalid server message.'});
                return;
            }
            if (parsed.kind === 'hello' || parsed.kind === 'branchSnapshot') {
                mergeBranchList(parsed.branches);
                void persist().then(() => {
                    subscribeActiveBranch();
                    flushPending();
                });
            } else if (parsed.kind === 'branchUpdate') {
                mergeBranchList([parsed.branch]);
                void persist();
            } else if (parsed.kind === 'branchEvents') {
                void receiveServerEvents(parsed.branchId, parsed.events).then(flushPending);
            } else if (parsed.kind === 'ack') {
                void markAcknowledged(parsed).then(flushPending);
            } else if (parsed.kind === 'error') {
                stateStore.setSnapshot({kind: 'error', message: parsed.message});
            } else if (parsed.kind === 'presenceSnapshot') {
                presenceStore.setSnapshot(sanitizePresenceUsers(parsed.users, identity.actor));
            } else if (parsed.kind === 'presenceUpdate') {
                presenceStore.setSnapshot(
                    upsertPresenceUser(presenceStore.getSnapshot(), parsed.user, identity.actor),
                );
            } else if (parsed.kind === 'presenceLeave') {
                presenceStore.setSnapshot(removePresenceSession(presenceStore.getSnapshot(), parsed.actor));
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
        clearLastEditStatus,
        clearPresenceState,
        docId,
        flushPending,
        identity.actor,
        identity.user.userId,
        markAcknowledged,
        persist,
        presenceStore,
        receiveServerEvents,
        schema,
        schemaFingerprint,
        send,
        sendPresenceHello,
        stateStore,
        subscribeActiveBranch,
    ]);

    const mergeBranchList = useCallback(
        (branches: ServerBranch[]) => {
            const byId = new Map(branchListRef.current.map((branch) => [branch.branchId, branch]));
            for (const branch of branches) byId.set(branch.branchId, {...byId.get(branch.branchId), ...branch, pending: false});
            branchListRef.current = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
            for (const branch of branchListRef.current) {
                const persisted = ensureBranch(branchesRef.current, branchListRef.current, branch.branchId, app);
                persisted.sourceBranchId = branch.sourceBranchId;
                persisted.forkEventIndex = branch.forkEventIndex;
            }
        },
        [app],
    );

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
                const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
                let added = false;
                for (const update of updates) {
                    const timestamp = latestCrdtUpdateTimestamp(update);
                    if (!timestamp) continue;
                    clockRef.current = hlc.recv(clockRef.current, hlc.unpack(timestamp), Date.now());
                    if (branch.events.some((event) => event.kind === 'update' && event.hlcTimestamp === timestamp)) {
                        continue;
                    }
                    branch.events.push({
                        kind: 'update',
                        docId,
                        branchId: branch.branchId,
                        eventIndex: nextLocalEventIndex(branch),
                        origin: identity.actor,
                        hlcTimestamp: timestamp,
                        receivedAt: new Date().toISOString(),
                        update,
                        recorded: false,
                    });
                    added = true;
                }
                if (!added) return;
                branch.events = sortServerEvents(branch.events);
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
                if (timestamp) clockRef.current = hlc.recv(clockRef.current, hlc.unpack(timestamp), Date.now());
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

    function switchBranch(branchId: string) {
        if (!branchesRef.current[branchId]) ensureBranch(branchesRef.current, branchListRef.current, branchId, app);
        activeBranchIdRef.current = branchId;
        const branch = branchesRef.current[branchId];
        branch.history = materializeServerBranch({app, branches: branchesRef.current, branchId});
        replaceHistory(branch.history);
        void persist().then(() => {
            subscribeActiveBranch();
            sendPresenceHello();
        });
    }

    function createBranch(name: string, forkEventIndex?: number) {
        const source = activeBranch(branchesRef.current, activeBranchIdRef.current);
        const branchId = `branch-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const branchMeta: ServerBranch = {
            docId,
            branchId,
            name,
            sourceBranchId: source.branchId,
            forkEventIndex: forkEventIndex ?? source.lastSeenEventIndex,
            tipEventIndex: 0,
            createdAt: now,
            updatedAt: now,
            pending: true,
        };
        branchListRef.current = [...branchListRef.current, branchMeta];
        branchesRef.current[branchId] = {
            branchId,
            sourceBranchId: branchMeta.sourceBranchId,
            forkEventIndex: branchMeta.forkEventIndex,
            history: source.history,
            lastSeenEventIndex: 0,
            undoCheckpointEventIndex: 0,
            events: [],
            mirrored: true,
        };
        switchBranch(branchId);
        void persist().then(flushPending);
    }

    function renameBranch(branchId: string, name: string) {
        branchListRef.current = branchListRef.current.map((branch) =>
            branch.branchId === branchId ? {...branch, name, pending: branch.pending} : branch,
        );
        send({
            kind: 'renameBranch',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            docId,
            branchId,
            name,
        });
        void persist();
    }

    function mergeBranch(
        sourceBranchId: string,
        sourceThroughEventIndex?: number,
        revertedPathKeys = new Set<string>(),
    ) {
        const target = activeBranch(branchesRef.current, activeBranchIdRef.current);
        const source = branchesRef.current[sourceBranchId];
        if (!source) return;
        const throughEventIndex = sourceThroughEventIndex ?? source.lastSeenEventIndex;
        const preview = buildMergePathPreview({
            app,
            branches: branchesRef.current,
            targetBranchId: target.branchId,
            sourceBranchId,
            sourceThroughEventIndex: throughEventIndex,
            revertedPathKeys,
            clock: clockRef.current,
        });
        const event: ServerBranchEvent = {
            kind: 'merge',
            mergeId: `merge-${crypto.randomUUID()}`,
            docId,
            branchId: target.branchId,
            eventIndex: nextLocalEventIndex(target),
            sourceBranchId,
            sourceThroughEventIndex: throughEventIndex,
            actor: identity.actor,
            createdAt: new Date().toISOString(),
            recorded: false,
        };
        const revertEvents: ServerBranchEvent[] = preview.revertUpdates.map((update, index) => {
            const timestamp = latestCrdtUpdateTimestamp(update) ?? '';
            if (timestamp) clockRef.current = hlc.recv(clockRef.current, hlc.unpack(timestamp), Date.now());
            return {
                kind: 'update',
                docId,
                branchId: target.branchId,
                eventIndex: event.eventIndex + index + 1,
                origin: identity.actor,
                hlcTimestamp: timestamp,
                receivedAt: new Date().toISOString(),
                update,
                recorded: false,
            };
        });
        target.events = sortServerEvents([...target.events, event, ...revertEvents]);
        target.history = materializeServerBranch({app, branches: branchesRef.current, branchId: target.branchId});
        target.undoCheckpointEventIndex = Math.max(target.undoCheckpointEventIndex, ...target.events.map((item) => item.eventIndex));
        target.history = createCrdtLocalHistory(target.history.doc);
        replaceHistory(target.history);
        void persist().then(flushPending);
    }

    function buildMergePreview(
        sourceBranchId: string,
        sourceThroughEventIndex?: number,
        revertedPathKeys = new Set<string>(),
    ) {
        const source = branchesRef.current[sourceBranchId];
        if (!source) return null;
        const target = activeBranch(branchesRef.current, activeBranchIdRef.current);
        const preview = buildMergePathPreview({
            app,
            branches: branchesRef.current,
            targetBranchId: target.branchId,
            sourceBranchId,
            sourceThroughEventIndex: sourceThroughEventIndex ?? source.lastSeenEventIndex,
            revertedPathKeys,
            clock: clockRef.current,
        });
        return {...preview, revertedPathKeys};
    }

    return {
        transport,
        identity,
        stateStore,
        statsStore,
        branchesStore,
        eventsStore,
        activeBranchStore,
        presenceStore,
        statusStore,
        manualOfflineStore,
        setManualOffline,
        requestSync,
        saveHistory(history) {
            const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
            branch.history = history;
            replaceHistory(history);
            void persist();
        },
        switchBranch,
        createBranch,
        renameBranch,
        mergeBranch,
        buildMergePreview,
    };
}

function publishStores<TState>({
    branch,
    statsStore,
    eventsStore,
    branchesStore,
    activeBranchStore,
    branchList,
    activeBranchId,
}: {
    branch: PersistedServerBranch<TState>;
    statsStore: ReturnType<typeof createExternalStore<ServerSyncStats>>;
    eventsStore: ReturnType<typeof createExternalStore<ServerBranchEvent[]>>;
    branchesStore: ReturnType<typeof createExternalStore<ServerBranch[]>>;
    activeBranchStore: ReturnType<typeof createExternalStore<string>>;
    branchList: ServerBranch[];
    activeBranchId: string;
}) {
    eventsStore.setSnapshot(branch.events);
    branchesStore.setSnapshot(branchList);
    activeBranchStore.setSnapshot(activeBranchId);
    statsStore.setSnapshot(statsFor(branch));
}

function statsFor<TState>(branch: PersistedServerBranch<TState>): ServerSyncStats {
    return {
        lastSeenEventIndex: branch.lastSeenEventIndex,
        pendingUploads: branch.events.filter((event) => !event.recorded).length,
        totalEvents: branch.events.length,
        receivedEvents: branch.events.filter((event) => event.recorded).length,
        lastSyncAt: branch.events.findLast((event) => event.recorded)?.kind === 'update'
            ? (branch.events.findLast((event) => event.recorded) as ServerUpdateEvent).receivedAt
            : undefined,
    };
}

function initialClock(actor: string, events: ServerBranchEvent[]) {
    let clock = hlc.init(actor, Date.now());
    for (const event of events) {
        if (event.kind !== 'update') continue;
        const timestamp = latestCrdtUpdateTimestamp(event.update);
        if (timestamp) clock = hlc.recv(clock, hlc.unpack(timestamp), Date.now());
    }
    return clock;
}

function allEvents<TState>(branches: Record<string, PersistedServerBranch<TState>>) {
    return Object.values(branches).flatMap((branch) => branch.events);
}

function activeBranch<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    activeBranchId: string,
) {
    return branches[activeBranchId] ?? Object.values(branches)[0];
}

function ensureBranch<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    branchList: ServerBranch[],
    branchId: string,
    app: AppDefinition<TState>,
): PersistedServerBranch<TState> {
    const meta = branchList.find((branch) => branch.branchId === branchId);
    branches[branchId] ??= {
        branchId,
        sourceBranchId: meta?.sourceBranchId,
        forkEventIndex: meta?.forkEventIndex,
        history: createInitialHistoryForBranch(app, branches, branchList, branchId),
        lastSeenEventIndex: 0,
        undoCheckpointEventIndex: 0,
        events: [],
        mirrored: true,
    };
    return branches[branchId];
}

function createInitialHistoryForBranch<TState>(
    app: AppDefinition<TState>,
    branches: Record<string, PersistedServerBranch<TState>>,
    branchList: ServerBranch[],
    branchId: string,
) {
    const meta = branchList.find((branch) => branch.branchId === branchId);
    if (meta?.sourceBranchId && branches[meta.sourceBranchId]) {
        return materializeServerBranch({
            app,
            branches,
            branchId: meta.sourceBranchId,
            throughEventIndex: meta.forkEventIndex,
        });
    }
    return createInitialCrdtHistory(app);
}

function hasEquivalentEvent(events: ServerBranchEvent[], next: ServerBranchEvent) {
    return events.some((event) => {
        if (event.kind !== next.kind) return false;
        if (event.kind === 'update' && next.kind === 'update') {
            return event.hlcTimestamp === next.hlcTimestamp;
        }
        if (event.kind === 'merge' && next.kind === 'merge') {
            return event.mergeId === next.mergeId || event.eventIndex === next.eventIndex;
        }
        return false;
    });
}

function markRecorded(event: ServerBranchEvent): ServerBranchEvent {
    return {...event, recorded: true};
}

function nextLocalEventIndex<TState>(branch: PersistedServerBranch<TState>) {
    return Math.max(branch.lastSeenEventIndex, ...branch.events.map((event) => event.eventIndex), 0) + 1;
}

function safeJsonParse(input: unknown) {
    if (typeof input !== 'string') return null;
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}
