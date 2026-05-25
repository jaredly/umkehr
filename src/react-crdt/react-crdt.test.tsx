import '../react/test-dom';

import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    type CrdtUpdate,
} from '../crdt/index';
import {
    createSyncedContext,
    useStatuses,
    useValue,
    type SyncedTransport,
} from './react-crdt';
import {createStatusStore} from '../statuses';

type State = {
    title: string;
    count: number;
};

type MetaState = {
    left: string;
    right: string;
};

type ListState = {
    todos: Array<{id: string; title: string; done: boolean}>;
};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
                count: {type: 'number'},
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const initial: State = {title: 'Draft', count: 0};
const startTs = hlc.pack(hlc.init('seed', 1_000_000));
const createInitialHistory = () =>
    createCrdtLocalHistory(createCrdtDocument(initial, schema, {timestamp: startTs}));

const metaSchema = {
    schemas: [
        {
            type: 'object',
            properties: {
                left: {type: 'string'},
                right: {type: 'string'},
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [MetaState]>;

const createMetaHistory = (initial: MetaState) =>
    createCrdtLocalHistory(createCrdtDocument(initial, metaSchema, {timestamp: startTs}));

const listSchema = {
    schemas: [
        {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [ListState]>;

const createInitialListHistory = () =>
    createCrdtLocalHistory(
        createCrdtDocument(
            {
                todos: [
                    {id: 'a', title: 'A', done: false},
                    {id: 'b', title: 'B', done: false},
                ],
            },
            listSchema,
            {timestamp: startTs},
        ),
    );

class TestTransport implements SyncedTransport {
    clock: hlc.HLC;
    published: CrdtUpdate[][] = [];
    listeners = new Set<(update: CrdtUpdate) => void>();

    constructor(readonly actor: string) {
        this.clock = hlc.init(actor, 2_000_000);
    }

    tick() {
        this.clock = hlc.inc(this.clock, Date.now());
        return this.clock;
    }

    publish(updates: CrdtUpdate[]) {
        this.published.push(updates);
    }

    subscribe(receive: (update: CrdtUpdate) => void) {
        this.listeners.add(receive);
        return () => {
            this.listeners.delete(receive);
        };
    }

    emit(update: CrdtUpdate) {
        const ts = update.op === 'setOrder' ? Object.values(update.orders)[0]?.ts : update.ts;
        if (ts) this.clock = hlc.recv(this.clock, hlc.unpack(ts), Date.now());
        for (const listener of this.listeners) listener(update);
    }
}

afterEach(() => cleanup());

describe('createSyncedContext', () => {
    it('renders subscribed values, dispatches local updates, and publishes CRDT updates', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');
        const saved: string[] = [];

        function Editor() {
            const ctx = useTodos();
            const title = useValue(ctx.$.title);
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <button type="button" onClick={() => ctx.$.title('Published')}>
                        rename
                    </button>
                </>
            );
        }

        const view = render(
            <Provider
                initial={createInitialHistory()}
                transport={transport}
                save={(history) => saved.push(history.doc.state.title)}
            >
                <Editor />
            </Provider>,
        );

        expect(view.getByTestId('title').textContent).toBe('Draft');

        fireEvent.click(view.getByText('rename'));

        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(transport.published).toHaveLength(1);
        expect(saved).toEqual(['Published']);
    });

    it('subscribes CRDT path reads to a specific path', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');
        let titlePathRenders = 0;

        function TitlePath() {
            const ctx = useTodos();
            const path = ctx.useCrdtPath(ctx.$.title);
            titlePathRenders += 1;
            return <span data-testid="crdt-path">{path.map((segment) => segment.type).join('/')}</span>;
        }

        function Editor() {
            const ctx = useTodos();
            return (
                <>
                    <TitlePath />
                    <button type="button" onClick={() => ctx.$.count(1)}>
                        count
                    </button>
                    <button type="button" onClick={() => ctx.$.title('Scoped')}>
                        title
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={createInitialHistory()} transport={transport}>
                <Editor />
            </Provider>,
        );

        expect(view.getByTestId('crdt-path').textContent).toBe('objectField');
        expect(titlePathRenders).toBe(1);

        fireEvent.click(view.getByText('count'));
        expect(titlePathRenders).toBe(1);

        fireEvent.click(view.getByText('title'));
        expect(view.getByTestId('crdt-path').textContent).toBe('objectField');
        expect(titlePathRenders).toBe(2);
    });

    it('returns new CRDT metadata when the passed-in path changes to different metadata', () => {
        const [Provider, useTodos] = createSyncedContext<MetaState>('type');
        const transport = new TestTransport('local');
        const history = createMetaHistory({left: 'Left', right: 'Right'});
        let renders = 0;

        function SelectedMeta({field}: {field: 'left' | 'right'}) {
            const ctx = useTodos();
            const node = field === 'left' ? ctx.$.left : ctx.$.right;
            const meta = ctx.useCrdtMeta(node);
            renders += 1;
            return (
                <span data-testid="meta">
                    {meta?.kind === 'primitive' ? String(meta.value) : ''}
                </span>
            );
        }

        const view = render(
            <Provider initial={history} transport={transport}>
                <SelectedMeta field="left" />
            </Provider>,
        );

        expect(view.getByTestId('meta').textContent).toBe('Left');
        expect(renders).toBe(1);

        view.rerender(
            <Provider initial={history} transport={transport}>
                <SelectedMeta field="right" />
            </Provider>,
        );

        expect(view.getByTestId('meta').textContent).toBe('Right');
        expect(renders).toBe(2);
    });

    it('does not schedule another render when the passed-in path changes to equal CRDT metadata', async () => {
        const [Provider, useTodos] = createSyncedContext<MetaState>('type');
        const transport = new TestTransport('local');
        const history = createMetaHistory({left: 'Same', right: 'Same'});
        let renders = 0;

        function SelectedMeta({field}: {field: 'left' | 'right'}) {
            const ctx = useTodos();
            const node = field === 'left' ? ctx.$.left : ctx.$.right;
            const meta = ctx.useCrdtMeta(node);
            renders += 1;
            return (
                <span data-testid="meta">
                    {meta?.kind === 'primitive' ? String(meta.value) : ''}
                </span>
            );
        }

        const view = render(
            <Provider initial={history} transport={transport}>
                <SelectedMeta field="left" />
            </Provider>,
        );

        expect(view.getByTestId('meta').textContent).toBe('Same');
        expect(renders).toBe(1);

        view.rerender(
            <Provider initial={history} transport={transport}>
                <SelectedMeta field="right" />
            </Provider>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(view.getByTestId('meta').textContent).toBe('Same');
        expect(renders).toBe(2);
    });

    it('does not rerender sibling rows for array item field changes', () => {
        const [Provider, useTodos] = createSyncedContext<ListState>('type');
        const transport = new TestTransport('local');
        const renders = {list: 0, a: 0, b: 0};

        function Row({id, index}: {id: 'a' | 'b'; index: number}) {
            const ctx = useTodos();
            const todo = useValue(ctx.$.todos[index]);
            renders[id] += 1;
            return <span data-testid={id}>{todo.title}:{String(todo.done)}</span>;
        }

        function List() {
            const ctx = useTodos();
            const ids = useValue(ctx.$.todos, (todos) => todos.map((todo) => todo.id));
            renders.list += 1;
            return (
                <>
                    {ids.map((id, index) => (
                        <Row key={id} id={id as 'a' | 'b'} index={index} />
                    ))}
                    <button type="button" onClick={() => ctx.$.todos[0].title('A!')}>
                        title
                    </button>
                    <button type="button" onClick={() => ctx.$.todos[0].done(true)}>
                        done
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={createInitialListHistory()} transport={transport}>
                <List />
            </Provider>,
        );

        expect(renders).toEqual({list: 1, a: 1, b: 1});

        fireEvent.click(view.getByText('title'));

        expect(view.getByTestId('a').textContent).toBe('A!:false');
        expect(view.getByTestId('b').textContent).toBe('B:false');
        expect(renders).toEqual({list: 1, a: 2, b: 1});

        fireEvent.click(view.getByText('done'));

        expect(view.getByTestId('a').textContent).toBe('A!:true');
        expect(view.getByTestId('b').textContent).toBe('B:false');
        expect(renders).toEqual({list: 1, a: 3, b: 1});
    });

    it('receives remote updates through transport without publishing them again', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const left = new TestTransport('left');
        const right = new TestTransport('right');

        function Editor() {
            const ctx = useTodos();
            const title = useValue(ctx.$.title);
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <button type="button" onClick={() => ctx.$.title('Remote')}>
                        rename
                    </button>
                </>
            );
        }

        const leftView = render(
            <Provider initial={createInitialHistory()} transport={left}>
                <Editor />
            </Provider>,
        );
        const rightView = render(
            <Provider initial={createInitialHistory()} transport={right}>
                <Editor />
            </Provider>,
        );

        fireEvent.click(leftView.getAllByText('rename')[0]);
        act(() => {
            for (const update of left.published.flat()) right.emit(update);
        });

        expect(rightView.container.querySelector('[data-testid="title"]')?.textContent).toBe('Remote');
        expect(right.published).toEqual([]);
    });

    it('supports local undo and redo', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');

        function Editor() {
            const ctx = useTodos();
            const title = useValue(ctx.$.title);
            const history = ctx.useLocalHistory();
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="can-undo">{String(ctx.canUndo())}</span>
                    <span data-testid="can-redo">{String(ctx.canRedo())}</span>
                    <span data-testid="updates">{history.updates.length}</span>
                    <button type="button" onClick={() => ctx.$.title('Published')}>
                        rename
                    </button>
                    <button type="button" onClick={() => ctx.undo()}>
                        undo
                    </button>
                    <button type="button" onClick={() => ctx.redo()}>
                        redo
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={createInitialHistory()} transport={transport}>
                <Editor />
            </Provider>,
        );

        fireEvent.click(view.getByText('rename'));
        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('can-undo').textContent).toBe('true');
        expect(view.getByTestId('updates').textContent).toBe('1');

        fireEvent.click(view.getByText('undo'));
        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('can-redo').textContent).toBe('true');
        expect(view.getByTestId('updates').textContent).toBe('2');

        fireEvent.click(view.getByText('redo'));
        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('updates').textContent).toBe('3');
        expect(transport.published).toHaveLength(3);
    });

    it('recomputes preview updates after remote updates', async () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const local = new TestTransport('local');
        const remote = new TestTransport('remote');

        function Editor() {
            const ctx = useTodos();
            const title = useValue(ctx.$.title);
            const count = useValue(ctx.$.count);
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="count">{count}</span>
                    <button type="button" onClick={() => ctx.$.title('Preview', 'preview')}>
                        preview title
                    </button>
                    <button type="button" onClick={() => ctx.$.count(1)}>
                        set count
                    </button>
                </>
            );
        }

        const remoteView = render(
            <Provider initial={createInitialHistory()} transport={remote}>
                <Editor />
            </Provider>,
        );
        const localView = render(
            <Provider initial={createInitialHistory()} transport={local}>
                <Editor />
            </Provider>,
        );

        fireEvent.click(localView.getAllByText('preview title')[1]);
        await waitFor(() =>
            expect(localView.container.querySelector('[data-testid="title"]')?.textContent).toBe(
                'Preview',
            ),
        );

        fireEvent.click(remoteView.getAllByText('set count')[0]);
        act(() => {
            for (const update of remote.published.flat()) local.emit(update);
        });

        expect(localView.container.querySelector('[data-testid="title"]')?.textContent).toBe('Preview');
        expect(localView.container.querySelector('[data-testid="count"]')?.textContent).toBe('1');
        expect(local.published).toEqual([]);
    });

    it('returns preview history from useLocalHistory while external preview history is active', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');
        const saved: string[] = [];
        const previewHistory = createCrdtLocalHistory(
            createCrdtDocument({title: 'Preview', count: 7}, schema, {
                timestamp: hlc.pack(hlc.init('preview', 3_000_000)),
            }),
        );

        function Editor() {
            const ctx = useTodos();
            const title = useValue(ctx.$.title);
            const history = ctx.useLocalHistory();
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="history-title">{history.doc.state.title}</span>
                    <span data-testid="history-count">{history.doc.state.count}</span>
                    <button type="button" onClick={() => ctx.previewHistory(previewHistory)}>
                        preview history
                    </button>
                    <button type="button" onClick={() => ctx.previewHistory(null)}>
                        clear preview history
                    </button>
                    <button type="button" onClick={() => ctx.$.title('Committed')}>
                        commit title
                    </button>
                </>
            );
        }

        const view = render(
            <Provider
                initial={createInitialHistory()}
                transport={transport}
                save={(history) => saved.push(history.doc.state.title)}
            >
                <Editor />
            </Provider>,
        );

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('history-title').textContent).toBe('Draft');

        fireEvent.click(view.getByText('preview history'));

        expect(view.getByTestId('title').textContent).toBe('Preview');
        expect(view.getByTestId('history-title').textContent).toBe('Preview');
        expect(view.getByTestId('history-count').textContent).toBe('7');
        expect(saved).toEqual([]);
        expect(transport.published).toEqual([]);

        fireEvent.click(view.getByText('commit title'));

        expect(view.getByTestId('title').textContent).toBe('Committed');
        expect(view.getByTestId('history-title').textContent).toBe('Committed');
        expect(saved).toEqual(['Committed']);
        expect(transport.published).toHaveLength(1);
    });

    it('subscribes to statuses for typed paths', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');
        const statuses = createStatusStore();

        function Editor() {
            const ctx = useTodos();
            const titleStatuses = useStatuses(ctx.$.title);
            return (
                <span data-testid="statuses">
                    {titleStatuses.map((status) => status.kind).join(',')}
                </span>
            );
        }

        const view = render(
            <Provider initial={createInitialHistory()} transport={transport} statuses={statuses}>
                <Editor />
            </Provider>,
        );

        expect(view.getByTestId('statuses').textContent).toBe('');

        act(() => {
            statuses.add([{id: 'title', path: [{type: 'key', key: 'title'}], kind: 'conflict'}]);
        });

        expect(view.getByTestId('statuses').textContent).toBe('conflict');
    });

    it('supports descendant and kind-filtered status subscriptions', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');
        const statuses = createStatusStore();

        function Editor() {
            const ctx = useTodos();
            const titleStatuses = useStatuses(ctx.$.title, {
                descendants: true,
                kinds: ['conflict'],
            });
            return (
                <span data-testid="statuses">
                    {titleStatuses.map((status) => status.id).join(',')}
                </span>
            );
        }

        const view = render(
            <Provider initial={createInitialHistory()} transport={transport} statuses={statuses}>
                <Editor />
            </Provider>,
        );

        act(() => {
            statuses.add([
                {id: 'title', path: [{type: 'key', key: 'title'}], kind: 'changed'},
                {
                    id: 'child',
                    path: [
                        {type: 'key', key: 'title'},
                        {type: 'key', key: 'nested'},
                    ],
                    kind: 'conflict',
                },
                {id: 'count', path: [{type: 'key', key: 'count'}], kind: 'conflict'},
            ]);
        });

        expect(view.getByTestId('statuses').textContent).toBe('child');
    });

    it('returns no statuses when the provider has no status store', () => {
        const [Provider, useTodos] = createSyncedContext<State>('type');
        const transport = new TestTransport('local');

        function Editor() {
            const ctx = useTodos();
            const titleStatuses = useStatuses(ctx.$.title);
            return <span data-testid="statuses">{titleStatuses.length}</span>;
        }

        const view = render(
            <Provider initial={createInitialHistory()} transport={transport}>
                <Editor />
            </Provider>,
        );

        expect(view.getByTestId('statuses').textContent).toBe('0');
    });
});
