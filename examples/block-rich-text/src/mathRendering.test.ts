import {describe, expect, it} from 'vitest';
import {FakeMathRenderer} from './mathRendering';

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
});
