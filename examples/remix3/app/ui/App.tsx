import {blankHistory} from 'umkehr';
import {createHistoryContext, type RemixHandle} from 'umkehr/remix';
import {clientEntry, css, on, type Handle} from 'remix/ui';
import {routes} from '../routes.ts';
import {initialState, pastelColors, type State} from './model.ts';
import {loadPersistedHistory, savePersistedHistory} from './persistence.ts';

const Todos = createHistoryContext<State, never>('type');

export function TodoPage() {
    return () => (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Umkehr Remix 3 Example</title>
                <script type="module" src={routes.assets.href({path: 'app/assets/entry.ts'})}></script>
            </head>
            <body mix={pageStyle}>
                <TodoProvider />
            </body>
        </html>
    );
}

export const TodoProvider = clientEntry(
    '/assets/app/ui/App.tsx#TodoProvider',
    function TodoProviderEntry(handle: Handle) {
        const initialHistory =
            typeof window === 'undefined'
                ? blankHistory<State, never>(initialState)
                : (loadPersistedHistory() ?? blankHistory<State, never>(initialState));

        Todos.provide(
            handle as RemixHandle,
            {
                initial: initialHistory,
                save: savePersistedHistory,
            },
            TodoProvider,
        );

        return () => <TodoApp />;
    },
);

function TodoApp(handle: Handle) {
    const ctx = Todos.get(handle as RemixHandle, TodoProvider);
    const bgcolor = ctx.watch(handle as RemixHandle, ctx.$.bgcolor);
    const todos = ctx.watch(handle as RemixHandle, ctx.$.todos);
    const history = ctx.watchHistory(handle as RemixHandle);

    return () => (
        <main mix={shellStyle}>
            <header mix={headerStyle}>
                <div>
                    <h1 mix={titleStyle}>Todos</h1>
                    <p mix={subtleStyle}>Remix 3 client components with path-scoped Umkehr updates.</p>
                </div>
                <nav mix={toolbarStyle} aria-label="History controls">
                    <button
                        type="button"
                        mix={[buttonStyle, on('click', () => ctx.undo())]}
                        disabled={!ctx.canUndo()}
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        mix={[buttonStyle, on('click', () => ctx.redo())]}
                        disabled={!ctx.canRedo()}
                    >
                        Redo
                    </button>
                </nav>
            </header>

            <section
                mix={[swatchRowStyle, on('pointerleave', () => ctx.clearPreview())]}
                aria-label="Task background color"
            >
                {pastelColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        aria-label={`Use ${color}`}
                        title={color}
                        mix={[
                            swatchStyle,
                            on('pointerenter', () => ctx.$.bgcolor(color, 'preview')),
                            on('pointerleave', () => ctx.clearPreview()),
                            on('click', () => ctx.$.bgcolor(color)),
                        ]}
                        style={{
                            backgroundColor: color,
                            boxShadow:
                                color === bgcolor.current
                                    ? '0 0 0 1px #486581, 0 0 0 4px #d9e2ec'
                                    : undefined,
                        }}
                    />
                ))}
            </section>

            <form
                mix={[
                    formStyle,
                    on('submit', (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const formData = new FormData(form);
                        const title = String(formData.get('title') ?? '').trim();
                        if (!title) return;
                        ctx.$.todos.$push({
                            id: crypto.randomUUID(),
                            title,
                            done: false,
                        });
                        form.reset();
                    }),
                ]}
            >
                <input name="title" placeholder="New todo" mix={inputStyle} />
                <button type="submit" mix={buttonStyle}>
                    Add
                </button>
            </form>

            <div mix={listFrameStyle}>
                <ul mix={listStyle}>
                    {todos.current.map((todo, index) => (
                        <TodoItem key={todo.id} index={index} />
                    ))}
                </ul>
            </div>

            <footer mix={footerStyle}>
                <span>{Object.keys(history.current.nodes).length} history nodes</span>
                <span>Tip {history.current.tip}</span>
            </footer>
        </main>
    );
}

function TodoItem(handle: Handle<{index: number}>) {
    const ctx = Todos.get(handle as RemixHandle, TodoProvider);
    const todo = ctx.watch(handle as RemixHandle, ctx.$.todos[handle.props.index]);
    const bgcolor = ctx.watch(handle as RemixHandle, ctx.$.bgcolor);
    let isEditing = false;
    let draftTitle = todo.current.title;

    function commitTitle(value: string) {
        const nextTitle = value.trim();
        isEditing = false;
        if (nextTitle && nextTitle !== todo.current.title) {
            ctx.$.todos[handle.props.index].title(nextTitle);
        } else {
            handle.update();
        }
    }

    return () => {
        const current = todo.current;
        if (!isEditing) draftTitle = current.title;

        return (
            <li mix={itemStyle} style={{background: bgcolor.current}}>
                <label mix={itemLabelStyle}>
                    <input
                        type="checkbox"
                        checked={current.done}
                        mix={on('change', (event) => {
                            ctx.$.todos[handle.props.index].done(event.currentTarget.checked);
                        })}
                    />
                    {isEditing ? (
                        <input
                            aria-label={`Edit ${current.title}`}
                            defaultValue={draftTitle}
                            mix={[
                                editInputStyle,
                                on('input', (event) => {
                                    draftTitle = event.currentTarget.value;
                                }),
                                on('blur', (event) => commitTitle(event.currentTarget.value)),
                                on('keydown', (event) => {
                                    if (event.key === 'Enter') {
                                        event.currentTarget.blur();
                                    } else if (event.key === 'Escape') {
                                        isEditing = false;
                                        draftTitle = current.title;
                                        handle.update();
                                    }
                                }),
                            ]}
                        />
                    ) : (
                        <span mix={todoTitleStyle}>{current.title}</span>
                    )}
                </label>
                {!isEditing ? (
                    <button
                        type="button"
                        aria-label={`Edit ${current.title}`}
                        mix={[
                            smallButtonStyle,
                            on('click', () => {
                                draftTitle = current.title;
                                isEditing = true;
                                handle.update();
                            }),
                        ]}
                    >
                        Edit
                    </button>
                ) : null}
            </li>
        );
    };
}

const pageStyle = css({
    margin: 0,
    color: '#1f2933',
    background: '#f4f6f8',
    fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '& *': {boxSizing: 'border-box'},
});

const shellStyle = css({
    width: 'min(720px, calc(100vw - 32px))',
    margin: '48px auto',
});

const headerStyle = css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
});

const titleStyle = css({
    margin: '0 0 8px',
    fontSize: '32px',
    lineHeight: 1.1,
});

const subtleStyle = css({
    margin: 0,
    color: '#52606d',
});

const toolbarStyle = css({
    display: 'flex',
    gap: '8px',
});

const buttonStyle = css({
    border: '1px solid #9aa5b1',
    borderRadius: '6px',
    padding: '10px 14px',
    color: '#102a43',
    background: '#fff',
    font: 'inherit',
    cursor: 'pointer',
    '&:disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
    },
});

const smallButtonStyle = css({
    border: '1px solid #9aa5b1',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#102a43',
    background: '#fff',
    font: 'inherit',
    cursor: 'pointer',
});

const swatchRowStyle = css({
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    margin: '18px 0',
});

const swatchStyle = css({
    width: '32px',
    height: '32px',
    border: '2px solid #fff',
    borderRadius: '999px',
    padding: 0,
    boxShadow: '0 0 0 1px #bcccdc',
    cursor: 'pointer',
    '&:hover, &:focus-visible': {
        boxShadow: '0 0 0 1px #486581, 0 0 0 4px #d9e2ec',
    },
});

const formStyle = css({
    display: 'flex',
    gap: '8px',
});

const inputStyle = css({
    minWidth: 0,
    flex: 1,
    border: '1px solid #cbd2d9',
    borderRadius: '6px',
    padding: '10px 12px',
    font: 'inherit',
});

const listFrameStyle = css({
    overflow: 'auto',
    height: '300px',
    marginTop: '20px',
});

const listStyle = css({
    display: 'grid',
    gap: '8px',
    padding: 0,
    listStyle: 'none',
});

const itemStyle = css({
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px',
    border: '1px solid #d9e2ec',
    borderRadius: '8px',
});

const itemLabelStyle = css({
    minWidth: 0,
    flex: 1,
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
});

const todoTitleStyle = css({
    minWidth: 0,
    overflowWrap: 'anywhere',
});

const editInputStyle = css({
    minWidth: 0,
    width: '100%',
    border: '1px solid #9fb3c8',
    borderRadius: '6px',
    padding: '6px 8px',
    background: '#fff',
    font: 'inherit',
});

const footerStyle = css({
    display: 'flex',
    gap: '12px',
    marginTop: '18px',
    color: '#52606d',
    fontSize: '13px',
});
