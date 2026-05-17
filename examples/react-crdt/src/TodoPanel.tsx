import {useMemo, useState} from 'react';
import {useValue} from 'umkehr/react-crdt';
import {type GridSlot, type ReplicaId, type Todo, useTodos} from './model';

export function TodoPanel({
    replicaId,
    title,
    queued,
    gridSlot,
}: {
    replicaId: ReplicaId;
    title: string;
    queued: number;
    gridSlot: GridSlot;
}) {
    const ctx = useTodos();
    const todos = useValue(ctx.$.todos);
    const history = ctx.useLocalHistory();
    const [draftTitle, setDraftTitle] = useState('');
    const completed = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);
    history;

    return (
        <section className={`todoPanel ${gridSlot === 'left' ? 'leftPanel' : 'rightPanel'}`}>
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {completed}/{todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button type="button" onClick={() => ctx.undo()} disabled={!ctx.canUndo()}>
                        Undo
                    </button>
                    <button type="button" onClick={() => ctx.redo()} disabled={!ctx.canRedo()}>
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
                    ctx.$.todos.$push({
                        id: `${replicaId}-${crypto.randomUUID()}`,
                        title: next,
                        done: false,
                    });
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
                {todos.map((todo, index) => (
                    <TodoItem key={todo.id} todo={todo} index={index} />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({todo, index}: {todo: Todo; index: number}) {
    const ctx = useTodos();
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(todo.title);

    const commit = () => {
        const next = title.trim();
        setIsEditing(false);
        if (!next || next === todo.title) {
            setTitle(todo.title);
            return;
        }
        ctx.$.todos[index].title(next);
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => ctx.$.todos[index].done(event.target.checked)}
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
                <button type="button" onClick={() => ctx.$.todos[index].$remove()}>
                    Delete
                </button>
            </div>
        </li>
    );
}
