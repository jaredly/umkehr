import {useCallback, useEffect, useMemo, useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition, type CrdtRuntime} from '../crdtApp';
import {
    assertArchiveForApp,
    DocumentManagerModal,
    filterUnrealizedSeeds,
    localDocumentModalItems,
    validateCrdtLocalHistoryForApp,
    validateCrdtUpdatesForApp,
    type DocumentArchive,
    type DocumentModalItem,
    type LocalDocumentSummary,
    type SeedModalItem,
} from '../documentArchive';
import {useTopBarControls} from '../chrome/TopBarContext';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {
    loadBranchFreeSeedFixtureForApp,
    seedModalItemsForApp,
    seedCrdtHistoryForApp,
} from '../seed/documents';
import type {SeedFixture} from '../seed/generate';
import {useStore} from '../store';
import {readActiveDocIdFromSearch, urlWithActiveDocId} from '../useUrlSelection';
import {cloneTransportState, deleteLocalSimulatorDocument, listLocalSimulatorDocumentSummaries, loadLocalSimulatorDocument, saveLocalSimulatorDocument, type PersistedLocalSimulatorDocument} from './persistence';
import {replicas} from './model';
import {SyncControls} from './SyncControls';
import {type DemoSync, useLocalDemoSync} from './useLocalDemoSync';

type ReplicaHistories<TState> = Record<string, CrdtLocalHistory<TState>>;

export function LocalSimulatorApp<TState, EphemeralData = never>({
    app,
    runtime,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
}) {
    const defaultDocId = `${runtime.docId}-local`;
    const [activeDocId, setActiveDocId] = useState(() =>
        readActiveDocIdFromSearch(window.location.search, defaultDocId),
    );
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const [documents, setDocuments] = useState<LocalDocumentSummary[]>([]);
    const [histories, setHistories] = useState<ReplicaHistories<TState> | null>(null);
    const sync = useLocalDemoSync();
    const activeTitle = documents.find((document) => document.docId === activeDocId)?.title ?? activeDocId;

    const refreshDocuments = useCallback(() => {
        void listLocalSimulatorDocumentSummaries().then(setDocuments);
    }, []);

    useEffect(() => {
        let alive = true;
        loadOrCreateLocalSimulatorDocument(app, activeDocId, fingerprintHash).then((document) => {
            if (!alive) return;
            setHistories(document.replicas);
            sync.replaceTransportState(document.transportState as any);
            refreshDocuments();
        });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprintHash, refreshDocuments, sync]);

    const persist = useCallback(
        (nextHistories: ReplicaHistories<TState>) => {
            const now = new Date().toISOString();
            void saveLocalSimulatorDocument({
                docId: activeDocId,
                appId: app.id,
                title: activeTitle,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                replicas: nextHistories,
                transportState: cloneTransportState(sync.exportTransportState()),
                createdAt: now,
                updatedAt: now,
            }).then(refreshDocuments);
        },
        [activeDocId, activeTitle, app.id, app.schemaVersion, fingerprintHash, refreshDocuments, sync],
    );

    const saveReplicaHistory = useCallback(
        (replicaId: string, history: CrdtLocalHistory<TState>) => {
            setHistories((current) => {
                if (!current) return current;
                const next = {...current, [replicaId]: history};
                persist(next);
                return next;
            });
        },
        [persist],
    );

    const switchDocument = useCallback((docId: string) => {
        if (docId !== activeDocId) setHistories(null);
        window.history.pushState(
            window.history.state,
            '',
            urlWithActiveDocId(window.location.href, docId),
        );
        setActiveDocId(docId);
    }, [activeDocId]);

    const archiveAdapter = useMemo(
        () => ({
            async exportArchive(): Promise<DocumentArchive> {
                return {
                    kind: 'umkehr.react-crdt.document',
                    archiveVersion: 1,
                    exportedAt: new Date().toISOString(),
                    appId: app.id,
                    docId: activeDocId,
                    schemaFingerprint: fingerprint,
                    schemaFingerprintHash: fingerprintHash,
                    exportedBy: {actor: 'local-simulator'},
                    payload: {
                        kind: 'local-simulator',
                        replicas: (histories ?? initialReplicaHistories(app)) as any,
                        transportState: cloneTransportState(sync.exportTransportState()) as any,
                    },
                };
            },
            async importArchive(archive: DocumentArchive) {
                assertArchiveForApp(archive, app as any, 'local-simulator');
                const imported: ReplicaHistories<TState> = {};
                for (const [replicaId, history] of Object.entries(archive.payload.replicas)) {
                    imported[replicaId] = validateCrdtLocalHistoryForApp(history, app);
                }
                for (const updates of Object.values(archive.payload.transportState.outbox)) {
                    validateCrdtUpdatesForApp(updates, app);
                }
                const now = new Date().toISOString();
                await saveLocalSimulatorDocument({
                    docId: archive.docId,
                    appId: app.id,
                    title: archive.docId,
                    schemaVersion: app.schemaVersion,
                    schemaFingerprintHash: fingerprintHash,
                    replicas: imported,
                    transportState: archive.payload.transportState as any,
                    createdAt: now,
                    updatedAt: now,
                });
                setHistories(imported);
                sync.replaceTransportState(archive.payload.transportState);
                switchDocument(archive.docId);
                refreshDocuments();
            },
        }),
        [
            activeDocId,
            app,
            fingerprint,
            fingerprintHash,
            histories,
            refreshDocuments,
            switchDocument,
            sync,
        ],
    );
    const documentItems = useMemo(
        () => localDocumentModalItems(documents, app.id, 'local-simulator'),
        [app.id, documents],
    );
    const seedItems = useMemo(
        () => filterUnrealizedSeeds(seedModalItemsForApp(app.id, 'local-simulator'), documentItems),
        [app.id, documentItems],
    );
    const createBlankDocument = useCallback(
        async ({docId, title}: {docId: string; title: string}) => {
            const now = new Date().toISOString();
            await saveLocalSimulatorDocument({
                docId,
                appId: app.id,
                title,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                replicas: initialReplicaHistories(app),
                transportState: emptyTransportState(),
                createdAt: now,
                updatedAt: now,
            });
            refreshDocuments();
        },
        [app, fingerprintHash, refreshDocuments],
    );
    const createSeedDocument = useCallback(
        async (seed: SeedModalItem) => {
            const fixture = loadBranchFreeSeedFixtureForApp(app, seed.docId);
            if (!fixture) throw new Error(`No seed document exists for "${seed.docId}".`);
            const now = new Date().toISOString();
            await saveLocalSimulatorDocument({
                docId: fixture.docId,
                appId: app.id,
                title: fixture.title || fixture.docId,
                schemaVersion: fixture.schemaVersion,
                schemaFingerprintHash: fixture.schemaFingerprintHash,
                replicas: seededReplicaHistories(app, fixture),
                transportState: emptyTransportState(),
                createdAt: fixture.createdAt || now,
                updatedAt: now,
            });
            refreshDocuments();
        },
        [app, refreshDocuments],
    );
    const deleteLocalDocument = useCallback(
        async (document: DocumentModalItem) => {
            await deleteLocalSimulatorDocument(document.docId);
            const remaining = (await listLocalSimulatorDocumentSummaries()).filter(
                (summary) =>
                    summary.appId === app.id &&
                    summary.payloadKind === 'local-simulator' &&
                    summary.docId !== document.docId,
            );
            setDocuments(remaining);
            if (document.docId === activeDocId) switchDocument(remaining[0]?.docId ?? defaultDocId);
        },
        [activeDocId, app.id, defaultDocId, switchDocument],
    );
    const topBarControls = useMemo(
        () => ({
            documentPicker: (
                <DocumentManagerModal
                    documents={documentItems}
                    seeds={seedItems}
                    activeDocId={activeDocId}
                    onSwitchDocument={switchDocument}
                    onCreateDocument={createBlankDocument}
                    onCreateSeed={createSeedDocument}
                    onDeleteLocal={deleteLocalDocument}
                    archiveAdapter={histories ? archiveAdapter : undefined}
                    onChanged={refreshDocuments}
                />
            ),
        }),
        [
            activeDocId,
            archiveAdapter,
            createBlankDocument,
            createSeedDocument,
            deleteLocalDocument,
            documentItems,
            histories,
            refreshDocuments,
            seedItems,
            switchDocument,
        ],
    );
    useTopBarControls(topBarControls);

    return (
        <main className="collabShell">
            {histories
                ? replicas.map((replica, index) => (
                      <LocalReplicaPanel
                          key={`${activeDocId}:${replica.id}`}
                          index={index}
                          sync={sync}
                          replica={replica}
                          initial={histories[replica.id] ?? createInitialCrdtHistory(app)}
                          app={app}
                          runtime={runtime}
                          save={(history) => saveReplicaHistory(replica.id, history)}
                      />
                  ))
                : null}
            {histories ? null : <p className="loadingState">Loading document...</p>}
            <LocalSyncControls sync={sync} />
        </main>
    );
}

function LocalReplicaPanel<TState, EphemeralData>({
    index,
    sync,
    replica,
    initial,
    app,
    runtime,
    save,
}: {
    index: number;
    sync: DemoSync;
    replica: (typeof replicas)[number];
    initial: CrdtLocalHistory<TState>;
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    save(history: CrdtLocalHistory<TState>): void;
}) {
    const {Provider} = runtime;

    return (
        <Provider
            initial={initial}
            transport={sync.transports[replica.id]}
            statuses={sync.statusStores[replica.id]}
            save={save}
        >
            <LocalReplicaDocument
                actor={replica.id}
                app={app}
                gridSlot={index === 0 ? 'left' : 'right'}
                runtime={runtime}
                sync={sync}
                title={replica.title}
            />
        </Provider>
    );
}

function LocalReplicaDocument<TState, EphemeralData>({
    actor,
    app,
    gridSlot,
    runtime,
    sync,
    title,
}: {
    actor: string;
    app: AppDefinition<TState, EphemeralData>;
    gridSlot: 'left' | 'right';
    runtime: CrdtRuntime<TState, EphemeralData>;
    sync: DemoSync;
    title: string;
}) {
    const editor = runtime.useEditorContext();

    return app.renderPanel({
        actor,
        editor,
        title,
        gridSlot,
        setPresenceSelection: (elementId) => sync.setPresenceSelection(actor, elementId),
    });
}

function LocalSyncControls({sync}: {sync: DemoSync}) {
    const state = useStore(sync.stateStore);

    return (
        <SyncControls
            syncEnabled={state.syncEnabled}
            queueCounts={replicas.map((replica) => ({
                label: replica.label,
                count: state.outbox[replica.id]?.length ?? 0,
            }))}
            toggleSync={sync.toggleSync}
        />
    );
}

function initialReplicaHistories<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
): ReplicaHistories<TState> {
    return Object.fromEntries(
        replicas.map((replica) => [replica.id, createInitialCrdtHistory(app)]),
    );
}

function seededReplicaHistories<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    fixture: SeedFixture<TState>,
): ReplicaHistories<TState> {
    const history = seedCrdtHistoryForApp(app, fixture);
    return Object.fromEntries(
        replicas.map((replica) => [replica.id, structuredClone(history)]),
    ) as ReplicaHistories<TState>;
}

function emptyTransportState(): PersistedLocalSimulatorDocument<unknown>['transportState'] {
    return {
        syncEnabled: true,
        outbox: Object.fromEntries(replicas.map((replica) => [replica.id, []])),
    };
}

async function loadOrCreateLocalSimulatorDocument<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    docId: string,
    schemaFingerprintHash: string,
): Promise<PersistedLocalSimulatorDocument<TState>> {
    const existing = await loadLocalSimulatorDocument<TState>(docId);
    if (existing && existing.appId === app.id) return existing;
    const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
    if (fixture) {
        const now = new Date().toISOString();
        const document: PersistedLocalSimulatorDocument<TState> = {
            docId,
            appId: app.id,
            title: fixture.title || fixture.docId,
            schemaVersion: fixture.schemaVersion,
            schemaFingerprintHash: fixture.schemaFingerprintHash || schemaFingerprintHash,
            replicas: seededReplicaHistories(app, fixture),
            transportState: emptyTransportState(),
            createdAt: fixture.createdAt || now,
            updatedAt: now,
        };
        await saveLocalSimulatorDocument(document);
        return document;
    }
    const now = new Date().toISOString();
    const document: PersistedLocalSimulatorDocument<TState> = {
        docId,
        appId: app.id,
        title: docId,
        schemaVersion: app.schemaVersion,
        schemaFingerprintHash,
        replicas: initialReplicaHistories(app),
        transportState: emptyTransportState(),
        createdAt: now,
        updatedAt: now,
    };
    await saveLocalSimulatorDocument(document);
    return document;
}
