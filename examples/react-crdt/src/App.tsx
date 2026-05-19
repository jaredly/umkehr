import {AppPicker} from './lib/AppPicker';
import {apps, defaultApp, registeredAppForId} from './lib/appRegistry';
import {LocalSimulatorApp} from './lib/local/LocalSimulatorApp';
import {LocalFirstApp} from './lib/local-first/LocalFirstApp';
import {ModeTabs} from './lib/ModeTabs';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import {ServerApp} from './lib/server/ServerApp';
import {SoloApp} from './lib/solo/SoloApp';
import './style.css';
import {useHashMode} from './lib/useHashMode';

export function App() {
    const [{mode, appId}, setMode, setAppId] = useHashMode(defaultApp.id);
    const registered = registeredAppForId(appId);
    const {app, crdt, history} = registered;

    return (
        <>
            <AppPicker
                apps={apps as any}
                activeAppId={app.id}
                setAppId={setAppId}
            />
            <ModeTabs mode={mode} setMode={setMode} />
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
        </>
    );
}
