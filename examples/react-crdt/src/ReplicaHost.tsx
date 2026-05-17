import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
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
import {TodoPanel} from './TodoPanel';
import {
    $,
    initialState,
    initialTimestamp,
    schema,
    type GridSlot,
    type RegisterReplica,
    type ReplicaId,
    type State,
    type TodoDraft,
} from './model';

type SetHistory = (next: CrdtLocalHistory<State>) => void;
type HistoryRef = MutableRefObject<CrdtLocalHistory<State>>;
type ClockRef = MutableRefObject<hlc.HLC>;

export function ReplicaHost({
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
    gridSlot: GridSlot;
}) {
    const clock = useRef(hlc.init(id, Date.now()));
    const [history, setHistoryState] = useState<CrdtLocalHistory<State>>(createInitialHistory);
    const historyRef = useRef(history);

    const setHistory = useCallback(
        (next: CrdtLocalHistory<State>) => setHistorySnapshot(next, historyRef, setHistoryState),
        [],
    );

    const receiveRemoteUpdate = useCallback(
        (update: CrdtUpdate) => {
            receiveReplicaUpdate(historyRef, clock, setHistory, update);
        },
        [setHistory],
    );

    useEffect(
        () => registerReplica(id, receiveRemoteUpdate),
        [id, receiveRemoteUpdate, registerReplica],
    );

    const applyLocal = useCallback(
        (draft: TodoDraft) => {
            applyReplicaDraft(historyRef, clock, setHistory, id, draft, onOutboundUpdates);
        },
        [id, onOutboundUpdates, setHistory],
    );

    const undo = useCallback(() => {
        undoReplicaCommand(historyRef, clock, setHistory, id, onOutboundUpdates);
    }, [id, onOutboundUpdates, setHistory]);

    const redo = useCallback(() => {
        redoReplicaCommand(historyRef, clock, setHistory, id, onOutboundUpdates);
    }, [id, onOutboundUpdates, setHistory]);

    const addTodo = useCallback(
        (todoTitle: string) => {
            applyLocal(createAddTodoDraft(id, todoTitle));
        },
        [applyLocal, id],
    );

    const toggleTodo = useCallback(
        (index: number, done: boolean) => applyLocal(createToggleTodoDraft(index, done)),
        [applyLocal],
    );

    const renameTodo = useCallback(
        (index: number, todoTitle: string) => applyLocal(createRenameTodoDraft(index, todoTitle)),
        [applyLocal],
    );

    const deleteTodo = useCallback(
        (index: number) => applyLocal(createDeleteTodoDraft(index)),
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

function createInitialHistory() {
    return createCrdtLocalHistory(
        createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
    );
}

function setHistorySnapshot(
    next: CrdtLocalHistory<State>,
    ref: MutableRefObject<CrdtLocalHistory<State>>,
    setState: Dispatch<SetStateAction<CrdtLocalHistory<State>>>,
) {
    ref.current = next;
    setState(next);
}

function receiveReplicaUpdate(
    historyRef: HistoryRef,
    clockRef: ClockRef,
    setHistory: SetHistory,
    update: CrdtUpdate,
) {
    const result = applyRemoteUpdate(historyRef.current, update, clockRef.current);
    clockRef.current = result.clock;
    setHistory(result.history);
}

function applyReplicaDraft(
    historyRef: HistoryRef,
    clockRef: ClockRef,
    setHistory: SetHistory,
    id: ReplicaId,
    draft: TodoDraft,
    onOutboundUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
) {
    const result = applyLocalCommand(historyRef.current, draft, clockRef.current);
    clockRef.current = result.clock;
    setHistory(result.history);
    onOutboundUpdates(id, result.updates);
}

function undoReplicaCommand(
    historyRef: HistoryRef,
    clockRef: ClockRef,
    setHistory: SetHistory,
    id: ReplicaId,
    onOutboundUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
) {
    const result = undoLocalCommand(historyRef.current, clockRef.current);
    clockRef.current = result.clock;
    if (!result.ok) return;
    setHistory(result.history);
    onOutboundUpdates(id, result.updates);
}

function redoReplicaCommand(
    historyRef: HistoryRef,
    clockRef: ClockRef,
    setHistory: SetHistory,
    id: ReplicaId,
    onOutboundUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
) {
    const result = redoLocalCommand(historyRef.current, clockRef.current);
    clockRef.current = result.clock;
    if (!result.ok) return;
    setHistory(result.history);
    onOutboundUpdates(id, result.updates);
}

function createAddTodoDraft(id: ReplicaId, title: string) {
    return $.todos.$push({
        id: `${id}-${crypto.randomUUID()}`,
        title,
        done: false,
    });
}

function createToggleTodoDraft(index: number, done: boolean) {
    return $.todos[index].done(done);
}

function createRenameTodoDraft(index: number, title: string) {
    return $.todos[index].title(title);
}

function createDeleteTodoDraft(index: number) {
    return $.todos[index].$remove();
}
