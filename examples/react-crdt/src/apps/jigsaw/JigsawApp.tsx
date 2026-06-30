import type {AppDefinition, CrdtRuntime, HistoryRuntime} from '../../lib/crdtApp';
import {
    initialJigsawState,
    initialJigsawTimestamp,
    initialJigsawArtifacts,
    isJigsawImageArtifact,
    isJigsawPieceCount,
    JIGSAW_DOC_ID,
    jigsawArtifactStore,
    jigsawSchema,
    ProvideJigsaw,
    ProvideJigsawHistory,
    useJigsaw,
    useJigsawHistory,
    validateJigsawState,
    type JigsawEphemeralData,
    type JigsawGenerationType,
    type JigsawImageArtifact,
    type JigsawPieceCount,
    type JigsawState,
} from './model';
import {JigsawPanel} from './JigsawPanel';
import type {ChangeEvent} from 'react';

type JigsawDocumentInitParams = {
    pieceCount: JigsawPieceCount;
    type: JigsawGenerationType;
    image?: JigsawImageArtifact;
    imageStatus?: JigsawImageStatus;
    imageError?: string;
};

type JigsawImageStatus = 'idle' | 'loading' | 'ready' | 'error';

const maxJigsawUploadBytes = 20 * 1024 * 1024;
const maxProcessedImageEdge = 720;
const processedImageQuality = 0.78;

export const jigsawApp: AppDefinition<JigsawState, JigsawEphemeralData> = {
    id: 'jigsaw',
    title: 'Jigsaw',
    schemaVersion: 1,
    tagKey: 'type',
    schema: jigsawSchema,
    validateState: validateJigsawState,
    initialState: initialJigsawState,
    initialTimestamp: initialJigsawTimestamp,
    artifacts: jigsawArtifactStore,
    documentInit: {
        required: true,
        defaultParams() {
            return {pieceCount: 12, type: 'rectangular', imageStatus: 'idle'};
        },
        renderFields({value, onChange}) {
            const imageLoading = value.imageStatus === 'loading';
            const updateImage = (event: ChangeEvent<HTMLInputElement>) => {
                const file = event.currentTarget.files?.[0];
                if (!file) {
                    onChange({...value, image: undefined, imageStatus: 'idle', imageError: undefined});
                    return;
                }
                if (file.size > maxJigsawUploadBytes) {
                    onChange({
                        ...value,
                        image: undefined,
                        imageStatus: 'error',
                        imageError: 'Choose an image smaller than 20 MB.',
                    });
                    return;
                }
                onChange({...value, image: undefined, imageStatus: 'loading', imageError: undefined});
                void processJigsawImageFile(file).then(
                    (image) => onChange({...value, image, imageStatus: 'ready', imageError: undefined}),
                    (error) =>
                        onChange({
                            ...value,
                            image: undefined,
                            imageStatus: 'error',
                            imageError: errorMessage(error),
                        }),
                );
            };
            return (
                <>
                    <label className="documentCreateField">
                        <span>Number of pieces</span>
                        <select
                            value={value.pieceCount}
                            disabled={imageLoading}
                            onChange={(event) =>
                                onChange({
                                    ...value,
                                    pieceCount: Number(event.currentTarget.value) as JigsawPieceCount,
                                })
                            }
                        >
                            <option value={12}>12</option>
                            <option value={30}>30</option>
                            <option value={60}>60</option>
                            <option value={120}>120</option>
                            <option value={600}>600</option>
                        </select>
                    </label>
                    <label className="documentCreateField">
                        <span>Board type</span>
                        <select
                            value={value.type}
                            disabled={imageLoading}
                            onChange={(event) =>
                                onChange({
                                    ...value,
                                    type: event.currentTarget.value as JigsawGenerationType,
                                })
                            }
                        >
                            <option value="rectangular">Rectangular</option>
                            <option value="voronoi">Voronoi</option>
                        </select>
                    </label>
                    <label className="documentCreateField documentCreateFieldWide">
                        <span>Image</span>
                        <input type="file" accept="image/*" onChange={updateImage} />
                        {value.imageStatus === 'loading' ? (
                            <small>Processing image...</small>
                        ) : value.imageStatus === 'error' ? (
                            <small>{value.imageError ?? 'Could not use that image.'}</small>
                        ) : value.image ? (
                            <small>{value.image.originalName ?? 'Custom image ready'}</small>
                        ) : (
                            <small>Optional</small>
                        )}
                    </label>
                </>
            );
        },
        validate(input): {success: true; data: JigsawDocumentInitParams} | {success: false; message: string} {
            if (
                typeof input === 'object' &&
                input !== null &&
                (input as {imageStatus?: unknown}).imageStatus === 'loading'
            ) {
                return {success: false, message: 'Wait for the image to finish processing.'};
            }
            if (
                typeof input === 'object' &&
                input !== null &&
                (input as {imageStatus?: unknown}).imageStatus === 'error'
            ) {
                return {
                    success: false,
                    message:
                        typeof (input as {imageError?: unknown}).imageError === 'string'
                            ? (input as {imageError: string}).imageError
                            : 'Choose a valid image.',
                };
            }
            if (
                typeof input === 'object' &&
                input !== null &&
                (input as {image?: unknown}).image !== undefined &&
                !isJigsawImageArtifact((input as {image?: unknown}).image)
            ) {
                return {success: false, message: 'Choose a valid image.'};
            }
            if (
                typeof input === 'object' &&
                input !== null &&
                isJigsawPieceCount((input as {pieceCount?: unknown}).pieceCount) &&
                ((input as {type?: unknown}).type === undefined ||
                    isJigsawGenerationType((input as {type?: unknown}).type))
            ) {
                return {
                    success: true,
                    data: {
                        pieceCount: (input as JigsawDocumentInitParams).pieceCount,
                        type: ((input as {type?: JigsawGenerationType}).type ?? 'rectangular'),
                        ...(((input as {image?: unknown}).image !== undefined &&
                        isJigsawImageArtifact((input as {image?: unknown}).image))
                            ? {image: (input as {image: JigsawImageArtifact}).image}
                            : {}),
                        imageStatus: ((input as {imageStatus?: JigsawImageStatus}).imageStatus ?? 'idle'),
                    },
                };
            }
            return {success: false, message: 'Choose a valid jigsaw board type and piece count.'};
        },
        initialState() {
            return initialJigsawState;
        },
        initialArtifacts(params) {
            return initialJigsawArtifacts(params.pieceCount, {
                type: params.type,
                imageArtifact: params.image,
            });
        },
    },
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <JigsawPanel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

function isJigsawGenerationType(input: unknown): input is JigsawGenerationType {
    return input === 'rectangular' || input === 'voronoi';
}

async function processJigsawImageFile(file: File): Promise<JigsawImageArtifact> {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const size = fitImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not process that image.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size.width, size.height);
    const encoded = encodeCanvas(canvas);
    return {
        id: 'image',
        mimeType: encoded.mimeType,
        dataUrl: encoded.dataUrl,
        width: size.width,
        height: size.height,
        originalName: normalizedFileName(file.name),
    };
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Could not read that image.'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Could not read that image.'));
        reader.readAsDataURL(file);
    });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode that image.'));
        image.src = dataUrl;
    });
}

function fitImageSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Could not decode that image.');
    }
    const scale = Math.min(1, maxProcessedImageEdge / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function encodeCanvas(canvas: HTMLCanvasElement): {mimeType: 'image/webp' | 'image/jpeg'; dataUrl: string} {
    const webp = canvas.toDataURL('image/webp', processedImageQuality);
    if (webp.startsWith('data:image/webp;base64,')) return {mimeType: 'image/webp', dataUrl: webp};
    return {
        mimeType: 'image/jpeg',
        dataUrl: canvas.toDataURL('image/jpeg', processedImageQuality),
    };
}

function normalizedFileName(name: string) {
    const clean = name.split(/[\\/]/).pop()?.trim();
    return clean || undefined;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Could not use that image.';
}

export const jigsawCrdtRuntime: CrdtRuntime<JigsawState, JigsawEphemeralData> = {
    docId: JIGSAW_DOC_ID,
    Provider: ProvideJigsaw,
    useEditorContext: useJigsaw,
};

export const jigsawHistoryRuntime: HistoryRuntime<JigsawState> = {
    Provider: ProvideJigsawHistory,
    useEditorContext: useJigsawHistory,
};
