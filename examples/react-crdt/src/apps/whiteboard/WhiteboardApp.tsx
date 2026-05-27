import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    ProvideWhiteboard,
    ProvideWhiteboardHistory,
    WHITEBOARD_DOC_ID,
    initialWhiteboardState,
    initialWhiteboardTimestamp,
    useWhiteboard,
    useWhiteboardHistory,
    validateWhiteboardState,
    whiteboardSchema,
    type WhiteboardState,
    type WhiteboardEphemeralData,
} from './model';
import {WhiteboardPanel} from './WhiteboardPanel';

export const whiteboardApp: AppDefinition<WhiteboardState, WhiteboardEphemeralData> = {
    id: 'whiteboard',
    title: 'Whiteboard',
    schemaVersion: 1,
    tagKey: 'type',
    schema: whiteboardSchema,
    validateState: validateWhiteboardState,
    initialState: initialWhiteboardState,
    initialTimestamp: initialWhiteboardTimestamp,
    renderPanel({editor, actor, title, gridSlot, readOnly, setPresenceSelection}) {
        return (
            <WhiteboardPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
                setPresenceSelection={setPresenceSelection}
            />
        );
    },
};

export const whiteboardCrdtRuntime: CrdtRuntime<WhiteboardState, WhiteboardEphemeralData> = {
    docId: WHITEBOARD_DOC_ID,
    Provider: ProvideWhiteboard,
    useEditorContext: useWhiteboard,
};

export const whiteboardHistoryRuntime: HistoryRuntime<WhiteboardState> = {
    Provider: ProvideWhiteboardHistory,
    useEditorContext: useWhiteboardHistory,
};
