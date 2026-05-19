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
    const mergeSource = branches.find((branch) => branch.branchId === mergeSourceId);
    const mergePreview = useMemo(
        () => (mergeSourceId ? sync.buildMergePreview(mergeSourceId, undefined, revertedPathKeys) : null),
        [mergeSourceId, sync, events, activeBranchId, revertedPathKeys],
    );
    const changedPathKeys = useMemo(
        () => mergePreview?.changedPaths.map((path) => pathKey(path)) ?? [],
        [mergePreview],
    );
    const revertedCount = revertedPathKeys.size;
    const appliedCount = Math.max(0, changedPathKeys.length - revertedCount);

    function createBranch() {
        const name = branchName.trim();
        if (!name) return;
        sync.createBranch(name);
        setBranchName('');
    }

    function selectMergeSource(branchId: string) {
        setMergeSourceId(branchId);
        setRevertedPathKeys(new Set());
    }

    function toggleRevertedPath(key: string) {
        setRevertedPathKeys((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function revertAllChangedPaths() {
        setRevertedPathKeys(new Set(changedPathKeys));
    }

    function applyAllChangedPaths() {
        setRevertedPathKeys(new Set());
    }

    function commitMerge() {
        if (!mergeSourceId) return;
        sync.mergeBranch(mergeSourceId, undefined, revertedPathKeys);
        setMergeSourceId('');
        setRevertedPathKeys(new Set());
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
                    onChange={(event) => selectMergeSource(event.currentTarget.value)}
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
                <button type="button" disabled={!mergeSourceId} onClick={commitMerge}>
                    Merge
                </button>
            </div>
            {mergePreview ? (
                <section className="serverMergePanel" aria-label="Merge preview">
                    <div className="serverMergeHeader">
                        <div>
                            <h3>Merge preview</h3>
                            <p>
                                {mergeSource?.name ?? mergeSourceId} into{' '}
                                {activeBranch?.name ?? activeBranchId}
                            </p>
                        </div>
                        <button type="button" onClick={commitMerge}>
                            Accept merge
                        </button>
                    </div>
                    <dl className="serverMergeFacts">
                        <div>
                            <dt>Source through</dt>
                            <dd>{mergePreview.sourceThroughEventIndex}</dd>
                        </div>
                        <div>
                            <dt>Changed paths</dt>
                            <dd>{mergePreview.changedPaths.length}</dd>
                        </div>
                        <div>
                            <dt>Applied</dt>
                            <dd>{appliedCount}</dd>
                        </div>
                        <div>
                            <dt>Reverted</dt>
                            <dd>{revertedCount}</dd>
                        </div>
                    </dl>
                    <div className="serverMergeToolbar">
                        <button
                            type="button"
                            disabled={changedPathKeys.length === 0 || revertedCount === changedPathKeys.length}
                            onClick={revertAllChangedPaths}
                        >
                            Revert all
                        </button>
                        <button
                            type="button"
                            disabled={revertedCount === 0}
                            onClick={applyAllChangedPaths}
                        >
                            Apply all
                        </button>
                        <button type="button" onClick={() => selectMergeSource('')}>
                            Cancel
                        </button>
                    </div>
                    <div className="serverMergePreviewGrid">
                        <div className="serverMergePaths">
                            <h4>Changed paths</h4>
                            {mergePreview.changedPaths.length ? (
                                <ul>
                                    {mergePreview.changedPaths.map((path) => {
                                        const key = pathKey(path);
                                        const checked = revertedPathKeys.has(key);
                                        return (
                                            <li key={key}>
                                                <label className={checked ? 'reverted' : ''}>
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleRevertedPath(key)}
                                                    />
                                                    <span>{pathLabel(path)}</span>
                                                    <strong>{checked ? 'Revert' : 'Apply'}</strong>
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className="serverMergeEmpty">No changed paths in this merge.</p>
                            )}
                        </div>
                        <div className="serverMergeState">
                            <h4>Resulting state</h4>
                            <pre className="serverPreview">
                                {JSON.stringify(mergePreview.preview.doc.state, null, 2)}
                            </pre>
                        </div>
                    </div>
                </section>
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
        </section>
    );
}
