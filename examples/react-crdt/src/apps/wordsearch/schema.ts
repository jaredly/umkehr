import type {IValidation} from 'typia';
import typia from 'typia';
import {hlc, type HlcTimestamp} from 'umkehr/crdt';
import {currentWordsearchPuzzle} from './artifacts';

export type WordsearchState = {
    found: Record<string, Record<string, HlcTimestamp>>;
};

export const WORDSEARCH_DOC_ID = 'umkehr-react-crdt-wordsearch-v1';
export const wordsearchSchema = typia.json.schemas<[WordsearchState], '3.1'>();
export const validateWordsearchState: (input: unknown) => IValidation<WordsearchState> =
    typia.createValidate<WordsearchState>();

export const initialWordsearchState: WordsearchState = {
    found: Object.fromEntries(currentWordsearchPuzzle().words.map((_, index) => [String(index), {}])),
};

export const initialWordsearchTimestamp = hlc.pack(hlc.init('seed', 0));
