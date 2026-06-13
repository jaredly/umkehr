import type {
    BlockNode,
    BlockPath,
    DocumentNode,
    EditorState,
    MarkInstance,
    Selection,
    TextSpan,
    Transaction,
    TransactionOp,
} from '@plim/core';
import {applyOp, getBlockAt, prevBlockPath} from '@plim/core';
import {
    applyMany,
    applyRemoteMany,
    deleteBlockOps,
    deleteRangeOps,
    graphemeLength,
    graphemeOffsetToUtf16Offset,
    insertBlockOps,
    insertTextOps,
    joinBlocksOps,
    lamportToString,
    markSelectionOps,
    materializeFormattedBlocks,
    moveBlockOps,
    parseLamportString,
    resolveSelection,
    retainSelection,
    setBlockMetaOps,
    splitBlockOps,
    utf16OffsetToGraphemeOffset,
    visibleBlockOutline,
    visiblePathForBlockId,
} from 'umkehr/block-crdt';
import type {
    CachedState,
    HLC,
    JsonValue,
    Lamport,
    Op,
    RetainedSelection,
    State,
} from 'umkehr/block-crdt';
import {cachedState} from 'umkehr/block-crdt';

export type PlimBlockMeta = {
    type: string;
    attrs?: Record<string, JsonValue>;
    ts: HLC;
};

export type BlockPoint = {
    blockId: string;
    offset: number;
};

export type BlockSelection =
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};

export type AdapterState = {
    crdt: CachedState<PlimBlockMeta>;
    plim: EditorState;
    retainedSelection: RetainedSelection | null;
};

export type AdapterOptions = {
    actor: string;
    ts: () => HLC;
};

export type TranslationResult = {
    ops: Op<PlimBlockMeta>[];
    unsupported: TransactionOp[];
    plannedPlim: EditorState;
};

const ROOT: Lamport = [0, 'root'];

export const createPlimEditorState = (
    crdt: CachedState<PlimBlockMeta>,
    retainedSelection: RetainedSelection | null = null,
): EditorState => {
    const doc = crdtToPlimDocument(crdt);
    return {
        doc,
        selection: retainedSelection
            ? resolveRetainedSelectionToPlim(crdt, doc, retainedSelection) ?? firstSelection(doc)
            : firstSelection(doc),
    };
};

export const createAdapterState = (
    state: State<PlimBlockMeta> | CachedState<PlimBlockMeta>,
): AdapterState => {
    const crdt = 'cache' in state ? state : cachedState(state);
    return {crdt, plim: createPlimEditorState(crdt), retainedSelection: null};
};

export const crdtToPlimDocument = (state: CachedState<PlimBlockMeta>): DocumentNode => {
    const formatted = new Map(materializeFormattedBlocks(state).map((block) => [block.id, block]));
    const nodes = new Map<string, BlockNode>();
    for (const entry of visibleBlockOutline(state)) {
        const block = state.state.blocks[entry.id];
        const formattedBlock = formatted.get(entry.id);
        nodes.set(entry.id, {
            id: entry.id,
            type: block.meta.type || 'paragraph',
            attrs: block.meta.attrs ? {...block.meta.attrs} : undefined,
            text: atomicBlockTypes.has(block.meta.type)
                ? undefined
                : (formattedBlock?.runs.map((run) => ({
                    text: run.text,
                    marks: marksToPlim(run.marks),
                })) ?? []),
            children: [],
        });
    }

    const root: DocumentNode = {type: 'doc', children: []};
    for (const entry of visibleBlockOutline(state)) {
        const node = nodes.get(entry.id);
        if (!node) continue;
        if (entry.parentId === lamportRootString()) {
            root.children.push(node);
        } else {
            nodes.get(entry.parentId)?.children?.push(node);
        }
    }
    pruneEmptyChildren(root.children);
    return root;
};

export const translateTransaction = (
    base: CachedState<PlimBlockMeta>,
    baseDoc: DocumentNode,
    tx: Pick<Transaction, 'ops'>,
    options: AdapterOptions,
): TranslationResult => {
    let state = base;
    let plimState: EditorState = {doc: baseDoc, selection: firstSelection(baseDoc)};
    const ops: Op<PlimBlockMeta>[] = [];
    const unsupported: TransactionOp[] = [];

    const append = (next: Op<PlimBlockMeta>[]) => {
        if (!next.length) return;
        ops.push(...next);
        state = applyMany(state, next);
    };

    for (const op of tx.ops) {
        const remapAfterApply: {path: BlockPath; id: string}[] = [];
        switch (op.kind) {
            case 'setSelection':
                break;
            case 'replaceText': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                const block = parseLamportString(blockId);
                const text = plimTextForPath(plimState.doc, op.path);
                const from = utf16OffsetToGraphemeOffset(text, op.from);
                const to = utf16OffsetToGraphemeOffset(text, op.to);
                if (from < to) {
                    append(deleteRangeOps(state, {block, startOffset: from, endOffset: to}));
                }
                appendInsertSpans(() => state, block, from, op.insert, options, append);
                break;
            }
            case 'splitBlock': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                const text = plimTextForPath(plimState.doc, op.path);
                const offset = utf16OffsetToGraphemeOffset(text, op.offset);
                const splitOps = splitBlockOps(state, {
                    actor: options.actor,
                    block: parseLamportString(blockId),
                    offset,
                    ts: options.ts(),
                });
                append(splitOps);
                const created = createdBlockId(splitOps);
                if (created) {
                    remapAfterApply.push({path: nextSiblingPath(op.path), id: lamportToString(created)});
                }
                if (created && (op.newType || op.newAttrs)) {
                    append(
                        setBlockMetaOps(state, {
                            block: created,
                            meta: {
                                ...state.state.blocks[blockId].meta,
                                type: op.newType ?? state.state.blocks[blockId].meta.type,
                                attrs: jsonRecord(op.newAttrs) ?? state.state.blocks[blockId].meta.attrs,
                                ts: options.ts(),
                            },
                        }),
                    );
                }
                break;
            }
            case 'joinBackward': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                const previousPath = prevBlockPath(plimState.doc, op.path);
                const previous = previousPath ? plimPathToBlockId(plimState.doc, previousPath) : null;
                if (!blockId || !previous) {
                    unsupported.push(op);
                    break;
                }
                append(
                    joinBlocksOps(state, {
                        actor: options.actor,
                        left: parseLamportString(previous),
                        right: parseLamportString(blockId),
                        ts: options.ts(),
                    }),
                );
                break;
            }
            case 'setBlockType': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                append(
                    setBlockMetaOps(state, {
                        block: parseLamportString(blockId),
                        meta: {
                            ...state.state.blocks[blockId].meta,
                            type: op.type,
                            attrs: jsonRecord(op.attrs),
                            ts: options.ts(),
                        },
                    }),
                );
                break;
            }
            case 'setBlockAttrs': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                append(
                    setBlockMetaOps(state, {
                        block: parseLamportString(blockId),
                        meta: {
                            ...state.state.blocks[blockId].meta,
                            attrs: {
                                ...(state.state.blocks[blockId].meta.attrs ?? {}),
                                ...(jsonRecord(op.attrs) ?? {}),
                            },
                            ts: options.ts(),
                        },
                    }),
                );
                break;
            }
            case 'insertBlock': {
                const anchors = plimSiblingAnchorsForPath(plimState.doc, op.path);
                if (!anchors) {
                    unsupported.push(op);
                    break;
                }
                const insertOps = insertBlockOps(state, {
                    actor: options.actor,
                    parent: anchors.parent,
                    before: anchors.before,
                    after: anchors.after,
                    meta: metaForBlock(op.block, options.ts()),
                    ts: options.ts(),
                });
                append(
                    insertOps,
                );
                const created = createdBlockId(insertOps);
                if (created) {
                    remapAfterApply.push({path: op.path, id: lamportToString(created)});
                }
                if (created && op.block.text?.length) {
                    appendInsertSpans(() => state, created, 0, op.block.text, options, append);
                }
                break;
            }
            case 'removeBlock': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                append(deleteBlockOps(state, {block: parseLamportString(blockId), mode: 'block-only'}));
                break;
            }
            case 'moveBlock': {
                const blockId = plimPathToBlockId(plimState.doc, op.from);
                const anchors = plimSiblingAnchorsForPath(plimState.doc, op.to, blockId ?? undefined);
                if (!blockId || !anchors) {
                    unsupported.push(op);
                    break;
                }
                append(
                    moveBlockOps(state, {
                        actor: options.actor,
                        block: parseLamportString(blockId),
                        parent: anchors.parent,
                        before: anchors.before,
                        after: anchors.after,
                        ts: options.ts(),
                    }),
                );
                break;
            }
            case 'toggleMark': {
                const blockId = plimPathToBlockId(plimState.doc, op.path);
                if (!blockId) {
                    unsupported.push(op);
                    break;
                }
                const text = plimTextForPath(plimState.doc, op.path);
                const from = utf16OffsetToGraphemeOffset(text, op.from);
                const to = op.to < 0 ? graphemeLength(text) : utf16OffsetToGraphemeOffset(text, op.to);
                if (from < to) {
                    append(
                        markSelectionOps(
                            state,
                            {
                                anchor: {blockId, offset: from},
                                focus: {blockId, offset: to},
                            },
                            op.mark.type,
                            jsonRecord(op.mark.attrs),
                            markActiveInRange(plimState.doc, op) === true,
                            {actor: options.actor},
                        ),
                    );
                }
                break;
            }
            default:
                unsupported.push(op);
        }
        if (!unsupported.includes(op)) {
            plimState = applyOp(plimState, op);
            for (const remap of remapAfterApply) {
                plimState = {...plimState, doc: replaceBlockIdAtPath(plimState.doc, remap.path, remap.id)};
            }
        }
    }

    return {ops, unsupported, plannedPlim: plimState};
};

export const applyLocalTransaction = (
    adapter: AdapterState,
    tx: Pick<Transaction, 'ops'>,
    options: AdapterOptions,
    postPlim?: EditorState,
): AdapterState & TranslationResult => {
    const result = translateTransaction(adapter.crdt, adapter.plim.doc, tx, options);
    const crdt = result.ops.length ? applyMany(adapter.crdt, result.ops) : adapter.crdt;
    const selectionSource = postPlim
        ? {...canonicalizePostPlimState(tx.ops, postPlim), doc: result.plannedPlim.doc}
        : result.plannedPlim;
    const nextRetainedSelection =
        selectionToRetained(crdt, selectionSource.doc, selectionSource.selection) ??
        adapter.retainedSelection;
    return {
        ...result,
        crdt,
        plim: createPlimEditorState(crdt, nextRetainedSelection),
        retainedSelection: nextRetainedSelection,
    };
};

const canonicalizePostPlimState = (
    ops: readonly TransactionOp[],
    state: EditorState,
): EditorState => {
    let selection = state.selection;
    const lastReplace = ops.findLast((op): op is TransactionOp & {kind: 'replaceText'} => op.kind === 'replaceText');
    if (lastReplace && selection.anchor.path.join('/') === lastReplace.path.join('/') && selection.head.path.join('/') === lastReplace.path.join('/')) {
        const collapsedAtInsertion =
            selection.anchor.offset === lastReplace.from &&
            selection.head.offset === lastReplace.from;
        if (collapsedAtInsertion && lastReplace.from === lastReplace.to && lastReplace.insert.length) {
            const offset = lastReplace.from + lastReplace.insert.reduce((sum, span) => sum + span.text.length, 0);
            selection = {
                anchor: {path: lastReplace.path, offset},
                head: {path: lastReplace.path, offset},
            };
        }
    }
    return {doc: state.doc, selection};
};

export const applyRemoteOps = (
    adapter: AdapterState,
    ops: Op<PlimBlockMeta>[],
): AdapterState & ReturnType<typeof applyRemoteMany<PlimBlockMeta>> => {
    const result = applyRemoteMany(adapter.crdt, ops);
    return {
        ...result,
        crdt: result.state,
        plim: createPlimEditorState(result.state, adapter.retainedSelection),
        retainedSelection: adapter.retainedSelection,
    };
};

export const plimPathToBlockId = (doc: DocumentNode, path: BlockPath): string | null =>
    getBlockAt(doc, path)?.id ?? null;

export const plimSelectionToBlockSelection = (
    doc: DocumentNode,
    selection: Selection,
): BlockSelection | null => {
    const anchor = plimPositionToBlockPoint(doc, selection.anchor);
    const focus = plimPositionToBlockPoint(doc, selection.head);
    if (!anchor || !focus) return null;
    if (anchor.blockId === focus.blockId && anchor.offset === focus.offset) {
        return {type: 'caret', point: focus};
    }
    return {type: 'range', anchor, focus};
};

export const plimPositionToBlockPoint = (
    doc: DocumentNode,
    point: {path: BlockPath; offset: number},
): BlockPoint | null => {
    const block = getBlockAt(doc, point.path);
    if (!block) return null;
    return {
        blockId: block.id,
        offset: utf16OffsetToGraphemeOffset(blockText(block), point.offset),
    };
};

export const retainedSelectionToPlimSelection = (
    state: CachedState<PlimBlockMeta>,
    doc: DocumentNode,
    retained: RetainedSelection,
): Selection | null => resolveRetainedSelectionToPlim(state, doc, retained);

export const selectionToRetained = (
    state: CachedState<PlimBlockMeta>,
    doc: DocumentNode,
    selection: Selection,
): RetainedSelection | null => {
    const blockSelection = plimSelectionToBlockSelection(doc, selection);
    return blockSelection ? retainSelection(state, blockSelection) : null;
};

const appendInsertSpans = (
    currentState: () => CachedState<PlimBlockMeta>,
    block: Lamport,
    offset: number,
    spans: TextSpan[],
    options: AdapterOptions,
    append: (ops: Op<PlimBlockMeta>[]) => void,
) => {
    let currentOffset = offset;
    for (const span of spans) {
        if (!span.text) continue;
        const insertOps = insertTextOps(currentState(), {
            actor: options.actor,
            block,
            offset: currentOffset,
            text: span.text,
            ts: options.ts,
        });
        append(insertOps);
        const length = graphemeLength(span.text);
        if (span.marks?.length) {
            for (const mark of span.marks) {
                append(
                    markSelectionOps(
                        currentState(),
                        {
                            anchor: {blockId: lamportToString(block), offset: currentOffset},
                            focus: {blockId: lamportToString(block), offset: currentOffset + length},
                        },
                        mark.type,
                        jsonRecord(mark.attrs),
                        false,
                        {actor: options.actor},
                    ),
                );
            }
        }
        currentOffset += length;
    }
};

const resolveRetainedSelectionToPlim = (
    state: CachedState<PlimBlockMeta>,
    doc: DocumentNode,
    retained: RetainedSelection,
): Selection | null => {
    const resolved = resolveSelection(state, retained);
    if (resolved.type === 'caret') {
        const point = blockPointToPlimPosition(state, doc, resolved.point);
        return point ? {anchor: point, head: point} : null;
    }
    const anchor = blockPointToPlimPosition(state, doc, resolved.anchor);
    const head = blockPointToPlimPosition(state, doc, resolved.focus);
    return anchor && head ? {anchor, head} : null;
};

const blockPointToPlimPosition = (
    state: CachedState<PlimBlockMeta>,
    doc: DocumentNode,
    point: BlockPoint,
): {path: BlockPath; offset: number} | null => {
    const path = visiblePathForBlockId(state, point.blockId);
    if (!path) return null;
    const block = getBlockAt(doc, path);
    if (!block) return null;
    return {
        path,
        offset: graphemeOffsetToUtf16Offset(blockText(block), point.offset),
    };
};

const firstSelection = (doc: DocumentNode): Selection => {
    const first = firstBlockPath(doc) ?? [0];
    return {anchor: {path: first, offset: 0}, head: {path: first, offset: 0}};
};

const firstBlockPath = (doc: DocumentNode): BlockPath | null => (doc.children.length ? [0] : null);

const nextSiblingPath = (path: BlockPath): BlockPath => {
    const next = path.slice();
    next[next.length - 1]++;
    return next;
};

const replaceBlockIdAtPath = (doc: DocumentNode, path: BlockPath, id: string): DocumentNode => ({
    ...doc,
    children: replaceBlockIdInChildren(doc.children, path, id),
});

const replaceBlockIdInChildren = (children: BlockNode[], path: BlockPath, id: string): BlockNode[] =>
    children.map((child, index) => {
        if (index !== path[0]) return child;
        if (path.length === 1) return {...child, id};
        return {
            ...child,
            children: replaceBlockIdInChildren(child.children ?? [], path.slice(1), id),
        };
    });

const marksToPlim = (marks: Record<string, JsonValue | true>): MarkInstance[] | undefined => {
    const result = Object.entries(marks).map(([type, data]) => ({
        type,
        attrs: data === true ? undefined : jsonRecord(data),
    }));
    return result.length ? result : undefined;
};

const metaForBlock = (block: BlockNode, ts: HLC): PlimBlockMeta => ({
    type: block.type || 'paragraph',
    attrs: jsonRecord(block.attrs),
    ts,
});

const jsonRecord = (value: unknown): Record<string, JsonValue> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
        const json = toJsonValue(item);
        if (json !== undefined) result[key] = json;
    }
    return Object.keys(result).length ? result : undefined;
};

const toJsonValue = (value: unknown): JsonValue | undefined => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
        const items = value.map(toJsonValue);
        return items.every((item) => item !== undefined) ? (items as JsonValue[]) : undefined;
    }
    if (typeof value === 'object') return jsonRecord(value) ?? {};
    return undefined;
};

const blockText = (block: BlockNode): string => block.text?.map((span) => span.text).join('') ?? '';

const plimTextForPath = (doc: DocumentNode, path: BlockPath): string => {
    const block = getBlockAt(doc, path);
    return block ? blockText(block) : '';
};

const pruneEmptyChildren = (nodes: BlockNode[]) => {
    for (const node of nodes) {
        if (node.children?.length) {
            pruneEmptyChildren(node.children);
        } else {
            delete node.children;
        }
    }
};

const atomicBlockTypes = new Set(['divider', 'image', 'embed', 'raw_html', 'table']);

const plimSiblingAnchorsForPath = (
    doc: DocumentNode,
    path: BlockPath,
    movingId?: string,
): {parent: Lamport; before: Lamport | null; after: Lamport | null} | null => {
    if (path.length === 0 || path.some((index) => !Number.isInteger(index) || index < 0)) return null;
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    const parentBlock = parentPath.length ? getBlockAt(doc, parentPath) : null;
    const children = (parentBlock ? parentBlock.children : doc.children) ?? [];
    const siblingIds = children.map((child) => child.id).filter((id) => id !== movingId);
    if (index > siblingIds.length) return null;
    return {
        parent: parentBlock ? parseLamportString(parentBlock.id) : ROOT,
        before: index > 0 ? parseLamportString(siblingIds[index - 1]) : null,
        after: index < siblingIds.length ? parseLamportString(siblingIds[index]) : null,
    };
};

const createdBlockId = (ops: Op<PlimBlockMeta>[]): Lamport | null => {
    const op = ops.findLast((item): item is Op<PlimBlockMeta> & {type: 'block'} => item.type === 'block');
    return op?.block.id ?? null;
};

const markActiveInRange = (doc: DocumentNode, op: TransactionOp & {kind: 'toggleMark'}): boolean => {
    const block = getBlockAt(doc, op.path);
    if (!block?.text?.length) return false;
    const to = op.to < 0 ? blockText(block).length : op.to;
    let offset = 0;
    for (const span of block.text) {
        const start = offset;
        const end = offset + span.text.length;
        offset = end;
        if (end <= op.from || start >= to) continue;
        if (!span.marks?.some((mark) => mark.type === op.mark.type)) return false;
    }
    return true;
};

const lamportRootString = () => '0000-root';
