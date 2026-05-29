import {useEffect, useMemo, useState} from 'react';
import {useStore} from '../store';
import type {AppDefinition, CrdtEditorContext} from '../crdtApp';
import type {ServerSync} from './types';
import {pathKey, pathLabel} from './materialize';

export function ServerHistoryView<TState, EphemeralData = never>({
    app: _app,
    sync,
    editor,
    onPreviewingChange,
}: {
    app: AppDefinition<TState, EphemeralData>;
    sync: ServerSync<TState>;
    editor: CrdtEditorContext<TState, 'type', EphemeralData>;
    onPreviewingChange?(previewing: boolean): void;
}) {
    const branches = useStore(sync.branchesStore);
    const events = useStore(sync.eventsStore);
    const activeBranchId = useStore(sync.activeBranchStore);
    const [branchName, setBranchName] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [forkEventIndex, setForkEventIndex] = useState<number | undefined>();
    const [previewEventIndex, setPreviewEventIndex] = useState<number | undefined>();
    const [mergeSourceId, setMergeSourceId] = useState('');
    const [mergeSourceThroughEventIndex, setMergeSourceThroughEventIndex] = useState<number | undefined>();
    const [revertedPathKeys, setRevertedPathKeys] = useState(() => new Set<string>());
    const activeBranch = branches.find((branch) => branch.branchId === activeBranchId);
    const mergeSource = branches.find((branch) => branch.branchId === mergeSourceId);
    const mergePreview = useMemo(
        () =>
            mergeSourceId && mergeSourceThroughEventIndex !== undefined
                ? sync.buildMergePreview(mergeSourceId, mergeSourceThroughEventIndex, revertedPathKeys)
                : null,
        [mergeSourceId, mergeSourceThroughEventIndex, sync, events, activeBranchId, revertedPathKeys],
    );
    const eventPreview = useMemo(
        () => (previewEventIndex === undefined ? null : sync.buildEventPreview(previewEventIndex)),
        [previewEventIndex, sync, events, activeBranchId],
    );
    const changedPathKeys = useMemo(
        () => mergePreview?.changedPaths.map((path) => pathKey(path)) ?? [],
        [mergePreview],
    );
    const mergeImpact = mergePreview?.impact;
    const canCommitMerge = Boolean(mergePreview && mergeImpact && mergeImpact.effectiveUpdateCount > 0);
    const revertedCount = revertedPathKeys.size;
    const appliedCount = Math.max(0, changedPathKeys.length - revertedCount);
    const mergeBlockedReason = mergeImpact
        ? mergeImpact.alreadyMerged
            ? `Already merged through event ${mergeImpact.alreadyMergedThroughEventIndex}.`
            : mergeImpact.effectiveUpdateCount === 0
              ? 'No CRDT updates would change the current branch.'
              : ''
        : '';

    useEffect(() => {
        editor.previewHistory(mergePreview?.preview ?? eventPreview);
        return () => editor.previewHistory(null);
    }, [editor, eventPreview, mergePreview]);

    useEffect(() => {
        onPreviewingChange?.(mergePreview !== null || eventPreview !== null);
        return () => onPreviewingChange?.(false);
    }, [eventPreview, mergePreview, onPreviewingChange]);

    function createBranch() {
        const name = branchName.trim();
        if (!name) return;
        sync.createBranch(name, forkEventIndex);
        setBranchName('');
        setForkEventIndex(undefined);
        setPreviewEventIndex(undefined);
    }

    function renameActiveBranch() {
        const name = renameValue.trim();
        if (!name || !activeBranch) return;
        sync.renameBranch(activeBranch.branchId, name);
        setRenameValue('');
    }

    function selectMergeSource(branchId: string) {
        setPreviewEventIndex(undefined);
        setMergeSourceId(branchId);
        const source = branches.find((branch) => branch.branchId === branchId);
        setMergeSourceThroughEventIndex(source?.tipEventIndex);
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
        if (!mergeSourceId || mergeSourceThroughEventIndex === undefined) return;
        if (!canCommitMerge) return;
        editor.previewHistory(null);
        sync.mergeBranch(mergeSourceId, mergeSourceThroughEventIndex, revertedPathKeys);
        setMergeSourceId('');
        setMergeSourceThroughEventIndex(undefined);
        setRevertedPathKeys(new Set());
        setPreviewEventIndex(undefined);
    }

    return (
        <section className="serverHistory" data-testid="server-history">
            <header>
                <h2>Branches</h2>
                <p>{activeBranch ? `On ${activeBranch.name}` : 'No active branch'}</p>
            </header>
            <div className="serverBranchList" data-testid="server-branch-list">
                {branches.map((branch) => (
                    <button
                        key={branch.branchId}
                        type="button"
                        className={branch.branchId === activeBranchId ? 'active' : ''}
                        data-testid="server-branch-button"
                        data-branch-id={branch.branchId}
                        onClick={() => {
                            editor.previewHistory(null);
                            setMergeSourceId('');
                            setMergeSourceThroughEventIndex(undefined);
                            setRevertedPathKeys(new Set());
                            setForkEventIndex(undefined);
                            setPreviewEventIndex(undefined);
                            sync.switchBranch(branch.branchId);
                        }}
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
                    {forkEventIndex === undefined ? 'Branch' : `Branch at ${forkEventIndex}`}
                </button>
                {forkEventIndex !== undefined ? (
                    <button
                        type="button"
                        onClick={() => {
                            setForkEventIndex(undefined);
                            setPreviewEventIndex(undefined);
                        }}
                    >
                        Clear fork point
                    </button>
                ) : null}
            </div>
            <div className="serverBranchActions">
                <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.currentTarget.value)}
                    placeholder={activeBranch ? `Rename ${activeBranch.name}` : 'Rename branch'}
                    aria-label="Rename active branch"
                />
                <button
                    type="button"
                    disabled={!activeBranch || !renameValue.trim()}
                    onClick={renameActiveBranch}
                >
                    Rename
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
                <button type="button" disabled={!canCommitMerge} onClick={commitMerge}>
                    Merge
                </button>
            </div>
            {previewEventIndex !== undefined && !mergePreview ? (
                <div className="serverPreviewNotice">
                    <span>Previewing state after event {previewEventIndex}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setForkEventIndex(undefined);
                            setPreviewEventIndex(undefined);
                        }}
                    >
                        Exit preview
                    </button>
                </div>
            ) : null}
            {mergePreview ? (
                <section
                    className="serverMergePanel"
                    aria-label="Merge preview"
                    data-testid="server-merge-panel"
                >
                    <div className="serverMergeHeader">
                        <div>
                            <h3>Merge preview</h3>
                            <p>
                                {mergeSource?.name ?? mergeSourceId} into{' '}
                                {activeBranch?.name ?? activeBranchId}
                            </p>
                        </div>
                        <button type="button" disabled={!canCommitMerge} onClick={commitMerge}>
                            Accept merge
                        </button>
                    </div>
                    {mergeBlockedReason ? (
                        <p className="serverMergeWarning">{mergeBlockedReason}</p>
                    ) : null}
                    <dl className="serverMergeFacts">
                        <div className="primary">
                            <dt>Changes to bring in</dt>
                            <dd>{mergePreview.impact.effectiveUpdateCount}</dd>
                        </div>
                        <div>
                            <dt>Already merged</dt>
                            <dd>{mergePreview.impact.alreadyMerged ? 'Yes' : 'No'}</dd>
                        </div>
                        <div>
                            <dt>Source through</dt>
                            <dd>{mergePreview.sourceThroughEventIndex}</dd>
                        </div>
                        <div>
                            <dt>Source updates</dt>
                            <dd>{mergePreview.impact.sourceUpdateCount}</dd>
                        </div>
                        <div>
                            <dt>No-effect updates</dt>
                            <dd>{mergePreview.impact.noEffectUpdateCount}</dd>
                        </div>
                        <div>
                            <dt>Already merged updates</dt>
                            <dd>{mergePreview.impact.alreadyMergedUpdateCount}</dd>
                        </div>
                        <div>
                            <dt>Source paths</dt>
                            <dd>{mergePreview.changedPaths.length}</dd>
                        </div>
                        <div>
                            <dt>Paths kept</dt>
                            <dd>{appliedCount}</dd>
                        </div>
                        <div>
                            <dt>Paths reverted</dt>
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
                        <button
                            type="button"
                            onClick={() => {
                                editor.previewHistory(null);
                                setPreviewEventIndex(undefined);
                                selectMergeSource('');
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                    <div className="serverMergePreviewGrid">
                        <div className="serverMergePaths">
                            <h4>Source changed paths</h4>
                            {mergePreview.changedPaths.length ? (
                                <ul>
                                    {mergePreview.changedPaths.map((path) => {
                                        const key = pathKey(path);
                                        const checked = revertedPathKeys.has(key);
                                        return (
                                            <li key={key} data-testid="server-merge-path" data-path-key={key}>
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
            <div className="serverTimeline" data-testid="server-timeline">
                {events.length === 0 ? (
                    <p>No events yet.</p>
                ) : (
                    events.map((event) => (
                        <button
                            key={`${event.branchId}:${event.eventIndex}:${event.kind}`}
                            type="button"
                            data-testid="server-timeline-event"
                            data-branch-id={event.branchId}
                            data-event-index={event.eventIndex}
                            data-event-kind={event.kind}
                            className={
                                previewEventIndex === event.eventIndex || forkEventIndex === event.eventIndex
                                    ? 'active'
                                    : ''
                            }
                            title={event.kind === 'update' ? event.hlcTimestamp : event.mergeId}
                            onClick={() => {
                                setForkEventIndex(event.eventIndex);
                                setPreviewEventIndex((current) =>
                                    current === event.eventIndex ? undefined : event.eventIndex,
                                );
                                setMergeSourceId('');
                                setMergeSourceThroughEventIndex(undefined);
                                setRevertedPathKeys(new Set());
                            }}
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
