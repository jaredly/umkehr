import {describe, expect, it} from 'vitest';
import {
    applyMany,
    blockContents,
    cachedState,
    insertBlockOps,
    materializedBlockParent,
    materializeFormattedBlocks,
    organizeState,
    orderedCharIdsForBlock,
    rootBlockIds,
    visibleBlockChildren,
    visibleBlockOutline,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    deleteBackward,
    deleteEmptyTableRowBackward,
    deleteTableRowHeaderBackward,
    deleteForward,
    exitEmptyLastTableRow,
    advanceFromTableCellEnd,
    addTableRow,
    commandApplied,
    convertBlockToTable,
    createMissingTableCell,
    createTable,
    indentBlock,
    insertText,
    insertInlineEmbed,
    insertImageBlock,
    insertPreviewBlock,
    insertTextWithMarkdownShortcuts,
    insertTextWithMarks,
    insertTextWithRetainedMarks,
    moveBlock,
    moveBlockToTableCellSlot,
    moveCellRectangleOutToNewTable,
    moveTableCell,
    moveTableCellRectangleContents,
    moveTableCellByTab,
    moveTableCellsOutAsBlocks,
    moveTableCellsToNewRow,
    moveTableRow,
    moveTableSelectionByArrow,
    pastePlainText,
    pastePlainTextWithMarkdownShortcuts,
    removeLinkMark,
    setCodeMark,
    setInlineEmbedDataByCharId,
    setBlockType,
    setLinkMark,
    setPreviewBlockData,
    splitBlock,
    splitTableRowHeader,
    splitTableTitleToParagraph,
    toggleMark,
    unindentBlock,
    closeRetainedInlineMarkSessions,
    type CommandContext,
} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext, toggleOnline} from './blockEditorRuntime';
import {
    annotationBodyBlockIds,
    annotationVirtualParents,
    createAnnotation,
    pasteAnnotationBodyTextWithMarkdownShortcuts,
} from './annotations';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {toggleMarkEverywhere} from './multiSelectionCommands';
import {retainSelection} from './retainedSelection';
import {caret, focusPoint, pointTextLength, type EditorSelection} from './selectionModel';
import {INLINE_EMBED_MARK, INLINE_EMBED_TEXT} from './inlineEmbeds';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: CachedState) => rootBlockIds(state)[0];

const lines = (state: CachedState) => rootBlockIds(state).map((id) => blockContents(state, id));

const outline = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => ({
        text: blockContents(state, block.id),
        depth: block.depth,
    }));

const expectCache = (state: CachedState) => {
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars, state.state.joins));
};

const typeWithMarkdownShortcuts = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    text: string,
    context: CommandContext = ctx(),
) => {
    let working = state;
    let selection: EditorSelection = caret(blockId, 0);
    const ops: ReturnType<typeof insertTextWithMarkdownShortcuts>['ops'] = [];
    for (const character of text) {
        const result = insertTextWithMarkdownShortcuts(working, selection, character, context);
        working = result.state;
        selection = result.selection;
        ops.push(...result.ops);
    }
    return {state: working, selection, ops};
};

const tableShape = (state: CachedState<RichBlockMeta>, tableId: string) => {
    const table = state.state.blocks[tableId];
    if (!table || table.meta.type !== 'table') throw new Error(`table ${tableId} not found`);
    const rows = visibleBlockChildren(state, tableId, annotationVirtualParents(state));
    return {
        table,
        rows,
        cells: rows.map((rowId) =>
            state.state.blocks[rowId]?.meta.type === 'table'
                ? []
                : visibleBlockChildren(state, rowId, annotationVirtualParents(state)),
        ),
    };
};

const insertParagraphChild = (
    state: CachedState<RichBlockMeta>,
    parentId: string,
    context: CommandContext = ctx(),
) => {
    const children = visibleBlockChildren(state, parentId, annotationVirtualParents(state));
    const previousChild = children[children.length - 1] ?? null;
    const ops = insertBlockOps(state, {
        actor: context.actor,
        parent: state.state.blocks[parentId].id,
        before: previousChild ? state.state.blocks[previousChild].id : null,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    const childId = ops[0].type === 'block' ? lamportToString(ops[0].block.id) : '';
    return {state: next, ops, childId};
};

const insertParagraphAfterBlockForTest = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    context: CommandContext = ctx(),
) => {
    const parent = materializedBlockParent(state, blockId, annotationVirtualParents(state));
    const parentId = lamportToString(parent);
    const siblings = visibleBlockChildren(state, parentId, annotationVirtualParents(state));
    const index = siblings.indexOf(blockId);
    const afterId = index >= 0 ? siblings[index + 1] ?? null : null;
    const ops = insertBlockOps(state, {
        actor: context.actor,
        parent,
        before: state.state.blocks[blockId].id,
        after: afterId ? state.state.blocks[afterId].id : null,
        meta: paragraphMeta(context.nextTs()),
        ts: context.nextTs(),
        virtualParents: annotationVirtualParents(state),
    });
    const next = applyMany(state, ops, annotationVirtualParents(state));
    const insertedId = ops[0].type === 'block' ? lamportToString(ops[0].block.id) : '';
    return {state: next, ops, blockId: insertedId};
};

describe('block rich text commands', () => {
    it.each([
        ['- ', {type: 'list_item', kind: 'unordered'}],
        ['* ', {type: 'list_item', kind: 'unordered'}],
        ['1. ', {type: 'list_item', kind: 'ordered'}],
        ['12. ', {type: 'list_item', kind: 'ordered'}],
        ['# ', {type: 'heading', level: 1}],
        ['## ', {type: 'heading', level: 2}],
        ['### ', {type: 'heading', level: 3}],
        ['[ ] ', {type: 'todo', checked: false}],
        ['[x] ', {type: 'todo', checked: true}],
        ['[X] ', {type: 'todo', checked: true}],
    ] as const)('converts typed markdown shortcut %s at the start of a paragraph', (shortcut, expectedMeta) => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = typeWithMarkdownShortcuts(state, blockId, shortcut);

        expect(blockContents(result.state, blockId)).toBe('');
        expect(result.state.state.blocks[blockId].meta).toMatchObject(expectedMeta);
        expect(result.selection).toEqual(caret(blockId, 0));
    });

    it.each(['0. ', '01. ', '#### ', 'abc- ', ' - '] as const)(
        'keeps non-matching markdown shortcut text %s literal',
        (text) => {
            const state = init();
            const blockId = onlyBlock(state);
            const result = typeWithMarkdownShortcuts(state, blockId, text);

            expect(blockContents(result.state, blockId)).toBe(text);
            expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'paragraph'});
            expect(focusPoint(result.selection)).toEqual({blockId, offset: text.length});
        },
    );

    it('converts typed backtick markdown into an inline code mark', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = typeWithMarkdownShortcuts(state, blockId, 'say `hello`');
        const formatted = materializeFormattedBlocks(result.state);

        expect(blockContents(result.state, blockId)).toBe('say hello');
        expect(formatted[0].runs).toEqual([
            {text: 'say ', marks: {}},
            {text: 'hello', marks: {code: true}},
        ]);
        expect(result.selection).toEqual(caret(blockId, 'say hello'.length));
    });

    it('inserts an inline embed as one marked character', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = insertInlineEmbed(
            state,
            caret(blockId, 0),
            {type: 'date', value: '2026-06-23'},
            ctx(),
        );
        const formatted = materializeFormattedBlocks(result.state);

        expect(blockContents(result.state, blockId)).toBe(INLINE_EMBED_TEXT);
        expect(formatted[0].runs).toEqual([
            {text: INLINE_EMBED_TEXT, marks: {[INLINE_EMBED_MARK]: {type: 'date', value: '2026-06-23'}}},
        ]);
        expect(result.selection).toEqual(caret(blockId, 1));
    });

    it('replaces selected text with an inline embed', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const typed = insertText(state, caret(blockId, 0), 'hello', ctx());
        const result = insertInlineEmbed(
            typed.state,
            {type: 'range', anchor: {blockId, offset: 1}, focus: {blockId, offset: 4}},
            {type: 'date', value: '2026-06-23'},
            ctx(),
        );

        expect(blockContents(result.state, blockId)).toBe(`h${INLINE_EMBED_TEXT}o`);
        expect(result.selection).toEqual(caret(blockId, 2));
    });

    it('deletes an inline embed as one visible character', () => {
        const state = init();
        const blockId = onlyBlock(state);
        let result = insertText(state, caret(blockId, 0), 'a', ctx());
        result = insertInlineEmbed(result.state, result.selection, {type: 'date', value: '2026-06-23'}, ctx());
        result = insertText(result.state, result.selection, 'b', ctx());

        const deletedBackward = deleteBackward(result.state, caret(blockId, 2), ctx());
        expect(blockContents(deletedBackward.state, blockId)).toBe('ab');
        expect(deletedBackward.selection).toEqual(caret(blockId, 1));

        const reinserted = insertInlineEmbed(deletedBackward.state, caret(blockId, 1), {type: 'date', value: '2026-06-23'}, ctx());
        const deletedForward = deleteForward(reinserted.state, caret(blockId, 1), ctx());
        expect(blockContents(deletedForward.state, blockId)).toBe('ab');
        expect(deletedForward.selection).toEqual(caret(blockId, 1));
    });

    it('updates an inline embed by char id after preceding text shifts its offset', () => {
        const state = init();
        const blockId = onlyBlock(state);
        let result = insertText(state, caret(blockId, 0), 'a', ctx());
        result = insertInlineEmbed(result.state, result.selection, {type: 'date', value: '2026-06-23'}, ctx());
        const embedCharId = orderedCharIdsForBlock(result.state, blockId, {visibleOnly: true})[1];
        result = insertText(result.state, caret(blockId, 0), 'zz', ctx());

        const updated = setInlineEmbedDataByCharId(
            result.state,
            embedCharId,
            {type: 'date', value: '2026-07-04'},
            ctx(),
        );
        if (!commandApplied(updated)) throw new Error('expected embed update');

        const formatted = materializeFormattedBlocks(updated.state);
        expect(blockContents(updated.state, blockId)).toBe(`zza${INLINE_EMBED_TEXT}`);
        expect(formatted[0].runs.at(-1)).toEqual({
            text: INLINE_EMBED_TEXT,
            marks: {[INLINE_EMBED_MARK]: {type: 'date', value: '2026-07-04'}},
        });
    });

    it('sets a language over an existing bare inline code mark', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        const typed = typeWithMarkdownShortcuts(state, blockId, '`const`', context);
        const language = setCodeMark(
            typed.state,
            {type: 'range', anchor: {blockId, offset: 0}, focus: {blockId, offset: 5}},
            'ts',
            context,
        );

        expect(materializeFormattedBlocks(language.state)[0].runs).toEqual([
            {text: 'const', marks: {code: 'typescript'}},
        ]);
    });

    it('does not convert markdown shortcuts in non-paragraph blocks', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const heading = setBlockType(state, blockId, {type: 'heading', level: 2, ts: '00001'});
        const result = typeWithMarkdownShortcuts(heading.state, blockId, '- ');

        expect(blockContents(result.state, blockId)).toBe('- ');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'heading', level: 2});
    });

    it.each([
        ['[ ] ', {checked: false}],
        ['[x] ', {checked: true}],
        ['[X] ', {checked: true}],
    ] as const)('converts typed todo shortcut %s at the start of an unordered list item', (shortcut, expected) => {
        const state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        const list = setBlockType(state, blockId, {
            type: 'list_item',
            kind: 'unordered',
            ts: context.nextTs(),
        });

        const result = typeWithMarkdownShortcuts(list.state, blockId, shortcut, context);

        expect(blockContents(result.state, blockId)).toBe('');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'todo', ...expected});
        expect(result.selection).toEqual(caret(blockId, 0));
    });

    it('does not convert typed todo shortcuts at the start of an ordered list item', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        const list = setBlockType(state, blockId, {
            type: 'list_item',
            kind: 'ordered',
            ts: context.nextTs(),
        });

        const result = typeWithMarkdownShortcuts(list.state, blockId, '[ ] ', context);

        expect(blockContents(result.state, blockId)).toBe('[ ] ');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'list_item', kind: 'ordered'});
    });

    it('converts markdown shortcuts in paragraph table cells', () => {
        const state = init();
        const context = ctx();
        const blockId = onlyBlock(state);
        const table = createTable(state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(table.state)[1];
        const cellId = tableShape(table.state, tableId).cells[0][0];

        const result = typeWithMarkdownShortcuts(table.state, cellId, '[x] ', context);

        expect(blockContents(result.state, cellId)).toBe('');
        expect(result.state.state.blocks[cellId].meta).toMatchObject({type: 'todo', checked: true});
        expect(result.selection).toEqual(caret(cellId, 0));
    });

    it('syncs markdown shortcut text deletion and metadata to a peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = typeWithMarkdownShortcuts(demo.left.state, blockId, '3. ', makeCommandContext(demo.left));

        const syncedRight = applyMany(demo.right.state, result.ops, annotationVirtualParents(demo.right.state));

        expect(blockContents(result.state, blockId)).toBe('');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'list_item', kind: 'ordered'});
        expect(blockContents(syncedRight, blockId)).toBe('');
        expect(syncedRight.state.blocks[blockId].meta).toMatchObject({type: 'list_item', kind: 'ordered'});
    });

    it.each([
        ['- item', {type: 'list_item', kind: 'unordered'}, 'item'],
        ['* item', {type: 'list_item', kind: 'unordered'}, 'item'],
        ['12. item', {type: 'list_item', kind: 'ordered'}, 'item'],
        ['# Heading', {type: 'heading', level: 1}, 'Heading'],
        ['## Heading', {type: 'heading', level: 2}, 'Heading'],
        ['### Heading', {type: 'heading', level: 3}, 'Heading'],
        ['[ ] todo', {type: 'todo', checked: false}, 'todo'],
        ['[x] todo', {type: 'todo', checked: true}, 'todo'],
        ['[X] todo', {type: 'todo', checked: true}, 'todo'],
        ['- ', {type: 'list_item', kind: 'unordered'}, ''],
    ] as const)('converts pasted markdown shortcut %s at block start', (text, expectedMeta, expectedText) => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = pastePlainTextWithMarkdownShortcuts(state, caret(blockId, 0), text, ctx());

        expect(blockContents(result.state, blockId)).toBe(expectedText);
        expect(result.state.state.blocks[blockId].meta).toMatchObject(expectedMeta);
        expect(result.selection).toEqual(caret(blockId, expectedText.length));
        expectCache(result.state);
    });

    it('converts every eligible pasted markdown line', () => {
        const state = init();
        const result = pastePlainTextWithMarkdownShortcuts(
            state,
            caret(onlyBlock(state), 0),
            '- one\nplain\n[x] done',
            ctx(),
        );
        const [first, second, third] = rootBlockIds(result.state);

        expect(lines(result.state)).toEqual(['one', 'plain', 'done']);
        expect(result.state.state.blocks[first].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(result.state.state.blocks[second].meta).toMatchObject({type: 'paragraph'});
        expect(result.state.state.blocks[third].meta).toMatchObject({type: 'todo', checked: true});
        expect(result.selection).toEqual(caret(third, 4));
        expectCache(result.state);
    });

    it('keeps pasted markdown shortcuts literal away from block start', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);
        const seeded = insertText(state, caret(blockId, 0), '- ', context);
        const result = pastePlainTextWithMarkdownShortcuts(seeded.state, caret(blockId, 2), 'item', context);

        expect(blockContents(result.state, blockId)).toBe('- item');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'paragraph'});
        expect(result.selection).toEqual(caret(blockId, 6));
        expectCache(result.state);
    });

    it('keeps pasted markdown shortcuts literal in code blocks', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const code = setBlockType(state, blockId, {type: 'code', language: '', ts: '00001'});
        const result = pastePlainTextWithMarkdownShortcuts(code.state, caret(blockId, 0), '- item', ctx());

        expect(blockContents(result.state, blockId)).toBe('- item');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'code'});
        expectCache(result.state);
    });

    it('applies pasted markdown shortcuts in table row headers as normal paragraph blocks', () => {
        const state = init();
        const context = ctx();
        const blockId = onlyBlock(state);
        const table = createTable(state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(table.state)[1];
        const rowId = tableShape(table.state, tableId).rows[0];

        const result = pastePlainTextWithMarkdownShortcuts(table.state, caret(rowId, 0), '# Header', context);

        expect(blockContents(result.state, rowId)).toBe('Header');
        expect(result.state.state.blocks[rowId].meta).toMatchObject({type: 'heading', level: 1});
    });

    it('syncs pasted markdown shortcut deletion and metadata to a peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = pastePlainTextWithMarkdownShortcuts(
            demo.left.state,
            caret(blockId, 0),
            '1. item',
            makeCommandContext(demo.left),
        );

        const syncedRight = applyMany(demo.right.state, result.ops, annotationVirtualParents(demo.right.state));

        expect(blockContents(result.state, blockId)).toBe('item');
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'list_item', kind: 'ordered'});
        expect(blockContents(syncedRight, blockId)).toBe('item');
        expect(syncedRight.state.blocks[blockId].meta).toMatchObject({type: 'list_item', kind: 'ordered'});
    });

    it('nests indented pasted markdown list items under previous list items', () => {
        const state = init();
        const result = pastePlainTextWithMarkdownShortcuts(
            state,
            caret(onlyBlock(state), 0),
            '- one\n  - two\n  [x] three\n- four',
            ctx(),
        );
        const [one, four] = rootBlockIds(result.state);
        const children = visibleBlockChildren(result.state, one, annotationVirtualParents(result.state));

        expect(blockContents(result.state, one)).toBe('one');
        expect(blockContents(result.state, four)).toBe('four');
        expect(children.map((id) => blockContents(result.state, id))).toEqual(['two', 'three']);
        expect(result.state.state.blocks[children[0]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(result.state.state.blocks[children[1]].meta).toMatchObject({type: 'todo', checked: true});
        expect(outline(result.state)).toEqual([
            {text: 'one', depth: 0},
            {text: 'two', depth: 1},
            {text: 'three', depth: 1},
            {text: 'four', depth: 0},
        ]);
        expectCache(result.state);
    });

    it('converts pasted markdown shortcuts in annotation bodies', () => {
        const context = ctx();
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const annotation = createAnnotation(
            inserted.state,
            {type: 'range', anchor: {blockId: onlyBlock(inserted.state), offset: 1}, focus: {blockId: onlyBlock(inserted.state), offset: 3}},
            'sidebar',
            context,
        );
        const bodyBlockId = annotation.bodyBlockId!;

        const result = pasteAnnotationBodyTextWithMarkdownShortcuts(
            annotation.state,
            caret(bodyBlockId, 0),
            '- note\n[x] done',
            context,
        );
        const bodyIds = annotationBodyBlockIds(result.state, annotation.annotationId!);

        expect(bodyIds.map((id) => blockContents(result.state, id))).toEqual(['note', 'done']);
        expect(result.state.state.blocks[bodyIds[0]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(result.state.state.blocks[bodyIds[1]].meta).toMatchObject({type: 'todo', checked: true});
        expect(result.selection).toEqual(caret(bodyIds[1], 4));
    });

    it('syncs metadata command updates to the peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = setBlockType(demo.left.state, blockId, {type: 'heading', level: 2, ts: '00001'});

        const synced = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });

        expect(synced.left.state.state.blocks[blockId].meta).toEqual({type: 'heading', level: 2, ts: '00001'});
        expect(synced.right.state.state.blocks[blockId].meta).toEqual({type: 'heading', level: 2, ts: '00001'});
    });

    it('converts an empty block to an image block', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = insertImageBlock(state, caret(blockId, 0), 'attachment-1', 'medium', ctx());

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({
            type: 'image',
            attachmentId: 'attachment-1',
            size: 'medium',
        });
        expect(result.selection).toEqual(caret(blockId, 0));
    });

    it('inserts an image block after a non-empty block', () => {
        const context = ctx();
        const typed = insertText(init(), caret(onlyBlock(init()), 0), 'hello', context);
        const textBlockId = onlyBlock(typed.state);
        const result = insertImageBlock(
            typed.state,
            caret(textBlockId, 2),
            'attachment-2',
            'large',
            context,
        );
        const ids = rootBlockIds(result.state);
        const imageBlockId = ids[1];

        expect(ids).toHaveLength(2);
        expect(blockContents(result.state, textBlockId)).toBe('hello');
        expect(result.state.state.blocks[imageBlockId].meta).toMatchObject({
            type: 'image',
            attachmentId: 'attachment-2',
            size: 'large',
        });
        expect(result.selection).toEqual(caret(imageBlockId, 0));
    });

    it('syncs image block metadata to the peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = insertImageBlock(
            demo.left.state,
            caret(blockId, 0),
            'attachment-3',
            'small',
            makeCommandContext(demo.left),
        );

        const synced = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });

        expect(synced.right.state.state.blocks[blockId].meta).toMatchObject({
            type: 'image',
            attachmentId: 'attachment-3',
            size: 'small',
        });
    });

    it('creates a paragraph after an image block on split', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);
        const image = insertImageBlock(state, caret(blockId, 0), 'attachment-4', 'medium', context);
        const result = splitBlock(image.state, caret(blockId, 0), context);
        const ids = rootBlockIds(result.state);
        const paragraphId = ids[1];

        expect(ids).toHaveLength(2);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'image'});
        expect(result.state.state.blocks[paragraphId].meta).toMatchObject({type: 'paragraph'});
        expect(result.selection).toEqual(caret(paragraphId, 0));
    });

    it('converts an empty block to a preview block', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const result = insertPreviewBlock(state, caret(blockId, 0), '', ctx());

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({
            type: 'preview',
            url: '',
            preview: null,
        });
        expect(result.selection).toEqual(caret(blockId, 0));
    });

    it('converts a non-empty block to preview and preserves subtitle text', () => {
        const context = ctx();
        const typed = insertText(init(), caret(onlyBlock(init()), 0), 'subtitle', context);
        const textBlockId = onlyBlock(typed.state);
        const result = insertPreviewBlock(
            typed.state,
            caret(textBlockId, 3),
            'https://example.test/page',
            context,
        );
        const ids = rootBlockIds(result.state);

        expect(ids).toEqual([textBlockId]);
        expect(blockContents(result.state, textBlockId)).toBe('subtitle');
        expect(result.state.state.blocks[textBlockId].meta).toMatchObject({
            type: 'preview',
            url: 'https://example.test/page',
            preview: null,
        });
        expect(result.selection).toEqual(caret(textBlockId, 0));
    });

    it('syncs preview metadata to the peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const inserted = insertPreviewBlock(
            demo.left.state,
            caret(blockId, 0),
            'https://example.test',
            makeCommandContext(demo.left),
        );
        const updated = setPreviewBlockData(
            inserted.state,
            blockId,
            'https://example.test',
            {title: 'Example', siteName: 'Example Site'},
            makeCommandContext(demo.left),
        );

        const synced = applyLocalChange(demo, {
            editorId: 'left',
            state: updated.state,
            selection: demo.left.selection,
            ops: [...inserted.ops, ...updated.ops],
        });

        expect(synced.right.state.state.blocks[blockId].meta).toMatchObject({
            type: 'preview',
            url: 'https://example.test',
            preview: {title: 'Example', siteName: 'Example Site'},
        });
    });

    it('updates preview URL through block metadata', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);
        const inserted = insertPreviewBlock(state, caret(blockId, 0), 'https://old.example', context);
        const result = setPreviewBlockData(
            inserted.state,
            blockId,
            'https://new.example',
            null,
            context,
        );

        expect(result.state.state.blocks[blockId].meta).toMatchObject({
            type: 'preview',
            url: 'https://new.example',
            preview: null,
        });
    });

    it('creates a paragraph after a preview block on split', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);
        const preview = insertPreviewBlock(state, caret(blockId, 0), 'https://example.test', context);
        const result = splitBlock(preview.state, caret(blockId, 0), context);
        const ids = rootBlockIds(result.state);
        const paragraphId = ids[1];

        expect(ids).toHaveLength(2);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'preview'});
        expect(result.state.state.blocks[paragraphId].meta).toMatchObject({type: 'paragraph'});
        expect(result.selection).toEqual(caret(paragraphId, 0));
    });

    it('creates a table block with normal row children and cells', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), ctx(), {rows: 2, columns: 3});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);

        expect(shape.table.meta.type).toBe('table');
        expect(shape.rows).toHaveLength(2);
        expect(shape.cells.map((row) => row.length)).toEqual([3, 3]);
        expect(shape.rows.every((rowId) => result.state.state.blocks[rowId].meta.type === 'paragraph')).toBe(true);
        expect(shape.cells.flat().every((cellId) => result.state.state.blocks[cellId].meta.type === 'paragraph')).toBe(true);
    });

    it('converts a text block to a table with the text as its title', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'Table title', context);

        result = convertBlockToTable(result.state, caret(blockId, 5), context, {rows: 2, columns: 2});

        expect(rootBlockIds(result.state)[0]).toBe(blockId);
        expect(result.state.state.blocks[blockId].meta.type).toBe('table');
        expect(blockContents(result.state, blockId)).toBe('Table title');
        expect(tableShape(result.state, blockId).cells.map((row) => row.length)).toEqual([2, 2]);
    });

    it('does not add default rows when converting a block that already has children', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'Parent\nChild', context);
        const [parentId, childId] = rootBlockIds(result.state);
        result = moveBlock(result.state, childId, {type: 'child', parentBlockId: parentId, at: 'end'}, context);

        result = convertBlockToTable(result.state, caret(parentId, 0), context, {rows: 2, columns: 2});

        expect(result.state.state.blocks[parentId].meta.type).toBe('table');
        expect(tableShape(result.state, parentId).rows).toEqual([childId]);
        expect(tableShape(result.state, parentId).cells).toEqual([[]]);
        expect(result.selection).toEqual(caret(parentId, 0));
    });

    it('orders table rows by normal block order under the row virtual parent', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const before = tableShape(result.state, tableId).rows;

        result = moveTableRow(result.state, tableId, before[1], 'up', context);

        expect(tableShape(result.state, tableId).rows).toEqual([before[1], before[0]]);
    });

    it('treats normal direct children under a table block as rows', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), ctx(), {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const tableChildren = visibleBlockChildren(result.state, tableId, annotationVirtualParents(result.state));
        const previousChild = tableChildren[tableChildren.length - 1] ?? null;
        const ops = insertBlockOps(result.state, {
            actor: 'left',
            parent: result.state.state.blocks[tableId].id,
            before: previousChild ? result.state.state.blocks[previousChild].id : null,
            meta: {type: 'paragraph', ts: '00050'},
            ts: '00051',
            virtualParents: annotationVirtualParents(result.state),
        });
        const state = applyMany(result.state, ops, annotationVirtualParents(result.state));

        const outline = visibleBlockOutline(state, annotationVirtualParents(state));
        const normalChild = ops[0].type === 'block' ? lamportToString(ops[0].block.id) : '';
        expect(outline.find((entry) => entry.id === normalChild)).toMatchObject({
            parentId: tableId,
            depth: 1,
        });
        expect(tableShape(state, tableId).rows).toContain(normalChild);
    });

    it('creates sparse missing cells at the clicked column position', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        result = addTableRow(result.state, tableId, context);
        const shape = tableShape(result.state, tableId);

        result = createMissingTableCell(result.state, shape.rows[0], 1, context);

        expect(tableShape(result.state, tableId).cells.map((row) => row.length)).toEqual([2, 1]);
    });

    it('allows a cell block to become a nested table', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const cellId = tableShape(result.state, tableId).cells[0][0];

        result = createTable(result.state, caret(cellId, 0), context, {rows: 1, columns: 2});

        expect(result.state.state.blocks[cellId].meta.type).toBe('table');
        expect(tableShape(result.state, cellId).cells[0]).toHaveLength(2);
    });

    it('syncs row reordering across replicas', () => {
        let demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });
        const tableId = rootBlockIds(demo.left.state)[1];
        const rows = tableShape(demo.left.state, tableId).rows;

        result = moveTableRow(demo.left.state, tableId, rows[1], 'up', context);
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: demo.left.selection,
            ops: result.ops,
        });

        expect(tableShape(demo.right.state, tableId).rows).toEqual(tableShape(demo.left.state, tableId).rows);
    });

    it('keeps Tab navigation working after generic row drag reorder', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const rows = tableShape(result.state, tableId).rows;

        result = moveBlock(result.state, rows[1], {type: 'before', targetBlockId: rows[0]}, context);
        const shape = tableShape(result.state, tableId);
        expect(shape.rows).toEqual([rows[1], rows[0]]);

        result = moveTableCellByTab(result.state, shape.cells[0][1], 'forward', context);

        expect(result.selection).toEqual(caret(shape.cells[1][0], 0));
    });

    it('moves table rows out of the table as normal blocks', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const rows = tableShape(result.state, tableId).rows;

        result = moveBlock(result.state, rows[1], {type: 'after', targetBlockId: tableId}, context);

        expect(tableShape(result.state, tableId).rows).toEqual([rows[0]]);
        expect(rootBlockIds(result.state)).toContain(rows[1]);
    });

    it('moves normal blocks into a table as rows', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const inserted = insertParagraphAfterBlockForTest(result.state, tableId, context);

        result = moveBlock(inserted.state, inserted.blockId, {type: 'after', targetBlockId: tableShape(inserted.state, tableId).rows[0]}, context);

        expect(tableShape(result.state, tableId).rows).toEqual([
            tableShape(inserted.state, tableId).rows[0],
            inserted.blockId,
        ]);
    });

    it('refuses to move rows under other rows as children', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const rows = tableShape(result.state, tableId).rows;

        result = moveBlock(result.state, rows[1], {type: 'child', parentBlockId: rows[0], at: 'end'}, context);

        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).rows).toEqual(rows);
    });

    it('moves across table cells with Tab and creates a row at the final cell', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];

        result = moveTableCellByTab(result.state, firstCell, 'forward', context);
        expect(result.selection).toEqual(caret(secondCell, 0));

        result = moveTableCellByTab(result.state, secondCell, 'backward', context);
        expect(result.selection).toEqual(caret(firstCell, 0));

        result = moveTableCellByTab(result.state, secondCell, 'forward', context);
        const shape = tableShape(result.state, tableId);
        expect(shape.rows).toHaveLength(2);
        expect(shape.cells[1]).toHaveLength(2);
        expect(result.selection).toEqual(caret(shape.cells[1][0], 0));
    });

    it('moves table cell carets vertically by row and column', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][1], 0), 'abcd', context);
        result = insertText(result.state, caret(shape.cells[1][1], 0), 'xy', context);

        const down = moveTableSelectionByArrow(result.state, caret(shape.cells[0][1], 3), 'down', context);
        expect(down).toMatchObject({ops: [], selection: caret(shape.cells[1][1], 2)});

        const up = moveTableSelectionByArrow(result.state, caret(shape.cells[1][1], 1), 'up', context);
        expect(up).toMatchObject({ops: [], selection: caret(shape.cells[0][1], 1)});
    });

    it('creates missing cells when vertical table navigation targets a sparse row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        result = createMissingTableCell(result.state, shape.rows[0], 1, context);
        shape = tableShape(result.state, tableId);

        const moved = moveTableSelectionByArrow(result.state, caret(shape.cells[0][1], 0), 'down', context);
        if (!moved) throw new Error('expected table move');

        const nextShape = tableShape(moved.state, tableId);
        expect(nextShape.cells.map((row) => row.length)).toEqual([2, 2]);
        expect(moved.selection).toEqual(caret(nextShape.cells[1][1], 0));
        expect(moved.ops.length).toBeGreaterThan(0);
    });

    it('creates missing target cells when moving a table rectangle into a sparse row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        result = createMissingTableCell(result.state, shape.rows[0], 1, context);
        shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][0], 0), 'A', context);
        result = insertText(result.state, caret(shape.cells[0][1], 0), 'B', context);

        const moved = moveTableCellRectangleContents(
            result.state,
            {
                type: 'table-cells',
                tableId,
                anchorCellId: shape.cells[0][0],
                focusCellId: shape.cells[0][1],
            },
            {rowId: shape.rows[1], index: 0},
            context,
        );
        if (!moved) throw new Error('expected rectangle move');

        const nextShape = tableShape(moved.state, tableId);
        expect(nextShape.cells.map((row) => row.length)).toEqual([2, 2]);
        expect(nextShape.cells.flat().map((cellId) => blockContents(moved.state, cellId))).toEqual([
            '',
            '',
            'A',
            'B',
        ]);
        expect(moved.selection).toEqual({
            type: 'table-cells',
            tableId,
            anchorCellId: nextShape.cells[1][0],
            focusCellId: nextShape.cells[1][1],
        });
    });

    it('treats row headers as table navigation targets', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.rows[0], 0), 'one', context);
        result = insertText(result.state, caret(shape.rows[1], 0), 'two', context);

        const down = moveTableSelectionByArrow(result.state, caret(shape.rows[0], 2), 'down', context);
        expect(down).toMatchObject({ops: [], selection: caret(shape.rows[1], 2)});

        const right = moveTableSelectionByArrow(result.state, caret(shape.rows[0], 3), 'right', context);
        expect(right).toMatchObject({ops: [], selection: caret(shape.cells[0][0], 0)});

        const left = moveTableSelectionByArrow(result.state, caret(shape.cells[0][0], 0), 'left', context);
        expect(left).toMatchObject({ops: [], selection: caret(shape.rows[0], 3)});

        const headerLeft = moveTableSelectionByArrow(result.state, caret(shape.rows[1], 0), 'left', context);
        expect(headerLeft).toMatchObject({ops: [], selection: caret(shape.cells[0][0], 0)});
    });

    it('wraps right from a final row cell to the next row header', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][0], 0), 'cell', context);

        const moved = moveTableSelectionByArrow(result.state, caret(shape.cells[0][0], 4), 'right', context);

        expect(moved).toMatchObject({ops: [], selection: caret(shape.rows[1], 0)});
    });

    it('navigates through nested blocks inside a cell before leaving the cell', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        const [firstCell, secondCell] = shape.cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'parent', context);
        const child = insertParagraphChild(result.state, firstCell, context);
        result = insertText(child.state, caret(child.childId, 0), 'child', context);

        const intoChild = moveTableSelectionByArrow(result.state, caret(firstCell, 6), 'right', context);
        expect(intoChild).toMatchObject({ops: [], selection: caret(child.childId, 0)});

        const outOfChild = moveTableSelectionByArrow(result.state, caret(child.childId, 5), 'right', context);
        expect(outOfChild).toMatchObject({ops: [], selection: caret(secondCell, 0)});

        const backToParent = moveTableSelectionByArrow(result.state, caret(child.childId, 0), 'left', context);
        expect(backToParent).toMatchObject({ops: [], selection: caret(firstCell, 6)});
    });

    it('advances from a cell end into an empty cell to the right on Enter', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);

        const advanced = advanceFromTableCellEnd(
            result.state,
            caret(firstCell, pointTextLength(result.state, firstCell)),
            context,
        );

        expect(advanced).toMatchObject({ops: [], selection: caret(secondCell, 0)});
    });

    it('creates a new row on Enter at the end of a row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        result = createMissingTableCell(result.state, shape.rows[1], 1, context);
        shape = tableShape(result.state, tableId);
        const firstRowCell = shape.cells[0][0];
        result = insertText(result.state, caret(firstRowCell, 0), 'one', context);

        const advanced = advanceFromTableCellEnd(
            result.state,
            caret(firstRowCell, pointTextLength(result.state, firstRowCell)),
            context,
        );

        expect(advanced).not.toBeNull();
        if (!advanced) return;
        const nextShape = tableShape(advanced.state, tableId);
        expect(nextShape.rows).toHaveLength(3);
        expect(nextShape.rows[1]).not.toBe(shape.rows[1]);
        expect(nextShape.cells[1]).toHaveLength(2);
        expect(advanced.selection).toEqual(caret(nextShape.cells[1][0], 0));
    });

    it('joins cells in the same row but blocks accidental joins across rows', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [rowOneA, rowOneB] = shape.cells[0];
        const [rowTwoA, rowTwoB] = shape.cells[1];
        result = insertText(result.state, caret(rowOneA, 0), 'A', context);
        result = insertText(result.state, caret(rowOneB, 0), 'B', context);
        result = insertText(result.state, caret(rowTwoA, 0), 'C', context);

        result = deleteBackward(result.state, caret(rowOneB, 0), context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([rowOneA]);
        expect(blockContents(result.state, rowOneA)).toBe('AB');

        result = deleteBackward(result.state, caret(rowTwoA, 0), context);
        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).cells[1]).toEqual([rowTwoA, rowTwoB]);

        result = deleteForward(result.state, caret(rowOneA, pointTextLength(result.state, rowOneA)), context);
        expect(result.ops).toEqual([]);
    });

    it('moves Backspace at a non-first empty cell start to the previous cell end', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);

        const moved = deleteEmptyTableRowBackward(result.state, caret(secondCell, 0), context);

        expect(moved).toMatchObject({ops: [], selection: caret(firstCell, 3)});
    });

    it('deletes an all-empty table row on Backspace at the first cell start', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][1], 0), 'prev', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(shape.cells[1][0], 0), context);
        if (!('state' in deleted)) throw new Error('expected delete command');

        expect(tableShape(deleted.state, tableId).rows).toEqual([shape.rows[0]]);
        expect(deleted.selection).toEqual(caret(shape.cells[0][1], 4));
    });

    it('does not delete a row on Backspace when any row cell has content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[1][1], 0), 'x', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(shape.cells[1][0], 0), context);

        expect(commandApplied(deleted)).toBe(false);
    });

    it('converts a table to a paragraph when Backspace deletes its only empty row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [row] = tableShape(result.state, tableId).rows;

        const converted = deleteEmptyTableRowBackward(
            result.state,
            caret(tableShape(result.state, tableId).cells[0][0], 0),
            context,
        );
        if (!('state' in converted)) throw new Error('expected convert command');

        expect(converted.state.state.blocks[tableId].meta).toMatchObject({type: 'paragraph'});
        expect(converted.state.state.blocks[row].deleted).toBe(true);
        expect(converted.selection).toEqual(caret(tableId, 0));
    });

    it('exits an empty last table row on Enter by creating a paragraph after the table', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.cells[0][0], 0), 'keep', context);

        const exited = exitEmptyLastTableRow(result.state, caret(shape.cells[1][0], 0), context);
        if (!('state' in exited)) throw new Error('expected exit command');

        expect(tableShape(exited.state, tableId).rows).toEqual([shape.rows[0]]);
        const roots = rootBlockIds(exited.state);
        expect(roots[roots.indexOf(tableId) + 1]).toBe(exited.selection.type === 'caret' ? exited.selection.point.blockId : '');
        expect(exited.state.state.blocks[focusPoint(exited.selection).blockId].meta).toMatchObject({type: 'paragraph'});
    });

    it('does not exit the only table row on Enter', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const cellId = tableShape(result.state, tableId).cells[0][0];

        const exited = exitEmptyLastTableRow(result.state, caret(cellId, 0), context);

        expect(commandApplied(exited)).toBe(false);
    });

    it('splits a table title into a following paragraph with trailing text', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        result = insertText(result.state, caret(tableId, 0), 'AlphaBeta', context);

        const split = splitTableTitleToParagraph(result.state, caret(tableId, 5), context);
        if (!('state' in split)) throw new Error('expected split command');

        const roots = rootBlockIds(split.state);
        const paragraphId = roots[roots.indexOf(tableId) + 1];
        expect(blockContents(split.state, tableId)).toBe('Alpha');
        expect(blockContents(split.state, paragraphId)).toBe('Beta');
        expect(split.state.state.blocks[paragraphId].meta).toMatchObject({type: 'paragraph'});
        expect(split.selection).toEqual(caret(paragraphId, 0));
    });

    it('splits a row header into a following row with empty cells', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const rowId = tableShape(result.state, tableId).rows[0];
        result = insertText(result.state, caret(rowId, 0), 'AlphaBeta', context);

        const split = splitTableRowHeader(result.state, caret(rowId, 5), context);
        if (!('state' in split)) throw new Error('expected row split');

        const shape = tableShape(split.state, tableId);
        const newRowId = shape.rows[1];
        expect(shape.rows).toHaveLength(2);
        expect(blockContents(split.state, rowId)).toBe('Alpha');
        expect(blockContents(split.state, newRowId)).toBe('Beta');
        expect(shape.cells[1]).toHaveLength(2);
        expect(shape.cells[1].every((cellId) => blockContents(split.state, cellId) === '')).toBe(true);
        expect(split.selection).toEqual(caret(newRowId, 0));
    });

    it('splits a row header at the start by moving all text into the following row', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const rowId = tableShape(result.state, tableId).rows[0];
        result = insertText(result.state, caret(rowId, 0), 'Alpha', context);

        const split = splitTableRowHeader(result.state, caret(rowId, 0), context);
        if (!('state' in split)) throw new Error('expected row split');

        const shape = tableShape(split.state, tableId);
        expect(blockContents(split.state, rowId)).toBe('');
        expect(blockContents(split.state, shape.rows[1])).toBe('Alpha');
        expect(split.selection).toEqual(caret(shape.rows[1], 0));
    });

    it('deletes an all-empty row from an empty row header', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);

        const deleted = deleteTableRowHeaderBackward(result.state, caret(shape.rows[1], 0), context);
        if (!('state' in deleted)) throw new Error('expected row delete');

        expect(tableShape(deleted.state, tableId).rows).toEqual([shape.rows[0]]);
        expect(deleted.selection).toEqual(caret(shape.rows[0], 0));
    });

    it('converts a table to a paragraph when Backspace deletes its only empty row header', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        const result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const rowId = tableShape(result.state, tableId).rows[0];

        const deleted = deleteTableRowHeaderBackward(result.state, caret(rowId, 0), context);
        if (!('state' in deleted)) throw new Error('expected table convert');

        expect(deleted.state.state.blocks[tableId].meta).toMatchObject({type: 'paragraph'});
        expect(deleted.state.state.blocks[rowId].deleted).toBe(true);
        expect(deleted.selection).toEqual(caret(tableId, 0));
    });

    it('moves from an empty row header to the previous row header when cells contain content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.rows[0], 0), 'prev', context);
        result = insertText(result.state, caret(shape.cells[1][0], 0), 'cell', context);

        const moved = deleteTableRowHeaderBackward(result.state, caret(shape.rows[1], 0), context);
        if (!('state' in moved)) throw new Error('expected row-header move');

        expect(tableShape(moved.state, tableId).rows).toEqual(shape.rows);
        expect(moved.ops).toEqual([]);
        expect(moved.selection).toEqual(caret(shape.rows[0], 4));
    });

    it('moves from the first empty row header to the table title when cells contain content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(tableId, 0), 'T', context);
        result = insertText(result.state, caret(shape.cells[0][0], 0), 'cell', context);

        const moved = deleteTableRowHeaderBackward(result.state, caret(shape.rows[0], 0), context);
        if (!('state' in moved)) throw new Error('expected row-header move');

        expect(moved.ops).toEqual([]);
        expect(moved.selection).toEqual(caret(tableId, 1));
    });

    it('does not delete a first-cell empty row when the row header has content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        result = insertText(result.state, caret(shape.rows[1], 0), 'header', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(shape.cells[1][0], 0), context);

        expect(typeof deleted).toBe('symbol');
    });

    it('does not delete a row when a cell child subtree has content', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        const cell = shape.cells[1][0];
        const child = insertParagraphChild(result.state, cell, context);
        result = insertText(child.state, caret(child.childId, 0), 'nested', context);

        const deleted = deleteEmptyTableRowBackward(result.state, caret(cell, 0), context);

        expect(typeof deleted).toBe('symbol');
    });

    it('moves table cells within and across rows with splice semantics', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 3});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [a, b, c] = shape.cells[0];
        const [d, e, f] = shape.cells[1];

        result = moveTableCell(result.state, a, {rowId: shape.rows[0], index: 2}, context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([b, c, a]);

        result = moveTableCell(result.state, e, {rowId: shape.rows[0], index: 1}, context);
        shape = tableShape(result.state, tableId);
        expect(shape.cells[0]).toEqual([b, e, c, a]);
        expect(shape.cells[1]).toEqual([d, f]);
    });

    it('moves a table cell with its child subtree', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [firstCell, secondCell] = shape.cells[0];
        const child = insertParagraphChild(result.state, firstCell, context);
        result = insertText(child.state, caret(child.childId, 0), 'child', context);

        result = moveTableCell(result.state, firstCell, {rowId: shape.rows[0], index: 2}, context);
        shape = tableShape(result.state, tableId);

        expect(shape.cells[0]).toEqual([secondCell, firstCell]);
        expect(lamportToString(materializedBlockParent(result.state, child.childId, annotationVirtualParents(result.state)))).toBe(firstCell);
        expect(blockContents(result.state, child.childId)).toBe('child');
    });

    it('moves selected cells into a new row without padding missing columns', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 3});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [a, b, c] = shape.cells[0];
        const [d, e, f] = shape.cells[1];

        result = moveTableCellsToNewRow(
            result.state,
            [b, e],
            {tableId, beforeRowId: shape.rows[0], afterRowId: shape.rows[1]},
            context,
        );
        shape = tableShape(result.state, tableId);

        expect(shape.rows).toHaveLength(3);
        expect(shape.cells).toEqual([[a, c], [b, e], [d, f]]);
    });

    it('moves table cells out as normal blocks while preserving metadata and children', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        let shape = tableShape(result.state, tableId);
        const [firstCell, secondCell] = shape.cells[0];
        result = setBlockType(result.state, firstCell, {type: 'heading', level: 2, ts: context.nextTs()});
        const child = insertParagraphChild(result.state, firstCell, context);
        result = insertText(child.state, caret(child.childId, 0), 'child', context);

        result = moveTableCellsOutAsBlocks(result.state, [firstCell], {type: 'after', targetBlockId: tableId}, context);
        shape = tableShape(result.state, tableId);

        expect(shape.rows).toHaveLength(1);
        expect(shape.cells[0]).toEqual([secondCell]);
        expect(rootBlockIds(result.state)).toContain(firstCell);
        expect(result.state.state.blocks[firstCell].meta).toMatchObject({type: 'heading', level: 2});
        expect(lamportToString(materializedBlockParent(result.state, child.childId, annotationVirtualParents(result.state)))).toBe(firstCell);
        expect(blockContents(result.state, child.childId)).toBe('child');
    });

    it('moves a rectangular cell selection out to a new table with row parents', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 2, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const shape = tableShape(result.state, tableId);
        const [[a, b], [c, d]] = shape.cells;

        const moved = moveCellRectangleOutToNewTable(
            result.state,
            {type: 'table-cells', tableId, anchorCellId: a, focusCellId: d},
            {type: 'after', targetBlockId: tableId},
            context,
        );
        if (!moved) throw new Error('expected rectangular move');
        result = moved;
        const oldShape = tableShape(result.state, tableId);
        const newTableId = rootBlockIds(result.state).find(
            (id) => id !== tableId && result.state.state.blocks[id]?.meta.type === 'table',
        );

        expect(oldShape.rows).toEqual(shape.rows);
        expect(oldShape.cells).toEqual([[], []]);
        expect(newTableId).toBeTruthy();
        expect(tableShape(result.state, newTableId!).cells).toEqual([[a, b], [c, d]]);
    });

    it('moves a normal block into a missing table cell slot', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const inserted = insertParagraphAfterBlockForTest(result.state, tableId, context);

        result = moveBlockToTableCellSlot(inserted.state, inserted.blockId, {rowId: tableShape(inserted.state, tableId).rows[0], index: 2}, context);
        const shape = tableShape(result.state, tableId);

        expect(shape.cells[0]).toHaveLength(3);
        expect(shape.cells[0][2]).toBe(inserted.blockId);
    });

    it('does not indent table cells out of their structural rows', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [, secondCell] = tableShape(result.state, tableId).cells[0];

        result = indentBlock(result.state, secondCell, context);

        expect(result.ops).toEqual([]);
        expect(tableShape(result.state, tableId).cells[0]).toContain(secondCell);
    });

    it('indents child blocks inside table cells normally', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(result.state)[1];
        const cell = tableShape(result.state, tableId).cells[0][0];
        const firstChild = insertParagraphChild(result.state, cell, context);
        const secondChild = insertParagraphChild(firstChild.state, cell, context);

        result = indentBlock(secondChild.state, secondChild.childId, context);

        expect(result.ops.length).toBeGreaterThan(0);
        expect(lamportToString(materializedBlockParent(result.state, secondChild.childId, annotationVirtualParents(result.state)))).toBe(firstChild.childId);
    });

    it('applies multi-selection marks across table cells', () => {
        const demo = createDemoState();
        const context = ctx();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = createTable(demo.left.state, caret(blockId, 0), context, {rows: 1, columns: 2});
        const tableId = rootBlockIds(result.state)[1];
        const [firstCell, secondCell] = tableShape(result.state, tableId).cells[0];
        result = insertText(result.state, caret(firstCell, 0), 'one', context);
        result = insertText(result.state, caret(secondCell, 0), 'two', context);

        const marked = toggleMarkEverywhere(
            result.state,
            {
                primaryId: 'one',
                entries: [
                    {
                        id: 'one',
                        selection: retainSelection(result.state, {
                            type: 'range',
                            anchor: {blockId: firstCell, offset: 0},
                            focus: {blockId: firstCell, offset: 3},
                        }),
                    },
                    {
                        id: 'two',
                        selection: retainSelection(result.state, {
                            type: 'range',
                            anchor: {blockId: secondCell, offset: 0},
                            focus: {blockId: secondCell, offset: 3},
                        }),
                    },
                ],
            },
            'bold',
            context,
        );

        const formatted = materializeFormattedBlocks(marked.state, annotationVirtualParents(marked.state));
        expect(formatted.find((block) => block.id === firstCell)?.runs).toEqual([
            {text: 'one', marks: {bold: true}},
        ]);
        expect(formatted.find((block) => block.id === secondCell)?.runs).toEqual([
            {text: 'two', marks: {bold: true}},
        ]);
    });

    it('turns empty non-paragraph Enter into paragraph metadata', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const typed = setBlockType(demo.left.state, blockId, {type: 'blockquote', ts: '00001'});

        const result = splitBlock(typed.state, caret(blockId, 0), ctx());

        expect(rootBlockIds(result.state)).toHaveLength(1);
        expect(result.state.state.blocks[blockId].meta).toMatchObject({type: 'paragraph'});
    });

    it('preserves metadata on non-empty splits', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'Title', ctx());
        result = setBlockType(result.state, blockId, {type: 'heading', level: 1, ts: '00010'});

        result = splitBlock(result.state, caret(blockId, 2), ctx());

        const [first, second] = rootBlockIds(result.state);
        expect(result.state.state.blocks[first].meta).toMatchObject({type: 'heading', level: 1});
        expect(result.state.state.blocks[second].meta).toMatchObject({type: 'heading', level: 1});
        expect(lines(result.state)).toEqual(['Ti', 'tle']);
    });

    it('inserts newline text instead of splitting code blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});

        result = splitBlock(result.state, caret(blockId, 1), ctx());

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(lines(result.state)).toEqual(['a\nb']);
    });

    it('exits a code block on Enter at a trailing blank line', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});
        result = splitBlock(result.state, caret(blockId, 2), ctx());

        result = splitBlock(result.state, result.selection, ctx());

        const [code, paragraph] = rootBlockIds(result.state);
        expect(result.selection).toEqual(caret(paragraph, 0));
        expect(lines(result.state)).toEqual(['ab', '']);
        expect(result.state.state.blocks[code].meta).toMatchObject({type: 'code'});
        expect(result.state.state.blocks[paragraph].meta).toMatchObject({type: 'paragraph'});
    });

    it('keeps Shift+Enter as a newline inside code blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'ab', ctx());
        result = setBlockType(result.state, blockId, {type: 'code', language: 'ts', ts: '00010'});
        result = splitBlock(result.state, caret(blockId, 2), ctx());

        result = splitBlock(result.state, result.selection, ctx(), {forceCodeNewline: true});

        expect(rootBlockIds(result.state)).toEqual([blockId]);
        expect(lines(result.state)).toEqual(['ab\n\n']);
    });

    it('inserts text and deletes ordinary backspace inside a block', () => {
        let state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        let result = insertText(state, caret(blockId, 0), 'abc', context);
        expect(lines(result.state)).toEqual(['abc']);
        expect(result.selection).toEqual(caret(blockId, 3));

        result = deleteBackward(result.state, caret(blockId, 2), context);
        expect(lines(result.state)).toEqual(['ac']);
        expect(result.selection).toEqual(caret(blockId, 1));
        expectCache(result.state);
    });

    it('calculates middle Backspace deletion and caret shift without DOM state', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteBackward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['acd']);
        expect(result.selection).toEqual(caret(blockId, 1));

        result = insertText(result.state, result.selection, 'X', context);

        expect(lines(result.state)).toEqual(['aXcd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('calculates middle Delete deletion without moving the caret', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteForward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['abd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('splits at start, middle, and end', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', context);
        const blockId = onlyBlock(result.state);

        result = splitBlock(result.state, caret(blockId, 3), context);
        expect(lines(result.state)).toEqual(['abc', 'def']);

        const first = rootBlockIds(result.state)[0];
        result = splitBlock(result.state, caret(first, 0), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def']);

        const last = rootBlockIds(result.state)[2];
        result = splitBlock(result.state, caret(last, 3), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def', '']);
        expectCache(result.state);
    });

    it('joins with the previous block on backspace at block start', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const second = rootBlockIds(result.state)[1];

        result = deleteBackward(result.state, caret(second, 0), context);
        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(rootBlockIds(result.state)[0], 3));
        expectCache(result.state);
    });

    it('joins with the next block on Delete at block end', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const first = rootBlockIds(result.state)[0];

        result = deleteForward(result.state, caret(first, 3), context);

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(first, 3));
        expectCache(result.state);
    });

    it('joins blocks after Backspace deletes a cross-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 2},
            focus: {blockId: second, offset: 1},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('joins blocks after Delete deletes a cross-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 2},
            focus: {blockId: second, offset: 1},
        };

        result = deleteForward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('joins a boundary-only cross-block selection', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 3},
            focus: {blockId: second, offset: 0},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(first, 3));
        expectCache(result.state);
    });

    it('joins cross-block selection even when the first block is fully selected', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 0},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['two']);
        expect(result.selection).toEqual(caret(first, 0));
        expectCache(result.state);
    });

    it('joins every visible boundary in a three-block range', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd\nef', context);
        const [first, , third] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 1},
            focus: {blockId: third, offset: 1},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['af']);
        expect(result.selection).toEqual(caret(first, 1));
        expectCache(result.state);
    });

    it('joins a reversed cross-block selection', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: second, offset: 1},
            focus: {blockId: first, offset: 2},
        };

        result = deleteBackward(result.state, selection, context);

        expect(lines(result.state)).toEqual(['onwo']);
        expect(result.selection).toEqual(caret(first, 2));
        expectCache(result.state);
    });

    it('splits pasted newlines into blocks', () => {
        const state = init();
        const result = pastePlainText(state, caret(onlyBlock(state), 0), 'a\nb\n', ctx());

        expect(lines(result.state)).toEqual(['a', 'b', '']);
        expectCache(result.state);
    });

    it('toggles bold over a multi-block selection using per-block marks', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 2},
        };

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {bold: true}}],
            [{text: 'cd', marks: {bold: true}}],
        ]);

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {}}],
            [{text: 'cd', marks: {}}],
        ]);
        expectCache(result.state);
    });

    it('inserts text with pending boolean marks at a collapsed caret', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'ab', context);
        const blockId = onlyBlock(result.state);

        result = insertTextWithMarks(result.state, caret(blockId, 1), 'X', ['bold'], context);

        expect(materializeFormattedBlocks(result.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'X', marks: {bold: true}},
            {text: 'b', marks: {}},
        ]);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('can apply multiple pending boolean marks to inserted text', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);

        const result = insertTextWithMarks(state, caret(blockId, 0), 'X', ['bold', 'italic'], context);

        expect(materializeFormattedBlocks(result.state)[0].runs).toEqual([
            {text: 'X', marks: {bold: true, italic: true}},
        ]);
        expectCache(result.state);
    });

    it('uses one retained mark while typing at a collapsed caret and closes it with bounded ops', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'ab', context);
        const blockId = onlyBlock(result.state);

        const first = insertTextWithRetainedMarks(result.state, caret(blockId, 1), 'X', ['bold'], [], context);
        const second = insertTextWithRetainedMarks(
            first.state,
            first.selection,
            'Y',
            ['bold'],
            first.sessions,
            context,
        );
        const closed = closeRetainedInlineMarkSessions(second.state, second.sessions, 'bold', context);

        expect(first.ops.filter((op) => op.type === 'mark')).toHaveLength(1);
        expect(second.ops.filter((op) => op.type === 'mark')).toHaveLength(0);
        expect(closed.ops.filter((op) => op.type === 'mark')).toHaveLength(2);
        expect(materializeFormattedBlocks(closed.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'XY', marks: {bold: true}},
            {text: 'b', marks: {}},
        ]);
        expectCache(closed.state);
    });

    it('supports retained marks at the end of an empty block', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);

        const inserted = insertTextWithRetainedMarks(state, caret(blockId, 0), 'XY', ['bold'], [], context);
        const closed = closeRetainedInlineMarkSessions(inserted.state, inserted.sessions, 'bold', context);

        expect(materializeFormattedBlocks(closed.state)[0].runs).toEqual([
            {text: 'XY', marks: {bold: true}},
        ]);
        expectCache(closed.state);
    });

    it('toggles strikethrough over a range', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'strike', context);
        const blockId = onlyBlock(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 0},
            focus: {blockId, offset: 6},
        };

        result = toggleMark(result.state, selection, 'strikethrough', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'strike', marks: {strikethrough: true}}],
        ]);

        result = toggleMark(result.state, selection, 'strikethrough', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'strike', marks: {}}],
        ]);
    });

    it('sets, updates, and removes non-stacking link marks', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'link', context);
        const blockId = onlyBlock(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 0},
            focus: {blockId, offset: 4},
        };

        result = setLinkMark(result.state, selection, 'https://one.test', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {link: 'https://one.test'}}],
        ]);

        result = setLinkMark(result.state, selection, 'https://two.test', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {link: 'https://two.test'}}],
        ]);
        expect(materializeFormattedBlocks(result.state)[0].runs[0].stackedMarks?.link).toBeUndefined();

        result = removeLinkMark(result.state, selection, context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'link', marks: {}}],
        ]);
    });

    it('sets links over a multi-block selection using per-block marks', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 2},
        };

        result = setLinkMark(result.state, selection, 'https://example.test', context);

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {link: 'https://example.test'}}],
            [{text: 'cd', marks: {link: 'https://example.test'}}],
        ]);
    });

    it('moves root blocks with a block:move op', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, , third] = rootBlockIds(result.state);

        result = moveBlock(result.state, first, {type: 'after', targetBlockId: third}, context);
        expect(lines(result.state)).toEqual(['b', 'c', 'a']);
        expectCache(result.state);
    });

    it('moves a peer-created second root block before the first root block', () => {
        let demo = createDemoState();
        const first = onlyBlock(demo.left.state);
        const pasted = pastePlainText(demo.left.state, caret(first, 0), 'a\nb', makeCommandContext(demo.left));
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: pasted.state,
            selection: demo.left.selection,
            ops: pasted.ops,
        });
        const [rightFirst, rightSecond] = rootBlockIds(demo.right.state);

        const moved = moveBlock(
            demo.right.state,
            rightSecond,
            {type: 'before', targetBlockId: rightFirst},
            makeCommandContext(demo.right),
        );

        expect(lines(moved.state)).toEqual(['b', 'a']);
        expect(moved.ops).toHaveLength(1);
        expectCache(moved.state);
    });

    it('moves a peer-created third root block before the first root block on the first attempt', () => {
        let demo = createDemoState();
        const first = onlyBlock(demo.left.state);
        const pasted = pastePlainText(demo.left.state, caret(first, 0), 'a\nb\nc', makeCommandContext(demo.left));
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: pasted.state,
            selection: demo.left.selection,
            ops: pasted.ops,
        });
        const [rightFirst, , rightThird] = rootBlockIds(demo.right.state);

        const moved = moveBlock(
            demo.right.state,
            rightThird,
            {type: 'before', targetBlockId: rightFirst},
            makeCommandContext(demo.right),
        );

        expect(lines(moved.state)).toEqual(['c', 'a', 'b']);
        expect(moved.ops).toHaveLength(1);
        expectCache(moved.state);
    });

    it('moves a root block as the first child of an empty block', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [first, second] = rootBlockIds(result.state);

        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, second)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a root block as the last child of a parent with children', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        result = moveBlock(result.state, third, {type: 'child', parentBlockId: first, at: 'end'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a nested block back to root', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);

        result = moveBlock(result.state, second, {type: 'after', targetBlockId: third}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 0},
            {text: 'b', depth: 0},
        ]);
        expect(materializedBlockParent(result.state, second)).toEqual([0, 'root']);
        expectCache(result.state);
    });

    it('moves a nested block under another nested parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: first, at: 'end'}, context);

        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: third, at: 'start'}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 2},
        ]);
        expect(materializedBlockParent(result.state, fourth)).toEqual(result.state.state.blocks[third].id);
        expectCache(result.state);
    });

    it('moves a parent with children as one subtree', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);

        result = moveBlock(result.state, second, {type: 'after', targetBlockId: fourth}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'd', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual(result.state.state.blocks[second].id);
        expectCache(result.state);
    });

    it('rejects invalid and no-op block moves', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, second, third] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        const base = result.state;

        expect(moveBlock(base, first, {type: 'child', parentBlockId: first, at: 'start'}, context).ops).toEqual([]);
        expect(moveBlock(base, first, {type: 'child', parentBlockId: third, at: 'start'}, context).ops).toEqual([]);
        expect(moveBlock(base, first, {type: 'before', targetBlockId: second}, context).ops).toEqual([]);
        expect(moveBlock(base, second, {type: 'child', parentBlockId: first, at: 'start'}, context).ops).toEqual([]);
        expectCache(base);
    });

    it('moves children that are visibly spliced through a joined parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = deleteForward(result.state, caret(first, 1), context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
        ]);

        result = moveBlock(result.state, fourth, {type: 'before', targetBlockId: third}, context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'd', depth: 1},
            {text: 'c', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, fourth)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('moves a visibly spliced child out to root', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [first, second, third, fourth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = deleteForward(result.state, caret(first, 1), context);

        result = moveBlock(result.state, third, {type: 'after', targetBlockId: first}, context);

        expect(outline(result.state)).toEqual([
            {text: 'ab', depth: 0},
            {text: 'd', depth: 1},
            {text: 'c', depth: 0},
        ]);
        expect(materializedBlockParent(result.state, third)).toEqual([0, 'root']);
        expectCache(result.state);
    });

    it('drops an outside block into the middle of children spliced through a deleted parent', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd\ne', context);
        const [first, second, third, fourth, fifth] = rootBlockIds(result.state);
        result = moveBlock(result.state, second, {type: 'child', parentBlockId: first, at: 'start'}, context);
        result = moveBlock(result.state, third, {type: 'child', parentBlockId: second, at: 'start'}, context);
        result = moveBlock(result.state, fourth, {type: 'child', parentBlockId: second, at: 'end'}, context);
        result = {
            ...result,
            state: applyMany(result.state, [{type: 'block:delete', id: result.state.state.blocks[second].id}]),
        };

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
            {text: 'e', depth: 0},
        ]);

        result = moveBlock(result.state, fifth, {type: 'before', targetBlockId: fourth}, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'c', depth: 1},
            {text: 'e', depth: 1},
            {text: 'd', depth: 1},
        ]);
        expect(materializedBlockParent(result.state, fifth)).toEqual(result.state.state.blocks[first].id);
        expectCache(result.state);
    });

    it('indents a block under its previous visible sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [, second] = rootBlockIds(result.state);

        result = indentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 0},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('indents a block when an annotation body exists', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [first, second] = rootBlockIds(result.state);
        result = createAnnotation(
            result.state,
            {type: 'range', anchor: {blockId: first, offset: 0}, focus: {blockId: first, offset: 1}},
            'sidebar',
            context,
        );

        result = indentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
        ]);
        expect(result.state.cache).toEqual(
            organizeState(
                result.state.state.blocks,
                result.state.state.chars,
                result.state.state.joins,
                annotationVirtualParents(result.state),
                result.state.state.marks,
            ),
        );
    });

    it('does not indent the first sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const first = rootBlockIds(result.state)[0];

        result = indentBlock(result.state, first, context);

        expect(result.ops).toEqual([]);
        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
        ]);
        expectCache(result.state);
    });

    it('unindents a block and reparents following siblings under it', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);

        result = unindentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('converges concurrent unindents by source sibling order', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);
        const base = result.state;

        const left = unindentBlock(base, second, ctx('left')).ops;
        const right = unindentBlock(base, third, ctx('right')).ops;
        const one = applyMany(base, [...left, ...right]);
        const two = applyMany(base, [...right, ...left]);

        expect(materializedBlockParent(one, fourth)).toEqual(one.state.blocks[third].id);
        expect(materializedBlockParent(two, fourth)).toEqual(two.state.blocks[third].id);
        expect(visibleBlockOutline(one).map(({id, depth}) => ({id, depth}))).toEqual(
            visibleBlockOutline(two).map(({id, depth}) => ({id, depth})),
        );
        expectCache(one);
        expectCache(two);
    });

    it('joins using visible adjacency across nesting', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [, second] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);

        result = deleteForward(result.state, caret(rootBlockIds(result.state)[0], 1), context);

        expect(outline(result.state)).toEqual([{text: 'ab', depth: 0}]);
        expectCache(result.state);
    });
});

describe('block rich text runtime', () => {
    it('queues offline local changes and flushes them on reconnect', () => {
        let demo = createDemoState();
        demo = toggleOnline(demo, 'left');
        const leftBlock = rootBlockIds(demo.left.state)[0];
        const context = makeCommandContext(demo.left);
        const result = insertText(demo.left.state, caret(leftBlock, 0), 'offline', context);

        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: retainSelection(result.state, result.selection),
            ops: result.ops,
        });

        expect(lines(demo.left.state)).toEqual(['offline']);
        expect(lines(demo.right.state)).toEqual(['']);
        expect(demo.left.queue).toHaveLength(1);

        demo = toggleOnline(demo, 'left');
        expect(lines(demo.right.state)).toEqual(['offline']);
        expect(demo.left.queue).toHaveLength(0);
    });
});
