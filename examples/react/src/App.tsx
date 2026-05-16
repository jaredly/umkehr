import {useMemo, useRef, useState} from 'react';
import typia from 'typia';
import {createPatchBuilder, resolveAndApply, type DraftPatch} from 'umkehr';
import {
    applyCrdtUpdate,
    createCrdtDocument,
    createCrdtUpdates,
    type CrdtDocument,
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
    left: CrdtDocument<State>;
    right: CrdtDocument<State>;
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

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function App() {
    const clock = useRef({left: 0, right: 0});
    const [collab, setCollab] = useState<CollaborationState>(() => ({
        left: createCrdtDocument(initialState, schema, {timestamp: '000000-seed'}),
        right: createCrdtDocument(initialState, schema, {timestamp: '000000-seed'}),
        leftOutbox: [],
        rightOutbox: [],
        syncEnabled: true,
    }));

    const nextTimestamp = (side: Side) => {
        clock.current[side] += 1;
        return `${String(clock.current[side]).padStart(6, '0')}-${side}`;
    };

    const applyLocal = (side: Side, draft: TodoDraft) => {
        setCollab((current) => {
            const source = current[side];
            const targetSide: Side = side === 'left' ? 'right' : 'left';
            const {changes} = resolveAndApply(source.state, draft, undefined, 'type', equal);
            let nextSource = source;
            let nextTarget = current[targetSide];
            const updates: CrdtUpdate[] = [];

            for (const change of changes) {
                const ts = nextTimestamp(side);
                for (const update of createCrdtUpdates(nextSource, change, ts)) {
                    nextSource = applyCrdtUpdate(nextSource, update);
                    updates.push(update);
                    if (current.syncEnabled) {
                        nextTarget = applyCrdtUpdate(nextTarget, update);
                    }
                }
            }

            if (side === 'left') {
                return {
                    ...current,
                    left: nextSource,
                    right: nextTarget,
                    leftOutbox: current.syncEnabled
                        ? current.leftOutbox
                        : [...current.leftOutbox, ...updates],
                };
            }
            return {
                ...current,
                left: nextTarget,
                right: nextSource,
                rightOutbox: current.syncEnabled
                    ? current.rightOutbox
                    : [...current.rightOutbox, ...updates],
            };
        });
    };

    const toggleSync = () => {
        setCollab((current) => {
            if (current.syncEnabled) return {...current, syncEnabled: false};

            let left = current.left;
            let right = current.right;
            for (const update of current.leftOutbox) right = applyCrdtUpdate(right, update);
            for (const update of current.rightOutbox) left = applyCrdtUpdate(left, update);
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
                doc={collab.left}
                queued={collab.leftOutbox.length}
                applyLocal={applyLocal}
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
                doc={collab.right}
                queued={collab.rightOutbox.length}
                applyLocal={applyLocal}
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
    doc,
    queued,
    applyLocal,
}: {
    title: string;
    side: Side;
    doc: CrdtDocument<State>;
    queued: number;
    applyLocal: (side: Side, draft: TodoDraft) => void;
}) {
    const [draftTitle, setDraftTitle] = useState('');
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
                <span className="queuedBadge">{queued} queued</span>
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
