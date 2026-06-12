import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {blockRichTextLeafPlugin} from 'umkehr/block-richtext';
import {
    BLOCK_NOTES_DOC_ID,
    blockNotesSchema,
    initialBlockNotesState,
    initialBlockNotesTimestamp,
    ProvideBlockNotes,
    ProvideBlockNotesHistory,
    useBlockNotes,
    useBlockNotesHistory,
    validateBlockNotesState,
    type BlockNotesState,
} from './model';
import {BlockNotesPanel} from './BlockNotesPanel';

export const blockNotesApp: AppDefinition<BlockNotesState> = {
    id: 'block-notes',
    title: 'Block Notes',
    schemaVersion: 1,
    tagKey: 'type',
    schema: blockNotesSchema,
    leafPlugins: [blockRichTextLeafPlugin],
    validateState: validateBlockNotesState,
    initialState: initialBlockNotesState,
    initialTimestamp: initialBlockNotesTimestamp,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <BlockNotesPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const blockNotesCrdtRuntime: CrdtRuntime<BlockNotesState> = {
    docId: BLOCK_NOTES_DOC_ID,
    Provider: ProvideBlockNotes,
    useEditorContext: useBlockNotes,
};

export const blockNotesHistoryRuntime: HistoryRuntime<BlockNotesState> = {
    Provider: ProvideBlockNotesHistory,
    useEditorContext: useBlockNotesHistory,
};
