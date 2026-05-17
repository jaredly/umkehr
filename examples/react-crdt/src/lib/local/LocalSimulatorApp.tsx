import {useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import type {CrdtAppDefinition} from '../crdtApp';
import {useStore} from '../store';
import {replicas} from './model';
import {SyncControls} from './SyncControls';
import {type DemoSync, useLocalDemoSync} from './useLocalDemoSync';

export function LocalSimulatorApp<TState>({app}: {app: CrdtAppDefinition<TState>}) {
    const [initialHistory] = useState(app.createInitialHistory);
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
}: {
    index: number;
    sync: DemoSync;
    replica: (typeof replicas)[number];
    initial: CrdtLocalHistory<TState>;
    app: CrdtAppDefinition<TState>;
}) {
    const state = useStore(sync.stateStore);
    const {Provider} = app;

    return (
        <Provider initial={initial} transport={sync.transports[replica.id]}>
            {app.renderPanel({
                actor: replica.id,
                title: replica.title,
                queued: state.outbox[replica.id]?.length ?? 0,
                gridSlot: index === 0 ? 'left' : 'right',
            })}
        </Provider>
    );
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
