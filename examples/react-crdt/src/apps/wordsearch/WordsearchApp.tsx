import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    ProvideWordsearch,
    ProvideWordsearchHistory,
    WORDSEARCH_DOC_ID,
    initialWordsearchState,
    initialWordsearchTimestamp,
    useWordsearch,
    useWordsearchHistory,
    validateWordsearchState,
    wordsearchArtifactStore,
    wordsearchSchema,
    type WordsearchEphemeralData,
    type WordsearchState,
} from './model';
import {WordsearchPanel} from './WordsearchPanel';

export const wordsearchApp: AppDefinition<WordsearchState, WordsearchEphemeralData> = {
    id: 'wordsearch',
    title: 'Wordsearch',
    schemaVersion: 1,
    tagKey: 'type',
    schema: wordsearchSchema,
    validateState: validateWordsearchState,
    initialState: initialWordsearchState,
    initialTimestamp: initialWordsearchTimestamp,
    artifacts: wordsearchArtifactStore,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <WordsearchPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const wordsearchCrdtRuntime: CrdtRuntime<WordsearchState, WordsearchEphemeralData> = {
    docId: WORDSEARCH_DOC_ID,
    Provider: ProvideWordsearch,
    useEditorContext: useWordsearch,
};

export const wordsearchHistoryRuntime: HistoryRuntime<WordsearchState> = {
    Provider: ProvideWordsearchHistory,
    useEditorContext: useWordsearchHistory,
};
