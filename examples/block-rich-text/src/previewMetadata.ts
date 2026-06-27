import type {PreviewMetadata} from './blockMeta';

export type PreviewUrlInvalidReason = 'empty' | 'invalid' | 'unsupported-protocol';

export type PreviewUrlValidation =
    | {valid: true; url: string; domain: string}
    | {valid: false; reason: PreviewUrlInvalidReason};

export type PreviewMetadataResult =
    | {type: 'loaded'; url: string; metadata: PreviewMetadata}
    | {type: 'failed'; url: string; reason: string}
    | {type: 'invalid'; reason: PreviewUrlInvalidReason};

export const normalizePreviewUrl = (value: string): PreviewUrlValidation => {
    const trimmed = value.trim();
    if (!trimmed) return {valid: false, reason: 'empty'};

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return {valid: false, reason: 'invalid'};
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {valid: false, reason: 'unsupported-protocol'};
    }

    parsed.hash = '';
    return {valid: true, url: parsed.toString(), domain: parsed.hostname.replace(/^www\./i, '')};
};

export const fetchPreviewMetadata = async (
    url: string,
    options: {signal?: AbortSignal; now?: () => string; corsProxy?: string} = {},
): Promise<PreviewMetadataResult> => {
    const normalized = normalizePreviewUrl(url);
    if (!normalized.valid) return {type: 'invalid', reason: normalized.reason};

    try {
        const response = await fetch(previewFetchUrl(normalized.url, options.corsProxy), {signal: options.signal});
        if (!response.ok) {
            return {type: 'failed', url: normalized.url, reason: `HTTP ${response.status}`};
        }
        const html = await response.text();
        const metadata = parsePreviewMetadataHtml(html, normalized.url, options.now);
        return {type: 'loaded', url: normalized.url, metadata};
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return {type: 'failed', url: normalized.url, reason: 'aborted'};
        }
        return {
            type: 'failed',
            url: normalized.url,
            reason: error instanceof Error ? error.message : 'Fetch failed',
        };
    }
};

export const previewFetchUrl = (url: string, corsProxy?: string): string => {
    const proxy = corsProxy?.trim();
    if (!proxy) return url;
    if (proxy.includes('{url}')) return proxy.replaceAll('{url}', encodeURIComponent(url));
    return `${proxy}${encodeURIComponent(url)}`;
};

export const previewAssetUrl = (url: string | undefined, corsProxy?: string): string | undefined => {
    if (!url) return undefined;
    return normalizePreviewUrl(url).valid ? previewFetchUrl(url, corsProxy) : url;
};

export const parsePreviewMetadataHtml = (
    html: string,
    sourceUrl: string,
    now: () => string = () => new Date().toISOString(),
): PreviewMetadata => {
    const Parser =
        typeof DOMParser !== 'undefined'
            ? DOMParser
            : typeof window !== 'undefined'
              ? window.DOMParser
              : null;
    if (!Parser) {
        return {resolvedUrl: resolveUrl(sourceUrl, sourceUrl), fetchedAt: now()};
    }
    const document = new Parser().parseFromString(html, 'text/html');
    const title = firstMetaContent(document, ['og:title', 'twitter:title']) ?? textContent(document.querySelector('title'));
    const description = firstMetaContent(document, ['og:description', 'twitter:description', 'description']);
    const siteName = firstMetaContent(document, ['og:site_name', 'application-name']);
    const image = firstMetaContent(document, ['og:image', 'og:image:url', 'twitter:image']);
    const resolvedUrl = firstMetaContent(document, ['og:url']) ?? sourceUrl;

    return stripEmpty({
        title,
        description,
        siteName,
        imageUrl: image ? resolveUrl(image, sourceUrl) : undefined,
        resolvedUrl: resolveUrl(resolvedUrl, sourceUrl),
        fetchedAt: now(),
    });
};

export const previewDomain = (url: string): string => {
    const normalized = normalizePreviewUrl(url);
    return normalized.valid ? normalized.domain : url;
};

const firstMetaContent = (document: Document, names: string[]): string | undefined => {
    for (const name of names) {
        const escaped = cssEscape(name);
        const element = document.querySelector<HTMLMetaElement>(
            `meta[property="${escaped}"], meta[name="${escaped}"]`,
        );
        const content = normalizeText(element?.content ?? '');
        if (content) return content;
    }
    return undefined;
};

const textContent = (element: Element | null): string | undefined => normalizeText(element?.textContent ?? '');

const normalizeText = (value: string): string | undefined => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
};

const resolveUrl = (value: string, base: string): string | undefined => {
    try {
        return new URL(value, base).toString();
    } catch {
        return undefined;
    }
};

const stripEmpty = (metadata: PreviewMetadata): PreviewMetadata => {
    const result: PreviewMetadata = {};
    for (const [key, value] of Object.entries(metadata) as Array<
        [keyof PreviewMetadata, string | undefined]
    >) {
        if (value) result[key] = value;
    }
    return result;
};

const cssEscape = (value: string): string => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
};
