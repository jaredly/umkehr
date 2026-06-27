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

const wordBank = ['REACT', 'CRDT', 'STATE', 'LOCAL', 'MERGE', 'SYNC', 'UNDO', 'JOIN'] as const;
const directions = [
    {x: 1, y: 0},
    {x: -1, y: 0},
    {x: 0, y: 1},
    {x: 0, y: -1},
    {x: 1, y: 1},
    {x: -1, y: -1},
    {x: 1, y: -1},
    {x: -1, y: 1},
] as const;
const filler = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let loadedPuzzle = generateWordsearchPuzzle('default');

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
    createInitial() {
        loadedPuzzle = generateWordsearchPuzzle(randomSeed());
        return [serializePuzzle(loadedPuzzle)];
    },
};

export function currentWordsearchPuzzle() {
    return loadedPuzzle;
}

export function generateWordsearchPuzzle(seed: string): WordsearchPuzzleArtifact {
    const random = mulberry32(seedHash(seed));
    const board: string[][] = Array.from({length: 8}, () => Array.from({length: 8}, () => ''));
    const words: WordEntry[] = [];

    for (const text of wordBank) {
        const candidates = shuffled(placementCandidates(text), random);
        const candidate = candidates.find((placement) => canPlace(board, text, placement));
        if (!candidate) throw new Error(`Could not place word ${text}`);
        placeWord(board, text, candidate);
        words.push({
            text,
            start: candidate.start,
            end: {
                x: candidate.start.x + candidate.direction.x * (text.length - 1),
                y: candidate.start.y + candidate.direction.y * (text.length - 1),
            },
        });
    }

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (!board[y][x]) board[y][x] = filler[Math.floor(random() * filler.length)];
        }
    }

    return {
        id: WORDSEARCH_PUZZLE_ARTIFACT_ID,
        title: `Generated ${seed.slice(0, 8)}`,
        board,
        words,
    };
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

function placementCandidates(text: string) {
    const candidates: Array<{start: GridPoint; direction: GridPoint}> = [];
    for (const direction of directions) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const endX = x + direction.x * (text.length - 1);
                const endY = y + direction.y * (text.length - 1);
                if (endX >= 0 && endX < 8 && endY >= 0 && endY < 8) {
                    candidates.push({start: {x, y}, direction});
                }
            }
        }
    }
    return candidates;
}

function canPlace(
    board: string[][],
    text: string,
    placement: {start: GridPoint; direction: GridPoint},
) {
    return [...text].every((letter, index) => {
        const x = placement.start.x + placement.direction.x * index;
        const y = placement.start.y + placement.direction.y * index;
        return board[y][x] === '' || board[y][x] === letter;
    });
}

function placeWord(
    board: string[][],
    text: string,
    placement: {start: GridPoint; direction: GridPoint},
) {
    [...text].forEach((letter, index) => {
        const x = placement.start.x + placement.direction.x * index;
        const y = placement.start.y + placement.direction.y * index;
        board[y][x] = letter;
    });
}

function shuffled<T>(items: T[], random: () => number) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function randomSeed() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function seedHash(seed: string) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index++) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function mulberry32(seed: number) {
    return () => {
        seed += 0x6d2b79f5;
        let value = seed;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
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
