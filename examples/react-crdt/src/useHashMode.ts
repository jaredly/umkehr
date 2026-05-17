import {useCallback, useEffect, useState} from 'react';

export type AppMode = 'local' | 'peerjs';

export function useHashMode(): [AppMode, (mode: AppMode) => void] {
    const [mode, setModeState] = useState<AppMode>(() => readHashMode());

    useEffect(() => {
        const onHashChange = () => setModeState(readHashMode());
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    const setMode = useCallback((next: AppMode) => {
        window.location.hash = next;
        setModeState(next);
    }, []);

    return [mode, setMode];
}

function readHashMode(): AppMode {
    return window.location.hash === '#peerjs' ? 'peerjs' : 'local';
}
