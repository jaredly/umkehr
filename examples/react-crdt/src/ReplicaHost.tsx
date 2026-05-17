import {
    useCallback,
    useEffect,
    useMemo,
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
type OutboundUpdates = (from: ReplicaId, updates: CrdtUpdate[]) => void;

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
    const runtime = useReplicaRuntime(id, onOutboundUpdates);

    useEffect(
        () => registerReplica(id, runtime.receiveRemoteUpdate),
        [id, runtime.receiveRemoteUpdate, registerReplica],
    );

    return (
        <TodoPanel
            replicaId={id}
            title={title}
            state={runtime.state}
            queued={queued}
            canUndo={runtime.canUndo}
            canRedo={runtime.canRedo}
            applyLocal={runtime.applyLocal}
            onUndo={runtime.undo}
            onRedo={runtime.redo}
            gridSlot={gridSlot}
        />
    );
}

function useReplicaRuntime(id: ReplicaId, onOutboundUpdates: OutboundUpdates) {
    const clockRef = useRef(hlc.init(id, Date.now()));
    const [history, setHistoryState] = useState<CrdtLocalHistory<State>>(createInitialHistory);
    const historyRef = useRef(history);

    const setHistory = useCallback(
        (next: CrdtLocalHistory<State>) => setHistorySnapshot(next, historyRef, setHistoryState),
        [],
    );

    const receiveRemoteUpdate = useCallback(
        (update: CrdtUpdate) => {
            receiveReplicaUpdate(historyRef, clockRef, setHistory, update);
        },
        [setHistory],
    );

    const applyLocal = useCallback(
        (draft: TodoDraft) => {
            applyReplicaDraft(historyRef, clockRef, setHistory, id, draft, onOutboundUpdates);
        },
        [id, onOutboundUpdates, setHistory],
    );

    const undo = useCallback(() => {
        undoReplicaCommand(historyRef, clockRef, setHistory, id, onOutboundUpdates);
    }, [id, onOutboundUpdates, setHistory]);

    const redo = useCallback(() => {
        redoReplicaCommand(historyRef, clockRef, setHistory, id, onOutboundUpdates);
    }, [id, onOutboundUpdates, setHistory]);

    return useMemo(
        () => ({
            state: history.doc.state,
            canUndo: canUndoLocalCommand(history),
            canRedo: canRedoLocalCommand(history),
            receiveRemoteUpdate,
            applyLocal,
            undo,
            redo,
        }),
        [history, receiveRemoteUpdate, applyLocal, undo, redo],
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
    onOutboundUpdates: OutboundUpdates,
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
    onOutboundUpdates: OutboundUpdates,
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
    onOutboundUpdates: OutboundUpdates,
) {
    const result = redoLocalCommand(historyRef.current, clockRef.current);
    clockRef.current = result.clock;
    if (!result.ok) return;
    setHistory(result.history);
    onOutboundUpdates(id, result.updates);
}
