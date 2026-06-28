import {describe, expect, it} from 'vitest';
import type {AttachmentStore} from 'umkehr/block-editor';
import {serializedArtifactsForStore} from '../../lib/artifacts';
import {
    BLOCK_NOTES_IMAGE_ARTIFACT_KIND,
    blockNotesArtifactStore,
    clearSelectionMessage,
    isBlockNotesEphemeralData,
    saveBlockNotesAttachments,
    selectionMessage,
} from './model';

describe('block notes artifacts', () => {
    it('serializes image attachments outside the CRDT document', () => {
        const attachments: AttachmentStore = new Map([
            [
                'image-1',
                {
                    id: 'image-1',
                    objectUrl: 'blob:image-1',
                    name: 'image.png',
                    mimeType: 'image/png',
                    bytes: 'data:image/png;base64,AAAA',
                },
            ],
        ]);

        saveBlockNotesAttachments(attachments);
        const artifacts = serializedArtifactsForStore(blockNotesArtifactStore);

        expect(artifacts).toHaveLength(1);
        expect(artifacts[0]).toMatchObject({
            id: 'image-1',
            kind: BLOCK_NOTES_IMAGE_ARTIFACT_KIND,
            version: 1,
            data: {
                id: 'image-1',
                dataUrl: 'data:image/png;base64,AAAA',
            },
        });

        saveBlockNotesAttachments(new Map());
    });
});

describe('block notes selection presence', () => {
    it('validates selection messages and clear messages', () => {
        const message = selectionMessage({
            actor: 'ada',
            selection: {primaryId: 'sel-1', entries: []},
        });
        const clear = clearSelectionMessage('ada');

        expect(isBlockNotesEphemeralData(message.data)).toBe(true);
        expect(isBlockNotesEphemeralData(clear.data)).toBe(true);
        expect(isBlockNotesEphemeralData({type: 'selection', selection: {entries: []}})).toBe(
            false,
        );
    });
});
