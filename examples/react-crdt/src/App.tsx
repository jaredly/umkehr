import {defaultApp} from './lib/appRegistry';
import {LocalSimulatorApp} from './lib/local/LocalSimulatorApp';
import {ModeTabs} from './lib/ModeTabs';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import './style.css';
import {useHashMode} from './lib/useHashMode';

export function App() {
    const [mode, setMode] = useHashMode();

    return (
        <>
            <ModeTabs mode={mode} setMode={setMode} />
            {mode === 'peerjs' ? (
                <PeerJsApp app={defaultApp} />
            ) : (
                <LocalSimulatorApp app={defaultApp} />
            )}
        </>
    );
}
