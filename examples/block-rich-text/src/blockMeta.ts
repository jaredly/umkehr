import type {HLC, Lamport} from 'umkehr/block-crdt/types';
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
    backgroundColor: string;
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
    | {type: 'kanban'; ts: HLC}
    | SlideDeckMeta
    | SlideMeta
    | PollMeta
    | {type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC}
    | {type: 'preview'; url: string; preview: PreviewMetadata | null; ts: HLC};

export type RichBlockType = RichBlockMeta['type'];

export const paragraphMeta = (ts: HLC): RichBlockMeta => ({type: 'paragraph', ts});

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
        case 'kanban':
            return {type: 'kanban', ts};
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
    backgroundColor: '#ffffff',
    transition: 'none',
    ts,
});

export const isTableBlock = (meta: RichBlockMeta): boolean => meta.type === 'table';

export const isKanbanBlock = (meta: RichBlockMeta): boolean => meta.type === 'kanban';

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
