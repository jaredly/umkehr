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
} from './model';
import {WhiteboardPanel} from './WhiteboardPanel';

export const whiteboardApp: AppDefinition<WhiteboardState> = {
    id: 'whiteboard',
    title: 'Whiteboard',
    tagKey: 'type',
    schema: whiteboardSchema,
    validateState: validateWhiteboardState,
    initialState: initialWhiteboardState,
    initialTimestamp: initialWhiteboardTimestamp,
    renderPanel({editor, actor, title, gridSlot, setPresenceSelection}) {
        return (
            <WhiteboardPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                setPresenceSelection={setPresenceSelection}
            />
        );
    },
};

export const whiteboardCrdtRuntime: CrdtRuntime<WhiteboardState> = {
    docId: WHITEBOARD_DOC_ID,
    Provider: ProvideWhiteboard,
    useEditorContext: useWhiteboard,
};

export const whiteboardHistoryRuntime: HistoryRuntime<WhiteboardState> = {
    Provider: ProvideWhiteboardHistory,
    useEditorContext: useWhiteboardHistory,
};
