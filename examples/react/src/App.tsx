import {blankHistory} from 'umkehr';
import {createHistoryContext, useValue} from 'umkehr/react';
import './style.css';

type Todo = {
    id: string;
    title: string;
    done: boolean;
};

type State = {
    bgcolor: string;
    draftTitle: string;
    todos: Todo[];
};

const pastelColors = ['#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;

const initialState: State = {
    bgcolor: pastelColors[1],
    draftTitle: '',
    todos: [
        {id: 'one', title: 'Write README', done: true},
        {id: 'two', title: 'Add examples', done: false},
    ],
};

const [ProvideTodos, useTodos] = createHistoryContext<State, never>('type');

export function App() {
    return (
        <ProvideTodos initial={blankHistory(initialState)}>
            <TodoApp />
        </ProvideTodos>
    );
}

function TodoApp() {
    const ctx = useTodos();
    console.log(ctx);
    const bgcolor = useValue(ctx.$.bgcolor);
    const draftTitle = useValue(ctx.$.draftTitle);
    const todos = useValue(ctx.$.todos);

    const previewTitle = draftTitle || 'Untitled todo';

    return (
        <main>
            <h1>Todos</h1>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!draftTitle.trim()) return;
                    // This makes them part of the same "history item"
                    ctx.$((_, up) => [
                        up.todos.$push({
                            id: crypto.randomUUID(),
                            title: draftTitle.trim(),
                            done: false,
                        }),
                        up.draftTitle(''),
                    ]);
                }}
            >
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => ctx.$.draftTitle(event.target.value, 'preview')}
                    onBlur={(event) => ctx.$.draftTitle(event.target.value)}
                />
                <button type="submit">Add</button>
            </form>
            <p className="preview">Preview: {previewTitle}</p>
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
                        onFocus={() => ctx.$.bgcolor(color, 'preview')}
                        onMouseEnter={() => ctx.$.bgcolor(color, 'preview')}
                        onBlur={() => ctx.clearPreview()}
                    />
                ))}
            </section>
            <ul style={{'--task-bg': bgcolor} as React.CSSProperties}>
                {todos.map((todo, index) => (
                    <li key={todo.id}>
                        <label>
                            <input
                                type="checkbox"
                                checked={todo.done}
                                onChange={(event) => ctx.$.todos[index].done(event.target.checked)}
                            />
                            <span>{todo.title}</span>
                        </label>
                    </li>
                ))}
            </ul>
            <nav>
                <button type="button" onClick={() => ctx.undo()} disabled={!ctx.canUndo()}>
                    Undo
                </button>
                <button type="button" onClick={() => ctx.redo()} disabled={!ctx.canRedo()}>
                    Redo
                </button>
            </nav>
        </main>
    );
}
