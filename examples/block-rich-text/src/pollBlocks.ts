import type {HLC} from 'umkehr/block-crdt/types';
import type {PollChoiceMode, PollMeta, PollVote, RichBlockMeta} from './blockMeta';

export type PollResult = {
    optionId: string;
    count: number;
    percentage: number;
};

export type PollVoteCommandData = {
    blockId: string;
    userId: string;
    before?: PollVote;
    after: PollVote;
};

export const normalizeUserId = (value: string): string => value.trim().toLowerCase();

export const ratingOptionIds = (meta: PollMeta): string[] => {
    const max = Number.isInteger(meta.max) ? meta.max ?? 5 : 5;
    const end = Math.max(1, max);
    return Array.from({length: end}, (_, index) => String(index + 1));
};

export const activePollVotes = (meta: PollMeta): Record<string, PollVote> =>
    Object.fromEntries(Object.entries(meta.votes).filter(([, vote]) => !vote.deleted));

export const currentUserVote = (meta: PollMeta, userId: string): PollVote | null => {
    const vote = meta.votes[userId];
    return vote && !vote.deleted ? vote : null;
};

export const singleChoiceResults = (meta: PollMeta, optionIds: string[]): PollResult[] => {
    const counts = new Map(optionIds.map((optionId) => [optionId, 0]));
    let total = 0;
    for (const vote of Object.values(activePollVotes(meta))) {
        if (vote.type !== 'single') continue;
        counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
        total++;
    }
    return Array.from(counts.entries()).map(([optionId, count]) => ({
        optionId,
        count,
        percentage: total ? Math.round((count / total) * 100) : 0,
    }));
};

export const choiceResults = (meta: PollMeta, optionIds: string[]): PollResult[] => {
    const counts = new Map(optionIds.map((optionId) => [optionId, 0]));
    let total = 0;
    for (const vote of Object.values(activePollVotes(meta))) {
        if (vote.type === 'single') {
            counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
            total++;
        } else if (vote.type === 'multiple') {
            for (const optionId of vote.optionIds) {
                counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
            }
            total++;
        }
    }
    return Array.from(counts.entries()).map(([optionId, count]) => ({
        optionId,
        count,
        percentage: total ? Math.round((count / total) * 100) : 0,
    }));
};

export const votedOptionIds = (meta: PollMeta): string[] => {
    const result = new Set<string>();
    for (const vote of Object.values(activePollVotes(meta))) {
        if (vote.type === 'single') {
            result.add(vote.optionId);
        } else if (vote.type === 'multiple') {
            for (const optionId of vote.optionIds) result.add(optionId);
        }
    }
    return [...result];
};

export const matrixPollResults = (
    meta: PollMeta,
    rowIds: string[],
    columnIds: string[],
): Map<string, Map<string, PollResult>> => {
    const results = new Map<string, Map<string, PollResult>>();
    for (const rowId of rowIds) {
        const counts = new Map(columnIds.map((columnId) => [columnId, 0]));
        let total = 0;
        for (const vote of Object.values(activePollVotes(meta))) {
            if (vote.type !== 'matrix') continue;
            const answer = vote.answers[rowId];
            if (answer === undefined) continue;
            const answers = Array.isArray(answer) ? answer : [answer];
            for (const columnId of answers) counts.set(columnId, (counts.get(columnId) ?? 0) + 1);
            total++;
        }
        results.set(
            rowId,
            new Map(
                [...counts.entries()].map(([columnId, count]) => [
                    columnId,
                    {optionId: columnId, count, percentage: total ? Math.round((count / total) * 100) : 0},
                ]),
            ),
        );
    }
    return results;
};

export const pollMetaWithChoiceMode = (
    meta: PollMeta,
    choiceMode: PollChoiceMode,
    ts: HLC,
): PollMeta => {
    if (choiceMode === 'multiple' || meta.choiceMode !== 'multiple') {
        return {...meta, choiceMode, ts};
    }
    if (meta.kind === 'children') {
        return {...meta, choiceMode, votes: singleChoicePollVotes(meta.votes, ts), ts};
    }
    if (meta.kind === 'matrix') {
        return {...meta, choiceMode, votes: singleChoiceMatrixPollVotes(meta.votes, ts), ts};
    }
    return {...meta, choiceMode, ts};
};

export const singleChoicePollVotes = (
    votes: Record<string, PollVote>,
    ts: HLC,
): Record<string, PollVote> =>
    Object.fromEntries(
        Object.entries(votes).map(([userId, vote]) => {
            if (vote.deleted || vote.type !== 'multiple') return [userId, vote];
            const optionId = vote.optionIds[0];
            if (optionId === undefined) {
                return [userId, deletedPollVote(vote, ts)];
            }
            return [userId, {type: 'single', optionId, ts} satisfies PollVote];
        }),
    );

export const singleChoiceMatrixPollVotes = (
    votes: Record<string, PollVote>,
    ts: HLC,
): Record<string, PollVote> =>
    Object.fromEntries(
        Object.entries(votes).map(([userId, vote]) => {
            if (vote.deleted || vote.type !== 'matrix') return [userId, vote];
            const answers = Object.fromEntries(
                Object.entries(vote.answers).flatMap(([rowId, answer]) => {
                    const optionId = Array.isArray(answer) ? answer[0] : answer;
                    return optionId === undefined ? [] : [[rowId, optionId]];
                }),
            );
            return [userId, {type: 'matrix', answers, ts} satisfies PollVote];
        }),
    );

export const mergeRichBlockMeta = (
    current: RichBlockMeta,
    incoming: RichBlockMeta,
): RichBlockMeta | null => {
    if (current.type === 'poll' && incoming.type === 'poll') {
        return mergePollMeta(current, incoming);
    }
    return incoming.ts > current.ts ? incoming : null;
};

export const mergePollMeta = (current: PollMeta, incoming: PollMeta): PollMeta => {
    const base = incoming.ts > current.ts ? incoming : current;
    const mergedVotes: Record<string, PollVote> = {...current.votes};
    for (const [userId, incomingVote] of Object.entries(incoming.votes)) {
        const currentVote = mergedVotes[userId];
        if (!currentVote || incomingVote.ts > currentVote.ts) {
            mergedVotes[userId] = incomingVote;
        }
    }
    return {...base, votes: mergedVotes};
};

export const isPollMeta = (value: unknown): value is PollMeta => {
    if (!isRecord(value) || value.type !== 'poll' || typeof value.ts !== 'string') return false;
    if (
        value.kind !== 'rating' &&
        value.kind !== 'children' &&
        value.kind !== 'matrix' &&
        value.kind !== 'long'
    ) {
        return false;
    }
    if (typeof value.allowChange !== 'boolean') return false;
    if (value.choiceMode !== undefined && value.choiceMode !== 'single' && value.choiceMode !== 'multiple') {
        return false;
    }
    if (value.displayMode !== undefined && value.displayMode !== 'inline' && value.displayMode !== 'list') {
        return false;
    }
    if (
        value.ratingPresentation !== undefined &&
        value.ratingPresentation !== 'numbers' &&
        value.ratingPresentation !== 'stars'
    ) {
        return false;
    }
    if (value.max !== undefined && !Number.isInteger(value.max)) return false;
    if (!isRecord(value.votes)) return false;
    return Object.values(value.votes).every(isPollVote);
};

export const isPollVote = (value: unknown): value is PollVote => {
    if (!isRecord(value) || typeof value.ts !== 'string') return false;
    if (value.deleted !== undefined && typeof value.deleted !== 'boolean') return false;
    switch (value.type) {
        case 'single':
            return typeof value.optionId === 'string';
        case 'multiple':
            return Array.isArray(value.optionIds) && value.optionIds.every((item) => typeof item === 'string');
        case 'matrix':
            return (
                isRecord(value.answers) &&
                Object.values(value.answers).every(
                    (answer) =>
                        typeof answer === 'string' ||
                        (Array.isArray(answer) && answer.every((item) => typeof item === 'string')),
                )
            );
        case 'long':
            return typeof value.text === 'string';
        default:
            return false;
    }
};

export const deletedPollVote = (previous: PollVote | undefined, ts: HLC): PollVote => {
    if (previous) return {...previous, ts, deleted: true};
    return {type: 'single', optionId: '', ts, deleted: true};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
