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
    DocumentArchiveControls,
    DocumentPicker,
    readActiveDocIdFromSearch,
    urlWithActiveDocId,
    validateHistoryForApp,
    type DocumentArchive,
    type LocalDocumentSummary,
} from '../documentArchive';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {loadBranchFreeSeedFixtureForApp, seedSoloHistoryForApp} from '../seed/documents';
import {SeedDocumentPicker} from '../seed/SeedDocumentPicker';
import {HistoryView} from './HistoryView';
import {
    listSoloDocumentSummaries,
    loadSoloDocument,
    saveSoloDocument,
    type PersistedSoloDocument,
} from './persistence';

export function SoloApp<TState, TAnnotations = never, EphemeralData = never>({
    app,
    runtime,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
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
                schemaFingerprintHash: fingerprintHash,
                history: history as any,
                createdAt: now,
                updatedAt: now,
            });
        },
        [activeDocId, app.id, fingerprintHash],
    );

    const switchDocument = useCallback((docId: string) => {
        window.history.pushState(
            window.history.state,
            '',
            urlWithActiveDocId(window.location.href, docId),
        );
        setActiveDocId(docId);
    }, []);

    const importSeedDocument = useCallback(
        async (docId: string) => {
            const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
            if (!fixture) throw new Error(`No seed document exists for "${docId}".`);
            const now = new Date().toISOString();
            const history = seedSoloHistoryForApp<TState, TAnnotations, EphemeralData>(app, fixture);
            await saveSoloDocument({
                docId: fixture.docId,
                appId: app.id,
                schemaFingerprintHash: fingerprintHash,
                history: history as any,
                createdAt: fixture.createdAt || now,
                updatedAt: now,
            });
            setHistorySnapshot(history as any);
            switchDocument(fixture.docId);
            refreshDocuments();
        },
        [app, fingerprintHash, refreshDocuments, switchDocument],
    );
    const importedDocument = useCallback(
        (docId: string, history: any) => {
            setHistorySnapshot(history as any);
            switchDocument(docId);
            refreshDocuments();
        },
        [refreshDocuments, switchDocument],
    );

    return (
        <main className="soloShell">
            <div className="documentToolbar">
                <DocumentPicker
                    documents={documents}
                    activeDocId={activeDocId}
                    appId={app.id}
                    payloadKind="solo"
                    onSwitchDocument={switchDocument}
                />
                <SeedDocumentPicker
                    appId={app.id}
                    payloadKind="solo"
                    onImportSeed={importSeedDocument}
                />
            </div>
            <Provider initial={historySnapshot} save={saveHistory}>
                <SoloDocument
                    app={app}
                    runtime={runtime}
                    activeDocId={activeDocId}
                    schemaFingerprint={fingerprint}
                    schemaFingerprintHash={fingerprintHash}
                    onImported={importedDocument}
                />
            </Provider>
        </main>
    );
}

function SoloDocument<TState, TAnnotations, EphemeralData>({
    app,
    runtime,
    activeDocId,
    schemaFingerprint,
    schemaFingerprintHash,
    onImported,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
    activeDocId: string;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
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

    return (
        <div>
            <DocumentArchiveControls
                adapter={adapter}
                appId={app.id}
                docId={activeDocId}
                payloadKind="solo"
            />
            <SoloHistoryPanel editor={editor} />
            {app.renderPanel({
                actor: 'solo',
                editor: panelEditor,
                title: app.title,
            })}
        </div>
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
            schemaFingerprintHash,
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
        schemaFingerprintHash,
        history: createInitialHistory<TState, TAnnotations>(app) as any,
        createdAt: now,
        updatedAt: now,
    };
    await saveSoloDocument(document);
    return document;
}
