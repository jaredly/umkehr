import {useState} from 'react';
import {SyncControls} from './SyncControls';
import {TodoPanel} from './TodoPanel';
import {
    ProvideTodos,
    createInitialHistory,
    replicas,
} from './model';
import './style.css';
import {useDemoSync} from './useDemoSync';

export function App() {
    const [initialHistory] = useState(createInitialHistory);
    const sync = useDemoSync();

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <ProvideTodos
                    key={replica.id}
                    initial={initialHistory}
                    transport={sync.transports[replica.id]}
                >
                    <TodoPanel
                        replicaId={replica.id}
                        title={replica.title}
                        queued={sync.state.outbox[replica.id]?.length ?? 0}
                        gridSlot={index === 0 ? 'left' : 'right'}
                    />
                </ProvideTodos>
            ))}
            <SyncControls
                syncEnabled={sync.state.syncEnabled}
                queueCounts={replicas.map((replica) => ({
                    label: replica.label,
                    count: sync.state.outbox[replica.id]?.length ?? 0,
                }))}
                toggleSync={sync.toggleSync}
            />
        </main>
    );
}
