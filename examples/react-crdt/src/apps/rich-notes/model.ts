import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {richTextBuilderExtension} from 'umkehr/richtext';
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
export type RichNotesBuilderExtensions = [typeof richTextBuilderExtension];
export const [ProvideRichNotes, useRichNotes] = createSyncedContext<
    RichNotesState,
    'type',
    never,
    RichNotesBuilderExtensions
>('type', undefined, undefined, {builderExtensions: [richTextBuilderExtension]});
