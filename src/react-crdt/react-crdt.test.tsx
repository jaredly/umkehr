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
            ctx.useLocalHistory();
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="can-undo">{String(ctx.canUndo())}</span>
                    <span data-testid="can-redo">{String(ctx.canRedo())}</span>
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

        fireEvent.click(view.getByText('undo'));
        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('can-redo').textContent).toBe('true');

        fireEvent.click(view.getByText('redo'));
        expect(view.getByTestId('title').textContent).toBe('Published');
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
