import {
    formattedMarkValues,
    materializeFormattedBlocks,
    type FormattedBlock,
    type FormattedRun,
} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import type {Lamport} from 'umkehr/block-crdt/types';
import {annotationBodyBlockIds} from './annotations';
import {LINK_MARK} from './inlineMarks';
import {normalizeSelectionSegments, segmentText} from './selectionModel';
import type {RichBlockMeta} from './blockMeta';
import {
    ANNOTATION_MARK,
    annotationMarkBehavior,
    richTextVirtualParents,
    type AnnotationMarkData,
    type AnnotationPresentation,
} from './virtualParents';
import {
    mergeOverlappingRanges,
    resolveSelectionSet,
    type RetainedSelectionSet,
} from './selectionSet';
import type {CachedState} from 'umkehr/block-crdt/types';

export const BLOCK_RICH_TEXT_MIME = 'application/x-umkehr-block-rich-text+json';

export type ClipboardBooleanMarkType = 'bold' | 'italic' | 'strikethrough';
export type ClipboardInlineMarkType = ClipboardBooleanMarkType | 'link' | 'annotation';

export type ClipboardMarkRange = {
    type: ClipboardInlineMarkType;
    startOffset: number;
    endOffset: number;
    data?: unknown;
};

export type ClipboardFragment = {
    text: string;
    meta: RichBlockMeta;
    marks: ClipboardMarkRange[];
};

export type ClipboardAnnotation = {
    originalId: string;
    presentation: AnnotationPresentation;
    resolved?: boolean;
    bodyBlocks: ClipboardFragment[];
};

export type RichClipboardPayload = {
    version: 1;
    plainText: string;
    html: string;
    fragments: ClipboardFragment[];
    annotations: ClipboardAnnotation[];
};

type FragmentBuildResult = {
    fragment: ClipboardFragment;
    annotationRefs: ClipboardAnnotationRef[];
};

const INLINE_MARK_TYPES = new Set<ClipboardInlineMarkType>([
    'bold',
    'italic',
    'strikethrough',
    'link',
    'annotation',
]);

const PRESENTATIONS = new Set<AnnotationPresentation>(['sidebar', 'footnote', 'popover']);

export const parseBlockRichTextClipboardPayload = (value: string): RichClipboardPayload | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }

    if (!isRecord(parsed)) return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.plainText !== 'string') return null;
    if (typeof parsed.html !== 'string') return null;
    if (!Array.isArray(parsed.fragments)) return null;
    if (!Array.isArray(parsed.annotations)) return null;

    const fragments = parseFragments(parsed.fragments);
    if (!fragments) return null;
    const annotations = parseAnnotations(parsed.annotations);
    if (!annotations) return null;

    return {
        version: 1,
        plainText: parsed.plainText,
        html: parsed.html,
        fragments,
        annotations,
    };
};

export const serializeSelectionToClipboardPayload = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
): RichClipboardPayload | null => {
    const formatted = materializeFormattedBlocks(state, annotationMarkBehavior);
    const formattedById = new Map(formatted.map((block) => [block.id, block]));
    const merged = mergeOverlappingRanges(state, selection);
    const resolved = resolveSelectionSet(state, {primaryId: selection.primaryId, entries: merged});
    const fragments: ClipboardFragment[] = [];
    const refs: ClipboardAnnotationRef[] = [];

    for (const entry of resolved.entries) {
        for (const segment of normalizeSelectionSegments(state, entry.selection)) {
            const block = formattedById.get(segment.blockId);
            if (!block) continue;
            const built = fragmentForRange(block, segment.startOffset, segment.endOffset);
            if (!built.fragment.text) continue;
            fragments.push(built.fragment);
            refs.push(...built.annotationRefs);
        }
    }

    if (!fragments.length) return null;

    const annotations = collectAnnotations(state, refs);
    const plainText = fragments.map((fragment) => fragment.text).join('\n');
    const html = fragmentsToHtml(fragments);
    return {version: 1, plainText, html, fragments, annotations};
};

const parseAnnotations = (value: unknown[]): ClipboardAnnotation[] | null => {
    const result: ClipboardAnnotation[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!isRecord(item)) return null;
        if (typeof item.originalId !== 'string' || !item.originalId) return null;
        if (!PRESENTATIONS.has(item.presentation as AnnotationPresentation)) return null;
        if (item.resolved !== undefined && typeof item.resolved !== 'boolean') return null;
        if (!Array.isArray(item.bodyBlocks)) return null;
        if (seen.has(item.originalId)) return null;
        const bodyBlocks = parseFragments(item.bodyBlocks);
        if (!bodyBlocks) return null;
        seen.add(item.originalId);
        result.push({
            originalId: item.originalId,
            presentation: item.presentation as AnnotationPresentation,
            ...(item.resolved === undefined ? {} : {resolved: item.resolved}),
            bodyBlocks,
        });
    }
    return result;
};

const collectAnnotations = (
    state: CachedState<RichBlockMeta>,
    initialRefs: ClipboardAnnotationRef[],
): ClipboardAnnotation[] => {
    const formattedBodies = materializeFormattedBlocks(state, richTextVirtualParents(state));
    const formattedById = new Map(formattedBodies.map((block) => [block.id, block]));
    const byId = new Map<string, ClipboardAnnotationRef>();
    const queue: ClipboardAnnotationRef[] = [];
    const result: ClipboardAnnotation[] = [];
    const visited = new Set<string>();

    const enqueue = (ref: ClipboardAnnotationRef) => {
        const existing = byId.get(ref.originalId);
        if (!existing) {
            byId.set(ref.originalId, ref);
            queue.push(ref);
        } else if (ref.resolved && !existing.resolved) {
            byId.set(ref.originalId, ref);
        }
    };
    initialRefs.forEach(enqueue);

    while (queue.length) {
        const ref = queue.shift();
        if (!ref || visited.has(ref.originalId)) continue;
        visited.add(ref.originalId);
        const bodyBlocks = bodyFragmentsForAnnotation(state, formattedById, ref);
        result.push({
            originalId: ref.originalId,
            presentation: ref.presentation,
            ...(ref.resolved ? {resolved: true} : {}),
            bodyBlocks: bodyBlocks.map((item) => item.fragment),
        });
        for (const body of bodyBlocks) {
            body.annotationRefs.forEach(enqueue);
        }
    }

    return result;
};

const bodyFragmentsForAnnotation = (
    state: CachedState<RichBlockMeta>,
    formattedById: Map<string, FormattedBlock<RichBlockMeta>>,
    ref: ClipboardAnnotationRef,
): FragmentBuildResult[] => {
    const id = parseLamportStringOrNull(ref.originalId);
    if (!id) return [];
    return annotationBodyBlockIds(state, id)
        .map((blockId) => formattedById.get(blockId))
        .filter((block): block is FormattedBlock<RichBlockMeta> => Boolean(block))
        .map((block) => fragmentForRange(block, 0, formattedRunsTextLength(block.runs)))
        .filter((result) => result.fragment.text || result.fragment.marks.length || result.fragment.meta);
};

const fragmentForRange = (
    block: FormattedBlock<RichBlockMeta>,
    startOffset: number,
    endOffset: number,
): FragmentBuildResult => {
    const chars: string[] = [];
    const marks: ClipboardMarkRange[] = [];
    const annotationRefs: ClipboardAnnotationRef[] = [];

    for (const run of runsWithOffsets(block.runs)) {
        const start = Math.max(startOffset, run.startOffset);
        const end = Math.min(endOffset, run.endOffset);
        if (start >= end) continue;

        const localStart = chars.length;
        const runChars = segmentText(run.run.text);
        chars.push(...runChars.slice(start - run.startOffset, end - run.startOffset));
        const localEnd = chars.length;
        appendRunMarks(marks, annotationRefs, run.run, localStart, localEnd);
    }

    return {
        fragment: {
            text: chars.join(''),
            meta: block.block.meta,
            marks: mergeAdjacentMarks(marks),
        },
        annotationRefs,
    };
};

const appendRunMarks = (
    marks: ClipboardMarkRange[],
    annotationRefs: ClipboardAnnotationRef[],
    run: FormattedRun,
    startOffset: number,
    endOffset: number,
) => {
    if (startOffset >= endOffset) return;
    for (const type of ['bold', 'italic', 'strikethrough'] as const) {
        if (run.marks[type] === true) marks.push({type, startOffset, endOffset});
    }
    const href = run.marks[LINK_MARK];
    if (typeof href === 'string') {
        marks.push({type: 'link', startOffset, endOffset, data: href});
    }
    for (const data of formattedMarkValues(run, ANNOTATION_MARK)) {
        if (!isAnnotationMarkData(data)) continue;
        const ref: ClipboardAnnotationRef = {
            originalId: lamportToString(data.id),
            presentation: data.presentation,
            ...(data.resolved ? {resolved: true} : {}),
        };
        marks.push({type: 'annotation', startOffset, endOffset, data: ref});
        annotationRefs.push(ref);
    }
};

const mergeAdjacentMarks = (marks: ClipboardMarkRange[]): ClipboardMarkRange[] => {
    const result: ClipboardMarkRange[] = [];
    for (const mark of marks) {
        const last = result[result.length - 1];
        if (
            last &&
            last.type === mark.type &&
            last.endOffset === mark.startOffset &&
            deepEqualJson(last.data, mark.data)
        ) {
            last.endOffset = mark.endOffset;
        } else {
            result.push({...mark});
        }
    }
    return result;
};

export const fragmentsToHtml = (fragments: ClipboardFragment[]): string =>
    fragments.map(fragmentToHtml).join('');

const fragmentToHtml = (fragment: ClipboardFragment): string => {
    const boundaries = new Set<number>([0, segmentText(fragment.text).length]);
    for (const mark of fragment.marks) {
        boundaries.add(mark.startOffset);
        boundaries.add(mark.endOffset);
    }
    const offsets = [...boundaries].sort((a, b) => a - b);
    const chars = segmentText(fragment.text);
    let inner = '';
    for (let index = 0; index < offsets.length - 1; index++) {
        const start = offsets[index];
        const end = offsets[index + 1];
        if (start === undefined || end === undefined || start >= end) continue;
        const active = fragment.marks.filter((mark) => mark.startOffset <= start && mark.endOffset >= end);
        inner += wrapHtmlText(chars.slice(start, end).join(''), active);
    }
    const tag = htmlTagForMeta(fragment.meta);
    const attrs = ` data-umkehr-block-type="${escapeAttribute(fragment.meta.type)}"`;
    return `<${tag}${attrs}>${inner || '<br>'}</${tag}>`;
};

const wrapHtmlText = (text: string, marks: ClipboardMarkRange[]): string => {
    let result = escapeHtml(text);
    for (const mark of sortedHtmlMarks(marks)) {
        if (mark.type === 'bold') result = `<strong>${result}</strong>`;
        if (mark.type === 'italic') result = `<em>${result}</em>`;
        if (mark.type === 'strikethrough') result = `<s>${result}</s>`;
        if (mark.type === 'link' && typeof mark.data === 'string') {
            result = `<a href="${escapeAttribute(mark.data)}">${result}</a>`;
        }
        if (mark.type === 'annotation' && isClipboardAnnotationRef(mark.data)) {
            const resolved = mark.data.resolved ? ` data-umkehr-annotation-resolved="true"` : '';
            result = `<span data-umkehr-annotation-id="${escapeAttribute(mark.data.originalId)}" data-umkehr-annotation-presentation="${escapeAttribute(mark.data.presentation)}"${resolved}>${result}</span>`;
        }
    }
    return result;
};

const sortedHtmlMarks = (marks: ClipboardMarkRange[]): ClipboardMarkRange[] =>
    marks.slice().sort((a, b) => htmlMarkRank(a.type) - htmlMarkRank(b.type));

const htmlMarkRank = (type: ClipboardInlineMarkType): number => {
    switch (type) {
        case 'annotation':
            return 0;
        case 'link':
            return 1;
        case 'strikethrough':
            return 2;
        case 'italic':
            return 3;
        case 'bold':
            return 4;
    }
};

const htmlTagForMeta = (meta: RichBlockMeta): string => {
    if (meta.type === 'heading') return `h${meta.level}`;
    if (meta.type === 'blockquote') return 'blockquote';
    if (meta.type === 'code') return 'pre';
    if (meta.type === 'list_item') return 'li';
    return 'p';
};

const runsWithOffsets = (runs: FormattedRun[]) => {
    let offset = 0;
    return runs.map((run) => {
        const length = segmentText(run.text).length;
        const result = {run, startOffset: offset, endOffset: offset + length};
        offset += length;
        return result;
    });
};

const formattedRunsTextLength = (runs: FormattedRun[]): number =>
    runs.reduce((length, run) => length + segmentText(run.text).length, 0);

const isAnnotationMarkData = (value: unknown): value is AnnotationMarkData =>
    isRecord(value) &&
    Array.isArray(value.id) &&
    PRESENTATIONS.has(value.presentation as AnnotationPresentation) &&
    (value.resolved === undefined || typeof value.resolved === 'boolean');

const parseLamportStringOrNull = (value: string): Lamport | null => {
    const match = /^(\d+)-(.+)$/.exec(value);
    if (!match || match[1] === undefined || match[2] === undefined) return null;
    return [Number(match[1]), match[2]];
};

const deepEqualJson = (one: unknown, two: unknown): boolean => JSON.stringify(one) === JSON.stringify(two);

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const escapeAttribute = (value: string): string =>
    escapeHtml(value)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const parseFragments = (value: unknown[]): ClipboardFragment[] | null => {
    const result: ClipboardFragment[] = [];
    for (const item of value) {
        if (!isRecord(item)) return null;
        if (typeof item.text !== 'string') return null;
        if (!isRichBlockMeta(item.meta)) return null;
        if (!Array.isArray(item.marks)) return null;
        const marks = parseMarks(item.marks, segmentText(item.text).length);
        if (!marks) return null;
        result.push({text: item.text, meta: item.meta, marks});
    }
    return result;
};

const parseMarks = (value: unknown[], textLength: number): ClipboardMarkRange[] | null => {
    const result: ClipboardMarkRange[] = [];
    for (const item of value) {
        if (!isRecord(item)) return null;
        if (!INLINE_MARK_TYPES.has(item.type as ClipboardInlineMarkType)) return null;
        if (!Number.isInteger(item.startOffset) || !Number.isInteger(item.endOffset)) return null;
        const startOffset = item.startOffset as number;
        const endOffset = item.endOffset as number;
        if (startOffset < 0 || endOffset <= startOffset || endOffset > textLength) {
            return null;
        }
        if (item.type === 'link' && typeof item.data !== 'string') return null;
        if (item.type === 'annotation' && !isClipboardAnnotationRef(item.data)) return null;
        if (item.type !== 'link' && item.type !== 'annotation' && item.data !== undefined && item.data !== true) {
            return null;
        }
        result.push({
            type: item.type as ClipboardInlineMarkType,
            startOffset,
            endOffset,
            ...(item.data === undefined ? {} : {data: item.data}),
        });
    }
    return result;
};

export type ClipboardAnnotationRef = {
    originalId: string;
    presentation: AnnotationPresentation;
    resolved?: boolean;
};

export const isClipboardAnnotationRef = (value: unknown): value is ClipboardAnnotationRef =>
    isRecord(value) &&
    typeof value.originalId === 'string' &&
    value.originalId.length > 0 &&
    PRESENTATIONS.has(value.presentation as AnnotationPresentation) &&
    (value.resolved === undefined || typeof value.resolved === 'boolean');

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isRichBlockMeta = (value: unknown): value is RichBlockMeta => {
    if (!isRecord(value) || typeof value.ts !== 'string') return false;
    switch (value.type) {
        case 'paragraph':
        case 'blockquote':
        case 'table':
            return true;
        case 'heading':
            return value.level === 1 || value.level === 2 || value.level === 3;
        case 'list_item':
            return value.kind === 'ordered' || value.kind === 'unordered';
        case 'todo':
            return typeof value.checked === 'boolean';
        case 'code':
            return typeof value.language === 'string';
        case 'callout':
            return value.kind === 'info' || value.kind === 'warning' || value.kind === 'error';
        default:
            return false;
    }
};
