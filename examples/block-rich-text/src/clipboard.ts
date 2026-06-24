import {
    blockContents,
    formattedMarkValues,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    type FormattedBlock,
    type FormattedRun,
} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import type {Lamport} from 'umkehr/block-crdt/types';
import {annotationBodyBlockIds} from './annotations';
import {LINK_MARK} from './inlineMarks';
import {
    INLINE_EMBED_MARK,
    INLINE_EMBED_TEXT,
    inlineEmbedPlugins,
    isInlineEmbedData,
    plainTextForInlineEmbed,
} from './inlineEmbeds';
import {
    highlightIngredientLine,
    type IngredientHighlightClassName,
} from './ingredientHighlight';
import {
    editableBlockIds,
    normalizeSelectionSegments,
    segmentText,
    selectedBlockIdsForSelection,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
    type EditorSelection,
} from './selectionModel';
import type {PreviewMetadata, RichBlockMeta} from './blockMeta';
import {isSerializedImageAttachment, type SerializedImageAttachment} from './attachments';
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
const HTML_PAYLOAD_PREFIX = 'umkehr-block-rich-text:';

export type ClipboardBooleanMarkType = 'bold' | 'italic' | 'strikethrough';
export type ClipboardInlineMarkType = ClipboardBooleanMarkType | 'link' | 'annotation' | 'embed';

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
    attachments?: SerializedImageAttachment[];
    tsv?: string;
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
    'embed',
]);

const PRESENTATIONS = new Set<AnnotationPresentation>(['sidebar', 'footnote', 'popover']);

export const parseBlockRichTextClipboardPayload = (value: string): RichClipboardPayload | null => {
    if (!value || value.trimStart()[0] !== '{') return null;
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
    if (parsed.attachments !== undefined && !Array.isArray(parsed.attachments)) return null;
    if (parsed.tsv !== undefined && typeof parsed.tsv !== 'string') return null;

    const fragments = parseFragments(parsed.fragments);
    if (!fragments) return null;
    const annotations = parseAnnotations(parsed.annotations);
    if (!annotations) return null;
    const attachments = parseAttachments(parsed.attachments);
    if (!attachments) return null;

    return {
        version: 1,
        plainText: parsed.plainText,
        html: parsed.html,
        fragments,
        annotations,
        ...(attachments.length ? {attachments} : {}),
        ...(parsed.tsv ? {tsv: parsed.tsv} : {}),
    };
};

export const htmlWithClipboardPayload = (payload: RichClipboardPayload): string =>
    `${payload.html}<!--${HTML_PAYLOAD_PREFIX}${encodeURIComponent(JSON.stringify(payload))}-->`;

export const parseBlockRichTextClipboardHtml = (value: string): RichClipboardPayload | null => {
    const commentStart = `<!--${HTML_PAYLOAD_PREFIX}`;
    const start = value.lastIndexOf(commentStart);
    if (start < 0) return null;
    const encodedStart = start + commentStart.length;
    const end = value.indexOf('-->', encodedStart);
    if (end < 0) return null;
    try {
        return parseBlockRichTextClipboardPayload(decodeURIComponent(value.slice(encodedStart, end)));
    } catch {
        return null;
    }
};

export const serializeSelectionToClipboardPayload = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    attachments: SerializedImageAttachment[] = [],
): RichClipboardPayload | null => {
    const formatted = materializeFormattedBlocks(state, annotationMarkBehavior);
    const formattedById = new Map(formatted.map((block) => [block.id, block]));
    const initialResolved = resolveSelectionSet(state, selection);
    const hasBlockLevelSelection = initialResolved.entries.some(
        (entry) => entry.selection.type === 'block' || entry.selection.type === 'table-cells',
    );
    const merged = hasBlockLevelSelection ? selection.entries : mergeOverlappingRanges(state, selection);
    const resolved = resolveSelectionSet(state, {primaryId: selection.primaryId, entries: merged});
    const fragments: ClipboardFragment[] = [];
    const refs: ClipboardAnnotationRef[] = [];
    const includedBlockIds = new Set<string>();
    let tsv: string | null = null;

    for (const entry of resolved.entries) {
        if (entry.selection.type === 'block' || entry.selection.type === 'table-cells') {
            for (const blockId of selectedBlockIdsForSelection(state, entry.selection)) {
                if (includedBlockIds.has(blockId)) continue;
                const block = formattedById.get(blockId);
                if (!block) continue;
                const built = fragmentForRange(block, 0, formattedRunsTextLength(block.runs));
                fragments.push(built.fragment);
                refs.push(...built.annotationRefs);
                includedBlockIds.add(block.id);
            }
            if (entry.selection.type === 'table-cells' && entry.id === resolved.primaryId) {
                tsv = tableSelectionToTsv(state, entry.selection);
            }
            continue;
        }
        for (const segment of normalizeSelectionSegments(state, entry.selection)) {
            const block = formattedById.get(segment.blockId);
            if (!block) continue;
            const built = fragmentForRange(block, segment.startOffset, segment.endOffset);
            if (!built.fragment.text && built.fragment.meta.type !== 'image') continue;
            fragments.push(built.fragment);
            refs.push(...built.annotationRefs);
            includedBlockIds.add(block.id);
        }
        for (const blockId of emptyImageBlockIdsForSelection(state, entry.selection)) {
            if (includedBlockIds.has(blockId)) continue;
            const block = formattedById.get(blockId);
            if (!block) continue;
            const built = fragmentForRange(block, 0, 0);
            fragments.push(built.fragment);
            refs.push(...built.annotationRefs);
            includedBlockIds.add(block.id);
        }
    }

    if (!fragments.length) return null;

    const annotations = collectAnnotations(state, refs);
    const plainText = fragments.map(fragmentToPlainText).join('\n');
    const html = fragmentsToHtml(fragments);
    const attachmentIds = new Set(
        fragments
            .map((fragment) =>
                fragment.meta.type === 'image' ? fragment.meta.attachmentId : null,
            )
            .filter((id): id is string => Boolean(id)),
    );
    const copiedAttachments = attachments.filter((attachment) => attachmentIds.has(attachment.id));
    return {
        version: 1,
        plainText,
        html,
        fragments,
        annotations,
        ...(copiedAttachments.length ? {attachments: copiedAttachments} : {}),
        ...(tsv ? {tsv} : {}),
    };
};

const tableSelectionToTsv = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string | null => {
    const rectangle = tableCellRectangleForSelection(state, selection);
    if (!rectangle) return null;
    const rows = tableRowsForSelection(state, rectangle.tableId);
    const lines: string[] = [];
    for (let rowIndex = rectangle.startRowIndex; rowIndex <= rectangle.endRowIndex; rowIndex++) {
        const rowId = rows[rowIndex];
        if (!rowId) continue;
        const cells = tableCellsForSelection(state, rowId);
        const values: string[] = [];
        for (
            let columnIndex = rectangle.startColumnIndex;
            columnIndex <= rectangle.endColumnIndex;
            columnIndex++
        ) {
            const cellId = cells[columnIndex];
            values.push(tsvCell(cellId ? blockContents(state, cellId) : ''));
        }
        lines.push(values.join('\t'));
    }
    return lines.length ? lines.join('\n') : null;
};

const tsvCell = (value: string): string => {
    if (!/[\t\n"]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
};

const emptyImageBlockIdsForSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
): string[] => {
    if (selection.type !== 'range') return [];
    const blocks = editableBlockIds(state);
    const anchorIndex = blocks.indexOf(selection.anchor.blockId);
    const focusIndex = blocks.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) return [];
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    return blocks.slice(start, end + 1).filter((blockId) => {
        const block = state.state.blocks[blockId];
        return (
            block?.meta.type === 'image' &&
            orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).length === 0
        );
    });
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

const parseAttachments = (value: unknown): SerializedImageAttachment[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    const result: SerializedImageAttachment[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!isSerializedImageAttachment(item) || seen.has(item.id)) return null;
        seen.add(item.id);
        result.push(item);
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
    const embed = run.marks[INLINE_EMBED_MARK];
    if (isInlineEmbedData(embed)) {
        marks.push({type: 'embed', startOffset, endOffset, data: embed});
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
    const ingredientTokens =
        fragment.meta.type === 'recipe_ingredient' ? highlightIngredientLine(fragment.text) : [];
    for (const mark of fragment.marks) {
        boundaries.add(mark.startOffset);
        boundaries.add(mark.endOffset);
    }
    for (const token of ingredientTokens) {
        boundaries.add(token.startOffset);
        boundaries.add(token.endOffset);
    }
    const offsets = [...boundaries].sort((a, b) => a - b);
    const chars = segmentText(fragment.text);
    let inner = '';
    for (let index = 0; index < offsets.length - 1; index++) {
        const start = offsets[index];
        const end = offsets[index + 1];
        if (start === undefined || end === undefined || start >= end) continue;
        const active = fragment.marks.filter((mark) => mark.startOffset <= start && mark.endOffset >= end);
        const activeIngredients = ingredientTokens
            .filter((token) => token.startOffset <= start && token.endOffset >= end)
            .map((token) => token.className);
        inner += wrapHtmlText(chars.slice(start, end).join(''), active, activeIngredients);
    }
    const tag = htmlTagForMeta(fragment.meta);
    const attrs = ` data-umkehr-block-type="${escapeAttribute(fragment.meta.type)}"`;
    if (fragment.meta.type === 'preview') {
        const title = fragment.meta.preview?.title || fragment.meta.url;
        const link = `<a href="${escapeAttribute(fragment.meta.url)}">${escapeHtml(title)}</a>`;
        const body = inner ? `${link}<br>${inner}` : link;
        return `<${tag}${attrs} data-umkehr-preview-url="${escapeAttribute(fragment.meta.url)}">${body}</${tag}>`;
    }
    return `<${tag}${attrs}>${inner || '<br>'}</${tag}>`;
};

const fragmentToPlainText = (fragment: ClipboardFragment): string => {
    const chars = segmentText(fragment.text);
    let result = '';
    for (let offset = 0; offset < chars.length; offset++) {
        if (chars[offset] === INLINE_EMBED_TEXT) {
            const embed = fragment.marks.find(
                (mark) =>
                    mark.type === 'embed' &&
                    mark.startOffset <= offset &&
                    mark.endOffset > offset &&
                    isInlineEmbedData(mark.data),
            );
            result += plainTextForInlineEmbed(
                embed && isInlineEmbedData(embed.data) ? embed.data : null,
                inlineEmbedPlugins,
                {ambientMarks: {}},
            );
        } else {
            result += chars[offset];
        }
    }
    return result;
};

const wrapHtmlText = (
    text: string,
    marks: ClipboardMarkRange[],
    ingredientClasses: IngredientHighlightClassName[] = [],
): string => {
    const embed = marks.find((mark) => mark.type === 'embed' && isInlineEmbedData(mark.data));
    if (text === INLINE_EMBED_TEXT) {
        const plainText = plainTextForInlineEmbed(
            embed && isInlineEmbedData(embed.data) ? embed.data : null,
            inlineEmbedPlugins,
            {ambientMarks: {}},
        );
        return `<span data-umkehr-embed-type="${escapeAttribute(
            embed && isInlineEmbedData(embed.data) ? embed.data.type : 'unknown',
        )}">${escapeHtml(plainText)}</span>`;
    }
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
    result = wrapIngredientHtml(result, marks, ingredientClasses);
    return result;
};

const wrapIngredientHtml = (
    html: string,
    marks: ClipboardMarkRange[],
    ingredientClasses: IngredientHighlightClassName[],
): string => {
    let result = html;
    for (const className of ingredientClasses) {
        if (
            (className === 'ingredient-amount' || className === 'ingredient-unit') &&
            !marks.some((mark) => mark.type === 'bold')
        ) {
            result = `<strong>${result}</strong>`;
        } else if (
            className === 'ingredient-prep' &&
            !marks.some((mark) => mark.type === 'italic')
        ) {
            result = `<em>${result}</em>`;
        } else if (className === 'ingredient-name') {
            result = `<span style="color: #1e7f4f">${result}</span>`;
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
        case 'embed':
            return 1;
        case 'link':
            return 2;
        case 'strikethrough':
            return 3;
        case 'italic':
            return 4;
        case 'bold':
            return 5;
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
        if (item.type === 'embed' && !isInlineEmbedData(item.data)) return null;
        if (
            item.type !== 'link' &&
            item.type !== 'annotation' &&
            item.type !== 'embed' &&
            item.data !== undefined &&
            item.data !== true
        ) {
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
        case 'recipe_ingredient':
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
        case 'image':
            return (
                typeof value.attachmentId === 'string' &&
                value.attachmentId.length > 0 &&
                isImagePresentationSize(value.size)
            );
        case 'preview':
            return (
                typeof value.url === 'string' &&
                (value.url === '' || isAbsoluteHttpUrl(value.url)) &&
                (value.preview === null || isPreviewMetadata(value.preview))
            );
        default:
            return false;
    }
};

const isImagePresentationSize = (value: unknown): boolean =>
    value === 'small' || value === 'medium' || value === 'large' || value === 'original';

const isPreviewMetadata = (value: unknown): value is PreviewMetadata => {
    if (!isRecord(value)) return false;
    return (
        optionalString(value.title) &&
        optionalString(value.description) &&
        optionalString(value.siteName) &&
        optionalString(value.imageUrl) &&
        optionalString(value.resolvedUrl) &&
        optionalString(value.fetchedAt)
    );
};

const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

const isAbsoluteHttpUrl = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};
