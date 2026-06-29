import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    initialJigsawState,
    initialJigsawTimestamp,
    initialJigsawArtifacts,
    isJigsawPieceCount,
    JIGSAW_DOC_ID,
    jigsawArtifactStore,
    jigsawSchema,
    ProvideJigsaw,
    ProvideJigsawHistory,
    useJigsaw,
    useJigsawHistory,
    validateJigsawState,
    type JigsawEphemeralData,
    type JigsawPieceCount,
    type JigsawState,
} from './model';
import {JigsawPanel} from './JigsawPanel';

type JigsawDocumentInitParams = {
    pieceCount: JigsawPieceCount;
};

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
    documentInit: {
        required: true,
        defaultParams() {
            return {pieceCount: 12};
        },
        renderFields({value, onChange}) {
            return (
                <label className="documentCreateField">
                    <span>Number of pieces</span>
                    <select
                        value={value.pieceCount}
                        onChange={(event) =>
                            onChange({
                                pieceCount: Number(event.currentTarget.value) as JigsawPieceCount,
                            })
                        }
                    >
                        <option value={12}>12</option>
                        <option value={30}>30</option>
                        <option value={60}>60</option>
                        <option value={120}>120</option>
                    </select>
                </label>
            );
        },
        validate(input): {success: true; data: JigsawDocumentInitParams} | {success: false; message: string} {
            if (
                typeof input === 'object' &&
                input !== null &&
                isJigsawPieceCount((input as {pieceCount?: unknown}).pieceCount)
            ) {
                return {success: true, data: {pieceCount: (input as JigsawDocumentInitParams).pieceCount}};
            }
            return {success: false, message: 'Choose a valid jigsaw piece count.'};
        },
        initialState() {
            return initialJigsawState;
        },
        initialArtifacts(params) {
            return initialJigsawArtifacts(params.pieceCount);
        },
    },
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
