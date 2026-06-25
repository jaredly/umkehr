import type {MathRenderMode} from './inlineMarks';

export type MathRenderResult =
    | {type: 'html'; html: string}
    | {type: 'literal'; text: string};

export type MathRenderer = {
    render(source: string, mode: MathRenderMode, options?: {fallbackKey?: string}): MathRenderResult;
};

type MathJaxGlobal = {
    startup?: {
        promise?: Promise<void>;
        adaptor?: {
            serializeXML(node: unknown): string;
        };
        typeset?: boolean;
    };
    tex2svgPromise?: (source: string, options: {display: boolean}) => Promise<unknown>;
};

type CachedMathResult =
    | {status: 'pending'; promise: Promise<void>; fallback?: MathRenderResult}
    | {status: 'ready'; result: MathRenderResult};

export class BrowserMathJaxRenderer implements MathRenderer {
    private cache = new Map<string, CachedMathResult>();
    private previousReadyByFallbackKey = new Map<string, MathRenderResult>();

    constructor(
        private readonly onRendered?: () => void,
        private readonly renderSource: (
            source: string,
            mode: MathRenderMode,
        ) => Promise<MathRenderResult> = renderWithMathJax,
    ) {}

    render(source: string, mode: MathRenderMode, options: {fallbackKey?: string} = {}): MathRenderResult {
        const key = `${mode}\0${source}`;
        const cached = this.cache.get(key);
        if (cached?.status === 'ready') return cached.result;
        if (cached?.status === 'pending' && cached.fallback) return cached.fallback;
        if (!cached) {
            const fallback = options.fallbackKey
                ? this.previousReadyByFallbackKey.get(options.fallbackKey)
                : undefined;
            const promise = this.renderSource(source, mode)
                .then((result) => {
                    const normalized = normalizeRenderedResult(source, result);
                    this.cache.set(key, {status: 'ready', result: normalized});
                    if (options.fallbackKey && normalized.type === 'html') {
                        this.previousReadyByFallbackKey.set(options.fallbackKey, normalized);
                    }
                    this.onRendered?.();
                })
                .catch(() => {
                    this.cache.set(key, {status: 'ready', result: {type: 'literal', text: source}});
                    this.onRendered?.();
                });
            this.cache.set(key, {status: 'pending', promise, fallback});
            if (fallback) return fallback;
        }
        return {type: 'literal', text: source};
    }
}

const renderWithMathJax = async (
    source: string,
    mode: MathRenderMode,
): Promise<MathRenderResult> => {
    const mathJax = await loadMathJax();
    if (!mathJax.tex2svgPromise || !mathJax.startup?.adaptor) {
        return {type: 'literal', text: source};
    }
    const node = await mathJax.tex2svgPromise(source, {display: mode === 'display'});
    return normalizeRenderedResult(source, {
        type: 'html',
        html: mathJax.startup.adaptor.serializeXML(node),
    });
};

const normalizeRenderedResult = (
    source: string,
    result: MathRenderResult,
): MathRenderResult => {
    if (result.type === 'html' && isMathJaxErrorHtml(result.html)) {
        return {type: 'literal', text: source};
    }
    return result;
};

const isMathJaxErrorHtml = (html: string): boolean =>
    /data-mml-node=["']merror["']/.test(html) ||
    /\bdata-mjx-error=/.test(html) ||
    /<merror\b/i.test(html) ||
    /<mjx-merror\b/i.test(html);

export class FakeMathRenderer implements MathRenderer {
    render(source: string, mode: MathRenderMode): MathRenderResult {
        if (source.includes('INVALID')) return {type: 'literal', text: source};
        return {
            type: 'html',
            html: `<span data-fake-math="${mode}">${escapeHtml(source)}</span>`,
        };
    }
}

let mathJaxLoadPromise: Promise<MathJaxGlobal> | null = null;
const mathJaxComponentUrl = `${import.meta.env.BASE_URL}vendor/mathjax/tex-svg.js`;

const loadMathJax = (): Promise<MathJaxGlobal> => {
    if (mathJaxLoadPromise) return mathJaxLoadPromise;
    mathJaxLoadPromise = new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error('MathJax browser component requires document'));
            return;
        }

        const global = globalThis as typeof globalThis & {MathJax?: MathJaxGlobal};
        if (global.MathJax?.tex2svgPromise) {
            resolve(global.MathJax);
            return;
        }

        global.MathJax = {
            ...(global.MathJax ?? {}),
            startup: {
                ...(global.MathJax?.startup ?? {}),
                typeset: false,
            },
        };

        const script = document.createElement('script');
        script.src = mathJaxComponentUrl;
        script.async = true;
        script.onload = () => {
            const ready = global.MathJax?.startup?.promise ?? Promise.resolve();
            ready.then(() => (global.MathJax ? resolve(global.MathJax) : reject(new Error('MathJax did not initialize'))), reject);
        };
        script.onerror = () => reject(new Error('Failed to load MathJax'));
        document.head.append(script);
    });
    return mathJaxLoadPromise;
};

const escapeHtml = (text: string): string =>
    text.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            default:
                return '&#39;';
        }
    });
