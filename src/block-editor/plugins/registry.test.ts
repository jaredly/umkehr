import {describe, expect, it} from 'vitest';

import {createBlockEditorRegistry} from './registry';
import {BlockEditorPluginRegistryError, type BlockEditorPlugin} from './types';

type TestMeta =
    | {type: 'paragraph'; ts: string}
    | {type: 'poll'; votes: Record<string, {ts: string; value: string}>; ts: string}
    | {type: 'card'; title: string; ts: string};

const plugin = (input: BlockEditorPlugin<TestMeta>): BlockEditorPlugin<TestMeta> => input;

describe('createBlockEditorRegistry', () => {
    it('orders plugins by dependency graph with deterministic independent ties', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({id: 'zeta'}),
            plugin({id: 'feature', requires: ['core']}),
            plugin({id: 'alpha'}),
            plugin({id: 'core'}),
        ]);

        expect(registry.plugins.map((item) => item.id)).toEqual(['alpha', 'core', 'feature', 'zeta']);
    });

    it('produces equivalent contribution order for independent plugins regardless of input order', () => {
        const a = plugin({
            id: 'a',
            toolbarItems: [{id: 'a.item'}],
            slashCommands: [{id: 'a.slash', label: 'A'}],
        });
        const b = plugin({
            id: 'b',
            toolbarItems: [{id: 'b.item'}],
            slashCommands: [{id: 'b.slash', label: 'B'}],
        });

        const first = createBlockEditorRegistry<TestMeta>([b, a]);
        const second = createBlockEditorRegistry<TestMeta>([a, b]);

        expect(first.toolbarItems.map((item) => item.id)).toEqual(second.toolbarItems.map((item) => item.id));
        expect(first.slashCommands.map((item) => item.id)).toEqual(second.slashCommands.map((item) => item.id));
        expect(first.toolbarItems.map((item) => item.pluginId)).toEqual(['a', 'b']);
    });

    it('rejects duplicate plugin ids', () => {
        expect(() => createBlockEditorRegistry([plugin({id: 'same'}), plugin({id: 'same'})])).toThrow(
            BlockEditorPluginRegistryError,
        );
    });

    it('rejects missing dependencies', () => {
        expect(() => createBlockEditorRegistry([plugin({id: 'feature', requires: ['missing']})])).toThrow(
            /requires "missing"/,
        );
    });

    it('rejects dependency cycles', () => {
        expect(() =>
            createBlockEditorRegistry([
                plugin({id: 'a', requires: ['b']}),
                plugin({id: 'b', requires: ['a']}),
            ]),
        ).toThrow(/cycle/i);
    });

    it('rejects duplicate handled contribution ids', () => {
        expect(() =>
            createBlockEditorRegistry([
                plugin({id: 'a', marks: [{id: 'bold'}]}),
                plugin({id: 'b', marks: [{id: 'bold'}]}),
            ]),
        ).toThrow(/Duplicate mark "bold"/);
    });

    it('stores command handlers that can return editor command results', () => {
        const state = {
            state: {chars: {}, blocks: {}, marks: {}, splits: {}, joins: {}, maxSeenCount: 0},
            cache: {blockChildren: {}, charContents: {}, joinSentinels: {}, joinedBlocks: {}},
        };
        const selection = {primaryId: 'sel-0', entries: []};
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'commands',
                commands: [
                    {
                        id: 'custom',
                        handle: (_command, context) => ({
                            state: context.state,
                            ops: [],
                            selection: context.selection,
                        }),
                    },
                ],
            }),
        ]);

        expect(registry.commands.get('custom')?.handle({id: 'custom'}, {
            state,
            selection,
            dispatch: () => {},
        })).toEqual({state, ops: [], selection});
    });

    it('rejects duplicate block renderers for a block type', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({
                    id: 'a',
                    blockRenderers: [{id: 'a.card', blockType: 'card', render: () => null}],
                }),
                plugin({
                    id: 'b',
                    blockRenderers: [{id: 'b.card', blockType: 'card', render: () => null}],
                }),
            ]),
        ).toThrow(/Block type "card" is rendered by both/);
    });

    it('rejects duplicate inline renderers for a mark type', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({
                    id: 'a',
                    inlineRenderers: [{id: 'a.link', markType: 'link', render: () => null}],
                }),
                plugin({
                    id: 'b',
                    inlineRenderers: [{id: 'b.link', markType: 'link', render: () => null}],
                }),
            ]),
        ).toThrow(/Inline mark "link" is rendered by both/);
    });

    it('rejects duplicate inline renderers for an embed type', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({
                    id: 'a',
                    inlineRenderers: [{id: 'a.date', markType: 'embed', embedType: 'date', render: () => null}],
                }),
                plugin({
                    id: 'b',
                    inlineRenderers: [{id: 'b.date', markType: 'embed', embedType: 'date', render: () => null}],
                }),
            ]),
        ).toThrow(/Inline embed "date" is rendered by both/);
    });

    it('groups destination renderers by destination in deterministic order', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'comments',
                destinationRenderers: [{id: 'comments.sidebar', destination: 'sidebar', order: 20, render: () => null}],
            }),
            plugin({
                id: 'footnotes',
                destinationRenderers: [{id: 'footnotes.footer', destination: 'footer', render: () => null}],
            }),
            plugin({
                id: 'outline',
                destinationRenderers: [{id: 'outline.sidebar', destination: 'sidebar', order: 10, render: () => null}],
            }),
        ]);

        expect(registry.destinationRenderers.get('sidebar')?.map((item) => item.id)).toEqual([
            'outline.sidebar',
            'comments.sidebar',
        ]);
        expect(registry.destinationRenderers.get('footer')?.map((item) => item.id)).toEqual([
            'footnotes.footer',
        ]);
    });

    it('indexes code preview renderers by id and normalized language', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'code',
                codePreviewRenderers: [
                    {
                        id: 'mermaid',
                        languages: ['Mermaid'],
                        render: async () => ({html: '<svg />'}),
                    },
                ],
            }),
        ]);

        expect(registry.codePreviewRenderers.get('mermaid')?.pluginId).toBe('code');
        expect(registry.codePreviewRenderersByLanguage.get('mermaid')?.id).toBe('mermaid');
    });

    it('rejects duplicate code preview languages', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({
                    id: 'a',
                    codePreviewRenderers: [{id: 'a.mermaid', languages: ['mermaid'], render: async () => ({html: ''})}],
                }),
                plugin({
                    id: 'b',
                    codePreviewRenderers: [{id: 'b.mermaid', languages: [' Mermaid '], render: async () => ({html: ''})}],
                }),
            ]),
        ).toThrow(/Code preview language "mermaid"/);
    });

    it('composes virtual parent hooks and mark virtual parent hooks', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'a',
                crdt: {
                    virtualParents: () => [[1, 'a']],
                    markVirtualParents: () => [[2, 'a']],
                },
            }),
            plugin({
                id: 'b',
                crdt: {
                    virtualParents: () => [[1, 'b']],
                    markVirtualParents: () => [[2, 'b']],
                },
            }),
        ]);
        const config = registry.crdtConfig();

        expect(
            config.virtualParents?.({
                id: [3, 'x'],
                meta: {type: 'card', title: 'Card', ts: 't'},
                style: {},
                order: {id: [3, 'x'], path: [], index: [], ts: 't'},
            }),
        ).toEqual([
            [1, 'a'],
            [1, 'b'],
        ]);
        expect(
            config.markVirtualParents?.({
                id: [4, 'x'],
                start: {id: [5, 'x'], at: 'before'},
                remove: false,
                type: 'annotation',
                crossedSplits: [],
            }),
        ).toEqual([
            [2, 'a'],
            [2, 'b'],
        ]);
    });

    it('rejects conflicting mark behavior', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({id: 'a', crdt: {markBehavior: {annotation: 'stacking'}}}),
                plugin({id: 'b', crdt: {markBehavior: {annotation: 'lww'}}}),
            ]),
        ).toThrow(/conflicting CRDT behavior/);
    });

    it('routes scoped block metadata merge hooks by metadata type', () => {
        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({
                id: 'polls',
                crdt: {
                    mergeBlockMetaTypes: ['poll'],
                    mergeBlockMeta: (current, incoming) =>
                        current.type === 'poll' && incoming.type === 'poll'
                            ? {...incoming, votes: {...current.votes, ...incoming.votes}}
                            : incoming,
                },
            }),
        ]);

        const merged = registry.crdtConfig().mergeBlockMeta?.(
            {type: 'poll', votes: {a: {ts: '1', value: 'yes'}}, ts: '1'},
            {type: 'poll', votes: {b: {ts: '2', value: 'no'}}, ts: '2'},
        );

        expect(merged).toEqual({
            type: 'poll',
            votes: {
                a: {ts: '1', value: 'yes'},
                b: {ts: '2', value: 'no'},
            },
            ts: '2',
        });
    });

    it('rejects duplicate scoped block metadata merge hooks', () => {
        expect(() =>
            createBlockEditorRegistry<TestMeta>([
                plugin({id: 'a', crdt: {mergeBlockMetaTypes: ['poll'], mergeBlockMeta: () => undefined}}),
                plugin({id: 'b', crdt: {mergeBlockMetaTypes: ['poll'], mergeBlockMeta: () => undefined}}),
            ]),
        ).toThrow(/more than one merge hook/i);
    });
});
