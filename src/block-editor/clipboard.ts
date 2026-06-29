import {
    blockContents,
    formattedMarkValues,
    isDeleted,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    type FormattedBlock,
    type FormattedRun,
} from '../block-crdt/index.js';
import {lamportToString} from '../block-crdt/utils.js';
import type {Lamport} from '../block-crdt/types.js';
import {annotationBodyBlockIds} from './annotations';
import {LINK_MARK, MATH_MARK, mathDisplayModeFromMarkValue} from './inlineMarks';
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
    selectedTopLevelBlockIdsForSelection,
    tableCellRectangleForSelection,
    tableCellsForSelection,
    tableRowsForSelection,
    visibleSubtreeBlockIds,
    type EditorSelection,
} from './selectionModel';
import type {BlockEditorRegistry} from './plugins/types.js';
import {selectedBlockIdsFromRegistry} from './selectionPlugins.js';
import {
    codePreviewKindForLanguage,
    blockStyleHasDocumentValues,
    documentStyleFromBlockStyle,
    isSlideDeckFooterMode,
    isSlideTransition,
    normalizeRichBlockStyleValue,
    type PreviewMetadata,
    type RichBlockDocumentStyle,
    type RichBlockStyleAttribute,
    type RichBlockMeta,
} from './blockMeta';
import {isPollMeta} from './pollBlocks';
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
import type {CachedState} from '../block-crdt/types.js';

export const BLOCK_RICH_TEXT_MIME = 'application/x-umkehr-block-rich-text+json';
const HTML_PAYLOAD_PREFIX = 'umkehr-block-rich-text:';

export type ClipboardBooleanMarkType = 'bold' | 'italic' | 'strikethrough' | 'underline';
export type ClipboardInlineMarkType = ClipboardBooleanMarkType | 'link' | 'annotation' | 'embed' | 'math';

export type ClipboardInlineFeatureSet = {
    booleanMarks?: ReadonlySet<ClipboardBooleanMarkType>;
    links?: boolean;
    math?: boolean;
    annotations?: boolean;
    inlineEmbeds?: ReadonlySet<string>;
};

export type ClipboardBlockFeatureSet = {
    blockTypes: ReadonlySet<string> | null;
};

type NormalizedClipboardInlineFeatureSet = {
    booleanMarks: ReadonlySet<ClipboardBooleanMarkType>;
    links: boolean;
    math: boolean;
    annotations: boolean;
    inlineEmbeds: ReadonlySet<string> | null;
};

export type ClipboardMarkRange = {
    type: ClipboardInlineMarkType;
    startOffset: number;
    endOffset: number;
    data?: unknown;
};

export type ClipboardFragment = {
    text: string;
    meta: RichBlockMeta;
    style?: RichBlockDocumentStyle;
    marks: ClipboardMarkRange[];
    sourceBlockId?: string;
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
    sourceSelectionType?: 'block' | 'table-cells';
};

type FragmentBuildResult = {
    fragment: ClipboardFragment;
    annotationRefs: ClipboardAnnotationRef[];
};

const INLINE_MARK_TYPES = new Set<ClipboardInlineMarkType>([
    'bold',
    'italic',
    'strikethrough',
    'underline',
    'link',
    'annotation',
    'embed',
    'math',
]);

const PRESENTATIONS = new Set<AnnotationPresentation>(['sidebar', 'footnote', 'popover']);
const ALL_CLIPBOARD_BOOLEAN_MARKS: readonly ClipboardBooleanMarkType[] = [
    'bold',
    'italic',
    'strikethrough',
    'underline',
];

const normalizeClipboardInlineFeatures = (
    features: ClipboardInlineFeatureSet = {},
): NormalizedClipboardInlineFeatureSet => ({
    booleanMarks: features.booleanMarks ?? new Set(ALL_CLIPBOARD_BOOLEAN_MARKS),
    links: features.links ?? true,
    math: features.math ?? true,
    annotations: features.annotations ?? true,
    inlineEmbeds: features.inlineEmbeds ?? null,
});

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
    if (
        parsed.sourceSelectionType !== undefined &&
        parsed.sourceSelectionType !== 'block' &&
        parsed.sourceSelectionType !== 'table-cells'
    ) {
        return null;
    }

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
        ...(parsed.sourceSelectionType ? {sourceSelectionType: parsed.sourceSelectionType} : {}),
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

export const filterRichClipboardPayloadInlineFeatures = (
    payload: RichClipboardPayload,
    inlineFeatures: ClipboardInlineFeatureSet,
): RichClipboardPayload => {
    const normalizedInlineFeatures = normalizeClipboardInlineFeatures(inlineFeatures);
    const fragments = payload.fragments.map((fragment) =>
        filterClipboardFragmentInlineFeatures(fragment, normalizedInlineFeatures),
    );
    const annotations = normalizedInlineFeatures.annotations
        ? payload.annotations.map((annotation) => ({
              ...annotation,
              bodyBlocks: annotation.bodyBlocks.map((fragment) =>
                  filterClipboardFragmentInlineFeatures(fragment, normalizedInlineFeatures),
              ),
          }))
        : [];
    return {
        ...payload,
        fragments,
        annotations,
        plainText: fragments.map(fragmentToPlainText).join('\n'),
        html: fragmentsToHtml(fragments),
    };
};

export const filterRichClipboardPayloadBlockFeatures = (
    payload: RichClipboardPayload,
    blockFeatures: ClipboardBlockFeatureSet,
): RichClipboardPayload => {
    const fragments = payload.fragments
        .map((fragment) => filterClipboardFragmentBlockFeatures(fragment, blockFeatures))
        .filter((fragment) => fragment.text || fragment.marks.length || fragment.meta.type === 'image');
    const annotations = payload.annotations.map((annotation) => ({
        ...annotation,
        bodyBlocks: annotation.bodyBlocks
            .map((fragment) => filterClipboardFragmentBlockFeatures(fragment, blockFeatures))
            .filter((fragment) => fragment.text || fragment.marks.length || fragment.meta.type === 'image'),
    }));
    const attachmentIds = new Set(
        fragments
            .map((fragment) =>
                fragment.meta.type === 'image' ? fragment.meta.attachmentId : null,
            )
            .filter((id): id is string => Boolean(id)),
    );
    const attachments = payload.attachments?.filter((attachment) => attachmentIds.has(attachment.id));
    return {
        ...payload,
        fragments,
        annotations,
        plainText: fragments.map(fragmentToPlainText).join('\n'),
        html: fragmentsToHtml(fragments),
        ...(attachments?.length ? {attachments} : {attachments: undefined}),
    };
};

export const serializeSelectionToClipboardPayload = (
    state: CachedState<RichBlockMeta>,
    selection: RetainedSelectionSet,
    attachments: SerializedImageAttachment[] = [],
    inlineFeatures?: ClipboardInlineFeatureSet,
    blockFeatures?: ClipboardBlockFeatureSet,
    registry?: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins' | 'commands'>,
): RichClipboardPayload | null => {
    const normalizedInlineFeatures = normalizeClipboardInlineFeatures(inlineFeatures);
    const formatted = materializeFormattedBlocks(state, annotationMarkBehavior);
    const formattedById = new Map(formatted.map((block) => [block.id, block]));
    const initialResolved = resolveSelectionSet(state, selection);
    const tableClipboardAvailable = registry ? registry.commands.has('table:clipboard') : true;
    const hasBlockLevelSelection = initialResolved.entries.some(
        (entry) =>
            entry.selection.type === 'block' ||
            (tableClipboardAvailable && entry.selection.type === 'table-cells'),
    );
    const sourceSelectionType = clipboardSourceSelectionType(initialResolved.entries, tableClipboardAvailable);
    const merged = hasBlockLevelSelection ? selection.entries : mergeOverlappingRanges(state, selection);
    const resolved = resolveSelectionSet(state, {primaryId: selection.primaryId, entries: merged});
    const fragments: ClipboardFragment[] = [];
    const refs: ClipboardAnnotationRef[] = [];
    const includedBlockIds = new Set<string>();
    let tsv: string | null = null;

    for (const entry of resolved.entries) {
        if (entry.selection.type === 'block' || (tableClipboardAvailable && entry.selection.type === 'table-cells')) {
            for (const blockId of clipboardBlockIdsForBlockLevelSelection(state, entry.selection, registry)) {
                if (includedBlockIds.has(blockId)) continue;
                const block = formattedById.get(blockId);
                if (!block) continue;
                const built = fragmentForRange(
                    block,
                    0,
                    formattedRunsTextLength(block.runs),
                    normalizedInlineFeatures,
                );
                built.fragment.sourceBlockId = block.id;
                fragments.push(built.fragment);
                refs.push(...built.annotationRefs);
                includedBlockIds.add(block.id);
            }
            if (tableClipboardAvailable && entry.selection.type === 'table-cells' && entry.id === resolved.primaryId) {
                tsv = tableSelectionToTsv(state, entry.selection);
            }
            continue;
        }
        for (const segment of normalizeSelectionSegments(state, entry.selection)) {
            const block = formattedById.get(segment.blockId);
            if (!block) continue;
            const built = fragmentForRange(
                block,
                segment.startOffset,
                segment.endOffset,
                normalizedInlineFeatures,
            );
            if (!built.fragment.text && built.fragment.meta.type !== 'image') continue;
            fragments.push(built.fragment);
            refs.push(...built.annotationRefs);
            includedBlockIds.add(block.id);
        }
        for (const blockId of emptyImageBlockIdsForSelection(state, entry.selection)) {
            if (includedBlockIds.has(blockId)) continue;
            const block = formattedById.get(blockId);
            if (!block) continue;
            const built = fragmentForRange(block, 0, 0, normalizedInlineFeatures);
            fragments.push(built.fragment);
            refs.push(...built.annotationRefs);
            includedBlockIds.add(block.id);
        }
    }

    if (!fragments.length) return null;

    const annotations = collectAnnotations(state, refs, normalizedInlineFeatures);
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
    const payload: RichClipboardPayload = {
        version: 1,
        plainText,
        html,
        fragments,
        annotations,
        ...(copiedAttachments.length ? {attachments: copiedAttachments} : {}),
        ...(tsv ? {tsv} : {}),
        ...(sourceSelectionType ? {sourceSelectionType} : {}),
    };
    return blockFeatures ? filterRichClipboardPayloadBlockFeatures(payload, blockFeatures) : payload;
};

const filterClipboardFragmentInlineFeatures = (
    fragment: ClipboardFragment,
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
): ClipboardFragment => ({
    ...fragment,
    marks: fragment.marks.filter((mark) => clipboardMarkEnabled(mark, inlineFeatures)),
});

const filterClipboardFragmentBlockFeatures = (
    fragment: ClipboardFragment,
    blockFeatures: ClipboardBlockFeatureSet,
): ClipboardFragment => {
    if (clipboardBlockMetaEnabled(fragment.meta, blockFeatures)) return fragment;
    return {
        ...fragment,
        meta: {type: 'paragraph', ts: fragment.meta.ts},
    };
};

const clipboardBlockMetaEnabled = (
    meta: RichBlockMeta,
    blockFeatures: ClipboardBlockFeatureSet,
): boolean => meta.type === 'paragraph' || blockFeatures.blockTypes === null || blockFeatures.blockTypes.has(meta.type);

const clipboardMarkEnabled = (
    mark: ClipboardMarkRange,
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
): boolean => {
    if (mark.type === 'annotation') return inlineFeatures.annotations;
    if (mark.type === 'link') return inlineFeatures.links;
    if (mark.type === 'math') return inlineFeatures.math;
    if (mark.type === 'embed') {
        return (
            isInlineEmbedData(mark.data) &&
            (!inlineFeatures.inlineEmbeds || inlineFeatures.inlineEmbeds.has(mark.data.type))
        );
    }
    return inlineFeatures.booleanMarks.has(mark.type);
};

const clipboardSourceSelectionType = (
    entries: ReturnType<typeof resolveSelectionSet>['entries'],
    tableClipboardAvailable = true,
): RichClipboardPayload['sourceSelectionType'] | undefined => {
    if (entries.some((entry) => entry.selection.type === 'block')) return 'block';
    if (tableClipboardAvailable && entries.some((entry) => entry.selection.type === 'table-cells')) return 'table-cells';
    return undefined;
};

export const blockLinkHrefForClipboardPayload = (
    state: CachedState<RichBlockMeta>,
    payload: RichClipboardPayload,
): string | null => {
    if (payload.sourceSelectionType !== 'block' && payload.sourceSelectionType !== 'table-cells') {
        return null;
    }
    const sourceBlockId = payload.fragments.find((fragment) => fragment.sourceBlockId)?.sourceBlockId;
    if (!sourceBlockId) return null;
    const block = state.state.blocks[sourceBlockId];
    if (!block || isDeleted(block)) return null;
    return blockLinkHrefForBlockId(sourceBlockId);
};

export const blockDomIdForBlockId = (blockId: string): string => `block-${blockId}`;

export const blockLinkHrefForBlockId = (blockId: string): string => `#${blockDomIdForBlockId(blockId)}`;

export const blockIdFromBlockLinkHref = (href: string): string | null => {
    const prefix = `#${blockDomIdForBlockId('')}`;
    if (!href.startsWith(prefix)) return null;
    const blockId = href.slice(prefix.length);
    return blockId ? blockId : null;
};

const clipboardBlockIdsForBlockLevelSelection = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    registry?: Pick<BlockEditorRegistry<RichBlockMeta>, 'selectionPlugins'>,
): string[] => {
    if (selection.type !== 'block') {
        return registry
            ? selectedBlockIdsFromRegistry(registry, state, selection)
            : selectedBlockIdsForSelection(state, selection);
    }
    return selectedTopLevelBlockIdsForSelection(state, selection).flatMap((blockId) =>
        visibleSubtreeBlockIds(state, blockId),
    );
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
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
): ClipboardAnnotation[] => {
    if (!inlineFeatures.annotations) return [];
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
        const bodyBlocks = bodyFragmentsForAnnotation(state, formattedById, ref, inlineFeatures);
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
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
): FragmentBuildResult[] => {
    const id = parseLamportStringOrNull(ref.originalId);
    if (!id) return [];
    return annotationBodyBlockIds(state, id)
        .map((blockId) => formattedById.get(blockId))
        .filter((block): block is FormattedBlock<RichBlockMeta> => Boolean(block))
        .map((block) => fragmentForRange(block, 0, formattedRunsTextLength(block.runs), inlineFeatures))
        .filter((result) => result.fragment.text || result.fragment.marks.length || result.fragment.meta);
};

const fragmentForRange = (
    block: FormattedBlock<RichBlockMeta>,
    startOffset: number,
    endOffset: number,
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
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
        appendRunMarks(marks, annotationRefs, run.run, localStart, localEnd, inlineFeatures);
    }

    const style = documentStyleFromBlockStyle(block.block.style);
    return {
        fragment: {
            text: chars.join(''),
            meta: block.block.meta,
            ...(blockStyleHasDocumentValues(style) ? {style} : {}),
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
    inlineFeatures: NormalizedClipboardInlineFeatureSet,
) => {
    if (startOffset >= endOffset) return;
    for (const type of ['bold', 'italic', 'strikethrough', 'underline'] as const) {
        if (inlineFeatures.booleanMarks.has(type) && run.marks[type] === true) {
            marks.push({type, startOffset, endOffset});
        }
    }
    const href = run.marks[LINK_MARK];
    if (inlineFeatures.links && typeof href === 'string') {
        marks.push({type: 'link', startOffset, endOffset, data: href});
    }
    const mathMode = mathDisplayModeFromMarkValue(run.marks[MATH_MARK]);
    if (inlineFeatures.math && mathMode) {
        marks.push({
            type: 'math',
            startOffset,
            endOffset,
            ...(mathMode === 'display' ? {data: {display: true}} : {}),
        });
    }
    if (inlineFeatures.annotations) {
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
    }
    const embed = run.marks[INLINE_EMBED_MARK];
    if (isInlineEmbedData(embed) && (!inlineFeatures.inlineEmbeds || inlineFeatures.inlineEmbeds.has(embed.type))) {
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
    const style = fragment.style ? styleAttributeForDocumentStyle(fragment.style) : '';
    const attrs = ` data-umkehr-block-type="${escapeAttribute(fragment.meta.type)}"${style ? ` style="${escapeAttribute(style)}"` : ''}`;
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
        if (!embed || !isInlineEmbedData(embed.data)) return escapeHtml(text);
        const plainText = plainTextForInlineEmbed(
            embed.data,
            inlineEmbedPlugins,
            {ambientMarks: {}},
        );
        return `<span data-umkehr-embed-type="${escapeAttribute(
            embed.data.type,
        )}">${escapeHtml(plainText)}</span>`;
    }
    let result = escapeHtml(text);
    for (const mark of sortedHtmlMarks(marks)) {
        if (mark.type === 'bold') result = `<strong>${result}</strong>`;
        if (mark.type === 'italic') result = `<em>${result}</em>`;
        if (mark.type === 'strikethrough') result = `<s>${result}</s>`;
        if (mark.type === 'underline') result = `<u>${result}</u>`;
        if (mark.type === 'link' && typeof mark.data === 'string') {
            result = `<a href="${escapeAttribute(mark.data)}">${result}</a>`;
        }
        if (mark.type === 'annotation' && isClipboardAnnotationRef(mark.data)) {
            const resolved = mark.data.resolved ? ` data-umkehr-annotation-resolved="true"` : '';
            result = `<span data-umkehr-annotation-id="${escapeAttribute(mark.data.originalId)}" data-umkehr-annotation-presentation="${escapeAttribute(mark.data.presentation)}"${resolved}>${result}</span>`;
        }
        if (mark.type === 'math') {
            const display = isClipboardMathData(mark.data) && mark.data.display ? 'true' : 'false';
            result = `<span data-umkehr-math-display="${display}">${result}</span>`;
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
        case 'math':
            return 3;
        case 'strikethrough':
            return 4;
        case 'underline':
            return 5;
        case 'italic':
            return 6;
        case 'bold':
            return 7;
    }
};

const htmlTagForMeta = (meta: RichBlockMeta): string => {
    if (meta.type === 'heading') return `h${meta.level}`;
    if (meta.type === 'blockquote') return 'blockquote';
    if (meta.type === 'code') return 'pre';
    if (meta.type === 'list_item') return 'li';
    return 'p';
};

const styleAttributeForDocumentStyle = (style: RichBlockDocumentStyle): string => {
    const declarations: string[] = [];
    if (style.color) declarations.push(`color: ${style.color}`);
    if (style['background-color']) declarations.push(`background-color: ${style['background-color']}`);
    if (style['font-size']) declarations.push(`font-size: ${cssFontSizeForDocumentSize(style['font-size'])}`);
    if (style.padding) declarations.push(`padding: ${cssPaddingForDocumentSize(style.padding)}`);
    return declarations.join('; ');
};

const cssFontSizeForDocumentSize = (size: NonNullable<RichBlockDocumentStyle['font-size']>): string => {
    switch (size) {
        case 'xsmall':
            return '0.85em';
        case 'small':
            return '0.93em';
        case 'normal':
            return '1em';
        case 'large':
            return '1.15em';
        case 'xlarge':
            return '1.35em';
        default:
            return '1em';
    }
};

const cssPaddingForDocumentSize = (size: NonNullable<RichBlockDocumentStyle['padding']>): string => {
    switch (size) {
        case 'xsmall':
            return '2px 4px';
        case 'small':
            return '4px 8px';
        case 'normal':
            return '8px 12px';
        case 'large':
            return '12px 16px';
        case 'xlarge':
            return '18px 22px';
        default:
            return '8px 12px';
    }
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
        const style = parseDocumentStyle(item.style);
        if (!style) return null;
        if (!Array.isArray(item.marks)) return null;
        const marks = parseMarks(item.marks, segmentText(item.text).length);
        if (!marks) return null;
        if (item.sourceBlockId !== undefined && (typeof item.sourceBlockId !== 'string' || !item.sourceBlockId)) {
            return null;
        }
        result.push({
            text: item.text,
            meta: item.meta,
            ...(blockStyleHasDocumentValues(style) ? {style} : {}),
            marks,
            ...(typeof item.sourceBlockId === 'string' && item.sourceBlockId ? {sourceBlockId: item.sourceBlockId} : {}),
        });
    }
    return result;
};

const CLIPBOARD_STYLE_ATTRIBUTES = new Set<RichBlockStyleAttribute>(['background-color', 'color', 'font-size', 'padding']);

const parseDocumentStyle = (value: unknown): RichBlockDocumentStyle | null => {
    if (value === undefined) return {};
    if (!isRecord(value)) return null;
    const style: RichBlockDocumentStyle = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!CLIPBOARD_STYLE_ATTRIBUTES.has(key as RichBlockStyleAttribute)) return null;
        const attribute = key as RichBlockStyleAttribute;
        const normalized = normalizeRichBlockStyleValue(attribute, raw);
        if (normalized === undefined) return null;
        style[attribute] = normalized;
    }
    return style;
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
        if (item.type === 'math' && item.data !== undefined && !isClipboardMathData(item.data)) return null;
        if (
            item.type !== 'link' &&
            item.type !== 'annotation' &&
            item.type !== 'embed' &&
            item.type !== 'math' &&
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

export const isClipboardMathData = (value: unknown): value is {display?: boolean} =>
    isRecord(value) &&
    (value.display === undefined || typeof value.display === 'boolean') &&
    Object.keys(value).every((key) => key === 'display');

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
        case 'columns':
            return value.display === 'blocks' || value.display === 'cards';
        case 'slide_deck':
            return (
                Number.isInteger(value.width) &&
                (value.width as number) > 0 &&
                Number.isInteger(value.height) &&
                (value.height as number) > 0 &&
                isSlideDeckFooterMode(value.footer)
            );
        case 'slide':
            return (
                typeof value.showTitle === 'boolean' &&
                isSlideTransition(value.transition)
            );
        case 'poll':
            return isPollMeta(value);
        case 'heading':
            return value.level === 1 || value.level === 2 || value.level === 3;
        case 'list_item':
            return value.kind === 'ordered' || value.kind === 'unordered';
        case 'todo':
            return typeof value.checked === 'boolean';
        case 'code':
            return (
                typeof value.language === 'string' &&
                (value.preview === undefined ||
                    ((value.preview === 'mermaid' || value.preview === 'vega-lite') &&
                        codePreviewKindForLanguage(value.language) === value.preview))
            );
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
