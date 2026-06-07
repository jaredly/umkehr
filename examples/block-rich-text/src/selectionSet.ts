import {orderedCharIdsForBlock, rootBlockIds} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import {
    firstPointForSelection,
    focusPoint,
    isCollapsed,
    normalizeSelectionSegments,
    type BlockPoint,
    type EditorSelection,
    type SelectionSegment,
} from './selectionModel';
import {
    initialRetainedSelection,
    resolvePoint,
    resolveSelection,
    retainSelection,
    type RetainedPoint,
    type RetainedSelection,
} from './retainedSelection';

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

const DEFAULT_SELECTION_ID = 'sel-0';

export const initialRetainedSelectionSet = (state: CachedState): RetainedSelectionSet => ({
    primaryId: DEFAULT_SELECTION_ID,
    entries: [{id: DEFAULT_SELECTION_ID, selection: initialRetainedSelection(state)}],
});

export const singleRetainedSelectionSet = (
    state: CachedState,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => ({
    primaryId: id,
    entries: [{id, selection: retainSelection(state, selection)}],
});

export const resolveSelectionSet = (
    state: CachedState,
    set: RetainedSelectionSet,
): EditorSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: resolveSelection(state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const retainSelectionSet = (
    state: CachedState,
    set: EditorSelectionSet,
): RetainedSelectionSet => {
    const entries = set.entries.map((entry) => ({
        id: entry.id,
        selection: retainSelection(state, entry.selection),
    }));
    return normalizePrimary({primaryId: set.primaryId, entries});
};

export const primarySelection = (set: EditorSelectionSet): EditorSelection =>
    primaryEntry(set).selection;

export const primaryEntry = <T extends {primaryId: string; entries: Array<{id: string}>}>(
    set: T,
): T['entries'][number] => set.entries.find((entry) => entry.id === set.primaryId) ?? set.entries[0];

export const replaceSelectionSet = (
    state: CachedState,
    selection: EditorSelection,
    id = DEFAULT_SELECTION_ID,
): RetainedSelectionSet => singleRetainedSelectionSet(state, selection, id);

export const replacePrimarySelection = (
    state: CachedState,
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

export const appendSelection = (
    state: CachedState,
    set: RetainedSelectionSet,
    selection: EditorSelection,
    id: string,
): RetainedSelectionSet =>
    dedupeSelectionSet(state, {
        primaryId: id,
        entries: [...set.entries, {id, selection: retainSelection(state, selection)}],
    });

export const dedupeSelectionSet = (
    state: CachedState,
    set: RetainedSelectionSet,
): RetainedSelectionSet => {
    const caretWinners = new Map<string, RetainedSelectionEntry>();
    const ranges: RetainedSelectionEntry[] = [];

    for (const entry of set.entries) {
        const resolved = resolveSelection(state, entry.selection);
        if (!isCollapsed(resolved)) {
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

export const sortedResolvedEntries = (
    state: CachedState,
    set: RetainedSelectionSet,
): EditorSelectionEntry[] =>
    resolveSelectionSet(state, dedupeSelectionSet(state, set)).entries.sort((a, b) =>
        compareSelections(state, a.selection, b.selection),
    );

export const reverseSortedRetainedEntries = (
    state: CachedState,
    entries: RetainedSelectionEntry[],
): RetainedSelectionEntry[] =>
    entries
        .slice()
        .sort((a, b) => compareRetainedSelections(state, b.selection, a.selection));

export const mergeOverlappingRanges = (
    state: CachedState,
    set: RetainedSelectionSet,
): RetainedSelectionEntry[] => {
    const deduped = dedupeSelectionSet(state, set);
    const resolved = resolveSelectionSet(state, deduped);
    const ranges = resolved.entries
        .filter((entry) => !isCollapsed(entry.selection))
        .map((entry) => ({entry, span: normalizedSpan(state, entry.selection)}))
        .filter((item): item is {entry: EditorSelectionEntry; span: SelectionSpan} => item.span !== null)
        .sort((a, b) => comparePoints(state, a.span.start, b.span.start));
    const carets = resolved.entries.filter((entry) => isCollapsed(entry.selection));
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
    state: CachedState,
    set: EditorSelectionSet,
    options: {includePrimary: boolean},
): Map<string, BlockSelectionDecorations> => {
    const result = new Map<string, BlockSelectionDecorations>();

    for (const entry of set.entries) {
        const primary = entry.id === set.primaryId;
        if (primary && !options.includePrimary) continue;

        if (isCollapsed(entry.selection)) {
            const point = focusPoint(entry.selection);
            const decorations = ensureDecorations(result, point.blockId);
            if (!decorations.carets.some((caret) => caret.offset === point.offset)) {
                decorations.carets.push({id: entry.id, offset: point.offset, primary});
            }
            continue;
        }

        for (const segment of normalizeSelectionSegments(state, entry.selection)) {
            ensureDecorations(result, segment.blockId).segments.push({
                id: entry.id,
                startOffset: segment.startOffset,
                endOffset: segment.endOffset,
                primary,
            });
        }
    }

    for (const decorations of result.values()) {
        decorations.carets.sort((a, b) => a.offset - b.offset);
        decorations.segments.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    }

    return result;
};

type SelectionSpan = {
    start: BlockPoint;
    end: BlockPoint;
};

const normalizedSpan = (state: CachedState, selection: EditorSelection): SelectionSpan | null => {
    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return null;
    const first = segments[0];
    const last = segments[segments.length - 1];
    return {
        start: {blockId: first.blockId, offset: first.startOffset},
        end: {blockId: last.blockId, offset: last.endOffset},
    };
};

export const compareSelections = (
    state: CachedState,
    one: EditorSelection,
    two: EditorSelection,
): number => comparePoints(state, firstPointForSelection(state, one), firstPointForSelection(state, two));

export const comparePoints = (state: CachedState, one: BlockPoint, two: BlockPoint): number => {
    const blocks = rootBlockIds(state);
    const oneBlock = blocks.indexOf(one.blockId);
    const twoBlock = blocks.indexOf(two.blockId);
    return oneBlock - twoBlock || one.offset - two.offset;
};

const compareRetainedSelections = (
    state: CachedState,
    one: RetainedSelection,
    two: RetainedSelection,
): number => compareRetainedPoints(state, retainedStart(one), retainedStart(two));

const retainedStart = (selection: RetainedSelection): RetainedPoint =>
    selection.type === 'caret' ? selection.point : selection.anchor;

const compareRetainedPoints = (
    state: CachedState,
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

const retainedPointKey = (state: CachedState, point: RetainedPoint) => {
    const blocks = rootBlockIds(state, true);
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

const affinityRank = (affinity: RetainedPoint['affinity']) => (affinity === 'before' ? 0 : 1);

const visiblePointKey = (point: BlockPoint) => `${point.blockId}:${point.offset}`;

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
