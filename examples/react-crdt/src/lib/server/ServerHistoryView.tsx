import {useMemo, useState} from 'react';
import {useStore} from '../store';
import type {AppDefinition} from '../crdtApp';
import type {ServerSync} from './types';
import {pathKey, pathLabel} from './materialize';

export function ServerHistoryView<TState>({
    app: _app,
    sync,
}: {
    app: AppDefinition<TState>;
    sync: ServerSync<TState>;
}) {
    const branches = useStore(sync.branchesStore);
    const events = useStore(sync.eventsStore);
    const activeBranchId = useStore(sync.activeBranchStore);
    const [branchName, setBranchName] = useState('');
    const [mergeSourceId, setMergeSourceId] = useState('');
    const [revertedPathKeys, setRevertedPathKeys] = useState(() => new Set<string>());
    const activeBranch = branches.find((branch) => branch.branchId === activeBranchId);
    const mergePreview = useMemo(
        () => (mergeSourceId ? sync.buildMergePreview(mergeSourceId, undefined, revertedPathKeys) : null),
        [mergeSourceId, sync, events, activeBranchId, revertedPathKeys],
    );

    function createBranch() {
        const name = branchName.trim();
        if (!name) return;
        sync.createBranch(name);
        setBranchName('');
    }

    return (
        <section className="serverHistory">
            <header>
                <h2>Branches</h2>
                <p>{activeBranch ? `On ${activeBranch.name}` : 'No active branch'}</p>
            </header>
            <div className="serverBranchList">
                {branches.map((branch) => (
                    <button
                        key={branch.branchId}
                        type="button"
                        className={branch.branchId === activeBranchId ? 'active' : ''}
                        onClick={() => sync.switchBranch(branch.branchId)}
                        title={branch.pending ? 'Pending local branch' : branch.branchId}
                    >
                        {branch.name}
                        {branch.pending ? ' *' : ''}
                    </button>
                ))}
            </div>
            <div className="serverBranchActions">
                <input
                    value={branchName}
                    onChange={(event) => setBranchName(event.currentTarget.value)}
                    placeholder="New branch"
                    aria-label="New branch name"
                />
                <button type="button" disabled={!branchName.trim()} onClick={createBranch}>
                    Branch
                </button>
            </div>
            <div className="serverBranchActions">
                <select
                    value={mergeSourceId}
                    onChange={(event) => setMergeSourceId(event.currentTarget.value)}
                    aria-label="Merge source branch"
                >
                    <option value="">Merge source...</option>
                    {branches
                        .filter((branch) => branch.branchId !== activeBranchId)
                        .map((branch) => (
                            <option key={branch.branchId} value={branch.branchId}>
                                {branch.name}
                            </option>
                        ))}
                </select>
                <button
                    type="button"
                    disabled={!mergeSourceId}
                    onClick={() => {
                        sync.mergeBranch(mergeSourceId, undefined, revertedPathKeys);
                        setMergeSourceId('');
                        setRevertedPathKeys(new Set());
                    }}
                >
                    Merge
                </button>
            </div>
            {mergePreview ? (
                <div className="serverMergePaths">
                    {mergePreview.changedPaths.length ? (
                        mergePreview.changedPaths.map((path) => {
                            const key = pathKey(path);
                            const checked = revertedPathKeys.has(key);
                            return (
                                <label key={key}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                            const next = new Set(revertedPathKeys);
                                            if (next.has(key)) next.delete(key);
                                            else next.add(key);
                                            setRevertedPathKeys(next);
                                        }}
                                    />
                                    {pathLabel(path)}
                                </label>
                            );
                        })
                    ) : (
                        <p>No changed paths.</p>
                    )}
                </div>
            ) : null}
            <div className="serverTimeline">
                {events.length === 0 ? (
                    <p>No events yet.</p>
                ) : (
                    events.map((event) => (
                        <button
                            key={`${event.branchId}:${event.eventIndex}:${event.kind}`}
                            type="button"
                            title={event.kind === 'update' ? event.hlcTimestamp : event.mergeId}
                        >
                            {event.eventIndex}. {event.kind}
                            {!event.recorded ? ' *' : ''}
                        </button>
                    ))
                )}
            </div>
            {mergePreview ? (
                <pre className="serverPreview">
                    {JSON.stringify(mergePreview.preview.doc.state, null, 2)}
                </pre>
            ) : null}
        </section>
    );
}
