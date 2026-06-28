import {
    deserializeAttachments,
    isSerializedImageAttachment,
    serializeAttachments,
    type AttachmentStore,
    type SerializedImageAttachment,
} from 'umkehr/block-editor';
import {
    artifactFingerprintHash,
    type ArtifactManifestEntry,
    type ArtifactStore,
    type SerializedArtifact,
} from '../../lib/artifacts';

export const BLOCK_NOTES_IMAGE_ARTIFACT_KIND = 'block-notes-image';
export const BLOCK_NOTES_IMAGE_ARTIFACT_VERSION = 1;

const loadedAttachments = new Map<string, SerializedImageAttachment>();

export const blockNotesArtifactStore: ArtifactStore<SerializedImageAttachment> = {
    get(id) {
        return loadedAttachments.get(id) ?? null;
    },
    serialize(id) {
        const attachment = loadedAttachments.get(id);
        return attachment ? serializeAttachmentArtifact(attachment) : null;
    },
    load(artifact) {
        if (
            artifact.kind !== BLOCK_NOTES_IMAGE_ARTIFACT_KIND ||
            artifact.version !== BLOCK_NOTES_IMAGE_ARTIFACT_VERSION ||
            !isSerializedImageAttachment(artifact.data)
        ) {
            return;
        }
        if (artifact.fingerprintHash !== artifactFingerprintHash(artifact.data)) return;
        loadedAttachments.set(artifact.data.id, artifact.data);
    },
    manifest() {
        return Array.from(loadedAttachments.values()).map(manifestForAttachment);
    },
};

export function attachmentStoreFromBlockNotesArtifacts(): AttachmentStore {
    return deserializeAttachments(Array.from(loadedAttachments.values()));
}

export function saveBlockNotesAttachments(attachments: AttachmentStore) {
    loadedAttachments.clear();
    for (const attachment of serializeAttachments(attachments)) {
        loadedAttachments.set(attachment.id, attachment);
    }
}

function serializeAttachmentArtifact(attachment: SerializedImageAttachment): SerializedArtifact {
    return {
        ...manifestForAttachment(attachment),
        data: attachment,
    };
}

function manifestForAttachment(attachment: SerializedImageAttachment): ArtifactManifestEntry {
    return {
        id: attachment.id,
        kind: BLOCK_NOTES_IMAGE_ARTIFACT_KIND,
        version: BLOCK_NOTES_IMAGE_ARTIFACT_VERSION,
        fingerprintHash: artifactFingerprintHash(attachment),
    };
}
