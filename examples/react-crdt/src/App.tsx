import {apps, defaultApp, registeredAppForId} from './lib/appRegistry';
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
    const {app, crdt, history, serverSchemaConfig} = registered;

    const topBar = {
        apps: apps as any,
        activeAppId: app.id,
        setAppId,
        mode,
        setMode,
    };

    return mode === 'solo' ? (
        <SoloApp key={app.id} app={app as any} runtime={history as any} topBar={topBar} />
    ) : mode === 'local-first' ? (
        <LocalFirstApp key={app.id} app={app as any} runtime={crdt as any} topBar={topBar} />
    ) : mode === 'server' ? (
        <ServerApp
            key={app.id}
            app={app as any}
            runtime={crdt as any}
            schemaConfig={serverSchemaConfig as any}
            topBar={topBar}
        />
    ) : mode === 'peerjs' ? (
        <PeerJsApp key={app.id} app={app as any} runtime={crdt as any} topBar={topBar} />
    ) : (
        <LocalSimulatorApp key={app.id} app={app as any} runtime={crdt as any} topBar={topBar} />
    );
}
