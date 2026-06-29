import {orderedCharIdsForBlock} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';
import type {RichBlockMeta} from './blockMeta';
import type {BlockEditorRegistry} from './plugins/types.js';
import {
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    clampPoint,
    editableBlockIds,
    focusBlockId,
    normalizeSelectionSegments,
    pointTextLength,
    selectedBlockIdsForSelection,
    selectedTopLevelBlockIdsForSelection,
    visibleSubtreeBlockIds,
    type BlockPoint,
    type EditorSelection,
    type SelectionSegment,
    type TextSelection,
} from './selectionModel';
import {
    initialRetainedSelection,
    resolvePoint,
    resolveSelection,
    retainSelection,
    type RetainedPoint,
    type RetainedSelection,
} from './retainedSelection';
import {
    blockLevelDecorationsForSelectionFromRegistry,
    compareSelectionsFromRegistry,
    resolveSelectionFromRegistry,
    retainSelectionFromRegistry,
    focusPointFromRegistry,
    selectedTopLevelBlockIdsFromRegistry,
} from './selectionPlugins.js';

export type RetainedSelectionEntry = {
    id: string;
    selection: RetainedSelection;
};

export type RetainedSelectionSet = {
    primaryId: string;
    entries: RetainedSelectionEntry[];
};

export type EditorSelectionEntry = {
    id: string;
    selection: EditorSelection;
};

export type EditorSelectionSet = {
    primaryId: string;
    entries: EditorSelectionEntry[];
};

export type BlockSelectionDecorations = {
    carets: Array<{id: string; offset: number; primary: boolean}>;
    segments: Array<{
        id: string;
        startOffset: number;
        endOffset: number;
        primary: boolean;
    }>;
};

export type BlockLevelSelectionDecorations = {
    selected: boolean;
    primary: boolean;
    focus: boolean;
};

const DEFAULT_SELECTION_ID = 'sel-0';

export const initialRetainedSelectionSet = (state: CachedState<RichBlockMeta>): RetainedSelectionSet => ({
    primaryId: DEFAULT_SELECTION_ID,
    entries: [{id: DEFAULT_SELECTION_ID, selection: initialRetainedSelection(state)}],
});

export const singleRetainedSelectionSet = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => ({
    primaryId: id,
    entries: [{id, selection: retainSelection(state, selection)}],
});

export const singleRetainedSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => ({
    primaryId: id,
    entries: [{id, selection: retainSelectionFromRegistry(registry, state, selection)}],
});

export const resolveSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): EditorSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: resolveSelection(state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const resolveSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): EditorSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: resolveSelectionFromRegistry(registry, state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const retainSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): RetainedSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const retainSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): RetainedSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelectionFromRegistry(registry, state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const primarySelection = (set: EditorSelectionSet): EditorSelection =>
    primaryEntry(set).selection;

export const primaryEntry = <T extends {primaryId: string; entries: Array<{id: string}>}>(
    set: T,
): T['entries'][number] => set.entries.find((entry) => entry.id === set.primaryId) ?? set.entries[0];

export const replaceSelectionSet = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => singleRetainedSelectionSet(state, selection, id);

export const replaceSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => singleRetainedSelectionSetFromRegistry(registry, state, selection, id);

export const replacePrimarySelection = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
    selection: EditorSelection,
): RetainedSelectionSet => {
    const currentPrimary = primaryEntry(set);
    const primaryId = currentPrimary?.id ?? DEFAULT_SELECTION_ID;
    const entries = set.entries.length
        ? set.entries.map((entry) =>
              entry.id === primaryId ? {id: entry.id, selection: retainSelection(state, selection)} : entry,
          )
        : [{id: primaryId, selection: retainSelection(state, selection)}];
    return normalizePrimary({primaryId, entries});
};

export const replacePrimarySelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
    selection: EditorSelection,
): RetainedSelectionSet => {
    const currentPrimary = primaryEntry(set);
    const primaryId = currentPrimary?.id ?? DEFAULT_SELECTION_ID;
    const retained = retainSelectionFromRegistry(registry, state, selection);
    const entries = set.entries.length
        ? set.entries.map((entry) => (entry.id === primaryId ? {id: entry.id, selection: retained} : entry))
        : [{id: primaryId, selection: retained}];
    return normalizePrimary({primaryId, entries});
};

export const appendSelection = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
    selection: EditorSelection,
    id: string,
): RetainedSelectionSet =>
    dedupeSelectionSet(state, {
        primaryId: id,
        entries: [...set.entries, {id, selection: retainSelection(state, selection)}],
    });

export const appendSelectionFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
    selection: EditorSelection,
    id: string,
): RetainedSelectionSet =>
    dedupeSelectionSetFromRegistry(registry, state, {
        primaryId: id,
        entries: [...set.entries, {id, selection: retainSelectionFromRegistry(registry, state, selection)}],
    });

export const dedupeSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): RetainedSelectionSet => {
    const caretWinners = new Map<string, RetainedSelectionEntry>();
    const ranges: RetainedSelectionEntry[] = [];

    for (const entry of set.entries) {
        const resolved = resolveSelection(state, entry.selection);
        if (resolved.type !== 'caret') {
            ranges.push(entry);
            continue;
        }

        const point = focusPoint(resolved);
        const key = visiblePointKey(point);
        const current = caretWinners.get(key);
        if (!current || compareRetainedSelections(state, entry.selection, current.selection) < 0) {
            caretWinners.set(key, entry);
        }
    }

    return normalizePrimary({
        primaryId: set.primaryId,
        entries: [...ranges, ...caretWinners.values()].sort((a, b) =>
            compareRetainedSelections(state, a.selection, b.selection),
        ),
    });
};

export const dedupeSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): RetainedSelectionSet => {
    const resolved = resolveSelectionSetFromRegistry(registry, state, set);
    const caretWinners = new Map<string, EditorSelectionEntry>();
    const nonCarets: EditorSelectionEntry[] = [];

    for (const entry of resolved.entries) {
        if (entry.selection.type !== 'caret') {
            nonCarets.push(entry);
            continue;
        }

        const point = focusPointFromRegistry(registry, state, entry.selection);
        const key = visiblePointKey(point);
        const current = caretWinners.get(key);
        if (!current || compareSelectionsFromRegistry(registry, state, entry.selection, current.selection) < 0) {
            caretWinners.set(key, entry);
        }
    }

    const entries = [...nonCarets, ...caretWinners.values()]
        .sort((a, b) => compareSelectionsFromRegistry(registry, state, a.selection, b.selection))
        .map((entry) => ({
            id: entry.id,
            selection: retainSelectionFromRegistry(registry, state, entry.selection),
        }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const sortedResolvedEntries = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): EditorSelectionEntry[] =>
    resolveSelectionSet(state, dedupeSelectionSet(state, set)).entries.sort((a, b) =>
        compareSelections(state, a.selection, b.selection),
    );

export const sortedResolvedEntriesFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): EditorSelectionEntry[] =>
    resolveSelectionSetFromRegistry(registry, state, dedupeSelectionSetFromRegistry(registry, state, set)).entries.sort(
        (a, b) => compareSelectionsFromRegistry(registry, state, a.selection, b.selection),
    );

export const reverseSortedRetainedEntries = (
    state: CachedState<RichBlockMeta>,
    entries: RetainedSelectionEntry[],
): RetainedSelectionEntry[] =>
    entries
        .slice()
        .sort((a, b) => compareRetainedSelections(state, b.selection, a.selection));

export const mergeOverlappingRanges = (
    state: CachedState<RichBlockMeta>,
    set: RetainedSelectionSet,
): RetainedSelectionEntry[] => {
    const deduped = dedupeSelectionSet(state, set);
    const resolved = resolveSelectionSet(state, deduped);
    const ranges = resolved.entries
        .filter((entry): entry is EditorSelectionEntry & {selection: TextSelection} => entry.selection.type === 'range')
        .map((entry) => ({entry, span: normalizedSpan(state, entry.selection)}))
        .filter(
            (
                item,
            ): item is {
                entry: EditorSelectionEntry & {selection: TextSelection};
                span: SelectionSpan;
            } => item.span !== null,
        )
        .sort((a, b) => comparePoints(state, a.span.start, b.span.start));
    const carets = resolved.entries.filter((entry) => entry.selection.type === 'caret');
    const merged: Array<{id: string; span: SelectionSpan}> = [];

    for (const item of ranges) {
        const last = merged[merged.length - 1];
        if (last && comparePoints(state, item.span.start, last.span.end) <= 0) {
            if (comparePoints(state, item.span.end, last.span.end) > 0) {
                last.span.end = item.span.end;
            }
            if (item.entry.id === resolved.primaryId) {
                last.id = item.entry.id;
            }
        } else {
            merged.push({id: item.entry.id, span: {...item.span}});
        }
    }

    const rangeEntries: RetainedSelectionEntry[] = merged.map((item) => ({
        id: item.id,
        selection: retainSelection(state, {
            type: 'range',
            anchor: item.span.start,
            focus: item.span.end,
        }),
    }));
    const caretEntries = carets
        .filter((entry) => {
            const point = focusPoint(entry.selection);
            return !merged.some(
                (item) =>
                    comparePoints(state, item.span.start, point) <= 0 &&
                    comparePoints(state, point, item.span.end) <= 0,
            );
        })
        .map((entry) => ({id: entry.id, selection: retainSelection(state, entry.selection)}));

    return [...rangeEntries, ...caretEntries].sort((a, b) =>
        compareRetainedSelections(state, a.selection, b.selection),
    );
};

export const decorationsForSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
    options: {includePrimary: boolean; includePrimaryBoundaryCaret?: boolean},
): Map<string, BlockSelectionDecorations> => {
    const result = new Map<string, BlockSelectionDecorations>();

    for (const entry of set.entries) {
        const primary = entry.id === set.primaryId;

        if (isCollapsed(entry.selection)) {
            if (primary && !options.includePrimary) continue;
            const point = focusPoint(entry.selection);
            addCaretDecoration(result, entry.id, point, primary);
            continue;
        }

        if (entry.selection.type !== 'range') continue;

        const segments = normalizeSelectionSegments(state, entry.selection);
        if (primary && !options.includePrimary) {
            if (options.includePrimaryBoundaryCaret) {
                addRangeEdgeCarets(state, result, entry.id, entry.selection, primary);
            }
            continue;
        }

        if (!segments.length) {
            addRangeEdgeCarets(state, result, entry.id, entry.selection, primary);
            continue;
        }

        for (const segment of segments) {
            ensureDecorations(result, segment.blockId).segments.push({
                id: entry.id,
                startOffset: segment.startOffset,
                endOffset: segment.endOffset,
                primary,
            });
        }
        addRangeEdgeCarets(state, result, entry.id, entry.selection, primary);
    }

    for (const decorations of result.values()) {
        decorations.carets.sort((a, b) => a.offset - b.offset);
        decorations.segments.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    }

    return result;
};

export const blockLevelDecorationsForSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): Map<string, BlockLevelSelectionDecorations> => {
    const result = new Map<string, BlockLevelSelectionDecorations>();
    for (const entry of set.entries) {
        if (entry.selection.type !== 'block' && entry.selection.type !== 'table-cells') continue;
        const primary = entry.id === set.primaryId;
        const focusId = focusBlockId(entry.selection);
        const blockIds =
            entry.selection.type === 'block'
                ? selectedTopLevelBlockIdsForSelection(state, entry.selection)
                : selectedBlockIdsForSelection(state, entry.selection);
        for (const blockId of blockIds) {
            const current = result.get(blockId);
            result.set(blockId, {
                selected: true,
                primary: Boolean(current?.primary || primary),
                focus: Boolean(
                    current?.focus ||
                        blockId === focusId ||
                        (entry.selection.type === 'block' &&
                            visibleSubtreeBlockIds(state, blockId).includes(focusId)),
                ),
            });
        }
    }
    return result;
};

export const blockLevelDecorationsForSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): Map<string, BlockLevelSelectionDecorations> => {
    const result = new Map<string, BlockLevelSelectionDecorations>();
    for (const entry of set.entries) {
        const primary = entry.id === set.primaryId;
        for (const [blockId, decorations] of blockLevelDecorationsForSelectionFromRegistry(
            registry,
            state,
            entry.selection,
            entry.id,
            primary,
        )) {
            const current = result.get(blockId);
            result.set(blockId, {
                selected: Boolean(current?.selected || decorations.selected),
                primary: Boolean(current?.primary || decorations.primary),
                focus: Boolean(current?.focus || decorations.focus),
            });
        }
    }
    return result;
};

export const selectedTopLevelBlockIdsForSelectionSet = (
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): string[] => {
    const selected = new Set<string>();
    for (const entry of set.entries) {
        for (const blockId of selectedTopLevelBlockIdsForSelection(state, entry.selection)) {
            selected.add(blockId);
        }
    }
    const order = editableBlockIds(state);
    return [...selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

export const selectedTopLevelBlockIdsForSelectionSetFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
    state: CachedState<RichBlockMeta>,
    set: EditorSelectionSet,
): string[] => {
    const selected = new Set<string>();
    for (const entry of set.entries) {
        for (const blockId of selectedTopLevelBlockIdsFromRegistry(registry, state, entry.selection)) {
            selected.add(blockId);
        }
    }
    const order = editableBlockIds(state);
    return [...selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

type SelectionSpan = {
    start: BlockPoint;
    end: BlockPoint;
};

const normalizedSpan = (state: CachedState<RichBlockMeta>, selection: EditorSelection): SelectionSpan | null => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) {
        if (selection.type !== 'range') return null;
        const anchor = clampPoint(state, selection.anchor);
        const focus = clampPoint(state, selection.focus);
        const comparison = comparePoints(state, anchor, focus);
        if (comparison === 0) return null;
        return comparison < 0 ? {start: anchor, end: focus} : {start: focus, end: anchor};
    }
    const first = segments[0];
    const last = segments[segments.length - 1];
    return {
        start: {blockId: first.blockId, offset: first.startOffset},
        end: {blockId: last.blockId, offset: last.endOffset},
    };
};

export const compareSelections = (
    state: CachedState<RichBlockMeta>,
    one: EditorSelection,
    two: EditorSelection,
): number => comparePoints(state, firstPointForSelection(state, one), firstPointForSelection(state, two));

export const comparePoints = (state: CachedState<RichBlockMeta>, one: BlockPoint, two: BlockPoint): number => {
    const blocks = editableBlockIds(state);
    const oneBlock = blocks.indexOf(one.blockId);
    const twoBlock = blocks.indexOf(two.blockId);
    return oneBlock - twoBlock || one.offset - two.offset;
};

const compareRetainedSelections = (
    state: CachedState<RichBlockMeta>,
    one: RetainedSelection,
    two: RetainedSelection,
): number => compareRetainedPoints(state, retainedStart(one), retainedStart(two));

const retainedStart = (selection: RetainedSelection): RetainedPoint =>
    selection.type === 'caret'
        ? selection.point
        : selection.type === 'range'
          ? selection.anchor
          : {blockId: focusBlockId(selection), affinity: 'after', charId: null};

const compareRetainedPoints = (
    state: CachedState<RichBlockMeta>,
    one: RetainedPoint,
    two: RetainedPoint,
): number => {
    const oneKey = retainedPointKey(state, one);
    const twoKey = retainedPointKey(state, two);
    return (
        oneKey.blockIndex - twoKey.blockIndex ||
        oneKey.charIndex - twoKey.charIndex ||
        affinityRank(one.affinity) - affinityRank(two.affinity) ||
        oneKey.fallback.localeCompare(twoKey.fallback)
    );
};

const retainedPointKey = (state: CachedState<RichBlockMeta>, point: RetainedPoint) => {
    const blocks = retainedBlockOrder(state);
    const fallbackBlock = point.blockId ? blocks.indexOf(point.blockId) : -1;
    if (!point.charId) {
        return {
            blockIndex: fallbackBlock >= 0 ? fallbackBlock : Number.MAX_SAFE_INTEGER,
            charIndex: -1,
            fallback: point.blockId,
        };
    }

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const charIds = orderedCharIdsForBlock(state, blocks[blockIndex]);
        const charIndex = charIds.indexOf(point.charId);
        if (charIndex >= 0) {
            return {blockIndex, charIndex, fallback: point.charId};
        }
    }

    return {
        blockIndex: fallbackBlock >= 0 ? fallbackBlock : Number.MAX_SAFE_INTEGER,
        charIndex: Number.MAX_SAFE_INTEGER,
        fallback: point.charId,
    };
};

const retainedBlockOrder = (state: CachedState<RichBlockMeta>): string[] => {
    const visible = editableBlockIds(state);
    const seen = new Set(visible);
    const hidden = Object.keys(state.state.blocks)
        .filter((id) => !seen.has(id))
        .sort();
    return [...visible, ...hidden];
};

const affinityRank = (affinity: RetainedPoint['affinity']) => (affinity === 'before' ? 0 : 1);

const visiblePointKey = (point: BlockPoint) => `${point.blockId}:${point.offset}`;

const addRangeEdgeCarets = (
    state: CachedState<RichBlockMeta>,
    map: Map<string, BlockSelectionDecorations>,
    id: string,
    selection: EditorSelection,
    primary: boolean,
) => {
    if (selection.type !== 'range') return;
    const anchor = clampPoint(state, selection.anchor);
    const focus = clampPoint(state, selection.focus);
    if (anchor.blockId === focus.blockId) return;

    for (const point of [anchor, focus]) {
        if (isBlockEdgePoint(state, point)) {
            addCaretDecoration(map, id, point, primary);
        }
    }
};

const isBlockEdgePoint = (state: CachedState<RichBlockMeta>, point: BlockPoint): boolean =>
    point.offset === 0 || point.offset === pointTextLength(state, point.blockId);

const addCaretDecoration = (
    map: Map<string, BlockSelectionDecorations>,
    id: string,
    point: BlockPoint,
    primary: boolean,
) => {
    const decorations = ensureDecorations(map, point.blockId);
    if (!decorations.carets.some((caret) => caret.offset === point.offset)) {
        decorations.carets.push({id, offset: point.offset, primary});
    }
};

const ensureDecorations = (
    map: Map<string, BlockSelectionDecorations>,
    blockId: string,
): BlockSelectionDecorations => {
    const existing = map.get(blockId);
    if (existing) return existing;
    const next: BlockSelectionDecorations = {carets: [], segments: []};
    map.set(blockId, next);
    return next;
};

const normalizePrimary = <T extends {primaryId: string; entries: Array<{id: string}>}>(set: T): T => {
    if (set.entries.some((entry) => entry.id === set.primaryId)) return set;
    return {...set, primaryId: set.entries[0]?.id ?? set.primaryId};
};
