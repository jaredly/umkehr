import {
    apps,
    defaultAppRouteId,
    registeredAppForId,
    routeIdForRegisteredApp,
} from './lib/appRegistry';
import {LocalSimulatorApp} from './lib/local/LocalSimulatorApp';
import {LocalFirstApp} from './lib/local-first/LocalFirstApp';
import {PeerJsApp} from './lib/peerjs/PeerJsApp';
import {ServerApp} from './lib/server/ServerApp';
import {SoloApp} from './lib/solo/SoloApp';
import './style.css';
import {useUrlSelection} from './lib/useUrlSelection';

export function App() {
    const [{mode, appId}, setMode, setAppId] = useUrlSelection(defaultAppRouteId);
    const registered = registeredAppForId(appId);
    const {app, crdt, history, serverSchemaConfig} = registered;
    const serverOldPendingChangesPolicy =
        'serverOldPendingChangesPolicy' in registered
            ? registered.serverOldPendingChangesPolicy
            : undefined;
    const routeId = routeIdForRegisteredApp(registered);

    const topBar = {
        apps,
        activeAppId: routeId,
        setAppId,
        mode,
        setMode,
    };

    return mode === 'solo' ? (
        <SoloApp key={routeId} app={app as any} runtime={history as any} topBar={topBar} />
    ) : mode === 'local-first' ? (
        <LocalFirstApp key={routeId} app={app as any} runtime={crdt as any} topBar={topBar} />
    ) : mode === 'server' ? (
        <ServerApp
            key={routeId}
            app={app as any}
            runtime={crdt as any}
            schemaConfig={serverSchemaConfig as any}
            oldPendingChangesPolicy={serverOldPendingChangesPolicy}
            topBar={topBar}
        />
    ) : mode === 'peerjs' ? (
        <PeerJsApp key={routeId} app={app as any} runtime={crdt as any} topBar={topBar} />
    ) : (
        <LocalSimulatorApp key={routeId} app={app as any} runtime={crdt as any} topBar={topBar} />
    );
}
