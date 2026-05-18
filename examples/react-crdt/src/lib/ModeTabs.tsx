import type {AppMode} from './useHashMode';

export function ModeTabs({
    mode,
    setMode,
}: {
    mode: AppMode;
    setMode: (mode: AppMode) => void;
}) {
    return (
        <nav className="modeTabs" aria-label="Demo mode">
            <button
                type="button"
                className={mode === 'solo' ? 'active' : ''}
                onClick={() => setMode('solo')}
            >
                Solo
            </button>
            <button
                type="button"
                className={mode === 'local' ? 'active' : ''}
                onClick={() => setMode('local')}
            >
                Local
            </button>
            <button
                type="button"
                className={mode === 'peerjs' ? 'active' : ''}
                onClick={() => setMode('peerjs')}
            >
                PeerJS
            </button>
            <button
                type="button"
                className={mode === 'local-first' ? 'active' : ''}
                onClick={() => setMode('local-first')}
            >
                Local-first
            </button>
            <button
                type="button"
                className={mode === 'server' ? 'active' : ''}
                onClick={() => setMode('server')}
            >
                Server
            </button>
        </nav>
    );
}
