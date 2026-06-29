import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    initialJigsawState,
    initialJigsawTimestamp,
    JIGSAW_DOC_ID,
    jigsawArtifactStore,
    jigsawSchema,
    ProvideJigsaw,
    ProvideJigsawHistory,
    useJigsaw,
    useJigsawHistory,
    validateJigsawState,
    type JigsawEphemeralData,
    type JigsawState,
} from './model';
import {JigsawPanel} from './JigsawPanel';

export const jigsawApp: AppDefinition<JigsawState, JigsawEphemeralData> = {
    id: 'jigsaw',
    title: 'Jigsaw',
    schemaVersion: 1,
    tagKey: 'type',
    schema: jigsawSchema,
    validateState: validateJigsawState,
    initialState: initialJigsawState,
    initialTimestamp: initialJigsawTimestamp,
    artifacts: jigsawArtifactStore,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <JigsawPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const jigsawCrdtRuntime: CrdtRuntime<JigsawState, JigsawEphemeralData> = {
    docId: JIGSAW_DOC_ID,
    Provider: ProvideJigsaw,
    useEditorContext: useJigsaw,
};

export const jigsawHistoryRuntime: HistoryRuntime<JigsawState> = {
    Provider: ProvideJigsawHistory,
    useEditorContext: useJigsawHistory,
};
