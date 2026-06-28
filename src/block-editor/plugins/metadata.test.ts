import {describe, expect, it} from 'vitest';

import {createBlockEditorRegistry} from './registry';
import {
    blockEditorMetaIsCore,
    blockEditorMetaType,
    blockEditorMetaWithTs,
    coreParagraphMeta,
    validateBlockEditorMeta,
} from './metadata';
import type {BlockEditorPlugin} from './types';

type TestMeta =
    | {type: 'card'; title: string; ts: string}
    | {type: 'poll'; votes: Record<string, string>; ts: string};

const plugin = (input: BlockEditorPlugin<TestMeta>): BlockEditorPlugin<TestMeta> => input;

describe('block editor plugin metadata helpers', () => {
    it('creates and recognizes core paragraph metadata', () => {
        const meta = coreParagraphMeta('1');

        expect(meta).toEqual({type: 'paragraph', ts: '1'});
        expect(blockEditorMetaType(meta)).toBe('paragraph');
        expect(blockEditorMetaIsCore(meta)).toBe(true);
    });

    it('validates registered plugin metadata with plugin validators', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'cards',
                blockTypes: [
                    {
                        id: 'card',
                        validate: (meta): meta is Extract<TestMeta, {type: 'card'}> =>
                            typeof meta === 'object' &&
                            meta !== null &&
                            (meta as {type?: unknown}).type === 'card' &&
                            typeof (meta as {title?: unknown}).title === 'string' &&
                            typeof (meta as {ts?: unknown}).ts === 'string',
                    },
                ],
            }),
        ]);

        expect(validateBlockEditorMeta(registry, {type: 'card', title: 'Hello', ts: '1'})).toBe(true);
        expect(validateBlockEditorMeta(registry, {type: 'card', ts: '1'})).toBe(false);
        expect(validateBlockEditorMeta(registry, {type: 'poll', votes: {}, ts: '1'})).toBe(false);
    });

    it('updates metadata timestamps through plugin hooks when available', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'polls',
                blockTypes: [
                    {
                        id: 'poll',
                        withTs: (meta, ts) =>
                            meta.type === 'poll' ? {...meta, votes: {...meta.votes}, ts} : meta,
                    },
                ],
            }),
        ]);

        expect(blockEditorMetaWithTs(registry, {type: 'poll', votes: {a: 'yes'}, ts: '1'}, '2')).toEqual({
            type: 'poll',
            votes: {a: 'yes'},
            ts: '2',
        });
    });

    it('updates unhooked metadata timestamps with a shallow copy', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({id: 'cards', blockTypes: [{id: 'card'}]}),
        ]);

        expect(blockEditorMetaWithTs(registry, {type: 'card', title: 'Hello', ts: '1'}, '2')).toEqual({
            type: 'card',
            title: 'Hello',
            ts: '2',
        });
    });
});
