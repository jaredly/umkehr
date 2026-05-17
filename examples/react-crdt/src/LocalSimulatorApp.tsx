import {useState} from 'react';
import {SyncControls} from './SyncControls';
import {TodoPanel} from './TodoPanel';
import {ProvideTodos, createInitialHistory, replicas} from './model';
import {useStore} from './store';
import {type DemoSync, useDemoSync} from './useDemoSync';

export function LocalSimulatorApp() {
    const [initialHistory] = useState(createInitialHistory);
    const sync = useDemoSync();

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <LocalReplicaPanel
                    key={replica.id}
                    index={index}
                    sync={sync}
                    replica={replica}
                    initial={initialHistory}
                />
            ))}
            <LocalSyncControls sync={sync} />
        </main>
    );
}

function LocalReplicaPanel({
    index,
    sync,
    replica,
    initial,
}: {
    index: number;
    sync: DemoSync;
    replica: (typeof replicas)[number];
    initial: ReturnType<typeof createInitialHistory>;
}) {
    const state = useStore(sync.stateStore);

    return (
        <ProvideTodos initial={initial} transport={sync.transports[replica.id]}>
            <TodoPanel
                replicaId={replica.id}
                title={replica.title}
                queued={state.outbox[replica.id]?.length ?? 0}
                gridSlot={index === 0 ? 'left' : 'right'}
            />
        </ProvideTodos>
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
