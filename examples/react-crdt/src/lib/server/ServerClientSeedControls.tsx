import {useMemo, useState} from 'react';
import {branchFreeSeedSummariesForApp} from '../seed/documents';
import type {ServerClientSeedScenario} from '../seed/serverClient';

const scenarios: {value: ServerClientSeedScenario; label: string}[] = [
    {value: 'cached', label: 'Cached client'},
    {value: 'pending-uploads', label: 'Pending uploads'},
    {value: 'stale-schema', label: 'Stale schema'},
];

export function ServerClientSeedControls({
    appId,
    activeDocId,
    onImportSeed,
}: {
    appId: string;
    activeDocId: string;
    onImportSeed(docId: string, scenario: ServerClientSeedScenario): Promise<void> | void;
}) {
    const seeds = useMemo(() => branchFreeSeedSummariesForApp(appId, 'server'), [appId]);
    const [scenario, setScenario] = useState<ServerClientSeedScenario>('cached');
    const [message, setMessage] = useState<string | null>(null);
    const selectedSeed = seeds.find((seed) => seed.docId === activeDocId);

    if (!seeds.length) return null;

    async function importSelected() {
        if (!selectedSeed) return;
        setMessage(null);
        try {
            await onImportSeed(activeDocId, scenario);
            setMessage('Seeded client state');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <section className="serverClientSeedControls" aria-label="Server client seed state">
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
            <button type="button" disabled={!selectedSeed} onClick={() => void importSelected()}>
                Apply seed to current document
            </button>
            {message ? <p className="documentArchiveMessage">{message}</p> : null}
            {!selectedSeed ? (
                <p className="documentArchiveMessage">Select a seed document to apply seeded client state.</p>
            ) : null}
        </section>
    );
}
