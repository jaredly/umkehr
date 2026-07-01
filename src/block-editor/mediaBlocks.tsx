import {useEffect, useRef, useState, type ReactElement} from 'react';

import type {PreviewMetadata, RichBlockMeta} from './blockMeta';
import type {ImageAttachment} from './attachments';
import {
    fetchPreviewMetadata,
    normalizePreviewUrl,
    previewAssetUrl,
    previewDomain,
    type PreviewUrlInvalidReason,
} from './previewMetadata';
import {stopEditorControlEvent} from './editorUiUtils';
import type {BlockEditorCodePreviewRenderer} from './plugins/index.js';

type CodePreviewRenderState =
    | {type: 'empty'}
    | {type: 'loading'}
    | {type: 'rendering'; html: string}
    | {type: 'rendered'; html: string}
    | {type: 'error'; message: string; html?: string};

export function PreviewableCodeBlock({
    blockId,
    renderer,
    source,
    editor,
}: {
    blockId: string;
    renderer: BlockEditorCodePreviewRenderer;
    source: string;
    editor: ReactElement;
}) {
    const [mode, setMode] = useState<'edit' | 'preview' | 'split'>(() =>
        source.trim() === '' ? 'edit' : 'preview',
    );
    const [renderState, setRenderState] = useState<CodePreviewRenderState>({type: 'empty'});
    const renderCounterRef = useRef(0);

    useEffect(() => {
        if (mode === 'edit') return;
        if (source.trim() === '') {
            setRenderState({type: 'empty'});
            return;
        }

        let cancelled = false;
        const renderId = `code-preview-${sanitizeDomId(blockId)}-${++renderCounterRef.current}`;
        setRenderState((current) => {
            const cachedHtml = cachedPreviewHtml(current);
            return cachedHtml ? {type: 'rendering', html: cachedHtml} : {type: 'loading'};
        });

        const render = async () => {
            try {
                const result = await renderer.render(source, renderId);
                if (!cancelled) setRenderState({type: 'rendered', html: result.html});
            } catch (error) {
                if (!cancelled) {
                    setRenderState((current) => {
                        const cachedHtml = cachedPreviewHtml(current);
                        return {
                            type: 'error',
                            message: errorMessage(error),
                            ...(cachedHtml ? {html: cachedHtml} : {}),
                        };
                    });
                }
            }
        };

        void render();
        return () => {
            cancelled = true;
        };
    }, [blockId, mode, renderer, source]);

    return (
        <div className="previewCodeBlock">
            <div className="previewCodeToolbar" contentEditable={false}>
                <button
                    type="button"
                    className="previewCodeModeToggle"
                    aria-pressed={mode === 'edit'}
                    onPointerDown={stopEditorControlEvent}
                    onMouseDown={stopEditorControlEvent}
                    onMouseUp={stopEditorControlEvent}
                    onClick={(event) => {
                        stopEditorControlEvent(event);
                        setMode('edit');
                    }}
                >
                    Edit
                </button>
                <button
                    type="button"
                    className="previewCodeModeToggle"
                    aria-pressed={mode === 'preview'}
                    onPointerDown={stopEditorControlEvent}
                    onMouseDown={stopEditorControlEvent}
                    onMouseUp={stopEditorControlEvent}
                    onClick={(event) => {
                        stopEditorControlEvent(event);
                        setMode('preview');
                    }}
                >
                    Preview
                </button>
                <button
                    type="button"
                    className="previewCodeModeToggle"
                    aria-pressed={mode === 'split'}
                    onPointerDown={stopEditorControlEvent}
                    onMouseDown={stopEditorControlEvent}
                    onMouseUp={stopEditorControlEvent}
                    onClick={(event) => {
                        stopEditorControlEvent(event);
                        setMode('split');
                    }}
                >
                    Split
                </button>
            </div>
            {mode === 'edit' ? (
                editor
            ) : mode === 'split' ? (
                <div className="previewCodeSplit">
                    <div className="previewCodeSplitEditor">{editor}</div>
                    <CodePreview state={renderState} renderer={renderer} />
                </div>
            ) : (
                <CodePreview state={renderState} renderer={renderer} />
            )}
        </div>
    );
}

const cachedPreviewHtml = (state: CodePreviewRenderState): string | undefined => {
    if (state.type === 'rendered' || state.type === 'rendering') return state.html;
    if (state.type === 'error') return state.html;
    return undefined;
};

function CodePreview({
    state,
    renderer,
}: {
    state: CodePreviewRenderState;
    renderer: BlockEditorCodePreviewRenderer;
}) {
    const visualHtml = cachedPreviewHtml(state);
    if (visualHtml) {
        return (
            <div className="codePreview codePreviewVisual" contentEditable={false}>
                <div dangerouslySetInnerHTML={{__html: visualHtml}} />
                {state.type === 'error' ? <div className="codePreviewErrorOverlay">{state.message}</div> : null}
            </div>
        );
    }
    if (state.type === 'error') {
        return (
            <div className="codePreview codePreviewError" contentEditable={false}>
                {state.message}
            </div>
        );
    }
    return (
        <div className="codePreview" contentEditable={false}>
            {state.type === 'loading' ? renderer.loadingLabel : renderer.emptyLabel}
        </div>
    );
}

const sanitizeDomId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '-');

const errorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string') return error;
    return 'Unable to render preview.';
};

type PreviewFetchStatus =
    | {type: 'idle'}
    | {type: 'loading'; url: string}
    | {type: 'failed'; url: string; reason: string};

const PREVIEW_CORS_PROXY = viteEnv().VITE_PREVIEW_CORS_PROXY?.trim() || undefined;

function viteEnv(): Record<string, string | undefined> {
    return (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env ?? {};
}

export function PreviewBlockCard({
    meta,
    subtitle,
    onSetUrl,
    onSetMetadata,
}: {
    meta: Extract<RichBlockMeta, {type: 'preview'}>;
    subtitle: ReactElement;
    onSetUrl(url: string): void;
    onSetMetadata(url: string, metadata: PreviewMetadata | null): void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(meta.url === '');
    const [draft, setDraft] = useState(meta.url);
    const [draftDirty, setDraftDirty] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [invalidReason, setInvalidReason] = useState<string | null>(null);
    const [fetchStatus, setFetchStatus] = useState<PreviewFetchStatus>({type: 'idle'});
    const normalized = normalizePreviewUrl(meta.url);
    const domain = normalized.valid ? normalized.domain : previewDomain(meta.url);
    const normalizedUrl = normalized.valid ? normalized.url : '';

    useEffect(() => {
        if (draftDirty) return;
        setDraft(meta.url);
        setDraftDirty(false);
        setInvalidReason(null);
        setEditing(meta.url === '');
    }, [meta.url]);

    useEffect(() => {
        if (!editing && meta.url === '') return;
        if (!normalized.valid || meta.preview) {
            setFetchStatus({type: 'idle'});
            return;
        }

        const controller = new AbortController();
        setFetchStatus({type: 'loading', url: normalizedUrl});
        void fetchPreviewMetadata(normalizedUrl, {
            signal: controller.signal,
            corsProxy: PREVIEW_CORS_PROXY,
        }).then((result) => {
            if (controller.signal.aborted) return;
            if (result.type === 'loaded') {
                setFetchStatus({type: 'idle'});
                onSetMetadata(result.url, result.metadata);
            } else if (result.type === 'failed') {
                setFetchStatus({type: 'failed', url: result.url, reason: result.reason});
            } else {
                setFetchStatus({type: 'idle'});
            }
        });

        return () => controller.abort();
    }, [editing, meta.preview, meta.url, normalizedUrl]);

    useEffect(() => {
        if (!editing) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const commitDraft = () => {
        const next = normalizePreviewUrl(draft);
        if (!next.valid) {
            setInvalidReason(previewUrlInvalidMessage(next.reason));
            return;
        }
        setInvalidReason(null);
        setEditing(false);
        setDraftDirty(false);
        setMenuOpen(false);
        onSetUrl(next.url);
    };

    const cancelEditing = () => {
        setDraft(meta.url);
        setDraftDirty(false);
        setInvalidReason(null);
        setEditing(meta.url === '');
        setMenuOpen(false);
    };

    const title = meta.preview?.title || meta.url || 'Preview';
    const description = meta.preview?.description;
    const imageUrl = previewAssetUrl(meta.preview?.imageUrl, PREVIEW_CORS_PROXY);
    const loadedUrl = meta.preview?.resolvedUrl || meta.url;
    const isLoading = fetchStatus.type === 'loading' && fetchStatus.url === normalizedUrl;
    const failed = fetchStatus.type === 'failed' && fetchStatus.url === normalizedUrl ? fetchStatus : null;

    return (
        <div className="previewBlock">
            <div className="previewCard" contentEditable={false}>
                {editing ? (
                    <div className="previewUrlEditor">
                        <input
                            ref={inputRef}
                            value={draft}
                            placeholder="https://example.com"
                            aria-label="Preview URL"
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onMouseUp={stopEditorControlEvent}
                            onClick={stopEditorControlEvent}
                            onChange={(event) => {
                                setDraft(event.currentTarget.value);
                                setDraftDirty(true);
                                setInvalidReason(null);
                            }}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitDraft();
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelEditing();
                                }
                            }}
                        />
                        <button
                            type="button"
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onClick={(event) => {
                                stopEditorControlEvent(event);
                                commitDraft();
                            }}
                        >
                            Save
                        </button>
                        {invalidReason ? <span className="previewUrlError">{invalidReason}</span> : null}
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            className="previewMenuButton"
                            aria-label="Preview options"
                            aria-expanded={menuOpen}
                            onPointerDown={stopEditorControlEvent}
                            onMouseDown={stopEditorControlEvent}
                            onClick={(event) => {
                                stopEditorControlEvent(event);
                                setMenuOpen((open) => !open);
                            }}
                        >
                            ...
                        </button>
                        {menuOpen ? (
                            <div
                                className="previewMenu"
                                role="menu"
                                onPointerDown={stopEditorControlEvent}
                                onMouseDown={stopEditorControlEvent}
                                onClick={stopEditorControlEvent}
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(event) => {
                                        stopEditorControlEvent(event);
                                        setDraft(meta.url);
                                        setDraftDirty(false);
                                        setEditing(true);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Edit URL
                                </button>
                            </div>
                        ) : null}
                        <a
                            className="previewCardLink"
                            href={loadedUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={stopEditorControlEvent}
                        >
                            {imageUrl ? (
                                <img className="previewImage" src={imageUrl} alt="" />
                            ) : (
                                <span className="previewImage previewImageFallback">{domain.slice(0, 1).toUpperCase()}</span>
                            )}
                            <span className="previewText">
                                <span className="previewSite">{domain}</span>
                                <strong>{isLoading ? 'Loading preview...' : title}</strong>
                                {description ? <span className="previewDescription">{description}</span> : null}
                                {failed ? <span className="previewDescription">Preview unavailable</span> : null}
                            </span>
                        </a>
                    </>
                )}
            </div>
            <div className="previewSubtitle">{subtitle}</div>
        </div>
    );
}

const previewUrlInvalidMessage = (reason: PreviewUrlInvalidReason): string => {
    switch (reason) {
        case 'empty':
            return 'Enter a URL.';
        case 'unsupported-protocol':
            return 'Use an http or https URL.';
        case 'invalid':
            return 'Enter an absolute URL.';
    }
};

export function ImagePreview({
    attachment,
    attachmentId,
}: {
    attachment: ImageAttachment | null;
    attachmentId: string;
}) {
    if (attachment?.objectUrl) {
        return (
            <img
                className="imagePreview"
                src={attachment.objectUrl}
                alt={attachment.name || 'Uploaded image'}
                width={attachment.width}
                height={attachment.height}
                contentEditable={false}
            />
        );
    }
    return (
        <div className="imageMissing" contentEditable={false}>
            <span>Missing image</span>
            <code>{attachmentId}</code>
        </div>
    );
}
