import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import type {GridPoint} from './artifacts';
import type {WordsearchState} from './schema';

export {
    WORDSEARCH_DOC_ID,
    initialWordsearchState,
    initialWordsearchTimestamp,
    validateWordsearchState,
    wordsearchSchema,
    type WordsearchState,
} from './schema';
export {
    WORDSEARCH_PUZZLE_ARTIFACT_ID,
    currentWordsearchPuzzle,
    wordsearchArtifactStore,
    type GridPoint,
    type WordEntry,
    type WordsearchPuzzleArtifact,
} from './artifacts';

export type WordsearchSelectionEvent = {
    type: 'selection';
    start: GridPoint;
    end: GridPoint;
    cells: GridPoint[];
};

export type WordsearchChatEvent = {
    type: 'chat';
    text: string;
    sentAt: string;
};

export type WordsearchEphemeralData = WordsearchSelectionEvent | WordsearchChatEvent;

export const wordsearchSelectionKind = 'wordsearch:selection';
export const wordsearchChatKind = 'wordsearch:chat';
export const WORDSEARCH_CHAT_MAX_LENGTH = 280;

export const [ProvideWordsearchHistory, useWordsearchHistory] = createHistoryContext<
    WordsearchState,
    never,
    'type'
>('type');

export const [ProvideWordsearch, useWordsearch] = createSyncedContext<
    WordsearchState,
    'type',
    WordsearchEphemeralData
>('type', undefined, {
    validateEphemeralData: isWordsearchEphemeralData,
    maxEphemeralBytes: 4096,
});

export function selectionMessage({
    actor,
    start,
    end,
    cells,
}: {
    actor: string;
    start: GridPoint;
    end: GridPoint;
    cells: GridPoint[];
}) {
    return {
        kind: wordsearchSelectionKind,
        id: selectionMessageId(actor),
        actor,
        path: foundRootPath(),
        data: {type: 'selection' as const, start, end, cells},
    };
}

export function clearSelectionMessage(actor: string) {
    return {
        kind: wordsearchSelectionKind,
        id: selectionMessageId(actor),
        actor,
        path: foundRootPath(),
        data: {type: 'selection' as const, start: {x: 0, y: 0}, end: {x: 0, y: 0}, cells: []},
        clear: true,
    };
}

export function selectionMessageId(actor: string) {
    return `${wordsearchSelectionKind}:${actor}`;
}

export function chatMessage({
    actor,
    id,
    text,
    sentAt,
}: {
    actor: string;
    id: string;
    text: string;
    sentAt: string;
}) {
    return {
        kind: wordsearchChatKind,
        id,
        actor,
        path: chatRootPath(),
        data: {type: 'chat' as const, text, sentAt},
    };
}

export function foundRootPath() {
    return [{type: 'key' as const, key: 'found'}];
}

export function chatRootPath() {
    return [{type: 'key' as const, key: 'chat'}];
}

export function isWordsearchEphemeralData(input: unknown): input is WordsearchEphemeralData {
    if (isWordsearchChatEvent(input)) return true;
    return isWordsearchSelectionEvent(input);
}

function isWordsearchSelectionEvent(input: unknown): input is WordsearchSelectionEvent {
    if (!isRecord(input)) return false;
    return (
        input.type === 'selection' &&
        isGridPoint(input.start) &&
        isGridPoint(input.end) &&
        Array.isArray(input.cells) &&
        input.cells.every(isGridPoint)
    );
}

function isWordsearchChatEvent(input: unknown): input is WordsearchChatEvent {
    return (
        isRecord(input) &&
        input.type === 'chat' &&
        typeof input.text === 'string' &&
        input.text.trim().length > 0 &&
        input.text.length <= WORDSEARCH_CHAT_MAX_LENGTH &&
        typeof input.sentAt === 'string' &&
        input.sentAt.length > 0
    );
}

function isGridPoint(input: unknown): input is GridPoint {
    return (
        isRecord(input) &&
        typeof input.x === 'number' &&
        typeof input.y === 'number' &&
        Number.isInteger(input.x) &&
        Number.isInteger(input.y) &&
        input.x >= 0 &&
        input.x < 8 &&
        input.y >= 0 &&
        input.y < 8
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
