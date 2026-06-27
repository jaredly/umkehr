import {
    applyMany,
    blockContents,
    cachedState,
    formattedMarkValues,
    graphemeLength,
    insertBlockOps,
    insertTextOps,
    markRangeOp,
    materializeFormattedBlocks,
    segmentGraphemes,
    setBlockStyleOps,
    visibleRangesForMark,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import type {CachedState, JsonValue, Lamport, Op, State} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    ANNOTATION_MARK,
    annotationVirtualParents,
    isActiveAnnotationData,
    type AnnotationPresentation,
} from './annotations';
import {
    CODE_PREVIEW_LANGUAGES,
    codePreviewKindForLanguage,
    defaultSlideDeckMeta,
    defaultSlideMeta,
    isSlideDeckFooterMode,
    isSlideTransition,
    slideDeckAspectRatioIsValid,
    blockStyleHasDocumentValues,
    documentStyleFromBlockStyle,
    normalizeRichBlockStyleValue,
    type ColumnsDisplayMode,
    type CodePreviewKind,
    type ImagePresentationSize,
    type PollKind,
    type PollChoiceMode,
    type PollDisplayMode,
    type PollRatingPresentation,
    type PollVote,
    type PreviewMetadata,
    type RichBlockMeta,
    type RichBlockDocumentStyle,
    type RichBlockStyleAttribute,
    type SlideDeckFooterMode,
    type SlideTransition,
} from './blockMeta';
import {isPollVote} from './pollBlocks';
import type {CommandContext} from './blockCommands';
import {
    CODE_MARK,
    MATH_MARK,
    isCodeMarkValue,
    mathDisplayModeFromMarkValue,
    mathMarkValueForMode,
    LINK_MARK,
    normalizeStoredCodeLanguage,
} from './inlineMarks';
import {applyCharInsertOps} from './localTextOps';

export type DocumentBlockType = RichBlockMeta['type'];

export type DocumentBlock = {
    type?: DocumentBlockType;
    meta?: DocumentBlockMeta;
    style?: RichBlockDocumentStyle;
    content?: string;
    marks?: DocumentMark[];
    annotations?: DocumentAnnotation[];
    children?: DocumentBlock[];
};

export type ImportDocument = DocumentBlock[];
export type ExportDocument = DocumentBlock[];

export type DocumentBlockMeta = {
    level?: 1 | 2 | 3;
    kind?: 'ordered' | 'unordered' | 'info' | 'warning' | 'error' | PollKind;
    checked?: boolean;
    language?: string;
    preview?: CodePreviewKind | PreviewMetadata | null;
    attachmentId?: string;
    size?: ImagePresentationSize;
    url?: string;
    allowChange?: boolean;
    choiceMode?: PollChoiceMode;
    displayMode?: PollDisplayMode;
    ratingPresentation?: PollRatingPresentation;
    max?: number;
    votes?: Record<string, PollVote>;
    width?: number;
    height?: number;
    footer?: SlideDeckFooterMode;
    showTitle?: boolean;
    backgroundColor?: string;
    transition?: SlideTransition;
    display?: ColumnsDisplayMode;
};

export type DocumentMark =
    | {type: 'bold' | 'italic' | 'strikethrough'; start: number; end: number}
    | {type: 'code'; start: number; end: number; language?: string}
    | {type: 'math'; start: number; end: number; display?: boolean}
    | {type: 'link'; start: number; end: number; href: string};

export type DocumentAnnotation = {
    type: 'annotation';
    presentation: AnnotationPresentation;
    start: number;
    end: number;
    resolved?: boolean;
    body?: DocumentBlock[];
};

export type ImportDocumentResult = {
    state: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    blockIds: string[];
};

type ParsedDocumentBlock = {
    type: DocumentBlockType;
    meta: DocumentBlockMeta;
    style: RichBlockDocumentStyle;
    content: string;
    marks: DocumentMark[];
    annotations: ParsedDocumentAnnotation[];
    children: ParsedDocumentBlock[];
};

type ParsedDocumentAnnotation = Omit<DocumentAnnotation, 'body'> & {
    body: ParsedDocumentBlock[];
};

const ROOT: [number, string] = [0, 'root'];
const ROOT_ID = lamportToString(ROOT);
const BLOCK_TYPES = new Set<DocumentBlockType>([
    'paragraph',
    'heading',
    'list_item',
    'todo',
    'blockquote',
    'code',
    'callout',
    'recipe_ingredient',
    'table',
    'columns',
    'slide_deck',
    'slide',
    'poll',
    'image',
    'preview',
]);
const IMAGE_SIZES = new Set<ImagePresentationSize>(['small', 'medium', 'large', 'original']);
const BOOLEAN_MARK_TYPES = new Set(['bold', 'italic', 'strikethrough']);

export class DocumentFormatError extends Error {
    constructor(path: string, message: string) {
        super(`${path}: ${message}`);
        this.name = 'DocumentFormatError';
    }
}

export const importDocument = (document: unknown, context: CommandContext): ImportDocumentResult => {
    const parsed = parseDocument(document);
    let working = emptyDocumentState();
    const ops: Array<Op<RichBlockMeta>> = [];
    const blockIds: string[] = [];

    const insertChildren = (children: ParsedDocumentBlock[], parent: Lamport): string[] => {
        const insertedIds: string[] = [];
        let previousSiblingId: string | null = null;
        for (const child of children) {
            const blockOps = insertBlockOps(working, {
                actor: context.actor,
                parent,
                before: previousSiblingId ? working.state.blocks[previousSiblingId].id : null,
                after: null,
                meta: richMetaForDocumentBlock(child, context.nextTs()),
                ts: context.nextTs(),
                virtualParents: annotationVirtualParents(working),
            });
            working = applyOps(working, blockOps);
            ops.push(...blockOps);
            const inserted = insertedBlockId(blockOps);
            previousSiblingId = inserted;
            insertedIds.push(inserted);

            const styleOps = styleOpsForDocumentBlock(working, inserted, child.style, context);
            if (styleOps.length) {
                working = applyOps(working, styleOps);
                ops.push(...styleOps);
            }

            if (child.content) {
                const textOps = insertTextOps(working, {
                    actor: context.actor,
                    block: working.state.blocks[inserted].id,
                    offset: 0,
                    text: child.content,
                    ts: context.nextTs,
                });
                working = applyCharInsertOps(working, textOps) ?? applyOps(working, textOps);
                ops.push(...textOps);
            }

            for (const mark of child.marks) {
                const markOp = markOpForDocumentMark(working, inserted, mark, context);
                working = applyOps(working, [markOp]);
                ops.push(markOp);
            }

            for (const annotation of child.annotations) {
                const markId = [working.state.maxSeenCount + 1, context.actor] as Lamport;
                const markOp = markRangeOp(
                    working,
                    working.state.blocks[inserted].id,
                    annotation.start,
                    annotation.end,
                    ANNOTATION_MARK,
                    {
                        id: markId,
                        presentation: annotation.presentation,
                        ...(annotation.resolved ? {resolved: true} : {}),
                    } satisfies JsonValue,
                    false,
                    markId,
                );
                working = applyOps(working, [markOp]);
                ops.push(markOp);
                insertChildren(annotation.body.length ? annotation.body : [emptyAnnotationBody()], markId);
            }

            insertChildren(child.children, working.state.blocks[inserted].id);
        }
        return insertedIds;
    };

    blockIds.push(...insertChildren(parsed, ROOT));
    return {state: working, ops, blockIds};
};

export const exportDocument = (state: CachedState<RichBlockMeta>): ExportDocument =>
    visibleBlockChildren(state, ROOT_ID).map((blockId) =>
        exportBlock(state, blockId),
    );

const parseDocument = (value: unknown): ParsedDocumentBlock[] => {
    if (!Array.isArray(value)) {
        throw new DocumentFormatError('$', 'document must be an array');
    }
    return value.map((block, index) => parseBlock(block, `$[${index}]`));
};

const parseBlock = (value: unknown, path: string): ParsedDocumentBlock => {
    if (!isRecord(value)) {
        throw new DocumentFormatError(path, 'block must be an object');
    }
    const rawType = value.type ?? 'paragraph';
    if (typeof rawType !== 'string' || !BLOCK_TYPES.has(rawType as DocumentBlockType)) {
        throw new DocumentFormatError(`${path}.type`, 'must be a known block type');
    }
    const type = rawType as DocumentBlockType;
    const meta = parseMeta(type, value.meta, `${path}.meta`);
    const style = parseStyle(value.style, `${path}.style`);
    if (type === 'slide' && meta.backgroundColor !== undefined && style['background-color'] === undefined) {
        style['background-color'] = meta.backgroundColor;
    }
    const content = value.content ?? '';
    if (typeof content !== 'string') {
        throw new DocumentFormatError(`${path}.content`, 'must be a string');
    }
    const marks = parseMarks(value.marks, content, `${path}.marks`);
    const annotations = parseAnnotations(value.annotations, content, `${path}.annotations`);
    const children = parseChildren(value.children, `${path}.children`);
    return {type, meta, style, content, marks, annotations, children};
};

const STYLE_ATTRIBUTES = new Set<RichBlockStyleAttribute>(['background-color', 'color', 'font-size', 'padding']);

const parseStyle = (value: unknown, path: string): RichBlockDocumentStyle => {
    if (value === undefined) return {};
    if (!isRecord(value)) {
        throw new DocumentFormatError(path, 'must be an object');
    }
    const style: RichBlockDocumentStyle = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!STYLE_ATTRIBUTES.has(key as RichBlockStyleAttribute)) {
            throw new DocumentFormatError(`${path}.${key}`, 'must be a supported block style attribute');
        }
        const attribute = key as RichBlockStyleAttribute;
        const normalized = normalizeRichBlockStyleValue(attribute, raw);
        if (normalized === undefined) {
            throw new DocumentFormatError(`${path}.${key}`, 'must be a valid block style value');
        }
        style[attribute] = normalized;
    }
    return style;
};

const parseChildren = (value: unknown, path: string): ParsedDocumentBlock[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new DocumentFormatError(path, 'must be an array');
    }
    return value.map((child, index) => parseBlock(child, `${path}[${index}]`));
};

const parseMarks = (value: unknown, content: string, path: string): DocumentMark[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new DocumentFormatError(path, 'must be an array');
    }
    const contentLength = graphemeLength(content);
    return value.map((mark, index) => parseMark(mark, contentLength, `${path}[${index}]`));
};

const parseAnnotations = (value: unknown, content: string, path: string): ParsedDocumentAnnotation[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new DocumentFormatError(path, 'must be an array');
    }
    const contentLength = graphemeLength(content);
    return value.map((annotation, index) =>
        parseAnnotation(annotation, contentLength, `${path}[${index}]`),
    );
};

const parseAnnotation = (value: unknown, contentLength: number, path: string): ParsedDocumentAnnotation => {
    if (!isRecord(value)) {
        throw new DocumentFormatError(path, 'annotation must be an object');
    }
    if (value.type !== 'annotation') {
        throw new DocumentFormatError(`${path}.type`, 'must be "annotation"');
    }
    if (!isAnnotationPresentation(value.presentation)) {
        throw new DocumentFormatError(`${path}.presentation`, 'must be "sidebar", "footnote", or "popover"');
    }
    const start = value.start;
    const end = value.end;
    if (!Number.isInteger(start)) {
        throw new DocumentFormatError(`${path}.start`, 'must be an integer grapheme offset');
    }
    if (!Number.isInteger(end)) {
        throw new DocumentFormatError(`${path}.end`, 'must be an integer grapheme offset');
    }
    if ((start as number) < 0 || (end as number) <= (start as number) || (end as number) > contentLength) {
        throw new DocumentFormatError(path, `annotation range must satisfy 0 <= start < end <= ${contentLength}`);
    }
    if (value.resolved !== undefined && typeof value.resolved !== 'boolean') {
        throw new DocumentFormatError(`${path}.resolved`, 'must be a boolean');
    }
    const body = parseChildren(value.body, `${path}.body`);
    return {
        type: 'annotation',
        presentation: value.presentation,
        start: start as number,
        end: end as number,
        ...(value.resolved ? {resolved: true} : {}),
        body,
    };
};

const parseMark = (value: unknown, contentLength: number, path: string): DocumentMark => {
    if (!isRecord(value)) {
        throw new DocumentFormatError(path, 'mark must be an object');
    }
    if (typeof value.type !== 'string') {
        throw new DocumentFormatError(`${path}.type`, 'must be a string');
    }
    const start = value.start;
    const end = value.end;
    if (!Number.isInteger(start)) {
        throw new DocumentFormatError(`${path}.start`, 'must be an integer grapheme offset');
    }
    if (!Number.isInteger(end)) {
        throw new DocumentFormatError(`${path}.end`, 'must be an integer grapheme offset');
    }
    if ((start as number) < 0 || (end as number) <= (start as number) || (end as number) > contentLength) {
        throw new DocumentFormatError(path, `mark range must satisfy 0 <= start < end <= ${contentLength}`);
    }
    if (BOOLEAN_MARK_TYPES.has(value.type)) {
        return {type: value.type as 'bold' | 'italic' | 'strikethrough', start: start as number, end: end as number};
    }
    if (value.type === 'code') {
        if (value.language !== undefined && typeof value.language !== 'string') {
            throw new DocumentFormatError(`${path}.language`, 'must be a string');
        }
        const language = typeof value.language === 'string' ? normalizeStoredCodeLanguage(value.language) : '';
        return {
            type: 'code',
            start: start as number,
            end: end as number,
            ...(language ? {language} : {}),
        };
    }
    if (value.type === 'link') {
        if (typeof value.href !== 'string' || value.href.length === 0) {
            throw new DocumentFormatError(`${path}.href`, 'must be a non-empty string');
        }
        return {type: 'link', start: start as number, end: end as number, href: value.href};
    }
    if (value.type === 'math') {
        if (value.display !== undefined && typeof value.display !== 'boolean') {
            throw new DocumentFormatError(`${path}.display`, 'must be a boolean');
        }
        return {
            type: 'math',
            start: start as number,
            end: end as number,
            ...(value.display ? {display: true} : {}),
        };
    }
    throw new DocumentFormatError(`${path}.type`, 'must be a supported mark type');
};

const parseMeta = (type: DocumentBlockType, value: unknown, path: string): DocumentBlockMeta => {
    const meta = value === undefined ? {} : value;
    if (!isRecord(meta)) {
        throw new DocumentFormatError(path, 'must be an object');
    }
    switch (type) {
        case 'paragraph':
        case 'blockquote':
        case 'recipe_ingredient':
        case 'table':
            return {};
        case 'columns': {
            const display = meta.display ?? 'blocks';
            if (display !== 'blocks' && display !== 'cards') {
                throw new DocumentFormatError(`${path}.display`, 'must be "blocks" or "cards"');
            }
            return display === 'blocks' ? {} : {display};
        }
        case 'slide_deck': {
            const width = meta.width ?? 1920;
            if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
                throw new DocumentFormatError(`${path}.width`, 'must be a positive integer');
            }
            const height = meta.height ?? 1080;
            if (typeof height !== 'number' || !Number.isInteger(height) || height <= 0) {
                throw new DocumentFormatError(`${path}.height`, 'must be a positive integer');
            }
            if (!slideDeckAspectRatioIsValid(width, height)) {
                throw new DocumentFormatError(`${path}`, 'slide deck aspect ratio must be between 1:4 and 4:1');
            }
            const footer = meta.footer ?? 'slide-number';
            if (!isSlideDeckFooterMode(footer)) {
                throw new DocumentFormatError(`${path}.footer`, 'must be a supported slide deck footer mode');
            }
            return {width, height, footer};
        }
        case 'slide': {
            const showTitle = meta.showTitle ?? true;
            if (typeof showTitle !== 'boolean') {
                throw new DocumentFormatError(`${path}.showTitle`, 'must be a boolean');
            }
            const backgroundColor = meta.backgroundColor;
            if (backgroundColor !== undefined && typeof backgroundColor !== 'string') {
                throw new DocumentFormatError(`${path}.backgroundColor`, 'must be a string');
            }
            const transition = meta.transition ?? 'none';
            if (!isSlideTransition(transition)) {
                throw new DocumentFormatError(`${path}.transition`, 'must be a supported slide transition');
            }
            return {showTitle, ...(backgroundColor === undefined ? {} : {backgroundColor}), transition};
        }
        case 'poll': {
            const kind = meta.kind ?? 'rating';
            if (kind !== 'rating' && kind !== 'children' && kind !== 'matrix' && kind !== 'long') {
                throw new DocumentFormatError(`${path}.kind`, 'must be a supported poll kind');
            }
            const allowChange = meta.allowChange ?? true;
            if (typeof allowChange !== 'boolean') {
                throw new DocumentFormatError(`${path}.allowChange`, 'must be a boolean');
            }
            const choiceMode = meta.choiceMode ?? (kind === 'long' ? undefined : 'single');
            if (choiceMode !== undefined && choiceMode !== 'single' && choiceMode !== 'multiple') {
                throw new DocumentFormatError(`${path}.choiceMode`, 'must be "single" or "multiple"');
            }
            const displayMode = meta.displayMode;
            if (displayMode !== undefined && displayMode !== 'inline' && displayMode !== 'list') {
                throw new DocumentFormatError(`${path}.displayMode`, 'must be "inline" or "list"');
            }
            const ratingPresentation = meta.ratingPresentation;
            if (
                ratingPresentation !== undefined &&
                ratingPresentation !== 'numbers' &&
                ratingPresentation !== 'stars'
            ) {
                throw new DocumentFormatError(`${path}.ratingPresentation`, 'must be "numbers" or "stars"');
            }
            const rawMax = meta.max ?? (kind === 'rating' ? 5 : undefined);
            const max = typeof rawMax === 'number' ? rawMax : undefined;
            if (rawMax !== undefined && typeof rawMax !== 'number') {
                throw new DocumentFormatError(`${path}.max`, 'must be an integer');
            }
            if (max !== undefined && !Number.isInteger(max)) {
                throw new DocumentFormatError(`${path}.max`, 'must be an integer');
            }
            const votes = meta.votes ?? {};
            if (!isRecord(votes) || !Object.values(votes).every(isPollVote)) {
                throw new DocumentFormatError(`${path}.votes`, 'must be a poll vote record');
            }
            return {
                kind,
                allowChange,
                ...(choiceMode ? {choiceMode} : {}),
                ...(displayMode ? {displayMode} : {}),
                ...(ratingPresentation ? {ratingPresentation} : {}),
                ...(max !== undefined ? {max} : {}),
                votes: votes as Record<string, PollVote>,
            };
        }
        case 'heading': {
            const level = meta.level ?? 1;
            if (level !== 1 && level !== 2 && level !== 3) {
                throw new DocumentFormatError(`${path}.level`, 'must be 1, 2, or 3');
            }
            return {level};
        }
        case 'list_item': {
            const kind = meta.kind ?? 'unordered';
            if (kind !== 'ordered' && kind !== 'unordered') {
                throw new DocumentFormatError(`${path}.kind`, 'must be "ordered" or "unordered"');
            }
            return {kind};
        }
        case 'todo': {
            const checked = meta.checked ?? false;
            if (typeof checked !== 'boolean') {
                throw new DocumentFormatError(`${path}.checked`, 'must be a boolean');
            }
            return {checked};
        }
        case 'code': {
            const language = meta.language ?? '';
            if (typeof language !== 'string') {
                throw new DocumentFormatError(`${path}.language`, 'must be a string');
            }
            if (meta.preview !== undefined) {
                const preview = meta.preview;
                if (preview !== 'mermaid' && preview !== 'vega-lite') {
                    throw new DocumentFormatError(`${path}.preview`, 'must be a supported code preview');
                }
                if (codePreviewKindForLanguage(language) !== preview) {
                    throw new DocumentFormatError(`${path}.preview`, 'must match the code language');
                }
                return {language: CODE_PREVIEW_LANGUAGES[preview], preview};
            }
            return {language: normalizeStoredCodeLanguage(language)};
        }
        case 'callout': {
            const kind = meta.kind ?? 'info';
            if (kind !== 'info' && kind !== 'warning' && kind !== 'error') {
                throw new DocumentFormatError(`${path}.kind`, 'must be "info", "warning", or "error"');
            }
            return {kind};
        }
        case 'image': {
            if (typeof meta.attachmentId !== 'string' || meta.attachmentId.length === 0) {
                throw new DocumentFormatError(`${path}.attachmentId`, 'must be a non-empty string');
            }
            const size = meta.size ?? 'medium';
            if (typeof size !== 'string' || !IMAGE_SIZES.has(size as ImagePresentationSize)) {
                throw new DocumentFormatError(`${path}.size`, 'must be a valid image size');
            }
            return {attachmentId: meta.attachmentId, size: size as ImagePresentationSize};
        }
        case 'preview': {
            if (typeof meta.url !== 'string' || meta.url.length === 0) {
                throw new DocumentFormatError(`${path}.url`, 'must be a non-empty string');
            }
            if (meta.preview !== undefined && meta.preview !== null && !isPreviewMetadata(meta.preview)) {
                throw new DocumentFormatError(`${path}.preview`, 'must be null or preview metadata');
            }
            return {url: meta.url, preview: (meta.preview ?? null) as PreviewMetadata | null};
        }
    }
};

const richMetaForDocumentBlock = (block: ParsedDocumentBlock, ts: string): RichBlockMeta => {
    switch (block.type) {
        case 'paragraph':
            return {type: 'paragraph', ts};
        case 'heading':
            return {type: 'heading', level: block.meta.level ?? 1, ts};
        case 'list_item':
            return {type: 'list_item', kind: (block.meta.kind as 'ordered' | 'unordered') ?? 'unordered', ts};
        case 'todo':
            return {type: 'todo', checked: block.meta.checked ?? false, ts};
        case 'blockquote':
            return {type: 'blockquote', ts};
        case 'code':
            return {
                type: 'code',
                language: block.meta.language ?? '',
                ...(typeof block.meta.preview === 'string' ? {preview: block.meta.preview as CodePreviewKind} : {}),
                ts,
            };
        case 'callout':
            return {type: 'callout', kind: (block.meta.kind as 'info' | 'warning' | 'error') ?? 'info', ts};
        case 'recipe_ingredient':
            return {type: 'recipe_ingredient', ts};
        case 'table':
            return {type: 'table', ts};
        case 'columns':
            return {type: 'columns', display: block.meta.display ?? 'blocks', ts};
        case 'slide_deck':
            return {
                ...defaultSlideDeckMeta(ts),
                width: block.meta.width ?? 1920,
                height: block.meta.height ?? 1080,
                footer: block.meta.footer ?? 'slide-number',
            };
        case 'slide':
            return {
                ...defaultSlideMeta(ts),
                showTitle: block.meta.showTitle ?? true,
                transition: block.meta.transition ?? 'none',
            };
        case 'poll':
            return {
                type: 'poll',
                kind: (block.meta.kind as PollKind | undefined) ?? 'rating',
                allowChange: block.meta.allowChange ?? true,
                ...(block.meta.choiceMode ? {choiceMode: block.meta.choiceMode as PollChoiceMode} : {}),
                ...(block.meta.displayMode ? {displayMode: block.meta.displayMode as PollDisplayMode} : {}),
                ...(block.meta.ratingPresentation
                    ? {ratingPresentation: block.meta.ratingPresentation as PollRatingPresentation}
                    : {}),
                ...(block.meta.max !== undefined ? {max: block.meta.max} : {}),
                votes: block.meta.votes ?? {},
                ts,
            };
        case 'image':
            return {
                type: 'image',
                attachmentId: block.meta.attachmentId ?? '',
                size: block.meta.size ?? 'medium',
                ts,
            };
        case 'preview':
            return {
                type: 'preview',
                url: block.meta.url ?? '',
                preview: typeof block.meta.preview === 'string' ? null : block.meta.preview ?? null,
                ts,
            };
    }
};

const styleOpsForDocumentBlock = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    style: RichBlockDocumentStyle,
    context: CommandContext,
): Array<Op<RichBlockMeta>> => {
    const entries = Object.entries(style).filter((entry): entry is [RichBlockStyleAttribute, string | null] => (
        entry[1] !== undefined
    ));
    if (!entries.length) return [];
    return setBlockStyleOps(state, {
        block: state.state.blocks[blockId].id,
        style: Object.fromEntries(
            entries.map(([attribute, value]) => [attribute, {value, ts: context.nextTs()}]),
        ),
    });
};

const markOpForDocumentMark = (
    state: CachedState<RichBlockMeta>,
    blockId: string,
    mark: DocumentMark,
    context: CommandContext,
): Op<RichBlockMeta> => {
    const id = [state.state.maxSeenCount + 1, context.actor] as [number, string];
    if (mark.type === 'link') {
        return markRangeOp(state, state.state.blocks[blockId].id, mark.start, mark.end, LINK_MARK, mark.href, false, id);
    }
    if (mark.type === 'code') {
        return markRangeOp(
            state,
            state.state.blocks[blockId].id,
            mark.start,
            mark.end,
            CODE_MARK,
            mark.language || undefined,
            false,
            id,
        );
    }
    if (mark.type === 'math') {
        return markRangeOp(
            state,
            state.state.blocks[blockId].id,
            mark.start,
            mark.end,
            MATH_MARK,
            mathMarkValueForMode(mark.display ? 'display' : 'inline'),
            false,
            id,
        );
    }
    return markRangeOp(state, state.state.blocks[blockId].id, mark.start, mark.end, mark.type, undefined, false, id);
};

const exportBlock = (state: CachedState<RichBlockMeta>, blockId: string): DocumentBlock => {
    const block = state.state.blocks[blockId];
    const result = documentBlockForMeta(block.meta);
    const style = documentStyleFromBlockStyle(block.style);
    if (blockStyleHasDocumentValues(style)) result.style = style;
    const content = blockContents(state, blockId);
    if (content) result.content = content;
    const marks = marksForBlock(state, blockId);
    if (marks.length) result.marks = marks;
    const annotations = annotationsForBlock(state, blockId);
    if (annotations.length) result.annotations = annotations;
    const children = visibleBlockChildren(state, blockId).map((childId) =>
        exportBlock(state, childId),
    );
    if (children.length) result.children = children;
    return result;
};

const emptyAnnotationBody = (): ParsedDocumentBlock => ({
    type: 'paragraph',
    meta: {},
    style: {},
    content: '',
    marks: [],
    annotations: [],
    children: [],
});

const documentBlockForMeta = (meta: RichBlockMeta): DocumentBlock => {
    switch (meta.type) {
        case 'paragraph':
            return {type: 'paragraph'};
        case 'heading':
            return {type: 'heading', meta: {level: meta.level}};
        case 'list_item':
            return {type: 'list_item', meta: {kind: meta.kind}};
        case 'todo':
            return {type: 'todo', meta: {checked: meta.checked}};
        case 'blockquote':
            return {type: 'blockquote'};
        case 'code':
            return {type: 'code', meta: {language: meta.language, ...(meta.preview ? {preview: meta.preview} : {})}};
        case 'callout':
            return {type: 'callout', meta: {kind: meta.kind}};
        case 'recipe_ingredient':
            return {type: 'recipe_ingredient'};
        case 'table':
            return {type: 'table'};
        case 'columns':
            return meta.display === 'blocks'
                ? {type: 'columns'}
                : {type: 'columns', meta: {display: meta.display}};
        case 'slide_deck':
            return {type: 'slide_deck', meta: {width: meta.width, height: meta.height, footer: meta.footer}};
        case 'slide':
            return {
                type: 'slide',
                meta: {
                    showTitle: meta.showTitle,
                    transition: meta.transition,
                },
            };
        case 'poll':
            return {
                type: 'poll',
                meta: {
                    kind: meta.kind,
                    allowChange: meta.allowChange,
                    ...(meta.choiceMode ? {choiceMode: meta.choiceMode} : {}),
                    ...(meta.displayMode ? {displayMode: meta.displayMode} : {}),
                    ...(meta.ratingPresentation ? {ratingPresentation: meta.ratingPresentation} : {}),
                    ...(meta.max !== undefined ? {max: meta.max} : {}),
                    votes: meta.votes,
                },
            };
        case 'image':
            return {type: 'image', meta: {attachmentId: meta.attachmentId, size: meta.size}};
        case 'preview':
            return {type: 'preview', meta: {url: meta.url, preview: meta.preview}};
    }
};

const marksForBlock = (state: CachedState<RichBlockMeta>, blockId: string): DocumentMark[] => {
    const formatted = materializeFormattedBlocks(state, annotationVirtualParents(state)).find(
        (block) => block.id === blockId,
    );
    if (!formatted) return [];
    const marks: DocumentMark[] = [];
    let offset = 0;
    for (const run of formatted.runs) {
        const length = segmentGraphemes(run.text).length;
        const start = offset;
        const end = offset + length;
        offset = end;
        if (length === 0) continue;

        for (const type of ['bold', 'italic', 'strikethrough'] as const) {
            if (formattedMarkValues(run, type).length) {
                marks.push({type, start, end});
            }
        }
        for (const value of formattedMarkValues(run, CODE_MARK)) {
            if (isCodeMarkValue(value)) {
                const language = typeof value === 'string' ? normalizeStoredCodeLanguage(value) : '';
                marks.push({type: 'code', start, end, ...(language ? {language} : {})});
            }
        }
        for (const value of formattedMarkValues(run, LINK_MARK)) {
            if (typeof value === 'string') {
                marks.push({type: 'link', start, end, href: value});
            }
        }
        for (const value of formattedMarkValues(run, MATH_MARK)) {
            const mode = mathDisplayModeFromMarkValue(value);
            if (mode) {
                marks.push({type: 'math', start, end, ...(mode === 'display' ? {display: true} : {})});
            }
        }
    }
    return mergeAdjacentMarks(marks);
};

const annotationsForBlock = (state: CachedState<RichBlockMeta>, blockId: string): DocumentAnnotation[] => {
    const annotations: DocumentAnnotation[] = [];
    const seen = new Set<string>();
    for (const mark of Object.values(state.state.marks)) {
        if (mark.type !== ANNOTATION_MARK || !isActiveAnnotationData(mark.data)) continue;
        const ranges = visibleRangesForMark(state, mark, annotationVirtualParents(state)).filter(
            (range) => range.blockId === blockId && range.startOffset < range.endOffset,
        );
        if (!ranges.length) continue;
        const annotationId = lamportToString(mark.data.id);
        for (const range of ranges) {
            const key = `${annotationId}:${range.startOffset}:${range.endOffset}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const body = visibleBlockChildren(state, annotationId, annotationVirtualParents(state)).map((childId) =>
                exportBlock(state, childId),
            );
            annotations.push({
                type: 'annotation',
                presentation: mark.data.presentation,
                start: range.startOffset,
                end: range.endOffset,
                ...(mark.data.resolved ? {resolved: true} : {}),
                ...(body.length ? {body} : {}),
            });
        }
    }
    return annotations.sort((a, b) => a.start - b.start || a.end - b.end || a.presentation.localeCompare(b.presentation));
};

const mergeAdjacentMarks = (marks: DocumentMark[]): DocumentMark[] => {
    const merged: DocumentMark[] = [];
    for (const mark of marks) {
        const previous = merged[merged.length - 1];
        if (previous && marksCanMerge(previous, mark)) {
            previous.end = mark.end;
        } else {
            merged.push({...mark});
        }
    }
    return merged;
};

const marksCanMerge = (left: DocumentMark, right: DocumentMark): boolean => {
    if (left.type !== right.type || left.end !== right.start) return false;
    if (left.type === 'link' && right.type === 'link') return left.href === right.href;
    if (left.type === 'code' && right.type === 'code') return left.language === right.language;
    if (left.type === 'math' && right.type === 'math') return left.display === right.display;
    return left.type !== 'link' && left.type !== 'code' && left.type !== 'math';
};

const insertedBlockId = (ops: Array<Op<RichBlockMeta>>): string => {
    const op = ops[0];
    if (op?.type !== 'block') {
        throw new Error('insertBlockOps did not return a block op');
    }
    return lamportToString(op.block.id);
};

const isAnnotationPresentation = (value: unknown): value is AnnotationPresentation =>
    value === 'sidebar' || value === 'footnote' || value === 'popover';

const applyOps = (
    state: CachedState<RichBlockMeta>,
    ops: Array<Op<RichBlockMeta>>,
): CachedState<RichBlockMeta> => applyMany(state, ops, annotationVirtualParents(state));

const emptyDocumentState = (): CachedState<RichBlockMeta> =>
    cachedState<RichBlockMeta>({
        chars: {},
        blocks: {},
        marks: {},
        splits: {},
        joins: {},
        maxSeenCount: 0,
    } satisfies State<RichBlockMeta>);

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
