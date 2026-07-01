import {
    Fragment,
    useEffect,
    useState,
    type CSSProperties,
    type ReactElement,
} from 'react';

import type {PollMeta} from '../blockMeta.js';
import {
    activePollVotes,
    choiceResults,
    currentUserVote,
    matrixPollResults,
    ratingOptionIds,
    singleChoiceResults,
    votedOptionIds,
    type PollResult,
} from '../pollBlocks.js';
import type {BlockEditorBlockRenderer} from './types.js';
import type {RichBlockMeta} from '../blockMeta.js';

type PollOptionView = {id: string; label: string; archived?: boolean};
type MatrixPollView = {rows: PollOptionView[]; columns: PollOptionView[]};
type PollEditorMode = 'view' | 'edit';

export const pollBlockRenderer: BlockEditorBlockRenderer<RichBlockMeta> = {
    id: 'render:poll',
    blockType: 'poll',
    children: 'renderer',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'poll') return null;
        const editorMode = pollEditorMode(context.polls.modeForBlock(node.id));
        const isChildBackedPoll = meta.kind === 'children' || meta.kind === 'matrix';
        return (
            <div className="renderTreeBranch">
                <PollBlock
                    meta={meta}
                    userId={context.userId}
                    question={context.blocks.renderEditableBlock(node)}
                    childOptions={childPollOptionsForNode(node)}
                    matrixPoll={matrixPollViewForNode(node)}
                    editorMode={editorMode}
                    onSetEditorMode={(mode) => context.polls.setModeForBlock(node.id, mode)}
                    onVote={(optionId, rowId) => context.polls.vote(node.id, optionId, rowId)}
                    onLongAnswer={(text) => context.polls.answerLong(node.id, text)}
                />
                {!isChildBackedPoll || editorMode === 'edit' ? context.blocks.renderChildren(node) : null}
            </div>
        );
    },
};

const pollEditorMode = (value: string): PollEditorMode => (value === 'edit' ? 'edit' : 'view');

const blockPlainText = (node: Parameters<BlockEditorBlockRenderer<RichBlockMeta>['render']>[0]): string =>
    node.block.runs.map((run) => run.text).join('');

const childPollOptionsForNode = (
    node: Parameters<BlockEditorBlockRenderer<RichBlockMeta>['render']>[0],
): PollOptionView[] =>
    node.children.map((child) => ({
        id: child.id,
        label: blockPlainText(child) || 'Untitled option',
    }));

const matrixPollViewForNode = (
    node: Parameters<BlockEditorBlockRenderer<RichBlockMeta>['render']>[0],
): MatrixPollView => {
    const [rowGroup, columnGroup] = node.children;
    return {
        rows: (rowGroup?.children ?? []).map((row) => ({
            id: row.id,
            label: blockPlainText(row) || 'Untitled row',
        })),
        columns: (columnGroup?.children ?? []).map((column) => ({
            id: column.id,
            label: blockPlainText(column) || 'Untitled column',
        })),
    };
};

function PollBlock({
    meta,
    userId,
    question,
    childOptions,
    matrixPoll,
    editorMode,
    onSetEditorMode,
    onVote,
    onLongAnswer,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    childOptions: PollOptionView[];
    matrixPoll: MatrixPollView;
    editorMode: PollEditorMode;
    onSetEditorMode(mode: PollEditorMode): void;
    onVote(optionId: string, rowId?: string): void;
    onLongAnswer(text: string): void;
}) {
    if (meta.kind === 'long') {
        return <LongAnswerPollBlock meta={meta} userId={userId} question={question} onAnswer={onLongAnswer} />;
    }
    if (meta.kind === 'matrix') {
        return (
            <MatrixPollBlock
                meta={meta}
                userId={userId}
                question={question}
                matrixPoll={matrixPollWithArchivedOptions(meta, matrixPoll)}
                editorMode={editorMode}
                onSetEditorMode={onSetEditorMode}
                onVote={onVote}
            />
        );
    }

    const options: PollOptionView[] =
        meta.kind === 'rating'
            ? ratingOptionIds(meta).map((id) => ({id, label: id}))
            : childPollOptions(meta, childOptions);
    const optionIds = options.map((option) => option.id);
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const selectedOptionIds = selectedPollOptionIds(userVote);
    const results = meta.kind === 'rating' ? singleChoiceResults(meta, optionIds) : choiceResults(meta, optionIds);
    const resultsByOption = new Map(results.map((result) => [result.optionId, result]));
    const canVote = Boolean(userId) && (!userVote || meta.allowChange);
    const showResults = Boolean(userVote);
    const multiple = meta.kind === 'children' && meta.choiceMode === 'multiple';
    const displayMode = meta.kind === 'children' ? meta.displayMode ?? 'inline' : 'inline';
    const useResultBackground = showResults && (meta.kind === 'rating' || displayMode === 'inline');

    if (meta.kind === 'rating' && meta.ratingPresentation === 'stars') {
        return (
            <div className="pollBlock">
                {question}
                <div className="pollControls" contentEditable={false}>
                    <RatingStars
                        userVote={userVote}
                        canVote={canVote}
                        showResults={showResults}
                        resultsByOption={resultsByOption}
                        max={Number.isInteger(meta.max) ? meta.max ?? 5 : 5}
                        onVote={onVote}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="pollBlock">
            {question}
            {meta.kind === 'children' ? <PollEditorModeToggle mode={editorMode} onSetMode={onSetEditorMode} /> : null}
            {editorMode === 'view' ? (
                <div className="pollControls" contentEditable={false}>
                    <div className={['pollOptions', `pollOptions-${displayMode}`].join(' ')} role={multiple ? 'group' : 'radiogroup'} aria-label="Poll options">
                        {options.map((option) => {
                            const result = resultsByOption.get(option.id);
                            const selected = selectedOptionIds.has(option.id);
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={[
                                        'pollOption',
                                        selected ? 'selected' : '',
                                        option.archived ? 'archived' : '',
                                        useResultBackground ? 'pollResultBackground' : '',
                                    ].filter(Boolean).join(' ')}
                                    aria-pressed={selected}
                                    disabled={!canVote}
                                    data-poll-result={useResultBackground ? pollResultTitle(result) : undefined}
                                    style={useResultBackground ? pollResultBackgroundStyle(result, selected) : undefined}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onVote(option.id)}
                                >
                                    <span>{option.label}</span>
                                    {showResults && !useResultBackground ? (
                                        <span className="pollResult">{result?.percentage ?? 0}% · {result?.count ?? 0}</span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function PollEditorModeToggle({mode, onSetMode}: {mode: PollEditorMode; onSetMode(mode: PollEditorMode): void}) {
    return (
        <div className="pollEditorMode" contentEditable={false} aria-label="Poll editor mode">
            {(['view', 'edit'] as const).map((option) => (
                <button
                    key={option}
                    type="button"
                    className={['pollEditorModeButton', mode === option ? 'selected' : ''].filter(Boolean).join(' ')}
                    aria-label={`${capitalize(option)} poll`}
                    aria-pressed={mode === option}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSetMode(option)}
                >
                    {capitalize(option)}
                </button>
            ))}
        </div>
    );
}

function RatingStars({
    userVote,
    canVote,
    showResults,
    resultsByOption,
    max,
    onVote,
}: {
    userVote: ReturnType<typeof currentUserVote>;
    canVote: boolean;
    showResults: boolean;
    resultsByOption: Map<string, PollResult>;
    max: number;
    onVote(optionId: string): void;
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const selected = userVote?.type === 'single' ? Number(userVote.optionId) : 0;
    const active = hovered ?? (Number.isInteger(selected) ? selected : 0);
    const starValues = Array.from({length: normalizedRatingMax(max)}, (_, index) => index + 1);

    return (
        <div className="ratingStars" role="radiogroup" aria-label="Poll options" onMouseLeave={() => setHovered(null)}>
            {starValues.map((value) => {
                const selectedValue = selected === value;
                const result = resultsByOption.get(String(value));
                return (
                    <button
                        key={value}
                        type="button"
                        className={['ratingStar', value <= active ? 'lit' : '', selectedValue ? 'selected' : '', showResults ? 'pollResultBackground' : ''].filter(Boolean).join(' ')}
                        aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
                        aria-pressed={selectedValue}
                        disabled={!canVote}
                        data-poll-result={showResults ? pollResultTitle(result) : undefined}
                        style={showResults ? pollResultBackgroundStyle(result, selectedValue) : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHovered(value)}
                        onFocus={() => setHovered(value)}
                        onBlur={() => setHovered(null)}
                        onClick={() => onVote(String(value))}
                    >
                        ★
                    </button>
                );
            })}
        </div>
    );
}

function MatrixPollBlock({
    meta,
    userId,
    question,
    matrixPoll,
    editorMode,
    onSetEditorMode,
    onVote,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    matrixPoll: MatrixPollView;
    editorMode: PollEditorMode;
    onSetEditorMode(mode: PollEditorMode): void;
    onVote(optionId: string, rowId?: string): void;
}) {
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const matrixVote = userVote?.type === 'matrix' ? userVote : null;
    const canVote = Boolean(userId) && (!userVote || meta.allowChange);
    const showResults = Boolean(matrixVote);
    const multiple = meta.choiceMode === 'multiple';
    const results = matrixPollResults(meta, matrixPoll.rows.map((row) => row.id), matrixPoll.columns.map((column) => column.id));

    return (
        <div className="pollBlock">
            {question}
            <PollEditorModeToggle mode={editorMode} onSetMode={onSetEditorMode} />
            {editorMode === 'view' ? (
                <div className="pollControls matrixPollControls" contentEditable={false}>
                    <div className="matrixPollGrid" style={{'--matrix-columns': matrixPoll.columns.length} as CSSProperties}>
                        <div className="matrixPollCorner" />
                        {matrixPoll.columns.map((column) => (
                            <div key={column.id} className={column.archived ? 'matrixPollHeader archived' : 'matrixPollHeader'}>
                                {column.label}
                            </div>
                        ))}
                        {matrixPoll.rows.map((row) => (
                            <Fragment key={row.id}>
                                <div className={row.archived ? 'matrixPollRowLabel archived' : 'matrixPollRowLabel'}>{row.label}</div>
                                {matrixPoll.columns.map((column) => {
                                    const selected = matrixVote ? matrixAnswerSelected(matrixVote.answers[row.id], column.id) : false;
                                    const result = results.get(row.id)?.get(column.id);
                                    return (
                                        <button
                                            key={column.id}
                                            type="button"
                                            className={['matrixPollCell', selected ? 'selected' : '', showResults ? 'pollResultBackground' : ''].filter(Boolean).join(' ')}
                                            aria-pressed={selected}
                                            disabled={!canVote}
                                            data-poll-result={showResults ? pollResultTitle(result) : undefined}
                                            style={showResults ? pollResultBackgroundStyle(result, selected) : undefined}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => onVote(column.id, row.id)}
                                        >
                                            <span>{multiple ? (selected ? '✓' : '+') : selected ? '●' : '○'}</span>
                                        </button>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function LongAnswerPollBlock({
    meta,
    userId,
    question,
    onAnswer,
}: {
    meta: PollMeta;
    userId: string;
    question: ReactElement;
    onAnswer(text: string): void;
}) {
    const userVote = userId ? currentUserVote(meta, userId) : null;
    const userText = userVote?.type === 'long' ? userVote.text : '';
    const [draft, setDraft] = useState(userText);
    useEffect(() => setDraft(userText), [userText]);
    const canSubmit = Boolean(userId) && (!userVote || meta.allowChange) && draft.trim().length > 0;
    const showResponses = Boolean(userVote);
    const responses = Object.entries(activePollVotes(meta))
        .filter(([, vote]) => vote.type === 'long' && vote.text.trim().length > 0)
        .map(([responseUserId, vote]) => ({userId: responseUserId, text: vote.type === 'long' ? vote.text : ''}));

    return (
        <div className="pollBlock">
            {question}
            <div className="pollControls longPollControls" contentEditable={false}>
                {!userVote || meta.allowChange ? (
                    <div className="longPollComposer">
                        <textarea value={draft} rows={3} disabled={!userId} onChange={(event) => setDraft(event.currentTarget.value)} />
                        <button type="button" disabled={!canSubmit} onMouseDown={(event) => event.preventDefault()} onClick={() => onAnswer(draft)}>
                            Submit
                        </button>
                    </div>
                ) : null}
                {showResponses ? (
                    <div className="longPollResponses">
                        {responses.map((response) => (
                            <div key={response.userId} className="longPollResponse">
                                <span>{response.userId}</span>
                                <p>{response.text}</p>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

const selectedPollOptionIds = (vote: ReturnType<typeof currentUserVote>): Set<string> => {
    if (!vote) return new Set();
    if (vote.type === 'single') return new Set([vote.optionId]);
    if (vote.type === 'multiple') return new Set(vote.optionIds);
    return new Set();
};

const childPollOptions = (meta: PollMeta, childOptions: PollOptionView[]): PollOptionView[] => {
    const activeIds = new Set(childOptions.map((option) => option.id));
    const archived = votedOptionIds(meta)
        .filter((id) => !activeIds.has(id))
        .map((id) => ({id, label: 'Deleted option', archived: true}));
    return [...childOptions, ...archived];
};

const normalizedRatingMax = (max: number): number => {
    const normalizedMax = Number.isFinite(max) ? Math.trunc(max) : 5;
    return Math.max(1, Math.min(10, normalizedMax));
};

const pollResultTitle = (result: PollResult | undefined): string =>
    result && result.voterIds.length > 0
        ? `${result.percentage}% · ${result.count} ${result.count === 1 ? 'vote' : 'votes'} · ${result.voterIds.join(', ')}`
        : result
          ? `${result.percentage}% · ${result.count} ${result.count === 1 ? 'vote' : 'votes'}`
          : '0% · 0 votes';

const pollResultBackgroundStyle = (result: PollResult | undefined, selected = false): CSSProperties => {
    const percentage = Math.max(0, Math.min(100, result?.percentage ?? 0));
    return {
        '--poll-result-fill': `${percentage}%`,
        '--poll-result-base': selected ? '#eef6fb' : '#fff',
    } as CSSProperties;
};

const matrixAnswerSelected = (answer: string | string[] | undefined, columnId: string): boolean =>
    Array.isArray(answer) ? answer.includes(columnId) : answer === columnId;

const matrixPollWithArchivedOptions = (meta: PollMeta, matrixPoll: MatrixPollView): MatrixPollView => {
    const rowIds = new Set(matrixPoll.rows.map((row) => row.id));
    const columnIds = new Set(matrixPoll.columns.map((column) => column.id));
    const archivedRows = new Set<string>();
    const archivedColumns = new Set<string>();
    for (const vote of Object.values(activePollVotes(meta))) {
        if (vote.type !== 'matrix') continue;
        for (const [rowId, answer] of Object.entries(vote.answers)) {
            if (!rowIds.has(rowId)) archivedRows.add(rowId);
            const answers = Array.isArray(answer) ? answer : [answer];
            for (const columnId of answers) {
                if (!columnIds.has(columnId)) archivedColumns.add(columnId);
            }
        }
    }
    return {
        rows: [...matrixPoll.rows, ...[...archivedRows].map((id) => ({id, label: 'Deleted row', archived: true}))],
        columns: [...matrixPoll.columns, ...[...archivedColumns].map((id) => ({id, label: 'Deleted column', archived: true}))],
    };
};

const capitalize = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value);
