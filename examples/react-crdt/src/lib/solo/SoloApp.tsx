import {useCallback, useEffect, useMemo, useState} from 'react';
import {
    createInitialHistory,
    withDisabledEphemeral,
    type AppDefinition,
    type HistoryEditorContext,
    type HistoryRuntime,
} from '../crdtApp';
import {
    assertArchiveForApp,
    DocumentManagerModal,
    filterUnrealizedSeeds,
    localDocumentModalItems,
    validateHistoryForApp,
    type DocumentArchive,
    type DocumentModalItem,
    type LocalDocumentSummary,
    type SeedModalItem,
} from '../documentArchive';
import {DemoTopBar, type DemoTopBarProps, type TopBarControls} from '../chrome/DemoTopBar';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {
    loadBranchFreeSeedFixtureForApp,
    seedModalItemsForApp,
    seedSoloHistoryForApp,
} from '../seed/documents';
import {readActiveDocIdFromSearch, urlWithActiveDocId} from '../useUrlSelection';
import {HistoryView} from './HistoryView';
import {
    listSoloDocumentSummaries,
    loadSoloDocument,
    saveSoloDocument,
    deleteSoloDocument,
    type PersistedSoloDocument,
} from './persistence';

export function SoloApp<TState, TAnnotations = never, EphemeralData = never>({
    app,
    runtime,
    topBar,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
    topBar: DemoTopBarProps;
}) {
    const defaultDocId = `${app.id}-solo`;
    const [activeDocId, setActiveDocId] = useState(() =>
        readActiveDocIdFromSearch(window.location.search, defaultDocId),
    );
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const [documents, setDocuments] = useState<LocalDocumentSummary[]>([]);
    const [historySnapshot, setHistorySnapshot] = useState(() =>
        createInitialHistory<TState, TAnnotations>(app),
    );
    const {Provider} = runtime;
    const activeTitle = documents.find((document) => document.docId === activeDocId)?.title ?? activeDocId;

    const refreshDocuments = useCallback(() => {
        void listSoloDocumentSummaries().then(setDocuments);
    }, []);

    useEffect(() => {
        let alive = true;
        loadOrCreateSoloDocument<TState, TAnnotations>(
            app,
            activeDocId,
            fingerprintHash,
        ).then((document) => {
            if (!alive) return;
            setHistorySnapshot(document.history as any);
            refreshDocuments();
        });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprintHash, refreshDocuments]);

    const saveHistory = useCallback(
        (history: typeof historySnapshot) => {
            const now = new Date().toISOString();
            void saveSoloDocument({
                docId: activeDocId,
                appId: app.id,
                title: activeTitle,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                history: history as any,
                createdAt: now,
                updatedAt: now,
            });
        },
        [activeDocId, activeTitle, app.id, app.schemaVersion, fingerprintHash],
    );

    const switchDocument = useCallback((docId: string) => {
        window.history.pushState(
            window.history.state,
            '',
            urlWithActiveDocId(window.location.href, docId),
        );
        setActiveDocId(docId);
    }, []);

    const importedDocument = useCallback(
        (docId: string, history: any) => {
            setHistorySnapshot(history as any);
            switchDocument(docId);
            refreshDocuments();
        },
        [refreshDocuments, switchDocument],
    );
    const documentItems = useMemo(
        () => localDocumentModalItems(documents, app.id, 'solo'),
        [app.id, documents],
    );
    const seedItems = useMemo(
        () => filterUnrealizedSeeds(seedModalItemsForApp(app.id, 'solo'), documentItems),
        [app.id, documentItems],
    );
    const createBlankDocument = useCallback(
        async ({docId, title}: {docId: string; title: string}) => {
            const now = new Date().toISOString();
            await saveSoloDocument({
                docId,
                appId: app.id,
                title,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                history: createInitialHistory<TState, TAnnotations>(app) as any,
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
            await saveSoloDocument({
                docId: fixture.docId,
                appId: app.id,
                title: fixture.title || fixture.docId,
                schemaVersion: fixture.schemaVersion,
                schemaFingerprintHash: fixture.schemaFingerprintHash,
                history: seedSoloHistoryForApp<TState, TAnnotations, unknown>(app, fixture) as any,
                createdAt: fixture.createdAt || now,
                updatedAt: now,
            });
            refreshDocuments();
        },
        [app, refreshDocuments],
    );
    const deleteLocalDocument = useCallback(
        async (document: DocumentModalItem) => {
            await deleteSoloDocument(document.docId);
            const remaining = (await listSoloDocumentSummaries()).filter(
                (summary) =>
                    summary.appId === app.id &&
                    summary.payloadKind === 'solo' &&
                    summary.docId !== document.docId,
            );
            setDocuments(remaining);
            if (document.docId === activeDocId) switchDocument(remaining[0]?.docId ?? defaultDocId);
        },
        [activeDocId, app.id, defaultDocId, switchDocument],
    );
    const topBarControls = useMemo<TopBarControls>(
        () => ({}),
        [],
    );

    return (
        <Provider initial={historySnapshot} save={saveHistory}>
            <SoloDocument
                app={app}
                runtime={runtime}
                activeDocId={activeDocId}
                schemaFingerprint={fingerprint}
                schemaFingerprintHash={fingerprintHash}
                topBar={topBar}
                topBarControls={topBarControls}
                documents={documentItems}
                seeds={seedItems}
                onCreateDocument={createBlankDocument}
                onCreateSeed={createSeedDocument}
                onDeleteLocal={deleteLocalDocument}
                onSwitchDocument={switchDocument}
                onDocumentsChanged={refreshDocuments}
                onImported={importedDocument}
            />
        </Provider>
    );
}

function SoloDocument<TState, TAnnotations, EphemeralData>({
    app,
    runtime,
    activeDocId,
    schemaFingerprint,
    schemaFingerprintHash,
    topBar,
    topBarControls,
    documents,
    seeds,
    onCreateDocument,
    onCreateSeed,
    onDeleteLocal,
    onSwitchDocument,
    onDocumentsChanged,
    onImported,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
    activeDocId: string;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    topBar: DemoTopBarProps;
    topBarControls: TopBarControls;
    documents: DocumentModalItem[];
    seeds: SeedModalItem[];
    onCreateDocument(input: {docId: string; title: string}): Promise<void> | void;
    onCreateSeed(seed: SeedModalItem): Promise<void> | void;
    onDeleteLocal(document: DocumentModalItem): Promise<void> | void;
    onSwitchDocument(docId: string): void;
    onDocumentsChanged(): void;
    onImported(docId: string, history: any): void;
}) {
    const editor = runtime.useEditorContext();
    const adapter = useMemo(
        () => ({
            async exportArchive(): Promise<DocumentArchive> {
                const latestHistory = editor.getHistory();
                return {
                    kind: 'umkehr.react-crdt.document',
                    archiveVersion: 1,
                    exportedAt: new Date().toISOString(),
                    appId: app.id,
                    docId: activeDocId,
                    schemaFingerprint,
                    schemaFingerprintHash,
                    exportedBy: {actor: 'solo'},
                    payload: {kind: 'solo', history: latestHistory as any},
                };
            },
            async importArchive(archive: DocumentArchive) {
                assertArchiveForApp(archive, app as any, 'solo');
                const imported = validateHistoryForApp(archive.payload.history, app);
                const now = new Date().toISOString();
                await saveSoloDocument({
                    docId: archive.docId,
                    appId: app.id,
                    title: archive.docId,
                    schemaVersion: app.schemaVersion,
                    schemaFingerprintHash,
                    history: imported as any,
                    createdAt: now,
                    updatedAt: now,
                });
                onImported(archive.docId, imported);
            },
        }),
        [activeDocId, app, editor, onImported, schemaFingerprint, schemaFingerprintHash],
    );
    const panelEditor = useMemo(
        () => withDisabledEphemeral<TState, typeof editor, EphemeralData>(editor),
        [editor],
    );
    const registeredTopBarControls = useMemo(
        () => ({
            ...topBarControls,
            documentPicker: (
                <DocumentManagerModal
                    documents={documents}
                    seeds={seeds}
                    activeDocId={activeDocId}
                    archiveAdapter={adapter}
                    onSwitchDocument={onSwitchDocument}
                    onCreateDocument={onCreateDocument}
                    onCreateSeed={onCreateSeed}
                    onDeleteLocal={onDeleteLocal}
                    onChanged={onDocumentsChanged}
                />
            ),
        }),
        [
            activeDocId,
            adapter,
            documents,
            onCreateDocument,
            onCreateSeed,
            onDeleteLocal,
            onDocumentsChanged,
            onSwitchDocument,
            seeds,
            topBarControls,
        ],
    );
    return (
        <>
            <DemoTopBar {...topBar} controls={registeredTopBarControls} />
            <main className="soloShell">
                <div>
                    <SoloHistoryPanel editor={editor} />
                    {app.renderPanel({
                        actor: 'solo',
                        editor: panelEditor,
                        title: app.title,
                    })}
                </div>
            </main>
        </>
    );
}

function SoloHistoryPanel<TState, TAnnotations>({
    editor,
}: {
    editor: HistoryEditorContext<TState, TAnnotations>;
}) {
    const history = editor.useHistory();
    return (
        <HistoryView
            history={history}
            jump={(id) => editor.dispatch({op: 'jump', id})}
            previewJump={(id) => editor.previewJump(id)}
            clearPreview={() => editor.clearPreview()}
        />
    );
}

async function loadOrCreateSoloDocument<TState, TAnnotations>(
    app: AppDefinition<TState, unknown>,
    docId: string,
    schemaFingerprintHash: string,
): Promise<PersistedSoloDocument<TState>> {
    const existing = await loadSoloDocument<TState>(docId);
    if (existing && existing.appId === app.id) return existing;
    const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
    if (fixture) {
        const now = new Date().toISOString();
        const document: PersistedSoloDocument<TState> = {
            docId,
            appId: app.id,
            title: fixture.title || fixture.docId,
            schemaVersion: fixture.schemaVersion,
            schemaFingerprintHash: fixture.schemaFingerprintHash || schemaFingerprintHash,
            history: seedSoloHistoryForApp<TState, TAnnotations, unknown>(app, fixture) as any,
            createdAt: fixture.createdAt || now,
            updatedAt: now,
        };
        await saveSoloDocument(document);
        return document;
    }
    const now = new Date().toISOString();
    const document: PersistedSoloDocument<TState> = {
        docId,
        appId: app.id,
        title: docId,
        schemaVersion: app.schemaVersion,
        schemaFingerprintHash,
        history: createInitialHistory<TState, TAnnotations>(app) as any,
        createdAt: now,
        updatedAt: now,
    };
    await saveSoloDocument(document);
    return document;
}
