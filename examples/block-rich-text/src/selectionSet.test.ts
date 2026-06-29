import {describe, expect, it} from 'vitest';
import {blockContents, cachedState, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {deleteBackward, insertText, moveBlock, pastePlainText, type CommandContext} from 'umkehr/block-editor';
import {
    BlockEditorSelectionPluginError,
    caret,
    createBlockEditorRegistry,
    type BlockEditorPlugin,
    type EditorSelection,
    type PluginEditorSelection,
    type PluginRetainedSelection,
    type RetainedSelection,
} from 'umkehr/block-editor';
import {
    appendSelection,
    blockLevelDecorationsForSelectionSet,
    blockLevelDecorationsForSelectionSetFromRegistry,
    decorationsForSelectionSet,
    dedupeSelectionSet,
    dedupeSelectionSetFromRegistry,
    mergeOverlappingRanges,
    primarySelection,
    resolveSelectionSet,
    resolveSelectionSetFromRegistry,
    singleRetainedSelectionSet,
    singleRetainedSelectionSetFromRegistry,
} from 'umkehr/block-editor';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => `${actor}-${String(i++).padStart(5, '0')}`,
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: CachedState) => rootBlockIds(state)[0];

const lines = (state: CachedState) => rootBlockIds(state).map((id) => blockContents(state, id));

const testZonePlugin = (): BlockEditorPlugin => ({
    id: 'test-zone-plugin',
    selectionTypes: [{id: 'test-zone', label: 'Test zone'}],
    selectionPlugins: [
        {
            id: 'test-zone',
            retain: ({selection}) => selection,
            resolve: ({selection}) => selection,
            focusPoint: ({selection}) => ({blockId: stringField(selection, 'focusBlockId'), offset: 0}),
            firstPoint: ({selection}) => ({blockId: stringField(selection, 'anchorBlockId'), offset: 0}),
            selectedBlockIds: ({selection}) => [
                stringField(selection, 'anchorBlockId'),
                stringField(selection, 'focusBlockId'),
            ],
            selectedTopLevelBlockIds: ({selection}) => [
                stringField(selection, 'anchorBlockId'),
                stringField(selection, 'focusBlockId'),
            ],
            blockLevelDecorations: ({selection, primary}) =>
                new Map([
                    [stringField(selection, 'anchorBlockId'), {selected: true, primary, focus: false}],
                    [stringField(selection, 'focusBlockId'), {selected: true, primary, focus: true}],
                ]),
            compare: ({one, two}) =>
                stringField(one, 'anchorBlockId').localeCompare(stringField(two, 'anchorBlockId')),
        },
    ],
});

const testZoneSelection = (anchorBlockId: string, focusBlockId: string): EditorSelection => ({
    type: 'test-zone',
    anchorBlockId,
    focusBlockId,
});

const stringField = (selection: PluginEditorSelection | PluginRetainedSelection, key: string): string =>
    typeof selection[key] === 'string' ? selection[key] : '';

describe('block rich text selection sets', () => {
    it('retains and resolves multiple selections with a primary entry', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const resolved = resolveSelectionSet(inserted.state, set);

        expect(resolved.primaryId).toBe('second');
        expect(resolved.entries).toEqual([
            {id: 'first', selection: caret(blockId, 1)},
            {id: 'second', selection: caret(blockId, 3)},
        ]);
        expect(primarySelection(resolved)).toEqual(caret(blockId, 3));
    });

    it('retains and resolves a linear block selection', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo\nthree', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = singleRetainedSelectionSet(
            pasted.state,
            {type: 'block', anchorBlockId: firstBlock, focusBlockId: secondBlock},
            'blocks',
        );

        expect(resolveSelectionSet(pasted.state, set)).toEqual({
            primaryId: 'blocks',
            entries: [
                {
                    id: 'blocks',
                    selection: {type: 'block', anchorBlockId: firstBlock, focusBlockId: secondBlock},
                },
            ],
        });
    });

    it('decorates block-level selections separately from text ranges', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo\nthree', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = resolveSelectionSet(
            pasted.state,
            singleRetainedSelectionSet(
                pasted.state,
                {type: 'block', anchorBlockId: firstBlock, focusBlockId: secondBlock},
                'blocks',
            ),
        );

        expect(decorationsForSelectionSet(pasted.state, set, {includePrimary: true})).toEqual(new Map());
        expect(blockLevelDecorationsForSelectionSet(pasted.state, set)).toEqual(
            new Map([
                [firstBlock, {selected: true, primary: true, focus: false}],
                [secondBlock, {selected: true, primary: true, focus: true}],
            ]),
        );
        expect(blockLevelDecorationsForSelectionSet(pasted.state, set).has(thirdBlock)).toBe(false);
    });

    it('decorates selected block subtrees at the root only', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'parent\nchild\nsibling', context);
        const [parentBlock, childBlock, siblingBlock] = rootBlockIds(pasted.state);
        const nested = moveBlock(
            pasted.state,
            childBlock,
            {type: 'child', parentBlockId: parentBlock, at: 'end'},
            context,
        );
        const set = resolveSelectionSet(
            nested.state,
            singleRetainedSelectionSet(
                nested.state,
                {type: 'block', anchorBlockId: parentBlock, focusBlockId: childBlock},
                'blocks',
            ),
        );

        expect(blockLevelDecorationsForSelectionSet(nested.state, set)).toEqual(
            new Map([[parentBlock, {selected: true, primary: true, focus: true}]]),
        );
        expect(blockLevelDecorationsForSelectionSet(nested.state, set).has(childBlock)).toBe(false);
        expect(blockLevelDecorationsForSelectionSet(nested.state, set).has(siblingBlock)).toBe(false);
    });

    it('deduplicates visible-coincident carets and keeps the logical first retained cursor', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx());
        const blockId = onlyBlock(inserted.state);
        const afterB = singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'after-b');
        const deleted = deleteBackward(inserted.state, caret(blockId, 2), ctx());
        const withCoincidentCaret = appendSelection(deleted.state, afterB, caret(blockId, 1), 'after-a');

        expect(lines(deleted.state)).toEqual(['ac']);
        const deduped = dedupeSelectionSet(deleted.state, withCoincidentCaret);
        const resolved = resolveSelectionSet(deleted.state, deduped);

        expect(resolved.entries).toHaveLength(1);
        expect(resolved.entries[0]).toEqual({id: 'after-a', selection: caret(blockId, 1)});
    });

    it('merges overlapping ranges for command execution', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', ctx());
        const blockId = onlyBlock(inserted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 4},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 3},
            focus: {blockId, offset: 5},
        };
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, first, 'first'),
            second,
            'second',
        );

        const merged = resolveSelectionSet(inserted.state, {
            primaryId: 'second',
            entries: mergeOverlappingRanges(inserted.state, set),
        });

        expect(merged.entries).toEqual([
            {
                id: 'second',
                selection: {
                    type: 'range',
                    anchor: {blockId, offset: 1},
                    focus: {blockId, offset: 5},
                },
            },
        ]);
    });

    it('merges overlapping ranges across blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd\nef', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 1},
            focus: {blockId: secondBlock, offset: 1},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: thirdBlock, offset: 1},
        };
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );

        const merged = resolveSelectionSet(pasted.state, {
            primaryId: 'second',
            entries: mergeOverlappingRanges(pasted.state, set),
        });

        expect(merged.entries).toEqual([
            {
                id: 'second',
                selection: {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 1},
                    focus: {blockId: thirdBlock, offset: 1},
                },
            },
        ]);
    });

    it('decorates boundary-only ranges with carets on both sides', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = resolveSelectionSet(
            pasted.state,
            singleRetainedSelectionSet(
                pasted.state,
                {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 3},
                    focus: {blockId: secondBlock, offset: 0},
                },
                'primary',
            ),
        );

        const decorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: false,
            includePrimaryBoundaryCaret: true,
        });

        expect(decorations.get(firstBlock)).toEqual({
            carets: [{id: 'primary', offset: 3, primary: true}],
            segments: [],
        });
        expect(decorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });
    });

    it('decorates a cross-block range endpoint just past a boundary', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = resolveSelectionSet(
            pasted.state,
            singleRetainedSelectionSet(
                pasted.state,
                {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 1},
                    focus: {blockId: secondBlock, offset: 0},
                },
                'primary',
            ),
        );

        const activeDecorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: false,
            includePrimaryBoundaryCaret: true,
        });
        expect(activeDecorations.get(firstBlock)).toBeUndefined();
        expect(activeDecorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });

        const inactiveDecorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: true,
            includePrimaryBoundaryCaret: true,
        });
        expect(inactiveDecorations.get(firstBlock)).toEqual({
            carets: [],
            segments: [{id: 'primary', startOffset: 1, endOffset: 3, primary: true}],
        });
        expect(inactiveDecorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });
    });

    it('flows a non-table custom selection through registry-aware helpers', () => {
        const registry = createBlockEditorRegistry([testZonePlugin()]);
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo\nthree', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const selection = testZoneSelection(firstBlock, secondBlock);

        const set = singleRetainedSelectionSetFromRegistry(registry, pasted.state, selection, 'zone');
        const resolved = resolveSelectionSetFromRegistry(registry, pasted.state, set);
        const decorations = blockLevelDecorationsForSelectionSetFromRegistry(registry, pasted.state, resolved);
        const deduped = dedupeSelectionSetFromRegistry(registry, pasted.state, {
            primaryId: 'zone-2',
            entries: [
                ...set.entries,
                {
                    id: 'zone-2',
                    selection: testZoneSelection(secondBlock, thirdBlock) as RetainedSelection,
                },
            ],
        });

        expect(primarySelection(resolved)).toEqual(selection);
        expect(decorations).toEqual(
            new Map([
                [firstBlock, {selected: true, primary: true, focus: false}],
                [secondBlock, {selected: true, primary: true, focus: true}],
            ]),
        );
        expect(resolveSelectionSetFromRegistry(registry, pasted.state, deduped).entries.map((entry) => entry.id)).toEqual([
            'zone',
            'zone-2',
        ]);
    });

    it('throws a clear selection plugin error when unknown custom selections bypass compatibility', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection = testZoneSelection(firstBlock, secondBlock);

        expect(() => singleRetainedSelectionSet(pasted.state, selection)).toThrow(BlockEditorSelectionPluginError);
    });
});
