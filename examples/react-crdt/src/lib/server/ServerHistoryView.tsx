import {useMemo, useState} from 'react';
import {applyRemoteHistoryUpdate} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import {useStore} from '../store';
import type {ServerSync} from './types';

export function ServerHistoryView<TState>({
    app,
    sync,
}: {
    app: AppDefinition<TState>;
    sync: ServerSync<TState>;
}) {
    const changes = useStore(sync.changesStore);
    const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);
    const selected = selectedTimestamp ?? changes.at(-1)?.timestamp ?? null;
    const preview = useMemo(() => {
        if (!selected) return app.initialState;
        let history = createInitialCrdtHistory(app);
        for (const change of changes) {
            if (change.timestamp > selected) break;
            history = applyRemoteHistoryUpdate(history, change.update);
        }
        return history.doc.state;
    }, [app, changes, selected]);

    return (
        <section className="serverHistory">
            <header>
                <h2>History</h2>
                <p>Preview only</p>
            </header>
            <div className="serverTimeline">
                {changes.length === 0 ? (
                    <p>No changes yet.</p>
                ) : (
                    changes.map((change) => (
                        <button
                            key={`${change.origin}:${change.timestamp}`}
                            type="button"
                            className={change.timestamp === selected ? 'active' : ''}
                            onClick={() => setSelectedTimestamp(change.timestamp)}
                            title={`${change.source} ${change.recorded ? 'recorded' : 'pending'}`}
                        >
                            {change.timestamp}
                        </button>
                    ))
                )}
            </div>
            <pre className="serverPreview">{JSON.stringify(preview, null, 2)}</pre>
        </section>
    );
}
