import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import typia from 'typia';
import {createPatchBuilder, type DraftPatch} from 'umkehr';
import {
    applyLocalCommand,
    applyRemoteUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    redoLocalCommand,
    undoLocalCommand,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import './style.css';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type State = {
    todos: Todo[];
};

type ReplicaId = 'replica-a' | 'replica-b';
type TodoDraft = DraftPatch<State, 'type', undefined>;
type ReceiveUpdate = (update: CrdtUpdate) => void;
type RegisterReplica = (id: ReplicaId, receive: ReceiveUpdate) => () => void;

type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

const replicas = [
    {id: 'replica-a', title: 'Replica A', label: 'A'},
    {id: 'replica-b', title: 'Replica B', label: 'B'},
] as const satisfies ReadonlyArray<{id: ReplicaId; title: string; label: string}>;

const schema = typia.json.schemas<[State], '3.1'>();
const $ = createPatchBuilder<State>();

const initialState: State = {
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Try CRDT sync', done: false},
    ],
};

const initialTimestamp = hlc.pack(hlc.init('seed', 0));

export function App() {
    const receivers = useRef<Partial<Record<ReplicaId, ReceiveUpdate>>>({});
    const [transport, setTransportState] = useState<TransportState>(() => ({
        syncEnabled: true,
        outbox: emptyOutbox(),
    }));
    const transportRef = useRef(transport);

    const setTransport = useCallback((next: TransportState) => {
        transportRef.current = next;
        setTransportState(next);
    }, []);

    const registerReplica = useCallback<RegisterReplica>((id, receive) => {
        receivers.current[id] = receive;
        return () => {
            if (receivers.current[id] === receive) delete receivers.current[id];
        };
    }, []);

    const deliverUpdates = useCallback((from: ReplicaId, updates: CrdtUpdate[]) => {
        for (const replica of replicas) {
            if (replica.id === from) continue;
            const receive = receivers.current[replica.id];
            if (!receive) continue;
            for (const update of updates) receive(update);
        }
    }, []);

    const broadcastUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            if (!updates.length) return;
            const current = transportRef.current;
            if (current.syncEnabled) {
                deliverUpdates(from, updates);
                return;
            }
            setTransport({
                ...current,
                outbox: {
                    ...current.outbox,
                    [from]: [...current.outbox[from], ...updates],
                },
            });
        },
        [deliverUpdates, setTransport],
    );

    const toggleSync = useCallback(() => {
        const current = transportRef.current;
        if (current.syncEnabled) {
            setTransport({...current, syncEnabled: false});
            return;
        }

        const queued = current.outbox;
        setTransport({syncEnabled: true, outbox: emptyOutbox()});
        for (const replica of replicas) deliverUpdates(replica.id, queued[replica.id]);
    }, [deliverUpdates, setTransport]);

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <ReplicaHost
                    key={replica.id}
                    id={replica.id}
                    title={replica.title}
                    queued={transport.outbox[replica.id].length}
                    registerReplica={registerReplica}
                    onOutboundUpdates={broadcastUpdates}
                    gridSlot={index === 0 ? 'left' : 'right'}
                />
            ))}
            <SyncControls
                syncEnabled={transport.syncEnabled}
                queueCounts={replicas.map((replica) => ({
                    label: replica.label,
                    count: transport.outbox[replica.id].length,
                }))}
                toggleSync={toggleSync}
            />
        </main>
    );
}

function ReplicaHost({
    id,
    title,
    queued,
    registerReplica,
    onOutboundUpdates,
    gridSlot,
}: {
    id: ReplicaId;
    title: string;
    queued: number;
    registerReplica: RegisterReplica;
    onOutboundUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void;
    gridSlot: 'left' | 'right';
}) {
    const clock = useRef(hlc.init(id, Date.now()));
    const [history, setHistoryState] = useState<CrdtLocalHistory<State>>(() =>
        createCrdtLocalHistory(
            createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
        ),
    );
    const historyRef = useRef(history);

    const setHistory = useCallback((next: CrdtLocalHistory<State>) => {
        historyRef.current = next;
        setHistoryState(next);
    }, []);

    const receiveRemoteUpdate = useCallback(
        (update: CrdtUpdate) => {
            const result = applyRemoteUpdate(historyRef.current, update, clock.current);
            clock.current = result.clock;
            setHistory(result.history);
        },
        [setHistory],
    );

    useEffect(
        () => registerReplica(id, receiveRemoteUpdate),
        [id, receiveRemoteUpdate, registerReplica],
    );

    const applyLocal = useCallback(
        (draft: TodoDraft) => {
            const result = applyLocalCommand(historyRef.current, draft, clock.current);
            clock.current = result.clock;
            setHistory(result.history);
            onOutboundUpdates(id, result.updates);
        },
        [id, onOutboundUpdates, setHistory],
    );

    const undo = useCallback(() => {
        const result = undoLocalCommand(historyRef.current, clock.current);
        clock.current = result.clock;
        if (!result.ok) return;
        setHistory(result.history);
        onOutboundUpdates(id, result.updates);
    }, [id, onOutboundUpdates, setHistory]);

    const redo = useCallback(() => {
        const result = redoLocalCommand(historyRef.current, clock.current);
        clock.current = result.clock;
        if (!result.ok) return;
        setHistory(result.history);
        onOutboundUpdates(id, result.updates);
    }, [id, onOutboundUpdates, setHistory]);

    const addTodo = useCallback(
        (todoTitle: string) => {
            applyLocal(
                $.todos.$push({
                    id: `${id}-${crypto.randomUUID()}`,
                    title: todoTitle,
                    done: false,
                }),
            );
        },
        [applyLocal, id],
    );

    const toggleTodo = useCallback(
        (index: number, done: boolean) => applyLocal($.todos[index].done(done)),
        [applyLocal],
    );

    const renameTodo = useCallback(
        (index: number, todoTitle: string) => applyLocal($.todos[index].title(todoTitle)),
        [applyLocal],
    );

    const deleteTodo = useCallback(
        (index: number) => applyLocal($.todos[index].$remove()),
        [applyLocal],
    );

    return (
        <TodoPanel
            title={title}
            state={history.doc.state}
            queued={queued}
            canUndo={canUndoLocalCommand(history)}
            canRedo={canRedoLocalCommand(history)}
            onAddTodo={addTodo}
            onToggleTodo={toggleTodo}
            onRenameTodo={renameTodo}
            onDeleteTodo={deleteTodo}
            onUndo={undo}
            onRedo={redo}
            gridSlot={gridSlot}
        />
    );
}

function SyncControls({
    syncEnabled,
    queueCounts,
    toggleSync,
}: {
    syncEnabled: boolean;
    queueCounts: Array<{label: string; count: number}>;
    toggleSync: () => void;
}) {
    return (
        <section className="syncRail" aria-label="Sync controls">
            <div className={syncEnabled ? 'syncIndicator on' : 'syncIndicator off'} />
            <button type="button" className="syncButton" onClick={toggleSync}>
                {syncEnabled ? 'Pause sync' : 'Resume sync'}
            </button>
            <div className="queueCounts">
                {queueCounts.map((queue) => (
                    <span key={queue.label}>
                        {queue.label} {queue.count}
                    </span>
                ))}
            </div>
        </section>
    );
}

function TodoPanel({
    title,
    state,
    queued,
    canUndo,
    canRedo,
    onAddTodo,
    onToggleTodo,
    onRenameTodo,
    onDeleteTodo,
    onUndo,
    onRedo,
    gridSlot,
}: {
    title: string;
    state: State;
    queued: number;
    canUndo: boolean;
    canRedo: boolean;
    onAddTodo: (title: string) => void;
    onToggleTodo: (index: number, done: boolean) => void;
    onRenameTodo: (index: number, title: string) => void;
    onDeleteTodo: (index: number) => void;
    onUndo: () => void;
    onRedo: () => void;
    gridSlot: 'left' | 'right';
}) {
    const [draftTitle, setDraftTitle] = useState('');
    const completed = useMemo(() => state.todos.filter((todo) => todo.done).length, [state.todos]);

    return (
        <section className={`todoPanel ${gridSlot === 'left' ? 'leftPanel' : 'rightPanel'}`}>
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {completed}/{state.todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button type="button" onClick={onUndo} disabled={!canUndo}>
                        Undo
                    </button>
                    <button type="button" onClick={onRedo} disabled={!canRedo}>
                        Redo
                    </button>
                    <span className="queuedBadge">{queued} queued</span>
                </div>
            </header>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftTitle.trim();
                    if (!next) return;
                    onAddTodo(next);
                    setDraftTitle('');
                }}
            >
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => setDraftTitle(event.target.value)}
                />
                <button type="submit">Add</button>
            </form>

            <ul className="todoList">
                {state.todos.map((todo, index) => (
                    <TodoItem
                        key={todo.id}
                        todo={todo}
                        index={index}
                        onToggleTodo={onToggleTodo}
                        onRenameTodo={onRenameTodo}
                        onDeleteTodo={onDeleteTodo}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    todo,
    index,
    onToggleTodo,
    onRenameTodo,
    onDeleteTodo,
}: {
    todo: Todo;
    index: number;
    onToggleTodo: (index: number, done: boolean) => void;
    onRenameTodo: (index: number, title: string) => void;
    onDeleteTodo: (index: number) => void;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(todo.title);

    const commit = () => {
        const next = title.trim();
        setIsEditing(false);
        if (!next || next === todo.title) {
            setTitle(todo.title);
            return;
        }
        onRenameTodo(index, next);
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => onToggleTodo(index, event.target.checked)}
                />
                {isEditing ? (
                    <input
                        className="titleInput"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                                setTitle(todo.title);
                                setIsEditing(false);
                            }
                        }}
                        autoFocus
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            <div className="itemActions">
                <button type="button" onClick={() => setIsEditing(true)}>
                    Edit
                </button>
                <button type="button" onClick={() => onDeleteTodo(index)}>
                    Delete
                </button>
            </div>
        </li>
    );
}

function emptyOutbox(): Record<ReplicaId, CrdtUpdate[]> {
    return {
        'replica-a': [],
        'replica-b': [],
    };
}
