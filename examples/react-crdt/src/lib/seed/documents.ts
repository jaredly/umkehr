import {blankHistory, type History} from 'umkehr';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import type {AppDefinition} from '../crdtApp';
import type {LocalDocumentSummary} from '../documentArchive';
import {
    assertBranchFreeSeedFixture,
    listSeedDocumentSummaries,
    mainBranchHistory,
    seedFixtureForDocId,
    type SeedFixture,
    type SeedGeneratorOptions,
} from './generate';

export type SeedDocumentSummary = LocalDocumentSummary & {
    sizeLabel: string;
    sizeRank: number;
};

export function branchFreeSeedSummariesForApp(
    appId: string,
    payloadKind: LocalDocumentSummary['payloadKind'],
    options: SeedGeneratorOptions = {},
): SeedDocumentSummary[] {
    return listSeedDocumentSummaries({...options, appId, branchFreeOnly: true}).map((summary) => ({
        docId: summary.docId,
        appId: summary.appId ?? appId,
        title: summary.title,
        payloadKind,
        schemaVersion: summary.schemaVersion,
        schemaFingerprintHash: summary.schemaFingerprintHash,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        sizeLabel: summary.sizeLabel,
        sizeRank: summary.sizeRank,
    }));
}

export function loadBranchFreeSeedFixtureForApp<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    docId: string,
    options: SeedGeneratorOptions = {},
): SeedFixture<TState> | null {
    const fixture = seedFixtureForDocId(docId, {...options, appId: app.id});
    if (!fixture) return null;
    assertSeedFixtureForApp(app, fixture);
    assertBranchFreeSeedFixture(fixture);
    return fixture as SeedFixture<TState>;
}

export function seedCrdtHistoryForApp<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    fixture: SeedFixture<TState>,
): CrdtLocalHistory<TState> {
    assertSeedFixtureForApp(app, fixture);
    assertBranchFreeSeedFixture(fixture);
    return structuredClone(mainBranchHistory(fixture)) as CrdtLocalHistory<TState>;
}

export function seedSoloHistoryForApp<TState, TAnnotations, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    fixture: SeedFixture<TState>,
): History<TState, TAnnotations> {
    const history = seedCrdtHistoryForApp(app, fixture);
    return blankHistory<TState, TAnnotations>(structuredClone(history.doc.state));
}

export function seedSummaryTitle(summary: Pick<SeedDocumentSummary, 'title' | 'docId' | 'sizeLabel'>) {
    return `${summary.title || summary.docId} (${summary.sizeLabel})`;
}

function assertSeedFixtureForApp<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    fixture: SeedFixture,
) {
    if (fixture.appId !== app.id) {
        throw new Error(`Seed fixture "${fixture.docId}" belongs to app "${fixture.appId}".`);
    }
    if (fixture.schemaFingerprintHash) {
        // The app validation below is the source of truth for loaded state. The hash
        // check keeps accidental cross-version imports from failing later in a mode-specific path.
        const result = app.validateState(mainBranchHistory(fixture as SeedFixture<TState>).doc.state);
        if (!result.success) {
            throw new Error(`Seed fixture "${fixture.docId}" does not match app "${app.id}".`);
        }
    }
}
