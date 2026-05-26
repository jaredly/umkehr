import {useMemo, useState} from 'react';
import type {DocumentPayloadKind} from '../documentArchive';
import type {SeedDocumentSummary} from './documents';
import {branchFreeSeedSummariesForApp, seedSummaryTitle} from './documents';

export function SeedDocumentPicker({
    appId,
    payloadKind,
    onImportSeed,
}: {
    appId: string;
    payloadKind: DocumentPayloadKind;
    onImportSeed(docId: string): Promise<void> | void;
}) {
    const seeds = useMemo(
        () => branchFreeSeedSummariesForApp(appId, payloadKind),
        [appId, payloadKind],
    );
    const [selected, setSelected] = useState(() => seeds[0]?.docId ?? '');
    const [message, setMessage] = useState<string | null>(null);

    if (!seeds.length) return null;

    async function importSelected() {
        if (!selected) return;
        setMessage(null);
        try {
            await onImportSeed(selected);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        }
    }

    return (
        <div className="seedDocumentPicker">
            <label>
                <span>Seed</span>
                <select
                    value={selected}
                    onChange={(event) => setSelected(event.currentTarget.value)}
                    aria-label="Seed document"
                >
                    {seeds.map((seed) => (
                        <option key={seed.docId} value={seed.docId} title={seed.docId}>
                            {seedSummaryTitle(seed)}
                        </option>
                    ))}
                </select>
            </label>
            <button type="button" disabled={!selected} onClick={() => void importSelected()}>
                Open seed
            </button>
            {message ? <p className="documentArchiveMessage">{message}</p> : null}
        </div>
    );
}
