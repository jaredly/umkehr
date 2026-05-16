import {useMemo, useRef, useState} from 'react';
import typia from 'typia';
import {createPatchBuilder, type DraftPatch} from 'umkehr';
import {
    applyLocalCommand,
    applyRemoteUpdate,
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

type Side = 'left' | 'right';

type CollaborationState = {
    left: CrdtLocalHistory<State>;
    right: CrdtLocalHistory<State>;
    leftOutbox: CrdtUpdate[];
    rightOutbox: CrdtUpdate[];
    syncEnabled: boolean;
};
type TodoDraft = DraftPatch<State, 'type', undefined>;

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
    const clock = useRef({
        left: hlc.init('left', Date.now()),
        right: hlc.init('right', Date.now()),
    });
    const [collab, setCollab] = useState<CollaborationState>(() => ({
        left: createCrdtLocalHistory(
            createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
        ),
        right: createCrdtLocalHistory(
            createCrdtDocument(initialState, schema, {timestamp: initialTimestamp}),
        ),
        leftOutbox: [],
        rightOutbox: [],
        syncEnabled: true,
    }));

    const receiveUpdate = (side: Side, history: CrdtLocalHistory<State>, update: CrdtUpdate) => {
        const next = applyRemoteUpdate(history, update, clock.current[side]);
        clock.current[side] = next.clock;
        return next.history;
    };

    const applyLocal = (side: Side, draft: TodoDraft) => {
        setCollab((current) => {
            const targetSide: Side = side === 'left' ? 'right' : 'left';
            const local = applyLocalCommand(current[side], draft, clock.current[side]);
            clock.current[side] = local.clock;
            let nextSource = local.history;
            let nextTarget = current[targetSide];

            if (current.syncEnabled) {
                for (const update of local.updates) {
                    nextTarget = receiveUpdate(targetSide, nextTarget, update);
                }
            }

            if (side === 'left') {
                return {
                    ...current,
                    left: nextSource,
                    right: nextTarget,
                    leftOutbox: current.syncEnabled
                        ? current.leftOutbox
                        : [...current.leftOutbox, ...local.updates],
                };
            }
            return {
                ...current,
                left: nextTarget,
                right: nextSource,
                rightOutbox: current.syncEnabled
                    ? current.rightOutbox
                    : [...current.rightOutbox, ...local.updates],
            };
        });
    };

    const applyHistoryCommand = (side: Side, kind: 'undo' | 'redo') => {
        setCollab((current) => {
            const targetSide: Side = side === 'left' ? 'right' : 'left';
            const result =
                kind === 'undo'
                    ? undoLocalCommand(current[side], clock.current[side])
                    : redoLocalCommand(current[side], clock.current[side]);
            clock.current[side] = result.clock;
            if (!result.ok) return current;

            let nextSource = result.history;
            let nextTarget = current[targetSide];
            if (current.syncEnabled) {
                for (const update of result.updates) {
                    nextTarget = receiveUpdate(targetSide, nextTarget, update);
                }
            }

            if (side === 'left') {
                return {
                    ...current,
                    left: nextSource,
                    right: nextTarget,
                    leftOutbox: current.syncEnabled
                        ? current.leftOutbox
                        : [...current.leftOutbox, ...result.updates],
                };
            }
            return {
                ...current,
                left: nextTarget,
                right: nextSource,
                rightOutbox: current.syncEnabled
                    ? current.rightOutbox
                    : [...current.rightOutbox, ...result.updates],
            };
        });
    };

    const toggleSync = () => {
        setCollab((current) => {
            if (current.syncEnabled) return {...current, syncEnabled: false};

            let left = current.left;
            let right = current.right;
            for (const update of current.leftOutbox) right = receiveUpdate('right', right, update);
            for (const update of current.rightOutbox) left = receiveUpdate('left', left, update);
            return {
                left,
                right,
                leftOutbox: [],
                rightOutbox: [],
                syncEnabled: true,
            };
        });
    };

    return (
        <main className="collabShell">
            <TodoPanel
                title="Replica A"
                side="left"
                history={collab.left}
                queued={collab.leftOutbox.length}
                applyLocal={applyLocal}
                applyHistoryCommand={applyHistoryCommand}
            />
            <SyncControls
                syncEnabled={collab.syncEnabled}
                leftQueued={collab.leftOutbox.length}
                rightQueued={collab.rightOutbox.length}
                toggleSync={toggleSync}
            />
            <TodoPanel
                title="Replica B"
                side="right"
                history={collab.right}
                queued={collab.rightOutbox.length}
                applyLocal={applyLocal}
                applyHistoryCommand={applyHistoryCommand}
            />
        </main>
    );
}

function SyncControls({
    syncEnabled,
    leftQueued,
    rightQueued,
    toggleSync,
}: {
    syncEnabled: boolean;
    leftQueued: number;
    rightQueued: number;
    toggleSync: () => void;
}) {
    return (
        <section className="syncRail" aria-label="Sync controls">
            <div className={syncEnabled ? 'syncIndicator on' : 'syncIndicator off'} />
            <button type="button" className="syncButton" onClick={toggleSync}>
                {syncEnabled ? 'Pause sync' : 'Resume sync'}
            </button>
            <div className="queueCounts">
                <span>A {leftQueued}</span>
                <span>B {rightQueued}</span>
            </div>
        </section>
    );
}

function TodoPanel({
    title,
    side,
    history,
    queued,
    applyLocal,
    applyHistoryCommand,
}: {
    title: string;
    side: Side;
    history: CrdtLocalHistory<State>;
    queued: number;
    applyLocal: (side: Side, draft: TodoDraft) => void;
    applyHistoryCommand: (side: Side, kind: 'undo' | 'redo') => void;
}) {
    const [draftTitle, setDraftTitle] = useState('');
    const doc = history.doc;
    const completed = useMemo(
        () => doc.state.todos.filter((todo) => todo.done).length,
        [doc.state.todos],
    );

    return (
        <section className="todoPanel">
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {completed}/{doc.state.todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button
                        type="button"
                        onClick={() => applyHistoryCommand(side, 'undo')}
                        disabled={!history.undoStack.length}
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        onClick={() => applyHistoryCommand(side, 'redo')}
                        disabled={!history.redoStack.length}
                    >
                        Redo
                    </button>
                    <span className="queuedBadge">{queued} queued</span>
                </div>
            </header>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const title = draftTitle.trim();
                    if (!title) return;
                    applyLocal(
                        side,
                        $.todos.$push({
                            id: `${side}-${crypto.randomUUID()}`,
                            title,
                            done: false,
                        }),
                    );
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
                {doc.state.todos.map((todo, index) => (
                    <TodoItem
                        key={todo.id}
                        todo={todo}
                        index={index}
                        side={side}
                        applyLocal={applyLocal}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    todo,
    index,
    side,
    applyLocal,
}: {
    todo: Todo;
    index: number;
    side: Side;
    applyLocal: (side: Side, draft: TodoDraft) => void;
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
        applyLocal(side, $.todos[index].title(next));
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) =>
                        applyLocal(side, $.todos[index].done(event.target.checked))
                    }
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
                <button type="button" onClick={() => applyLocal(side, $.todos[index].$remove())}>
                    Delete
                </button>
            </div>
        </li>
    );
}
