import type {FormattedRun, FormattedMarkValue} from '../block-crdt/index.js';
import type {JsonValue} from '../block-crdt/types.js';

export const INLINE_EMBED_MARK = 'embed';
export const INLINE_EMBED_TEXT = '\uFFFC';

export type InlineEmbedData = {
    type: string;
    value: JsonValue;
};

export type InlineEmbedAmbientMarks = Record<string, FormattedMarkValue | undefined>;

export type InlineEmbedRenderContext = {
    blockId: string;
    charId: string;
    startOffset: number;
    ambientMarks: InlineEmbedAmbientMarks;
    plainText: string;
};

export type InlineEmbedPlainTextContext = {
    ambientMarks: InlineEmbedAmbientMarks;
};

export type InlineEmbedPlugin = {
    type: string;
    render(data: InlineEmbedData, context: InlineEmbedRenderContext): HTMLElement;
    plainText(data: InlineEmbedData, context: InlineEmbedPlainTextContext): string;
};

export const isInlineEmbedText = (text: string): boolean => text === INLINE_EMBED_TEXT;

export const isInlineEmbedData = (value: unknown): value is InlineEmbedData =>
    isRecord(value) &&
    typeof value.type === 'string' &&
    value.type.length > 0 &&
    isJsonValue(value.value);

export const inlineEmbedDataForRun = (run: FormattedRun): InlineEmbedData | null => {
    const value = run.marks[INLINE_EMBED_MARK];
    return isInlineEmbedData(value) ? value : null;
};

export const inlineEmbedPluginForType = (
    plugins: readonly InlineEmbedPlugin[],
    type: string,
): InlineEmbedPlugin | null => plugins.find((plugin) => plugin.type === type) ?? null;

export const plainTextForInlineEmbed = (
    data: InlineEmbedData | null,
    plugins: readonly InlineEmbedPlugin[],
    context: InlineEmbedPlainTextContext,
): string => {
    if (!data) return '[unknown embed]';
    const plugin = inlineEmbedPluginForType(plugins, data.type);
    return plugin?.plainText(data, context) || '[unknown embed]';
};

export const renderUnknownInlineEmbed = (
    data: InlineEmbedData | null,
    context: InlineEmbedRenderContext,
): HTMLElement => {
    const span = document.createElement('span');
    span.className = 'inlineEmbed inlineEmbedUnknown';
    setInlineEmbedLabel(span, '[unknown embed]');
    span.setAttribute('aria-label', data ? `Unknown ${data.type} embed` : 'Unknown embed');
    applyInlineEmbedDataset(span, data, context);
    return span;
};

export const renderInlineEmbed = (
    data: InlineEmbedData | null,
    plugins: readonly InlineEmbedPlugin[],
    context: InlineEmbedRenderContext,
): HTMLElement => {
    const plugin = data ? inlineEmbedPluginForType(plugins, data.type) : null;
    const node = plugin ? plugin.render(data!, context) : renderUnknownInlineEmbed(data, context);
    applyInlineEmbedDataset(node, data, context);
    return node;
};

export const inlineEmbedPlugins: readonly InlineEmbedPlugin[] = [
    {
        type: 'date',
        render(data, context) {
            const span = document.createElement('span');
            span.className = 'inlineEmbed inlineEmbedDate';
            const label = dateText(data.value) ?? '[invalid date]';
            setInlineEmbedLabel(span, label);
            span.setAttribute('aria-label', `Date embed: ${label}`);
            applyInlineEmbedDataset(span, data, context);
            return span;
        },
        plainText(data) {
            return dateText(data.value) ?? '[invalid date]';
        },
    },
];

const applyInlineEmbedDataset = (
    element: HTMLElement,
    data: InlineEmbedData | null,
    context: InlineEmbedRenderContext,
) => {
    element.contentEditable = 'false';
    element.dataset.inlineEmbed = 'true';
    element.dataset.embedCharId = context.charId;
    element.dataset.embedBlockId = context.blockId;
    element.dataset.embedStartOffset = String(context.startOffset);
    element.dataset.embedType = data?.type ?? 'unknown';
    if (!element.getAttribute('role')) element.setAttribute('role', 'button');
    if (!element.getAttribute('tabindex')) element.tabIndex = -1;
};

const setInlineEmbedLabel = (element: HTMLElement, label: string) => {
    element.replaceChildren();

    const visible = document.createElement('span');
    visible.dataset.offsetSentinel = 'true';
    visible.className = 'inlineEmbedLabel';
    visible.textContent = label;

    const offset = document.createElement('span');
    offset.className = 'inlineEmbedOffsetText';
    offset.textContent = INLINE_EMBED_TEXT;

    element.append(visible, offset);
};

const dateText = (value: JsonValue): string | null => {
    const raw = typeof value === 'string' ? value : isRecord(value) && typeof value.date === 'string' ? value.date : null;
    if (!raw) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;
    const [, year, month, day] = match;
    return `${month}/${day}/${year}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return Number.isFinite(value) || typeof value !== 'number';
    }
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (!isRecord(value)) return false;
    return Object.values(value).every(isJsonValue);
};
