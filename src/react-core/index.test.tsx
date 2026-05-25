import '../react/test-dom';

import {cleanup, render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {createPatchBuilderWithContext, getPath} from '../helper';
import {
    makeContextForPath,
    makePathListenerNode,
    notifyPaths,
    useValue,
    type Context,
} from './index';

type State = {
    title: string;
    count: number;
    nested: {
        value: string;
    };
};

afterEach(() => {
    cleanup();
});

const makeTestContext = (initial: State) => {
    let state = initial;
    const listenersByPath = makePathListenerNode();
    const extra = makeContextForPath(() => state, listenersByPath);
    const $ = createPatchBuilderWithContext<State, Context>('type', extra);

    return {
        $,
        set(next: State, paths = [getPath($)]) {
            state = next;
            notifyPaths(listenersByPath, paths);
        },
    };
};

describe('react-core useValue', () => {
    it('reads the current value and updates when the subscribed path is notified', async () => {
        const ctx = makeTestContext({
            title: 'Draft',
            count: 0,
            nested: {value: 'Initial'},
        });
        let renders = 0;

        function TitleView() {
            const title = useValue(ctx.$.title);
            renders += 1;
            return <span data-testid="title">{title}</span>;
        }

        const view = render(<TitleView />);

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(renders).toBe(1);

        ctx.set(
            {title: 'Published', count: 0, nested: {value: 'Initial'}},
            [getPath(ctx.$.title)],
        );

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Published'));
        expect(renders).toBe(2);
    });

    it('does not re-render when another branch is notified', async () => {
        const ctx = makeTestContext({
            title: 'Draft',
            count: 0,
            nested: {value: 'Initial'},
        });
        let renders = 0;

        function TitleView() {
            const title = useValue(ctx.$.title);
            renders += 1;
            return <span data-testid="title">{title}</span>;
        }

        const view = render(<TitleView />);

        ctx.set(
            {title: 'Draft', count: 1, nested: {value: 'Initial'}},
            [getPath(ctx.$.count)],
        );

        await waitFor(() => expect(view.getByTestId('title').textContent).toBe('Draft'));
        expect(renders).toBe(1);
    });

    it('does not re-render when the subscribed path is notified with the same value', async () => {
        const ctx = makeTestContext({
            title: 'Draft',
            count: 0,
            nested: {value: 'Initial'},
        });
        let renders = 0;

        function TitleView() {
            const title = useValue(ctx.$.title);
            renders += 1;
            return <span data-testid="title">{title}</span>;
        }

        const view = render(<TitleView />);

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(renders).toBe(1);

        ctx.set(
            {title: 'Draft', count: 1, nested: {value: 'Initial'}},
            [getPath(ctx.$.title)],
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(view.getByTestId('title').textContent).toBe('Draft');
        expect(renders).toBe(1);
    });

    it('deduplicates selector results with deep equality by default', async () => {
        const ctx = makeTestContext({
            title: 'Draft',
            count: 0,
            nested: {value: 'Initial'},
        });
        let renders = 0;

        function ParityView() {
            const parity = useValue(ctx.$.count, (count) => ({parity: count % 2}));
            renders += 1;
            return <span data-testid="parity">{parity.parity}</span>;
        }

        const view = render(<ParityView />);

        ctx.set(
            {title: 'Draft', count: 2, nested: {value: 'Initial'}},
            [getPath(ctx.$.count)],
        );

        await waitFor(() => expect(view.getByTestId('parity').textContent).toBe('0'));
        expect(renders).toBe(1);

        ctx.set(
            {title: 'Draft', count: 3, nested: {value: 'Initial'}},
            [getPath(ctx.$.count)],
        );

        await waitFor(() => expect(view.getByTestId('parity').textContent).toBe('1'));
        expect(renders).toBe(2);
    });

    it('returns the new value when the passed-in path changes to a different value', () => {
        const ctx = makeTestContext({
            title: 'Draft',
            count: 0,
            nested: {value: 'Published'},
        });
        let renders = 0;

        function SelectedValue({field}: {field: 'title' | 'nested'}) {
            const node = field === 'title' ? ctx.$.title : ctx.$.nested.value;
            const value = useValue(node);
            renders += 1;
            return <span data-testid="value">{value}</span>;
        }

        const view = render(<SelectedValue field="title" />);

        expect(view.getByTestId('value').textContent).toBe('Draft');
        expect(renders).toBe(1);

        view.rerender(<SelectedValue field="nested" />);

        expect(view.getByTestId('value').textContent).toBe('Published');
        expect(renders).toBe(2);
    });

    it('does not schedule another render when the passed-in path changes to the same value', async () => {
        const ctx = makeTestContext({
            title: 'Same',
            count: 0,
            nested: {value: 'Same'},
        });
        let renders = 0;

        function SelectedValue({field}: {field: 'title' | 'nested'}) {
            const node = field === 'title' ? ctx.$.title : ctx.$.nested.value;
            const value = useValue(node);
            renders += 1;
            return <span data-testid="value">{value}</span>;
        }

        const view = render(<SelectedValue field="title" />);

        expect(view.getByTestId('value').textContent).toBe('Same');
        expect(renders).toBe(1);

        view.rerender(<SelectedValue field="nested" />);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(view.getByTestId('value').textContent).toBe('Same');
        expect(renders).toBe(2);
    });
});
