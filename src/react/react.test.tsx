import './test-dom';

import {cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {blankHistory} from '../history/history';
import {createHistoryContext, createStateContext, useValue} from './react';

type State = {
    title: string;
    count: number;
};

afterEach(() => {
    cleanup();
});

describe('createStateContext', () => {
    it('renders subscribed values and dispatches committed updates', () => {
        const [Provider, useStateContext] = createStateContext<State>('type');
        const saved: State[] = [];

        function TitleEditor() {
            const ctx = useStateContext();
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
            <Provider initial={{title: 'Draft', count: 0}} save={(state) => saved.push(state)}>
                <TitleEditor />
            </Provider>,
        );

        expect(view.getByTestId('title').textContent).toBe('Draft');

        fireEvent.click(view.getByText('rename'));

        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(saved).toEqual([{title: 'Published', count: 0}]);
    });

    it('notifies path subscribers for changed paths only', () => {
        const [Provider, useStateContext] = createStateContext<State>('type');
        const renders = {title: 0, count: 0};

        function TitleView() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            renders.title += 1;
            return <span data-testid="title">{title}</span>;
        }

        function CountView() {
            const ctx = useStateContext();
            const count = useValue(ctx.$.count);
            renders.count += 1;
            return <span data-testid="count">{count}</span>;
        }

        function Controls() {
            const ctx = useStateContext();
            return (
                <button type="button" onClick={() => ctx.$.title('Published')}>
                    rename
                </button>
            );
        }

        const view = render(
            <Provider initial={{title: 'Draft', count: 0}}>
                <>
                    <TitleView />
                    <CountView />
                    <Controls />
                </>
            </Provider>,
        );

        expect(renders).toEqual({title: 1, count: 1});

        fireEvent.click(view.getByText('rename'));

        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('count').textContent).toBe('0');
        expect(renders).toEqual({title: 2, count: 1});
    });

    it('applies preview updates without saving and clears them on commit', async () => {
        const [Provider, useStateContext] = createStateContext<State>('type');
        const saved: State[] = [];
        const renders = {title: 0, count: 0};

        function TitleView() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            renders.title += 1;
            return <span data-testid="title">{title}</span>;
        }

        function CountView() {
            const ctx = useStateContext();
            const count = useValue(ctx.$.count);
            renders.count += 1;
            return <span data-testid="count">{count}</span>;
        }

        function PreviewControls() {
            const ctx = useStateContext();
            return (
                <>
                    <button type="button" onClick={() => ctx.$.title('Preview', 'preview')}>
                        preview
                    </button>
                    <button type="button" onClick={() => ctx.$.count(1)}>
                        commit count
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={{title: 'Draft', count: 0}} save={(state) => saved.push(state)}>
                <>
                    <TitleView />
                    <CountView />
                    <PreviewControls />
                </>
            </Provider>,
        );

        fireEvent.click(view.getByText('preview'));

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Preview'));
        expect(view.getByTestId('count').textContent).toBe('0');
        expect(renders).toEqual({title: 2, count: 1});
        expect(saved).toEqual([]);

        fireEvent.click(view.getByText('commit count'));

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Draft'));
        expect(view.getByTestId('count').textContent).toBe('1');
        expect(renders).toEqual({title: 3, count: 2});
        expect(saved).toEqual([{title: 'Draft', count: 1}]);
    });

    it('deduplicates repeated preview paths before a commit clears preview state', async () => {
        const [Provider, useStateContext] = createStateContext<State>('type');
        let titleRenders = 0;

        function TitleView() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            titleRenders += 1;
            return <span data-testid="title">{title}</span>;
        }

        function PreviewControls() {
            const ctx = useStateContext();
            return (
                <>
                    <button
                        type="button"
                        onClick={() => {
                            ctx.$.title('Preview 1', 'preview');
                            ctx.$.title('Preview 2', 'preview');
                            ctx.$.title('Preview 3', 'preview');
                        }}
                    >
                        preview repeatedly
                    </button>
                    <button type="button" onClick={() => ctx.$.count(1)}>
                        commit count
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={{title: 'Draft', count: 0}}>
                <>
                    <TitleView />
                    <PreviewControls />
                </>
            </Provider>,
        );

        expect(titleRenders).toBe(1);

        fireEvent.click(view.getByText('preview repeatedly'));

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Preview 3'));
        expect(titleRenders).toBe(2);

        fireEvent.click(view.getByText('commit count'));

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Draft'));
        expect(titleRenders).toBe(3);
    });
});

describe('createHistoryContext', () => {
    it('dispatches committed updates and walks through undo and redo', () => {
        const [Provider, useStateContext] = createHistoryContext<State, string>('type');
        const savedTips: string[] = [];

        function HistoryEditor() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            const history = ctx.useHistory();
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="tip">{history.tip}</span>
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
            <Provider
                initial={blankHistory<State, string>({title: 'Draft', count: 0})}
                save={(history) => savedTips.push(history.tip)}
            >
                <HistoryEditor />
            </Provider>,
        );

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('tip').textContent).toBe('root');
        expect(view.getByTestId('can-undo').textContent).toBe('false');

        fireEvent.click(view.getByText('rename'));

        const changedTip = view.getByTestId('tip').textContent;
        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(changedTip).not.toBe('root');
        expect(view.getByTestId('can-undo').textContent).toBe('true');
        expect(savedTips).toEqual([changedTip]);

        fireEvent.click(view.getByText('undo'));

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('tip').textContent).toBe('root');
        expect(view.getByTestId('can-redo').textContent).toBe('true');

        fireEvent.click(view.getByText('redo'));

        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('tip').textContent).toBe(changedTip);
        expect(view.getByTestId('can-redo').textContent).toBe('false');
    });

    it('notifies only affected value subscribers during history navigation', () => {
        const [Provider, useStateContext] = createHistoryContext<State, string>('type');
        const renders = {title: 0, count: 0};

        function TitleView() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            renders.title += 1;
            return <span data-testid="title">{title}</span>;
        }

        function CountView() {
            const ctx = useStateContext();
            const count = useValue(ctx.$.count);
            renders.count += 1;
            return <span data-testid="count">{count}</span>;
        }

        function Controls() {
            const ctx = useStateContext();
            return (
                <>
                    <button type="button" onClick={() => ctx.$.title('Published')}>
                        rename
                    </button>
                    <button type="button" onClick={() => ctx.undo()}>
                        undo
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={blankHistory<State, string>({title: 'Draft', count: 0})}>
                <>
                    <TitleView />
                    <CountView />
                    <Controls />
                </>
            </Provider>,
        );

        expect(renders).toEqual({title: 1, count: 1});

        fireEvent.click(view.getByText('rename'));
        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('count').textContent).toBe('0');
        expect(renders).toEqual({title: 2, count: 1});

        fireEvent.click(view.getByText('undo'));
        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(view.getByTestId('count').textContent).toBe('0');
        expect(renders).toEqual({title: 3, count: 1});
    });

    it('notifies history listeners for committed changes but not annotation-only changes', () => {
        const [Provider, useStateContext] = createHistoryContext<State, {label: string}>('type');
        const events: string[] = [];

        function HistoryListener() {
            const ctx = useStateContext();
            ctx.useHistory();
            return (
                <>
                    <button
                        type="button"
                        onClick={() => {
                            ctx.onHistoryChange(() => events.push('history'));
                        }}
                    >
                        listen
                    </button>
                    <button type="button" onClick={() => ctx.$.title('Published')}>
                        rename
                    </button>
                    <button
                        type="button"
                        onClick={() => ctx.updateAnnotations.root.$add({note: {label: 'Root'}})}
                    >
                        annotate
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={blankHistory<State, {label: string}>({title: 'Draft', count: 0})}>
                <HistoryListener />
            </Provider>,
        );

        fireEvent.click(view.getByText('listen'));
        fireEvent.click(view.getByText('rename'));
        fireEvent.click(view.getByText('annotate'));

        expect(events).toEqual(['history']);
    });

    it('clears history while preserving the current value', () => {
        const [Provider, useStateContext] = createHistoryContext<State, string>('type');

        function ClearHistoryEditor() {
            const ctx = useStateContext();
            const title = useValue(ctx.$.title);
            ctx.useHistory();
            return (
                <>
                    <span data-testid="title">{title}</span>
                    <span data-testid="tip">{ctx.tip()}</span>
                    <span data-testid="can-undo">{String(ctx.canUndo())}</span>
                    <button type="button" onClick={() => ctx.$.title('Published')}>
                        rename
                    </button>
                    <button type="button" onClick={() => ctx.clearHistory()}>
                        clear
                    </button>
                </>
            );
        }

        const view = render(
            <Provider initial={blankHistory<State, string>({title: 'Draft', count: 0})}>
                <ClearHistoryEditor />
            </Provider>,
        );

        fireEvent.click(view.getByText('rename'));
        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('can-undo').textContent).toBe('true');

        fireEvent.click(view.getByText('clear'));

        expect(view.getByTestId('title').textContent).toBe('Published');
        expect(view.getByTestId('tip').textContent).toBe('root');
        expect(view.getByTestId('can-undo').textContent).toBe('false');
    });
});
