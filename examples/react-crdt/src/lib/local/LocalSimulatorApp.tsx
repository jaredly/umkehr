import {useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {useStore} from '../store';
import {replicas} from './model';
import {SyncControls} from './SyncControls';
import {type DemoSync, useLocalDemoSync} from './useLocalDemoSync';

export function LocalSimulatorApp<TState>({
    app,
    runtime,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
}) {
    const [initialHistory] = useState(() => createInitialCrdtHistory(app));
    const sync = useLocalDemoSync();

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <LocalReplicaPanel
                    key={replica.id}
                    index={index}
                    sync={sync}
                    replica={replica}
                    initial={initialHistory}
                    app={app}
                    runtime={runtime}
                />
            ))}
            <LocalSyncControls sync={sync} />
        </main>
    );
}

function LocalReplicaPanel<TState>({
    index,
    sync,
    replica,
    initial,
    app,
    runtime,
}: {
    index: number;
    sync: DemoSync;
    replica: (typeof replicas)[number];
    initial: CrdtLocalHistory<TState>;
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
}) {
    const {Provider} = runtime;

    return (
        <Provider
            initial={initial}
            transport={sync.transports[replica.id]}
            statuses={sync.statusStores[replica.id]}
        >
            <LocalReplicaDocument
                actor={replica.id}
                app={app}
                gridSlot={index === 0 ? 'left' : 'right'}
                runtime={runtime}
                sync={sync}
                title={replica.title}
            />
        </Provider>
    );
}

function LocalReplicaDocument<TState>({
    actor,
    app,
    gridSlot,
    runtime,
    sync,
    title,
}: {
    actor: string;
    app: AppDefinition<TState>;
    gridSlot: 'left' | 'right';
    runtime: CrdtRuntime<TState>;
    sync: DemoSync;
    title: string;
}) {
    const editor = runtime.useEditorContext();

    return app.renderPanel({
        actor,
        editor,
        title,
        gridSlot,
        setPresenceSelection: (elementId) => sync.setPresenceSelection(actor, elementId),
    });
}

function LocalSyncControls({sync}: {sync: DemoSync}) {
    const state = useStore(sync.stateStore);

    return (
        <SyncControls
            syncEnabled={state.syncEnabled}
            queueCounts={replicas.map((replica) => ({
                label: replica.label,
                count: state.outbox[replica.id]?.length ?? 0,
            }))}
            toggleSync={sync.toggleSync}
        />
    );
}
