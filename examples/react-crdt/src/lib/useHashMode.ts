import {useCallback, useEffect, useState} from 'react';

export type AppMode = 'solo' | 'local' | 'peerjs' | 'local-first' | 'server';

export type HashSelection = {
    mode: AppMode;
    appId: string;
};

export function useHashMode(defaultAppId = 'todos'): [
    HashSelection,
    (mode: AppMode) => void,
    (appId: string) => void,
] {
    const [selection, setSelectionState] = useState<HashSelection>(() =>
        readHashSelection(defaultAppId),
    );

    useEffect(() => {
        const onHashChange = () => setSelectionState(readHashSelection(defaultAppId));
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [defaultAppId]);

    const setMode = useCallback((next: AppMode) => {
        const current = readHashSelection(defaultAppId);
        writeHashSelection({...current, mode: next}, defaultAppId);
        setSelectionState({...current, mode: next});
    }, [defaultAppId]);

    const setAppId = useCallback((next: string) => {
        const current = readHashSelection(defaultAppId);
        writeHashSelection({...current, appId: next}, defaultAppId);
        setSelectionState({...current, appId: next});
    }, [defaultAppId]);

    return [selection, setMode, setAppId];
}

function writeHashSelection(selection: HashSelection, defaultAppId: string) {
    window.location.hash = hashForSelection(selection, defaultAppId);
}

export function hashForSelection(selection: HashSelection, defaultAppId: string) {
    const params = new URLSearchParams();
    if (selection.mode !== 'local') params.set('mode', selection.mode);
    if (selection.appId !== defaultAppId) params.set('app', selection.appId);
    const next = params.toString();
    return next ? `#${next}` : '';
}

function readHashSelection(defaultAppId: string): HashSelection {
    return readHashSelectionFromHash(window.location.hash, defaultAppId);
}

export function readHashSelectionFromHash(hash: string, defaultAppId: string): HashSelection {
    const raw = hash.replace(/^#/, '');
    if (!raw) return {mode: 'local', appId: defaultAppId};

    if (!raw.includes('=') && !raw.includes('&')) {
        return {mode: parseMode(raw), appId: defaultAppId};
    }

    const params = new URLSearchParams(raw);
    return {
        mode: parseMode(params.get('mode') ?? ''),
        appId: params.get('app') || defaultAppId,
    };
}

function parseMode(value: string): AppMode {
    if (value === 'solo') return 'solo';
    if (value === 'server') return 'server';
    if (value === 'local-first') return 'local-first';
    if (value === 'peerjs') return 'peerjs';
    return 'local';
}

export function useLegacyHashMode(): [AppMode, (mode: AppMode) => void] {
    const [selection, setMode] = useHashMode();
    return [selection.mode, setMode];
}

export function readHashMode(): AppMode {
    return parseMode(window.location.hash.replace(/^#/, ''));
}

export function writeHashMode(mode: AppMode) {
    window.location.hash = mode === 'local' ? '' : mode;
}
