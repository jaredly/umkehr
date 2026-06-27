import {
    artifactFingerprintHash,
    type ArtifactManifestEntry,
    type ArtifactStore,
    type SerializedArtifact,
} from '../../lib/artifacts';

export type GridPoint = {
    x: number;
    y: number;
};

export type WordEntry = {
    text: string;
    start: GridPoint;
    end: GridPoint;
};

export type WordsearchPuzzleArtifact = {
    id: string;
    title: string;
    board: string[][];
    words: WordEntry[];
};

export const WORDSEARCH_PUZZLE_ARTIFACT_ID = 'puzzle';
export const WORDSEARCH_PUZZLE_KIND = 'wordsearch-puzzle';
export const WORDSEARCH_PUZZLE_VERSION = 1;

const initialPuzzle: WordsearchPuzzleArtifact = {
    id: WORDSEARCH_PUZZLE_ARTIFACT_ID,
    title: 'Starter 8x8',
    board: [
        ['R', 'E', 'A', 'C', 'T', 'X', 'M', 'X'],
        ['C', 'R', 'D', 'T', 'X', 'X', 'E', 'X'],
        ['S', 'L', 'S', 'Y', 'N', 'C', 'R', 'X'],
        ['T', 'O', 'X', 'X', 'X', 'X', 'G', 'U'],
        ['A', 'C', 'X', 'X', 'X', 'X', 'E', 'N'],
        ['T', 'A', 'X', 'X', 'X', 'X', 'X', 'D'],
        ['E', 'L', 'X', 'X', 'X', 'X', 'X', 'O'],
        ['X', 'J', 'O', 'I', 'N', 'X', 'X', 'X'],
    ],
    words: [
        {text: 'REACT', start: {x: 0, y: 0}, end: {x: 4, y: 0}},
        {text: 'CRDT', start: {x: 0, y: 1}, end: {x: 3, y: 1}},
        {text: 'STATE', start: {x: 0, y: 2}, end: {x: 0, y: 6}},
        {text: 'LOCAL', start: {x: 1, y: 2}, end: {x: 1, y: 6}},
        {text: 'MERGE', start: {x: 6, y: 0}, end: {x: 6, y: 4}},
        {text: 'SYNC', start: {x: 2, y: 2}, end: {x: 5, y: 2}},
        {text: 'UNDO', start: {x: 7, y: 3}, end: {x: 7, y: 6}},
        {text: 'JOIN', start: {x: 1, y: 7}, end: {x: 4, y: 7}},
    ],
};

let loadedPuzzle = initialPuzzle;

export const wordsearchArtifactStore: ArtifactStore<WordsearchPuzzleArtifact> = {
    get(id) {
        return id === WORDSEARCH_PUZZLE_ARTIFACT_ID ? loadedPuzzle : null;
    },
    serialize(id) {
        if (id !== WORDSEARCH_PUZZLE_ARTIFACT_ID) return null;
        return serializePuzzle(loadedPuzzle);
    },
    load(artifact) {
        if (
            artifact.id !== WORDSEARCH_PUZZLE_ARTIFACT_ID ||
            artifact.kind !== WORDSEARCH_PUZZLE_KIND ||
            artifact.version !== WORDSEARCH_PUZZLE_VERSION ||
            !isWordsearchPuzzleArtifact(artifact.data)
        ) {
            return;
        }
        const next = artifact.data;
        if (artifact.fingerprintHash !== artifactFingerprintHash(next)) return;
        loadedPuzzle = next;
    },
    manifest() {
        return [manifestForPuzzle(loadedPuzzle)];
    },
};

export function currentWordsearchPuzzle() {
    return loadedPuzzle;
}

function serializePuzzle(puzzle: WordsearchPuzzleArtifact): SerializedArtifact {
    return {
        ...manifestForPuzzle(puzzle),
        data: puzzle,
    };
}

function manifestForPuzzle(puzzle: WordsearchPuzzleArtifact): ArtifactManifestEntry {
    return {
        id: puzzle.id,
        kind: WORDSEARCH_PUZZLE_KIND,
        version: WORDSEARCH_PUZZLE_VERSION,
        fingerprintHash: artifactFingerprintHash(puzzle),
    };
}

function isWordsearchPuzzleArtifact(input: unknown): input is WordsearchPuzzleArtifact {
    if (!isRecord(input)) return false;
    return (
        input.id === WORDSEARCH_PUZZLE_ARTIFACT_ID &&
        typeof input.title === 'string' &&
        Array.isArray(input.board) &&
        input.board.length === 8 &&
        input.board.every(
            (row) =>
                Array.isArray(row) &&
                row.length === 8 &&
                row.every((cell) => typeof cell === 'string' && cell.length === 1),
        ) &&
        Array.isArray(input.words) &&
        input.words.every(isWordEntry)
    );
}

function isWordEntry(input: unknown): input is WordEntry {
    return (
        isRecord(input) &&
        typeof input.text === 'string' &&
        isGridPoint(input.start) &&
        isGridPoint(input.end)
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
