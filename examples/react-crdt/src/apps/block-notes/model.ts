import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
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
export const [ProvideBlockNotes, useBlockNotes] = createSyncedContext<BlockNotesState>('type');
