import type {IValidation} from 'typia';
import typia from 'typia';
import {hlc} from 'umkehr/crdt';
import {blockRichText, type BlockRichText} from 'umkehr/block-richtext';

export type BlockNotesState = {
    body: BlockRichText;
    updatedAt: string;
};

export const BLOCK_NOTES_DOC_ID = 'umkehr-react-crdt-block-notes-v1';
export const blockNotesSchema = typia.json.schemas<[BlockNotesState], '3.1'>();
export const validateBlockNotesState: (input: unknown) => IValidation<BlockNotesState> =
    typia.createValidate<BlockNotesState>();

const createdAt = '2026-01-01T00:00:00.000Z';

export const initialBlockNotesState: BlockNotesState = {
    body: blockRichText(),
    updatedAt: createdAt,
};

export const initialBlockNotesTimestamp = hlc.pack(hlc.init('seed', 0));
