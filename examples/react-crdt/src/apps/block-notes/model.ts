import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {blockRichTextBuilderExtension} from 'umkehr/block-richtext';
import type {RetainedSelectionSet} from 'umkehr/block-editor';
import type {BlockNotesState} from './schema';

export {
    attachmentStoreFromBlockNotesArtifacts,
    blockNotesArtifactStore,
    saveBlockNotesAttachments,
    BLOCK_NOTES_IMAGE_ARTIFACT_KIND,
    BLOCK_NOTES_IMAGE_ARTIFACT_VERSION,
} from './artifacts';

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

export type BlockNotesSelectionEvent = {
    type: 'selection';
    selection: RetainedSelectionSet;
};

export type BlockNotesEphemeralData = BlockNotesSelectionEvent;

export const blockNotesSelectionKind = 'block-notes:selection';

export const [ProvideBlockNotes, useBlockNotes] = createSyncedContext<
    BlockNotesState,
    'type',
    BlockNotesEphemeralData,
    BlockNotesBuilderExtensions
>(
    'type',
    undefined,
    {
        validateEphemeralData: isBlockNotesEphemeralData,
        maxEphemeralBytes: 16384,
    },
    {builderExtensions: [blockRichTextBuilderExtension]},
);

export function selectionMessage({
    actor,
    selection,
}: {
    actor: string;
    selection: RetainedSelectionSet;
}) {
    return {
        kind: blockNotesSelectionKind,
        id: selectionMessageId(actor),
        actor,
        path: [{type: 'key' as const, key: 'body'}],
        data: {type: 'selection' as const, selection},
    };
}

export function clearSelectionMessage(actor: string) {
    return {
        kind: blockNotesSelectionKind,
        id: selectionMessageId(actor),
        actor,
        path: [{type: 'key' as const, key: 'body'}],
        clear: true,
        data: {type: 'selection' as const, selection: emptySelectionData()},
    };
}

export function selectionMessageId(actor: string) {
    return `${blockNotesSelectionKind}:${actor}`;
}

export function isBlockNotesEphemeralData(input: unknown): input is BlockNotesEphemeralData {
    if (!isRecord(input) || input.type !== 'selection') return false;
    const selection = input.selection;
    return (
        isRecord(selection) &&
        typeof selection.primaryId === 'string' &&
        Array.isArray(selection.entries)
    );
}

function emptySelectionData(): RetainedSelectionSet {
    return {primaryId: '', entries: []};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
