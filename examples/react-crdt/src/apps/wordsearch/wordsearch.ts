import {compareTimestamps, hlc, type HlcTimestamp} from 'umkehr/crdt';
import type {DraftPatch} from 'umkehr';
import type {GridPoint, WordsearchPuzzleArtifact} from './artifacts';
import type {WordsearchState} from './schema';

export type WordsearchSelection = {
    start: GridPoint;
    end: GridPoint;
};

export function samePoint(a: GridPoint, b: GridPoint) {
    return a.x === b.x && a.y === b.y;
}

export function cellsForSelection(selection: WordsearchSelection): GridPoint[] {
    const dx = selection.end.x - selection.start.x;
    const dy = selection.end.y - selection.start.y;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    if (length === 0) return [selection.start];
    const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    if (!straight) return [];
    return Array.from({length: length + 1}, (_, index) => ({
        x: selection.start.x + stepX * index,
        y: selection.start.y + stepY * index,
    }));
}

export function matchingWordIndex(
    puzzle: WordsearchPuzzleArtifact,
    selection: WordsearchSelection,
): number | null {
    const cells = cellsForSelection(selection);
    if (!cells.length) return null;
    return puzzle.words.findIndex((word) => {
        const forward = samePoint(selection.start, word.start) && samePoint(selection.end, word.end);
        const reverse = samePoint(selection.start, word.end) && samePoint(selection.end, word.start);
        return (forward || reverse) && cells.length === word.text.length;
    });
}

export function isWordFound(foundForWord: Record<string, HlcTimestamp> | undefined) {
    return Object.keys(foundForWord ?? {}).length > 0;
}

export function firstFinder(foundForWord: Record<string, HlcTimestamp> | undefined) {
    return (
        Object.entries(foundForWord ?? {}).sort(
            ([actorA, tsA], [actorB, tsB]) => compareTimestamps(tsA, tsB) || actorA.localeCompare(actorB),
        )[0] ?? null
    );
}

export function foundWordIndexes(state: WordsearchState) {
    return new Set(
        Object.entries(state.found)
            .filter(([, foundForWord]) => isWordFound(foundForWord))
            .map(([index]) => Number(index)),
    );
}

export function findTimestamp(actor: string): HlcTimestamp {
    return hlc.pack(hlc.init(actor, Date.now()));
}

export function findWordPatches(
    state: WordsearchState,
    wordIndex: number,
    actor: string,
    timestamp: HlcTimestamp,
): DraftPatch<WordsearchState>[] {
    const key = String(wordIndex);
    const foundForWord = state.found[key];
    if (isWordFound(foundForWord)) return [];
    if (foundForWord) {
        return [
            {
                op: 'add',
                path: [
                    {type: 'key', key: 'found'},
                    {type: 'key', key},
                    {type: 'key', key: actor},
                ],
                value: timestamp,
            },
        ];
    }
    return [
        {
            op: 'add',
            path: [
                {type: 'key', key: 'found'},
                {type: 'key', key},
            ],
            value: {[actor]: timestamp},
        },
    ];
}
