import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {blockRichTextBuilderExtension} from 'umkehr/block-richtext';
import type {BlockNotesState} from './schema';

export {
    BLOCK_NOTES_DOC_ID,
    blockNotesSchema,
    initialBlockNotesState,
    initialBlockNotesTimestamp,
    validateBlockNotesState,
    type BlockNotesState,
} from './schema';

export const [ProvideBlockNotesHistory, useBlockNotesHistory] = createHistoryContext<
    BlockNotesState,
    never,
    'type'
>('type');
export type BlockNotesBuilderExtensions = [typeof blockRichTextBuilderExtension];
export const [ProvideBlockNotes, useBlockNotes] = createSyncedContext<
    BlockNotesState,
    'type',
    never,
    BlockNotesBuilderExtensions
>('type', undefined, undefined, {builderExtensions: [blockRichTextBuilderExtension]});
