import type {tags} from 'typia';
import {crdtPathForExisting, getMetaAtPath} from '../crdt/path.js';
import {
    cachedState,
    lamportToString,
    materializeFormattedBlocks,
    stateToString,
    type CachedState,
    type FormattedBlock,
    type State as BlockRichTextState,
} from '../block-crdt/index.js';
import {initialStateWithMeta} from '../block-crdt/initialState.js';
import {paragraphMeta, type RichBlockMeta} from '../block-editor/index.js';
import type {CrdtDocument} from '../crdt/types.js';
import type {Path} from '../types.js';
import {BLOCK_RICH_TEXT_LEAF_PLUGIN_ID} from './plugin.js';
export {
    BLOCK_RICH_TEXT_INITIAL_SESSION,
    BLOCK_RICH_TEXT_INITIAL_TS,
    BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    BLOCK_RICH_TEXT_LEAF_PLUGIN_VERSION,
    blockRichTextBuilderExtension,
    blockRichTextLeafPlugin,
    type BlockRichTextDeleteRangeChange,
    type BlockRichTextDeleteRangeCommand,
    type BlockRichTextInsertTextChange,
    type BlockRichTextInsertTextCommand,
    type BlockRichTextJoinBlocksChange,
    type BlockRichTextJoinBlocksCommand,
    type BlockRichTextLeafMeta,
    type BlockRichTextMoveBlockArgs,
    type BlockRichTextMoveBlockChange,
    type BlockRichTextMoveBlockCommand,
    type BlockRichTextOpsChange,
    type BlockRichTextOpsCommand,
    type BlockRichTextPatchChange,
    type BlockRichTextSetBlockMetaChange,
    type BlockRichTextSetBlockMetaCommand,
    type BlockRichTextSplitBlockChange,
    type BlockRichTextSplitBlockCommand,
} from './plugin.js';

declare const blockRichTextBrand: unique symbol;

export type BlockRichText = {
    kind: 'block-rich-text';
    version: 1;
    state: BlockRichTextState<RichBlockMeta>;
} & tags.JsonSchemaPlugin<{
    'x-umkehr-leaf-crdt': 'umkehr.block-rich-text';
    'x-umkehr-leaf-crdt-version': 1;
}> & {
        readonly [blockRichTextBrand]?: never;
    };

export type {BlockRichTextState, CachedState, FormattedBlock, RichBlockMeta};

export function blockRichText(
    sessionId = 'seed',
    ts = '000000000000000:00000:seed',
): BlockRichText {
    return blockRichTextWithState(initialStateWithMeta(sessionId, paragraphMeta(ts)));
}

export function blockRichTextWithState(state: BlockRichTextState<RichBlockMeta>): BlockRichText {
    return {
        kind: 'block-rich-text',
        version: 1,
        state,
    } as BlockRichText;
}

export function blockRichTextRootBlockId(sessionId = 'seed') {
    return lamportToString([0, sessionId]);
}

export function cachedBlockRichTextValue(value: BlockRichText): CachedState<RichBlockMeta> {
    assertBlockRichTextValue(value);
    return cachedState(value.state);
}

export function materializeBlockRichText<T>(
    doc: CrdtDocument<T>,
    path: Path,
): Array<FormattedBlock<RichBlockMeta>> {
    const crdtPath = crdtPathForExisting(doc, path);
    const meta = getMetaAtPath(doc.meta, crdtPath);
    if (
        !meta ||
        (meta as {kind?: string}).kind !== 'leaf' ||
        (meta as {plugin?: string}).plugin !== BLOCK_RICH_TEXT_LEAF_PLUGIN_ID
    ) {
        throw new Error(
            'Cannot materialize block rich text: path does not point to a block-rich-text field.',
        );
    }
    const value = getValueAtPath(doc.state, path);
    assertBlockRichTextValue(value);
    return materializeBlockRichTextValue(value);
}

export function materializeBlockRichTextValue(value: BlockRichText): Array<FormattedBlock<RichBlockMeta>> {
    return materializeFormattedBlocks(cachedBlockRichTextValue(value));
}

export function blockRichTextToString(value: BlockRichText) {
    return stateToString(cachedBlockRichTextValue(value));
}

function assertBlockRichTextValue(value: unknown): asserts value is BlockRichText {
    if (!isBlockRichTextValue(value)) {
        throw new Error('Expected a block-rich-text value.');
    }
}

export function isBlockRichTextValue(value: unknown): value is BlockRichText {
    return Boolean(
        value &&
        typeof value === 'object' &&
        (value as {kind?: unknown}).kind === 'block-rich-text' &&
        (value as {version?: unknown}).version === 1 &&
        valueHasBlockState((value as {state?: unknown}).state),
    );
}

function valueHasBlockState(value: unknown): value is BlockRichTextState<RichBlockMeta> {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as {chars?: unknown}).chars &&
        (value as {blocks?: unknown}).blocks &&
        (value as {marks?: unknown}).marks &&
        (value as {splits?: unknown}).splits &&
        (value as {joins?: unknown}).joins &&
        typeof (value as {maxSeenCount?: unknown}).maxSeenCount === 'number',
    );
}

function getValueAtPath(root: unknown, path: Path) {
    let current = root;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[segment.key];
    }
    return current;
}
