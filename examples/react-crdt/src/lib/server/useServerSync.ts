import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
    applyCrdtUpdate,
    applyRemoteHistoryUpdate,
    changedNormalPathsForCrdtUpdate,
    createCrdtLocalHistory,
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createStatusStore, type EphemeralMessage, type SyncedTransport} from 'umkehr/react-crdt';
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
    statusForWhiteboardSelection,
    upsertPresenceUser,
    whiteboardSelectionStatusId,
} from './presence';
import {
    buildMergePathPreview,
    materializeServerBranch,
    mergeSourceUpdatesForBranchThrough,
} from './materialize';
import {migrateServerDump} from './migration';
import type {ServerSchemaConfig} from './schemaConfig';
import {canFlushPendingServerWrites, serverMigrationStateForMessage} from './states';
import {
    applyPendingEvents,
    blockedBranchesForReview,
    buildStaleMergeReview as buildStaleMergeReviewModel,
    pendingEventsForBranch,
    withOnlyRecordedEvents,
} from './staleReview';
import type {
    PersistedServerBranch,
    PersistedServerStaleReview,
    PersistedServerReplica,
    ServerBranch,
    ServerBranchEvent,
    ServerOldPendingChangesPolicy,
    ServerPresenceUser,
    ServerSessionIdentity,
    ServerSync,
    ServerStaleMergeReview,
    ServerStaleMergeReviewMetadata,
    ServerSyncState,
    ServerSyncStats,
    ServerUpdateEvent,
} from './types';
import type {IJsonSchemaCollection} from 'typia';

const DUPLICATE_SESSION_MESSAGE =
    'This server session is already open in another tab or window. Close the other copy, then reconnect, or open a URL with a different session.';

export function useServerSync<TState>({
    app,
    docId,
    title,
    schema,
    schemaVersion,
    schemaFingerprint,
    schemaFingerprintHash,
    schemaConfig,
    oldPendingChangesPolicy = {kind: 'auto-merge'},
    identity,
    initialReplica,
    replaceHistory,
}: {
    app: AppDefinition<TState>;
    docId: string;
    title: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schemaConfig: ServerSchemaConfig<TState>;
    oldPendingChangesPolicy?: ServerOldPendingChangesPolicy;
    identity: ServerSessionIdentity;
    initialReplica: PersistedServerReplica<TState>;
    replaceHistory(history: CrdtLocalHistory<TState>): void;
}): ServerSync<TState> {
    const activeBranchIdRef = useRef(initialReplica.activeBranchId);
    const branchesRef = useRef(initialReplica.branches);
    const branchListRef = useRef(initialReplica.branchList);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | undefined>(undefined);
    const suppressReconnectRef = useRef(false);
    const statusTimersRef = useRef(new Map<string, number>());
    const manualOfflineRef = useRef(false);
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const ephemeralListenersRef = useRef(new Set<(message: EphemeralMessage<unknown>) => void>());
    const clockRef = useRef(initialClock(identity.actor, allEvents(branchesRef.current)));
    const reviewRef = useRef<RuntimeStaleReview>(
        runtimeReviewFromPersisted(initialReplica.staleMergeReview),
    );

    const stateStore = useMemo(
        () => createExternalStore<ServerSyncState>({kind: 'offline', reason: 'starting'}),
        [],
    );
    const statsStore = useMemo(
        () =>
            createExternalStore<ServerSyncStats>(
                statsFor(activeBranch(branchesRef.current, activeBranchIdRef.current)),
            ),
        [],
    );
    const eventsStore = useMemo(
        () =>
            createExternalStore<ServerBranchEvent[]>(
                activeBranch(branchesRef.current, activeBranchIdRef.current).events,
            ),
        [],
    );
    const branchesStore = useMemo(
        () => createExternalStore<ServerBranch[]>(branchListRef.current),
        [],
    );
    const activeBranchStore = useMemo(() => createExternalStore(activeBranchIdRef.current), []);
    const presenceStore = useMemo(() => createExternalStore<ServerPresenceUser[]>([]), []);
    const statusStore = useMemo(() => createStatusStore(), []);
    const manualOfflineStore = useMemo(() => createExternalStore(false), []);
    const staleMergeReviewStore = useMemo(
        () =>
            createExternalStore<ServerStaleMergeReview<TState> | null>(
                buildActiveStaleMergeReview(app, branchesRef.current, reviewRef.current),
            ),
        [app],
    );

    const persist = useCallback(async () => {
        const replica: PersistedServerReplica<TState> = {
            docId,
            appId: app.id,
            storageVersion: 4,
            protocolVersion: SERVER_PROTOCOL_VERSION,
            schemaVersion: initialReplica.schemaVersion ?? 1,
            schemaFingerprint,
            schemaFingerprintHash,
            activeBranchId: activeBranchIdRef.current,
            branches: branchesRef.current,
            branchList: branchListRef.current,
            staleMergeReview: persistedReviewFromRuntime(reviewRef.current),
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
        publishReviewStore(app, branchesRef.current, reviewRef.current, staleMergeReviewStore);
    }, [
        activeBranchStore,
        app.id,
        app,
        branchesStore,
        docId,
        eventsStore,
        schemaFingerprint,
        schemaFingerprintHash,
        staleMergeReviewStore,
        statsStore,
    ]);

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
            appId: app.id,
            branchId: branch.branchId,
            lastSeenEventIndex: branch.lastSeenEventIndex,
        });
    }, [app.id, docId, identity.actor, identity.user.userId, send]);

    const sendPresenceHello = useCallback(() => {
        send({
            kind: 'presenceHello',
            version: SERVER_PROTOCOL_VERSION,
            actor: identity.actor,
            userId: identity.user.userId,
            nickname: identity.user.nickname,
            docId,
            branchId: activeBranchIdRef.current,
            color: colorForUserId(identity.user.userId),
        });
    }, [docId, identity.actor, identity.user.nickname, identity.user.userId, send]);

    const setPresenceSelection = useCallback(
        (elementId: string | null) => {
            const branchId = activeBranchIdRef.current;
            if (!elementId) statusStore.clear(whiteboardSelectionStatusId(identity.actor));
            send({
                kind: 'presenceSelection',
                version: SERVER_PROTOCOL_VERSION,
                actor: identity.actor,
                userId: identity.user.userId,
                docId,
                branchId,
                elementId,
            });
        },
        [docId, identity.actor, identity.user.userId, send, statusStore],
    );

    const flushPending = useCallback(() => {
        const state = stateStore.getSnapshot();
        const reviewAllowsPartialFlush = state.kind === 'merge-review-required';
        if (!reviewAllowsPartialFlush && !canFlushPendingServerWrites(state)) return;
        for (const branch of Object.values(branchesRef.current)) {
            if (isReviewBlockedBranch(reviewRef.current, branch.branchId)) continue;
            const listed = branchListRef.current.find(
                (candidate) => candidate.branchId === branch.branchId,
            );
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
                        appId: app.id,
                        branchId: event.branchId,
                        schemaVersion,
                        schemaFingerprint,
                        schemaFingerprintHash,
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
    }, [
        docId,
        app.id,
        identity.actor,
        identity.user.userId,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        send,
    ]);

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

    const syncSelectionStatuses = useCallback(
        (users: ServerPresenceUser[]) => {
            for (const user of users) {
                for (const session of user.sessions) {
                    statusStore.clear(whiteboardSelectionStatusId(session.actor));
                    if (
                        session.branchId !== activeBranchIdRef.current ||
                        !session.selectionElementId
                    ) {
                        continue;
                    }
                    statusStore.add([
                        statusForWhiteboardSelection({
                            session,
                            elementId: session.selectionElementId,
                            receivedAt: new Date().toISOString(),
                        }),
                    ]);
                }
            }
        },
        [statusStore],
    );

    const applySelectionMessage = useCallback(
        (message: {
            actor: string;
            userId: string;
            sessionId: string;
            branchId: string;
            elementId: string | null;
            at: string;
        }) => {
            statusStore.clear(whiteboardSelectionStatusId(message.actor));
            if (message.branchId !== activeBranchIdRef.current || !message.elementId) return;
            const session = presenceSessionForActor(presenceStore.getSnapshot(), message.actor);
            if (!session) return;
            statusStore.add([
                statusForWhiteboardSelection({
                    session,
                    elementId: message.elementId,
                    receivedAt: message.at,
                }),
            ]);
        },
        [presenceStore, statusStore],
    );

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
            let activeBranchNeedsReplacement = false;
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
                } else if (branchId === activeBranchIdRef.current && event.kind === 'merge') {
                    activeBranchNeedsReplacement = !applyMergeEventIncrementally(
                        branchesRef.current,
                        branch,
                        event,
                        transport.receive,
                    );
                }
            }
            if (changed) {
                const materializeBranches = reviewRef.current.blockedBranchIds.has(branchId)
                    ? withOnlyRecordedEvents(branchesRef.current, branchId)
                    : branchesRef.current;
                branch.history = materializeServerBranch({
                    app,
                    branches: materializeBranches,
                    branchId,
                });
                if (branchId === activeBranchIdRef.current && activeBranchNeedsReplacement) {
                    replaceHistory(branch.history);
                }
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
                    branch.branchId === parsed.branchIdCreated
                        ? {...branch, pending: false}
                        : branch,
                );
            }
            if (parsed.branchId && parsed.hlcTimestamp) {
                const branch = branchesRef.current[parsed.branchId];
                if (branch) {
                    branch.events = sortServerEvents(
                        branch.events.map((event) =>
                            event.kind === 'update' && event.hlcTimestamp === parsed.hlcTimestamp
                                ? {
                                      ...event,
                                      recorded: true,
                                      eventIndex: parsed.eventIndex ?? event.eventIndex,
                                  }
                                : event,
                        ),
                    );
                    branch.lastSeenEventIndex = Math.max(
                        branch.lastSeenEventIndex,
                        parsed.eventIndex ?? 0,
                    );
                }
            }
            if (parsed.branchId && parsed.mergeId) {
                const branch = branchesRef.current[parsed.branchId];
                if (branch) {
                    branch.events = sortServerEvents(
                        branch.events.map((event) =>
                            event.kind === 'merge' && event.mergeId === parsed.mergeId
                                ? {
                                      ...event,
                                      recorded: true,
                                      eventIndex: parsed.eventIndex ?? event.eventIndex,
                                  }
                                : event,
                        ),
                    );
                    branch.lastSeenEventIndex = Math.max(
                        branch.lastSeenEventIndex,
                        parsed.eventIndex ?? 0,
                    );
                }
            }
            await persist();
        },
        [persist],
    );

    const enterOrUpdateStaleReview = useCallback(() => {
        if (oldPendingChangesPolicy.kind !== 'manual-review') return false;
        const currentState = stateStore.getSnapshot();
        if (isMigrationOrErrorState(currentState)) return false;
        const blocked = blockedBranchesForReview({
            branches: branchesRef.current,
            branchList: branchListRef.current,
            policy: oldPendingChangesPolicy,
        });
        mergeBlockedReviewMetadata(reviewRef.current, blocked);
        publishReviewState(
            app,
            branchesRef.current,
            branchListRef.current,
            reviewRef.current,
            stateStore,
        );
        publishReviewStore(app, branchesRef.current, reviewRef.current, staleMergeReviewStore);
        return Boolean(reviewRef.current.activeBranchId);
    }, [app, oldPendingChangesPolicy, staleMergeReviewStore, stateStore]);

    const connect = useCallback(() => {
        if (manualOfflineRef.current) return;
        if (socketRef.current?.readyState === WebSocket.OPEN) return;
        if (socketRef.current?.readyState === WebSocket.CONNECTING) return;

        suppressReconnectRef.current = false;
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
                appId: app.id,
                schemaVersion,
                schemaFingerprint,
                schemaFingerprintHash,
            });
            sendPresenceHello();
        });

        socket.addEventListener('message', (event) => {
            const parsed = parseServerMessage<TState>(safeJsonParse(event.data), {
                docId,
                schema,
                leafPlugins: app.leafPlugins,
            });
            if (!parsed) {
                stateStore.setSnapshot({
                    kind: 'error',
                    message: 'Received invalid server message.',
                });
                return;
            }
            if (parsed.kind === 'hello' || parsed.kind === 'branchSnapshot') {
                mergeBranchList(parsed.branches);
                void persist().then(() => {
                    subscribeActiveBranch();
                    enterOrUpdateStaleReview();
                    flushPending();
                });
            } else if (parsed.kind === 'unknownDocument') {
                const replica = currentReplica();
                send({
                    kind: 'serverDocumentImport',
                    version: SERVER_PROTOCOL_VERSION,
                    actor: identity.actor,
                    userId: identity.user.userId,
                    docId,
                    appId: app.id,
                    schemaVersion,
                    schemaFingerprint,
                    schemaFingerprintHash,
                    importedAt: new Date().toISOString(),
                    importedBy: identity.actor,
                    branches: replica.branchList,
                    events: Object.values(replica.branches).flatMap((branch) => branch.events),
                });
            } else if (parsed.kind === 'branchUpdate') {
                mergeBranchList([parsed.branch]);
                enterOrUpdateStaleReview();
                void persist().then(flushPending);
            } else if (parsed.kind === 'branchEvents') {
                void receiveServerEvents(parsed.branchId, parsed.events).then(flushPending);
            } else if (parsed.kind === 'ack') {
                void markAcknowledged(parsed).then(flushPending);
            } else if (parsed.kind === 'error') {
                if (parsed.message === 'Session is already connected.') {
                    suppressReconnectRef.current = true;
                    stateStore.setSnapshot({
                        kind: 'error',
                        message: DUPLICATE_SESSION_MESSAGE,
                        duplicateSession: true,
                    });
                    return;
                }
                stateStore.setSnapshot({kind: 'error', message: parsed.message});
            } else if (parsed.kind === 'presenceSnapshot') {
                const users = sanitizePresenceUsers(parsed.users, identity.actor);
                presenceStore.setSnapshot(users);
                syncSelectionStatuses(users);
            } else if (parsed.kind === 'presenceUpdate') {
                const users = upsertPresenceUser(
                    presenceStore.getSnapshot(),
                    parsed.user,
                    identity.actor,
                );
                presenceStore.setSnapshot(users);
                syncSelectionStatuses(users);
            } else if (parsed.kind === 'presenceLeave') {
                presenceStore.setSnapshot(
                    removePresenceSession(presenceStore.getSnapshot(), parsed.actor),
                );
                clearLastEditStatus(parsed.actor);
                statusStore.clear(whiteboardSelectionStatusId(parsed.actor));
                transport.clearEphemeralActor?.(parsed.actor);
            } else if (parsed.kind === 'presenceSelection') {
                applySelectionMessage(parsed);
            } else if (parsed.kind === 'presenceEvent') {
                if (parsed.branchId === activeBranchIdRef.current) {
                    for (const listener of ephemeralListenersRef.current) listener(parsed.event);
                }
            } else if (parsed.kind === 'serverMigrationRequired') {
                stateStore.setSnapshot(serverMigrationStateForMessage(parsed));
            } else if (parsed.kind === 'waitForMigration') {
                stateStore.setSnapshot(serverMigrationStateForMessage(parsed));
            } else if (parsed.kind === 'clientMigrationRequired') {
                stateStore.setSnapshot(
                    serverMigrationStateForMessage({
                        kind: 'clientMigrationRequired',
                        schemaVersion: parsed.schemaVersion,
                        schemaFingerprintHash: parsed.schemaFingerprintHash,
                    }),
                );
            } else if (parsed.kind === 'schemaMismatch') {
                stateStore.setSnapshot(
                    serverMigrationStateForMessage({
                        kind: 'schemaMismatch',
                        schemaVersion: parsed.schemaVersion,
                        schemaFingerprintHash: parsed.schemaFingerprintHash,
                    }),
                );
            } else if (parsed.kind === 'migrationCancelled') {
                stateStore.setSnapshot(serverMigrationStateForMessage(parsed));
                reconnectTimerRef.current = window.setTimeout(connect, 0);
            } else if (parsed.kind === 'serverMigrationDump') {
                void (async () => {
                    try {
                        const delayMs = serverMigrationDelayMsFromUrl();
                        if (delayMs > 0) await delay(delayMs);
                        const upload = migrateServerDump({
                            app,
                            dump: parsed,
                            schemaConfig,
                            schemaFingerprint,
                            schemaFingerprintHash,
                        });
                        send({
                            ...upload,
                            actor: identity.actor,
                            userId: identity.user.userId,
                            appId: app.id,
                        });
                    } catch (error) {
                        console.error('Server document migration failed.', error);
                        stateStore.setSnapshot({
                            kind: 'error',
                            message:
                                'Document migration failed. See developer console for details.',
                        });
                    }
                })();
            } else if (parsed.kind === 'serverMigrationComplete') {
                stateStore.setSnapshot({kind: 'offline', reason: 'starting'});
                window.clearTimeout(reconnectTimerRef.current);
                socketRef.current?.close();
                socketRef.current = null;
                reconnectTimerRef.current = window.setTimeout(connect, 0);
            }
        });

        socket.addEventListener('close', () => {
            if (socketRef.current === socket) socketRef.current = null;
            clearPresenceState();
            if (suppressReconnectRef.current) return;
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
        app.id,
        enterOrUpdateStaleReview,
        flushPending,
        identity.actor,
        identity.user.userId,
        markAcknowledged,
        persist,
        presenceStore,
        receiveServerEvents,
        schema,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        schemaConfig,
        send,
        sendPresenceHello,
        stateStore,
        statusStore,
        subscribeActiveBranch,
        syncSelectionStatuses,
        applySelectionMessage,
    ]);

    const mergeBranchList = useCallback(
        (branches: ServerBranch[]) => {
            const byId = new Map(branchListRef.current.map((branch) => [branch.branchId, branch]));
            for (const branch of branches)
                byId.set(branch.branchId, {
                    ...byId.get(branch.branchId),
                    ...branch,
                    pending: false,
                });
            branchListRef.current = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
            for (const branch of branchListRef.current) {
                const persisted = ensureBranch(
                    branchesRef.current,
                    branchListRef.current,
                    branch.branchId,
                    app,
                );
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
                suppressReconnectRef.current = true;
                socketRef.current?.close();
                socketRef.current = null;
                stateStore.setSnapshot({kind: 'offline', reason: 'manual'});
                return;
            }
            suppressReconnectRef.current = false;
            connect();
        },
        [connect, manualOfflineStore, stateStore],
    );

    const transport = useMemo((): SyncedTransport & {receive(update: CrdtUpdate): void} => {
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
                    clockRef.current = hlc.recv(
                        clockRef.current,
                        hlc.unpack(timestamp),
                        Date.now(),
                    );
                    if (
                        branch.events.some(
                            (event) => event.kind === 'update' && event.hlcTimestamp === timestamp,
                        )
                    ) {
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
            publishEphemeral<Data>(messages: EphemeralMessage<Data>[]) {
                if (!messages.length) return;
                for (const message of messages) {
                    send({
                        kind: 'presenceEvent',
                        version: SERVER_PROTOCOL_VERSION,
                        actor: identity.actor,
                        userId: identity.user.userId,
                        docId,
                        branchId: activeBranchIdRef.current,
                        event: message,
                    });
                }
            },
            subscribeEphemeral<Data>(receive: (message: EphemeralMessage<Data>) => void) {
                const listener = receive as (message: EphemeralMessage<unknown>) => void;
                ephemeralListenersRef.current.add(listener);
                return () => {
                    ephemeralListenersRef.current.delete(listener);
                };
            },
            receive(update: CrdtUpdate) {
                const timestamp = latestCrdtUpdateTimestamp(update);
                if (timestamp)
                    clockRef.current = hlc.recv(
                        clockRef.current,
                        hlc.unpack(timestamp),
                        Date.now(),
                    );
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
        if (reviewRef.current.activeBranchId) return;
        if (!branchesRef.current[branchId])
            ensureBranch(branchesRef.current, branchListRef.current, branchId, app);
        for (const user of presenceStore.getSnapshot()) {
            for (const session of user.sessions) transport.clearEphemeralActor?.(session.actor);
        }
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
            if (timestamp)
                clockRef.current = hlc.recv(clockRef.current, hlc.unpack(timestamp), Date.now());
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
        target.history = materializeServerBranch({
            app,
            branches: branchesRef.current,
            branchId: target.branchId,
        });
        target.undoCheckpointEventIndex = Math.max(
            target.undoCheckpointEventIndex,
            ...target.events.map((item) => item.eventIndex),
        );
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

    function buildStaleMergeReview() {
        return buildActiveStaleMergeReview(app, branchesRef.current, reviewRef.current);
    }

    function completeStaleMerge(resultUpdates: CrdtUpdate[]) {
        const metadata = activeReviewMetadata(reviewRef.current);
        if (!metadata) return;
        const branch = branchesRef.current[metadata.sourceBranchId];
        if (!branch) return;
        const pending = pendingEventsForBranch(branch);
        const recorded = branch.events.filter((event) => event.recorded);
        const reindexedPending = reindexPendingEvents(
            pending,
            metadata.sourceBranchId,
            metadata.serverTipEventIndex,
        );
        branch.events = sortServerEvents([
            ...recorded,
            ...reindexedPending,
            ...eventsForUpdates({
                updates: resultUpdates,
                docId,
                branchId: metadata.sourceBranchId,
                origin: identity.actor,
                startEventIndex: metadata.serverTipEventIndex + reindexedPending.length + 1,
            }),
        ]);
        branch.history = materializeServerBranch({
            app,
            branches: branchesRef.current,
            branchId: metadata.sourceBranchId,
        });
        resolveActiveReview(reviewRef.current, metadata.sourceBranchId);
        if (activeBranchIdRef.current === metadata.sourceBranchId) replaceHistory(branch.history);
        publishReviewState(
            app,
            branchesRef.current,
            branchListRef.current,
            reviewRef.current,
            stateStore,
        );
        void persist().then(flushPending);
    }

    function forkStaleLocalChanges(name?: string) {
        const metadata = activeReviewMetadata(reviewRef.current);
        if (!metadata) return;
        const source = branchesRef.current[metadata.sourceBranchId];
        if (!source) return;
        const sourceMeta = branchListRef.current.find(
            (branch) => branch.branchId === metadata.sourceBranchId,
        );
        const now = new Date().toISOString();
        const branchId = `branch-${crypto.randomUUID()}`;
        const branchName =
            name?.trim() ||
            `${sourceMeta?.name ?? metadata.sourceBranchId}/sync-review-${Date.now()}`;
        const pending = pendingEventsForBranch(source);
        source.events = sortServerEvents(source.events.filter((event) => event.recorded));
        source.history = materializeServerBranch({
            app,
            branches: withOnlyRecordedEvents(branchesRef.current, metadata.sourceBranchId),
            branchId: metadata.sourceBranchId,
        });
        const branchMeta: ServerBranch = {
            docId,
            branchId,
            name: branchName,
            sourceBranchId: metadata.sourceBranchId,
            forkEventIndex: metadata.baseEventIndex,
            tipEventIndex: 0,
            createdAt: now,
            updatedAt: now,
            pending: true,
        };
        branchListRef.current = [...branchListRef.current, branchMeta];
        branchesRef.current[branchId] = {
            branchId,
            sourceBranchId: metadata.sourceBranchId,
            forkEventIndex: metadata.baseEventIndex,
            history: applyPendingEvents(
                materializeServerBranch({
                    app,
                    branches: withOnlyRecordedEvents(branchesRef.current, metadata.sourceBranchId),
                    branchId: metadata.sourceBranchId,
                    throughEventIndex: metadata.baseEventIndex,
                }),
                pending,
            ),
            lastSeenEventIndex: 0,
            undoCheckpointEventIndex: 0,
            events: reindexPendingEvents(pending, branchId, 0),
            mirrored: true,
        };
        reviewRef.current.allowedBranchIds.add(branchId);
        resolveActiveReview(reviewRef.current, metadata.sourceBranchId);
        switchBranch(branchId);
        publishReviewState(
            app,
            branchesRef.current,
            branchListRef.current,
            reviewRef.current,
            stateStore,
        );
        void persist().then(flushPending);
    }

    function discardStaleLocalChanges() {
        const metadata = activeReviewMetadata(reviewRef.current);
        if (!metadata) return;
        const branch = branchesRef.current[metadata.sourceBranchId];
        if (!branch) return;
        branch.events = sortServerEvents(branch.events.filter((event) => event.recorded));
        branch.history = materializeServerBranch({
            app,
            branches: withOnlyRecordedEvents(branchesRef.current, metadata.sourceBranchId),
            branchId: metadata.sourceBranchId,
        });
        branch.undoCheckpointEventIndex = branch.lastSeenEventIndex;
        resolveActiveReview(reviewRef.current, metadata.sourceBranchId);
        if (activeBranchIdRef.current === metadata.sourceBranchId) replaceHistory(branch.history);
        publishReviewState(
            app,
            branchesRef.current,
            branchListRef.current,
            reviewRef.current,
            stateStore,
        );
        void persist().then(flushPending);
    }

    function buildEventPreview(throughEventIndex: number) {
        const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
        return materializeServerBranch({
            app,
            branches: branchesRef.current,
            branchId: branch.branchId,
            throughEventIndex,
        });
    }

    function currentReplica(): PersistedServerReplica<TState> {
        return {
            docId,
            appId: app.id,
            title,
            storageVersion: 4,
            protocolVersion: SERVER_PROTOCOL_VERSION,
            schemaVersion,
            schemaFingerprint,
            schemaFingerprintHash,
            activeBranchId: activeBranchIdRef.current,
            branches: branchesRef.current,
            branchList: branchListRef.current,
            staleMergeReview: persistedReviewFromRuntime(reviewRef.current),
            updatedAt: new Date().toISOString(),
        };
    }

    function replaceReplica(replica: PersistedServerReplica<TState>) {
        activeBranchIdRef.current = replica.activeBranchId;
        branchesRef.current = replica.branches;
        branchListRef.current = replica.branchList;
        reviewRef.current = runtimeReviewFromPersisted(replica.staleMergeReview);
        const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
        replaceHistory(branch.history);
        void saveServerReplica(replica).then(() =>
            publishStores({
                branch,
                statsStore,
                eventsStore,
                branchesStore,
                activeBranchStore,
                branchList: branchListRef.current,
                activeBranchId: activeBranchIdRef.current,
            }),
        );
        publishReviewState(
            app,
            branchesRef.current,
            branchListRef.current,
            reviewRef.current,
            stateStore,
        );
        publishReviewStore(app, branchesRef.current, reviewRef.current, staleMergeReviewStore);
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
        staleMergeReviewStore,
        setManualOffline,
        requestSync,
        requestServerMigration() {
            send({
                kind: 'serverMigrationRequest',
                version: SERVER_PROTOCOL_VERSION,
                actor: identity.actor,
                userId: identity.user.userId,
                docId,
                appId: app.id,
                targetSchemaVersion: schemaVersion,
                targetSchemaFingerprint: schemaFingerprint,
                targetSchemaFingerprintHash: schemaFingerprintHash,
            });
        },
        saveHistory(history) {
            const branch = activeBranch(branchesRef.current, activeBranchIdRef.current);
            branch.history = history;
            void persist();
        },
        setPresenceSelection,
        switchBranch,
        createBranch,
        renameBranch,
        mergeBranch,
        buildEventPreview,
        buildMergePreview,
        buildStaleMergeReview,
        completeStaleMerge,
        forkStaleLocalChanges,
        discardStaleLocalChanges,
        hasBranchReviewLock() {
            return Boolean(reviewRef.current.activeBranchId);
        },
        exportReplica: currentReplica,
        replaceReplica,
    };
}

function applyMergeEventIncrementally<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    branch: PersistedServerBranch<TState>,
    event: Extract<ServerBranchEvent, {kind: 'merge'}>,
    receive: (update: CrdtUpdate) => void,
) {
    const updates = mergeSourceUpdatesForBranchThrough(
        branches,
        event.sourceBranchId,
        event.sourceThroughEventIndex,
    );
    if (!updates.length) return true;
    let current = branch.history.doc;
    for (const update of updates) {
        const next = applyCrdtUpdate(current, update);
        if (!sameDocumentContents(current, next)) receive(update);
        current = next;
    }
    return true;
}

function sameDocumentContents<TState>(
    left: import('umkehr/crdt').CrdtDocument<TState>,
    right: import('umkehr/crdt').CrdtDocument<TState>,
) {
    return (
        JSON.stringify(left.state) === JSON.stringify(right.state) &&
        JSON.stringify(left.meta) === JSON.stringify(right.meta)
    );
}

type RuntimeStaleReview = {
    activeBranchId?: string;
    queue: string[];
    blockedBranchIds: Set<string>;
    allowedBranchIds: Set<string>;
    reviews: Map<string, ServerStaleMergeReviewMetadata>;
};

function runtimeReviewFromPersisted(persisted?: PersistedServerStaleReview): RuntimeStaleReview {
    return {
        activeBranchId: persisted?.activeBranchId,
        queue: persisted?.queue ?? [],
        blockedBranchIds: new Set(persisted?.blockedBranchIds ?? []),
        allowedBranchIds: new Set(persisted?.allowedBranchIds ?? []),
        reviews: new Map(Object.entries(persisted?.reviews ?? {})),
    };
}

function persistedReviewFromRuntime(
    review: RuntimeStaleReview,
): PersistedServerStaleReview | undefined {
    if (
        !review.activeBranchId &&
        review.queue.length === 0 &&
        review.blockedBranchIds.size === 0 &&
        review.allowedBranchIds.size === 0 &&
        review.reviews.size === 0
    ) {
        return undefined;
    }
    return {
        activeBranchId: review.activeBranchId,
        queue: review.queue,
        blockedBranchIds: [...review.blockedBranchIds],
        allowedBranchIds: [...review.allowedBranchIds],
        reviews: Object.fromEntries(review.reviews),
    };
}

function mergeBlockedReviewMetadata(
    review: RuntimeStaleReview,
    blocked: ServerStaleMergeReviewMetadata[],
) {
    for (const metadata of blocked) {
        if (review.allowedBranchIds.has(metadata.sourceBranchId)) continue;
        review.blockedBranchIds.add(metadata.sourceBranchId);
        review.reviews.set(metadata.sourceBranchId, metadata);
        if (
            metadata.sourceBranchId !== review.activeBranchId &&
            !review.queue.includes(metadata.sourceBranchId)
        ) {
            review.queue.push(metadata.sourceBranchId);
        }
    }
    if (!review.activeBranchId) review.activeBranchId = review.queue.shift();
}

function resolveActiveReview(review: RuntimeStaleReview, branchId: string) {
    review.blockedBranchIds.delete(branchId);
    review.reviews.delete(branchId);
    review.allowedBranchIds.add(branchId);
    review.queue = review.queue.filter((candidate) => candidate !== branchId);
    review.activeBranchId = review.queue.shift();
}

function activeReviewMetadata(review: RuntimeStaleReview) {
    return review.activeBranchId ? review.reviews.get(review.activeBranchId) : undefined;
}

function buildActiveStaleMergeReview<TState>(
    app: AppDefinition<TState>,
    branches: Record<string, PersistedServerBranch<TState>>,
    review: RuntimeStaleReview,
) {
    const metadata = activeReviewMetadata(review);
    if (!metadata) return null;
    return buildStaleMergeReviewModel({app, branches, metadata});
}

function publishReviewStore<TState>(
    app: AppDefinition<TState>,
    branches: Record<string, PersistedServerBranch<TState>>,
    review: RuntimeStaleReview,
    store: ReturnType<typeof createExternalStore<ServerStaleMergeReview<TState> | null>>,
) {
    store.setSnapshot(buildActiveStaleMergeReview(app, branches, review));
}

function publishReviewState<TState>(
    app: AppDefinition<TState>,
    branches: Record<string, PersistedServerBranch<TState>>,
    branchList: ServerBranch[],
    review: RuntimeStaleReview,
    stateStore: ReturnType<typeof createExternalStore<ServerSyncState>>,
) {
    app;
    branches;
    const metadata = activeReviewMetadata(review);
    if (!metadata) {
        if (stateStore.getSnapshot().kind === 'merge-review-required') {
            stateStore.setSnapshot({kind: 'connected'});
        }
        return;
    }
    const branch = branchList.find((candidate) => candidate.branchId === metadata.sourceBranchId);
    const branchLabel = branch?.name ?? metadata.sourceBranchId;
    stateStore.setSnapshot({
        kind: 'merge-review-required',
        branchId: metadata.sourceBranchId,
        pendingEventCount: metadata.pendingEventCount,
        oldestPendingAt: metadata.oldestPendingAt,
        blockedBranchCount: review.blockedBranchIds.size,
        message: `${branchLabel} has ${metadata.pendingEventCount} old pending local ${
            metadata.pendingEventCount === 1 ? 'event' : 'events'
        } and the server branch moved. Review before uploading.`,
    });
}

function isReviewBlockedBranch(review: RuntimeStaleReview, branchId: string) {
    return review.blockedBranchIds.has(branchId) && !review.allowedBranchIds.has(branchId);
}

function isMigrationOrErrorState(state: ServerSyncState) {
    return (
        state.kind === 'migration-required' ||
        state.kind === 'migration-running' ||
        state.kind === 'migration-cancelled' ||
        state.kind === 'client-migration-required' ||
        state.kind === 'schema-mismatch' ||
        state.kind === 'error'
    );
}

function reindexPendingEvents(
    events: ServerBranchEvent[],
    branchId: string,
    afterEventIndex: number,
) {
    return sortServerEvents(
        events.map((event, index) => ({
            ...event,
            branchId,
            eventIndex: afterEventIndex + index + 1,
            recorded: false,
        })),
    );
}

function eventsForUpdates({
    updates,
    docId,
    branchId,
    origin,
    startEventIndex,
}: {
    updates: CrdtUpdate[];
    docId: string;
    branchId: string;
    origin: string;
    startEventIndex: number;
}): ServerBranchEvent[] {
    return updates
        .map((update, index): ServerUpdateEvent | null => {
            const timestamp = latestCrdtUpdateTimestamp(update);
            if (!timestamp) return null;
            return {
                kind: 'update',
                docId,
                branchId,
                eventIndex: startEventIndex + index,
                origin,
                hlcTimestamp: timestamp,
                receivedAt: new Date().toISOString(),
                update,
                recorded: false,
            };
        })
        .filter((event): event is ServerUpdateEvent => event !== null);
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
        lastSyncAt:
            branch.events.findLast((event) => event.recorded)?.kind === 'update'
                ? (branch.events.findLast((event) => event.recorded) as ServerUpdateEvent)
                      .receivedAt
                : undefined,
    };
}

function serverMigrationDelayMsFromUrl() {
    const value = new URLSearchParams(window.location.search).get('serverMigrationDelayMs');
    if (!value) return 0;
    const delayMs = Number(value);
    if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
    return Math.min(delayMs, 10_000);
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
    return (
        Math.max(branch.lastSeenEventIndex, ...branch.events.map((event) => event.eventIndex), 0) +
        1
    );
}

function safeJsonParse(input: unknown) {
    if (typeof input !== 'string') return null;
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}
