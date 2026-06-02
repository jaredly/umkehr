import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import type {RichNotesState} from './schema';

export {
    RICH_NOTES_DOC_ID,
    initialRichNotesState,
    initialRichNotesTimestamp,
    richNotesSchema,
    validateRichNotesState,
    type RichNote,
    type RichNotesState,
} from './schema';

export const [ProvideRichNotesHistory, useRichNotesHistory] = createHistoryContext<
    RichNotesState,
    never,
    'type'
>('type');
export const [ProvideRichNotes, useRichNotes] = createSyncedContext<RichNotesState>('type');
