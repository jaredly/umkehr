import {describe, expect, it} from 'vitest';
import {hlc} from 'umkehr/crdt';
import {
    WORDSEARCH_PUZZLE_ARTIFACT_ID,
    currentWordsearchPuzzle,
    wordsearchArtifactStore,
} from './artifacts';
import {
    cellsForSelection,
    findWordPatches,
    firstFinder,
    matchingWordIndex,
} from './wordsearch';
import type {WordsearchState} from './schema';

describe('wordsearch artifacts', () => {
    it('provides a valid puzzle artifact and manifest', () => {
        const puzzle = currentWordsearchPuzzle();
        expect(puzzle.id).toBe(WORDSEARCH_PUZZLE_ARTIFACT_ID);
        expect(puzzle.board).toHaveLength(8);
        expect(puzzle.board.every((row) => row.length === 8)).toBe(true);
        expect(wordsearchArtifactStore.manifest()).toEqual([
            expect.objectContaining({
                id: WORDSEARCH_PUZZLE_ARTIFACT_ID,
                kind: 'wordsearch-puzzle',
                version: 1,
            }),
        ]);
        expect(wordsearchArtifactStore.serialize(WORDSEARCH_PUZZLE_ARTIFACT_ID)?.data).toEqual(
            puzzle,
        );
    });

    it('has word placements that match board letters', () => {
        const puzzle = currentWordsearchPuzzle();
        for (const word of puzzle.words) {
            const letters = cellsForSelection({start: word.start, end: word.end})
                .map((cell) => puzzle.board[cell.y][cell.x])
                .join('');
            expect(letters).toBe(word.text);
        }
    });
});

describe('wordsearch selection helpers', () => {
    it('walks horizontal, vertical, diagonal, and reverse selections', () => {
        expect(cellsForSelection({start: {x: 0, y: 0}, end: {x: 2, y: 0}})).toEqual([
            {x: 0, y: 0},
            {x: 1, y: 0},
            {x: 2, y: 0},
        ]);
        expect(cellsForSelection({start: {x: 1, y: 2}, end: {x: 1, y: 0}})).toEqual([
            {x: 1, y: 2},
            {x: 1, y: 1},
            {x: 1, y: 0},
        ]);
        expect(cellsForSelection({start: {x: 0, y: 0}, end: {x: 2, y: 2}})).toEqual([
            {x: 0, y: 0},
            {x: 1, y: 1},
            {x: 2, y: 2},
        ]);
        expect(cellsForSelection({start: {x: 0, y: 0}, end: {x: 2, y: 1}})).toEqual([]);
    });

    it('matches configured words forward and backward', () => {
        const puzzle = currentWordsearchPuzzle();
        const word = puzzle.words[0];
        const beforeEnd = cellsForSelection({start: word.start, end: word.end}).at(-2) ?? word.start;
        expect(matchingWordIndex(puzzle, {start: word.start, end: word.end})).toBe(0);
        expect(matchingWordIndex(puzzle, {start: word.end, end: word.start})).toBe(0);
        expect(matchingWordIndex(puzzle, {start: word.start, end: beforeEnd})).toBe(-1);
    });

    it('chooses first finder by HLC timestamp and actor tie-break', () => {
        const early = hlc.pack(hlc.init('b', 10));
        const late = hlc.pack(hlc.init('a', 20));
        expect(firstFinder({a: late, b: early})).toEqual(['b', early]);
        expect(firstFinder({b: hlc.pack(hlc.init('b', 10)), a: hlc.pack(hlc.init('a', 10))})?.[0]).toBe(
            'a',
        );
    });

    it('does not create patches for already-found words', () => {
        const timestamp = hlc.pack(hlc.init('actor-a', 10));
        const state: WordsearchState = {found: {'0': {'actor-a': timestamp}}};
        expect(findWordPatches(state, 0, 'actor-b', hlc.pack(hlc.init('actor-b', 11)))).toEqual([]);
    });
});
