import {blankHistory} from 'umkehr';
import {createHistoryContext, useValue} from 'umkehr/react';
import './style.css';

type Todo = {
    id: string;
    title: string;
    done: boolean;
};

type State = {
    draftTitle: string;
    todos: Todo[];
};

const initialState: State = {
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
                    ctx.$.todos.$push({
                        id: crypto.randomUUID(),
                        title: draftTitle.trim(),
                        done: false,
                    });
                    ctx.$.draftTitle('');
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
            <ul>
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
