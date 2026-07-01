import {useCallback, useEffect, useState} from 'react';

export type AppMode = 'solo' | 'local' | 'peerjs' | 'local-first' | 'server';

export type UrlSelection = {
    mode: AppMode;
    appId: string;
    docId?: string;
};

export function useUrlSelection(defaultAppId = 'todos'): [
    UrlSelection,
    (mode: AppMode) => void,
    (appId: string) => void,
    (docId: string) => void,
] {
    const [selection, setSelectionState] = useState<UrlSelection>(() =>
        readUrlSelection(defaultAppId),
    );

    useEffect(() => {
        const onPopState = () => setSelectionState(readUrlSelection(defaultAppId));
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [defaultAppId]);

    const writeSelection = useCallback(
        (next: UrlSelection) => {
            const href = urlForSelection(window.location.href, next, defaultAppId);
            window.history.pushState(window.history.state, '', href);
            setSelectionState(readUrlSelection(defaultAppId));
        },
        [defaultAppId],
    );

    const setMode = useCallback(
        (mode: AppMode) => {
            writeSelection({...readUrlSelection(defaultAppId), mode});
        },
        [defaultAppId, writeSelection],
    );

    const setAppId = useCallback(
        (appId: string) => {
            const current = readUrlSelection(defaultAppId);
            writeSelection({mode: current.mode, appId});
        },
        [defaultAppId, writeSelection],
    );

    const setDocId = useCallback(
        (docId: string) => {
            writeSelection({...readUrlSelection(defaultAppId), docId});
        },
        [defaultAppId, writeSelection],
    );

    return [selection, setMode, setAppId, setDocId];
}

export function readUrlSelectionFromSearch(
    search: string,
    defaultAppId: string,
): UrlSelection {
    const params = new URLSearchParams(search);
    const docId = params.get('doc')?.trim() || undefined;
    return {
        mode: parseMode(params.get('mode') ?? ''),
        appId: params.get('app') || defaultAppId,
        ...(docId ? {docId} : {}),
    };
}

export function urlForSelection(
    href: string,
    selection: UrlSelection,
    defaultAppId: string,
) {
    const url = new URL(href);
    if (selection.mode === 'local') url.searchParams.delete('mode');
    else url.searchParams.set('mode', selection.mode);

    if (selection.appId === defaultAppId) url.searchParams.delete('app');
    else url.searchParams.set('app', selection.appId);

    if (selection.docId?.trim()) url.searchParams.set('doc', selection.docId.trim());
    else url.searchParams.delete('doc');

    url.hash = '';
    return `${url.pathname}${url.search}`;
}

export function readActiveDocIdFromSearch(search: string, fallbackDocId: string) {
    return readOptionalActiveDocIdFromSearch(search) ?? fallbackDocId;
}

export function readOptionalActiveDocIdFromSearch(search: string) {
    return new URLSearchParams(search).get('doc')?.trim() || undefined;
}

export function urlWithActiveDocId(href: string, docId: string) {
    const url = new URL(href);
    if (docId.trim()) url.searchParams.set('doc', docId.trim());
    else url.searchParams.delete('doc');
    url.hash = '';
    return `${url.pathname}${url.search}`;
}

function readUrlSelection(defaultAppId: string): UrlSelection {
    return readUrlSelectionFromSearch(window.location.search, defaultAppId);
}

function parseMode(value: string): AppMode {
    if (value === 'solo') return 'solo';
    if (value === 'server') return 'server';
    if (value === 'local-first') return 'local-first';
    if (value === 'peerjs') return 'peerjs';
    return 'local';
}
