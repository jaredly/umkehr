import '../../../src/react/test-dom';

import {describe, expect, it, vi} from 'vitest';
import {
    fetchPreviewMetadata,
    normalizePreviewUrl,
    parsePreviewMetadataHtml,
    previewAssetUrl,
    previewFetchUrl,
} from './previewMetadata';

Object.defineProperty(globalThis, 'DOMParser', {
    value: window.DOMParser,
    configurable: true,
});

describe('preview metadata', () => {
    it('accepts absolute http and https URLs', () => {
        expect(normalizePreviewUrl('https://www.example.test/path#section')).toEqual({
            valid: true,
            url: 'https://www.example.test/path',
            domain: 'example.test',
        });
        expect(normalizePreviewUrl('http://example.test')).toMatchObject({
            valid: true,
            url: 'http://example.test/',
            domain: 'example.test',
        });
    });

    it('rejects relative and non-http URLs', () => {
        expect(normalizePreviewUrl('/relative')).toEqual({valid: false, reason: 'invalid'});
        expect(normalizePreviewUrl('example.test')).toEqual({valid: false, reason: 'invalid'});
        expect(normalizePreviewUrl('javascript:alert(1)')).toEqual({
            valid: false,
            reason: 'unsupported-protocol',
        });
    });

    it('parses Open Graph metadata and resolves relative URLs', () => {
        const metadata = parsePreviewMetadataHtml(
            `
                <html>
                    <head>
                        <meta property="og:title" content="OG Title">
                        <meta property="og:description" content="OG Description">
                        <meta property="og:site_name" content="Example">
                        <meta property="og:image" content="/image.png">
                        <meta property="og:url" content="/canonical">
                    </head>
                </html>
            `,
            'https://example.test/post',
            () => 'now',
        );

        expect(metadata).toEqual({
            title: 'OG Title',
            description: 'OG Description',
            siteName: 'Example',
            imageUrl: 'https://example.test/image.png',
            resolvedUrl: 'https://example.test/canonical',
            fetchedAt: 'now',
        });
    });

    it('falls back to the title element', () => {
        expect(
            parsePreviewMetadataHtml('<title>Fallback Title</title>', 'https://example.test', () => 'now'),
        ).toMatchObject({
            title: 'Fallback Title',
            resolvedUrl: 'https://example.test/',
        });
    });

    it('returns failed results without throwing', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('blocked'));

        await expect(fetchPreviewMetadata('https://example.test')).resolves.toEqual({
            type: 'failed',
            url: 'https://example.test/',
            reason: 'blocked',
        });

        fetchMock.mockRestore();
    });

    it('builds proxy fetch URLs from prefixes and templates', () => {
        expect(previewFetchUrl('https://example.test/a b', 'https://proxy.test/raw?url=')).toBe(
            'https://proxy.test/raw?url=https%3A%2F%2Fexample.test%2Fa%20b',
        );
        expect(previewFetchUrl('https://example.test/a', 'https://proxy.test/{url}/raw')).toBe(
            'https://proxy.test/https%3A%2F%2Fexample.test%2Fa/raw',
        );
    });

    it('routes absolute preview asset URLs through the proxy', () => {
        expect(previewAssetUrl('https://cdn.example.test/image.png', 'https://proxy.test/raw?url=')).toBe(
            'https://proxy.test/raw?url=https%3A%2F%2Fcdn.example.test%2Fimage.png',
        );
        expect(previewAssetUrl('/relative-image.png', 'https://proxy.test/raw?url=')).toBe('/relative-image.png');
        expect(previewAssetUrl(undefined, 'https://proxy.test/raw?url=')).toBeUndefined();
    });

    it('fetches through the configured proxy while preserving source URL metadata', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response('<title>Proxied</title>', {status: 200}),
        );

        await expect(
            fetchPreviewMetadata('https://example.test/page', {
                corsProxy: 'https://proxy.test/raw?url=',
                now: () => 'now',
            }),
        ).resolves.toEqual({
            type: 'loaded',
            url: 'https://example.test/page',
            metadata: {
                title: 'Proxied',
                resolvedUrl: 'https://example.test/page',
                fetchedAt: 'now',
            },
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://proxy.test/raw?url=https%3A%2F%2Fexample.test%2Fpage',
            {signal: undefined},
        );

        fetchMock.mockRestore();
    });
});
