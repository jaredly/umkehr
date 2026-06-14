import type {IValidation} from 'typia';
import typia from 'typia';
import {hlc} from 'umkehr/crdt';
import {richText, type RichCollaborativeText} from 'umkehr/richtext';

export type RichNote = {
    id: string;
    body: RichCollaborativeText;
    createdAt: string;
    updatedAt: string;
    archived: boolean;
};

export type RichNotesState = {
    notes: Record<string, RichNote>;
};

export const RICH_NOTES_DOC_ID = 'umkehr-react-crdt-rich-notes-v1';
export const richNotesSchema = typia.json.schemas<[RichNotesState], '3.1'>();
export const validateRichNotesState: (input: unknown) => IValidation<RichNotesState> =
    typia.createValidate<RichNotesState>();

const createdAt = '2026-01-01T00:00:00.000Z';

export const initialRichNotesState: RichNotesState = {
    notes: {
        welcome: {
            id: 'welcome',
            body: richText(),
            createdAt,
            updatedAt: createdAt,
            archived: false,
        },
    },
};

export const initialRichNotesTimestamp = hlc.pack(hlc.init('seed', 0));
