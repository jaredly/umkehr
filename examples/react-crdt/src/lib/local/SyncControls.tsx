import type {QueueCount} from './model';

export function SyncControls({
    syncEnabled,
    queueCounts,
    toggleSync,
}: {
    syncEnabled: boolean;
    queueCounts: QueueCount[];
    toggleSync: () => void;
}) {
    return (
        <section className="syncRail" aria-label="Sync controls">
            <div className={syncEnabled ? 'syncIndicator on' : 'syncIndicator off'} />
            <button type="button" className="syncButton" onClick={toggleSync}>
                {syncEnabled ? 'Pause sync' : 'Resume sync'}
            </button>
            <div className="queueCounts">
                {queueCounts.map((queue) => (
                    <span key={queue.label}>
                        {queue.label} {queue.count}
                    </span>
                ))}
            </div>
        </section>
    );
}
