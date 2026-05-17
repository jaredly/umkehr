import {defaultApp, defaultCrdtRuntime, defaultHistoryRuntime} from './lib/appRegistry';
import {LocalSimulatorApp} from './lib/local/LocalSimulatorApp';
import {ModeTabs} from './lib/ModeTabs';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import {SoloApp} from './lib/solo/SoloApp';
import './style.css';
import {useHashMode} from './lib/useHashMode';

export function App() {
    const [mode, setMode] = useHashMode();

    return (
        <>
            <ModeTabs mode={mode} setMode={setMode} />
            {mode === 'solo' ? (
                <SoloApp app={defaultApp} runtime={defaultHistoryRuntime} />
            ) : mode === 'peerjs' ? (
                <PeerJsApp app={defaultApp} runtime={defaultCrdtRuntime} />
            ) : (
                <LocalSimulatorApp app={defaultApp} runtime={defaultCrdtRuntime} />
            )}
        </>
    );
}
