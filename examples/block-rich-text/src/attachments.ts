export type ImageAttachmentStatus = 'local' | 'uploading' | 'uploaded' | 'failed';

export type ImageAttachment = {
    id: string;
    objectUrl: string;
    file?: File;
    name?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    uploadStatus?: ImageAttachmentStatus;
    bytes?: string;
};

export type AttachmentStore = Map<string, ImageAttachment>;

export type SerializedImageAttachment = {
    id: string;
    name?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    uploadStatus?: ImageAttachmentStatus;
    dataUrl?: string;
};

export const createAttachmentFromFile = async (file: File): Promise<ImageAttachment> => {
    const id = randomAttachmentId();
    const objectUrl = URL.createObjectURL(file);
    const dimensions = await imageDimensions(objectUrl).catch(() => ({}));
    const bytes = await fileToDataUrl(file).catch(() => undefined);
    return {
        id,
        file,
        objectUrl,
        name: file.name,
        mimeType: file.type,
        uploadStatus: 'local',
        bytes,
        ...dimensions,
    };
};

export const serializeAttachments = (attachments: AttachmentStore): SerializedImageAttachment[] =>
    Array.from(attachments.values()).map((attachment) => ({
        id: attachment.id,
        ...(attachment.name ? {name: attachment.name} : {}),
        ...(attachment.mimeType ? {mimeType: attachment.mimeType} : {}),
        ...(attachment.width ? {width: attachment.width} : {}),
        ...(attachment.height ? {height: attachment.height} : {}),
        ...(attachment.uploadStatus ? {uploadStatus: attachment.uploadStatus} : {}),
        ...(attachment.bytes ? {dataUrl: attachment.bytes} : {}),
    }));

export const deserializeAttachments = (
    serialized: SerializedImageAttachment[],
): AttachmentStore => {
    const attachments: AttachmentStore = new Map();
    for (const item of serialized) {
        const objectUrl = item.dataUrl ? dataUrlToObjectUrl(item.dataUrl) : '';
        attachments.set(item.id, {
            id: item.id,
            objectUrl,
            ...(item.name ? {name: item.name} : {}),
            ...(item.mimeType ? {mimeType: item.mimeType} : {}),
            ...(item.width ? {width: item.width} : {}),
            ...(item.height ? {height: item.height} : {}),
            ...(item.uploadStatus ? {uploadStatus: item.uploadStatus} : {}),
            ...(item.dataUrl ? {bytes: item.dataUrl} : {}),
        });
    }
    return attachments;
};

export const cloneSerializedAttachment = (
    attachment: SerializedImageAttachment,
): SerializedImageAttachment => ({
    ...attachment,
    id: randomAttachmentId(),
});

export const revokeAttachments = (attachments: AttachmentStore) => {
    for (const attachment of attachments.values()) {
        if (attachment.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.objectUrl);
    }
};

export const isSerializedImageAttachment = (value: unknown): value is SerializedImageAttachment => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false;
    if (value.name !== undefined && typeof value.name !== 'string') return false;
    if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false;
    if (value.width !== undefined && typeof value.width !== 'number') return false;
    if (value.height !== undefined && typeof value.height !== 'number') return false;
    if (
        value.uploadStatus !== undefined &&
        value.uploadStatus !== 'local' &&
        value.uploadStatus !== 'uploading' &&
        value.uploadStatus !== 'uploaded' &&
        value.uploadStatus !== 'failed'
    ) {
        return false;
    }
    return value.dataUrl === undefined || typeof value.dataUrl === 'string';
};

const randomAttachmentId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('invalid file result'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
        reader.readAsDataURL(file);
    });

const imageDimensions = (src: string): Promise<{width?: number; height?: number}> =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});
        image.onerror = () => reject(new Error('image load failed'));
        image.src = src;
    });

const dataUrlToObjectUrl = (dataUrl: string): string => {
    const [header, data] = dataUrl.split(',', 2);
    if (!header || data === undefined) return dataUrl;
    const mime = /^data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], {type: mime}));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
