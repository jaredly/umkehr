import {describe, expect, it, vi} from 'vitest';
import {blankHistory} from '../history/history.js';
import {createHistoryContext, createStateContext, type RemixHandle} from './remix.js';

type State = {
    title: string;
    count: number;
};

function createContextStore() {
    const values = new Map<unknown, unknown>();
    return {
        set(key: unknown, value: unknown) {
            values.set(key, value);
        },
        get<T>(key: unknown): T {
            if (!values.has(key)) {
                throw new Error('missing context');
            }
            return values.get(key) as T;
        },
    };
}

function createHandle(id: string, context = createContextStore()) {
    const controller = new AbortController();
    const handle: RemixHandle & {abort(): void; updates: number} = {
        id,
        signal: controller.signal,
        updates: 0,
        update() {
            handle.updates += 1;
        },
        context,
        abort() {
            controller.abort();
        },
    };
    return handle;
}

const flushScheduled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('umkehr/remix createStateContext', () => {
    it('provides and gets a context runtime', () => {
        const Todos = createStateContext<State>('type');
        const context = createContextStore();
        const provider = createHandle('provider', context);
        const child = createHandle('child', context);

        const provided = Todos.provide(provider, {initial: {title: 'Draft', count: 0}});
        const ctx = Todos.get(child);

        expect(ctx).toBe(provided);
        expect(ctx.latest()).toEqual({title: 'Draft', count: 0});
    });

    it('watches values and only updates matching path subscribers', () => {
        const Todos = createStateContext<State>('type');
        const context = createContextStore();
        const provider = createHandle('provider', context);
        const titleHandle = createHandle('title', context);
        const countHandle = createHandle('count', context);
        const ctx = Todos.provide(provider, {initial: {title: 'Draft', count: 0}});

        const title = ctx.watch(titleHandle, ctx.$.title);
        const count = ctx.watch(countHandle, ctx.$.count);

        expect(title.current).toBe('Draft');
        expect(count.current).toBe(0);

        ctx.$.title('Published');

        expect(title.current).toBe('Published');
        expect(count.current).toBe(0);
        expect(titleHandle.updates).toBe(1);
        expect(countHandle.updates).toBe(0);
    });

    it('removes watched path listeners when the handle aborts', () => {
        const Todos = createStateContext<State>('type');
        const provider = createHandle('provider');
        const titleHandle = createHandle('title', provider.context);
        const ctx = Todos.provide(provider, {initial: {title: 'Draft', count: 0}});

        ctx.watch(titleHandle, ctx.$.title);
        titleHandle.abort();

        ctx.$.title('Published');

        expect(titleHandle.updates).toBe(0);
    });

    it('applies and clears preview updates with the timeout scheduler fallback', async () => {
        const originalRaf = globalThis.requestAnimationFrame;
        const originalCancelRaf = globalThis.cancelAnimationFrame;
        // Force the non-browser scheduling path even if another test installed RAF.
        delete (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame;
        delete (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame;

        try {
            const Todos = createStateContext<State>('type');
            const provider = createHandle('provider');
            const titleHandle = createHandle('title', provider.context);
            const countHandle = createHandle('count', provider.context);
            const saved: State[] = [];
            const ctx = Todos.provide(provider, {
                initial: {title: 'Draft', count: 0},
                save: (state) => saved.push(state),
            });

            const title = ctx.watch(titleHandle, ctx.$.title);
            const count = ctx.watch(countHandle, ctx.$.count);

            ctx.$.title('Preview', 'preview');
            await flushScheduled();

            expect(title.current).toBe('Preview');
            expect(count.current).toBe(0);
            expect(saved).toEqual([]);
            expect(titleHandle.updates).toBe(1);
            expect(countHandle.updates).toBe(0);

            ctx.$.count(1);

            expect(title.current).toBe('Draft');
            expect(count.current).toBe(1);
            expect(saved).toEqual([{title: 'Draft', count: 1}]);
            expect(titleHandle.updates).toBe(2);
            expect(countHandle.updates).toBe(1);
        } finally {
            if (originalRaf) globalThis.requestAnimationFrame = originalRaf;
            if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf;
        }
    });
});

describe('umkehr/remix createHistoryContext', () => {
    it('supports history watch, undo, and redo', () => {
        const Todos = createHistoryContext<State, never>('type');
        const provider = createHandle('provider');
        const titleHandle = createHandle('title', provider.context);
        const historyHandle = createHandle('history', provider.context);
        const ctx = Todos.provide(provider, {
            initial: blankHistory({title: 'Draft', count: 0}),
        });

        const title = ctx.watch(titleHandle, ctx.$.title);
        const history = ctx.watchHistory(historyHandle);

        ctx.$.title('Published');

        expect(title.current).toBe('Published');
        expect(history.current.tip).not.toBe(history.current.root);
        expect(ctx.canUndo()).toBe(true);
        expect(titleHandle.updates).toBe(1);
        expect(historyHandle.updates).toBe(1);

        ctx.undo();

        expect(title.current).toBe('Draft');
        expect(ctx.canRedo()).toBe(true);

        ctx.redo();

        expect(title.current).toBe('Published');
        expect(ctx.canRedo()).toBe(false);
    });

    it('emits history change listeners for new history nodes', () => {
        const Todos = createHistoryContext<State, never>('type');
        const provider = createHandle('provider');
        const ctx = Todos.provide(provider, {
            initial: blankHistory({title: 'Draft', count: 0}),
        });
        const onHistoryChange = vi.fn();

        ctx.onHistoryChange(onHistoryChange);
        ctx.$.count(1);
        ctx.undo();

        expect(onHistoryChange).toHaveBeenCalledTimes(1);
    });
});
