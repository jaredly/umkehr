import {blankHistory} from 'umkehr';
import {createHistoryContext, useValue} from 'umkehr/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import './style.css';
import {HistoryView} from './HistoryView';
import {loadPersistedHistory, savePersistedHistory} from './persistence';

export type Todo = {
    id: string;
    title: string;
    done: boolean;
};

export type State = {
    bgcolor: string;
    todos: Todo[];
};

const pastelColors = ['#fff', '#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;

const initialState: State = {
    bgcolor: pastelColors[0],
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Add examples', done: false},
    ],
};

const [ProvideTodos, useTodos] = createHistoryContext<State, never>('type');

export function App() {
    const [initialHistory] = useState(() => loadPersistedHistory() ?? blankHistory(initialState));

    return (
        <ProvideTodos initial={initialHistory} save={savePersistedHistory}>
            <TodoApp />
        </ProvideTodos>
    );
}

function UndoRedo() {
    const ctx = useTodos();
    // Subscribe to changes in canUndo/canRedo
    const history = ctx.useHistory();
    const jump = useCallback((id: string) => ctx.dispatch({op: 'jump', id}), [ctx]);
    const previewJump = useCallback((id: string) => ctx.previewJump(id), [ctx]);
    const clearPreview = useCallback(() => ctx.clearPreview(), [ctx]);

    return (
        <div>
            <nav>
                <button type="button" onClick={() => ctx.undo()} disabled={!ctx.canUndo()}>
                    Undo
                </button>
                <button type="button" onClick={() => ctx.redo()} disabled={!ctx.canRedo()}>
                    Redo
                </button>
            </nav>
            <HistoryView
                history={history}
                jump={jump}
                previewJump={previewJump}
                clearPreview={clearPreview}
            />
        </div>
    );
}

function TodoApp() {
    const ctx = useTodos();
    const bgcolor = useValue(ctx.$.bgcolor);
    const todos = useValue(ctx.$.todos);
    const [draftTitle, setDraftTitle] = useState('');

    return (
        <main>
            <h1>Todos</h1>
            <section
                className="colorPicker"
                aria-label="Task background color"
                onMouseLeave={() => ctx.clearPreview()}
            >
                {pastelColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        className={color === bgcolor ? 'swatch selected' : 'swatch'}
                        style={{backgroundColor: color}}
                        title={color}
                        aria-label={`Use ${color}`}
                        onClick={() => ctx.$.bgcolor(color)}
                        onMouseEnter={() => ctx.$.bgcolor(color, 'preview')}
                    />
                ))}
            </section>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!draftTitle.trim()) return;
                    ctx.$.todos.$push({
                        id: crypto.randomUUID(),
                        title: draftTitle.trim(),
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
            <div style={{overflow: 'auto', height: 300}}>
                <ul style={{'--task-bg': bgcolor} as React.CSSProperties}>
                    {todos.map((todo, index) => (
                        <TodoItem key={todo.id} todo={todo} index={index} />
                    ))}
                </ul>
            </div>
            <UndoRedo />
        </main>
    );
}

function TodoItem({todo, index}: {todo: Todo; index: number}) {
    const ctx = useTodos();
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(todo.title);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isEditing) setTitle(todo.title);
    }, [isEditing, todo.title]);

    useEffect(() => {
        if (isEditing) inputRef.current?.focus();
    }, [isEditing]);

    const commitTitle = () => {
        const nextTitle = title.trim();
        setIsEditing(false);
        if (!nextTitle || nextTitle === todo.title) {
            setTitle(todo.title);
            return;
        }
        ctx.$.todos[index].title(nextTitle);
    };

    return (
        <li>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => ctx.$.todos[index].done(event.target.checked)}
                />
                {isEditing ? (
                    <input
                        ref={inputRef}
                        className="todoEditInput"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.currentTarget.blur();
                            } else if (event.key === 'Escape') {
                                setTitle(todo.title);
                                setIsEditing(false);
                            }
                        }}
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            {!isEditing ? (
                <button
                    type="button"
                    className="editButton"
                    onClick={() => setIsEditing(true)}
                    aria-label={`Edit ${todo.title}`}
                >
                    Edit
                </button>
            ) : null}
        </li>
    );
}
