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
        </nav>
    );
}
