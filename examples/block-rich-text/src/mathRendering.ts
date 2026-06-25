import type {MathRenderMode} from './inlineMarks';

export type MathRenderResult =
    | {type: 'html'; html: string}
    | {type: 'literal'; text: string};

export type MathRenderer = {
    render(source: string, mode: MathRenderMode): MathRenderResult;
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
    | {status: 'pending'; promise: Promise<void>}
    | {status: 'ready'; result: MathRenderResult};

export class BrowserMathJaxRenderer implements MathRenderer {
    private cache = new Map<string, CachedMathResult>();

    constructor(private readonly onRendered?: () => void) {}

    render(source: string, mode: MathRenderMode): MathRenderResult {
        const key = `${mode}\0${source}`;
        const cached = this.cache.get(key);
        if (cached?.status === 'ready') return cached.result;
        if (!cached) {
            const promise = this.renderAsync(source, mode)
                .then((result) => {
                    this.cache.set(key, {status: 'ready', result});
                    this.onRendered?.();
                })
                .catch(() => {
                    this.cache.set(key, {status: 'ready', result: {type: 'literal', text: source}});
                    this.onRendered?.();
                });
            this.cache.set(key, {status: 'pending', promise});
        }
        return {type: 'literal', text: source};
    }

    private async renderAsync(source: string, mode: MathRenderMode): Promise<MathRenderResult> {
        const mathJax = await loadMathJax();
        if (!mathJax.tex2svgPromise || !mathJax.startup?.adaptor) {
            return {type: 'literal', text: source};
        }
        const node = await mathJax.tex2svgPromise(source, {display: mode === 'display'});
        return {type: 'html', html: mathJax.startup.adaptor.serializeXML(node)};
    }
}

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
