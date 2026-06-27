import type {HLC, Lamport} from 'umkehr/block-crdt/types';
import type {BlockStyle} from 'umkehr/block-crdt/types';
import type {Block} from 'umkehr/block-crdt/types';

export type ImagePresentationSize = 'small' | 'medium' | 'large' | 'original';

export type PreviewMetadata = {
    title?: string;
    description?: string;
    siteName?: string;
    imageUrl?: string;
    resolvedUrl?: string;
    fetchedAt?: string;
};

export type CodePreviewKind = 'mermaid' | 'vega-lite';

export type SlideTransition = 'none' | 'fade' | 'slide';

export type SlideDeckFooterMode =
    | 'none'
    | 'deck-title'
    | 'slide-number'
    | 'deck-title-and-slide-number';

export type PollChoiceMode = 'single' | 'multiple';

export type PollDisplayMode = 'inline' | 'list';

export type PollRatingPresentation = 'numbers' | 'stars';

export type PollKind = 'rating' | 'children' | 'matrix' | 'long';

export type ColumnsDisplayMode = 'cards' | 'blocks';

export type PollVote =
    | {type: 'single'; optionId: string; ts: HLC; deleted?: boolean}
    | {type: 'multiple'; optionIds: string[]; ts: HLC; deleted?: boolean}
    | {type: 'matrix'; answers: Record<string, string | string[]>; ts: HLC; deleted?: boolean}
    | {type: 'long'; text: string; ts: HLC; deleted?: boolean};

export type PollMeta = {
    type: 'poll';
    kind: PollKind;
    allowChange: boolean;
    choiceMode?: PollChoiceMode;
    displayMode?: PollDisplayMode;
    ratingPresentation?: PollRatingPresentation;
    max?: number;
    votes: Record<string, PollVote>;
    ts: HLC;
};

export type SlideDeckMeta = {
    type: 'slide_deck';
    width: number;
    height: number;
    footer: SlideDeckFooterMode;
    ts: HLC;
};

export type SlideMeta = {
    type: 'slide';
    showTitle: boolean;
    transition: SlideTransition;
    ts: HLC;
};

export const CODE_PREVIEW_LANGUAGES: Record<CodePreviewKind, string> = {
    mermaid: 'mermaid',
    'vega-lite': 'vega-lite',
};

export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
    | {type: 'todo'; checked: boolean; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'code'; language: string; preview?: CodePreviewKind; ts: HLC}
    | {type: 'callout'; kind: 'info' | 'warning' | 'error'; ts: HLC}
    | {type: 'recipe_ingredient'; ts: HLC}
    | {type: 'table'; ts: HLC}
    | {type: 'columns'; display: ColumnsDisplayMode; ts: HLC}
    | SlideDeckMeta
    | SlideMeta
    | PollMeta
    | {type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC}
    | {type: 'preview'; url: string; preview: PreviewMetadata | null; ts: HLC};

export type RichBlockType = RichBlockMeta['type'];
export type RichBlockStyleAttribute = 'background-color' | 'color' | 'font-size' | 'padding';
export type RichBlockStyleSize = 'xsmall' | 'small' | 'normal' | 'large' | 'xlarge';
export type RichBlockDocumentStyle = Partial<Record<RichBlockStyleAttribute, string | null>>;

const RICH_BLOCK_STYLE_SIZE_VALUES = new Set<RichBlockStyleSize>([
    'xsmall',
    'small',
    'normal',
    'large',
    'xlarge',
]);

export const paragraphMeta = (ts: HLC): RichBlockMeta => ({type: 'paragraph', ts});

export const normalizeRichBlockStyleValue = (
    attribute: RichBlockStyleAttribute,
    value: unknown,
): string | null | undefined => {
    if (value === null) return null;
    if (attribute === 'background-color' || attribute === 'color') {
        return typeof value === 'string' ? value : undefined;
    }
    if (attribute === 'font-size' || attribute === 'padding') {
        return typeof value === 'string' && RICH_BLOCK_STYLE_SIZE_VALUES.has(value as RichBlockStyleSize)
            ? value
            : undefined;
    }
    return undefined;
};

export const richBlockStyleValue = (
    style: BlockStyle | undefined,
    attribute: RichBlockStyleAttribute,
): string | null => {
    const entry = style?.[attribute];
    const normalized = normalizeRichBlockStyleValue(attribute, entry?.value);
    return normalized === undefined ? null : normalized;
};

export const documentStyleFromBlockStyle = (style: BlockStyle): RichBlockDocumentStyle => {
    const result: RichBlockDocumentStyle = {};
    for (const attribute of ['background-color', 'color', 'font-size', 'padding'] as const) {
        const value = normalizeRichBlockStyleValue(attribute, style[attribute]?.value);
        if (value !== undefined && value !== null) result[attribute] = value;
    }
    return result;
};

export const blockStyleHasDocumentValues = (style: RichBlockDocumentStyle): boolean =>
    Object.values(style).some((value) => value !== undefined && value !== null);

export const sameTypeWithTs = (meta: RichBlockMeta, ts: HLC): RichBlockMeta => {
    switch (meta.type) {
        case 'paragraph':
            return paragraphMeta(ts);
        case 'heading':
            return {type: 'heading', level: meta.level, ts};
        case 'list_item':
            return {type: 'list_item', kind: meta.kind, ts};
        case 'todo':
            return {type: 'todo', checked: meta.checked, ts};
        case 'blockquote':
            return {type: 'blockquote', ts};
        case 'code':
            return {...meta, ts};
        case 'callout':
            return {type: 'callout', kind: meta.kind, ts};
        case 'recipe_ingredient':
            return {type: 'recipe_ingredient', ts};
        case 'table':
            return {type: 'table', ts};
        case 'columns':
            return {type: 'columns', display: meta.display, ts};
        case 'slide_deck':
            return {...meta, ts};
        case 'slide':
            return {...meta, ts};
        case 'poll':
            return {...meta, ts};
        case 'image':
            return {type: 'image', attachmentId: meta.attachmentId, size: meta.size, ts};
        case 'preview':
            return {type: 'preview', url: meta.url, preview: meta.preview, ts};
    }
};

export const defaultRatingPollMeta = (ts: HLC): PollMeta => ({
    type: 'poll',
    kind: 'rating',
    allowChange: true,
    max: 5,
    votes: {},
    ts,
});

export const defaultSlideDeckMeta = (ts: HLC): SlideDeckMeta => ({
    type: 'slide_deck',
    width: 1920,
    height: 1080,
    footer: 'slide-number',
    ts,
});

export const defaultSlideMeta = (ts: HLC): SlideMeta => ({
    type: 'slide',
    showTitle: true,
    transition: 'none',
    ts,
});

export const isTableBlock = (meta: RichBlockMeta): boolean => meta.type === 'table';

export const isColumnsBlock = (meta: RichBlockMeta): boolean => meta.type === 'columns';

export const columnsMeta = (display: ColumnsDisplayMode, ts: HLC): RichBlockMeta => ({
    type: 'columns',
    display,
    ts,
});

export const isSlideDeckBlock = (meta: RichBlockMeta): meta is SlideDeckMeta =>
    meta.type === 'slide_deck';

export const isSlideBlock = (meta: RichBlockMeta): meta is SlideMeta => meta.type === 'slide';

export const isSlideTransition = (value: unknown): value is SlideTransition =>
    value === 'none' || value === 'fade' || value === 'slide';

export const isSlideDeckFooterMode = (value: unknown): value is SlideDeckFooterMode =>
    value === 'none' ||
    value === 'deck-title' ||
    value === 'slide-number' ||
    value === 'deck-title-and-slide-number';

export const MIN_SLIDE_DECK_ASPECT_RATIO = 1 / 4;
export const MAX_SLIDE_DECK_ASPECT_RATIO = 4;

export const slideDeckAspectRatioIsValid = (width: number, height: number): boolean => {
    const ratio = width / height;
    return ratio >= MIN_SLIDE_DECK_ASPECT_RATIO && ratio <= MAX_SLIDE_DECK_ASPECT_RATIO;
};

export const normalizeSlideDeckSize = (
    width: number,
    height: number,
): {width: number; height: number} => {
    const normalizedHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
    const roundedWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
    const minWidth = Math.max(1, Math.ceil(normalizedHeight * MIN_SLIDE_DECK_ASPECT_RATIO));
    const maxWidth = Math.max(minWidth, Math.floor(normalizedHeight * MAX_SLIDE_DECK_ASPECT_RATIO));
    return {
        width: Math.min(maxWidth, Math.max(minWidth, roundedWidth)),
        height: normalizedHeight,
    };
};

export const normalizeSlideHexColor = (value: string): string | null => {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        return trimmed.toLowerCase();
    }
    return null;
};

export const isSlideHexColor = (value: unknown): value is string =>
    typeof value === 'string' && normalizeSlideHexColor(value) !== null;

export const isCellBlock = (meta: RichBlockMeta): boolean => !isTableBlock(meta);

export const isEditableBlock = (_meta: RichBlockMeta): boolean => true;

export const codePreviewKindForLanguage = (language: string): CodePreviewKind | null => {
    const normalized = language.trim().toLowerCase();
    if (normalized === 'mermaid') return 'mermaid';
    if (normalized === 'vega-lite' || normalized === 'vegalite') return 'vega-lite';
    return null;
};

export const isPreviewableCodeMeta = (
    meta: RichBlockMeta,
): meta is Extract<RichBlockMeta, {type: 'code'}> & {preview: CodePreviewKind} =>
    meta.type === 'code' && !!meta.preview && codePreviewKindForLanguage(meta.language) === meta.preview;

export const codeMetaWithPreviewForLanguage = (
    meta: Extract<RichBlockMeta, {type: 'code'}>,
    enabled: boolean,
): Extract<RichBlockMeta, {type: 'code'}> => {
    const preview = codePreviewKindForLanguage(meta.language);
    if (!enabled || !preview) {
        const {preview: _preview, ...rest} = meta;
        return rest;
    }
    return {...meta, language: CODE_PREVIEW_LANGUAGES[preview], preview};
};

export const isWholeSubtreeStyledBlock = (meta: RichBlockMeta): boolean =>
    meta.type === 'blockquote' || meta.type === 'callout';

export const tableVirtualParentsForBlock = (_block: Block<RichBlockMeta>): Lamport[] => [];
