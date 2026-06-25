import {describe, expect, it} from 'vitest';
import {BrowserMathJaxRenderer, FakeMathRenderer, type MathRenderResult} from './mathRendering';

describe('math rendering adapter', () => {
    it('renders deterministic fake math html for tests', () => {
        const renderer = new FakeMathRenderer();

        expect(renderer.render('x^2', 'inline')).toEqual({
            type: 'html',
            html: '<span data-fake-math="inline">x^2</span>',
        });
        expect(renderer.render('<x>', 'display')).toEqual({
            type: 'html',
            html: '<span data-fake-math="display">&lt;x&gt;</span>',
        });
    });

    it('can fall back to literal source', () => {
        const renderer = new FakeMathRenderer();

        expect(renderer.render('INVALID', 'inline')).toEqual({type: 'literal', text: 'INVALID'});
    });

    it('uses the previous rendered result for the same fallback key while rerendering', async () => {
        const pending: Array<{
            source: string;
            resolve(result: MathRenderResult): void;
        }> = [];
        const renderer = new BrowserMathJaxRenderer(undefined, (source) => {
            return new Promise<MathRenderResult>((resolve) => pending.push({source, resolve}));
        });
        const fallbackKey = ['block', '0', 'inline'].join('\0');

        expect(renderer.render('x', 'inline', {fallbackKey})).toEqual({
            type: 'literal',
            text: 'x',
        });
        pending.shift()?.resolve({type: 'html', html: '<span>x</span>'});
        await Promise.resolve();

        expect(renderer.render('xy', 'inline', {fallbackKey})).toEqual({
            type: 'html',
            html: '<span>x</span>',
        });
        expect(pending[0]?.source).toBe('xy');

        pending.shift()?.resolve({type: 'html', html: '<span>xy</span>'});
        await Promise.resolve();

        expect(renderer.render('xy', 'inline', {fallbackKey})).toEqual({
            type: 'html',
            html: '<span>xy</span>',
        });
    });

    it('treats MathJax error html as a literal fallback', async () => {
        const renderer = new BrowserMathJaxRenderer(undefined, async (source) => ({
            type: 'html',
            html: `<svg><g data-mml-node="merror" data-mjx-error="Bad math">${source}</g></svg>`,
        }));

        expect(renderer.render('\\bad{', 'inline')).toEqual({
            type: 'literal',
            text: '\\bad{',
        });
        await Promise.resolve();

        expect(renderer.render('\\bad{', 'inline')).toEqual({
            type: 'literal',
            text: '\\bad{',
        });
    });
});
