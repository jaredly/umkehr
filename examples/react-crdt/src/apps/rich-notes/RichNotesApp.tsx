import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {richTextLeafPlugin} from 'umkehr/richtext';
import {
    initialRichNotesState,
    initialRichNotesTimestamp,
    ProvideRichNotes,
    ProvideRichNotesHistory,
    RICH_NOTES_DOC_ID,
    richNotesSchema,
    useRichNotes,
    useRichNotesHistory,
    validateRichNotesState,
    type RichNotesState,
} from './model';
import {RichNotesPanel} from './RichNotesPanel';

export const richNotesApp: AppDefinition<RichNotesState> = {
    id: 'rich-notes',
    title: 'Rich Notes',
    schemaVersion: 1,
    tagKey: 'type',
    schema: richNotesSchema,
    leafPlugins: [richTextLeafPlugin],
    validateState: validateRichNotesState,
    initialState: initialRichNotesState,
    initialTimestamp: initialRichNotesTimestamp,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <RichNotesPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const richNotesCrdtRuntime: CrdtRuntime<RichNotesState> = {
    docId: RICH_NOTES_DOC_ID,
    Provider: ProvideRichNotes,
    useEditorContext: useRichNotes,
};

export const richNotesHistoryRuntime: HistoryRuntime<RichNotesState> = {
    Provider: ProvideRichNotesHistory,
    useEditorContext: useRichNotesHistory,
};
