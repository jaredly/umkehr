import {useMemo, useState} from 'react';
import {branchFreeSeedSummariesForApp, seedSummaryTitle} from '../seed/documents';
import type {ServerClientSeedScenario} from '../seed/serverClient';

const scenarios: {value: ServerClientSeedScenario; label: string}[] = [
    {value: 'cached', label: 'Cached client'},
    {value: 'pending-uploads', label: 'Pending uploads'},
    {value: 'stale-schema', label: 'Stale schema'},
];

export function ServerClientSeedControls({
    appId,
    onImportSeed,
}: {
    appId: string;
    onImportSeed(docId: string, scenario: ServerClientSeedScenario): Promise<void> | void;
}) {
    const seeds = useMemo(() => branchFreeSeedSummariesForApp(appId, 'server'), [appId]);
    const [docId, setDocId] = useState(() => seeds[0]?.docId ?? '');
    const [scenario, setScenario] = useState<ServerClientSeedScenario>('cached');
    const [message, setMessage] = useState<string | null>(null);

    if (!seeds.length) return null;

    async function importSelected() {
        if (!docId) return;
        setMessage(null);
        try {
            await onImportSeed(docId, scenario);
            setMessage('Seeded client state');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <section className="serverClientSeedControls" aria-label="Server client seed state">
            <label>
                <span>Client seed</span>
                <select
                    value={docId}
                    onChange={(event) => setDocId(event.currentTarget.value)}
                    aria-label="Server client seed document"
                >
                    {seeds.map((seed) => (
                        <option key={seed.docId} value={seed.docId} title={seed.docId}>
                            {seedSummaryTitle(seed)}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                <span>State</span>
                <select
                    value={scenario}
                    onChange={(event) =>
                        setScenario(event.currentTarget.value as ServerClientSeedScenario)
                    }
                    aria-label="Server client seed scenario"
                >
                    {scenarios.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
            <button type="button" disabled={!docId} onClick={() => void importSelected()}>
                Apply client seed
            </button>
            {message ? <p className="documentArchiveMessage">{message}</p> : null}
        </section>
    );
}
