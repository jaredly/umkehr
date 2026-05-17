import {LocalSimulatorApp} from './LocalSimulatorApp';
import {ModeTabs} from './ModeTabs';
import {PeerJsApp} from './PeerJsApp';
import './style.css';
import {useHashMode} from './useHashMode';

export function App() {
    const [mode, setMode] = useHashMode();

    return (
        <>
            <ModeTabs mode={mode} setMode={setMode} />
            {mode === 'peerjs' ? <PeerJsApp /> : <LocalSimulatorApp />}
        </>
    );
}
