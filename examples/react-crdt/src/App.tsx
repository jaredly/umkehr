import {apps, defaultApp, registeredAppForId} from './lib/appRegistry';
import {DemoTopBar} from './lib/chrome/DemoTopBar';
import {TopBarProvider} from './lib/chrome/TopBarContext';
import {LocalSimulatorApp} from './lib/local/LocalSimulatorApp';
import {LocalFirstApp} from './lib/local-first/LocalFirstApp';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import {ServerApp} from './lib/server/ServerApp';
import {SoloApp} from './lib/solo/SoloApp';
import './style.css';
import {useUrlSelection} from './lib/useUrlSelection';

export function App() {
    const [{mode, appId}, setMode, setAppId] = useUrlSelection(defaultApp.id);
    const registered = registeredAppForId(appId);
    const {app, crdt, history} = registered;

    return (
        <TopBarProvider key={`${app.id}:${mode}`}>
            <DemoTopBar
                apps={apps as any}
                activeAppId={app.id}
                setAppId={setAppId}
                mode={mode}
                setMode={setMode}
            />
            {mode === 'solo' ? (
                <SoloApp key={app.id} app={app as any} runtime={history as any} />
            ) : mode === 'local-first' ? (
                <LocalFirstApp key={app.id} app={app as any} runtime={crdt as any} />
            ) : mode === 'server' ? (
                <ServerApp key={app.id} app={app as any} runtime={crdt as any} />
            ) : mode === 'peerjs' ? (
                <PeerJsApp key={app.id} app={app as any} runtime={crdt as any} />
            ) : (
                <LocalSimulatorApp key={app.id} app={app as any} runtime={crdt as any} />
            )}
        </TopBarProvider>
    );
}
